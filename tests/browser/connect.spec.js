// tests/browser/connect.spec.js
// A floor built from several photos is outlined building by building: Auto-outline makes ONE outline per piece (no
// outline in doc.floor, no "start outlining" prompt), "Connect hallways" puts colored points on walls, the hallway is
// drawn by hand (its ends snap to the middle of an opening), and "Merge into one outline" joins everything.

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup } from './building.helpers.js';

const SLUG = 'connect-test-1';
let ids = [];
const errors = [];
test.beforeEach(async ({ page }) => { ids = []; errors.length = 0; page.on('pageerror', (e) => errors.push(String(e))); await openApp(page); });
test.afterEach(async ({ page }) => { await cleanup(page, ids); });

async function setup(page) {
  const p = await seedProject(page, { building: 'Connect Test', floor: 1, slug: SLUG, outline: false });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await page.evaluate(async () => {
    const { makeRoom, addItem } = await import('/js/model/document.js');
    let d = window.__app.doc;
    const add = (piece, x, y, w, h, n) => { const r = makeRoom('room', x, y, w, h, n); r.piece = piece; d = addItem(d, r); };
    add('Photo 1', 0, 0, 200, 150, '101'); add('Photo 1', 200, 0, 200, 150, '102');
    add('Photo 2', 800, 0, 200, 150, '201'); add('Photo 2', 1000, 0, 200, 150, '202');
    window.__app.commit(d, 'seed');
    window.__app.canvas.zoomTo(true);
  });
}
const items = (page, type) => page.evaluate((t) => window.__app.doc.items.filter((i) => i.type === t), type);
const floor = (page) => page.evaluate(() => window.__app.doc.floor);
// screen position of a plan point
const screen = (page, x, y) => page.evaluate(([px, py]) => {
  const c = window.__app.canvas.fabricCanvas, r = c.upperCanvasEl.getBoundingClientRect(), v = c.viewportTransform;
  return { x: r.left + v[4] + px * v[0], y: r.top + v[5] + py * v[3] };
}, [x, y]);
async function click(page, x, y) { const s = await screen(page, x, y); await page.mouse.click(s.x, s.y); }
async function drag(page, a, b) {
  const s = await screen(page, a[0], a[1]), e = await screen(page, b[0], b[1]);
  await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.mouse.move((s.x + e.x) / 2, (s.y + e.y) / 2, { steps: 4 }); await page.mouse.move(e.x, e.y, { steps: 4 }); await page.mouse.up();
}

test('Auto-outline on a plan with pieces makes one outline per piece, no bridged outline, no prompt', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#connect-section')).toBeHidden();
  await page.click('#btn-auto-outline');
  const outs = await items(page, 'outline');
  expect(outs.map((o) => o.piece).sort()).toEqual(['Photo 1', 'Photo 2']);
  expect(await floor(page)).toBeNull();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#connect-section')).toBeVisible();
  for (const o of outs) {
    const xs = o.points.map((p) => p[0]);
    if (o.piece === 'Photo 1') expect(Math.max(...xs)).toBeLessThan(500); else expect(Math.min(...xs)).toBeGreaterThan(700);
  }
  // again: replaces, never doubles
  await page.click('#btn-auto-outline');
  expect((await items(page, 'outline')).length).toBe(2);
  await page.click('#btn-undo'); // one step
  expect((await items(page, 'outline')).length).toBe(2);
  await page.click('#btn-undo');
  expect((await items(page, 'outline')).length).toBe(0);
  expect(errors).toEqual([]);
});

