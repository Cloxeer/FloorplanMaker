// tidyRooms.js
// Closes the small empty gaps left between rooms and the building wall, and between neighbouring
// rooms: every room edge that is within a few units of the outline wall snaps onto the wall, edges that
// almost line up with a neighbour's edge share one line, corners meet exactly, and everything lands on
// the 5-unit grid. Hallways and stairs snap to the same lines. A change is kept only if it does not
// create an overlap, does not push anything outside the outline and leaves no zero-size piece.
// Pure, deterministic and idempotent (running it twice changes nothing the second time).
// Depends on: js/model/geometry.js, js/model/polyOverlap.js, js/model/document.js, js/model/fixOverlaps.js (cleanRing).

import { roomPolygon } from './document.js';
import { bbox, pointInPolygon } from './geometry.js';
import { overlapAreaAny } from './polyOverlap.js';
import { cleanRing } from './fixOverlaps.js';

const G = 5;
const snapG = (v) => Math.round(v / G) * G;
const finite = (...v) => v.every((x) => Number.isFinite(x));
const kinds = new Set(['room', 'stair', 'hall']);

const polyOf = (it) => (it.type === 'stair' || it.type === 'hall' ? [[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]] : roomPolygon(it));
const usable = (it) => it && kinds.has(it.type) && ((it.shape === 'poly' && Array.isArray(it.points) && it.points.length >= 3 && it.points.every((p) => finite(p[0], p[1])))
  || (it.shape !== 'poly' && finite(it.x, it.y, it.w, it.h) && it.w > 0 && it.h > 0));

// 1-D snap map: anchors (outline walls) win; the rest cluster within `tol` and take the most common value
function buildMap(values, anchors, tol, reach = tol) {
  const map = new Map();
  const loose = [];
  for (const v of new Set(values)) {
    let best = null;
    for (const a of anchors) if (Math.abs(a - v) <= reach && (best == null || Math.abs(a - v) < Math.abs(best - v))) best = a;
    if (best != null) map.set(v, best); else loose.push(v);
  }
  const count = new Map();
  for (const v of values) count.set(v, (count.get(v) || 0) + 1);
  loose.sort((a, b) => a - b);
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    let mode = cur[0];
    for (const v of cur) if ((count.get(v) || 0) > (count.get(mode) || 0)) mode = v;
    const to = snapG(mode);
    for (const v of cur) map.set(v, to);
    cur = [];
  };
  for (const v of loose) {
    if (cur.length && v - cur[0] > tol) flush();
    cur.push(v);
  }
  flush();
  return map;
}

// Straighten a hand-or-photo-made polygon: collapse jogs shorter than `tol`, then make every edge that is
// nearly horizontal or vertical exactly so. Returns the new ring, or the old one when the result is not valid.
export function regularize(points, tol) {
  let r = points.map(([x, y]) => [x, y]);
  for (let pass = 0; pass < 4; pass++) {
    // collapse short edges to their midpoint
    for (let i = 0; i < r.length && r.length > 4; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < tol) {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        r[i] = mid; r.splice((i + 1) % r.length, 1); i--;
      }
    }
    // near-axis edges become axis edges
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const a = r[i], b = r[(i + 1) % n];
      const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
      if (dx === 0 || dy === 0) continue;
      if (dx <= Math.max(tol * 1.6, dy * 0.3) && dx < dy) { const v = (a[0] + b[0]) / 2; a[0] = v; b[0] = v; }
      else if (dy <= Math.max(tol * 1.6, dx * 0.3) && dy < dx) { const v = (a[1] + b[1]) / 2; a[1] = v; b[1] = v; }
    }
  }
  const ring = cleanRing(r.map(([x, y]) => [Math.round(x), Math.round(y)]));
  return ring && ring.length >= 3 ? ring : points;
}

function overlapKeys(list) {
  const boxes = list.map((it) => { const poly = polyOf(it); return { it, poly, b: bbox(poly) }; }).sort((p, q) => p.b.x - q.b.x);
  const keys = new Set();
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const c = boxes[j];
      if (c.b.x >= a.b.x + a.b.w) break;
      if (!(Math.min(a.b.y + a.b.h, c.b.y + c.b.h) > Math.max(a.b.y, c.b.y))) continue;
      const ta = a.it.type, tc = c.it.type;
      if (ta === 'hall' && tc === 'hall') continue; // hallways may touch/overlap each other (other fixers own that)
      if (ta === 'stair' && tc === 'stair') continue;
      const area = overlapAreaAny(a.poly, c.poly);
      // a hallway may graze a room by a couple of units (tight corridors); rooms/stairs may not overlap at all
      const limit = ta === 'hall' || tc === 'hall' ? 2 * Math.min(a.b.w, a.b.h, c.b.w, c.b.h, 1e9) : 0;
      if (area > limit) keys.add([a.it.id, c.it.id].sort().join('|'));
    }
  }
  return keys;
}

const inside = (outline, poly) => poly.every(([x, y]) => pointInPolygon([x, y], outline) || outline.some(([ox, oy], i) => {
  const [px, py] = outline[(i + 1) % outline.length];
  const cross = (px - ox) * (y - oy) - (py - oy) * (x - ox);
  return Math.abs(cross) <= 2 * Math.hypot(px - ox, py - oy) && x >= Math.min(ox, px) - 2 && x <= Math.max(ox, px) + 2 && y >= Math.min(oy, py) - 2 && y <= Math.max(oy, py) + 2;
}));

