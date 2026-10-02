// fixOverlaps.js
// Pure "fix overlaps" proposals for one cluster of overlapping plan items (see overlaps.js).
// Two ways to remove an overlap, both only ever shrinking a room (nothing is moved far, nothing
// is invented): a small crossing between two rectangles gets a shared edge halfway through it
// (on the 5-grid); anything bigger trims the larger room around the smaller one, which turns the
// larger room into an L / notched polygon. Stairs are never changed (the room around them is).
// A room that sits completely inside another is reported, not guessed at.
// Depends on: js/model/geometry.js, js/model/document.js (roomPolygon), js/model/overlaps.js.

import { roomPolygon } from './document.js';
import { polygonArea, bbox, polygonsOverlap } from './geometry.js';
import { rectilinear, gridOf, cellsIn, fillPoly, overlapAreaAny } from './polyOverlap.js';

export const overlapArea = overlapAreaAny;
import { simplifyRing } from './autobuild/faces.js';

// Remove duplicate points, collinear points and back-tracking spikes from a ring. Returns the clean
// ring, or null when it is degenerate or crosses itself.
export function cleanRing(pts) {
  let r = (pts || []).map(([x, y]) => [x, y]);
  for (let guard = 0; guard < 200; guard++) {
    let changed = false;
    for (let i = 0; i < r.length && r.length >= 3; i++) {
      const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
      const dup = (a[0] === b[0] && a[1] === b[1]);
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (dup || cr === 0) { r.splice(i, 1); changed = true; break; }
    }
    if (!changed) break;
  }
  if (r.length < 3 || Math.abs(polygonArea(r)) < 1) return null;
  const segs = r.map((p, i) => [p, r[(i + 1) % r.length]]);
  const ccw = (p, q, t) => (q[0] - p[0]) * (t[1] - p[1]) - (q[1] - p[1]) * (t[0] - p[0]);
  for (let i = 0; i < segs.length; i++) for (let j = i + 2; j < segs.length; j++) {
    if (i === 0 && j === segs.length - 1) continue;
    const [a, b] = segs[i], [c, d] = segs[j];
    if (ccw(a, b, c) * ccw(a, b, d) < 0 && ccw(c, d, a) * ccw(c, d, b) < 0) return null;
  }
  return r;
}

const snap5 = (v) => Math.round(v / 5) * 5;
const shortName = (it) => (it.type === 'stair' ? `Stair ${it.label || ''}`.trim() : [it.name, it.number].filter(Boolean).join(' ') || 'a room');
const rawPoly = (it) => roomPolygon(it.type === 'stair' ? { ...it, shape: 'rect' } : it);
const polyOf = (it) => {
  const p = rawPoly(it);
  if (it.type === 'stair' || it.shape !== 'poly') return p;
  return cleanRing(p) || (() => { const b = bbox(p); return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]; })();
};
const counts = (a, b) => (a.type === 'room' && b.type === 'room') || (a.type === 'room' && b.type === 'stair') || (a.type === 'stair' && b.type === 'room');

