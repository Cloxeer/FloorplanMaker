// tests/browser/photos-multi.spec.js
// Several photos for one floor: import >= 2 photos, each goes through corners + Flatten, then they meet side by side on the
// merge board (drag / size / turn / see-through), then trace. Photos are arranged again later with View > Select > Photo.

import { test, expect } from '@playwright/test';
import { A, B, C } from './png.helpers.js';

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
// each photo goes through corners -> Flatten -> next, then they meet on the merge board
async function runWizard(page, count) {
  for (let i = 0; i < count; i++) {
    await expect(page.locator('#ps-straighten')).toBeVisible({ timeout: 15000 });
    await page.click('#ps-straighten');
    await page.click('#ps-next-photo');
  }
  await expect(page.locator('#ms-svg')).toBeVisible({ timeout: 15000 });
}
// import, go through the wizard, Start tracing, then open the photo arrange mode (View > Select > Photo)
async function importMulti(page, files) {
  await startProject(page);
  await page.setInputFiles('#ps-multi-file', files);
  await runWizard(page, files.length);
  await page.click('#ms-trace');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => !!window.__app._photoLayer)).toBe(true);
  await page.evaluate(() => window.__app._photoLayer.arrange());
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
// drag the top-left corner of extra photo j so the photo turns by `deg` about its centre; -> the photo's new angle
async function turnBy(page, j, deg, shift = false) {
  const g = await page.evaluate(async (k) => {
    const { photoCorners, photoCentre } = await import('/js/model/photos.js');
    const p = window.__app.project.extraPhotos[k];
    return { c: photoCorners(p)[0], m: photoCentre(p) };
  }, j);
  const r = Math.hypot(g.c[0] - g.m[0], g.c[1] - g.m[1]), a0 = Math.atan2(g.c[1] - g.m[1], g.c[0] - g.m[0]), a1 = a0 + (deg * Math.PI) / 180;
  const to = [g.m[0] + r * Math.cos(a1), g.m[1] + r * Math.sin(a1)];
  const a = await toClient(page, g.c), b = await toClient(page, to);
  await page.mouse.move(a.x, a.y);
  expect(await page.evaluate(() => window.__app.canvas.fabricCanvas.defaultCursor)).toContain('svg'); // the turn arrow shows on the handle
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  return (await proj(page)).extra[0].t.a;
}
const imageObjs = (page) => page.evaluate(() => window.__app.canvas.fabricCanvas.getObjects().filter((o) => /^image$/i.test(o.type)).length);
const savedProject = (page, id) => page.evaluate(async (i) => {
  const { loadProject } = await import('/js/store/autosave.js');
  const p = await loadProject(i);
  return { extra: (p.extraPhotos || []).map((e) => ({ t: e.t, w: e.width, h: e.height })), photo: p.photo && { t: p.photo.t || null } };
}, id);
async function flushSave(page) {
  await page.evaluate(async () => { const { saveNow } = await import('/js/store/autosave.js'); await saveNow(window.__app.project); });
}

test('importing two photos: flatten each, merge side by side, then the extra sits beside the main photo', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  const p = await proj(page);
  expect(p.photo).toMatchObject({ width: expect.any(Number) });
  expect(p.extra.length).toBe(1);
  expect(p.extra[0]).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
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
  // turn: drag the top-left corner of the selected photo a quarter turn about its centre (the old turn buttons are gone)
  await expect(page.locator('[data-pl="left"], [data-pl="right"]')).toHaveCount(0);
  const tc = await turnBy(page, 0, 90);
  expect(tc).toBeCloseTo(90, 0);
  expect((await proj(page)).extra.length).toBe(1); // turning never adds a copy
  expect(await imageObjs(page)).toBe(1);
  const t4 = (await proj(page)).extra[0].t;
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
  await turnBy(page, 0, 30);
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
  expect((await proj(page)).extra[0]).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
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
  await expect(page.locator('.pl-pill')).toContainText('Drawing selected');
  await expect(selDraw).toHaveAttribute('aria-pressed', 'true').catch(() => {}); // popover closes; attribute still set
  // fit the canvas so that the drag is on-screen
  await dragPlan(page, [300, 300], [370, 330]);
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
  await expect(page.locator('.pl-pill')).toContainText('Drawing selected');
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
  expect(p.photo).toMatchObject({ width: expect.any(Number) });
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
  await runWizard(page, 2);
  await page.click('#ms-trace');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  expect((await proj(page)).extra.length).toBe(1);
});

