// outlineTidy.js
// Taking corners out of the building outline without wrecking it, and cleaning it after any edit. Pure.
//   tidyRing(pts)              -> pts without repeated corners and without spikes (a corner where the wall turns straight back)
//   removeVertices(pts, idxs)  -> the outline with those corners gone and the wall closed over them: when the walls were all
//                                 square (the outline is rectilinear) the gap is closed with a square corner, never a slanted
//                                 line; a notch or jog taken out simply fills in. null when nothing sensible is left.
//   removeEdge(pts, i)         -> the same for a wall: its two corners go
// Depends on: ./fixOverlaps.js (cleanRing: is it a proper outline?).

import { cleanRing } from './fixOverlaps.js';

const EPS = 0.5; // plan units: closer than this is the same place / the same line
const same = (a, b) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
const isRing = (pts) => pts.length >= 3 && !!cleanRing(pts);

export function tidyRing(pts) {
  let r = pts.map((p) => [p[0], p[1]]), changed = true;
  while (changed && r.length > 3) {
    changed = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const a = r[(i + r.length - 1) % r.length], v = r[i], b = r[(i + 1) % r.length];
      const spike = Math.abs((v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0])) <= EPS * Math.max(1, Math.hypot(v[0] - a[0], v[1] - a[1]), Math.hypot(b[0] - v[0], b[1] - v[1])) // a, v, b on one line
        && (v[0] - a[0]) * (b[0] - v[0]) + (v[1] - a[1]) * (b[1] - v[1]) < 0; // and v is where it turns straight back
      if (same(v, a) || spike) { r.splice(i, 1); changed = true; i--; }
    }
  }
  return r;
}

const square = (pts) => pts.every((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.abs(p[0] - q[0]) <= EPS || Math.abs(p[1] - q[1]) <= EPS; });

// the new corners that join kept corner a to kept corner b over a stretch of removed ones (run: how many were removed)
function bridge(a, firstGone, b, run, rect) {
  if (!rect || Math.abs(a[0] - b[0]) <= EPS || Math.abs(a[1] - b[1]) <= EPS) return [];
  const vertical = Math.abs(a[0] - firstGone[0]) <= EPS; // the wall that arrived at the gap was running up / down
  if (run === 1) return [vertical ? [b[0], a[1]] : [a[0], b[1]]]; // one corner out: the opposite corner of its rectangle
  return [vertical ? [a[0], b[1]] : [b[0], a[1]]]; // a wall or more out: keep going the way the wall was running, then turn
}

// corners that are only there because a jog was: once the wall runs straight past them they go too (only the ones next to a removal)
function straighten(ring, near) {
  const r = ring.map((p) => [p[0], p[1]]);
  for (let i = 0; i < r.length && r.length > 3; i++) {
    const a = r[(i + r.length - 1) % r.length], v = r[i], b = r[(i + 1) % r.length];
    if (!near.has(`${v[0]},${v[1]}`)) continue;
    const cross = (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]), dot = (v[0] - a[0]) * (b[0] - v[0]) + (v[1] - a[1]) * (b[1] - v[1]);
    if (Math.abs(cross) <= EPS * Math.max(1, Math.hypot(v[0] - a[0], v[1] - a[1])) && dot > 0) { r.splice(i, 1); i--; }
  }
  return r;
}

function without(pts, gone, rect, exact) {
  const n = pts.length, out = [], near = new Set();
  for (let i = 0; i < n; i++) {
    if (!gone.has(i)) { out.push(pts[i]); continue; }
    if (gone.has((i + n - 1) % n)) continue; // inside a run: dealt with where it began
    let e = i; while (gone.has((e + 1) % n)) e++;
    const a = pts[(i + n - 1) % n], b = pts[(e + 1) % n];
    near.add(`${a[0]},${a[1]}`); near.add(`${b[0]},${b[1]}`);
    if (!exact) for (const q of bridge(a, pts[i], b, e - i + 1, rect)) { out.push(q); near.add(`${q[0]},${q[1]}`); }
  }
  return { out, near };
}

export function removeVertices(pts, idxs) {
  const n = pts.length, gone = new Set(idxs.map((i) => ((i % n) + n) % n));
  if (!gone.size || n - gone.size < 3) return null;
  const rect = square(pts);
  for (const exact of rect ? [false, true] : [true]) { // square corners first; if that is not an outline, straight across
    const { out, near } = without(pts, gone, rect, exact);
    const t = straighten(tidyRing(out), near);
    if (isRing(t)) return t;
  }
  return null;
}

export const removeEdge = (pts, i) => removeVertices(pts, [i, (i + 1) % pts.length]);
