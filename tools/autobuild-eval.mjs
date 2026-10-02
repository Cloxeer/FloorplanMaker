// autobuild-eval.mjs
// Measures AutoBuild on real photos: rooms, numbered rooms, duplicates, overlaps,
// rectilinear outline, scale, runtime, review count, number accuracy vs ground truth.
// Usage:  node tools/autobuild-eval.mjs [--no-ocr] [--json] <name|file.png> ...
//   --profile='{"useFormat":true}'  override AutoBuild profile keys for the run
//   names: jett, sci, hjlcbig (looked up as <name>.png in AUTOBUILD_PNG_DIR, default cwd)
// Env:    TESS_NODE_MODULES  folder holding node_modules/tesseract.js + pngjs (or its parent)
//         TESS_LANG_PATH     folder with eng.traineddata (default cwd) - avoids downloads
//         AUTOBUILD_PNG_DIR  where the converted PNG photos live
// The fixtures are .webp (tests/fixtures/autobuild); convert once with Pillow:
//   python -c "from PIL import Image; Image.open('x.webp').convert('RGB').save('x.png')"
// Depends on: js/model/autobuild/{rectify,pipeline}.js, js/model/{document,geometry}.js

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { rectify } from '../js/model/autobuild/rectify.js';
import { buildFromPlan } from '../js/model/autobuild/pipeline.js';
import { roomPolygon } from '../js/model/document.js';
import { pointInPolygon } from '../js/model/geometry.js';

export const GROUND_TRUTH = {
  jett: '005 007 009 011 013 015 004 006 010 012 016 R001 H001A J003 T005 M002 ST1 017A H017 M017B',
  hjlcbig: '128B 128C 128D 128E 128F 128G 128H 128J 128K 128L R134 R133 128 128R 128N 128O R131 128P 128Q 128A T130 M132 J129 ST1 M127 M123 S122 S125 125 126 M118 101 101A 121 119 S117 S115 102 104 T106 103 105A 105 120 118 S116 T114 J107 R108 R106',
  sci: null, // digits ~5 px: geometry only
};

export function requireDeps() {
  const base = process.env.TESS_NODE_MODULES;
  const tries = [base && path.join(base, 'package.json'), base && path.join(base, 'node_modules', 'x.js'), path.join(process.cwd(), 'x.js')].filter(Boolean);
  for (const t of tries) {
    try {
      const req = createRequire(t);
      return { PNG: req('pngjs').PNG, tesseract: (() => { try { return req('tesseract.js'); } catch { return null; } })() };
    } catch { /* next */ }
  }
  return null;
}

export function loadPng(PNG, file) {
  const p = PNG.sync.read(fs.readFileSync(file));
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
}

export async function makeTesseractOcr(PNG, tesseract, n = 3) {
  const createWorker = tesseract.createWorker || (tesseract.default && tesseract.default.createWorker);
  const langPath = process.env.TESS_LANG_PATH || process.cwd();
  const workers = [];
  for (let i = 0; i < n; i++) {
    const worker = await createWorker('eng', 1, { langPath, gzip: false, cachePath: langPath });
    await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ ', tessedit_pageseg_mode: '7' });
    workers.push({ worker, psm: '7', busy: false });
  }
  const waiting = [];
  const acquire = () => new Promise((res) => { const f = workers.find((q) => !q.busy); if (f) { f.busy = true; res(f); } else waiting.push(res); });
  const release = (s) => { const nx = waiting.shift(); if (nx) nx(s); else s.busy = false; };
  return {
    async ocr({ data, w, h }, { psm = '7' } = {}) {
      const s = await acquire();
      try {
        const p = new PNG({ width: w, height: h });
        for (let i = 0; i < w * h; i++) { p.data[i * 4] = p.data[i * 4 + 1] = p.data[i * 4 + 2] = data[i]; p.data[i * 4 + 3] = 255; }
        if (s.psm !== psm) { await s.worker.setParameters({ tessedit_pageseg_mode: psm }); s.psm = psm; }
        const { data: res } = await s.worker.recognize(PNG.sync.write(p));
        return { text: (res.text || '').trim(), conf: res.confidence || 0 };
      } finally { release(s); }
    },
    close: () => Promise.all(workers.map((q) => q.worker.terminate())),
  };
}

const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

