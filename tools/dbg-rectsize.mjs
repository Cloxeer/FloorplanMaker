// tools/dbg-rectsize.mjs <photo>...: size of each photo before and after the app's rectify (and what posterRoi says)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto('http://localhost:8080/'); await page.waitForFunction(() => !!window.__app);
for (const f of process.argv.slice(2)) {
  const b64 = readFileSync(f).toString('base64');
  console.log(f.split(/[\/]/).pop(), JSON.stringify(await page.evaluate(async (b64) => {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/webp;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height);
    const { rectifyDetailed } = await import('/js/model/autobuild/rectify.js'); const { posterRoi } = await import('/js/model/autobuild/chrome.js');
    const src = { width: px.width, height: px.height, data: px.data };
    const r = rectifyDetailed(src);
    return { from: [px.width, px.height], rect: r && r.image ? [r.image.width, r.image.height] : r, keys: r && Object.keys(r), roi: posterRoi(src) };
  }, b64)));
}
await browser.close();
