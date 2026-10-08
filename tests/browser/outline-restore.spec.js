// tests/browser/outline-restore.spec.js
// Deleting the building outline no longer throws up the "start outlining" prompt: the card offers Restore outline
// (the old outline, carried to where the rooms are now), Auto-outline (a fresh one round the rooms) and Draw it again.

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup } from './building.helpers.js';

const SLUG = 'restore-test-1';
let ids = [];
test.beforeEach(async ({ page }) => { ids = []; await openApp(page); });
test.afterEach(async ({ page }) => { await cleanup(page, ids); });

const OUTLINE = [[100, 100], [500, 100], [500, 300], [100, 300]];
async function setup(page, opts = {}) {
  const p = await seedProject(page, { building: 'Restore Test', floor: 1, slug: SLUG, outline: OUTLINE, room: true, ready: true, ...opts });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await page.evaluate(async () => {
    const { updateItem } = await import('/js/model/document.js');
    let d = window.__app.doc;
    for (const it of d.items.filter((i) => i.type === 'room')) d = updateItem(d, it.id, { x: it.x === 150 ? 100 : 300, y: 100, w: 200, h: 200 });
    window.__app.replaceDoc(d);
  });
}
const floor = (page) => page.evaluate(() => window.__app.doc.floor && window.__app.doc.floor.points);
const deleteOutline = async (page) => {
  await page.evaluate(() => window.__app.setSelection(['floor']));
  await page.keyboard.press('Delete');
  await expect(page.locator('#start-overlay')).toBeVisible();
};

test('a project with no outline yet still gets the plain "start outlining" prompt', async ({ page }) => {
  const p = await seedProject(page, { building: 'Restore Test', floor: 1, slug: SLUG, outline: false });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await expect(page.locator('#overlay-title')).toHaveText('Start by outlining the building');
  await expect(page.locator('#btn-overlay-restore')).toBeHidden();
  await expect(page.locator('#btn-overlay-auto')).toBeHidden();
  await expect(page.locator('#btn-overlay-draw')).toBeVisible();
});

test('deleting the outline offers Restore, and Restore puts it back exactly', async ({ page }) => {
  await setup(page);
  await deleteOutline(page);
  await expect(page.locator('#overlay-title')).toHaveText('The building outline is gone');
  await expect(page.locator('#btn-overlay-restore')).toBeVisible();
  await expect(page.locator('#btn-overlay-auto')).toBeVisible();
  await expect(page.locator('#btn-overlay-draw')).toHaveText('Draw it again');
  await page.click('#btn-overlay-restore');
  expect(await floor(page)).toEqual(OUTLINE);
  await expect(page.locator('#start-overlay')).toBeHidden();
  await page.click('#btn-undo'); // one undo step takes the restore back
  expect(await floor(page)).toBeNull();
});

test('after the plan was moved, Restore carries the outline to the rooms', async ({ page }) => {
  await setup(page);
  await deleteOutline(page);
  await page.evaluate(async () => {
    const { updateItem } = await import('/js/model/document.js');
    let d = window.__app.doc;
    for (const it of d.items.filter((i) => i.type !== 'legend' && i.x !== undefined)) d = updateItem(d, it.id, { x: it.x + 300, y: it.y + 200 });
    window.__app.commit(d, 'Move');
  });
  await page.click('#btn-overlay-restore');
  const pts = await floor(page);
  expect(pts.map((p) => [p[0], p[1]])).toEqual(OUTLINE.map(([x, y]) => [x + 300, y + 200]));
});

test('Auto-outline draws a new outline round whatever is there now', async ({ page }) => {
  await setup(page);
  await deleteOutline(page);
  await page.evaluate(async () => {
    const { updateItem } = await import('/js/model/document.js');
    let d = window.__app.doc;
    for (const it of d.items.filter((i) => i.type === 'room')) d = updateItem(d, it.id, { x: it.x + 600, y: it.y + 600 });
    window.__app.commit(d, 'Move');
  });
  await page.click('#btn-overlay-auto');
  const pts = await floor(page);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const rooms = await page.evaluate(() => window.__app.doc.items.filter((i) => i.type === 'room'));
  for (const r of rooms) expect(r.x >= Math.min(...xs) && r.x + r.w <= Math.max(...xs) && r.y >= Math.min(...ys) && r.y + r.h <= Math.max(...ys)).toBe(true);
});

test('Draw it again still starts the draw tool', async ({ page }) => {
  await setup(page);
  await deleteOutline(page);
  await page.click('#btn-overlay-draw');
  await expect(page.locator('#start-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__app.toolName)).toBe('floor');
});

test('step 1 has an Auto-outline button that draws the outline round the rooms (one undo step)', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#btn-auto-outline')).toBeVisible();
  await deleteOutline(page);
  await expect(page.locator('#btn-auto-outline')).toHaveText('Auto-outline');
  await page.click('#btn-auto-outline');
  const pts = await floor(page);
  expect(pts && pts.length).toBeGreaterThanOrEqual(4);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  expect(Math.min(...xs)).toBeLessThanOrEqual(100);
  expect(Math.max(...xs)).toBeGreaterThanOrEqual(500);
  expect(Math.min(...ys)).toBeLessThanOrEqual(100);
  expect(Math.max(...ys)).toBeGreaterThanOrEqual(300);
  await expect(page.locator('#start-overlay')).toBeHidden();
  await page.click('#btn-undo');
  expect(await floor(page)).toBeNull();
});

test('Auto-outline is not offered while the plan is empty', async ({ page }) => {
  const p = await seedProject(page, { building: 'Restore Test', floor: 1, slug: SLUG, outline: false });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await expect(page.locator('#btn-auto-outline')).toBeHidden();
});

test('Shift photos: arrange the photos, the "outline is gone" card stays, then Restore still works', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const x = c.getContext('2d'); x.fillStyle = '#c66'; x.fillRect(0, 0, 400, 300);
    window.__app.project.photo = { dataUrl: c.toDataURL(), width: 400, height: 300 };
    await window.__app.canvas.setPhoto(window.__app.project.photo);
  });
  await deleteOutline(page);
  await expect(page.locator('#btn-overlay-shift')).toBeVisible();
  await page.click('#btn-overlay-shift');
  await expect(page.locator('.pl-pill')).toContainText('Arrange photos');
  await expect(page.locator('#start-overlay')).toBeHidden(); // the card would cover the photos while they are moved
  await page.click('.pl-done');
  await expect(page.locator('#overlay-title')).toHaveText('The building outline is gone');
  await expect(page.locator('#btn-overlay-restore')).toBeVisible();
  await page.click('#btn-overlay-restore');
  expect(await floor(page)).toEqual(OUTLINE);
  await expect(page.locator('#start-overlay')).toBeHidden();
});
