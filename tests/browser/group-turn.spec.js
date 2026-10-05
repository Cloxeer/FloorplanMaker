// tests/browser/group-turn.spec.js
// Several pieces selected and turned: they turn as ONE rigid group (a quarter turn at a time), never one by one.
// Via the round handle on the selection and via the Turn buttons; one undo step; the outline turns with them.

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup } from './building.helpers.js';

const SLUG = 'turn-test-1';
let ids = [];
test.beforeEach(async ({ page }) => { ids = []; await openApp(page); });
test.afterEach(async ({ page }) => { await cleanup(page, ids); });

async function setup(page) {
  const p = await seedProject(page, { building: 'Turn Test', floor: 1, slug: SLUG, outline: [[100, 100], [500, 100], [500, 300], [100, 300]], room: true, ready: true });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await page.evaluate(async () => {
    const { updateItem } = await import('/js/model/document.js');
    let d = window.__app.doc;
    for (const it of d.items.filter((i) => i.type === 'room')) d = updateItem(d, it.id, { x: it.x === 150 ? 100 : 300, y: 100, w: 200, h: 200 });
    window.__app.replaceDoc(d);
  });
}
const rooms = (page) => page.evaluate(() => window.__app.doc.items.filter((i) => i.type === 'room').map((r) => ({ n: r.number, x: r.x, y: r.y, w: r.w, h: r.h })));

test('the Turn buttons turn two rooms as one block', async ({ page }) => {
  await setup(page);
  const before = await rooms(page);
  await page.evaluate(() => window.__app.setSelection(window.__app.doc.items.filter((i) => i.type === 'room').map((i) => i.id)));
  await expect(page.locator('#p-turn-cw')).toBeVisible();
  await page.click('#p-turn-cw');
  const after = await rooms(page);
  const a = after.find((r) => r.n === before[0].n), b = after.find((r) => r.n === before[1].n);
  expect([a.w, a.h, b.w, b.h]).toEqual([200, 200, 200, 200]);
  expect(a.x).toBe(b.x); // side by side became stacked
  expect(Math.abs(a.y - b.y)).toBe(200); // still touching
  expect(await page.evaluate(() => window.__app.selection.size)).toBe(2);
  await page.click('#btn-undo');
  expect(await rooms(page)).toEqual(before);
});

test('dragging the rotate handle turns the whole selection together', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.__app.setSelection(['floor', ...window.__app.doc.items.filter((i) => i.type !== 'legend').map((i) => i.id)]));
  const before = await page.evaluate(() => JSON.stringify(window.__app.doc));
  const g = await page.evaluate(() => {
    const c = window.__app.canvas.fabricCanvas, a = c.getActiveObject(), r = c.upperCanvasEl.getBoundingClientRect();
    const h = a.oCoords.mtr, ctr = a.getCenterPoint(), vt = c.viewportTransform;
    return { type: a.type, hx: r.left + h.x, hy: r.top + h.y, cx: r.left + vt[4] + ctr.x * vt[0], cy: r.top + vt[5] + ctr.y * vt[3] };
  });
  expect(g.type).toBe('activeselection');
  const dist = Math.hypot(g.hx - g.cx, g.hy - g.cy);
  await page.mouse.move(g.hx, g.hy);
  await page.mouse.down();
  await page.mouse.move(g.cx + dist * 0.5, g.cy - dist * 0.5, { steps: 6 });
  await page.mouse.move(g.cx + dist, g.cy, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.__app.doc);
  expect(JSON.stringify(after)).not.toBe(before);
  const rs = after.items.filter((i) => i.type === 'room');
  expect(rs.every((r) => r.w === 200 && r.h === 200)).toBe(true);
  expect(rs[0].x).toBe(rs[1].x);
  // the outline turned with them: a 400 x 200 box is now 200 x 400
  const xs = after.floor.points.map((p) => p[0]), ys = after.floor.points.map((p) => p[1]);
  expect([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]).toEqual([200, 400]);
  // and everything still sits inside it
  for (const r of rs) expect(r.x >= Math.min(...xs) && r.x + r.w <= Math.max(...xs) && r.y >= Math.min(...ys) && r.y + r.h <= Math.max(...ys)).toBe(true);
  expect(await page.evaluate(() => window.__app.project.history.past.length)).toBe(1);
  await expectOutlineDrawnWhereDocSays(page); // and what is DRAWN agrees with the document, not just the document
});

