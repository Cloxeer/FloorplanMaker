// tools/pieces.mjs: the pieces of one floor (the wings of a building, one finished project each) in ONE project, NOT joined.
//   node tools/pieces.mjs <out.floorplan.json> <building> <property> <floor> <slug> <name>=<wing.floorplan.json>...
// Nothing is guessed: every wing keeps its own plan and its own photo; they are only laid out in a row with a gap so none covers
// another (the same as AutoBuild does for several photos). Each item carries piece: "<name>". The person orients and combines the
// pieces afterwards (Layers: select / hide a piece, move and turn it as a group), then draws the outline (Auto-outline).
import { readFileSync, writeFileSync } from 'node:fs';
import { placeItem } from '../js/model/stitch.js';
import { photoCorners } from '../js/model/photos.js';

const [out, building, property, floor, slug, ...pairs] = process.argv.slice(2);
const wings = pairs.map((p) => { const i = p.indexOf('='); return { name: p.slice(0, i), project: JSON.parse(readFileSync(p.slice(i + 1), 'utf8')) }; });
const GAP = 200, MARGIN = 20;
let x = MARGIN;
const items = [], photos = [];
wings.forEach(({ name, project }, k) => {
  const doc = project.doc;
  // the wing's extent: its photo (plan units) and everything on the plan
  const w = Math.max(doc.viewBox.w, ...doc.items.map((it) => (it.points ? Math.max(...it.points.map((p) => p[0])) : (it.x || 0) + (it.w || 0))));
  const t = { q: 0, s: 1, tx: x, ty: MARGIN };
  for (const it of doc.items) items.push({ ...placeItem(it, t), piece: name });
  photos.push({ ...project.photo, t: { x, y: MARGIN, s: 1, a: 0 } });
  x += w + GAP;
});
let x1 = 0, y1 = 0;
for (const ph of photos) for (const [px, py] of photoCorners(ph)) { x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
for (const it of items) for (const [px, py] of it.points || [[(it.x || 0) + (it.w || 0), (it.y || 0) + (it.h || 0)]]) if (Number.isFinite(px)) { x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
const base = wings[0].project;
const doc = { ...base.doc, meta: { ...base.doc.meta, building, property, floor, slug }, viewBox: { x: 0, y: 0, w: Math.round(x1 + MARGIN), h: Math.round(y1 + MARGIN) }, items, floor: null };
const project = { ...base, slug, name: building, doc, photo: photos[0], extraPhotos: photos.slice(1).map(({ dataUrl, width, height, t }) => ({ dataUrl, width, height, t })), history: { past: [], future: [] } };
writeFileSync(out, JSON.stringify(project));
console.log(`wrote ${out}: ${wings.length} pieces (${wings.map((w) => w.name).join(', ')}), ${items.filter((i) => i.type === 'room').length} rooms, no outline`);
