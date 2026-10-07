// tools/finalize.mjs: writes the finished floors into the maps folder, the way the app's folder mode and Export do:
//   <maps>/data_floors_<slug>.svg                 the finished map of each floor (what Export writes as data/floors/<slug>.svg)
//   <maps>/<Building name>/building.json          { building, property }
//   <maps>/<Building name>/<slug>.floorplan.json  the editable project of each floor (open it in the studio)
//   node tools/finalize.mjs <mapsDir> <slug>=<path to .floorplan.json> ...   (a slug may be renamed: <newSlug>=<path>)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { exportSvg } from '../js/model/svgExport.js';
import { buildingFolderName } from '../js/model/building.js';
import { validate } from '../js/model/validate.js';

const [mapsDir, ...pairs] = process.argv.slice(2);
const done = new Set();
for (const pair of pairs) {
  const [slug, file] = pair.split('=');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  project.slug = slug;
  project.doc = { ...project.doc, meta: { ...project.doc.meta, slug } };
  const dir = `${mapsDir}/${buildingFolderName(project.doc.meta.building)}`;
  mkdirSync(dir, { recursive: true });
  if (!done.has(dir)) { writeFileSync(`${dir}/building.json`, JSON.stringify({ building: project.doc.meta.building, property: project.doc.meta.property })); done.add(dir); }
  writeFileSync(`${dir}/${slug}.floorplan.json`, JSON.stringify(project));
  writeFileSync(`${mapsDir}/data_floors_${slug}.svg`, exportSvg(project.doc));
  const v = validate(project.doc);
  console.log(`${slug}: ${project.doc.items.filter((i) => i.type === 'room' && i.number).length} numbered rooms, ${v.filter((x) => x.level === 'error').length} errors, ${v.filter((x) => x.level === 'warning').length} warnings`);
}
