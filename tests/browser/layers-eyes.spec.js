// tests/browser/layers-eyes.spec.js
// The eye in the View layers list hides an item from the plan only (nothing is deleted or exported differently);
// The Layers tree has two layers: Photo (each photo, with an eye) and Drawing (grouped by piece, then by type); a piece group
// hides / selects every item of one photo of a multi-photo floor at once.

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

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function addPhotos(page) {
  await page.evaluate(async (png) => {
    const a = window.__app;
    a.project.photo = { dataUrl: png, width: 400, height: 300 };
    a.project.extraPhotos = [{ dataUrl: png, width: 400, height: 300, t: { x: 600, y: 0, s: 1, a: 0 } }];
    await a.canvas.setPhoto(a.project.photo);
    await a._photoLayer.refresh();
    a.emit({ type: 'hidden' });
  }, PNG);
  await page.waitForFunction(() => window.__app.canvas.fabricCanvas.getObjects().some((o) => o.zLayer === -20));
}
// [main photo visible, extra photo visible]
const photosShown = (page) => page.evaluate(() => {
  const c = window.__app.canvas.fabricCanvas;
  return [!!(c.backgroundImage && c.backgroundImage.visible), c.getObjects().filter((o) => o.zLayer === -20).every((o) => o.visible)];
});
const layerHead = (page, title) => page.locator('#layers-panel .ly-lv0', { hasText: title });

test('the tree shows a Photo layer (one row per photo) and a Drawing layer', async ({ page }) => {
  await setup(page);
  await expect(layerHead(page, 'Photo')).toHaveCount(0); // no photo, no Photo layer
  await expect(layerHead(page, 'Drawing')).toHaveCount(1);
  await addPhotos(page);
  await expect(layerHead(page, 'Photo')).toHaveCount(1);
  await expect(page.locator('#layers-panel .ly-photo')).toHaveCount(2);
  await expect(page.locator('#layers-panel .ly-photo').nth(0)).toContainText('Photo 1');
  await expect(page.locator('#layers-panel .ly-photo').nth(1)).toContainText('Photo 2');
  // no pieces: the Drawing layer lists the type groups straight away
  await expect(page.locator('#layers-panel .ly-lv2', { hasText: 'Rooms' })).toHaveCount(1);
  await expect(page.locator('#layers-panel .ly-lv2', { hasText: 'Hallways' })).toHaveCount(1);
});

