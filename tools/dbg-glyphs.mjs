// tools/dbg-glyphs.mjs <photo> x0 y0 x1 y1: glyph boxes and orphan lines the pipeline sees in a region of the (rectified) photo
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [file, ...r] = process.argv.slice(2); const [X0, Y0, X1, Y1] = r.map(Number);
const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto('http://localhost:8080/'); await page.waitForFunction(() => !!window.__app);
const b64 = readFileSync(file).toString('base64');
const out = await page.evaluate(async ({ b64, X0, Y0, X1, Y1 }) => {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/webp;base64,${b64}`; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height);
  const { rectify } = await import('/js/model/autobuild/rectify.js'); const { buildFromPlan } = await import('/js/model/autobuild/pipeline.js');
  let src = { width: px.width, height: px.height, data: px.data }; const rr = rectify(src); if (rr) src = rr.image;
  const res = await buildFromPlan(src, { ocr: null, debug: true });
  const d = res.debug, inb = (o) => o.x1 >= X0 && o.x0 <= X1 && o.y1 >= Y0 && o.y0 <= Y1;
  return { size: [src.width, src.height], textH: d.textH, glyphs: d.glyphs1.filter(inb).map((q) => [q.x0, q.y0, q.x1, q.y1, q.face, q.dot ? 'dot' : '']), orphans: d.orphans.filter(inb).map((l) => [l.x0, l.y0, l.x1, l.y1, l.glyphs.length]) };
}, { b64, X0, Y0, X1, Y1 });
console.log(JSON.stringify(out));
await browser.close();
