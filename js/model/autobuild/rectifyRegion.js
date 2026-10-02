// rectifyRegion.js
// Where the plan is in the photo, for rectify: the biggest cluster of LONG connected wall strokes on
// paper. Specks, wall texture, text (made of short pieces), thick frame rims and the plan-less
// parts of the photo (sidebar, caption, background) do not count and do not stretch the box.
// Pure; masks are Uint8Array 0/1 of the working image.
// Depends on: js/model/autobuild/raster.js.

import { dilate, erode, components } from './raster.js';

// Frame rims, sleeve edges and photo borders are thick dark bands; walls are thin strokes.
// Anything much thicker than a wall is removed so the plan's bounding box is not stretched to
// the frame. Kept as is when that would leave (almost) nothing, e.g. a plan drawn in solid walls.
export function withoutRims(ink, w, h) {
  const r = Math.max(3, Math.round(Math.max(w, h) / 250));
  const thick = dilate(erode(ink, w, h, r), w, h, r + 1);
  const out = ink.slice();
  let kept = 0, was = 0;
  for (let i = 0; i < out.length; i++) { was += ink[i]; if (thick[i]) out[i] = 0; kept += out[i]; }
  return kept > 500 && kept > 0.4 * was ? out : ink;
}

// Connected pieces of ink whose longest side is at least `minExtent` px. Broken lines (faint walls,
// a gradient, noise) are first joined across gaps of up to `join` px. Falls back to the ink itself
// when that leaves too little (a plan drawn in dotted or broken lines).
export function longPieces(ink, w, h, minExtent, join = 2) {
  const { labels, comps } = components(join > 0 ? dilate(ink, w, h, join) : ink, w, h, 1, true);
  const keep = new Uint8Array(comps.length + 1);
  let kept = 0, total = 0;
  const area = new Float64Array(comps.length + 1);
  for (let i = 0; i < ink.length; i++) if (ink[i] && labels[i]) area[labels[i]]++;
  for (const c of comps) {
    total += area[c.id];
    if (Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1 - 2 * join >= minExtent) { keep[c.id] = 1; kept += area[c.id]; }
  }
  if (kept < 500 || kept < 0.12 * total) return { mask: ink, long: false };
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) if (ink[i] && labels[i] && keep[labels[i]]) mask[i] = 1;
  return { mask, long: true };
}

// Box [x0, y0, x1, y1] (inclusive) of the mask pixels, ignoring the outermost `trim` share of the
// mask pixels on each side along each axis (a stray hair-thin line cannot stretch it).
export function trimmedBox(mask, w, h, trim = 0.004) {
  const cols = new Int32Array(w), rows = new Int32Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { cols[x]++; rows[y]++; total++; }
  if (!total) return null;
  const cut = Math.floor(total * trim);
  const edge = (a, n, fromEnd) => {
    let acc = 0;
    for (let k = 0; k < n; k++) {
      const i = fromEnd ? n - 1 - k : k;
      acc += a[i];
      if (acc > cut) return i;
    }
    return fromEnd ? n - 1 : 0;
  };
  return { x0: edge(cols, w, false), x1: edge(cols, w, true), y0: edge(rows, h, false), y1: edge(rows, h, true), total };
}

// Room-sized closed cells (free-paper areas of 0.0007..0.05 L^2 walled in on all sides) per stroke cluster.
// Walls are thickened a little first so small gaps in faint walls do not leak.
// Returns { counts: Map(clusterId -> count), cells: [{ comp, owner }], labels } (labels = free-space labelling).
function countRooms(strokes, labels, w, h, L) {
  const closed = dilate(strokes, w, h, 2);
  const free = new Uint8Array(w * h);
  for (let i = 0; i < free.length; i++) free[i] = closed[i] ? 0 : 1;
  const bg = components(free, w, h, 1);
  const aMin = 0.0007 * L * L, aMax = 0.05 * L * L;
  const out = new Map(), cells = [];
  for (const c of bg.comps) {
    if (c.area < aMin || c.area > aMax || c.x0 === 0 || c.y0 === 0 || c.x1 === w - 1 || c.y1 === h - 1) continue;
    // which cluster walls it in: the first wall pixel to its left along a row through the cell
    const y = Math.round(c.sy / c.area);
    let x = Math.round(c.sx / c.area), id = 0;
    while (x >= 0 && !(id = labels[y * w + x] * (closed[y * w + x] ? 1 : 0))) x--;
    if (id) { out.set(id, (out.get(id) || 0) + 1); cells.push({ comp: c.id, owner: id }); }
  }
  return { counts: out, cells, labels: bg.labels };
}

