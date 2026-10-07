import { readFileSync } from 'node:fs';
import { alignByShape, stackConflicts } from '../js/model/stitch.js';
const results = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const plans = results.map((m, i) => ({ id: `photo ${i + 1}`, items: m.items, floor: m.floor }));
const id = { q: 0, s: 1, tx: 0, ty: 0 };
const ts = alignByShape(plans[0], plans[1]);
for (const t of ts) console.log('q', t.q, 's', t.s.toFixed(2), 'n', t.n, 'conflicts', stackConflicts(plans[0], id, plans[1], t), 'rooms', plans[1].items.filter((i) => i.type === 'room').length);
