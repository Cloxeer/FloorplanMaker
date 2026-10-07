// tools/build-floor.mjs
// Drives the real app (headless Chromium) through the normal flow for one floor and saves the result:
//   node tools/build-floor.mjs <spec.json | inline-json> [outDir]
// spec = { building, property, code, floor, photos: ["path", ...], autoStitch?: true }
// One photo: Choose a photo -> Flatten -> AutoBuild. Several: Add multiple photos -> (corners + Flatten each) ->
// the merge board -> AutoBuild. Writes <outDir>/<code>-<floor>.{floorplan.json,svg,plan.png,log.json}.
// Needs the app served at http://localhost:8080 (npm run serve). Depends on: playwright (node_modules).

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const BASE = process.env.APP_URL || 'http://localhost:8080';
const arg = process.argv[2];
const spec = existsSync(arg) ? JSON.parse(readFileSync(arg, 'utf8')) : JSON.parse(arg);
const outDir = resolve(process.argv[3] || 'tools/out');
mkdirSync(outDir, { recursive: true });
const slug = spec.slug || `${spec.code.toLowerCase()}-${spec.floor}`;
const log = { slug, steps: [], console: [] };
const step = (s) => { log.steps.push(s); if (process.env.VERBOSE) console.log(`[${slug}] ${s}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => log.console.push(`pageerror: ${e.message}`));

try {
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => !!window.__app);
  await page.goto(`${BASE}/#/new`);
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', spec.building);
  await page.fill('#bp-property', String(spec.property));
  await page.fill('#bp-floor', String(spec.floor));
  await page.fill('#bp-slug', slug);
  await page.click('#bp-ok');
  step('project created');

  const files = spec.photos.map((p) => ({ name: basename(p), mimeType: /\.webp$/i.test(p) ? 'image/webp' : /\.png$/i.test(p) ? 'image/png' : 'image/jpeg', buffer: readFileSync(p) }));
  if (files.length === 1) {
    await page.setInputFiles('#ps-file', files[0]);
    await page.waitForSelector('#ps-straighten', { state: 'visible', timeout: 20000 });
    await page.click('#ps-straighten');
    await page.click('#ps-autobuild');
  } else {
    await page.setInputFiles('#ps-multi-file', files);
    for (let i = 0; i < files.length; i++) {
      await page.waitForSelector('#ps-straighten', { state: 'visible', timeout: 30000 });
      await page.click('#ps-straighten');
      await page.click('#ps-next-photo');
      step(`photo ${i + 1} flattened`);
    }
    await page.waitForSelector('#ms-svg', { timeout: 30000 });
    if (await page.locator('#ms-auto-stitch').count()) { await page.click('#ms-auto-stitch'); await page.waitForTimeout(1500); step('auto-stitched'); }
    await page.screenshot({ path: `${outDir}/${slug}.board.png` });
    await page.click('#ms-auto');
  }
  step('autobuild started');
  if (files.length === 1) await page.locator('.ab-ok').click({ timeout: 240000 }); // "Looks right, continue" on the outline question (several photos: no question, each is its own piece)
  await page.waitForFunction(() => window.__app && window.__app.doc && window.__app.doc.items.length > 3 && !document.querySelector('.ab-card'), null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  step('autobuild done');

  const out = await page.evaluate(async () => {
    const { exportSvg } = await import('/js/model/svgExport.js');
    const { exportProjectJson } = await import('/js/store/autosave.js');
    const app = window.__app;
    return { svg: exportSvg(app.doc), json: exportProjectJson(app.project), toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent), review: [...document.querySelectorAll('.ab-review li')].map((l) => l.textContent), validation: (app.validation || []).map((v) => `${v.code}: ${v.message || ''}`) };
  });
  const overlay = await page.evaluate(async () => {
    const app = window.__app, doc = app.doc, ph = app.project.photo;
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = ph.dataUrl; });
    const c = document.createElement('canvas'); c.width = ph.width; c.height = ph.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    g.lineWidth = 2;
    const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    for (const it of doc.items) {
      if (it.type === 'hall') { g.strokeStyle = '#1f6feb'; g.fillStyle = 'rgba(31,111,235,.18)'; g.fillRect(it.x, it.y, it.w, it.h); g.strokeRect(it.x, it.y, it.w, it.h); }
      else if (it.type === 'room') {
        g.strokeStyle = it.number ? '#d6249f' : '#ff8800'; g.fillStyle = 'rgba(214,36,159,.06)';
        if (it.shape === 'poly') { poly(it.points); g.fill(); g.stroke(); } else { g.fillRect(it.x, it.y, it.w, it.h); g.strokeRect(it.x, it.y, it.w, it.h); }
        const b = it.shape === 'poly' ? { x: Math.min(...it.points.map((p) => p[0])), y: Math.min(...it.points.map((p) => p[1])) } : it;
        g.fillStyle = '#d6249f'; g.font = 'bold 14px sans-serif'; g.fillText(it.number || '?', b.x + 3, b.y + 14);
      } else if (it.type === 'stair') { g.strokeStyle = '#2e8b57'; g.strokeRect(it.x, it.y, it.w, it.h); }
      else if (it.type === 'door') { g.strokeStyle = '#00a000'; g.lineWidth = 4; g.beginPath(); g.moveTo(it.x1, it.y1); g.lineTo(it.x2, it.y2); g.stroke(); g.lineWidth = 2; }
      else if (it.type === 'compass') { g.strokeStyle = '#000'; g.beginPath(); g.arc(it.x, it.y, 30, 0, 7); g.stroke(); }
    }
    if (doc.floor) { g.strokeStyle = '#00b050'; g.lineWidth = 4; poly(doc.floor.points); g.stroke(); }
    return c.toDataURL('image/png');
  });
  writeFileSync(`${outDir}/${slug}.overlay.png`, Buffer.from(overlay.split(',')[1], 'base64'));
  writeFileSync(`${outDir}/${slug}.svg`, out.svg);
  const rendered = await page.evaluate(async (svg) => {
    const m = svg.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/), W = m ? +m[3] : 1600, H = m ? +m[4] : 1200;
    const k = Math.min(2, 1800 / Math.max(W, H));
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); });
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }, out.svg);
  writeFileSync(`${outDir}/${slug}.svg.png`, Buffer.from(rendered.split(',')[1], 'base64'));
  writeFileSync(`${outDir}/${slug}.floorplan.json`, out.json);
  log.shots = await page.evaluate(() => (window.__shots || []).map((s, i) => ({ ...s, url: undefined, i })));
  const urls = await page.evaluate(() => (window.__shots || []).map((s) => s.url));
  urls.forEach((u, i) => { if (u) writeFileSync(`${outDir}/${slug}.shot${i}.jpg`, Buffer.from(u.split(',')[1], 'base64')); });
  log.multi = await page.evaluate(() => { const m = window.__app._lastMulti; if (!m) return null; return { transforms: m.transforms, notes: m.notes, report: m.report, plans: m.results.map((r) => ({ scale: r.scale, viewW: r.viewW, viewH: r.viewH, floor: r.floor && r.floor.points, halls: r.items.filter((i) => i.type === 'hall').map((h) => [h.x, h.y, h.w, h.h]), compass: r.items.find((i) => i.type === 'compass') || null, rooms: r.items.filter((i) => i.type === 'room' && i.number).map((q) => q.number) })) }; });
  try { const r = await page.evaluate(() => window.__multiResults || null); if (r) writeFileSync(`${outDir}/${slug}.results.json`, JSON.stringify(r)); } catch { /* none */ }
  log.toast = out.toast; log.review = out.review; log.validation = out.validation;
  await page.locator('#stage').screenshot({ path: `${outDir}/${slug}.plan.png` });
  step('saved');
} catch (e) {
  log.error = String(e && e.stack || e);
  try { const r = await page.evaluate(() => window.__multiResults || null); if (r) writeFileSync(`${outDir}/${slug}.results.json`, JSON.stringify(r)); } catch { /* page gone */ }
  await page.screenshot({ path: `${outDir}/${slug}.error.png` }).catch(() => {});
}
writeFileSync(`${outDir}/${slug}.log.json`, JSON.stringify(log, null, 1));
await browser.close();
console.log(log.error ? `FAILED ${slug}: ${log.error.split('\n')[0]}` : `ok ${slug} -> ${outDir}`);
if (!log.error) { console.log((log.toast || []).join(' | ')); console.log(`validation: ${(log.validation || []).length}`); }