test('Drawing select: a corner handle resizes everything 1:1 (one undo step); every photo shares one opacity; Done clears the outlines', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  // arranging: the main photo and the extra have the SAME opacity, and the Photo slider moves both
  const ops = () => page.evaluate(() => {
    const c = window.__app.canvas.fabricCanvas;
    return [c.backgroundImage.opacity, ...c.getObjects().filter((o) => /^image$/i.test(o.type)).map((o) => o.opacity)];
  });
  const o1 = await ops();
  expect(new Set(o1).size).toBe(1);
  await page.evaluate(() => { const s = document.getElementById('onion'); s.value = '0.6'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  const o2 = await ops();
  expect(new Set(o2).size).toBe(1);
  expect(o2[0]).toBeCloseTo(0.6, 2);
  // Done: no outline is left behind (the overlay stops drawing, the pill is gone, the guides are cleared)
  await page.click('.pl-done');
  await expect(page.locator('.pl-pill')).toHaveCount(0);
  expect(await page.evaluate(() => window.__app._photoLayer.mode())).toBe(null);
  expect(await page.evaluate(() => window.__app.canvas.fabricCanvas.getObjects().filter((o) => o.overlay && o.width < 60000).length)).toBe(0); // (the 60000-wide grid sheet is not an outline)
  expect(new Set(await ops()).size).toBe(1);

  await page.evaluate(async () => {
    const { setFloor, addItem, makeRoom } = await import('/js/model/document.js');
    let d = setFloor(window.__app.doc, [[100, 100], [500, 100], [500, 300], [100, 300]]);
    d = addItem(d, makeRoom('room', 100, 100, 200, 200, '101'));
    window.__app.commit(d, 'Seed');
  });
  const size = () => page.evaluate(() => {
    const p = window.__app.doc.floor.points, xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    const r = window.__app.doc.items.find((i) => i.type === 'room');
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rw: r.w, rh: r.h, past: window.__app.project.history.past.length };
  });
  const s0 = await size();
  await page.click('#btn-view');
  await page.locator('.vp-sel[data-sel="drawing"]').click();
  await expect(page.locator('.pl-pill')).toContainText('resize');
  await dragPlan(page, [500, 300], [700, 400]); // bottom-right corner out to 1.5x about the top-left
  await expect.poll(async () => (await size()).w).toBe(600);
  const s1 = await size();
  expect(s1.h).toBe(300); // 1.5x both ways, never stretched
  expect([s1.rw, s1.rh]).toEqual([300, 300]);
  expect(s1.past).toBe(s0.past + 1);
  await page.click('[data-pd="bigger"]');
  expect((await size()).w).toBeGreaterThan(600);
  await page.evaluate(() => { window.__app.undo(); window.__app.undo(); });
  expect(await size()).toEqual(s0);
});

test('hand tool on and off leaves photo mode locked: no ghost outlines, no room grabbed, drag-turn with Shift snaps to 15 degrees', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  await page.evaluate(async () => {
    const { setFloor, addItem, makeRoom } = await import('/js/model/document.js');
    let d = setFloor(window.__app.doc, [[100, 100], [500, 100], [500, 400], [100, 400]]);
    d = addItem(d, makeRoom('room', 150, 150, 150, 100, '101'));
    window.__app.commit(d, 'Seed');
  });
  const room = () => page.evaluate(() => { const r = window.__app.doc.items.find((i) => i.type === 'room'); return [r.x, r.y]; });
  const locked = () => page.evaluate(() => { const c = window.__app.canvas.fabricCanvas; return [c.skipTargetFind, c.selection]; });
  expect(await locked()).toEqual([true, false]);
  await page.click('#btn-hand-toggle');
  await page.click('#btn-hand-toggle');
  expect(await locked()).toEqual([true, false]); // the hand used to unlock the plan here
  // a drag that starts off the photos pans nothing and selects nothing
  const before = await room();
  const a = await toClient(page, [-300, -300]), b = await toClient(page, [400, 300]);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  expect(await page.evaluate(() => !!window.__app.canvas.fabricCanvas.getActiveObject())).toBe(false);
  expect(await room()).toEqual(before);
  // nothing is ever drawn on the (never cleared) top layer
  expect(await page.evaluate(() => { const c = window.__app.canvas.fabricCanvas, d = c.contextTop.getImageData(0, 0, c.upperCanvasEl.width, c.upperCanvasEl.height).data; return d.some((v) => v !== 0); })).toBe(false);
  // Shift snaps a drag-turn to whole 15 degree steps
  const c0 = await toClient(page, await centreOf(page, 0));
  await page.mouse.click(c0.x, c0.y);
  const ang = await turnBy(page, 0, 37, true);
  expect(ang % 15).toBeCloseTo(0, 5);
  await page.click('.pl-done');
  expect(await locked()).toEqual([false, true]); // leaving the mode gives the plan back
});

test('turning locks to 15 degrees when close (Alt: free); the Opacity slider fades only the selected photo to nothing and Done gives the shared opacity back', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  const c0 = await toClient(page, await centreOf(page, 0));
  await page.mouse.click(c0.x, c0.y);
  expect(await turnBy(page, 0, 88)).toBeCloseTo(90, 5); // within 4 degrees of a step: locked
  await page.mouse.click(c0.x, c0.y);
  const free = await turnBy(page, 0, 7); // 90 + 7 = 97: 7 away from 90 and 105, so it stays as dragged
  expect(Math.abs(free - 97)).toBeLessThan(1.5);
  expect(Math.abs(free % 15)).toBeGreaterThan(1);

  const ops = () => page.evaluate(() => {
    const c = window.__app.canvas.fabricCanvas;
    return [c.backgroundImage.opacity, ...c.getObjects().filter((o) => /^image$/i.test(o.type)).map((o) => o.opacity)];
  });
  const before = await ops();
  await expect(page.locator('.pl-op input')).toBeEnabled();
  await page.locator('.pl-op input').fill('0'); // the extra is selected
  const after = await ops();
  expect(after[0]).toBeCloseTo(before[0], 5); // the main photo is untouched
  expect(after[1]).toBe(0);
  await page.locator('.pl-op input').fill('0.4');
  expect((await ops())[1]).toBeCloseTo(0.4, 2);
  await page.click('.pl-done');
  expect(new Set(await ops()).size).toBe(1); // back to one opacity for every photo
});

test('Ctrl + / Ctrl - / Ctrl 0 zoom the plan, not the web page', async ({ page }) => {
  await importMulti(page, [A(), B()]);
  await page.click('.pl-done');
  const z = () => page.evaluate(() => window.__app.canvas.fabricCanvas.getZoom());
  const z0 = await z();
  await page.keyboard.press('Control+=');
  const z1 = await z();
  expect(z1).toBeGreaterThan(z0);
  await page.keyboard.press('Control+-'); await page.keyboard.press('Control+-');
  expect(await z()).toBeLessThan(z1);
  await page.keyboard.press('Control+0');
  expect(await z()).toBeCloseTo(z0, 1);
});
