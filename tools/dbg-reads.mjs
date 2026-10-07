// tools/dbg-reads.mjs
// Runs the AutoBuild pipeline in the page (main thread) on one photo and prints what OCR read for every label line:
//   node tools/dbg-reads.mjs <photo> [--raw]   (--raw: skip the app's rectify step)
// Also writes tools/dbg/<name>.lines.json with line boxes + reads. Needs the app served on :8080.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const file = process.argv[2];
const raw = process.argv.includes('--raw');
const JPEG = process.argv.includes('--jpeg');
mkdirSync('tools/dbg', { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:8080/');
await page.waitForFunction(() => !!window.__app);
const b64 = readFileSync(file).toString('base64');
const mime = /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
const out = await page.evaluate(async ({ b64, mime, raw, JPEG }) => {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:${mime};base64,${b64}`; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  let px = g.getImageData(0, 0, c.width, c.height);
  const { rectify } = await import('/js/model/autobuild/rectify.js');
  const { buildFromPlan } = await import('/js/model/autobuild/pipeline.js');
  let src = { width: px.width, height: px.height, data: px.data };
  if (!raw) { const r = rectify(src); if (r) src = r.image; }
  if (JPEG) {
    const cc = document.createElement('canvas'); cc.width = src.width; cc.height = src.height;
    const g3 = cc.getContext('2d'), id3 = g3.createImageData(src.width, src.height); id3.data.set(src.data); g3.putImageData(id3, 0, 0);
    const im2 = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = cc.toDataURL('image/jpeg', 0.88); });
    const c4 = document.createElement('canvas'); c4.width = im2.naturalWidth; c4.height = im2.naturalHeight; const g4 = c4.getContext('2d'); g4.drawImage(im2, 0, 0);
    const p4 = g4.getImageData(0, 0, c4.width, c4.height); src = { width: p4.width, height: p4.height, data: p4.data };
  }
  const T = (await import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js')).default;
  const workers = [];
  for (let i = 0; i < 3; i++) { const w = await T.createWorker('eng'); await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ ', tessedit_pageseg_mode: '7' }); workers.push({ w, psm: '7', busy: false }); }
  const ocr = async ({ data, w, h }, { psm = '7' } = {}) => {
    let s; while (!(s = workers.find((x) => !x.busy))) await new Promise((r) => setTimeout(r, 5));
    s.busy = true;
    try {
      const cv = new OffscreenCanvas(w, h), cx = cv.getContext('2d'), im = cx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = data[i]; im.data[i * 4 + 3] = 255; }
      cx.putImageData(im, 0, 0);
      if (s.psm !== psm) { await s.w.setParameters({ tessedit_pageseg_mode: psm }); s.psm = psm; }
      const { data: r } = await s.w.recognize(cv);
      return { text: (r.text || '').trim(), conf: r.confidence || 0 };
    } finally { s.busy = false; }
  };
  const res = await buildFromPlan(src, { ocr, concurrency: 3, debug: true });
  for (const x of workers) await x.w.terminate();
  const lines = res.debug.jobs.map((l) => ({ x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, h: l.h, reads: (l.reads || []).map((r) => r.text) }));
  const rooms = res.items.filter((i) => i.type === 'room').map((r) => ({ n: r.number, name: r.name, x: r.x, y: r.y, w: r.w, h: r.h, pts: r.points }));
  // overlay: raw face boxes (green), after align/snap (blue), final items / scale (red)
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const g2 = cv.getContext('2d');
  const id2 = g2.createImageData(src.width, src.height); id2.data.set(src.data); g2.putImageData(id2, 0, 0);
  const box = (r, col, lw) => { g2.strokeStyle = col; g2.lineWidth = lw; if (r.pts) { g2.beginPath(); r.pts.forEach(([x, y], i) => (i ? g2.lineTo(x, y) : g2.moveTo(x, y))); g2.closePath(); g2.stroke(); } else g2.strokeRect(r.x, r.y, r.w, r.h); };
  for (const r of res.debug.keptRaw || []) box(r, '#00a000', 3);
  for (const r of res.debug.keptFinal || []) box(r, '#0050ff', 2);
  const sc = res.scale || 1;
  for (const r of rooms) box({ x: r.x / sc, y: r.y / sc, w: r.w / sc, h: r.h / sc, pts: r.pts && r.pts.map(([x, y]) => [x / sc, y / sc]) }, '#ff2020', 1);
  // contact sheet of the OCR crops (what Tesseract is shown) with the reads
  const { renderLine } = await import('/js/model/autobuild/text.js');
  const dg = res.debug, sheet = document.createElement('canvas');
  const items = dg.jobs.slice(0, 40).map((l) => ({ l, c: renderLine(dg.gray, dg.inkLabels, src.width, src.height, l, 44) }));
  const rowH = 110; sheet.width = 900; sheet.height = rowH * items.length;
  const sg = sheet.getContext('2d'); sg.fillStyle = '#fff'; sg.fillRect(0, 0, sheet.width, sheet.height);
  items.forEach(({ l, c }, i) => {
    const t = document.createElement('canvas'); t.width = c.w; t.height = c.h;
    const tg = t.getContext('2d'), idt = tg.createImageData(c.w, c.h);
    for (let k = 0; k < c.w * c.h; k++) { idt.data[k * 4] = idt.data[k * 4 + 1] = idt.data[k * 4 + 2] = c.data[k]; idt.data[k * 4 + 3] = 255; }
    tg.putImageData(idt, 0, 0);
    const sc2 = Math.min(1, (rowH - 6) / c.h, 520 / c.w);
    sg.drawImage(t, 0, i * rowH, c.w * sc2, c.h * sc2);
    sg.fillStyle = '#c00'; sg.font = '16px monospace'; sg.fillText((l.reads || []).map((r) => r.text || '-').join(' | '), 540, i * rowH + 40);
    sg.fillStyle = '#888'; sg.fillText(`(${l.x0},${l.y0}) h${l.h}`, 540, i * rowH + 70);
    sg.strokeStyle = '#ccc'; sg.strokeRect(0, i * rowH, 900, rowH);
  });
  return { w: src.width, h: src.height, textH: res.stats.textH, lines, rooms, review: res.review, scale: sc, overlay: cv.toDataURL('image/png'), sheet: sheet.toDataURL('image/png') };
}, { b64, mime, raw, JPEG });
writeFileSync(`tools/dbg/${basename(file)}.stages.png`, Buffer.from(out.overlay.split(',')[1], 'base64')); delete out.overlay; writeFileSync(`tools/dbg/${basename(file)}.crops.png`, Buffer.from(out.sheet.split(',')[1], 'base64')); delete out.sheet;
writeFileSync(`tools/dbg/${basename(file)}.lines.json`, JSON.stringify(out));
console.log(`size ${out.w}x${out.h} textH ${out.textH} lines ${out.lines.length} rooms ${out.rooms.length}`);
for (const l of out.lines) console.log(`(${l.x0},${l.y0}) h${l.h}: ${l.reads.map((t) => JSON.stringify(t)).join(' | ')}`);
await browser.close();
