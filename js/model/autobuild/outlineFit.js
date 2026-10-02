// outlineFit.js
// AutoBuild outline quality. Pure. Two jobs:
//  fitRing(ring, ink, w, h, o)  photo-pixel ring -> the same ring hugging the real wall lines:
//      tiny steps/notches that are not walls are removed, each straight edge is moved onto the
//      strongest wall line close to it (centre of the wall stripe, outer line of a double wall).
//  measureOutline(points, ...)  plan-unit ring -> { segments, coverage, notes }: every stretch of
//      the outline is 'wall' (backed by ink in the photo) or 'gap' (nothing there: the poster is
//      cut off, the wall is faint, or the shape was closed artificially). Nothing is hidden.
// Depends on: ./raster.js (dilate).

import { dilate } from './raster.js';
import { pointInPolygon } from '../geometry.js';

// point in (or within tol of) the ring
export const insideTol = (pt, ring, tol = 3) => [[0, 0], [tol, 0], [-tol, 0], [0, tol], [0, -tol], [tol, tol], [-tol, -tol], [tol, -tol], [-tol, tol]].some(([dx, dy]) => pointInPolygon([pt[0] + dx, pt[1] + dy], ring));

const EPS = 1e-6;
const same = (a, b) => Math.abs(a - b) < EPS;

// Drop repeated points and points between two collinear edges (axis-parallel rings).
export function cleanRect(pts) {
  const p = pts.map((q) => [q[0], q[1]]);
  let again = true;
  while (again && p.length >= 4) {
    again = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const dup = same(a[0], b[0]) && same(a[1], b[1]);
      const col = (same(a[0], b[0]) && same(b[0], c[0])) || (same(a[1], b[1]) && same(b[1], c[1]));
      if (dup || col) { p.splice(i, 1); again = true; break; }
    }
  }
  return p;
}

// Every edge axis-parallel: a slanted edge gets a corner that lies inside (when `inside` is given).
export function toRect(pts, inside) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push(a);
    if (!same(a[0], b[0]) && !same(a[1], b[1])) {
      const c1 = [b[0], a[1]], c2 = [a[0], b[1]];
      out.push(!inside || inside(c1) || !inside(c2) ? c1 : c2);
    }
  }
  return cleanRect(out);
}

// Fraction of ink within `tol` px of the straight stretch (a -> b), end 8% of each side left out.
export function stretchSupport(dil, w, h, a, b) {
  const horiz = same(a[1], b[1]);
  const lo = Math.min(horiz ? a[0] : a[1], horiz ? b[0] : b[1]), hi = Math.max(horiz ? a[0] : a[1], horiz ? b[0] : b[1]);
  const pad = (hi - lo) * 0.08;
  const c = Math.round(horiz ? a[1] : a[0]);
  let n = 0, t = 0;
  for (let k = Math.ceil(lo + pad); k <= Math.floor(hi - pad); k++) {
    const x = horiz ? k : c, y = horiz ? c : k;
    t++;
    if (x >= 0 && y >= 0 && x < w && y < h && dil[y * w + x]) n++;
  }
  return t ? n / t : 0;
}

