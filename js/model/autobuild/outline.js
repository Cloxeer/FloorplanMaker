// outline.js
// AutoBuild outline helpers: every room, hall, stair and elevator must lie inside
// the building outline. Pure. Depends on: ./raster.js, ../geometry.js.

import { dilate, erode } from './raster.js';
import { pointInPolygon, nearestPointOnPolyline } from '../geometry.js';

const boxOf = (s) => {
  if (s.points) {
    const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  return { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
};

// Paint every shape ({x,y,w,h} or {points}) into a w*h mask (polygon shapes by scanline test).
export function shapesMask(shapes, w, h) {
  const m = new Uint8Array(w * h);
  for (const s of shapes) {
    const b = boxOf(s);
    const x0 = Math.max(0, Math.floor(b.x0)), x1 = Math.min(w - 1, Math.ceil(b.x1) - 1);
    const y0 = Math.max(0, Math.floor(b.y0)), y1 = Math.min(h - 1, Math.ceil(b.y1) - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!s.points || pointInPolygon([x + 0.5, y + 0.5], s.points)) m[y * w + x] = 1;
    }
  }
  return m;
}

// footprint body (thin attachments removed) united with all shapes, small gaps closed.
export function unionBody(foot, shapes, w, h, bodyR, closeR) {
  const body = dilate(erode(foot, w, h, bodyR), w, h, bodyR);
  const sm = shapesMask(shapes, w, h);
  const u = new Uint8Array(w * h);
  for (let i = 0; i < u.length; i++) u[i] = body[i] | sm[i];
  return closeR > 0 ? erode(dilate(u, w, h, closeR), w, h, closeR) : u;
}

// Extend a plan-unit outline (multiples of `g`) so every item box lies inside it (tolerance `tol`).
// Returns the same array when nothing is outside, else a new rectilinear ring.
export function extendOutline(outline, shapes, g = 5, tol = 3) {
  const inside = (p) => pointInPolygon(p, outline);
  const near = (x, y) => [[0, 0], [tol, 0], [-tol, 0], [0, tol], [0, -tol], [tol, tol], [-tol, -tol], [tol, -tol], [-tol, tol]].some(([dx, dy]) => inside([x + dx, y + dy]));
  // a shape is {x,y,w,h} or {points}: its corners (vertices) must be inside; a stray one adds its bbox
  const bad = shapes.filter((s) => !(s.points || [[s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h]]).every(([x, y]) => near(x, y))).map(boxOf);
  if (!bad.length) return outline;
  // a box with no contact to the outline would vanish as a separate blob: bridge it to the nearest outline point
  const touches = (b) => outline.some(([x, y]) => x >= b.x0 - g && x <= b.x1 + g && y >= b.y0 - g && y <= b.y1 + g)
    || [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].some(([x, y]) => near(x, y));
  for (const b of [...bad]) {
    if (touches(b)) continue;
    const n = nearestPointOnPolyline([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], outline, true);
    if (n) bad.push({ x0: Math.min(b.x0, n.x), y0: Math.min(b.y0, n.y), x1: Math.max(b.x1, n.x), y1: Math.max(b.y1, n.y) });
  }
  const all = [...outline.map(([x, y]) => ({ x0: x, y0: y, x1: x, y1: y })), ...bad];
  const X0 = Math.floor(Math.min(...all.map((b) => b.x0)) / g) - 1, Y0 = Math.floor(Math.min(...all.map((b) => b.y0)) / g) - 1;
  const W = Math.ceil(Math.max(...all.map((b) => b.x1)) / g) - X0 + 2, H = Math.ceil(Math.max(...all.map((b) => b.y1)) / g) - Y0 + 2;
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside([(X0 + x + 0.5) * g, (Y0 + y + 0.5) * g])) m[y * W + x] = 1;
  for (const b of bad) {
    for (let y = Math.floor(b.y0 / g) - Y0; y < Math.ceil(b.y1 / g) - Y0; y++) for (let x = Math.floor(b.x0 / g) - X0; x < Math.ceil(b.x1 / g) - X0; x++) m[y * W + x] = 1;
  }
  const ring = cellRing(m, W, H).map(([x, y]) => [(X0 + x) * g, (Y0 + y) * g]);
  return rectilinearRing(ring);
}

// Outer boundary (largest loop) of a cell mask as a ring of grid corners.
function cellRing(m, W, H) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] ? 1 : 0);
  const next = new Map();
  const add = (ax, ay, bx, by) => { const k = ax + ',' + ay; if (!next.has(k)) next.set(k, []); next.get(k).push([bx, by]); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y);
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) add(x, y + 1, x, y);
  }
  let best = [], bestA = 0;
  for (const [k, list] of next) {
    while (list.length) {
      const [sx, sy] = k.split(',').map(Number);
      const ring = [[sx, sy]];
      let cur = list.pop();
      while (cur && !(cur[0] === sx && cur[1] === sy)) {
        ring.push(cur);
        const l = next.get(cur[0] + ',' + cur[1]);
        cur = l && l.length ? l.pop() : null;
      }
      let a = 0;
      for (let i = 0; i < ring.length; i++) { const q = ring[(i + 1) % ring.length]; a += ring[i][0] * q[1] - q[0] * ring[i][1]; }
      if (cur && Math.abs(a) > bestA) { bestA = Math.abs(a); best = ring; }
    }
  }
  return best;
}

// collapse duplicates / collinear points of an axis-parallel ring
function rectilinearRing(pts) {
  const d = pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return p[0] !== q[0] || p[1] !== q[1]; });
  return d.filter((p, i) => {
    const a = d[(i + d.length - 1) % d.length], b = d[(i + 1) % d.length];
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
}