// the outline's own Fabric object (not the stroke-only copy) must sit exactly on the document's points, untransformed
async function expectOutlineDrawnWhereDocSays(page) {
  const r = await page.evaluate(async () => {
    const { absPolyPoints } = await import('/js/view/stagePoly.js');
    const o = window.__app.canvas.fabricCanvas.getObjects().find((x) => x.itemType === 'floor');
    return { angle: o.angle, sx: o.scaleX, sy: o.scaleY, drawn: absPolyPoints(o).map((p) => p.map(Math.round)), doc: window.__app.doc.floor.points };
  });
  expect([r.angle, r.sx, r.sy]).toEqual([0, 1, 1]);
  expect(r.drawn).toEqual(r.doc);
}

test('dragging a selection that includes the outline moves the outline with it', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.__app.setSelection(['floor', ...window.__app.doc.items.filter((i) => i.type !== 'legend').map((i) => i.id)]));
  const before = await page.evaluate(() => ({ f: window.__app.doc.floor.points, r: window.__app.doc.items.find((i) => i.type === 'room').x }));
  const c = await page.evaluate(() => {
    const cv = window.__app.canvas.fabricCanvas, a = cv.getActiveObject(), r = cv.upperCanvasEl.getBoundingClientRect(), vt = cv.viewportTransform;
    const p = a.getCenterPoint();
    return { x: r.left + vt[4] + p.x * vt[0], y: r.top + vt[5] + p.y * vt[3], k: vt[0] };
  });
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 25 * c.k, c.y + 10 * c.k, { steps: 6 });
  await page.mouse.move(c.x + 50 * c.k, c.y + 20 * c.k, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate(() => ({ f: window.__app.doc.floor.points, r: window.__app.doc.items.find((i) => i.type === 'room').x }));
  const dx = after.r - before.r;
  expect(dx).toBeGreaterThan(20);
  expect(after.f).toEqual(before.f.map(([x, y]) => [x + dx, y + after.f[0][1] - before.f[0][1]]));
  await expectOutlineDrawnWhereDocSays(page);
});

test('Ctrl+A selects every piece and the outline; turning, Undo and moving keep compass, door and outline in step with what is drawn', async ({ page }) => {
  await setup(page);
  const ids = await page.evaluate(() => window.__app.doc.items.map((i) => i.id).length);
  await page.mouse.click(5, 5); // focus the page, not a field
  await page.keyboard.press('Control+a');
  expect(await page.evaluate(() => window.__app.selection.size)).toBe(ids + 1); // + the outline
  const snap = () => page.evaluate(() => {
    const d = window.__app.doc, c = d.items.find((i) => i.type === 'compass'), dr = d.items.find((i) => i.type === 'door');
    return { floor: d.floor.points, compass: [c.x, c.y, c.deg], door: [dr.x1, dr.y1, dr.x2, dr.y2] };
  });
  const s0 = await snap();
  await page.click('#p-turn-cw');
  const s1 = await snap();
  expect(s1.compass[2]).toBe(90);
  await expectOutlineDrawnWhereDocSays(page);
  await page.click('#btn-undo'); // the outline is still in the selection here
  expect(await snap()).toEqual(s0);
  await expectOutlineDrawnWhereDocSays(page);
  // drag the whole selection: the compass and the door travel with it, none of them jumps
  const c = await page.evaluate(() => {
    const cv = window.__app.canvas.fabricCanvas, a = cv.getActiveObject(), r = cv.upperCanvasEl.getBoundingClientRect(), vt = cv.viewportTransform, p = a.getCenterPoint();
    return { x: r.left + vt[4] + p.x * vt[0], y: r.top + vt[5] + p.y * vt[3], k: vt[0] };
  });
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 20 * c.k, c.y + 10 * c.k, { steps: 5 });
  await page.mouse.move(c.x + 40 * c.k, c.y + 20 * c.k, { steps: 5 });
  await page.mouse.up();
  const s2 = await snap();
  const dx = s2.floor[0][0] - s0.floor[0][0], dy = s2.floor[0][1] - s0.floor[0][1];
  expect(dx).toBeGreaterThan(20);
  // (the outline snaps to the 5-unit grid, the compass and door round to whole units: allow that much)
  const near = (a, b) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(3));
  near(s2.compass.slice(0, 2), [s0.compass[0] + dx, s0.compass[1] + dy]);
  expect(s2.compass[2]).toBe(0);
  near(s2.door, [s0.door[0] + dx, s0.door[1] + dy, s0.door[2] + dx, s0.door[3] + dy]);
  await expectOutlineDrawnWhereDocSays(page);
});
