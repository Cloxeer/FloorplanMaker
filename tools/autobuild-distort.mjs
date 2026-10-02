// autobuild-distort.mjs
// Robustness harness: distorts a poster PNG with KNOWN distortions (rotation, keystone,
// plan-in-photo scale, lighting, blur, noise, JPEG, glare, combos), runs rectify -> buildFromPlan
// and compares with the clean run of the same poster. Prints a table and flags failures.
// Usage: node tools/autobuild-distort.mjs [--only=rot+3,noise20] [--ocr] [--save=dir] [--rectify=path/to/rectify.js]
//          [--csv] <poster.png | dir> ...
// Env: TESS_NODE_MODULES (pngjs [+ tesseract.js]), TESS_LANG_PATH (for --ocr).
// Failure / warning thresholds: see flags().
// Depends on: tools/autobuild-distort-lib.mjs, tools/autobuild-eval.mjs, js/model/autobuild/{rectify,pipeline}.js

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DISTORTIONS } from './autobuild-distort-lib.mjs';
import { requireDeps, loadPng, makeTesseractOcr, measure, GROUND_TRUTH } from './autobuild-eval.mjs';
import { buildFromPlan } from '../js/model/autobuild/pipeline.js';
import { roomPolygon } from '../js/model/document.js';

const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; a += pts[i][0] * q[1] - q[0] * pts[i][1]; } return Math.abs(a) / 2; };

// one photo -> metrics (null fields when rectify gave up)
export async function runOne(rectify, img, { ocr = null, truth = null } = {}) {
  const t0 = Date.now();
  const r = rectify(img);
  const out = { rectifyMs: Date.now() - t0, gaveUp: !r };
  if (!r) return out;
  const r2 = rectify(r.image);
  const tl = r2 ? [...r2.tilt.h, ...r2.tilt.v].map(Math.abs) : [];
  tl.sort((a, b) => a - b);
  out.residual = tl.length ? tl[tl.length >> 1] : null; // median |band tilt| of the rectified photo
  out.cropRatio = (r.image.width * r.image.height) / (img.width * img.height);
  // share of the crop that lies inside the photo (the plan must not be cut off; a little padding outside is fine)
  let ins = 0, nn = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const [x, y] = [r.corners[0][0] * (1 - i / 8) * (1 - j / 8) + r.corners[1][0] * (i / 8) * (1 - j / 8) + r.corners[3][0] * (1 - i / 8) * (j / 8) + r.corners[2][0] * (i / 8) * (j / 8), r.corners[0][1] * (1 - i / 8) * (1 - j / 8) + r.corners[1][1] * (i / 8) * (1 - j / 8) + r.corners[3][1] * (1 - i / 8) * (j / 8) + r.corners[2][1] * (i / 8) * (j / 8)];
    nn++; if (x >= 0 && y >= 0 && x <= img.width && y <= img.height) ins++;
  }
  out.insideFrac = ins / nn;
  out.inside = out.insideFrac >= 0.85;
  out.quality = r.quality || null;
  const t1 = Date.now();
  const res = await buildFromPlan(r.image, { ocr, concurrency: 3 });
  out.ms = Date.now() - t1;
  Object.assign(out, measure(res, truth));
  out.outline = polyArea(res.floor.points) / (res.scale * res.scale); // plan units -> crop px^2
  // extent: bounding box of all rooms (px^2 of the crop); steadier than the outline polygon, which follows what the walls enclose
  const pts = res.items.filter((i) => i.type === 'room').flatMap((i) => roomPolygon(i));
  if (pts.length) { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); out.extent = ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / (res.scale * res.scale); } else out.extent = 1;
  return out;
}

