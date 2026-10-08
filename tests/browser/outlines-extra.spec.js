// tests/browser/outlines-extra.spec.js
// A floor of several separate buildings: under "Redraw the outline" a "+ Add another outline" button starts the next
// building's outline; it is named, listed, can be redrawn (which selects it), removed, and is exported.

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup } from './building.helpers.js';

const SLUG = 'extra-outline-1';
let ids = [];
test.beforeEach(async ({ page }) => { ids = []; await openApp(page); });
test.afterEach(async ({ page }) => { await cleanup(page, ids); });

const toClient = (page, [x, y]) => page.evaluate(([px, py]) => {
  const c = window.__app.canvas.fabricCanvas, r = c.upperCanvasEl.getBoundingClientRect(), vt = c.viewportTransform;
  return { x: r.left + vt[4] + px * vt[0], y: r.top + vt[5] + py * vt[3] };
}, [x, y]);
async function drawRing(page, pts) {
  for (const p of pts) { const c = await toClient(page, p); await page.mouse.click(c.x, c.y); }
  const c = await toClient(page, pts[0]); await page.mouse.click(c.x, c.y); // back on the first corner closes it
}
const extras = (page) => page.evaluate(() => window.__app.doc.items.filter((i) => i.type === 'outline').map((o) => ({ id: o.id, name: o.name, n: o.points.length, x0: Math.min(...o.points.map((p) => p[0])) })));

test('+ Add another outline: draw, name it, it is listed; Redraw selects it and draws it again; remove; one undo each', async ({ page }) => {
  const p = await seedProject(page, { building: 'Extra Outline', floor: 1, slug: SLUG, outline: true, room: true });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await page.evaluate(() => window.__app.canvas.zoomTo(true));
  await expect(page.locator('#btn-add-outline')).toBeVisible();
  await expect(page.locator('#btn-tool-floor')).toContainText('Redraw the outline');
  expect(await extras(page)).toEqual([]);

  await page.click('#btn-add-outline');
  expect(await page.evaluate(() => window.__app.toolName)).toBe('floor');
  await drawRing(page, [[600, 100], [800, 100], [800, 300], [600, 300]]);
  await expect(page.locator('#pr-value')).toBeVisible();
  await page.fill('#pr-value', 'North wing');
  await page.click('#pr-ok');
  await expect.poll(async () => (await extras(page)).length).toBe(1);
  expect((await extras(page))[0]).toMatchObject({ name: 'North wing', n: 4, x0: 600 });
  expect(await page.evaluate(() => window.__app.doc.floor.points[0])).toEqual([100, 100]); // the first outline is untouched
  await expect(page.locator('.outline-row')).toHaveCount(1);
  await expect(page.locator('.outline-name')).toHaveText('North wing');
  await expect(page.locator('#btn-tool-floor')).toContainText('Redraw outline 1');
  const id = (await extras(page))[0].id;
  expect(await page.evaluate(() => [...window.__app.selection])).toEqual([id]); // the new outline is selected

  // Redraw selects that building and draws it again (same id, same name)
  await page.evaluate(() => window.__app.setSelection([]));
  await page.click('.outline-row [data-act="redraw"]');
  expect(await page.evaluate(() => [...window.__app.selection])).toEqual([id]);
  expect(await page.evaluate(() => window.__app.toolName)).toBe('floor');
  await drawRing(page, [[650, 150], [900, 150], [900, 350]]);
  await expect.poll(async () => (await extras(page))[0].x0).toBe(650);
  expect(await extras(page)).toEqual([{ id, name: 'North wing', n: 3, x0: 650 }]);
  expect(await page.evaluate(() => window.__app.toolName)).toBe('select');

  // a door can be placed on the second building's wall, and the export draws both buildings
  await page.evaluate(async () => { const { exportSvg } = await import('/js/model/svgExport.js'); window.__svg = exportSvg(window.__app.doc); });
  expect(await page.evaluate(() => (window.__svg.match(/class="floor-edge"/g) || []).length)).toBe(2);

  await page.click('.outline-row [data-act="remove"]');
  expect(await extras(page)).toEqual([]);
  await expect(page.locator('.outline-row')).toHaveCount(0);
  await page.click('#btn-undo');
  expect((await extras(page)).length).toBe(1);
});
