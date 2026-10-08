// tests/browser/drag-feel.spec.js
// How dragging feels on the stage: a drag that starts in the empty floor is a selection box (only the outline's wall
// grabs the outline), a click with a shaky hand moves nothing and adds no undo step, a drawn box stays on the plan
// until the room exists, the room tool hands back to Select, and a moved room stays close to the pointer at any zoom.

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup } from './building.helpers.js';

const SLUG = 'drag-feel-1';
let ids = [];
test.beforeEach(async ({ page }) => { ids = []; await openApp(page); });
test.afterEach(async ({ page }) => { await cleanup(page, ids); });

async function setup(page) {
  const p = await seedProject(page, { building: 'Drag Feel', floor: 1, slug: SLUG, outline: [[100, 100], [900, 100], [900, 700], [100, 700]] });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await page.evaluate(async () => {
    const m = await import('/js/model/document.js');
    const app = window.__app;
    const items = [
      m.makeRoom('room', 150, 150, 200, 150, '101'),
      m.makeRoom('room', 400, 150, 200, 150, '102'),
      m.makeRoom('room', 650, 150, 200, 150, '103'),
      m.makeRoom('room', 150, 500, 200, 150, '104'),
    ];
    app.replaceDoc({ ...app.doc, items });
    app.setTool('select');
    app.canvas.zoomTo(true);
    const o = document.getElementById('start-overlay');
    if (o) o.style.display = 'none';
  });
  await page.waitForTimeout(200);
}
// plan point -> client pixels
const at = (page, x, y) => page.evaluate(([px, py]) => {
  const c = window.__app.canvas.fabricCanvas, r = c.upperCanvasEl.getBoundingClientRect(), v = c.viewportTransform;
  return [r.left + v[4] + px * v[0], r.top + v[5] + py * v[3]];
}, [x, y]);
const selected = (page) => page.evaluate(() => {
  const a = window.__app;
  return [...a.selection].map((id) => (id === 'floor' ? 'floor' : (a.doc.items.find((i) => i.id === id) || {}).number));
});
const drag = async (page, from, to, steps = 10) => {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
  await page.mouse.up();
};

test('a drag from the empty floor is a selection box; only the wall selects the outline', async ({ page }) => {
  await setup(page);
  await drag(page, await at(page, 120, 120), await at(page, 640, 320));
  expect((await selected(page)).sort()).toEqual(['101', '102']); // the box touches 101 and 102, not 103; the outline stays out of it
  const wall = await at(page, 100, 400);
  await page.mouse.click(wall[0], wall[1]);
  expect(await selected(page)).toEqual(['floor']);
  const floor = await at(page, 500, 420);
  await page.mouse.click(floor[0], floor[1]);
  expect(await selected(page)).toEqual([]);
  // a box that holds the whole building still takes the outline with it
  await drag(page, await at(page, 40, 40), await at(page, 960, 760));
  expect((await selected(page)).sort()).toEqual(['101', '102', '103', '104', 'floor']);
});

test('a click with a shaky hand moves nothing and adds no undo step', async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(() => ({ past: window.__app.project.history.past.length, r: window.__app.doc.items.find((i) => i.number === '101') }));
  const c = await at(page, 250, 225);
  await page.mouse.move(c[0], c[1]);
  await page.mouse.down();
  await page.mouse.move(c[0] + 1, c[1] + 1);
  await page.mouse.move(c[0], c[1] + 1);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ past: window.__app.project.history.past.length, r: window.__app.doc.items.find((i) => i.number === '101') }));
  expect(after.past).toBe(before.past);
  expect({ x: after.r.x, y: after.r.y }).toEqual({ x: before.r.x, y: before.r.y });
  expect(await selected(page)).toEqual(['101']);
});

