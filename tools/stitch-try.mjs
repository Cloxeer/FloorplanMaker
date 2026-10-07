// tools/stitch-try.mjs: runs the stitcher in node on saved per-photo results: node tools/stitch-try.mjs tools/<dir>/<slug>.results.json
import { readFileSync } from 'node:fs';
import { alignPlans, mergePlans, placeBeside, compose } from '../js/model/stitch.js';
const results = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const plans = results.map((m, i) => ({ id: `photo ${i + 1}`, items: m.items, floor: m.floor, compass: (() => { const c = m.items.find((it) => it.type === 'compass'); return c ? { x: c.x, y: c.y, deg: c.deg } : null; })() }));
const { tfs, roots } = alignPlans(plans);
for (const root of roots.slice(1)) {
  const group = tfs.map((t, i) => (t.root === root ? i : -1)).filter((i) => i >= 0);
  const so = mergePlans(plans, tfs.map((t) => (t.root === 0 || t.final ? t : null))).items;
  const F = placeBeside(plans, group, tfs, so);
  for (const i of group) tfs[i] = { ...compose(F, tfs[i]), final: true, how: i === root ? F.how : tfs[i].how };
}
console.log(tfs.map((t, i) => `${i}: q${t.q} s${t.s.toFixed(2)} t(${Math.round(t.tx)},${Math.round(t.ty)}) ${t.how} n${t.n} root${t.root}`).join('\n'));
