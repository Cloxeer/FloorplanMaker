// faces.js
// Turns the ink raster of a straightened plan into closed "faces": rooms,
// corridors and the outside, plus the building footprint polygon.
// Pure. Depends on: js/model/autobuild/raster.js.

import { dilate, erode, components } from './raster.js';

// Moore-neighbour trace of the outer boundary of the largest blob in `mask`.
export function traceOuter(mask, w, h) {
  let start = -1;
  for (let i = 0; i < w * h; i++) if (mask[i]) { start = i; break; }
  if (start < 0) return [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] ? 1 : 0);
  const sx = start % w, sy = (start / w) | 0;
  const pts = [[sx, sy]];
  let x = sx, y = sy, d = 6; // came from the north (we scan row-major, so north is empty)
  for (let guard = 0; guard < w * h * 4; guard++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (d + 6 + k) % 8; // start looking just after backtracking direction
      const nx = x + dirs[nd][0], ny = y + dirs[nd][1];
      if (at(nx, ny)) { x = nx; y = ny; d = nd; found = true; break; }
    }
    if (!found) break;
    if (x === sx && y === sy) break;
    pts.push([x, y]);
  }
  return pts;
}

// Douglas-Peucker on a closed ring.
export function simplifyRing(pts, eps) {
  if (pts.length < 4) return pts;
  // split ring at the two farthest points
  let a = 0, b = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; b = i; }
  }
  const dp = (list) => {
    if (list.length < 3) return list;
    const [x1, y1] = list[0], [x2, y2] = list[list.length - 1];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    let idx = 0, md = -1;
    for (let i = 1; i < list.length - 1; i++) {
      const d = Math.abs((list[i][0] - x1) * dy - (list[i][1] - y1) * dx) / len;
      if (d > md) { md = d; idx = i; }
    }
    if (md <= eps) return [list[0], list[list.length - 1]];
    return dp(list.slice(0, idx + 1)).slice(0, -1).concat(dp(list.slice(idx)));
  };
  const first = pts.slice(a, b + 1), second = pts.slice(b).concat([pts[0]]);
  return dp(first).slice(0, -1).concat(dp(second).slice(0, -1));
}

// Snap near-axis edges of a ring exactly to the axes, re-meeting corners.
export function orthogonalize(ring, tolDeg = 7) {
  const n = ring.length;
  if (n < 4) return ring;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
    const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    const a = ((ang % 180) + 180) % 180;
    let kind = 'o';
    if (a < tolDeg || a > 180 - tolDeg) kind = 'h';
    else if (Math.abs(a - 90) < tolDeg) kind = 'v';
    lines.push({ kind, x1, y1, x2, y2, len: Math.hypot(x2 - x1, y2 - y1) });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = lines[(i + n - 1) % n], q = lines[i];
    const [px, py] = ring[i];
    const fix = (L, ax) => (L.kind === 'h' ? { h: (L.y1 + L.y2) / 2 } : L.kind === 'v' ? { v: (L.x1 + L.x2) / 2 } : null);
    const fp = fix(p), fq = fix(q);
    let x = px, y = py;
    if (fp && fq) {
      if (fp.h !== undefined && fq.v !== undefined) { x = fq.v; y = fp.h; }
      else if (fp.v !== undefined && fq.h !== undefined) { x = fp.v; y = fq.h; }
      else if (fp.h !== undefined) y = fp.h; else x = fp.v;
    } else if (fp) { if (fp.h !== undefined) y = fp.h; else x = fp.v; }
    else if (fq) { if (fq.h !== undefined) y = fq.h; else x = fq.v; }
    out.push([x, y]);
  }
  // drop duplicate / collinear points
  const clean = [];
  for (let i = 0; i < out.length; i++) {
    const a = clean[clean.length - 1] || out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
    if (Math.abs(b[0] - a[0]) < 0.5 && Math.abs(b[1] - a[1]) < 0.5) continue;
    if ((Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5) || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5)) continue;
    clean.push(b);
  }
  return clean.length >= 3 ? clean : ring;
}

// Cluster 1-D values (gap <= tol) and return a function mapping v -> cluster mean.
export function clusterSnap(values, tol) {
  const s = values.slice().sort((a, b) => a - b);
  const map = new Map();
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const m = group.reduce((t, v) => t + v, 0) / group.length;
    for (const v of group) map.set(v, m);
    group = [];
  };
  for (const v of s) {
    if (group.length && v - group[group.length - 1] > tol) flush();
    group.push(v);
  }
  flush();
  return (v) => (map.has(v) ? map.get(v) : v);
}

