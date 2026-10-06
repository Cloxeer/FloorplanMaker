// tools/dbg-faces.mjs: draws the closed faces (rooms) the pipeline sees on a rectified photo.
//   node tools/dbg-faces.mjs <photo> [gapFrac]    -> tools/dbg/<name>.faces.png
// gapFrac: if given, collinear wall pieces are bridged across gaps up to gapFrac*L px first (experiment).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const file = process.argv[2];
const gap = process.argv[3] ? parseFloat(process.argv[3]) : 0;
mkdirSync('tools/dbg', { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:8080/');
await page.waitForFunction(() => !!window.__app);
const b64 = readFileSync(file).toString('base64');
const mime = /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
const png = await page.evaluate(async ({ b64, mime, gap }) => {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:${mime};base64,${b64}`; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height);
  const { rectify } = await import('/js/model/autobuild/rectify.js');
  const { analyze } = await import('/js/model/autobuild/layers.js');
  const { extractFaces, footprint } = await import('/js/model/autobuild/faces.js');
  let src = { width: px.width, height: px.height, data: px.data };
  const r = rectify(src); if (r) src = r.image;
  const w = src.width, h = src.height, L = Math.max(w, h);
  const layers = analyze(src);
  if (gap > 0) {
    const mod = await import('/js/model/autobuild/bridge.js').catch(() => null);
    if (mod) layers.wallInk = mod.bridgeGaps(layers.wallInk || layers.ink, w, h, Math.round(gap * L));
  }
  const foot = footprint(layers, w, h, L);
  const F = extractFaces(src, layers, { closeR: 1, foot });
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const og = out.getContext('2d'), id = og.createImageData(w, h);
  const col = (n) => [(n * 67) % 200 + 40, (n * 131) % 200 + 40, (n * 197) % 200 + 40];
  const wi = layers.wallInk || layers.ink;
  for (let i = 0; i < w * h; i++) {
    const f = F.labels[i];
    let rgb = [255, 255, 255];
    if (f) rgb = col(f);
    if (wi[i]) rgb = [0, 0, 0];
    id.data[i * 4] = rgb[0]; id.data[i * 4 + 1] = rgb[1]; id.data[i * 4 + 2] = rgb[2]; id.data[i * 4 + 3] = 255;
  }
  og.putImageData(id, 0, 0);
  return out.toDataURL('image/png');
}, { b64, mime, gap });
writeFileSync(`tools/dbg/${basename(file)}.faces${gap ? '-g' + gap : ''}.png`, Buffer.from(png.split(',')[1], 'base64'));
await browser.close();
console.log('done');
