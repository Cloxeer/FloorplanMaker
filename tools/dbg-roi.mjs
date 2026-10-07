import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
const dir = 'C:/Users/sebastian/Desktop/maps/_source-photos';
const files = readdirSync(dir).filter((f) => f.endsWith('.webp')).sort();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/');
await page.waitForFunction(() => !!window.__app);
const out = await page.evaluate(async (list) => {
  const { maskPosterChrome, posterRoi } = await import('/js/model/autobuild/chrome.js');
  const res = [];
  for (const { name, b64 } of list) {
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = `data:image/webp;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height);
    const s = { width: px.width, height: px.height, data: px.data };
    const m = maskPosterChrome(s);
    res.push({ name, size: [s.width, s.height], sidebar: m.sidebar, caption: m.caption, roi: posterRoi(s) });
  }
  return res;
}, files.map((f) => ({ name: f.replace('.webp', ''), b64: readFileSync(`${dir}/${f}`).toString('base64') })));
for (const r of out) console.log(r.name.padEnd(16), JSON.stringify(r.size), 'side', JSON.stringify(r.sidebar), 'cap', JSON.stringify(r.caption), 'roi', JSON.stringify(r.roi));
await browser.close();
