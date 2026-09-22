// walkthrough.spec.js
// End-to-end "guided flow" test: drives the app exactly the way a person
// would for a first-time floor plan, from blank start through a straightened
// photo, outline, doors, auto-suggested rooms, a hallway guide, a compass,
// and a final SVG export. Saves the exported SVG to samples/ so it can be
// inspected by hand. NOT wired into `npm test` (see smoke.spec.js header).
//
// To run:
//   node_modules/.bin/playwright test --config tests/browser/playwright.config.js tests/browser/walkthrough.spec.js

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const doc = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.doc)));

function toClient(page, x, y) {
  return page.evaluate(([px, py]) => {
    const v = window.__app.canvas.getView();
    const r = document.querySelector('#stage').getBoundingClientRect();
    return [r.left + (px - v.x) * v.zoom, r.top + (py - v.y) * v.zoom];
  }, [x, y]);
}

test.describe('Guided walkthrough', () => {
  test('blueprint -> photo -> outline -> doors -> suggested rooms -> hallway -> compass -> export', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e.stack || e)));

    // ---- Start blueprint (HJLC, 323, 1, hjlc-1-walkthrough) ----
    await page.goto('/');
    await page.click('#btn-start-blueprint');
    await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
    await page.fill('#bp-building', 'HJLC');
    await page.fill('#bp-property', '323');
    await page.fill('#bp-floor', '1');
    await page.fill('#bp-slug', 'hjlc-1-walkthrough').catch(() => {});
    await page.click('#bp-ok');

    // ---- Photo step: choose the sample photo, then Straighten ----
    await expect(page.locator('#photo-step')).toBeVisible();
    await page.setInputFiles('#ps-file', path.join(ROOT, 'samples', 'hjlc-1-posted.jpg'));
    await expect(page.locator('#ps-editor')).toBeVisible();
    await page.click('#ps-straighten');
    await expect(page.locator('#studio')).toBeVisible();
    await page.waitForTimeout(400);

    // ---- "Draw outline": click 4 corners of the building, then Enter ----
    await page.click('#btn-overlay-draw');
    const stage = await page.locator('#stage').boundingBox();
    const P = (fx, fy) => ({ x: stage.x + stage.width * fx, y: stage.y + stage.height * fy });
    for (const c of [P(0.12, 0.12), P(0.9, 0.12), P(0.9, 0.9), P(0.12, 0.9)]) {
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(40);
    }
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await doc(page)).floor?.points.length).toBe(4);

    // ---- "Place doors": click the left wall twice, then Esc ----
    await page.click('#btn-tool-door');
    const outline = (await doc(page)).floor.points;
    const [tl, , , bl] = outline;
    const leftMid1 = { x: tl[0], y: tl[1] + (bl[1] - tl[1]) * 0.3 };
    const leftMid2 = { x: tl[0], y: tl[1] + (bl[1] - tl[1]) * 0.7 };
    for (const p of [leftMid1, leftMid2]) {
      const c = await toClient(page, p.x, p.y);
      await page.mouse.click(c[0], c[1]);
      await page.waitForTimeout(80);
    }
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await doc(page)).items.filter((i) => i.type === 'door').length).toBe(2);

    // ---- Wait for the auto-suggest bar (runs automatically once the
    // outline exists on a fresh project), then "Keep all" ----
    await expect(page.locator('#sg-accept-all')).toBeVisible({ timeout: 30000 });
    // Let OCR finish reading numbers before accepting (best-effort; the bar
    // itself is already interactive).
    await page.waitForTimeout(1500);
    await page.click('#sg-accept-all');
    await expect.poll(async () => (await doc(page)).items.filter((i) => i.type === 'room').length, { timeout: 10000 })
      .toBeGreaterThanOrEqual(1);

    // ---- Select one unnumbered room and type 101 in the Number field ----
    const rooms = (await doc(page)).items.filter((i) => i.type === 'room');
    const unnumbered = rooms.find((r) => !r.number) || rooms[0];
    const rc = await toClient(page, unnumbered.x + unnumbered.w / 2, unnumbered.y + unnumbered.h / 2);
    await page.mouse.click(rc[0], rc[1]);
    await expect(page.locator('#p-number')).toBeVisible();
    await page.fill('#p-number', '101');
    await page.locator('#p-number').blur();
    await expect.poll(async () => (await doc(page)).items.find((i) => i.id === unnumbered.id).number).toBe('101');

    // ---- "Draw a hallway" drag ----
    await page.click('#btn-tool-hall');
    const hp1 = P(0.3, 0.45);
    const hp2 = P(0.65, 0.52);
    await page.mouse.move(hp1.x, hp1.y);
    await page.mouse.down();
    await page.mouse.move(hp2.x, hp2.y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await doc(page)).items.filter((i) => i.type === 'hall').length).toBe(1);
    await page.keyboard.press('Escape');

    // ---- Press C and click to place the compass ----
    await page.keyboard.press('c');
    const compassPt = P(0.85, 0.15);
    await page.mouse.click(compassPt.x, compassPt.y);
    await expect.poll(async () => (await doc(page)).items.filter((i) => i.type === 'compass').length).toBe(1);

    // ---- "Rotate +15°" ----
    await page.mouse.click(compassPt.x, compassPt.y);
    await expect(page.locator('#p-rotate-cw')).toBeVisible();
    await page.click('#p-rotate-cw');
    await expect.poll(async () => (await doc(page)).items.find((i) => i.type === 'compass').deg).toBe(15);

    // ---- Export: Preview opens first, then "Export ->" then "Download" ----
    await page.click('#btn-export');
    await expect(page.locator('#preview')).toBeVisible();
    await page.click('#preview-export');
    await expect(page.locator('#export-step')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-download'),
    ]);
    const outPath = path.join(ROOT, 'samples', 'hjlc-1-walkthrough.svg');
    await download.saveAs(outPath);

    const svg = fs.readFileSync(outPath, 'utf8');

    // ---- Assertions on the exported SVG ----
    const floorPolys = svg.match(/<polygon class="floor"/g) || svg.match(/class="floor"/g) || [];
    expect(floorPolys.length).toBeGreaterThanOrEqual(1);

    const roomRects = svg.match(/<rect class="room[^"]*"/g) || svg.match(/class="room[^"]*"/g) || [];
    expect(roomRects.length).toBeGreaterThanOrEqual(30);

    const exitLabels = svg.match(/>EXIT</g) || [];
    expect(exitLabels.length).toBe(2);

    expect(svg).toMatch(/rotate\(15\)/);

    const emptyTextEls = svg.match(/<text[^>]*><\/text>/g) || [];
    expect(emptyTextEls.length).toBe(0);

    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
