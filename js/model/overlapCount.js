// overlapCount.js
// Fast "how many overlapping pairs are there" for the red notification dot. Same rule as the Layers
// panel (overlaps.js): room vs room and room vs stair, exact area > 0 (touching edges do not count),
// but a sweep over the boxes first so a plan with thousands of rooms stays cheap.
// Pure. Depends on: js/model/document.js (roomPolygon), js/model/geometry.js (bbox), js/model/polyOverlap.js.

import { roomPolygon } from './document.js';
import { bbox } from './geometry.js';
import { overlapAreaAny } from './polyOverlap.js';

const polyOf = (it) => roomPolygon(it.type === 'stair' ? { ...it, shape: 'rect' } : it);

// -> { pairs: number, ids: Set<string> } of items that overlap something
export function countOverlaps(doc) {
  const items = ((doc && doc.items) || []).filter((i) => i && (i.type === 'room' || i.type === 'stair'));
  const boxes = [];
  for (const it of items) {
    let poly;
    try { poly = polyOf(it); } catch { continue; }
    if (!poly || poly.length < 3 || poly.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
    boxes.push({ it, poly, b: bbox(poly) });
  }
  boxes.sort((p, q) => p.b.x - q.b.x);
  let pairs = 0;
  const ids = new Set();
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const c = boxes[j];
      if (c.b.x >= a.b.x + a.b.w) break; // sorted by x: nothing further can touch
      if (a.it.type === 'stair' && c.it.type === 'stair') continue; // stairs vs stairs never count
      if (!(Math.min(a.b.y + a.b.h, c.b.y + c.b.h) > Math.max(a.b.y, c.b.y))) continue;
      if (overlapAreaAny(a.poly, c.poly) > 0) { pairs++; ids.add(a.it.id); ids.add(c.it.id); }
    }
  }
  return { pairs, ids };
}