// Wall line near coordinate c of an edge spanning [lo, hi]: centre of the strongest stripe within +-reach.
function wallLineNear(ink, w, h, horiz, c, lo, hi, reach, outSign, wallT) {
  const pad = (hi - lo) * 0.1;
  const k0 = Math.ceil(lo + pad), k1 = Math.floor(hi - pad);
  if (k1 <= k0) return c;
  const score = [];
  for (let d = -reach; d <= reach; d++) {
    const cc = Math.round(c) + d;
    let n = 0;
    for (let k = k0; k <= k1; k++) {
      const x = horiz ? k : cc, y = horiz ? cc : k;
      if (x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x]) n++;
    }
    score.push(n / (k1 - k0 + 1));
  }
  let best = 0;
  for (const s of score) if (s > best) best = s;
  if (best < 0.35) return c;
  // the stripe closest to where the edge already is, among the near-best rows
  let pick = -1;
  for (let i = 0; i < score.length; i++) if (score[i] >= 0.6 * best && (pick < 0 || Math.abs(i - reach) < Math.abs(pick - reach))) pick = i;
  let a = pick, b = pick;
  while (a > 0 && score[a - 1] >= 0.6 * best) a--;
  while (b < score.length - 1 && score[b + 1] >= 0.6 * best) b++;
  const lo2 = Math.round(c) + a - reach, hi2 = Math.round(c) + b - reach;
  if (hi2 - lo2 + 1 > 2.5 * wallT) return (outSign > 0 ? hi2 - wallT / 2 : lo2 + wallT / 2) + 0.5;
  return (lo2 + hi2) / 2 + 0.5;
}

const area2 = (p) => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0);

// Remove steps / notches shorter than minStep that are not backed by a wall. Merging the two parallel
// edges beside a short edge keeps the line with more wall behind it.
function dropShort(pts, dil, w, h, minStep) {
  let p = cleanRect(pts);
  for (let guard = 0; guard < 200 && p.length > 4; guard++) {
    let pick = -1, bestLen = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const len = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      if (len >= minStep || len >= bestLen) continue;
      if (len >= 0.35 * minStep && stretchSupport(dil, w, h, a, b) >= 0.6) continue; // a real little wall
      pick = i; bestLen = len;
    }
    if (pick < 0) break;
    const n = p.length, i0 = (pick + n - 1) % n, i1 = pick, i2 = (pick + 1) % n, i3 = (pick + 2) % n;
    const horiz = same(p[i1][1], p[i2][1]); // short edge direction; neighbours run the other way
    const ax = horiz ? 0 : 1; // coordinate that the neighbours share
    const wt = (u, v) => Math.abs(u[1 - ax] - v[1 - ax]) * (0.3 + stretchSupport(dil, w, h, u, v));
    const cPrev = p[i1][ax], cNext = p[i2][ax];
    const keep = wt(p[i0], p[i1]) >= wt(p[i2], p[i3]) ? cPrev : cNext;
    const q = p.map((v) => [v[0], v[1]]);
    q[i0][ax] = keep; q[i3][ax] = keep;
    p = cleanRect(q.filter((_, i) => i !== i1 && i !== i2));
  }
  return p;
}

// Move every edge onto the wall line near it. Returns a new clean ring.
function snapEdges(pts, ink, w, h, reach, wallT) {
  const n = pts.length;
  const sgn = area2(pts) > 0 ? 1 : -1;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const horiz = same(a[1], b[1]);
    const lo = Math.min(horiz ? a[0] : a[1], horiz ? b[0] : b[1]), hi = Math.max(horiz ? a[0] : a[1], horiz ? b[0] : b[1]);
    const c = horiz ? a[1] : a[0];
    // outward side along the perpendicular axis (shoelace sign tells which side the inside is on)
    const dir = horiz ? Math.sign(b[0] - a[0]) : Math.sign(b[1] - a[1]);
    const outSign = horiz ? -sgn * dir : sgn * dir;
    const nc = wallLineNear(ink, w, h, horiz, c, lo, hi, reach, outSign, wallT);
    edges.push({ horiz, c: nc });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const e1 = edges[(i + n - 1) % n], e2 = edges[i];
    out.push([e1.horiz ? e2.c : e1.c, e1.horiz ? e1.c : e2.c]);
  }
  return cleanRect(out);
}