// Building footprint: close the wall linework with a big dilation, fill what
// is enclosed, shrink back. Sides where the plan is cut off by the photo edge
// count as walls so the cut rooms are still "inside".
export function footprint(layers, w, h, L) {
  const R = Math.max(6, Math.round(L / 52));
  const wallish = new Uint8Array(w * h);
  for (let i = 0; i < wallish.length; i++) wallish[i] = (layers.paper[i] && (layers.wallInk || layers.ink)[i]) || layers.seal[i] ? 1 : 0;
  const band = 3;
  const cut = { t: 0, b: 0, l: 0, r: 0 };
  for (let x = 0; x < w; x++) for (let k = 0; k < band; k++) { cut.t += wallish[k * w + x]; cut.b += wallish[(h - 1 - k) * w + x]; }
  for (let y = 0; y < h; y++) for (let k = 0; k < band; k++) { cut.l += wallish[y * w + k]; cut.r += wallish[y * w + w - 1 - k]; }
  const wallSeal = wallish.slice();
  const sealed = [];
  if (cut.t > 0.05 * w * band) { sealed.push('top'); for (let x = 0; x < w; x++) wallSeal[x] = 1; }
  if (cut.b > 0.05 * w * band) { sealed.push('bottom'); for (let x = 0; x < w; x++) wallSeal[(h - 1) * w + x] = 1; }
  if (cut.l > 0.05 * h * band) { sealed.push('left'); for (let y = 0; y < h; y++) wallSeal[y * w] = 1; }
  if (cut.r > 0.05 * h * band) { sealed.push('right'); for (let y = 0; y < h; y++) wallSeal[y * w + w - 1] = 1; }
  const grown = dilate(wallSeal, w, h, R);
  const free = new Uint8Array(w * h);
  for (let i = 0; i < free.length; i++) free[i] = grown[i] ? 0 : 1;
  const { labels, comps } = components(free, w, h, 1);
  const outsideIds = new Set();
  const mark = (i) => { if (labels[i]) outsideIds.add(labels[i]); };
  for (let x = 0; x < w; x++) { mark(x); mark((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { mark(y * w); mark(y * w + w - 1); }
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < filled.length; i++) filled[i] = outsideIds.has(labels[i]) ? 0 : 1;
  const shrunk = erode(filled, w, h, R);
  const smooth = dilate(erode(shrunk, w, h, Math.max(2, R >> 1)), w, h, Math.max(2, R >> 1));
  const blobs = components(smooth, w, h, 1);
  blobs.comps.sort((a, b) => b.area - a.area);
  const mask = new Uint8Array(w * h);
  if (blobs.comps.length) {
    const id = blobs.comps[0].id;
    for (let i = 0; i < mask.length; i++) mask[i] = blobs.labels[i] === id ? 1 : 0;
  }
  return { mask, sealed, R };
}

// layers: from layers.js analyze(). Returns { faces, labels, foot, wallMask }.
export function extractFaces(img, layers, opts = {}) {
  const { width: w, height: h } = img;
  const L = Math.max(w, h);
  const foot = opts.foot || footprint(layers, w, h, L);
  const barrier = new Uint8Array(w * h);
  for (let i = 0; i < barrier.length; i++) barrier[i] = (layers.wallInk || layers.ink)[i] | layers.colored[i] | layers.seal[i];
  // an image edge that cuts the plan acts as a wall
  const closeR = opts.closeR != null ? opts.closeR : 1;
  const wall = dilate(barrier, w, h, closeR);
  const free = new Uint8Array(w * h);
  for (let i = 0; i < free.length; i++) free[i] = !wall[i] && foot.mask[i] ? 1 : 0;
  for (const side of foot.sealed) {
    if (side === 'top') for (let x = 0; x < w; x++) free[x] = 0;
    if (side === 'bottom') for (let x = 0; x < w; x++) free[(h - 1) * w + x] = 0;
    if (side === 'left') for (let y = 0; y < h; y++) free[y * w] = 0;
    if (side === 'right') for (let y = 0; y < h; y++) free[y * w + w - 1] = 0;
  }
  const { labels, comps } = components(free, w, h, 1);
  const faces = comps.map((c) => ({
    id: c.id, area: c.area, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1,
    cx: c.sx / c.area, cy: c.sy / c.area,
    fill: c.area / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1)),
  }));
  return { faces, labels, footMask: foot.mask, wallMask: wall, outsideIds: new Set(), sealed: foot.sealed };
}
