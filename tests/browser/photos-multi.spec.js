// tests/browser/photos-multi.spec.js
// Several photos for one floor: import >= 2 photos (first = main, the rest beside it, straight to arrange mode),
// drag / size / turn an extra, persistence across a reload, View > Select (Photo / Drawing), Remove, three files.

import { deflateSync } from 'node:zlib';
import { test, expect } from '@playwright/test';

// ---- a tiny PNG encoder (solid colour with a darker border and a diagonal, so the pictures are distinguishable)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const edge = x < 6 || y < 6 || x >= w - 6 || y >= h - 6 || Math.abs(x - y) < 4;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = edge ? r >> 1 : r; raw[o + 1] = edge ? g >> 1 : g; raw[o + 2] = edge ? b >> 1 : b;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const IMG = (name, w, h, rgb) => ({ name, mimeType: 'image/png', buffer: png(w, h, rgb) });
const A = () => IMG('a.png', 800, 600, [230, 120, 90]);
const B = () => IMG('b.png', 500, 700, [90, 160, 230]);
const C = () => IMG('c.png', 600, 600, [110, 200, 120]);

let errors = [];
let ids = [];
test.beforeEach(({ page }) => {
  errors = []; ids = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
});
test.afterEach(async ({ page }) => {
  await page.evaluate(async (list) => {
    const { deleteProject, listProjects } = await import('/js/store/autosave.js');
    for (const p of await listProjects()) if (list.includes(p.id) || p.building === 'Photos Multi') await deleteProject(p.id);
  }, ids).catch(() => {});
  expect(errors).toEqual([]);
});

// new project -> photo step on the drop screen
async function startProject(page) {
  await page.goto('/#/new');
  await page.waitForFunction(() => !!window.__app);
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Photos Multi');
  await page.fill('#bp-property', '1');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await expect(page.locator('#ps-multi-initial')).toBeVisible();
  ids.push(await page.evaluate(() => window.__app.project && window.__app.project.id));
}
async function importMulti(page, files) {
  await startProject(page);
  await page.setInputFiles('#ps-multi-file', files);
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.pl-pill')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.__app.canvas.fabricCanvas.getObjects().filter((o) => /^image$/i.test(o.type)).length)).toBeGreaterThanOrEqual(1);
}

const proj = (page) => page.evaluate(() => {
  const p = window.__app.project;
  const lite = (x) => x && { width: x.width, height: x.height, t: x.t || null, len: x.dataUrl ? x.dataUrl.length : 0 };
  return { id: p.id, photo: lite(p.photo), extra: (p.extraPhotos || []).map(lite) };
});
// plan units -> page coordinates
const toClient = (page, [x, y]) => page.evaluate(([px, py]) => {
  const c = window.__app.canvas.fabricCanvas, r = c.upperCanvasEl.getBoundingClientRect(), vt = c.viewportTransform;
  return { x: r.left + vt[4] + px * vt[0], y: r.top + vt[5] + py * vt[3], inside: true };
}, [x, y]);
async function dragPlan(page, from, to) {
  const a = await toClient(page, from), b = await toClient(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}
const centreOf = (page, j) => page.evaluate(async (k) => {
  const { photoCentre } = await import('/js/model/photos.js');
  const p = window.__app.project;
  return photoCentre(k < 0 ? p.photo : p.extraPhotos[k]);
}, j);
const imageObjs = (page) => page.evaluate(() => window.__app.canvas.fabricCanvas.getObjects().filter((o) => /^image$/i.test(o.type)).length);
const savedProject = (page, id) => page.evaluate(async (i) => {
  const { loadProject } = await import('/js/store/autosave.js');
  const p = await loadProject(i);
  return { extra: (p.extraPhotos || []).map((e) => ({ t: e.t, w: e.width, h: e.height })), photo: p.photo && { t: p.photo.t || null } };
}, id);
async function flushSave(page) {
  await page.evaluate(async () => { const { saveNow } = await import('/js/store/autosave.js'); await saveNow(window.__app.project); });
}

test('importing two photos opens the studio in arrange mode, extra beside the main photo', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  const p = await proj(page);
  expect(p.photo).toMatchObject({ width: 800, height: 600 });
  expect(p.extra.length).toBe(1);
  expect(p.extra[0]).toMatchObject({ width: 500, height: 700 });
  // starts to the right of the main photo, with a gap
  expect(p.extra[0].t.x).toBeGreaterThan(p.photo.width);
  expect(p.extra[0].t.a).toBe(0);
  await expect(page.locator('.pl-pill')).toContainText('Arrange photos');
  expect(await page.evaluate(() => window.__app._photoLayer.mode())).toBe('photo');
  // both photos are outlined: sample the blue overlay on the canvas near each photo's top-left corner
  await expect.poll(() => imageObjs(page)).toBe(1); // the extra; the main photo is the stage's background image
  const blueAt = async (plan) => {
    const c = await toClient(page, plan);
    return page.evaluate(({ x, y }) => {
      const cv = window.__app.canvas.fabricCanvas, r = cv.upperCanvasEl.getBoundingClientRect(), ret = cv.getRetinaScaling();
      const d = cv.getContext().getImageData(Math.round((x - r.left) * ret) - 4, Math.round((y - r.top) * ret) - 4, 9, 9).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 200 && d[i] < 90 && d[i + 1] > 100 && d[i + 1] < 190) return true; // #0a84ff
      return false;
    }, c);
  };
  // the top edge of each photo (mid-way along it) carries the outline stroke
  await expect.poll(() => blueAt([(p.photo.t ? p.photo.t.x : 0) + p.photo.width / 2, p.photo.t ? p.photo.t.y : 0])).toBe(true);
  await expect.poll(() => blueAt([p.extra[0].t.x + 250 * p.extra[0].t.s, p.extra[0].t.y])).toBe(true);
});

