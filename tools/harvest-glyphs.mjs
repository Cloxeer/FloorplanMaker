// tools/harvest-glyphs.mjs: labelled glyph samples from the hand-finished floors.
//   node tools/harvest-glyphs.mjs <out.json> <project.floorplan.json>...
// Runs the glyph finder on each project's own photo (same frame as the plan) and pairs every text line with the
// finished room it lies in; where the glyph count matches the printed number, each glyph becomes a labelled sample
// { ch, w, h, bits[16*20] } (grey values 0..255, black ink = low, area-averaged from the photo).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const [outFile, ...files] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:8080/');
await page.waitForFunction(() => !!window.__app);
const all = [];
for (const f of files) {
  const project = JSON.parse(readFileSync(f, 'utf8'));
  const out = await page.evaluate(async (project) => {
    const { buildFromPlan } = await import('/js/model/autobuild/pipeline.js');
    const im = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = project.photo.dataUrl; });
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height);
    const res = await buildFromPlan({ width: px.width, height: px.height, data: px.data }, { ocr: null, debug: true, chrome: false });
    const dg = res.debug, W = c.width, H = c.height;
    const rooms = project.doc.items.filter((i) => i.type === 'room' && i.number);
    const box = (r) => (r.points ? { x0: Math.min(...r.points.map((p) => p[0])), y0: Math.min(...r.points.map((p) => p[1])), x1: Math.max(...r.points.map((p) => p[0])), y1: Math.max(...r.points.map((p) => p[1])) } : { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
    const bits = (b) => {
      const x0 = Math.max(0, b.x0 - 1), y0 = Math.max(0, b.y0 - 1), x1 = Math.min(W - 1, b.x1 + 1), y1 = Math.min(H - 1, b.y1 + 1), w = x1 - x0 + 1, h = y1 - y0 + 1;
      let lo = 255, hi = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = dg.gray[y * W + x]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const o = new Array(16 * 20).fill(255);
      for (let j = 0; j < 20; j++) for (let i = 0; i < 16; i++) {
        const sx0 = x0 + (i * w) / 16, sx1 = x0 + ((i + 1) * w) / 16, sy0 = y0 + (j * h) / 20, sy1 = y0 + ((j + 1) * h) / 20;
        let s = 0, n = 0;
        for (let y = Math.floor(sy0); y < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); y++) for (let x = Math.floor(sx0); x < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); x++) { s += dg.gray[Math.min(H - 1, y) * W + Math.min(W - 1, x)]; n++; }
        o[j * 16 + i] = Math.round(Math.max(0, Math.min(255, ((s / n - lo) / Math.max(30, hi - lo)) * 255)));
      }
      return o;
    };
    const samples = [];
    for (const l of dg.jobs) {
      const cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2;
      let best = null, ba = Infinity;
      for (const r of rooms) { const b = box(r); if (cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1) { const a = (b.x1 - b.x0) * (b.y1 - b.y0); if (a < ba) { ba = a; best = r; } } }
      if (!best) continue;
      const text = best.number.replace(/[^A-Z0-9]/g, '');
      const gl = l.glyphs.filter((q) => !q.dot).sort((a, b) => a.x0 - b.x0);
      if (gl.length !== text.length) continue;
      gl.forEach((q, k) => samples.push({ ch: text[k], w: q.x1 - q.x0 + 1, h: q.y1 - q.y0 + 1, bits: bits(q) }));
    }
    return { samples, lines: dg.jobs.length, glyphLines: samples.length };
  }, project);
  console.log(f, 'lines', out.lines, 'samples', out.samples.length);
  all.push({ file: f, samples: out.samples });
}
writeFileSync(outFile, JSON.stringify(all));
await browser.close();