test('a room box stays on the plan while its number is asked for, and the tool then goes back to Select', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.__app.setTool('room'));
  const dashed = () => page.evaluate(() => window.__app.canvas.fabricCanvas.getObjects().filter((o) => o.overlay && o.strokeDashArray).length);
  await drag(page, await at(page, 450, 400), await at(page, 600, 500));
  await expect(page.locator('#pr-value')).toBeVisible();
  expect(await dashed()).toBe(1); // the drawn box has not vanished
  await page.keyboard.press('Escape');
  await expect(page.locator('#pr-value')).toBeHidden();
  expect(await dashed()).toBe(0);
  expect(await page.evaluate(() => window.__app.toolName)).toBe('room'); // cancelled: still drawing, try again
  await drag(page, await at(page, 450, 400), await at(page, 600, 500));
  await page.fill('#pr-value', '105');
  await page.click('#pr-ok');
  await expect.poll(() => page.evaluate(() => window.__app.doc.items.some((i) => i.number === '105'))).toBe(true);
  expect(await dashed()).toBe(0);
  expect(await page.evaluate(() => window.__app.toolName)).toBe('select');
  // and a drag on the new room now moves it instead of drawing another box
  const room = await page.evaluate(() => window.__app.doc.items.find((i) => i.number === '105'));
  const c = await at(page, room.x + room.w / 2, room.y + room.h / 2);
  await drag(page, c, [c[0] + 60, c[1] + 30]);
  await page.waitForTimeout(200);
  const moved = await page.evaluate(() => ({ n: window.__app.doc.items.filter((i) => i.type === 'room').length, r: window.__app.doc.items.find((i) => i.number === '105') }));
  expect(moved.n).toBe(5);
  expect(moved.r.x).toBeGreaterThan(room.x);
});

