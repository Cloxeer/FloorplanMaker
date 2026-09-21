// tests/browser/smoke.spec.js
// End-to-end smoke test driving the real app (Fabric.js stage) in a real
// browser. NOT wired into `npm test` (Node's test runner can't run Playwright).
//
// To run:
//   npx playwright install chromium   (once)
//   node_modules/.bin/playwright test --config tests/browser/playwright.config.js
//
// Requires a static server at http://localhost:8080 (playwright.config.js
// starts one via `npx serve` if none is already running).

import { test, expect } from '@playwright/test';

async function startProject(page) {
  await page.goto('/');
  await page.click('#btn-start-blueprint');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Hardman Jacobs Learning Center');
  await page.fill('#bp-property', '1234');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await expect(page.locator('#photo-step')).toBeVisible();
  await page.click('#ps-skip-initial');
  await expect(page.locator('#studio')).toBeVisible();
  await page.waitForTimeout(600);
}

const doc = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.doc)));

// Plan coordinates -> client coordinates, through the live viewport.
function toClient(page, x, y) {
  return page.evaluate(([px, py]) => {
    const v = window.__app.canvas.getView();
    const r = document.querySelector('#stage').getBoundingClientRect();
    return [r.left + (px - v.x) * v.zoom, r.top + (py - v.y) * v.zoom];
  }, [x, y]);
}

async function dragChip(page, pieceKey, x, y) {
  const chip = page.locator(`.chip[data-piece="${pieceKey}"]`);
  await chip.scrollIntoViewIfNeeded();
  const box = await chip.boundingBox();
  const target = await toClient(page, x, y);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target[0], target[1], { steps: 12 });
  await page.mouse.up();
  return target;
}