test('a photo eye hides that photo only (view only), the header eye hides all, and it survives a reload', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await setup(page);
  await addPhotos(page);
  expect(await photosShown(page)).toEqual([true, true]);
  const before = await page.evaluate(() => JSON.stringify([window.__app.project.photo.t || null, window.__app.project.extraPhotos[0].t]));
  await page.getByRole('button', { name: 'Hide Photo 2 picture' }).click();
  expect(await hiddenList(page)).toContain('photo:1');
  expect(await photosShown(page)).toEqual([true, false]);
  await expect(page.getByRole('button', { name: 'Show Photo 2 picture' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#layers-panel .ly-photo.ly-off')).toHaveCount(1);
  // Arrange mode neither shows nor handles the hidden photo, and does not crash
  const mode = await page.evaluate(async () => { await window.__app._photoLayer.arrange(); const m = window.__app._photoLayer.mode(); window.__app._photoLayer.setMode(null); return m; });
  expect(mode).toBe('photo');
  // hide the main one too through the layer eye
  await page.getByRole('button', { name: 'Hide all photos' }).click();
  expect(await photosShown(page)).toEqual([false, false]);
  expect((await hiddenList(page)).sort()).toEqual(['photo:0', 'photo:1']);
  await page.evaluate(async () => { await window.__app._photoLayer.arrange(); window.__app._photoLayer.setMode(null); }); // nothing to arrange: no crash
  // nothing is deleted or moved
  expect(await page.evaluate(() => window.__app.project.extraPhotos.length)).toBe(1);
  expect(await page.evaluate(() => JSON.stringify([window.__app.project.photo.t || null, window.__app.project.extraPhotos[0].t]))).toBe(before);
  // hidden photo ids are not pruned like item ids
  await page.evaluate(() => window.__app.emit({ type: 'doc' }));
  expect(await page.evaluate(() => [...window.__app.hiddenPhotos()].sort())).toEqual([0, 1]);
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction((s) => window.__app && window.__app.project && window.__app.project.slug === s && window.__app.canvas, SLUG);
  await page.waitForFunction(() => window.__app.canvas.fabricCanvas.getObjects().some((o) => o.zLayer === -20) && window.__app.canvas.fabricCanvas.backgroundImage);
  await page.waitForTimeout(500);
  expect((await hiddenList(page)).sort()).toEqual(['photo:0', 'photo:1']);
  expect(await photosShown(page)).toEqual([false, false]);
  await page.click('#btn-view');
  await page.click('#btn-layers');
  await page.getByRole('button', { name: 'Show all photos' }).click();
  expect(await photosShown(page)).toEqual([true, true]);
  expect(await hiddenList(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('the Drawing eye hides every item and shows them again; one type header hides only its type', async ({ page }) => {
  await setup(page);
  const all = await page.evaluate(() => window.__app.doc.items.map((i) => i.id));
  expect(all.length).toBeGreaterThan(3);
  await page.getByRole('button', { name: 'Hide the whole drawing' }).click();
  const h = await hiddenList(page);
  for (const id of all) { expect(h).toContain(id); expect((await fab(page, id)).visible).toBe(false); }
  await expect(page.getByRole('button', { name: 'Show the whole drawing' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#layers-panel .ly-lv2.ly-off')).toHaveCount(await page.locator('#layers-panel .ly-lv2:has(.ly-eye)').count()); // every type header with an eye reads "all hidden" (the plain outline has none)
  await page.getByRole('button', { name: 'Show the whole drawing' }).click();
  expect(await hiddenList(page)).toEqual([]);
  for (const id of all) expect((await fab(page, id)).visible).toBe(true);
  await page.getByRole('button', { name: 'Hide Hallways' }).click();
  const hall = await page.evaluate(() => window.__app.doc.items.filter((i) => i.type === 'hall').map((i) => i.id));
  expect((await hiddenList(page)).sort()).toEqual([...hall].sort());
  await expect(page.getByRole('button', { name: 'Hide the whole drawing' })).toHaveAttribute('aria-pressed', 'false');
});

test('a piece group hides / selects only its items; items with no piece land in Whole plan', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const a = window.__app, rooms = a.doc.items.filter((i) => i.type === 'room');
    a.commit({ ...a.doc, items: a.doc.items.map((it) => (it.id === rooms[0].id ? { ...it, piece: 'Photo 1' } : it.id === rooms[1].id ? { ...it, piece: 'Photo 2' } : it)) }, 'seed pieces');
  });
  await expect(page.locator('#layers-panel .ly-piece')).toHaveCount(2);
  const whole = page.locator('#layers-panel .ly-whole');
  await expect(whole).toHaveCount(1);
  const wholeBody = page.locator('#layers-panel .ly-whole + .ly-gb');
  await expect(wholeBody).toContainText('Hallway');
  await expect(wholeBody).toContainText('Outline'); // the single-ring building outline
  await expect(wholeBody).toContainText('Compass');
  await expect(wholeBody).not.toContainText('Room 101');
  await expect(page.locator('#layers-panel .ly-piece + .ly-gb').nth(0)).toContainText('Room 101');
  await expect(whole.getByRole('button', { name: /^Select/ })).toHaveCount(1);
  const p1 = await page.evaluate(() => window.__app.doc.items.filter((i) => i.piece === 'Photo 1').map((i) => i.id));
  const rest = await page.evaluate(() => window.__app.doc.items.filter((i) => i.piece !== 'Photo 1').map((i) => i.id));
  await page.getByRole('button', { name: 'Hide Photo 1 plan' }).click();
  expect((await hiddenList(page)).sort()).toEqual([...p1].sort());
  for (const id of rest) expect((await fab(page, id)).visible).toBe(true);
  await page.getByRole('button', { name: 'Show Photo 1 plan' }).click();
  await whole.getByRole('button', { name: /^Select/ }).click();
  const loose = await page.evaluate(() => window.__app.doc.items.filter((i) => !i.piece).map((i) => i.id));
  expect(await page.evaluate(() => [...window.__app.selection].sort())).toEqual([...loose].sort());
});

test('with more than two pieces the groups start folded; the open state is remembered', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const a = window.__app, its = a.doc.items;
    const name = (it) => (it.type === 'room' ? (its.filter((x) => x.type === 'room').indexOf(it) === 0 ? 'Photo 1' : 'Photo 2') : it.type === 'hall' ? 'Photo 3' : null);
    a.commit({ ...a.doc, items: its.map((it) => (name(it) ? { ...it, piece: name(it) } : it)) }, 'seed pieces');
  });
  await expect(page.locator('#layers-panel .ly-piece')).toHaveCount(3);
  await expect(page.locator('#layers-panel .ly-piece + .ly-gb')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Photo 2', exact: true }).click();
  await expect(page.locator('#layers-panel .ly-piece + .ly-gb')).toHaveCount(1);
  await page.evaluate(() => window.__app.emit({ type: 'hidden' })); // any re-render keeps it open
  await expect(page.locator('#layers-panel .ly-piece + .ly-gb')).toHaveCount(1);
  await page.getByRole('button', { name: 'Collapse Photo 2', exact: true }).click();
  await expect(page.locator('#layers-panel .ly-piece + .ly-gb')).toHaveCount(0);
  // the Drawing layer itself folds too
  await page.getByRole('button', { name: 'Collapse Drawing', exact: true }).click();
  await expect(page.locator('#layers-panel .ly-piece')).toHaveCount(0);
});