// ring: photo-pixel polygon (closed, any shape); ink: wall ink mask. o: { minStep, reach, wallT, inside }
export function fitRing(ring, ink, w, h, o = {}) {
  const reach = o.reach || 5, wallT = o.wallT || 3;
  const dil = dilate(ink, w, h, Math.max(2, Math.round(reach / 2)));
  let p = toRect(ring, o.inside);
  if (p.length < 4) return ring;
  for (let pass = 0; pass < 2; pass++) {
    if (o.minStep) p = dropShort(p, dil, w, h, o.minStep);
    const s = snapEdges(p, ink, w, h, reach, wallT);
    if (s.length >= 4) p = s;
  }
  if (o.minStep) p = dropShort(p, dil, w, h, o.minStep);
  return p.length >= 4 ? p : ring;
}

const SIDE = (mid, box) => {
  const nx = (mid[0] - (box.x0 + box.x1) / 2) / Math.max(1, box.x1 - box.x0), ny = (mid[1] - (box.y0 + box.y1) / 2) / Math.max(1, box.y1 - box.y0);
  return Math.abs(nx) >= Math.abs(ny) ? (nx < 0 ? 'left' : 'right') : (ny < 0 ? 'top' : 'bottom');
};

// Runs of one edge (plan units a -> b): [{ s, e, v (1 = wall behind it), sup }] in photo pixels along the edge.
function edgeRuns(a, b, dil, w, h, scale, hole, minRun) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) / scale;
  const m = Math.max(1, Math.ceil(len));
  const raw = new Uint8Array(m);
  for (let k = 0; k < m; k++) {
    const t = (k + 0.5) / m;
    const x = Math.round((a[0] + (b[0] - a[0]) * t) / scale), y = Math.round((a[1] + (b[1] - a[1]) * t) / scale);
    raw[k] = x >= 0 && y >= 0 && x < w && y < h && dil[y * w + x] ? 1 : 0;
  }
  const f = Uint8Array.from(raw);
  const runs = (arr) => { const r = []; let s = 0; for (let k = 1; k <= arr.length; k++) if (k === arr.length || arr[k] !== arr[s]) { r.push([s, k, arr[s]]); s = k; } return r; };
  // bridge short openings (a door), then forget short specks of wall
  for (const [s, e, v] of runs(f)) if (!v && s > 0 && e < m && e - s < hole) f.fill(1, s, e);
  const lim = Math.min(minRun, 0.5 * m);
  for (const [s, e, v] of runs(f)) if (v && e - s < lim && (m > lim * 2 || runs(f).length > 1)) f.fill(0, s, e);
  return { m, runs: runs(f).map(([s, e, v]) => ({ s, e, v, sup: raw.subarray(s, e).reduce((t, q) => t + q, 0) / (e - s) })) };
}

// points: plan-unit ring; scale: plan units per photo pixel; ink: wall ink mask (photo pixels).
// o: { tol (px), hole (px, a bridged opening such as a door), minRun (px), dil }
export function measureOutline(points, ink, w, h, scale, o = {}) {
  const tol = Math.max(2, Math.round(o.tol || 3));
  const dil = o.dil || dilate(ink, w, h, tol);
  const hole = o.hole || 24, minRun = o.minRun || 14;
  const segments = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const { m, runs } = edgeRuns(a, b, dil, w, h, scale, hole, minRun);
    const pt = (k) => [Math.round((a[0] + ((b[0] - a[0]) * k) / m) * 10) / 10, Math.round((a[1] + ((b[1] - a[1]) * k) / m) * 10) / 10];
    for (const r of runs) segments.push({ a: pt(r.s), b: pt(r.e), supported: Math.round(r.sup * 100) / 100, kind: r.v ? 'wall' : 'gap', len: r.e - r.s });
  }
  let total = 0, wall = 0;
  for (const s of segments) { total += s.len; if (s.kind === 'wall') wall += s.len; }
  const coverage = total ? wall / total : 0;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const gaps = segments.filter((s) => s.kind === 'gap');
  const notes = [];
  if (gaps.length) {
    const sides = [...new Set(gaps.map((s) => SIDE([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], box)))];
    const share = Math.round((100 * gaps.reduce((t, s) => t + s.len, 0)) / Math.max(1, total));
    notes.push(`${gaps.length} stretch${gaps.length === 1 ? '' : 'es'} of the outline (${share}%) have no wall in the photo: ${sides.join(', ')}`);
  }
  if (coverage >= 0.9 && !gaps.length) notes.push('The outline follows a wall all the way round');
  return { segments: segments.map(({ len, ...s }) => s), coverage: Math.round(coverage * 100) / 100, notes };
}

