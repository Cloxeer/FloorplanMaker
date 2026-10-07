// shapes.js
// Geometry helpers for AutoBuild: face -> room shape (rect or polygon),
// corridor -> hallway rectangles, shared-coordinate snapping.
// Pure. Depends on: js/model/autobuild/raster.js, js/model/autobuild/faces.js.

import { dilate } from './raster.js';
import { traceOuter, simplifyRing, orthogonalize, clusterSnap } from './faces.js';

const snap5 = (v) => Math.round(v / 5) * 5;

// A polygon that is just an axis-aligned box (4 corners, or a ring that only repeats them) -> {x,y,w,h}.
export function rectOfPoly(points, tol = 0.5) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const onSide = (p) => (Math.abs(p[0] - x0) <= tol || Math.abs(p[0] - x1) <= tol) && (Math.abs(p[1] - y0) <= tol || Math.abs(p[1] - y1) <= tol);
  if (points.length > 5 || !points.every(onSide)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Mask (Uint8Array w*h) of one face id restricted to its bbox, grown by `grow`.
function faceMask(labels, w, h, f, grow) {
  const x0 = Math.max(0, f.x0 - grow - 2), y0 = Math.max(0, f.y0 - grow - 2);
  const x1 = Math.min(w - 1, f.x1 + grow + 2), y1 = Math.min(h - 1, f.y1 + grow + 2);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const m = new Uint8Array(bw * bh);
  for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (labels[y * w + x] === f.id) m[(y - y0) * bw + (x - x0)] = 1;
  return { m: grow > 0 ? dilate(m, bw, bh, grow) : m, x0, y0, bw, bh };
}

// Shape of a face: { kind:'rect', x,y,w,h } or { kind:'poly', points } (grown by `grow`).
export function faceShape(labels, w, h, f, grow, nonRect = 0.86) {
  const rect = { kind: 'rect', x: f.x0 - grow, y: f.y0 - grow, w: f.x1 - f.x0 + 1 + 2 * grow, h: f.y1 - f.y0 + 1 + 2 * grow };
  if (f.fill >= nonRect) return rect;
  const { m, x0, y0, bw, bh } = faceMask(labels, w, h, f, grow);
  const ring = traceOuter(m, bw, bh);
  if (ring.length < 8) return rect;
  // coarser and coarser outlines until it is simple enough to edit by hand
  let poly = null;
  const maxVerts = f.fill < 0.7 ? 24 : 14;
  for (const eps of [2.2, 3.5, 5.5, 8, 12, 18]) {
    const p = orthogonalize(simplifyRing(ring, eps), 8);
    if (p.length >= 4 && p.length <= maxVerts) { poly = p.map(([x, y]) => [x + x0, y + y0]); break; }
  }
  if (!poly) return rect;
  // polygons that barely differ from their bbox are just rects
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  if (Math.abs(a) / 2 > 0.93 * rect.w * rect.h) return rect;
  const box = rectOfPoly(poly, 1.5);
  if (box) return { kind: 'rect', ...box };
  return { kind: 'poly', points: poly };
}

// Largest axis-aligned rectangle of 1s in a grid (stack method) -> {x,y,w,h,area}.
function largestRect(grid, gw, gh) {
  const heights = new Int32Array(gw);
  let best = { area: 0 };
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) heights[x] = grid[y * gw + x] ? heights[x] + 1 : 0;
    const st = [];
    for (let x = 0; x <= gw; x++) {
      const hh = x === gw ? 0 : heights[x];
      let start = x;
      while (st.length && st[st.length - 1].h >= hh) {
        const t = st.pop();
        const area = t.h * (x - t.x);
        if (area > best.area) best = { area, x: t.x, y: y - t.h + 1, w: x - t.x, h: t.h };
        start = t.x;
      }
      st.push({ x: start, h: hh });
    }
  }
  return best;
}

// Corridor mask -> greedy list of long, thin rectangles (full-res coords).
export function hallRects(mask, w, h, minShort, minLong, maxShort, step = 3, maxRects = 14) {
  const gw = Math.ceil(w / step), gh = Math.ceil(h / step);
  const grid = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) grid[((y / step) | 0) * gw + ((x / step) | 0)] = 1;
  // keep a cell only if it is mostly on
  const out = [];
  for (let k = 0; k < maxRects; k++) {
    const r = largestRect(grid, gw, gh);
    if (!r.area) break;
    const rw = r.w * step, rh = r.h * step;
    const short = Math.min(rw, rh), long = Math.max(rw, rh);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y * gw + x] = 0;
    if (short < minShort || long < minLong) continue;
    if (long / short < 2) continue;
    if (short > maxShort) continue;
    out.push({ x: r.x * step, y: r.y * step, w: rw, h: rh });
  }
  return out;
}

