import { readFileSync } from 'node:fs';
import { alignByShape, compassTurn } from '../js/model/stitch.js';
const results = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const plans = results.map((m, i) => ({ id: `photo ${i + 1}`, items: m.items, floor: m.floor, compass: (() => { const c = m.items.find((it) => it.type === 'compass'); return c ? { x: c.x, y: c.y, deg: c.deg } : null; })() }));
for (const [i, j] of [[0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1]]) {
  const t = alignByShape(plans[i], plans[j]);
  console.log(i, '<-', j, 'compassTurn', compassTurn(plans[i], plans[j]), t ? JSON.stringify({ q: t.q, s: +t.s.toFixed(2), n: t.n, lab: t.labelled, score: +t.score.toFixed(1), rms: +t.rms.toFixed(1) }) : null);
}