// Metrics for one buildFromPlan result. truth: array of numbers or null.
export function measure(res, truth) {
  const rooms = res.items.filter((i) => i.type === 'room' && i.cls === 'room');
  const numbered = rooms.filter((r) => r.number);
  const counts = {};
  numbered.forEach((r) => { counts[r.number] = (counts[r.number] || 0) + 1; });
  const duplicates = Object.values(counts).filter((n) => n > 1).length;
  const polys = res.items.filter((i) => i.type === 'room' && i.cls !== 'void').map((r) => roomPolygon(r));
  const boxes = polys.map(bbox);
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1), y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1);
    if (x1 - x0 < 6 || y1 - y0 < 6) continue;
    let n = 0; // sampled intersection area, in 3x3-unit cells; overlap = more than ~40 units^2... of a real crossing
    for (let y = y0 + 1.5; y < y1; y += 3) for (let x = x0 + 1.5; x < x1; x += 3) if (pointInPolygon([x, y], polys[i]) && pointInPolygon([x, y], polys[j])) n++;
    if (n >= 8) overlaps++;
  }
  const pts = res.floor.points;
  let rectilinear = pts.length >= 4;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (a[0] !== b[0] && a[1] !== b[1]) rectilinear = false;
  }
  const outsidePt = (p) => ![[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3]].some(([dx, dy]) => pointInPolygon([p[0] + dx, p[1] + dy], pts));
  const itemsOutsideOutline = res.items.filter((i) => ['room', 'hall', 'stair'].includes(i.type)).filter((i) => {
    return (i.points || [[i.x, i.y], [i.x + i.w, i.y], [i.x, i.y + i.h], [i.x + i.w, i.y + i.h]]).some(outsidePt);
  }).length;
  const oi = res.outlineInfo || { coverage: 0, segments: [] };
  const out = { outlineCoverage: oi.coverage, outlineGaps: oi.segments.filter((q) => q.kind === 'gap').length, itemsOutsideOutline, rooms: rooms.length, numbered: numbered.length, duplicates, overlaps, rectilinear, scale: res.scale, review: res.review.length };
  if (truth) {
    const gt = new Set(truth);
    const got = new Set(numbered.map((r) => r.number));
    // stair labels are not rooms; ST1 counts if a stair item exists
    if (gt.has('ST1') && res.items.some((i) => i.type === 'stair')) got.add('ST1');
    const right = [...got].filter((n) => gt.has(n));
    out.truthSize = gt.size;
    out.right = right.length;
    out.wrong = [...got].filter((n) => !gt.has(n));
    out.missing = [...gt].filter((n) => !got.has(n));
    out.recall = +(right.length / gt.size).toFixed(3);
    out.precision = +(right.length / Math.max(1, got.size)).toFixed(3);
  }
  return out;
}

export async function evaluate(file, { ocr = null, profile = undefined } = {}, PNG) {
  const name = path.basename(file).replace(/\.png$/i, '');
  const truth = GROUND_TRUTH[name] ? GROUND_TRUTH[name].split(/\s+/) : null;
  const t0 = Date.now();
  const r = rectify(loadPng(PNG, file));
  if (!r) return { name, error: 'rectify failed' };
  const t1 = Date.now();
  const res = await buildFromPlan(r.image, { ocr, profile, concurrency: 3 });
  const ms = Date.now() - t1;
  const hp = res.hallPass || null;
  let hallPass = null;
  if (hp) {
    const att = await import('../js/model/attention.js');
    const bare = res.items.filter((i) => i.type !== 'hall' || !hp.added.includes(i.id));
    hallPass = { added: hp.added.length, extended: hp.extended.length, fixes: hp.fixes, offBefore: att.roomsNotTouchingHall(bare.map((i) => (hp.hallBefore[i.id] ? { ...i, ...hp.hallBefore[i.id] } : i))).length, offAfter: hp.notesLeft.roomsNotTouching, looseAfter: hp.notesLeft.unconnected };
  }
  return { name, rectifyMs: t1 - t0, ms, ...measure(res, truth), hallPass, res };
}

async function main() {
  const args = process.argv.slice(2);
  const noOcr = args.includes('--no-ocr'), asJson = args.includes('--json');
  const pa = args.find((a) => a.startsWith('--profile='));
  const profile = pa ? JSON.parse(pa.slice(10)) : undefined;
  const files = args.filter((a) => !a.startsWith('--')).map((a) => (a.endsWith('.png') ? a : path.join(process.env.AUTOBUILD_PNG_DIR || process.cwd(), a + '.png')));
  if (!files.length) { console.error('usage: node tools/autobuild-eval.mjs [--no-ocr] [--json] jett sci hjlcbig'); process.exit(2); }
  const deps = requireDeps();
  if (!deps) { console.error('pngjs not found: set TESS_NODE_MODULES'); process.exit(2); }
  let pool = null;
  if (!noOcr && deps.tesseract) pool = await makeTesseractOcr(deps.PNG, deps.tesseract);
  else if (!noOcr) console.error('tesseract.js not found: running without OCR');
  const all = [];
  for (const f of files) {
    const o = await evaluate(f, { ocr: pool ? (im, op) => pool.ocr(im, op) : null, profile }, deps.PNG);
    const { res, ...m } = o;
    all.push(m);
    if (asJson) continue;
    if (m.error) { console.log(`${m.name}: ${m.error}`); continue; }
    console.log(`${m.name}: rooms ${m.rooms}, numbered ${m.numbered}, dup ${m.duplicates}, overlaps ${m.overlaps}, rectilinear ${m.rectilinear}, outside ${m.itemsOutsideOutline}, outline wall ${m.outlineCoverage} (${m.outlineGaps} gaps), scale ${m.scale}, ${m.ms} ms, review ${m.review}`);
    if (m.hallPass) console.log(`  hallPass: +${m.hallPass.added} new, ${m.hallPass.extended} extended, ${m.hallPass.fixes} fixes; rooms off a hallway ${m.hallPass.offBefore} -> ${m.hallPass.offAfter}; cut-off halls ${m.hallPass.looseAfter}`);
    if (m.truthSize) console.log(`  numbers: ${m.right}/${m.truthSize} right (recall ${m.recall}, precision ${m.precision}); wrong [${m.wrong.join(' ')}]; missing [${m.missing.join(' ')}]`);
  }
  if (asJson) console.log(JSON.stringify(all, null, 1));
  if (pool) await pool.close();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
