// tests/browser/outline-edit.spec.js
// "Edit outline": move a corner / wall, add a corner by clicking a wall, remove one by double-click,
// one undo step per gesture, Esc exits, self-intersection is reverted with a toast, doors follow their wall,
// and the hand button lights up while the middle button is held.

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup } from './building.helpers.js';

const SLUG = 'oe-test-1';

let ids = [];
test.beforeEach(async ({ page }) => { ids = []; await openApp(page); });
test.afterEach(async ({ page }) => { await cleanup(page, ids); });

const pts = (page) => page.evaluate(() => window.__app.doc.floor && window.__app.doc.floor.points);
const pastLen = (page) => page.evaluate(() => window.__app.project.history.past.length);

// plan units -> page coordinates of the canvas
async function toClient(page, [x, y]) {
  return page.evaluate(([px, py]) => {
    const c = window.__app.canvas.fabricCanvas, r = c.upperCanvasEl.getBoundingClientRect(), vt = c.viewportTransform;
    return { x: r.left + vt[4] + px * vt[0], y: r.top + vt[5] + py * vt[3] };
  }, [x, y]);
}
async function drag(page, from, to) {
  const a = await toClient(page, from), b = await toClient(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}
async function setup(page, extra = {}) {
  const p = await seedProject(page, { building: 'Outline Test', floor: 1, slug: SLUG, outline: true, ...extra });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await page.click('#btn-edit-outline');
  await expect(page.locator('.oe-pill')).toBeVisible();
}

test('button is hidden until an outline exists, then toggles edit mode', async ({ page }) => {
  const p = await seedProject(page, { building: 'Outline Test', floor: 1, slug: SLUG, outline: false });
  ids.push(p.id);
  await openTrace(page, SLUG);
  const btn = page.locator('#btn-edit-outline');
  await expect(btn).toBeHidden();
  await page.evaluate(async () => {
    const { setFloor } = await import('/js/model/document.js');
    window.__app.commit(setFloor(window.__app.doc, [[100, 100], [500, 100], [500, 400], [100, 400]]), 'Outline');
  });
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('Edit outline');
  // sits right under "Redraw the outline" (and Auto-outline, which is hidden while the plan is empty)
  const prev = await btn.evaluate((b) => b.previousElementSibling && b.previousElementSibling.id);
  expect(['btn-tool-floor', 'btn-auto-outline']).toContain(prev);
  await btn.click();
  await expect(page.locator('.oe-pill')).toBeVisible();
  await expect(btn).toHaveText('Done editing outline');
  await btn.click();
  await expect(page.locator('.oe-pill')).toHaveCount(0);
  await expect(btn).toHaveText('Edit outline');
});

test('drag a corner (grid 5), one undo step', async ({ page }) => {
  await setup(page);
  const before = await pastLen(page);
  await drag(page, [500, 100], [620, 140]);
  await expect.poll(() => pts(page)).toEqual([[100, 100], [620, 140], [500, 400], [100, 400]]);
  expect(await pastLen(page)).toBe(before + 1);
  await page.evaluate(() => window.__app.undo());
  expect(await pts(page)).toEqual([[100, 100], [500, 100], [500, 400], [100, 400]]);
});

test('drag a wall of a rectangle keeps it rectangular, one undo step, doors follow', async ({ page }) => {
  await setup(page, { door: true });
  const before = await pastLen(page);
  await drag(page, [180, 100], [180, 60]); // grab the top wall away from the middle handle and corners
  await expect.poll(() => pts(page)).toEqual([[100, 60], [500, 60], [500, 400], [100, 400]]);
  expect(await pastLen(page)).toBe(before + 1);
  const door = await page.evaluate(() => window.__app.doc.items.find((i) => i.type === 'door'));
  expect([door.y1, door.y2]).toEqual([60, 60]);
  expect([door.x1, door.x2]).toEqual([200, 240]);
  await page.evaluate(() => window.__app.undo());
  const back = await page.evaluate(() => window.__app.doc.items.find((i) => i.type === 'door'));
  expect([back.y1, back.y2]).toEqual([100, 100]);
  expect(await pts(page)).toEqual([[100, 100], [500, 100], [500, 400], [100, 400]]);
});

test('double-click a wall adds a corner (+1, one undo step); one click only selects the wall', async ({ page }) => {
  await setup(page);
  const before = await pastLen(page);
  const a = await toClient(page, [500, 180]); // right wall, off the middle handle
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(500); // a single click selects, it adds nothing
  expect((await pts(page)).length).toBe(4);
  expect(await pastLen(page)).toBe(before);
  await page.mouse.dblclick(a.x, a.y);
  await expect.poll(async () => (await pts(page)).length).toBe(5);
  expect(await pastLen(page)).toBe(before + 1);
  expect(await pts(page)).toContainEqual([500, 180]);
  await page.evaluate(() => window.__app.undo());
  expect((await pts(page)).length).toBe(4);
});

// a building with a notch cut into its left wall: the little mistake that has to go
const NOTCH = [[100, 100], [700, 100], [700, 500], [100, 500], [100, 400], [200, 400], [200, 200], [100, 200]];
const SQUARE = [[100, 100], [700, 100], [700, 500], [100, 500]];

test('click a wall, press Delete: the wall goes and the outline closes over the gap (a notch fills in), one undo step', async ({ page }) => {
  await setup(page, { outline: NOTCH });
  const before = await pastLen(page);
  const wall = await toClient(page, [200, 350]); // the notch's back wall, away from its middle handle and corners
  await page.mouse.click(wall.x, wall.y);
  await page.keyboard.press('Delete');
  await expect.poll(() => pts(page)).toEqual(SQUARE);
  expect(await pastLen(page)).toBe(before + 1);
  expect(await page.evaluate(() => window.__app.doc.floor !== null)).toBe(true); // the outline itself is still there
  await page.evaluate(() => window.__app.undo());
  expect((await pts(page)).length).toBe(8);
});

test('click a corner, press Backspace: the corner goes and the notch fills in with square corners', async ({ page }) => {
  await setup(page, { outline: NOTCH });
  const c = await toClient(page, [200, 400]);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Backspace');
  await expect.poll(() => pts(page)).toEqual(SQUARE);
});

test('Delete with nothing selected never removes the whole outline', async ({ page }) => {
  await setup(page, { outline: NOTCH });
  const before = await pastLen(page);
  await page.evaluate(() => window.__app.setSelection(['floor'])); // the outline is the selected piece of the plan
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  expect((await pts(page)).length).toBe(8);
  expect(await pastLen(page)).toBe(before);
});

test('a corner dropped on its neighbour merges with it', async ({ page }) => {
  await setup(page, { outline: [[100, 100], [700, 100], [700, 300], [700, 500], [100, 500]] });
  const before = await pastLen(page);
  await drag(page, [700, 300], [704, 496]); // onto the corner (700, 500)
  await expect.poll(() => pts(page)).toEqual([[100, 100], [700, 100], [700, 500], [100, 500]]);
  expect(await pastLen(page)).toBe(before + 1);
});

test('double-click a corner removes it (-1, min 3), one undo step', async ({ page }) => {
  await setup(page);
  const before = await pastLen(page);
  const c = await toClient(page, [100, 400]);
  await page.mouse.dblclick(c.x, c.y);
  await expect.poll(async () => (await pts(page)).length).toBe(3);
  // the first click of the double-click is only a (zero-length) grab, so the history grew by exactly one
  expect(await pastLen(page)).toBe(before + 1);
  // at 3 corners nothing more can be removed
  const c2 = await toClient(page, (await pts(page))[0]);
  await page.mouse.dblclick(c2.x, c2.y);
  await page.waitForTimeout(200);
  expect((await pts(page)).length).toBe(3);
  await page.evaluate(() => window.__app.undo());
  expect((await pts(page)).length).toBe(4);
});

test('Esc exits edit mode', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.oe-pill')).toHaveCount(0);
  await expect(page.locator('#btn-edit-outline')).toHaveText('Edit outline');
});

test('a drag that makes the outline cross itself is reverted with a toast', async ({ page }) => {
  await setup(page);
  const before = await pastLen(page);
  // drag the top-right corner down past the bottom wall: the first wall then crosses the bottom wall
  await drag(page, [500, 100], [300, 450]);
  await expect(page.locator('.toast', { hasText: 'cross itself' })).toBeVisible();
  expect(await pts(page)).toEqual([[100, 100], [500, 100], [500, 400], [100, 400]]);
  expect(await pastLen(page)).toBe(before);
});

test('hand button lights up while the middle button is held', async ({ page }) => {
  await setup(page);
  const hand = page.locator('#btn-hand-toggle');
  await expect(hand).not.toHaveClass(/oe-held/);
  const c = await toClient(page, [300, 250]);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: 'middle' });
  await expect(hand).toHaveClass(/oe-held/);
  await page.mouse.up({ button: 'middle' });
  await expect(hand).not.toHaveClass(/oe-held/);
});
