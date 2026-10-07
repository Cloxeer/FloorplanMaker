// tools/hall-feat.mjs: runs AutoBuild's hall finder on each finished floor's photo and prints, for every hall, its features and
// whether the hand-finished floor has a hall there. node tools/hall-feat.mjs <project.floorplan.json>...
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/');
await page.waitForFunction(() => !!window.__app);
const rows = [];
for (const f of process.argv.slice(2)) {
  const project = JSON.parse(readFileSync(f, 'utf8'));
  const out = await page.evaluate(async (project) => {
    const { buildFromPlan } = await import('/js/model/autobuild/pipeline.js');
    const im = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = project.photo.dataUrl; });
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height);
    const res = await buildFromPlan({ width: px.width, height: px.height, data: px.data }, { ocr: null, debug: true, chrome: false });
    const sc = res.scale, truth = project.doc.items.filter((i) => i.type === 'hall');
    return res.debug.halls.map((h) => {
      let n = 0, t = 0;
      for (let y = h.y; y < h.y + h.h; y += 3) for (let x = h.x; x < h.x + h.w; x += 3) { n++; const X = x * sc, Y = y * sc; if (truth.some((q) => X >= q.x && X < q.x + q.w && Y >= q.y && Y < q.y + q.h)) t++; }
      return { w: Math.round(h.w * sc), h: Math.round(h.h * sc), blue: +h.blue.toFixed(2), a: +h.sideA.toFixed(2), b: +h.sideB.toFixed(2), truth: +(t / Math.max(1, n)).toFixed(2) };
    });
  }, project);
  out.forEach((o) => rows.push({ f: f.split(/[\/]/).pop().replace('.floorplan.json', ''), ...o }));
}
console.table(rows);
await browser.close();
