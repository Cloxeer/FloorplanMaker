import { readFileSync } from 'node:fs';
import { alignByShape, alignByLabels, compassTurn } from '../js/model/stitch.js';
const results = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const plans = results.map((m, i) => ({ id: `photo ${i + 1}`, items: m.items, floor: m.floor, compass: (() => { const c = m.items.find((it) => it.type === 'compass'); return c ? { x: c.x, y: c.y, deg: c.deg } : null; })() }));
plans.forEach((p, i) => console.log(i, 'compass', p.compass && p.compass.deg, 'rooms', p.items.filter((x) => x.type === 'room' && x.number).map((x) => x.number).join(' ')));
for (let i = 0; i < plans.length; i++) for (let j = 0; j < plans.length; j++) {
  if (i === j) continue;
  const ts = alignByShape(plans[i], plans[j]);
  console.log(i, '<-', j, 'turn', compassTurn(plans[i], plans[j]), JSON.stringify(ts.map((t) => ({ q: t.q, s: +t.s.toFixed(2), n: t.n, score: +t.score.toFixed(1), rms: +t.rms.toFixed(1) }))));
}