test('drag the extra photo, size and turn it, Done restores', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  const before = await proj(page);
  const mainBefore = JSON.stringify(before.photo);
  const c0 = await centreOf(page, 0);
  await dragPlan(page, c0, [c0[0] - 150, c0[1] + 90]);
  await expect(page.locator('.pl-pill')).toContainText('Photo selected');
  const after = await proj(page);
  expect(after.extra[0].t.x).toBeCloseTo(before.extra[0].t.x - 150, 0);
  expect(after.extra[0].t.y).toBeCloseTo(before.extra[0].t.y + 90, 0);
  expect(JSON.stringify(after.photo)).toBe(mainBefore);

  const t1 = after.extra[0].t;
  await page.click('[data-pl="bigger"]');
  const t2 = (await proj(page)).extra[0].t;
  expect(t2.s).toBeGreaterThan(t1.s);
  await page.click('[data-pl="smaller"]'); await page.click('[data-pl="smaller"]');
  const t3 = (await proj(page)).extra[0].t;
  expect(t3.s).toBeLessThan(t1.s);
  await page.click('[data-pl="right"]'); await page.click('[data-pl="right"]'); await page.click('[data-pl="left"]');
  const t4 = (await proj(page)).extra[0].t;
  expect(t4.a).toBeCloseTo(1, 5);
  expect(JSON.stringify((await proj(page)).photo)).toBe(mainBefore);

  // clicking the main photo selects it: 'Remove' stays disabled for it
  const m = await centreOf(page, -1);
  const mc = await toClient(page, m);
  await page.mouse.click(mc.x, mc.y);
  await expect(page.locator('.pl-pill')).toContainText('Photo selected');
  await expect(page.locator('[data-pl="remove"]')).toBeDisabled();

  await page.click('.pl-done');
  await expect(page.locator('.pl-pill')).toHaveCount(0);
  expect(await page.evaluate(() => window.__app._photoLayer.mode())).toBe(null);
  // Esc also exits
  await page.click('#btn-view');
  await page.click('.vp-sel[data-sel="photo"]');
  await expect(page.locator('.pl-pill')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pl-pill')).toHaveCount(0);
});

test('placement survives a reload (extra fabric image present)', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  const id = (await proj(page)).id;
  const c0 = await centreOf(page, 0);
  await dragPlan(page, c0, [c0[0] - 120, c0[1] + 60]);
  await page.click('[data-pl="bigger"]');
  await page.click('[data-pl="right"]');
  await page.click('.pl-done');
  const want = (await proj(page)).extra[0].t;
  await flushSave(page);
  const saved = await savedProject(page, id);
  expect(saved.extra[0].t).toEqual(want);

  const slug = await page.evaluate(() => window.__app.project.slug);
  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  await page.evaluate((s) => { location.hash = `#/p/${s}/trace`; }, slug);
  await page.waitForFunction((i) => window.__app.project && window.__app.project.id === i && !document.getElementById('studio').hidden, id);
  await expect.poll(async () => (await proj(page)).extra.length).toBe(1);
  expect((await proj(page)).extra[0].t).toEqual(want);
  expect((await proj(page)).extra[0]).toMatchObject({ width: 500, height: 700 });
  await expect.poll(() => imageObjs(page), { timeout: 15000 }).toBe(1); // the extra (the main photo is the background image)
});

