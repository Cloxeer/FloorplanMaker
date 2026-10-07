// tools/render-svg.mjs: node tools/render-svg.mjs <svg-or-dir>... renders each .svg to <name>.svg.png (white page, <=1800 px)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const files = process.argv.slice(2).flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.svg')).map((f) => join(p, f)) : [p]));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/');
for (const f of files) {
  const svg = readFileSync(f, 'utf8');
  const data = await page.evaluate(async (svg) => {
    const m = svg.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/), W = m ? +m[3] : 1600, H = m ? +m[4] : 1200;
    const k = Math.min(2, 1800 / Math.max(W, H));
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); });
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }, svg);
  writeFileSync(`${f}.png`, Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();
console.log('rendered', files.length);
