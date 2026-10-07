import { readFileSync } from 'node:fs';
import { pointInPolygon } from '../js/model/geometry.js';
const G = 5;
const load = (d, s) => JSON.parse(readFileSync(`${d}/${s}.floorplan.json`, 'utf8')).doc;
const rows = [];
for (const s of ['hh-1', 'hh-2', 'gn-1', 'gn-2', 'bx-1', 'rh-1']) {
  const d = load('tools/final2', s), f = load('tools/final3', s);
  const rooms = d.items.filter((i) => i.type === 'room' && i.cls !== 'void');
  const truthHalls = f.items.filter((i) => i.type === 'hall');
  const inBox = (b, x, y) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  for (const h of d.items.filter((i) => i.type === 'hall')) {
    let n = 0, inRoom = 0, inTruth = 0, inOut = 0;
    for (let y = h.y + G / 2; y < h.y + h.h; y += G) for (let x = h.x + G / 2; x < h.x + h.w; x += G) {
      n++;
      if (rooms.some((r) => (r.points ? pointInPolygon([x, y], r.points) : inBox(r, x, y)))) inRoom++;
      if (truthHalls.some((t) => inBox(t, x, y))) inTruth++;
      if (d.floor && pointInPolygon([x, y], d.floor.points)) inOut++;
    }
    rows.push({ s, w: h.w, h: h.h, room: +(inRoom / n).toFixed(2), truth: +(inTruth / n).toFixed(2), out: +(inOut / n).toFixed(2) });
  }
}
console.table(rows);
