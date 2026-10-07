// tools/lib/render.mjs: renders a project (the .floorplan.json) to two PNGs with headless Chromium:
//   <out>.overlay.png  the plan drawn over its own photo(s): rooms (pink = numbered, orange = no number), halls (blue), stairs, doors, outline (green)
//   <out>.svg.png      the exported SVG as the map will show it
// The overlay is drawn at `scale` pixels per plan unit with its top-left at plan point (x0, y0): renderProject returns { scale, x0, y0 }.
// Needs the app served on :8080 (only for a page to draw on).
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

export async function renderProject(jsonPath, outBase, { svgOut = null, region = null, tag = 'overlay' } = {}) {
  const project = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8080/');
  await page.waitForFunction(() => !!window.__app);
  const res = await page.evaluate(async ({ project, region }) => {
    const { exportSvg } = await import('/js/model/svgExport.js');
    const { unionBox } = await import('/js/model/photos.js');
    const doc = project.doc;
    const photos = [project.photo, ...(project.extraPhotos || [])].filter((p) => p && p.dataUrl);
    const imgs = await Promise.all(photos.map((p) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = p.dataUrl; })));
    const place = photos.map((p, i) => ({ p, im: imgs[i], t: { x: 0, y: 0, s: 1, a: 0, ...(p.t || {}) } }));
    const b = unionBox(place.map(({ p, t }) => ({ width: p.width, height: p.height, t })));
    const pts = [...(doc.floor ? doc.floor.points : [])];
    for (const it of doc.items) {
      if (it.points) pts.push(...it.points);
      else if (Number.isFinite(it.x)) { pts.push([it.x, it.y]); if (Number.isFinite(it.w)) pts.push([it.x + it.w, it.y + it.h]); }
    }
    const xs = pts.map((q) => q[0]).concat(b ? [b.x, b.x + b.w] : []), ys = pts.map((q) => q[1]).concat(b ? [b.y, b.y + b.h] : []);
    let x0 = Math.min(...xs) - 20, y0 = Math.min(...ys) - 20, W = Math.max(...xs) + 20 - x0, H = Math.max(...ys) + 20 - y0;
    if (region) { [x0, y0, W, H] = region; }
    const k = region ? Math.min(6, 1400 / Math.max(W, H)) : Math.min(1.6, 2000 / Math.max(W, H));
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    for (const { p, im, t } of place) if (im) { g.save(); g.translate(t.x, t.y); g.rotate((t.a * Math.PI) / 180); g.scale(t.s, t.s); g.drawImage(im, 0, 0, p.width, p.height); g.restore(); }
    g.lineWidth = 2 / k;
    const poly = (q) => { g.beginPath(); q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    for (const it of doc.items) {
      if (it.type === 'hall') { g.strokeStyle = '#1f6feb'; g.fillStyle = 'rgba(31,111,235,.18)'; g.fillRect(it.x, it.y, it.w, it.h); g.strokeRect(it.x, it.y, it.w, it.h); }
      else if (it.type === 'room') {
        const col = it.cls === 'core' ? '#8a2be2' : it.number ? '#d6249f' : '#ff8800';
        g.strokeStyle = col; g.fillStyle = it.number ? 'rgba(214,36,159,.07)' : 'rgba(255,136,0,.12)';
        if (it.shape === 'poly') { poly(it.points); g.fill(); g.stroke(); } else { g.fillRect(it.x, it.y, it.w, it.h); g.strokeRect(it.x, it.y, it.w, it.h); }
        const bx = it.shape === 'poly' ? { x: Math.min(...it.points.map((q) => q[0])), y: Math.min(...it.points.map((q) => q[1])) } : it;
        g.fillStyle = col; g.font = `bold ${14 / k}px sans-serif`; g.fillText(it.number || it.name || '?', bx.x + 3 / k, bx.y + 15 / k);
      } else if (it.type === 'stair') { g.strokeStyle = '#2e8b57'; g.strokeRect(it.x, it.y, it.w, it.h); }
      else if (it.type === 'door') { g.strokeStyle = '#00a000'; g.lineWidth = 5 / k; g.beginPath(); g.moveTo(it.x1, it.y1); g.lineTo(it.x2, it.y2); g.stroke(); g.lineWidth = 2 / k; }
      else if (it.type === 'compass') { g.strokeStyle = '#000'; g.beginPath(); g.arc(it.x, it.y, 40, 0, 7); g.stroke(); }
    }
    if (doc.floor) { g.strokeStyle = '#00b050'; g.lineWidth = 4 / k; poly(doc.floor.points); g.stroke(); }
    // a labelled grid in plan units, so positions can be read straight off the picture
    const step = region ? (W <= 160 ? 10 : W <= 400 ? 25 : 50) : 100;
    g.font = `${11 / k}px sans-serif`;
    for (let x = Math.ceil(x0 / step) * step; x <= x0 + W; x += step) { g.strokeStyle = x % (step * 2) ? 'rgba(0,0,0,.10)' : 'rgba(0,0,0,.22)'; g.lineWidth = 1 / k; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + H); g.stroke(); if (x % (step * 2) === 0) { g.fillStyle = '#000'; g.fillText(String(x), x + 2 / k, y0 + 11 / k); } }
    for (let y = Math.ceil(y0 / step) * step; y <= y0 + H; y += step) { g.strokeStyle = y % (step * 2) ? 'rgba(0,0,0,.10)' : 'rgba(0,0,0,.22)'; g.lineWidth = 1 / k; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + W, y); g.stroke(); if (y % (step * 2) === 0) { g.fillStyle = '#000'; g.fillText(String(y), x0 + 2 / k, y - 2 / k); } }
    const svg = exportSvg(doc);
    const m = svg.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/), SW = m ? +m[3] : 1600, SH = m ? +m[4] : 1200;
    const k2 = Math.min(2, 1800 / Math.max(SW, SH));
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); });
    const c2 = document.createElement('canvas'); c2.width = Math.round(SW * k2); c2.height = Math.round(SH * k2);
    const g2 = c2.getContext('2d'); g2.fillStyle = '#fff'; g2.fillRect(0, 0, c2.width, c2.height); g2.drawImage(img, 0, 0, c2.width, c2.height);
    return { overlay: c.toDataURL('image/png'), svgPng: c2.toDataURL('image/png'), svg, scale: k, x0, y0 };
  }, { project, region });
  writeFileSync(`${outBase}.${tag}.png`, Buffer.from(res.overlay.split(',')[1], 'base64'));
  if (!region) writeFileSync(`${outBase}.svg.png`, Buffer.from(res.svgPng.split(',')[1], 'base64'));
  if (svgOut) writeFileSync(svgOut, res.svg);
  await browser.close();
  return { scale: res.scale, x0: res.x0, y0: res.y0 };
}