test('a dragged room stays within a few pixels of the pointer at every zoom', async ({ page }) => {
  await setup(page);
  for (const zoom of [0.5, 1, 3]) {
    const start = await page.evaluate((z) => {
      const app = window.__app, c = app.canvas.fabricCanvas;
      const room = app.doc.items.find((i) => i.number === '104');
      app.canvas.setView({ zoom: z, x: room.x - 60, y: room.y - 60 });
      const obj = c.getObjects().find((o) => o.itemId === room.id);
      const r = c.upperCanvasEl.getBoundingClientRect(), v = c.viewportTransform;
      window.__obj = obj;
      return { x: r.left + v[4] + (obj.left + obj.width / 2) * v[0], y: r.top + v[5] + (obj.top + obj.height / 2) * v[3], z, left: obj.left, id: room.id };
    }, zoom);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    let worst = 0;
    for (let i = 1; i <= 60; i += 1) {
      await page.mouse.move(start.x + i, start.y);
      const off = await page.evaluate(([l0, z, n]) => Math.abs((window.__obj.left - l0) * z - n), [start.left, start.z, i]);
      worst = Math.max(worst, off);
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect(worst, `zoom ${zoom}`).toBeLessThanOrEqual(7);
    await page.evaluate(() => window.__app.undo());
    await page.waitForTimeout(150);
  }
});

test('Space or the hand tool carries the map: nothing under the pointer moves, is grabbed or is deselected', async ({ page }) => {
  await setup(page);
  const state = () => page.evaluate(() => {
    const a = window.__app;
    return { view: a.canvas.getView(), past: a.project.history.past.length, r: a.doc.items.map((i) => [i.number, i.x, i.y]), sel: [...a.selection].length };
  });
  const room = await page.evaluate(() => window.__app.doc.items.find((i) => i.number === '102'));
  await page.evaluate((id) => window.__app.setSelection([id]), room.id);
  const over = await at(page, room.x + room.w / 2, room.y + room.h / 2); // right on a room
  for (const how of ['space', 'hand']) {
    const before = await state();
    if (how === 'space') await page.keyboard.down('Space'); else await page.evaluate(() => window.__app.setTool('pan'));
    await drag(page, over, [over[0] + 80, over[1] + 50], 8);
    if (how === 'space') await page.keyboard.up('Space'); else await page.evaluate(() => window.__app.setTool('select'));
    await page.waitForTimeout(150);
    const after = await state();
    expect(after.r, how).toEqual(before.r); // no room moved
    expect(after.past, how).toBe(before.past); // no undo step
    expect(after.sel, how).toBe(1); // the selection stayed
    expect(after.view.x, how).toBeLessThan(before.view.x); // the map went with the pointer
    expect(after.view.y, how).toBeLessThan(before.view.y);
    await page.evaluate(() => window.__app.canvas.zoomTo(true));
  }
  // Space let go is really let go: the next press on a room selects / moves it again
  await page.mouse.click(over[0], over[1]);
  expect(await selected(page)).toEqual(['102']);
});

test('Navigation Mouse (the default): whatever the wheel sends, it zooms; sideways scroll moves the map; Trackpad brings back two-finger moves', async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(() => window.__app.navMode)).toBe('mouse');
  const send = (dy, o = {}) => page.evaluate(([d, opt]) => {
    const st = document.getElementById('stage'), r = st.getBoundingClientRect();
    const e = new WheelEvent('wheel', { deltaY: d, deltaX: opt.dx || 0, deltaMode: opt.mode || 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
    if (opt.wd !== undefined) Object.defineProperty(e, 'wheelDeltaY', { value: opt.wd });
    st.dispatchEvent(e);
  }, [dy, o]);
  const view = () => page.evaluate(() => window.__app.canvas.getView());
  const reset = async () => { await page.evaluate(() => window.__app.canvas.setView({ zoom: 1, x: 0, y: 0 })); await page.waitForTimeout(400); };
  for (const [name, dy, o] of [['notch 100', 100, { wd: -120 }], ['notch 66.67 (150% scaling)', 66.67, { wd: -120 }], ['odd 53 with no wheelDelta', 53, {}], ['lines mode', 3, { mode: 1 }]]) {
    await reset();
    await send(dy, o);
    await page.waitForTimeout(600);
    const v = await view();
    expect(v.zoom, name).toBeLessThan(0.97);
    expect(v.zoom, name).toBeGreaterThan(0.85);
  }
  // a free-spinning / smooth-scroll mouse: many small events in a burst, each a few pixels
  await reset();
  for (let i = 0; i < 30; i += 1) { await send(10); await page.waitForTimeout(8); }
  await page.waitForTimeout(700);
  expect((await view()).zoom).toBeLessThan(0.85);
  await reset();
  for (let i = 0; i < 30; i += 1) { await send(-10); await page.waitForTimeout(8); }
  await page.waitForTimeout(700);
  expect((await view()).zoom).toBeGreaterThan(1.2);
  // sideways scroll is a trackpad: it moves the map, it does not zoom
  await reset();
  const x0 = (await view()).x;
  await send(0, { dx: 20 }); await send(0, { dx: 20 });
  await page.waitForTimeout(300);
  const v = await view();
  expect(v.zoom).toBeCloseTo(1, 3);
  expect(v.x).toBeGreaterThan(x0);
  // View > Navigation: Trackpad -> a two-finger stream moves the map, and the choice is remembered
  await page.click('#btn-view');
  await page.click('#nav-trackpad');
  expect(await page.evaluate(() => [window.__app.navMode, localStorage.getItem('fp.navMode')])).toEqual(['trackpad', 'trackpad']);
  await reset();
  const y0 = (await view()).y;
  for (const [d, w] of [[9, -10], [14, -17], [22, -26]]) { await send(d, { wd: w }); await page.waitForTimeout(16); }
  await page.waitForTimeout(300);
  expect((await view()).zoom).toBeCloseTo(1, 3);
  expect((await view()).y).toBeGreaterThan(y0);
  await page.reload();
  await page.waitForFunction(() => !!window.__app && window.__app.navMode);
  expect(await page.evaluate(() => window.__app.navMode)).toBe('trackpad');
});
