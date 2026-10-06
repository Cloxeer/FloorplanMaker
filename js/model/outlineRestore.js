// outlineRestore.js
// Getting the building outline back after it was deleted. Pure.
//  rememberOutline(doc)        -> memory: the outline plus where each room / hall / stair sat when it existed
//  restoreOutline(memory, doc) -> { points, how } the old outline carried to wherever the pieces are now
//                                 (they may have been moved or turned since), then widened so nothing pokes out
//  autoOutline(doc)            -> { points } a fresh outline drawn round the pieces that are there now
//  snapDoorsTo(doc, points)    -> doc with doors that sat on the old wall brought onto the new one
// Depends on: ./geometry.js, ./document.js (doorFor), ./autobuild/outline.js, ./autobuild/raster.js.

import { pointInPolygon, nearestPointOnPolyline } from './geometry.js';
import { doorFor } from './document.js';
import { extendOutline, cellRing, rectilinearRing } from './autobuild/outline.js';
import { dilate, erode } from './autobuild/raster.js';

const SOLID = new Set(['room', 'hall', 'stair']);
const G = 5;
const ok = (v) => Number.isFinite(v);

const hasRing = (pts) => Array.isArray(pts) && pts.length >= 3 && pts.every((p) => Array.isArray(p) && ok(p[0]) && ok(p[1]));
export const hasOutline = (doc) => !!(doc && doc.floor && hasRing(doc.floor.points));

function boxOf(it) {
  if (it.shape === 'poly' && Array.isArray(it.points)) {
    const xs = it.points.map((p) => p[0]), ys = it.points.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}
const centreOf = (it) => { const b = boxOf(it); return [b.x + b.w / 2, b.y + b.h / 2]; };
const solids = (doc) => (doc.items || []).filter((it) => SOLID.has(it.type) && (it.shape === 'poly' ? Array.isArray(it.points) : [it.x, it.y, it.w, it.h].every(ok)));
const shapeOf = (it) => (it.shape === 'poly' ? { points: it.points } : { x: it.x, y: it.y, w: it.w, h: it.h });

// ---- remember
export function rememberOutline(doc) {
  if (!hasOutline(doc)) return null;
  return {
    points: doc.floor.points.map((p) => [p[0], p[1]]),
    marks: solids(doc).map((it) => ({ id: it.id, c: centreOf(it) })),
  };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const spin = (x, y, q, cx, cy) => {
  const dx = x - cx, dy = y - cy;
  return q === 1 ? [cx - dy, cy + dx] : q === 2 ? [cx - dx, cy - dy] : q === 3 ? [cx + dy, cy - dx] : [x, y];
};

// How the pieces that are still there moved since the outline was remembered: a quarter-turn count and a
// shift, found robustly (medians), so a few pieces moved one by one do not drag the answer along.
function motionOf(pairs) {
  if (!pairs.length) return { q: 0, dx: 0, dy: 0, err: 0, n: 0 };
  const mx = pairs.reduce((s, p) => s + p.old[0], 0) / pairs.length;
  const my = pairs.reduce((s, p) => s + p.old[1], 0) / pairs.length;
  let best = null;
  for (const q of [0, 1, 2, 3]) {
    const mapped = pairs.map((p) => spin(p.old[0], p.old[1], q, mx, my));
    const dx = median(pairs.map((p, i) => p.now[0] - mapped[i][0]));
    const dy = median(pairs.map((p, i) => p.now[1] - mapped[i][1]));
    const err = median(pairs.map((p, i) => Math.hypot(p.now[0] - mapped[i][0] - dx, p.now[1] - mapped[i][1] - dy)));
    // a turn has to be clearly better than none (and there must be 2+ pieces to see a turn at all)
    const better = !best || (q !== 0 && pairs.length >= 2 && err + 15 < best.err && err < best.err * 0.6);
    if (better) best = { q, dx, dy, err, mx, my };
  }
  return { ...best, n: pairs.length };
}

// ---- restore
export function restoreOutline(memory, doc) {
  if (!memory || !hasRing(memory.points) || !doc) return null;
  const now = new Map(solids(doc).map((it) => [it.id, it]));
  const pairs = (memory.marks || []).filter((m) => now.has(m.id)).map((m) => ({ old: m.c, now: centreOf(now.get(m.id)) }));
  const mo = motionOf(pairs);
  let pts = memory.points.map(([x, y]) => {
    const [sx, sy] = spin(x, y, mo.q, mo.mx || 0, mo.my || 0);
    return [Math.round(sx + mo.dx), Math.round(sy + mo.dy)];
  });
  const shifted = !!(mo.q || Math.abs(mo.dx) > 0.5 || Math.abs(mo.dy) > 0.5);
  const shapes = solids(doc).map(shapeOf);
  const widened = shapes.length ? extendOutline(pts, shapes, G, 3) : pts;
  const grew = widened !== pts;
  if (grew) pts = widened;
  if (!hasRing(pts)) return null;
  if (!holdsAll(pts, shapes)) { // widening could not reach a far-off piece: draw a fresh outline round everything
    const fresh = autoOutline(doc);
    if (fresh && holdsAll(fresh.points, shapes)) return { points: fresh.points, how: 'refit', turned: mo.q, dx: Math.round(mo.dx), dy: Math.round(mo.dy) };
  }
  return { points: pts, how: grew ? 'refit' : shifted ? 'moved' : 'same', turned: mo.q, dx: Math.round(mo.dx), dy: Math.round(mo.dy) };
}

// every piece's middle lies inside the ring
const holdsAll = (ring, shapes) => shapes.every((s) => {
  const c = s.points ? [s.points.reduce((a, p) => a + p[0], 0) / s.points.length, s.points.reduce((a, p) => a + p[1], 0) / s.points.length] : [s.x + s.w / 2, s.y + s.h / 2];
  return pointInPolygon(c, ring);
});

// Join separate blobs of a 0/1 mask to the biggest one with a thick L-shaped corridor, so a far-off piece
// becomes part of the outline instead of being dropped.
export function joinBlobs(m, W, H) {
  const lab = new Int32Array(W * H);
  const blobs = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || lab[i]) continue;
    const id = blobs.length + 1, cells = [];
    const stack = [i]; lab[i] = id;
    while (stack.length) {
      const c = stack.pop(); cells.push(c);
      const x = c % W, y = (c - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (m[k] && !lab[k]) { lab[k] = id; stack.push(k); }
      }
    }
    blobs.push(cells);
  }
  if (blobs.length < 2) return m;
  blobs.sort((a, b) => b.length - a.length);
  const out = Uint8Array.from(m);
  const main = blobs[0];
  for (const cells of blobs.slice(1)) {
    const mid = cells[(cells.length / 2) | 0], mx = mid % W, my = (mid - mx) / W;
    let best = main[0], bd = Infinity;
    for (const c of main) { const x = c % W, y = (c - x) / W, d = Math.abs(x - mx) + Math.abs(y - my); if (d < bd) { bd = d; best = c; } }
    const bx = best % W, by = (best - bx) / W;
    const dot = (x, y) => { for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (x + dx < W && y + dy < H) out[(y + dy) * W + x + dx] = 1; };
    for (let x = Math.min(mx, bx); x <= Math.max(mx, bx); x++) dot(x, my);
    for (let y = Math.min(my, by); y <= Math.max(my, by); y++) dot(bx, y);
  }
  return out;
}

