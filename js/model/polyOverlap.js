// polyOverlap.js
// Exact overlap AREA of two plan shapes (rooms / stairs as point lists), used by the Layers panel and
// the overlap fixer so they agree. Rectilinear shapes are done on the grid of their own coordinates;
// shapes with diagonal edges are rasterised on a 1-unit lattice inside the boxes' intersection.
// (polygonsOverlap in geometry.js can call two shapes overlapping when one centroid falls in the
// other's notch, so it is not used here.)
// Depends on: js/model/geometry.js.

import { pointInPolygon, polygonsOverlap, bbox } from './geometry.js';

export const rectilinear = (pts) => pts.length >= 4 && pts.every((p, i) => { const q = pts[(i + 1) % pts.length]; return p[0] === q[0] || p[1] === q[1]; });

export function gridOf(polys) {
  const xs = [...new Set(polys.flatMap((p) => p.map((q) => q[0])))].sort((a, b) => a - b);
  const ys = [...new Set(polys.flatMap((p) => p.map((q) => q[1])))].sort((a, b) => a - b);
  return { xs, ys };
}
export function cellsIn(poly, g) {
  const nx = g.xs.length - 1, ny = g.ys.length - 1;
  const out = new Uint8Array(Math.max(0, nx * ny));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    out[j * nx + i] = pointInPolygon([(g.xs[i] + g.xs[i + 1]) / 2, (g.ys[j] + g.ys[j + 1]) / 2], poly) ? 1 : 0;
  }
  return out;
}

// Exact overlap area of two rectilinear shapes (null when either is not rectilinear).
export function overlapArea(pa, pb) {
  if (!rectilinear(pa) || !rectilinear(pb)) return null;
  const g = gridOf([pa, pb]);
  const nx = g.xs.length - 1;
  const A = cellsIn(pa, g), B = cellsIn(pb, g);
  let s = 0;
  for (let k = 0; k < A.length; k++) if (A[k] && B[k]) s += (g.xs[(k % nx) + 1] - g.xs[k % nx]) * (g.ys[((k / nx) | 0) + 1] - g.ys[(k / nx) | 0]);
  return s;
}

// Rasterise a polygon on the unit lattice of the box (x0,y0,W,H): cell centres inside it.
export function fillPoly(poly, x0, y0, W, H) {
  const m = new Uint8Array(W * H);
  const n = poly.length;
  for (let j = 0; j < H; j++) {
    const y = y0 + j + 0.5;
    const xs = [];
    for (let k = 0; k < n; k++) {
      const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % n];
      if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(0, Math.ceil(xs[k] - x0 - 0.5)); i < W && i + x0 + 0.5 < xs[k + 1]; i++) m[j * W + i] = 1;
    }
  }
  return m;
}


// Overlap area of two shapes, whatever their edges.
export function overlapAreaAny(pa, pb) {
  if (rectilinear(pa) && rectilinear(pb)) {
    const g = gridOf([pa, pb]);
    const nx = g.xs.length - 1;
    const A = cellsIn(pa, g), B = cellsIn(pb, g);
    let s = 0;
    for (let k = 0; k < A.length; k++) if (A[k] && B[k]) s += (g.xs[(k % nx) + 1] - g.xs[k % nx]) * (g.ys[((k / nx) | 0) + 1] - g.ys[(k / nx) | 0]);
    return s;
  }
  const A = bbox(pa), B = bbox(pb);
  const x0 = Math.floor(Math.max(A.x, B.x)), y0 = Math.floor(Math.max(A.y, B.y));
  const x1 = Math.ceil(Math.min(A.x + A.w, B.x + B.w)), y1 = Math.ceil(Math.min(A.y + A.h, B.y + B.h));
  const W = x1 - x0, H = y1 - y0;
  if (W <= 0 || H <= 0) return 0;
  if (W * H > 4e6) return polygonsOverlap(pa, pb) ? 1 : 0;
  const m1 = fillPoly(pa, x0, y0, W, H), m2 = fillPoly(pb, x0, y0, W, H);
  let n = 0;
  for (let k = 0; k < m1.length; k++) if (m1[k] && m2[k]) n++;
  return n;
}