test.describe('Floor Plan Studio smoke test', () => {
  test('outline -> doors -> hallway -> room -> compass -> undo -> reload -> export', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(String(e.stack || e)));

    await startProject(page);

    // ---- 1. Draw the building outline (5 corners, one of them a notch) ----
    await page.click('#btn-overlay-draw');
    const stage = await page.locator('#stage').boundingBox();
    const P = (fx, fy) => ({ x: stage.x + stage.width * fx, y: stage.y + stage.height * fy });
    for (const c of [P(0.2, 0.2), P(0.75, 0.2), P(0.75, 0.5), P(0.55, 0.5), P(0.55, 0.8), P(0.2, 0.8)]) {
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(40);
    }
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await doc(page)).floor?.points.length).toBe(6);
    const outline0 = (await doc(page)).floor.points;
    const isAxisAligned = (pts) => pts.every((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return p[0] === q[0] || p[1] === q[1];
    });
    expect(isAxisAligned(outline0)).toBe(true);

    // ---- 2. Select the outline and drag one vertex control ----
    await page.mouse.click(P(0.3, 0.6).x, P(0.3, 0.6).y);
    await expect.poll(async () => page.evaluate(() => [...window.__app.selection].join())).toBe('floor');
    const v0 = await toClient(page, outline0[0][0], outline0[0][1]);
    await page.mouse.move(v0[0], v0[1]);
    await page.mouse.down();
    await page.mouse.move(v0[0] + 45, v0[1] + 35, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const outline1 = (await doc(page)).floor.points;
    expect(outline1[0]).not.toEqual(outline0[0]); // the dragged corner moved
    expect(outline1.slice(1)).toEqual(outline0.slice(1)); // the others did not

    // ---- 3. Double-click an edge to insert a vertex ----
    await page.mouse.click(P(0.3, 0.6).x, P(0.3, 0.6).y);
    await page.waitForTimeout(150);
    const mid = await toClient(
      page,
      (outline1[1][0] + outline1[2][0]) / 2,
      (outline1[1][1] + outline1[2][1]) / 2
    );
    await page.mouse.dblclick(mid[0], mid[1]);
    await expect.poll(async () => (await doc(page)).floor.points.length).toBe(7);

    // ---- 4. Place a door on the outline ----
    const outline2 = (await doc(page)).floor.points;
    await page.click('#btn-tool-door');
    const doorAt = await toClient(
      page,
      (outline2[0][0] + outline2[1][0]) / 2,
      (outline2[0][1] + outline2[1][1]) / 2
    );
    await page.mouse.click(doorAt[0], doorAt[1]);
    await expect.poll(async () => (await doc(page)).items.filter((i) => i.type === 'door').length).toBe(1);

    // ---- 5. Draw a hallway (studio-only guide) ----
    await page.click('#btn-tool-hall');
    const h1 = await toClient(page, 260, 430);
    const h2 = await toClient(page, 700, 500);
    await page.mouse.move(h1[0], h1[1]);
    await page.mouse.down();
    await page.mouse.move(h2[0], h2[1], { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await doc(page)).items.filter((i) => i.type === 'hall').length).toBe(1);
    await page.keyboard.press('Escape');

    // ---- 6. Drag a Room chip onto the plan and number it 101 ----
    await dragChip(page, 'room', 330, 320);
    await expect(page.locator('#pr-value')).toBeVisible();
    await page.fill('#pr-value', '101');
    await page.click('#pr-ok');
    await expect.poll(async () => (await doc(page)).items.filter((i) => i.type === 'room').length).toBe(1);
    const room0 = (await doc(page)).items.find((i) => i.type === 'room');
    expect(room0.number).toBe('101');

    // ---- 7. Drag the room: the number travels with the box (one group) ----
    const rc = await toClient(page, room0.x + room0.w / 2, room0.y + room0.h / 2);
    await page.mouse.move(rc[0], rc[1]);
    await page.mouse.down();
    await page.mouse.move(rc[0] + 90, rc[1] + 60, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const room1 = (await doc(page)).items.find((i) => i.id === room0.id);
    expect(room1.x).toBeGreaterThan(room0.x);
    expect(room1.y).toBeGreaterThan(room0.y);
    expect({ w: room1.w, h: room1.h }).toEqual({ w: room0.w, h: room0.h });
    const labelCentre = await page.evaluate((id) => {
      const c = window.__app.canvas.fabricCanvas;
      const g = c.getObjects().find((o) => o.itemId === id);
      const text = g.getObjects().find((o) => o.isType && o.isType('text'));
      const p = text.getCenterPoint();
      return { x: p.x, y: p.y, text: text.text };
    }, room0.id);
    expect(labelCentre.text).toBe('101');
    expect(Math.abs(labelCentre.x - (room1.x + room1.w / 2))).toBeLessThan(3);
    expect(Math.abs(labelCentre.y - (room1.y + room1.h / 2))).toBeLessThan(3);

    // ---- 8. Resize with the bottom-right corner control ----
    const br = await toClient(page, room1.x + room1.w, room1.y + room1.h);
    await page.mouse.move(br[0], br[1]);
    await page.mouse.down();
    await page.mouse.move(br[0] + 70, br[1] + 50, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const room2 = (await doc(page)).items.find((i) => i.id === room0.id);
    expect(room2.w).toBeGreaterThan(room1.w);
    expect(room2.h).toBeGreaterThan(room1.h);
    expect(Number.isInteger(room2.w) && Number.isInteger(room2.h)).toBe(true);

    // ---- 9. Drop a compass and rotate it with Fabric's rotate control ----
    const compassAt = await dragChip(page, 'compass', 700, 700);
    await expect.poll(async () => (await doc(page)).items.filter((i) => i.type === 'compass').length).toBe(1);
    await page.mouse.click(compassAt[0], compassAt[1]);
    await page.waitForTimeout(200);
    const mtr = await page.evaluate(() => {
      const c = window.__app.canvas.fabricCanvas;
      const o = c.getActiveObject();
      const r = c.upperCanvasEl.getBoundingClientRect();
      return o && o.oCoords && o.oCoords.mtr ? [r.left + o.oCoords.mtr.x, r.top + o.oCoords.mtr.y] : null;
    });
    expect(mtr).not.toBeNull();
    await page.mouse.move(mtr[0], mtr[1]);
    await page.mouse.down();
    await page.mouse.move(mtr[0] + 80, mtr[1] + 60, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const compass = (await doc(page)).items.find((i) => i.type === 'compass');
    expect(compass.deg).not.toBe(0);
    expect(Number.isInteger(compass.deg)).toBe(true);

    // ---- 10. Undo / redo ----
    const countBefore = (await doc(page)).items.length;
    await page.click('#btn-undo');
    await page.waitForTimeout(150);
    await page.click('#btn-redo');
    await page.waitForTimeout(150);
    expect((await doc(page)).items.length).toBe(countBefore);

    // ---- 11. Delete the compass ----
    await page.mouse.click(compassAt[0], compassAt[1]);
    await page.waitForTimeout(150);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await doc(page)).items.length).toBe(countBefore - 1);

    // ---- 12. Reload; the project reopens with the same items ----
    const itemsBefore = (await doc(page)).items.length;
    await page.waitForTimeout(1000); // let the debounced autosave land
    await page.reload();
    await expect(page.locator('#start')).toBeVisible();
    await page.locator('.project-card').first().locator('.btn-open').click();
    await expect(page.locator('#studio')).toBeVisible();
    await expect.poll(async () => (await doc(page)).items.length).toBe(itemsBefore);

    // ---- 13. Export opens the Preview first, then downloads the SVG on
    // "Download files" (hallways excluded) ----
    await page.click('#btn-export');
    await expect(page.locator('#preview')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#preview-download'),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.(svg|jpg)$/);
    await page.waitForEvent('download', { timeout: 4000 }).catch(() => {});
    await expect(page.locator('#ed-snippet')).toBeVisible();

    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});