// A frame or sleeve line only touches or nearly touches the plan: it is its own connected piece of ink, and no
// room-sized cell is walled in by it. Keeps the connected pieces that border a room cell of this cluster, plus the
// pieces within 12 px of those (a wall broken by a gap), and drops the rest, so such a line cannot stretch the box.
// Unchanged when that would leave too little (a plan whose rooms are all open). Returns the remaining ink count.
function keepRoomPieces(mask, holes, ids, w, h) {
  const mine = new Set(holes.cells.filter((c) => ids.has(c.owner)).map((c) => c.comp));
  const cells = new Uint8Array(w * h);
  for (let i = 0; i < cells.length; i++) if (holes.labels[i] && mine.has(holes.labels[i])) cells[i] = 1;
  const near = dilate(cells, w, h, 4);
  const { labels, comps } = components(dilate(mask, w, h, 3), w, h, 1, true);
  const seed = new Uint8Array(comps.length + 1);
  let total = 0;
  for (let i = 0; i < mask.length; i++) { total += mask[i]; if (mask[i] && near[i] && labels[i]) seed[labels[i]] = 1; }
  const seedMask = new Uint8Array(w * h);
  for (let i = 0; i < seedMask.length; i++) if (labels[i] && seed[labels[i]]) seedMask[i] = 1;
  const grown = dilate(seedMask, w, h, 12);
  const keep = new Uint8Array(comps.length + 1);
  for (let i = 0; i < mask.length; i++) if (mask[i] && labels[i] && (seed[labels[i]] || grown[i])) keep[labels[i]] = 1;
  let kept = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && labels[i] && keep[labels[i]]) kept++;
  if (kept < 300 || kept < 0.5 * total) return total;
  for (let i = 0; i < mask.length; i++) if (mask[i] && !(labels[i] && keep[labels[i]])) mask[i] = 0;
  return kept;
}

// Finds the plan. `ink` = ink on paper (layers.inkOnPaper). Returns
// { box, mask (the wall strokes inside the plan cluster), count, long, rooms (room-sized closed cells found) } or null.
export function findPlanRegion(ink, w, h) {
  const L = Math.max(w, h);
  const base = withoutRims(ink, w, h);
  const { mask: strokes, long } = longPieces(base, w, h, Math.round(0.05 * L));
  let count = 0;
  for (let i = 0; i < strokes.length; i++) count += strokes[i];
  if (count < 500) return null;
  // the plan = the biggest cluster of strokes (pieces closer than `bridge` belong together) plus the
  // plan-like clusters next to it (a corridor of arrows or symbols can cut a plan in two)
  const bridge = Math.max(4, Math.round(L / 90));
  const clustered = components(dilate(strokes, w, h, bridge), w, h, 1);
  const byId = new Map(clustered.comps.map((c) => [c.id, c]));
  const sums = new Float64Array(clustered.comps.length + 1), inner = new Float64Array(clustered.comps.length + 1);
  // plan-like = strokes also in the INTERIOR of the cluster's box (rooms, partitions); a frame, a sleeve edge
  // or a lone line has its strokes along the box border only
  const margin = new Map(clustered.comps.map((c) => [c.id, Math.max(8, 0.12 * Math.min(c.x1 - c.x0, c.y1 - c.y0))]));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, id = clustered.labels[i];
    if (!strokes[i] || !id) continue;
    sums[id]++;
    const c = byId.get(id), m = margin.get(id);
    if (x >= c.x0 + m && x <= c.x1 - m && y >= c.y0 + m && y <= c.y1 - m) inner[id]++;
  }
  const holes = countRooms(strokes, clustered.labels, w, h, L);
  const info = clustered.comps.map((c) => ({ c, n: sums[c.id], holes: holes.counts.get(c.id) || 0, fill: Math.min(c.x1 - c.x0, c.y1 - c.y0) < 0.08 * L ? 0 : inner[c.id] / Math.max(1, sums[c.id]) }))
    .sort((a, b) => (b.holes >= 3 ? b.holes : 0) - (a.holes >= 3 ? a.holes : 0) || b.n - a.n);
  const main = info[0];
  // many enclosed room-sized cells = a plan; failing that (big rooms, broken walls) strokes in the box interior
  if (!main || (main.holes < 3 && main.fill < 0.12)) return null;
  const merged = [main];
  const ub = { x0: main.c.x0, y0: main.c.y0, x1: main.c.x1, y1: main.c.y1 };
  const gapTo = (c) => Math.hypot(Math.max(0, ub.x0 - c.x1, c.x0 - ub.x1), Math.max(0, ub.y0 - c.y1, c.y0 - ub.y1));
  const m0 = { ...ub };
  for (let again = true; again;) {
    again = false;
    for (const o of info) {
      if (merged.includes(o) || o.n < 0.1 * main.n || o.holes < 1 || gapTo(o.c) > 0.07 * L) continue;
      // a cluster around the plan is a frame or sleeve, not part of it
      if (o.c.x0 <= m0.x0 + 4 && o.c.y0 <= m0.y0 + 4 && o.c.x1 >= m0.x1 - 4 && o.c.y1 >= m0.y1 - 4) continue;
      merged.push(o); again = true;
      ub.x0 = Math.min(ub.x0, o.c.x0); ub.y0 = Math.min(ub.y0, o.c.y0); ub.x1 = Math.max(ub.x1, o.c.x1); ub.y1 = Math.max(ub.y1, o.c.y1);
    }
  }
  const ids = new Set(merged.map((m) => m.c.id));
  const mask = new Uint8Array(w * h);
  let n = 0;
  for (let y = ub.y0; y <= ub.y1; y++) for (let x = ub.x0; x <= ub.x1; x++) {
    const i = y * w + x;
    if (strokes[i] && ids.has(clustered.labels[i])) { mask[i] = 1; n++; }
  }
  n = keepRoomPieces(mask, holes, ids, w, h);
  if (n < 400) return null;
  const box = trimmedBox(mask, w, h);
  return { box, mask, count: n, long, rooms: main.holes, clusters: info.slice(0, 8).map((o) => ({ n: o.n, holes: o.holes, fill: +o.fill.toFixed(2), box: [o.c.x0, o.c.y0, o.c.x1, o.c.y1], merged: ids.has(o.c.id) })) };
}