// -> { doc, changed: ids, notes: string[] }
export function tidyRooms(doc, opts) {
  const none = { doc, changed: [], notes: [] };
  if (!doc || !Array.isArray(doc.items)) return none;
  // pieces are matched by position, so plans whose items have no (or repeated) ids still work
  const orig = doc.items;
  const items = orig.map((it, i) => (it && typeof it === 'object' ? { ...it, id: `#${i}` } : it));
  const movable = items.filter(usable);
  const rooms = movable.filter((i) => i.type === 'room');
  if (rooms.length < 1) return none;
  const shorts = rooms.map((r) => { const b = bbox(polyOf(r)); return Math.min(b.w, b.h); }).sort((a, b) => a - b);
  const m = shorts[Math.floor(shorts.length / 2)];
  if (!(m > 0)) return none;
  const tol = (opts && opts.tol) || Math.max(5, Math.min(20, snapG(0.12 * m)));
  const outline = doc.floor && Array.isArray(doc.floor.points) && doc.floor.points.length >= 3 && doc.floor.points.every((p) => finite(p[0], p[1])) ? doc.floor.points : null;

  const ax = new Set(), ay = new Set();
  if (outline) outline.forEach(([x1, y1], i) => { const [x2, y2] = outline[(i + 1) % outline.length]; if (x1 === x2) ax.add(x1); if (y1 === y2) ay.add(y1); });
  const xs = [], ys = [];
  const reg = new Map(); // straightened polygon rings, by item id
  for (const it of movable) if (it.type === 'room' && it.shape === 'poly') reg.set(it.id, regularize(it.points, Math.max(5, Math.round(tol * 0.9))));
  for (const it of movable) {
    if (it.shape === 'poly' && it.type === 'room') for (const [x, y] of reg.get(it.id)) { xs.push(x); ys.push(y); }
    else { xs.push(it.x, it.x + it.w); ys.push(it.y, it.y + it.h); }
  }
  const reach = Math.max(tol, snapG(0.3 * m));
  const mx = buildMap(xs, ax, tol, reach), my = buildMap(ys, ay, tol, reach);

  const moved = new Map(); // id -> new item
  for (const it of movable) {
    let next = null;
    if (it.type === 'room' && it.shape === 'poly') {
      const ring = cleanRing(reg.get(it.id).map(([x, y]) => [mx.get(x), my.get(y)]));
      if (ring && ring.length >= 3 && JSON.stringify(ring) !== JSON.stringify(it.points)) next = { ...it, points: ring };
    } else {
      const x0 = mx.get(it.x), x1 = mx.get(it.x + it.w), y0 = my.get(it.y), y1 = my.get(it.y + it.h);
      if (x1 - x0 >= G && y1 - y0 >= G && (x0 !== it.x || y0 !== it.y || x1 - x0 !== it.w || y1 - y0 !== it.h)) next = { ...it, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (next) moved.set(it.id, next);
  }
  if (!moved.size) return none;
  // Keep a change only when it creates no new overlap and stays inside the outline. Greedy: smallest moves
  // first, each judged against the plan as it stands, so one blocked piece never blocks its neighbours.
  // Leftover slivers (unnamed, unnumbered, thinner than a quarter room) are junk the overlap fixer owns;
  // they never veto a tidy move.
  const sliver = (it) => it.type === 'room' && !it.number && !it.name && (() => { const q = bbox(polyOf(it)); return Math.min(q.w, q.h) < 0.25 * m; })();
  const solid = movable.filter((it) => !sliver(it));
  const shift = (it, nx) => { const p = bbox(polyOf(it)), q = bbox(polyOf(nx)); return Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.w - q.w) + Math.abs(p.h - q.h); };
  const byId = new Map(movable.map((it) => [it.id, it]));
  const live = new Map(moved);
  const why = [];
  const baseKeys = overlapKeys(solid);
  for (let round = 0; round < 40 && live.size; round++) {
    const keys = overlapKeys(solid.map((it) => live.get(it.id) || it));
    const bad = new Set();
    for (const k of keys) if (!baseKeys.has(k)) {
      why.push(k);
      const pair = k.split('|').filter((id) => live.has(id));
      if (pair.length && !k.split('|').some((id) => bad.has(id))) bad.add(pair.sort((p, q) => shift(byId.get(q), live.get(q)) - shift(byId.get(p), live.get(p)))[0]);
    }
    if (outline) for (const [id, nx] of live) if (inside(outline, polyOf(byId.get(id))) && !inside(outline, polyOf(nx))) bad.add(id);
    if (!bad.size) break;
    for (const id of bad) live.delete(id);
  }
  if (!live.size) return none;
  const out = orig.map((it, i) => (live.has(`#${i}`) ? (() => { const n = { ...live.get(`#${i}`) }; if (it.id === undefined) delete n.id; else n.id = it.id; return n; })() : it));
  const changed = [...live.keys()].map((k) => orig[+k.slice(1)].id).filter((x) => x != null);
  return {
    doc: { ...doc, items: out },
    changed,
    count: live.size,
    why,
    notes: [`Snapped ${live.size} ${live.size === 1 ? 'piece' : 'pieces'} to the walls, the corners and the 5-unit grid so no empty gaps are left`],
  };
}