// FAIL: rooms or plan extent (bounding box of the rooms) off by more than 25%, residual tilt > 1 deg, output bigger
// than the photo, plan cut off by the photo, rectify gave up. warn (~): rooms off by more than 15% or extent by more than 10%.
export function flags(base, got) {
  const f = [];
  if (got.gaveUp) return ['GAVE-UP'];
  const dr = Math.abs(got.rooms - base.rooms) / base.rooms, da = Math.abs(got.extent / base.extent - 1);
  if (dr > 0.25) f.push('rooms'); else if (dr > 0.15) f.push('~rooms');
  if (da > 0.25) f.push('extent'); else if (da > 0.1) f.push('~extent');
  if (got.residual != null && got.residual > 1) f.push('tilt');
  if (got.cropRatio > 1.05) f.push('big');
  if (!got.inside) f.push('outside');
  if (base.recall != null && got.recall != null && got.recall < base.recall - 0.15) f.push('recall');
  return f;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
  const only = opt('only') ? opt('only').split(',') : null;
  const saveDir = opt('save');
  const rectPath = opt('rectify');
  const { rectify } = await import(rectPath ? pathToFileURL(path.resolve(rectPath)).href : '../js/model/autobuild/rectify.js');
  const deps = requireDeps();
  if (!deps) { console.error('pngjs not found: set TESS_NODE_MODULES'); process.exit(2); }
  let files = [];
  for (const a of args.filter((x) => !x.startsWith('--'))) {
    if (fs.existsSync(a) && fs.statSync(a).isDirectory()) files.push(...fs.readdirSync(a).filter((f) => f.endsWith('.png')).map((f) => path.join(a, f)));
    else files.push(a);
  }
  if (!files.length) { console.error('usage: node tools/autobuild-distort.mjs [--only=a,b] [--ocr] [--save=dir] [--rectify=file] <poster.png|dir> ...'); process.exit(2); }
  const pool = args.includes('--ocr') && deps.tesseract ? await makeTesseractOcr(deps.PNG, deps.tesseract) : null;
  const ocr = pool ? (im, o) => pool.ocr(im, o) : null;
  const names = Object.keys(DISTORTIONS).filter((n) => !only || only.includes(n));
  const fails = {}, totals = {};
  let nFail = 0, nRun = 0;
  for (const f of files) {
    const name = path.basename(f).replace(/\.png$/i, '');
    const key = Object.keys(GROUND_TRUTH).find((k) => name === k || name.includes(k));
    const truth = key && GROUND_TRUTH[key] && ocr ? GROUND_TRUTH[key].split(/\s+/) : null;
    const photo = loadPng(deps.PNG, f);
    const base = await runOne(rectify, photo, { ocr, truth });
    console.log(`\n== ${name}  clean: ${base.gaveUp ? 'GAVE UP' : `rooms ${base.rooms}, outline ${Math.round(base.outline)}, resid ${base.residual == null ? '-' : base.residual.toFixed(2)}, ${base.ms}ms${base.recall != null ? `, numbers ${base.right}/${base.truthSize} (precision ${base.precision})` : ''}`}`);
    if (base.gaveUp) continue;
    console.log('distortion    rooms  ext%   resid  crop   ms    flags');
    for (const dn of names) {
      const { image } = DISTORTIONS[dn](photo);
      if (saveDir) { fs.mkdirSync(saveDir, { recursive: true }); const p = new deps.PNG({ width: image.width, height: image.height }); p.data = Buffer.from(image.data); fs.writeFileSync(path.join(saveDir, `${name}__${dn}.png`), deps.PNG.sync.write(p)); }
      let got;
      try { got = await runOne(rectify, image, { ocr, truth }); } catch (e) { got = { gaveUp: true, err: e.message }; }
      const fl = flags(base, got);
      nRun++; totals[dn] = (totals[dn] || 0) + 1;
      const hard = fl.some((x) => !x.startsWith('~'));
      if (hard) { nFail++; fails[dn] = (fails[dn] || 0) + 1; }
      const q = (got.quality ? ` q=${got.quality.score.toFixed(2)}` : '') + (got.recall != null ? ` num=${got.right}/${got.truthSize}` : '');
      console.log(`${dn.padEnd(13)} ${got.gaveUp ? '  -' : String(got.rooms).padStart(3) + '/' + String(base.rooms).padEnd(3)} ${got.gaveUp ? '' : String(Math.round((got.extent / base.extent) * 100)).padStart(4) + '%'} ${got.residual == null ? '    -' : got.residual.toFixed(2).padStart(5)}  ${got.gaveUp ? '' : got.cropRatio.toFixed(2)}  ${got.gaveUp ? '' : String(got.ms + got.rectifyMs).padStart(5)} ${hard ? 'FAIL ' : fl.length ? 'warn ' : 'ok'}${fl.join(',')}${q}${got.err ? ' ' + got.err : ''}`);
    }
  }
  console.log(`\nSUMMARY: ${nFail}/${nRun} failing`);
  for (const dn of names) if (totals[dn]) console.log(`  ${dn.padEnd(13)} ${fails[dn] || 0}/${totals[dn]}`);
  if (pool) await pool.close();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
