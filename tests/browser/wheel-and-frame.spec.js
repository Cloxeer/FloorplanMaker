// tests/browser/wheel-and-frame.spec.js
// 1. The map: a two-finger drag (slow OR a fast flick) moves it, a pinch and a mouse-wheel notch zoom it.
// 2. Drawing select: the frame travels with the drawing while it is moved or resized, and is gone after Done.

import { test, expect } from '@playwright/test';

async function openStudio(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  await page.goto('/#/new');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Wheel Test'); await page.fill('#bp-property', '1'); await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await page.click('#ps-skip-initial');
  await expect(page.locator('#studio')).toBeVisible();
  await page.evaluate(async () => {
    const { setFloor, addItem, makeRoom } = await import('/js/model/document.js');
    let d = setFloor(window.__app.doc, [[100, 100], [500, 100], [500, 300], [100, 300]]);
    d = addItem(d, makeRoom('room', 100, 100, 200, 200, '101'));
    window.__app.commit(d, 'Seed');
  });
  return errors;
}

// dispatch wheel events the way a trackpad / mouse would, `gap` ms apart
const wheels = (page, list, gap, extra = {}) => page.evaluate(async ({ list, gap, extra }) => {
  const u = window.__app.canvas.fabricCanvas.upperCanvasEl, r = u.getBoundingClientRect();
  for (const [dx, dy] of list) {
    u.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaX: dx, deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, ...extra }));
    await new Promise((res) => setTimeout(res, gap));
  }
}, { list, gap, extra });
const vt = (page) => page.evaluate(() => [...window.__app.canvas.fabricCanvas.viewportTransform]);
const settle = (page) => page.waitForTimeout(150);

test('two-finger drag (slow or a fast flick) moves the map; pinch and wheel notch zoom it', async ({ page }) => {
  const errors = await openStudio(page);
  let a = await vt(page);
  await wheels(page, [[0, 3], [0, 7], [0, 12], [0, 20], [0, 31], [0, 40]], 8);
  await settle(page);
  let b = await vt(page);
  expect(b[5]).toBeLessThan(a[5] - 50); // moved
  expect(b[0]).toBeCloseTo(a[0], 6); // not zoomed

  // a fast flick: big whole numbers a few ms apart used to be mistaken for a wheel and zoom out
  await wheels(page, [[0, 60], [0, 90], [0, 130], [0, 160], [0, 180], [0, 160]], 8);
  await settle(page);
  let c = await vt(page);
  expect(c[5]).toBeLessThan(b[5] - 300);
  expect(c[0]).toBeCloseTo(b[0], 6);

  // sideways drag moves left / right
  await wheels(page, [[40, 0], [60, 0], [80, 0]], 8);
  await settle(page);
  const c2 = await vt(page);
  expect(c2[4]).toBeLessThan(c[4] - 100);

  // pinch (ctrl + small deltas): out then in
  await wheels(page, [[0, 8], [0, 8]], 10, { ctrlKey: true });
  await settle(page);
  const d = await vt(page);
  expect(d[0]).toBeLessThan(c2[0]);
  await wheels(page, [[0, -8], [0, -8]], 10, { ctrlKey: true });
  await settle(page);
  const e = await vt(page);
  expect(e[0]).toBeGreaterThan(d[0]);

  // a lone mouse wheel notch zooms
  await page.waitForTimeout(300);
  await wheels(page, [[0, -100]], 10);
  await settle(page);
  const f = await vt(page);
  expect(f[0]).toBeGreaterThan(e[0]);
  await page.waitForTimeout(300);
  await wheels(page, [[0, 100]], 10);
  await settle(page);
  expect((await vt(page))[0]).toBeLessThan(f[0]);
  expect(errors).toEqual([]);
});

test('Drawing select: the frame moves with the drawing while dragging and resizing, and is gone after Done', async ({ page }) => {
  const errors = await openStudio(page);
  await page.click('#btn-view');
  await page.locator('.vp-sel[data-sel="drawing"]').click();
  await expect(page.locator('.pl-pill')).toContainText('Drawing selected');
  const frame = () => page.evaluate(() => window.__app._photoLayer.frame());
  const toClient = (p) => page.evaluate(([x, y]) => {
    const c = window.__app.canvas.fabricCanvas, r = c.upperCanvasEl.getBoundingClientRect(), v = c.viewportTransform;
    return { x: r.left + x * v[0] + v[4], y: r.top + y * v[3] + v[5] };
  }, p);
  const f0 = await frame();
  expect(f0).toMatchObject({ x: 100, y: 100, w: 400, h: 200 });

  // move: press inside the drawing, drag, and look at the frame BEFORE letting go
  const from = await toClient([300, 200]), to = await toClient([380, 250]);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  const mid = await frame();
  expect(mid.x).toBeGreaterThan(f0.x + 40); // the frame went with the drawing
  expect(mid.y).toBeGreaterThan(f0.y + 20);
  await page.mouse.up();
  const f1 = await frame();
  expect(f1).toMatchObject({ w: 400, h: 200 });
  expect(f1.x).toBe(mid.x);

  // resize from the bottom-right corner: the frame follows the cursor before release
  const corner = await toClient([f1.x + f1.w, f1.y + f1.h]), out = await toClient([f1.x + f1.w * 1.5, f1.y + f1.h * 1.5]);
  await page.mouse.move(corner.x, corner.y); await page.mouse.down();
  await page.mouse.move((corner.x + out.x) / 2, (corner.y + out.y) / 2, { steps: 4 });
  await page.mouse.move(out.x, out.y, { steps: 4 });
  const growing = await frame();
  expect(growing.w).toBeGreaterThan(500);
  expect(growing.w / growing.h).toBeCloseTo(2, 2); // 1:1, never stretched
  await page.mouse.up();
  const f2 = await frame();
  expect(f2.w / f2.h).toBeCloseTo(2, 1);

  await page.click('.pl-done');
  await expect(page.locator('.pl-pill')).toHaveCount(0);
  expect(await page.evaluate(() => window.__app._photoLayer.mode())).toBe(null);
  expect(await frame()).toMatchObject({ w: expect.any(Number) }); // still computable, but nothing draws it
  expect(errors).toEqual([]);
});