// Outline of a set of grid cells as one ring, or null when it is split / has a hole / pinches.
function ringOf(cells, g) {
  const nx = g.xs.length - 1, ny = g.ys.length - 1;
  const at = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && cells[j * nx + i];
  const edges = new Map();
  let total = 0;
  const add = (a, b) => {
    const k = `${a[0]},${a[1]}`;
    if (edges.has(k)) edges.set(k, null); else edges.set(k, b);
    total++;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) add([i, j], [i + 1, j]);
    if (!at(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
    if (!at(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
    if (!at(i - 1, j)) add([i, j + 1], [i, j]);
  }
  if (!total) return null;
  const first = [...edges.keys()][0];
  const ring = [];
  let k = first, n = 0;
  do {
    const nxt = edges.get(k);
    if (!nxt) return null;
    const [x, y] = k.split(',').map(Number);
    ring.push([g.xs[x], g.ys[y]]);
    k = `${nxt[0]},${nxt[1]}`;
    if (++n > total + 2) return null;
  } while (k !== first);
  if (n !== total) return null; // more than one ring (a hole or a split piece)
  return ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length], b = ring[(i + 1) % ring.length];
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
}

// Same, for shapes with diagonal edges (e.g. an octagonal hall): done on a 1-unit lattice, then the
// staircase outline is simplified back to straight edges. Rect edges stay exact.
function rasterClip(target, cutter) {
  const b = bbox(target);
  const x0 = Math.floor(b.x), y0 = Math.floor(b.y), W = Math.ceil(b.w) + 1, H = Math.ceil(b.h) + 1;
  if (W * H > 6e6) return null;
  const T = fillPoly(target, x0, y0, W, H), C0 = fillPoly(cutter, x0, y0, W, H);
  // keep one unit clear of the cutter so simplifying the outline cannot push it back into the cutter
  const C = C0.slice();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (C0[j * W + i]) {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const jj = j + dj, ii = i + di;
      if (jj >= 0 && ii >= 0 && jj < H && ii < W) C[jj * W + ii] = 1;
    }
  }
  const R = T.map((v, k) => (v && !C[k] ? 1 : 0));
  const xs = Array.from({ length: W + 1 }, (_, i) => x0 + i), ys = Array.from({ length: H + 1 }, (_, j) => y0 + j);
  const ring = ringOf(R, { xs, ys });
  if (!ring || ring.length < 4) return null;
  for (const eps of [1.2, 0.8, 0.4]) {
    const simple = cleanRing(simplifyRing(ring, eps).map(([x, y]) => [Math.round(x), Math.round(y)]));
    if (!simple || simple.length < 4 || Math.abs(polygonArea(simple)) < 0.35 * Math.abs(polygonArea(target))) continue;
    if (overlapAreaAny(simple, cutter) === 0) return simple;
  }
  return null;
}

// Target shape minus the cutter, or null when the result would not be one simple piece
// or would lose most of the room.
export function clipShape(target, cutter) {
  if (!rectilinear(target) || !rectilinear(cutter)) return rasterClip(target, cutter);
  const g = gridOf([target, cutter]);
  const T = cellsIn(target, g), C = cellsIn(cutter, g);
  const R = T.map((v, k) => (v && !C[k] ? 1 : 0));
  const ring = ringOf(R, g);
  if (!ring || ring.length < 4) return null;
  if (Math.abs(polygonArea(ring)) < 0.35 * Math.abs(polygonArea(target))) return null;
  return ring;
}

function withShape(item, ring) {
  const b = bbox(ring);
  const base = { ...item };
  delete base.x; delete base.y; delete base.w; delete base.h; delete base.points;
  if (ring.length === 4 && Math.abs(polygonArea(ring)) === b.w * b.h) {
    return { ...base, shape: 'rect', x: b.x, y: b.y, w: b.w, h: b.h };
  }
  return { ...base, shape: 'poly', points: ring.map(([x, y]) => [x, y]) };
}

const isRect = (it) => it.type === 'stair' || it.shape !== 'poly';
const boxOf = (it) => bbox(polyOf(it));
const within = (p, q) => p.x >= q.x - 1 && p.y >= q.y - 1 && p.x + p.w <= q.x + q.w + 1 && p.y + p.h <= q.y + q.h + 1;

function overlapsNow(a, b) {
  if (!counts(a, b)) return false;
  const pa = polyOf(a), pb = polyOf(b);
  return overlapAreaAny(pa, pb) > 0;
}

// Fix one cluster ({ items, pairs } from overlapClusters).
// -> { doc, changedIds, notes, unresolved:[{a,b,reason}] }
export function proposeFix(doc, cluster) {
  const ids = new Set(cluster.items.map((i) => i.id));
  let items = doc.items.slice();
  const byId = () => new Map(items.map((i) => [i.id, i]));
  const changed = new Set(), notes = [], unresolved = [], bad = new Set();
  const key = (a, b) => [a.id, b.id].sort().join('|');
  const put = (it) => { items = items.map((x) => (x.id === it.id ? it : x)); changed.add(it.id); };

  for (let pass = 0; pass < 40; pass++) {
    const m = byId();
    const mine = [...ids].map((id) => m.get(id)).filter(Boolean);
    let pair = null;
    for (let i = 0; i < mine.length && !pair; i++) for (let j = i + 1; j < mine.length; j++) {
      if (!bad.has(key(mine[i], mine[j])) && overlapsNow(mine[i], mine[j])) { pair = [mine[i], mine[j]]; break; }
    }
    if (!pair) break;
    const [a, b] = pair;
    const A = boxOf(a), B = boxOf(b);
    // fully inside another room (not touching its edge) cannot be carved out without a hole
    const strictlyInside = (p, q) => p.x > q.x + 1 && p.y > q.y + 1 && p.x + p.w < q.x + q.w - 1 && p.y + p.h < q.y + q.h - 1;
    if (strictlyInside(A, B) || strictlyInside(B, A)) {
      bad.add(key(a, b));
      unresolved.push({ a, b, reason: `${shortName(strictlyInside(A, B) ? a : b)} sits completely inside ${shortName(strictlyInside(A, B) ? b : a)}; move or delete one of them` });
      continue;
    }
    // small crossing of two rectangles: share the edge halfway
    if (isRect(a) && isRect(b) && a.type === 'room' && b.type === 'room') {
      const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x), oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      const depth = Math.min(ox, oy);
      if (depth <= Math.max(12, 0.15 * Math.min(A.w, A.h, B.w, B.h))) {
        const [p, q] = ox <= oy ? (A.x <= B.x ? [a, b] : [b, a]) : (A.y <= B.y ? [a, b] : [b, a]);
        const P = boxOf(p), Q = boxOf(q);
        let np, nq;
        if (ox <= oy) {
          const mid = snap5((Math.max(A.x, B.x) + Math.min(A.x + A.w, B.x + B.w)) / 2);
          np = { ...p, x: P.x, w: Math.max(5, mid - P.x) };
          nq = { ...q, x: mid, w: Math.max(5, Q.x + Q.w - mid) };
        } else {
          const mid = snap5((Math.max(A.y, B.y) + Math.min(A.y + A.h, B.y + B.h)) / 2);
          np = { ...p, y: P.y, h: Math.max(5, mid - P.y) };
          nq = { ...q, y: mid, h: Math.max(5, Q.y + Q.h - mid) };
        }
        put(np); put(nq);
        notes.push(`${shortName(p)} and ${shortName(q)} now share one edge`);
        if (overlapsNow(np, nq)) bad.add(key(np, nq));
        continue;
      }
    }
    // otherwise trim the larger room around the smaller one (a stair is never trimmed)
    let target = a, cutter = b;
    if (a.type === 'stair') { target = b; cutter = a; } else if (b.type !== 'stair' && A.w * A.h < B.w * B.h) { target = b; cutter = a; }
    const ring = clipShape(polyOf(target), polyOf(cutter));
    if (!ring) {
      bad.add(key(a, b));
      unresolved.push({ a, b, reason: `${shortName(target)} cannot be trimmed around ${shortName(cutter)} cleanly; move one of them` });
      continue;
    }
    let trimmed = withShape(target, ring);
    // The studio's own warning (polygonsOverlap) can still fire when a trimmed room's centre lands in
    // the notch; when the other way round is clean for it too, trim the other room instead.
    if (polygonsOverlap(polyOf(trimmed), polyOf(cutter)) && cutter.type === 'room') {
      const ring2 = clipShape(polyOf(cutter), polyOf(target));
      if (ring2) {
        const alt = withShape(cutter, ring2);
        if (!polygonsOverlap(polyOf(alt), polyOf(target)) && !overlapsNow(alt, target)
          && Math.abs(polygonArea(polyOf(alt))) <= Math.abs(polygonArea(polyOf(cutter))) + 1) {
          put(alt);
          notes.push(`${shortName(cutter)} trimmed around ${shortName(target)}`);
          continue;
        }
      }
    }
    const grew = Math.abs(polygonArea(polyOf(trimmed))) > Math.abs(polygonArea(polyOf(target))) + 1;
    if (grew || overlapsNow(trimmed, cutter)) {
      bad.add(key(a, b));
      unresolved.push({ a, b, reason: `${shortName(target)} and ${shortName(cutter)} overlap in an awkward shape; move one of them` });
      continue;
    }
    put(trimmed);
    notes.push(`${shortName(target)} trimmed around ${shortName(cutter)}`);
  }
  return { doc: { ...doc, items }, changedIds: [...changed], notes, unresolved };
}
