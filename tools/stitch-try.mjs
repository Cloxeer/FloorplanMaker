// tools/stitch-try.mjs: runs the stitcher in node on saved per-photo results (tools/*/<slug>.results.json)
import { readFileSync } from 'node:fs';
import { alignPlans, mergePlans, placeBeside, compose } from '../js/model/stitch.js';
const results = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const plans = results.map((m, i) => ({ id: `photo ${i + 1}`, items: m.items, floor: m.floor, w: m.viewW, h: m.viewH, compass: (() => { const c = m.items.find((it) => it.type === 'compass'); return c ? { x: c.x, y: c.y, deg: c.deg } : null; })() }));
console.time('align');
const { tfs, roots } = alignPlans(plans);
console.timeEnd('align');
console.log(JSON.stringify(tfs), roots);
const so = mergePlans(plans, tfs.map((t) => (t.root === 0 ? t : null))).items;
console.log('so', so.length);
const group = tfs.map((t, i) => (t.root === 1 ? i : -1)).filter((i) => i >= 0);
const F = placeBeside(plans, group, tfs, so);
console.log('F', JSON.stringify(F));
for (const i of group) tfs[i] = { ...compose(F, tfs[i]), final: true };
console.time('merge');
const m = mergePlans(plans, tfs);
console.timeEnd('merge');
console.log(m.items.length, JSON.stringify(m.floor).slice(0, 200), JSON.stringify(m.report));
