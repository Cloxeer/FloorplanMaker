// make-demo.mjs — build a ready-to-open project file (.floorplan.json) from a
// dialect SVG and its straightened photo, so a traced building can be opened
// in the studio with "Open .json project".
// Usage: node tools/make-demo.mjs tests/fixtures/hjlc-1.svg samples/hjlc-1-straight.jpg samples/hjlc-1.floorplan.json
// Depends on: js/model/svgImport.js, js/store/autosave.js (exportProjectJson)
import fs from 'node:fs';
import { importSvg } from '../js/model/svgImport.js';
import { exportProjectJson } from '../js/store/autosave.js';

const [svgPath, jpgPath, outPath] = process.argv.slice(2);
const { doc, problems } = importSvg(fs.readFileSync(svgPath, 'utf8'));
if (problems.length) console.warn('import problems:', problems);
const jpg = fs.readFileSync(jpgPath);
const dataUrl = 'data:image/jpeg;base64,' + jpg.toString('base64');
const w = doc.viewBox.w, h = doc.viewBox.h;
const project = {
  id: 'demo-' + doc.meta.slug,
  slug: doc.meta.slug,
  name: doc.meta.building,
  createdAt: Date.now(),
  savedAt: Date.now(),
  doc,
  photo: { dataUrl, width: w, height: h, corners: [[0, 0], [w, 0], [w, h], [0, h]], originalDataUrl: dataUrl },
  view: { zoom: 1, panX: 0, panY: 0, onion: 0.5 },
  history: { past: [], future: [] },
};
fs.writeFileSync(outPath, exportProjectJson(project));
console.log('wrote', outPath, Math.round(fs.statSync(outPath).size / 1024) + ' KB', 'items', doc.items.length);

process.exit(0);
