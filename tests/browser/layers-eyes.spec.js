// tests/browser/layers-eyes.spec.js
// The eye in the View layers list hides an item from the plan only (nothing is deleted or exported differently);
// the Pieces section hides / selects every item of one photo of a multi-photo floor at once.

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup } from './building.helpers.js';

const SLUG = 'eyes-test-1';
let ids = [];
test.beforeEach(async ({ page }) => { ids = []; await openApp(page); });
test.afterEach(async ({ page }) => { await cleanup(page, ids); });

async function setup(page) {
  const p = await seedProject(page, { building: 'Eyes Test', floor: 1, slug: SLUG, outline: true, room: true, ready: true });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await page.click('#btn-view');
  await page.click('#btn-layers');
  await expect(page.locator('#layers-panel')).toBeVisible();
}
const roomIds = (page) => page.evaluate(() => window.__app.doc.items.filter((i) => i.type === 'room').map((i) => i.id));
const fab = (page, id) => page.evaluate((i) => {
  const o = window.__app.canvas.fabricCanvas.getObjects().find((x) => x.itemId === i);
  return o ? { visible: o.visible, selectable: o.selectable, evented: o.evented } : null;
}, id);
const hiddenList = (page) => page.evaluate(() => [...(window.__app.project.hidden || [])]);
// click the middle of an item's object on the screen
async function clickItem(page, id) {
  const pt = await page.evaluate((i) => {
    const c = window.__app.canvas.fabricCanvas;
    const o = c.getObjects().find((x) => x.itemId === i);
    const p = o.getCenterPoint(), v = c.viewportTransform, r = c.upperCanvasEl.getBoundingClientRect();
    return { x: r.left + p.x * v[0] + v[4], y: r.top + p.y * v[3] + v[5] };
  }, id);
  await page.mouse.click(pt.x, pt.y);
}
const eye = (page, title) => page.locator('#layers-panel .ly-line', { hasText: title }).first().locator('.ly-eye');

test('the eye hides a room, nothing there can be clicked, the eye shows it again', async ({ page }) => {
  await setup(page);
  const [id] = await roomIds(page);
  const e = eye(page, 'Room 101');
  await expect(e).toHaveAttribute('aria-label', /^Hide/);
  await expect(e).toHaveAttribute('aria-pressed', 'false');
  await clickItem(page, id); // sanity: a visible room is selected by a click
  expect(await page.evaluate(() => [...window.__app.selection])).toEqual([id]);
  const undoBefore = await page.evaluate(() => window.__app.project.history.past.length);
  await e.click(); // hiding also deselects it
  expect(await hiddenList(page)).toContain(id);
  expect(await page.evaluate(() => [...window.__app.selection])).toEqual([]);
  expect(await fab(page, id)).toEqual({ visible: false, selectable: false, evented: false });
  expect(await page.evaluate(() => window.__app.project.history.past.length)).toBe(undoBefore); // not an undo step
  await expect(e).toHaveAttribute('aria-label', /^Show/);
  await expect(e).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#layers-panel .ly-line.ly-off')).toHaveCount(1);
  await clickItem(page, id); // only the outline behind it can be hit now
  expect(await page.evaluate(() => [...window.__app.selection])).not.toContain(id);
  await page.evaluate((i) => window.__app.setSelection([i]), id); // not selectable from code either
  expect(await page.evaluate(() => [...window.__app.selection])).toEqual([]);
  await e.click();
  expect(await hiddenList(page)).not.toContain(id);
  expect(await fab(page, id)).toEqual({ visible: true, selectable: true, evented: true });
  await clickItem(page, id);
  expect(await page.evaluate(() => [...window.__app.selection])).toEqual([id]);
});

test('hidden stays hidden after a reload, and the item is still in the doc and in the export', async ({ page }) => {
  await setup(page);
  const [id] = await roomIds(page);
  await eye(page, 'Room 101').click();
  const out = await page.evaluate(async () => {
    const { exportSvg } = await import('/js/model/svgExport.js');
    return { inDoc: window.__app.doc.items.some((i) => i.type === 'room' && i.number === '101'), svg: exportSvg(window.__app.doc) };
  });
  expect(out.inDoc).toBe(true);
  expect(out.svg).toContain('101');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction((s) => window.__app && window.__app.project && window.__app.project.slug === s && window.__app.canvas, SLUG);
  await page.waitForTimeout(500);
  expect(await hiddenList(page)).toContain(id);
  expect(await fab(page, id)).toEqual({ visible: false, selectable: false, evented: false });
});

test('Pieces: one eye hides a whole piece, Select selects it', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#layers-panel .ly-piece')).toHaveCount(0); // no piece, no section
  await page.evaluate(async () => {
    const a = window.__app;
    const rooms = a.doc.items.filter((i) => i.type === 'room');
    const piece = (i) => (i === 0 ? 'Photo 10' : 'Photo 2');
    a.commit({ ...a.doc, items: a.doc.items.map((it) => (it.type === 'room' ? { ...it, piece: piece(rooms.indexOf(it)) } : it)) }, 'seed pieces');
  });
  const lines = page.locator('#layers-panel .ly-piece');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText('Photo 2'); // natural order: 2 before 10
  await expect(lines.nth(1)).toContainText('Photo 10');
  const p2 = await page.evaluate(() => window.__app.doc.items.filter((i) => i.piece === 'Photo 2').map((i) => i.id));
  await lines.nth(0).getByRole('button', { name: /^Select/ }).click();
  expect(await page.evaluate(() => [...window.__app.selection].sort())).toEqual([...p2].sort());
  await lines.nth(0).locator('.ly-eye').click();
  const h = await hiddenList(page);
  for (const id of p2) { expect(h).toContain(id); expect((await fab(page, id)).visible).toBe(false); }
  expect(await page.evaluate(() => window.__app.selection.size)).toBe(0);
  const other = await page.evaluate(() => window.__app.doc.items.filter((i) => i.piece === 'Photo 10').map((i) => i.id));
  for (const id of other) expect((await fab(page, id)).visible).toBe(true);
  await expect(lines.nth(0).locator('.ly-eye')).toHaveAttribute('aria-pressed', 'true');
  await lines.nth(0).locator('.ly-eye').click();
  for (const id of p2) expect((await fab(page, id)).visible).toBe(true);
});
