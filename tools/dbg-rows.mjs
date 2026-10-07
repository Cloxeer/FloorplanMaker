import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const f = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/');
const b64 = readFileSync(f).toString('base64');
const rows = await page.evaluate(async (b64) => {
  const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = `data:image/webp;base64,${b64}`; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, out = [];
  for (let y = Math.floor(c.height * 0.5); y < c.height; y += 10) {
    let s = 0, sat = 0, n = 0;
    for (let x = 200; x < c.width - 100; x += 2) { const j = (y * c.width + x) * 4, r = d[j], gg = d[j + 1], b = d[j + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); s += (r + gg + b) / 3; sat += mx - mn; n++; }
    out.push(`${y}: lum ${Math.round(s / n)} sat ${Math.round(sat / n)}`);
  }
  return out;
}, b64);
console.log(rows.join('\n'));
await browser.close();
