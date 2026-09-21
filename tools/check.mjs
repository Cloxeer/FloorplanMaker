// check.mjs — import a dialect SVG, validate it, confirm export/import
// idempotence and list rooms the route finder cannot reach.
// Usage: node tools/check.mjs tests/fixtures/hjlc-1.svg
// Depends on: js/model/{svgImport,svgExport,validate,route}.js
import fs from 'node:fs';
import { importSvg } from '../js/model/svgImport.js';
import { exportSvg } from '../js/model/svgExport.js';
import { validate } from '../js/model/validate.js';
import { routeAll } from '../js/model/route.js';

for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, 'utf8');
  const { doc, problems } = importSvg(text);
  const v = validate(doc);
  const re = exportSvg(doc);
  const idem = exportSvg(importSvg(re).doc) === re;
  const reach = routeAll(doc, 10);
  const rooms = doc.items.filter((i) => i.type === 'room' && i.cls !== 'void');
  const unreachable = rooms.filter((r) => !reach[r.id]).map((r) => r.number);
  console.log(`${file}: rooms ${rooms.length}, doors ${doc.items.filter((i) => i.type === 'door').length}, stairs ${doc.items.filter((i) => i.type === 'stair').length}, import problems ${problems.length}, errors ${v.filter((x) => x.level === 'error').length}, warnings ${v.filter((x) => x.level === 'warning').length}, idempotent ${idem}, byte-identical ${re === text}`);
  for (const p of problems) console.log('  problem', p.code, p.message || '');
  for (const x of v) console.log(' ', x.level, x.code, x.message);
  console.log('  unreachable:', unreachable.join(' ') || 'none');
}
