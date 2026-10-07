import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const dir = 'C:/Users/sebastian/Desktop/maps/_source-photos';
const names = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/');
await page.waitForFunction(() => !!window.__app);
const out = await page.evaluate(async (list) => {
  const { rectifyDetailed1 } = await import('/js/model/autobuild/rectify.js');
  const { posterRoi } = await import('/js/model/autobuild/chrome.js');
  const res = [];
  for (const { name, b64 } of list) {
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = `data:image/webp;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height);
    const roi = posterRoi({ width: px.width, height: px.height, data: px.data });
    const cw = roi.x1 - roi.x0 + 1, ch = roi.y1 - roi.y0 + 1, crop = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) crop.set(px.data.subarray(((roi.y0 + y) * px.width + roi.x0) * 4, ((roi.y0 + y) * px.width + roi.x0 + cw) * 4), y * cw * 4);
    const r2 = rectifyDetailed1({ width: cw, height: ch, data: crop });
    const cv = document.createElement('canvas');
    if (r2.ok) { cv.width = r2.image.width; cv.height = r2.image.height; cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r2.image.data), cv.width, cv.height), 0, 0); }
    res.push({ name, roi, q: r2.quality, out: r2.ok ? [r2.image.width, r2.image.height] : null, png: r2.ok ? cv.toDataURL('image/png') : null });
  }
  return res;
}, names.map((n) => ({ name: n, b64: readFileSync(`${dir}/${n}.webp`).toString('base64') })));
import { writeFileSync } from 'node:fs';
for (const r of out) { console.log(r.name, JSON.stringify(r.roi), JSON.stringify(r.out), JSON.stringify(r.q)); if (r.png) writeFileSync(`tools/dbg/${r.name}.roi-rect.png`, Buffer.from(r.png.split(',')[1], 'base64')); }
await browser.close();
