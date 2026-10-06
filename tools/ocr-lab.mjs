// tools/ocr-lab.mjs: compares crop-rendering / OCR settings on label lines whose text is known.
//   node tools/ocr-lab.mjs <photo> <truth.json>   truth = { "x,y": "TEXT", ... } (line top-left in the rectified image)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [file, truthFile] = [process.argv[2], process.argv[3]];
const truth = JSON.parse(readFileSync(truthFile, 'utf8'));
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:8080/');
await page.waitForFunction(() => !!window.__app);
const b64 = readFileSync(file).toString('base64');
const mime = /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
const LANG = process.env.LANG_PATH || '';
const res = await page.evaluate(async ({ b64, mime, truth, LANG }) => {
  window.__lang = LANG;
  const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = `data:${mime};base64,${b64}`; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height);
  const { rectify } = await import('/js/model/autobuild/rectify.js');
  const { buildFromPlan } = await import('/js/model/autobuild/pipeline.js');
  const { renderLine } = await import('/js/model/autobuild/text.js');
  const { renderCrop } = await import('/js/model/autobuild/ocrRender.js');
  let src = { width: px.width, height: px.height, data: px.data };
  const r = rectify(src); if (r) src = r.image;
  const built = await buildFromPlan(src, { ocr: null, debug: true });
  const dg = built.debug, W = src.width, H = src.height;
  const T = (await import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js')).default;
  const worker = await T.createWorker('eng', 1, window.__lang ? { langPath: window.__lang } : {});
  await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ ', tessedit_pageseg_mode: '7' });
  const read = async ({ data, w, h }, psm) => {
    const cv = new OffscreenCanvas(w, h), cx = cv.getContext('2d'), im = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = data[i]; im.data[i * 4 + 3] = 255; }
    cx.putImageData(im, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data: d } = await worker.recognize(cv);
    return (d.text || '').replace(/[^A-Z0-9]/g, '');
  };
  const lines = dg.jobs.filter((l) => truth[`${l.x0},${l.y0}`]);
  const maskOf = (l) => { const ids = new Set(l.glyphs.map((q) => q.id)); return (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && ids.has(dg.inkLabels[yy * W + xx])) return true; } return false; }; };
  const variants = {
    old44: (l) => renderLine(dg.gray, dg.inkLabels, W, H, l, 44),
    bin32: (l) => renderCrop(dg.gray, W, H, l, { height: 32, mode: 'binary' }),
    bin48: (l) => renderCrop(dg.gray, W, H, l, { height: 48, mode: 'binary' }),
    bin40p6: (l) => renderCrop(dg.gray, W, H, l, { height: 40, mode: 'binary', pad: 6 }),
    bin56: (l) => renderCrop(dg.gray, W, H, l, { height: 56, mode: 'binary' }),
  };
  const out = {};
  const hs = [28, 32, 36, 40, 44, 48, 52, 56, 64];
  let any = 0, plural = 0, tot = 0; const rows = [];
  for (const l of lines) {
    const want = truth[`${l.x0},${l.y0}`];
    const reads = [];
    for (const hh of hs) for (const psm of ['7', '8']) reads.push(await read(renderCrop(dg.gray, W, H, l, { height: hh, mode: 'binary' }), psm));
    tot++;
    if (reads.includes(want)) any++;
    const cnt = new Map(); for (const t of reads) if (t.length >= 3) cnt.set(t, (cnt.get(t) || 0) + 1);
    const top = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top[0] && top[0][0] === want) plural++;
    rows.push(`${want}: ${top.map(([t, n]) => `${t}x${n}`).join(' ')}  [${reads.filter((t) => t === want).length}/${reads.length}]`);
  }
  out.summary = `any-correct ${any}/${tot}  plurality-correct ${plural}/${tot}`;
  out.rows = rows.join(String.fromCharCode(10));
  await worker.terminate();
  return out;
}, { b64, mime, truth, LANG });
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(9), v);
await browser.close();