// ---- a new outline from what is on the plan
export function autoOutline(doc, g = G) {
  const shapes = solids(doc).map(shapeOf);
  if (!shapes.length) return null;
  const close = 3; // cells: gaps up to ~15 units between neighbouring rooms are bridged
  const boxes = shapes.map((s) => (s.points
    ? { x0: Math.min(...s.points.map((p) => p[0])), y0: Math.min(...s.points.map((p) => p[1])), x1: Math.max(...s.points.map((p) => p[0])), y1: Math.max(...s.points.map((p) => p[1])) }
    : { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h }));
  const pad = close + 3;
  const X0 = Math.floor(Math.min(...boxes.map((b) => b.x0)) / g) - pad, Y0 = Math.floor(Math.min(...boxes.map((b) => b.y0)) / g) - pad;
  const W = Math.ceil(Math.max(...boxes.map((b) => b.x1)) / g) - X0 + pad, H = Math.ceil(Math.max(...boxes.map((b) => b.y1)) / g) - Y0 + pad;
  if (W * H > 4e6) return null; // a plan this spread out has something wrong with it
  let m = new Uint8Array(W * H);
  shapes.forEach((s, i) => {
    const b = boxes[i];
    const cx0 = Math.max(0, Math.floor(b.x0 / g) - X0), cx1 = Math.min(W - 1, Math.ceil(b.x1 / g) - X0 - 1);
    const cy0 = Math.max(0, Math.floor(b.y0 / g) - Y0), cy1 = Math.min(H - 1, Math.ceil(b.y1 / g) - Y0 - 1);
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      if (!s.points || pointInPolygon([(X0 + x + 0.5) * g, (Y0 + y + 0.5) * g], s.points)) m[y * W + x] = 1;
    }
  });
  m = joinBlobs(erode(dilate(m, W, H, close), W, H, close), W, H);
  const ring = rectilinearRing(cellRing(m, W, H).map(([x, y]) => [(X0 + x) * g, (Y0 + y) * g]));
  if (!hasRing(ring)) return null;
  // anything that did not join the main body (a far-off room) is bridged in
  const points = extendOutline(ring, shapes, g, 3);
  return { points: hasRing(points) ? points : ring };
}

// ---- doors
// A door that sat on the old wall but is not on the new outline moves to the nearest point of it
// (when that is close). Doors already on the outline are left alone.
export function snapDoorsTo(doc, points, reach = 80) {
  if (!hasRing(points)) return doc;
  let changed = false;
  const items = doc.items.map((it) => {
    if (it.type !== 'door' || ![it.x1, it.y1, it.x2, it.y2].every(ok)) return it;
    const mid = { x: (it.x1 + it.x2) / 2, y: (it.y1 + it.y2) / 2 };
    const near = nearestPointOnPolyline([mid.x, mid.y], points, true);
    if (!near || near.dist <= 2 || near.dist > reach) return it;
    const d = doorFor(points, mid);
    if (!d) return it;
    changed = true;
    return { ...it, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, label: d.label };
  });
  return changed ? { ...doc, items } : doc;
}