// Snap every x (and y) of the given shapes to shared cluster values, then to the 5-grid.
export function alignShapes(shapes, tol) {
  const xs = [], ys = [];
  const each = (fn) => shapes.forEach((s) => {
    if (s.points) s.points.forEach((p) => fn(p));
    else { fn([s.x, s.y], 'a'); fn([s.x + s.w, s.y + s.h], 'b'); }
  });
  each((p) => { xs.push(p[0]); ys.push(p[1]); });
  const sx = clusterSnap(xs, tol), sy = clusterSnap(ys, tol);
  const gx = (v) => snap5(sx(v)), gy = (v) => snap5(sy(v));
  for (const s of shapes) {
    if (s.points) s.points = s.points.map(([x, y]) => [gx(x), gy(y)]);
    else {
      const x0 = gx(s.x), y0 = gy(s.y), x1 = gx(s.x + s.w), y1 = gy(s.y + s.h);
      s.x = x0; s.y = y0; s.w = Math.max(5, x1 - x0); s.h = Math.max(5, y1 - y0);
    }
  }
}

// Rects that cross each other by a few pixels (rounding after snapping) get a
// shared edge halfway through the overlap. Deeper overlaps are left alone.
export function resolveOverlaps(rects, maxDepth = 12) {
  // polygons that are really boxes become rects (in place) so they take part
  for (const r of rects) {
    if (!r.points) continue;
    const b = rectOfPoly(r.points, 1.5);
    if (b) { Object.assign(r, b); delete r.points; if (r.kind) r.kind = 'rect'; if (r.shape) r.shape = 'rect'; }
  }
  const R = rects.filter((r) => !r.points);
  for (let i = 0; i < R.length; i++) {
    for (let j = i + 1; j < R.length; j++) {
      const a = R[i], b = R[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox <= 0 || oy <= 0 || Math.min(ox, oy) > maxDepth) continue;
      // side by side (neither spans the other along the cut), and neither loses more than 60 %
      if (ox <= oy) {
        const [l, r] = a.x <= b.x ? [a, b] : [b, a];
        if (l.x + l.w >= r.x + r.w) continue;
        const mid = snap5((r.x + l.x + l.w) / 2);
        if (mid - l.x < 0.4 * l.w || r.x + r.w - mid < 0.4 * r.w) continue;
        l.w = Math.max(5, mid - l.x); const rEnd = r.x + r.w; r.x = mid; r.w = Math.max(5, rEnd - mid);
      } else {
        const [t, u] = a.y <= b.y ? [a, b] : [b, a];
        if (t.y + t.h >= u.y + u.h) continue;
        const mid = snap5((u.y + t.y + t.h) / 2);
        if (mid - t.y < 0.4 * t.h || u.y + u.h - mid < 0.4 * u.h) continue;
        t.h = Math.max(5, mid - t.y); const uEnd = u.y + u.h; u.y = mid; u.h = Math.max(5, uEnd - mid);
      }
    }
  }
}

// Grow a box outward (one pixel at a time, side by side) until each side meets a wall.
// Used for open-plan rooms whose walls do not close: the text marks the room, the walls bound it.
export function growFromBox(wall, w, h, box, maxGrow) {
  let { x0, y0, x1, y1 } = box;
  const open = { l: true, r: true, t: true, b: true };
  const hit = (xa, ya, xb, yb) => {
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if (wall[y * w + x]) return true;
    return false;
  };
  for (let step = 0; step < maxGrow && (open.l || open.r || open.t || open.b); step++) {
    if (open.r) { if (x1 + 1 >= w - 1 || hit(x1 + 1, y0, x1 + 1, y1)) open.r = false; else x1++; }
    if (open.l) { if (x0 - 1 <= 0 || hit(x0 - 1, y0, x0 - 1, y1)) open.l = false; else x0--; }
    if (open.b) { if (y1 + 1 >= h - 1 || hit(x0, y1 + 1, x1, y1 + 1)) open.b = false; else y1++; }
    if (open.t) { if (y0 - 1 <= 0 || hit(x0, y0 - 1, x1, y0 - 1)) open.t = false; else y0--; }
  }
  return { x0, y0, x1, y1 };
}