test('connect points are placed by a click on a wall, a hallway meets the opening centred, and the merge makes ONE outline', async ({ page }) => {
  await setup(page);
  await page.click('#btn-auto-outline');
  await page.click('#btn-add-link');
  await expect(page.locator('.link-row')).toHaveCount(1);
  await expect(page.locator('#btn-merge')).toBeDisabled();
  await expect(page.locator('#merge-hint')).toContainText('Draw a hallway to each opening first');

  await page.click('.link-pt[data-slot="1"]');
  expect(await page.evaluate(() => window.__app.toolName)).toBe('connect');
  await expect(page.locator('#hint')).toContainText('point 1');
  await page.keyboard.press('Escape'); // cancels
  expect(await page.evaluate(() => window.__app.toolName)).toBe('select');
  expect(await items(page, 'connect')).toHaveLength(0);

  await page.click('.link-pt[data-slot="1"]');
  await click(page, 410, 70); // near the right wall of Photo 1 (x = 400)
  let cs = await items(page, 'connect');
  expect(cs).toHaveLength(1);
  expect(cs[0]).toMatchObject({ slot: 1, piece: 'Photo 1', x: 400 });
  expect(await page.evaluate(() => window.__app.toolName)).toBe('select');
  await expect(page.locator('.link-status')).toContainText('Place both points');
  await page.click('.link-pt[data-slot="2"]');
  await click(page, 790, 70); // left wall of Photo 2 (x = 800)
  cs = await items(page, 'connect');
  expect(cs).toHaveLength(2);
  expect(cs.find((c) => c.slot === 2)).toMatchObject({ piece: 'Photo 2', x: 800 });
  await expect(page.locator('.link-status')).toContainText('Hallway to opening');
  // the walls are drawn with a gap there: the outline objects carry the stretches (the points themselves are untouched)
  const ptsBefore = (await items(page, 'outline')).map((o) => o.points);
  expect(ptsBefore.every((p) => p.length === 4)).toBe(true);
  expect(await page.evaluate(() => window.__app.canvas.fabricCanvas.getObjects().filter((o) => o.itemType === 'outline' || o.itemType === 'connect').length)).toBe(4);

  // a hallway dragged from one opening to the other: both ends lock onto the middles, centred
  await page.keyboard.press('a'); // the hallway tool
  await drag(page, [393, 83], [807, 68]);
  let halls = await items(page, 'hall');
  expect(halls).toHaveLength(1);
  const c1 = cs.find((c) => c.slot === 1), c2 = cs.find((c) => c.slot === 2);
  expect(halls[0].x).toBe(c1.x);
  expect(halls[0].x + halls[0].w).toBe(c2.x);
  expect(halls[0].y + halls[0].h / 2).toBe(c1.y);
  await expect(page.locator('.link-status .chk.ok')).toHaveCount(2);
  await expect(page.locator('#btn-merge')).toBeEnabled();
  expect(await page.evaluate(() => window.__app.validation.filter((v) => v.level === 'error').map((v) => v.code))).toEqual(['no-floor']);

  await page.click('#btn-merge');
  expect(await items(page, 'outline')).toHaveLength(0);
  expect(await items(page, 'connect')).toHaveLength(0);
  const f = await floor(page);
  expect(f && f.points.length >= 4).toBe(true);
  const xs = f.points.map((p) => p[0]);
  expect(Math.min(...xs)).toBeLessThanOrEqual(0);
  expect(Math.max(...xs)).toBeGreaterThanOrEqual(1200);
  await expect(page.locator('#connect-section')).toBeHidden();
  await page.click('#btn-undo');
  expect(await floor(page)).toBeNull();
  expect(await items(page, 'outline')).toHaveLength(2);
  expect(await items(page, 'connect')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('a hallway end near one opening snaps to its middle and the hallway comes out centred on it', async ({ page }) => {
  await setup(page);
  await page.click('#btn-auto-outline');
  await page.evaluate(async () => {
    const o = window.__app.doc.items.find((i) => i.type === 'outline' && i.piece === 'Photo 1');
    const mk = (slot, x, y, outline) => ({ id: `cp${slot}`, type: 'connect', pair: 'p', slot, color: '#e5484d', outline, piece: 'x', x, y });
    const o2 = window.__app.doc.items.find((i) => i.type === 'outline' && i.piece === 'Photo 2');
    window.__app.commit({ ...window.__app.doc, items: [...window.__app.doc.items, mk(1, 400, 70, o.id), mk(2, 800, 70, o2.id)] }, 'points');
  });
  await page.keyboard.press('a'); // hallway tool
  await drag(page, [403, 76], [520, 190]);
  const h = (await items(page, 'hall'))[0];
  expect(h).toBeTruthy();
  expect(h.x).toBe(400); // starts at the wall
  expect(h.y + h.h / 2).toBe(70); // centred across on the opening's middle
  expect(errors).toEqual([]);
});

test('outline and connect items select, delete, hide, move and turn with their piece', async ({ page }) => {
  await setup(page);
  await page.click('#btn-auto-outline');
  await page.evaluate(() => {
    const o = window.__app.doc.items.find((i) => i.type === 'outline' && i.piece === 'Photo 1');
    window.__app.commit({ ...window.__app.doc, items: [...window.__app.doc.items, { id: 'cp1', type: 'connect', pair: 'p', slot: 1, color: '#2f6feb', outline: o.id, piece: 'Photo 1', x: 400, y: 70 }] }, 'point');
  });
  const mine = () => page.evaluate(() => window.__app.doc.items.filter((i) => i.piece === 'Photo 1').map((i) => i.id));
  // hide / show
  const oid = (await items(page, 'outline')).find((o) => o.piece === 'Photo 1').id;
  await page.evaluate((id) => window.__app.setHidden([id, 'cp1'], true), oid);
  expect(await page.evaluate(() => window.__app.canvas.fabricCanvas.getObjects().filter((o) => (o.itemType === 'outline' || o.itemType === 'connect') && !o.visible).length)).toBe(2);
  await page.evaluate((id) => window.__app.setHidden([id, 'cp1'], false), oid);
  // turn the whole piece a quarter turn: outline and point turn with the rooms
  const before = (await items(page, 'outline')).find((o) => o.id === oid).points;
  await page.evaluate((ids) => window.__app.setSelection(ids), await mine());
  await page.click('#p-turn-cw');
  const after = (await items(page, 'outline')).find((o) => o.id === oid).points;
  expect(after).not.toEqual(before);
  const cp = (await items(page, 'connect'))[0];
  expect(Math.abs(cp.x - 400) + Math.abs(cp.y - 70)).toBeGreaterThan(0);
  await page.click('#btn-undo');
  expect((await items(page, 'outline')).find((o) => o.id === oid).points).toEqual(before);
  // nudge moves the piece's outline too
  await page.evaluate((ids) => window.__app.setSelection(ids), await mine());
  await page.keyboard.press('ArrowRight');
  const nudged = (await items(page, 'outline')).find((o) => o.id === oid).points;
  expect(nudged.map((p) => p[0])).toEqual(before.map((p) => p[0] + 1));
  // dragging the selection moves outline and point rigidly with the rooms
  const room = (await items(page, 'room')).find((r) => r.piece === 'Photo 1' && r.number === '101');
  await drag(page, [room.x + 100, room.y + 75], [room.x + 100, room.y + 175]);
  const moved = (await items(page, 'outline')).find((o) => o.id === oid).points;
  const room2 = (await items(page, 'room')).find((r) => r.id === room.id);
  expect(room2.y).toBeGreaterThan(room.y);
  expect(moved[0][1] - nudged[0][1]).toBe(room2.y - room.y);
  expect((await items(page, 'connect'))[0].y - 70).toBe(room2.y - room.y);
  // deleting the outline takes its point
  await page.evaluate((id) => window.__app.setSelection([id]), oid);
  await page.keyboard.press('Delete');
  expect((await items(page, 'outline')).map((o) => o.piece)).toEqual(['Photo 2']);
  expect(await items(page, 'connect')).toHaveLength(0);
  expect(errors).toEqual([]);
});
