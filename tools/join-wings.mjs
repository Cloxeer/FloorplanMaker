// tools/join-wings.mjs: joins finished plans of the pieces of one floor (the wings of a building, one project each) into one floor project.
//   node tools/join-wings.mjs <out.floorplan.json> <building> <property> <floor> <slug> <wing.floorplan.json>... [--force '[{"q":0,"s":1,"tx":0,"ty":0},...]']
// The pieces are joined exactly as AutoBuild joins several photos (js/model/stitch.js): shared room numbers, a corridor that runs from
// one piece into the next, else beside the rest. Prints how each piece was placed. With --force the placements are given by hand
// (one { q, s, tx, ty } per piece: quarter turns clockwise, scale, shift into the first piece's frame).
import { readFileSync, writeFileSync } from 'node:fs';
import { layoutPlans, mergePlans } from '../js/model/stitch.js';
import { photoCorners } from '../js/model/photos.js';
import { translateDoc } from '../js/model/photos.js';
import { isOnOutline } from '../js/model/geometry.js';

const args = process.argv.slice(2);
const fi = args.indexOf('--force');
const forced = fi >= 0 ? JSON.parse(args[fi + 1]) : null;
const pos = fi >= 0 ? args.slice(0, fi) : args;
const [out, building, property, floor, slug, ...files] = pos;
const projects = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
const plans = projects.map((p, i) => {
  const c = p.doc.items.find((it) => it.type === 'compass');
  return { id: files[i].split(/[\\/]/).pop(), items: p.doc.items, floor: p.doc.floor, compass: c ? { x: c.x, y: c.y, deg: c.deg } : null };
});
const { tfs, notes } = layoutPlans(plans, { forced });
tfs.forEach((t, i) => console.log(`${plans[i].id}: q${t.q} s${t.s.toFixed(2)} shift(${Math.round(t.tx)},${Math.round(t.ty)}) ${t.how}${t.n ? ' n' + t.n : ''}`));
notes.forEach((n) => console.log('NOTE', n));
const merged = mergePlans(plans, tfs);
console.log('dropped duplicates:', merged.report.dropped.join(' ') || 'none');

// the photos sit under the plan: a piece's photo is in that piece's plan units
const photos = projects.map((p, i) => ({ ...p.photo, t: { x: tfs[i].tx, y: tfs[i].ty, s: tfs[i].s, a: 90 * tfs[i].q } }));
let x0 = 0, y0 = 0;
for (const ph of photos) for (const [x, y] of photoCorners(ph)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
for (const it of merged.items) for (const [x, y] of it.points || [[it.x, it.y]]) if (Number.isFinite(x)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
const dx = x0 < 20 ? Math.ceil((20 - x0) / 5) * 5 : 0, dy = y0 < 20 ? Math.ceil((20 - y0) / 5) * 5 : 0;
const moved = translateDoc({ items: merged.items, floor: merged.floor }, dx, dy);
photos.forEach((ph) => { ph.t = { ...ph.t, x: ph.t.x + dx, y: ph.t.y + dy }; });
let x1 = 0, y1 = 0;
for (const ph of photos) for (const [x, y] of photoCorners(ph)) { x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
for (const it of moved.items) for (const [x, y] of it.points || [[it.x + (it.w || 0), it.y + (it.h || 0)]]) if (Number.isFinite(x)) { x1 = Math.max(x1, x); y1 = Math.max(y1, y); }

// exits are never moved: any that do not sit on the joined outline are only reported (they are listed so they can be placed by hand)
{
  const off = moved.items.filter((it) => it.type === 'door' && moved.floor && !isOnOutline({ x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2 }, moved.floor.points));
  if (off.length) console.log(`NOTE ${off.length} exit(s) are not on the joined outline (left where they are): ${off.map((d) => `(${d.x1},${d.y1})`).join(' ')}`);
}

const base = projects[0];
const meta = { building, property, floor, slug };
const doc = { ...base.doc, meta: { ...base.doc.meta, ...meta }, viewBox: { x: 0, y: 0, w: Math.round(x1), h: Math.round(y1) }, items: moved.items, floor: moved.floor };
const project = { ...base, slug, name: building, doc, photo: photos[0], extraPhotos: photos.slice(1).map(({ dataUrl, width, height, t }) => ({ dataUrl, width, height, t })), history: { past: [], future: [] } };
writeFileSync(out, JSON.stringify(project));
console.log(`wrote ${out}: ${moved.items.filter((i) => i.type === 'room').length} rooms`);
