import { readFileSync } from 'node:fs';
const load = (d, s) => JSON.parse(readFileSync(`${d}/${s}.floorplan.json`, 'utf8')).doc;
const box = (it) => (it.points ? { x0: Math.min(...it.points.map((p) => p[0])), y0: Math.min(...it.points.map((p) => p[1])), x1: Math.max(...it.points.map((p) => p[0])), y1: Math.max(...it.points.map((p) => p[1])) } : { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h });
const ov = (a, b) => { const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)); return (w * h) / Math.max(1, Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))); };
let c = { found: 0, blankThere: 0, wrongNum: 0, none: 0 };
for (const s of ['hh-1', 'hh-2', 'gn-1', 'gn-2', 'bx-1', 'rh-1']) {
  const d = load('tools/final2', s), f = load('tools/final3', s);
  const dr = d.items.filter((i) => i.type === 'room');
  const out = [];
  for (const r of f.items.filter((i) => i.type === 'room' && i.number)) {
    const same = dr.find((x) => x.number === r.number);
    if (same) { c.found++; continue; }
    const cover = dr.filter((x) => ov(box(x), box(r)) > 0.5);
    if (cover.some((x) => !x.number)) { c.blankThere++; out.push(r.number + ':blank'); }
    else if (cover.length) { c.wrongNum++; out.push(`${r.number}:was ${cover.map((x) => x.number).join('/')}`); }
    else { c.none++; out.push(r.number + ':none'); }
  }
  console.log(s, out.join(' '));
}
console.log(c);
