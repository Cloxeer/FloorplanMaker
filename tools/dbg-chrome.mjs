// tools/dbg-chrome.mjs: montage of the rectified photos after the poster furniture (sidebar, caption) is masked white.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = 'C:/Users/sebastian/Desktop/maps/_source-photos';
const files = readdirSync(dir).filter((f) => f.endsWith('.webp')).sort();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/');
await page.waitForFunction(() => !!window.__app);
const out = await page.evaluate(async (list) => {
  const { rectify } = await import('/js/model/autobuild/rectify.js');
  const { maskPosterChrome } = await import('/js/model/autobuild/chrome.js');
  const cells = [];
  for (const { name, b64 } of list) {
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = `data:image/webp;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height);
    let src = { width: px.width, height: px.height, data: px.data };
    const r = rectify(src); if (r) src = r.image;
    const m = maskPosterChrome(src);
    const cv = document.createElement('canvas'); cv.width = m.img.width; cv.height = m.img.height;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.img.data), m.img.width, m.img.height), 0, 0);
    cells.push({ name, cv, side: !!m.sidebar, cap: !!m.caption });
  }
  const W = 420, H = 300, cols = 4, rows = Math.ceil(cells.length / cols);
  const sheet = document.createElement('canvas'); sheet.width = W * cols; sheet.height = H * rows;
  const sg = sheet.getContext('2d'); sg.fillStyle = '#888'; sg.fillRect(0, 0, sheet.width, sheet.height);
  cells.forEach((c, i) => {
    const k = Math.min((W - 6) / c.cv.width, (H - 20) / c.cv.height), x = (i % cols) * W, y = Math.floor(i / cols) * H;
    sg.drawImage(c.cv, x + 3, y + 16, c.cv.width * k, c.cv.height * k);
    sg.fillStyle = '#fff'; sg.font = '13px sans-serif'; sg.fillText(`${c.name} side:${c.side} cap:${c.cap}`, x + 4, y + 12);
  });
  return sheet.toDataURL('image/png');
}, files.map((f) => ({ name: f.replace('.webp', ''), b64: readFileSync(`${dir}/${f}`).toString('base64') })));
writeFileSync('tools/dbg/chrome-montage.png', Buffer.from(out.split(',')[1], 'base64'));
await browser.close();
console.log('ok');