// A room whose walls are drawn open: from the label's box, cast a few parallel rays each way; the room edge is where most of them
// meet a wall line (the median stop distance). -> { l, r, t, b }: the distance to the wall on each side, or null where no wall
// was found (nothing is guessed there), plus the label box.
export function rayBox(wall, w, h, box, cap) {
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const cast = (dx, dy) => {
    const n = 7, stops = [];
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      let x = dx ? (dx > 0 ? box.x1 + 1 : box.x0 - 1) : Math.round(box.x0 + bw * f);
      let y = dy ? (dy > 0 ? box.y1 + 1 : box.y0 - 1) : Math.round(box.y0 + bh * f);
      let d = 0;
      while (d < cap && x > 0 && y > 0 && x < w - 1 && y < h - 1 && !wall[y * w + x]) { x += dx; y += dy; d++; }
      stops.push(d);
    }
    const m = med(stops);
    return m >= cap ? null : m; // no wall found within reach: the edge is unknown
  };
  return { l: cast(-1, 0), r: cast(1, 0), t: cast(0, -1), b: cast(0, 1), x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y1 };
}

// Pull room edges onto the wall lines actually drawn: each rect edge (and each axis-aligned
// polygon edge) moves to the strongest wall line within `tol` px that covers most of the
// edge's span. Edges with no clear wall nearby stay where they are, so nothing is invented.
// `wall` = ink raster (layers.wallInk || layers.ink). Run alignShapes() afterwards so
// neighbours that snapped to the same line share one exact value.
export function snapToWalls(shapes, wall, w, h, tol) {
  const t = Math.max(1, Math.round(tol));
  // fraction of a span [a, b] covered by wall along one line (vertical line x, or horizontal line y)
  const cover = (alongY, pos, a, b) => {
    a = Math.max(0, Math.round(a)); b = Math.min((alongY ? h : w) - 1, Math.round(b));
    if (pos < 0 || pos >= (alongY ? w : h) || b <= a) return 0;
    let n = 0;
    for (let q = a; q <= b; q++) n += wall[alongY ? q * w + pos : pos * w + q] ? 1 : 0;
    return n / (b - a + 1);
  };
  // a wall may be several px thick: best position = centre of the run of best-covered lines
  const best = (alongY, pos, a, b) => {
    const lo = pos - t, hi = pos + t;
    let top = 0;
    const ev = [];
    for (let p = lo; p <= hi; p++) { const e = cover(alongY, p, a, b); ev.push(e); if (e > top) top = e; }
    if (top < 0.45) return pos;
    // keep the run that holds the line closest to the original position
    let bestI = -1, bd = 1e9;
    for (let i = 0; i < ev.length; i++) if (ev[i] >= top * 0.9 && Math.abs(i - t) < bd) { bd = Math.abs(i - t); bestI = i; }
    let i0 = bestI, i1 = bestI;
    while (i0 > 0 && ev[i0 - 1] >= top * 0.9) i0--;
    while (i1 < ev.length - 1 && ev[i1 + 1] >= top * 0.9) i1++;
    return lo + (i0 + i1) / 2;
  };
  for (const s of shapes) {
    if (s.points) {
      const n = s.points.length;
      const pts = s.points.map((p) => p.slice());
      for (let i = 0; i < n; i++) {
        const p = s.points[i], q = s.points[(i + 1) % n];
        if (Math.abs(p[0] - q[0]) < 0.5) { const x = best(true, Math.round(p[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])); pts[i][0] = x; pts[(i + 1) % n][0] = x; }
        else if (Math.abs(p[1] - q[1]) < 0.5) { const y = best(false, Math.round(p[1]), Math.min(p[0], q[0]), Math.max(p[0], q[0])); pts[i][1] = y; pts[(i + 1) % n][1] = y; }
      }
      s.points = pts;
    } else {
      const x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
      const nx0 = best(true, Math.round(x0), y0, y1), nx1 = best(true, Math.round(x1), y0, y1);
      const ny0 = best(false, Math.round(y0), x0, x1), ny1 = best(false, Math.round(y1), x0, x1);
      if (nx1 - nx0 >= 5 && ny1 - ny0 >= 5) { s.x = nx0; s.y = ny0; s.w = nx1 - nx0; s.h = ny1 - ny0; }
    }
  }
}
