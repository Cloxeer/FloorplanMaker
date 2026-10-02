// fixqa-posters.mjs - run the whole Fix flow headlessly over real plans and print invariants.
// Usage: AUTOBUILD_PNG_DIR=<dir with all/*.png, jett.png ...> node tools/fixqa-posters.mjs [--ocr] [names...]
//   names: poster file stems (01-hjlc-f1 ...) or jett / sci / hjlcbig; default: all posters in <dir>/all
// With --ocr set TESS_LANG_PATH and TESS_NODE_MODULES as for tools/autobuild-eval.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { requireDeps, loadPng, makeTesseractOcr } from './autobuild-eval.mjs';
import { rectify } from '../js/model/autobuild/rectify.js';
import { buildFromPlan } from '../js/model/autobuild/pipeline.js';
import { checkFix } from './fixqa-lib.mjs';

const args = process.argv.slice(2), useOcr = args.includes('--ocr');
const dir = process.env.AUTOBUILD_PNG_DIR || process.cwd();
let names = args.filter((a) => !a.startsWith('--'));
if (!names.length) names = fs.readdirSync(path.join(dir, 'all')).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));
const deps = requireDeps();
let pool = null;
if (useOcr && deps && deps.tesseract) pool = await makeTesseractOcr(deps.PNG, deps.tesseract);
let bad = 0;
for (const n of names) {
  const file = fs.existsSync(path.join(dir, n + '.png')) ? path.join(dir, n + '.png') : path.join(dir, 'all', n + '.png');
  const r = rectify(loadPng(deps.PNG, file));
  const res = await buildFromPlan(r.image, { ocr: pool ? (im, op) => pool.ocr(im, op) : null, concurrency: 3 });
  const doc = { items: res.items, floor: res.floor };
  const q = checkFix(doc);
  const keys = [...new Set([...Object.keys(q.before), ...Object.keys(q.after)])];
  console.log(`${n}: ${q.applied.length} fixes, ${q.manual.length} manual, ${q.ms} ms, violations ${q.violations.length}`);
  console.log('   ' + keys.map((k) => `${k} ${q.before[k] || 0}->${q.after[k] || 0}`).join(', '));
  q.violations.forEach((v) => console.log('   VIOLATION: ' + v));
  q.manual.slice(0, 6).forEach((m) => console.log('   manual: ' + m.message));
  bad += q.violations.length;
}
if (pool) await pool.close();
console.log(bad ? `${bad} violation(s)` : 'all invariants hold');
process.exit(bad ? 1 : 0);