const bboxOf = (it) => {
  if (it.points) { const xs = it.points.map((p) => p[0]), ys = it.points.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }
  return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
};
const crosses = (p) => {
  const n = p.length, on = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
    if (on(a, b, c) * on(a, b, d) < 0 && on(c, d, a) * on(c, d, b) < 0) return true;
  }
  return false;
};

// A closing line drawn across empty paper (no wall behind it) is pulled in to the building content next
// to it: the edge moves to the nearest room / hall edge, never past one. Returns a new ring (or the same).
// items: shapes {x,y,w,h}|{points}; o: as measureOutline plus { minPull (plan units), inside(pt) }
export function pullGaps(points, items, ink, w, h, scale, o = {}) {
  const tol = Math.max(2, Math.round(o.tol || 3));
  const dil = o.dil || dilate(ink, w, h, tol);
  const hole = o.hole || 24, minRun = o.minRun || 14, minPull = o.minPull || 15;
  const boxes = items.map(bboxOf);
  let p = cleanRect(points);
  const bad = new Set();
  for (let guard = 0; guard < 16; guard++) {
    const n = p.length;
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const horiz = same(a[1], b[1]);
      const ax = horiz ? 1 : 0, lo = Math.min(a[1 - ax], b[1 - ax]), hi = Math.max(a[1 - ax], b[1 - ax]);
      const { m, runs } = edgeRuns(a, b, dil, w, h, scale, hole, minRun);
      const gapLen = runs.reduce((t, r) => t + (r.v ? 0 : r.e - r.s), 0);
      if (gapLen < 0.7 * m) continue;
      const c = a[ax];
      // inward is the side where the content is: the content extreme nearest to the edge on either side of it
      let up = Infinity, down = -Infinity; // nearest content coordinate above / below c (smaller / larger)
      for (const bx of boxes) {
        const l2 = horiz ? bx.x0 : bx.y0, h2 = horiz ? bx.x1 : bx.y1;
        if (Math.min(hi, h2) - Math.max(lo, l2) < 1) continue;
        const c0 = horiz ? bx.y0 : bx.x0, c1 = horiz ? bx.y1 : bx.x1;
        if (c1 <= c + 1) down = Math.max(down, c1); // content lies at smaller coordinates
        if (c0 >= c - 1) up = Math.min(up, c0); // content lies at larger coordinates
        if (c0 < c - 1 && c1 > c + 1) { up = -Infinity; down = Infinity; break; } // content spans the edge: leave it
      }
      for (const [tgt, d] of [[down, c - down], [up, up - c]]) {
        if (!isFinite(tgt) || d < minPull || bad.has(`${i}|${tgt}`)) continue;
        if (!best || d > best.d) best = { i, ax, tgt, d };
      }
    }
    if (!best) break;
    const q = p.map((v) => [v[0], v[1]]);
    q[best.i][best.ax] = best.tgt; q[(best.i + 1) % p.length][best.ax] = best.tgt;
    const r = cleanRect(q);
    const ok = r.length >= 4 && !crosses(r) && Math.sign(area2(r)) === Math.sign(area2(p))
      && boxes.every((bx) => [[bx.x0, bx.y0], [bx.x1, bx.y0], [bx.x0, bx.y1], [bx.x1, bx.y1]].every((v) => insideTol(v, r, 3)));
    if (!ok) { bad.add(`${best.i}|${best.tgt}`); continue; }
    p = r;
    bad.clear();
  }
  return p;
}
