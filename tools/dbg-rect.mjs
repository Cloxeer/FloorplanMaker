import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
const dir = 'C:/Users/sebastian/Desktop/maps/_source-photos';
const files = readdirSync(dir).filter((f) => f.endsWith('.webp')).sort();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/');
await page.waitForFunction(() => !!window.__app);
const out = await page.evaluate(async (list) => {
  const { rectifyDetailed } = await import('/js/model/autobuild/rectify.js');
  const res = [];
  for (const { name, b64 } of list) {
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = `data:image/webp;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height);
    const r = rectifyDetailed({ width: px.width, height: px.height, data: px.data });
    res.push({ name, src: [px.width, px.height], out: r.ok ? [r.image.width, r.image.height] : null, tilt: r.tilt && { h: r.tilt.h.length, v: r.tilt.v.length }, fit: r.fit && r.fit.map((v) => +v.toFixed(3)), q: r.quality });
  }
  return res;
}, files.map((f) => ({ name: f.replace('.webp', ''), b64: readFileSync(`${dir}/${f}`).toString('base64') })));
for (const r of out) console.log(r.name.padEnd(16), JSON.stringify(r.src), '->', JSON.stringify(r.out), 'fit', JSON.stringify(r.fit), JSON.stringify(r.q).slice(0, 260));
await browser.close();