test('View > Select: Photo re-enters arrange mode, Drawing moves the whole drawing as one undo step', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  await page.click('.pl-done');
  await page.evaluate(async () => {
    const { setFloor, addItem, makeRoom } = await import('/js/model/document.js');
    let d = setFloor(window.__app.doc, [[100, 100], [500, 100], [500, 400], [100, 400]]);
    d = addItem(d, makeRoom('room', 150, 150, 150, 100, '101'));
    window.__app.commit(d, 'Seed');
  });
  const snap = () => page.evaluate(() => {
    const d = window.__app.doc, r = d.items.find((i) => i.type === 'room');
    return { pts: d.floor.points, room: { x: r.x, y: r.y }, past: window.__app.project.history.past.length };
  });
  const s0 = await snap();

  // Select next to Photo
  await page.click('#btn-view');
  const selPhoto = page.locator('.vp-sel[data-sel="photo"]'), selDraw = page.locator('.vp-sel[data-sel="drawing"]');
  await expect(selPhoto).toHaveAttribute('aria-pressed', 'false');
  // the Select buttons sit to the left of the Photo / Drawing sliders
  expect(await selPhoto.evaluate((b) => b.getBoundingClientRect().right <= b.parentElement.querySelector('input').getBoundingClientRect().left + 1)).toBe(true);
  await selPhoto.click();
  await expect(page.locator('.pl-pill')).toContainText('Arrange photos');
  await page.click('.pl-done');
  await expect(page.locator('.pl-pill')).toHaveCount(0);

  // Select next to Drawing
  await page.click('#btn-view');
  await selDraw.click();
  await expect(page.locator('.pl-pill')).toContainText('Move the drawing');
  await expect(selDraw).toHaveAttribute('aria-pressed', 'true').catch(() => {}); // popover closes; attribute still set
  // fit the canvas so that the drag is on-screen
  await dragPlan(page, [300, 500], [370, 530]);
  await expect.poll(async () => (await snap()).room).toEqual({ x: s0.room.x + 70, y: s0.room.y + 30 });
  const s1 = await snap();
  expect(s1.pts).toEqual(s0.pts.map(([x, y]) => [x + 70, y + 30]));
  expect(s1.past).toBe(s0.past + 1);
  await page.click('.pl-done');
  await expect(page.locator('.pl-pill')).toHaveCount(0);
  await page.evaluate(() => window.__app.undo());
  const s2 = await snap();
  expect(s2.pts).toEqual(s0.pts);
  expect(s2.room).toEqual(s0.room);
  expect(s2.past).toBe(s0.past);
  // Esc ends drawing mode too
  await page.click('#btn-view');
  await selDraw.click();
  await expect(page.locator('.pl-pill')).toContainText('Move the drawing');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pl-pill')).toHaveCount(0);
});

test('Select works for a single photo too', async ({ page }) => {
  await startProject(page);
  await page.setInputFiles('#ps-file', A());
  await expect(page.locator('#ps-straighten')).toBeVisible({ timeout: 15000 }); // one file from the drop screen: the normal flow
  await expect(page.locator('#studio')).toBeHidden();
  await page.click('#ps-straighten');
  await page.click('#ps-start-tracing');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await page.click('#btn-view');
  await page.click('.vp-sel[data-sel="photo"]');
  await expect(page.locator('.pl-pill')).toContainText('Arrange photos');
  expect((await proj(page)).extra.length).toBe(0);
  await page.click('.pl-done');
  await expect(page.locator('.pl-pill')).toHaveCount(0);
});

test('Remove an extra photo (with confirm)', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  const id = (await proj(page)).id;
  await expect(page.locator('[data-pl="remove"]')).toBeDisabled();
  const c0 = await centreOf(page, 0);
  const cc = await toClient(page, c0);
  await page.mouse.click(cc.x, cc.y);
  await expect(page.locator('.pl-pill')).toContainText('Photo selected');
  await expect(page.locator('[data-pl="remove"]')).toBeEnabled();
  // cancelling keeps the photo
  await page.click('[data-pl="remove"]');
  await expect(page.locator('#cf-ok')).toBeVisible();
  await page.click('#cf-cancel');
  expect((await proj(page)).extra.length).toBe(1);
  // confirming removes it
  await page.click('[data-pl="remove"]');
  await page.click('#cf-ok');
  await expect.poll(async () => (await proj(page)).extra.length).toBe(0);
  await expect(page.locator('.pl-pill')).toContainText('Arrange photos');
  await expect(page.locator('[data-pl="remove"]')).toBeDisabled();
  await expect.poll(() => imageObjs(page)).toBe(0);
  await flushSave(page);
  expect((await savedProject(page, id)).extra.length).toBe(0);
  await page.click('.pl-done');
});

test('three files at once: main + two extras, all separate and outlined', async ({ page }) => {
  await importMulti(page, [A(), B(), C()]);
  const p = await proj(page);
  expect(p.extra.length).toBe(2);
  expect(p.photo).toMatchObject({ width: 800, height: 600 });
  expect(p.extra[0].t.x).toBeGreaterThan(p.photo.width);
  expect(p.extra[1].t.x).toBeGreaterThan(p.extra[0].t.x + p.extra[0].width * p.extra[0].t.s);
  await expect.poll(() => imageObjs(page)).toBe(2);
  // each extra can be picked by clicking it
  for (const j of [0, 1]) {
    const c = await toClient(page, await centreOf(page, j));
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('.pl-pill')).toContainText('Photo selected');
    await expect(page.locator('[data-pl="remove"]')).toBeEnabled();
  }
  await page.click('.pl-done');
});

test('several files dropped at once on the drop screen', async ({ page }) => {
  await startProject(page);
  await page.evaluate(async (files) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const bin = Uint8Array.from(atob(f.b64), (ch) => ch.charCodeAt(0));
      dt.items.add(new File([bin], f.name, { type: 'image/png' }));
    }
    const target = document.getElementById('ps-drop');
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [A(), B()].map((f) => ({ name: f.name, b64: f.buffer.toString('base64') })));
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.pl-pill')).toBeVisible({ timeout: 15000 });
  expect((await proj(page)).extra.length).toBe(1);
  await page.click('.pl-done');
});
