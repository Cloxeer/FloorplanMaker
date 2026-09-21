// tests/browser/smoke.spec.js
// End-to-end smoke test driving the real app in a real browser with
// Playwright. NOT wired into `npm test` (Node's test runner can't run
// Playwright) and Playwright is intentionally NOT a package.json dependency.
//
// To run:
//   npx playwright install chromium   (once)
//   npx --yes -p @playwright/test -p playwright playwright test tests/browser --reporter=list
//
// Requires a static server at http://localhost:8080 (playwright.config.js
// starts one via `npx serve` if none is already running).

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PHOTO = path.join(__dirname, '..', '..', 'samples', 'hjlc-1-straight.jpg');

// Mirrors photoStep.js's default-corners + straighten math (5% inset quad,
// output size = average of the quad's side lengths) so we can predict the
// resulting doc.viewBox without reading private app state.
function expectedStraightenedSize(w, h) {
  const ix = w * 0.05, iy = h * 0.05;
  const outW = Math.round(w - 2 * ix);
  const outH = Math.round(h - 2 * iy);
  return { w: outW, h: outH };
}

// Mirrors canvas.js's zoomTo(fit=true): fits doc.viewBox into the stage
// element with a 24px margin, uniformly scaled, then re-expands to the
// container's own aspect ratio.
function expectedFitView(vb, rect) {
  const margin = 24;
  const availW = Math.max(1, rect.width - margin * 2);
  const availH = Math.max(1, rect.height - margin * 2);
  const scale = Math.min(availW / vb.w, availH / vb.h);
  return { w: rect.width / scale, h: rect.height / scale };
}

test.describe('NMSU Floor Plan Studio smoke test', () => {
  test('start -> photo -> draw -> export -> reload -> import round-trip', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/');

    // ---- 1. Start blueprint ----
    await page.click('#btn-start-blueprint');
    await page.fill('#bp-building', 'Hardman Jacobs Learning Center');
    await page.fill('#bp-property', '1234');
    await page.fill('#bp-floor', '1');
    // leave #bp-slug on its auto-suggested value
    await page.click('#bp-ok');

    // ---- 2. Add photo ----
    await expect(page.locator('#photo-step')).toBeVisible();
    await page.setInputFiles('#ps-file', SAMPLE_PHOTO);
    await expect(page.locator('#ps-editor')).toBeVisible();
    await page.click('#ps-straighten');

    await expect(page.locator('#studio')).toBeVisible();
    const canvas = page.locator('#canvas');
    await expect(canvas).toBeVisible();

    // Read the sample photo's own pixel size straight from its JPEG header
    // (a page.evaluate(Image) load would need a file:// URL, which sandboxed
    // browsers commonly block).
    const vb = readJpegSize(SAMPLE_PHOTO);
    const expectedVb = expectedStraightenedSize(vb.w, vb.h);

    const stageRect = await page.locator('#stage').boundingBox();
    const expectedView = expectedFitView(expectedVb, stageRect);
    const actualViewBoxAttr = await canvas.getAttribute('viewBox');
    const [, , actualW, actualH] = actualViewBoxAttr.trim().split(/\s+/).map(Number);
    expect(Math.abs(actualW - expectedView.w)).toBeLessThan(3);
    expect(Math.abs(actualH - expectedView.h)).toBeLessThan(3);

    // ---- 3. Draw the floor outline (tool hotkey F / palette button) ----
    await page.click('.tool-btn[data-tool="floor"]');
    const box = await canvas.boundingBox();
    const corners = [
      { x: box.x + box.width * 0.15, y: box.y + box.height * 0.15 },
      { x: box.x + box.width * 0.85, y: box.y + box.height * 0.15 },
      { x: box.x + box.width * 0.85, y: box.y + box.height * 0.85 },
      { x: box.x + box.width * 0.15, y: box.y + box.height * 0.85 },
    ];
    for (const c of corners) {
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.up();
    }
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-id="floor"]')).toHaveCount(1);

    // ---- 4. Draw a room ----
    await page.click('.tool-btn[data-tool="room"]');
    const roomStart = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 };
    const roomEnd = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.55 };
    await page.mouse.move(roomStart.x, roomStart.y);
    await page.mouse.down();
    await page.mouse.move(roomEnd.x, roomEnd.y, { steps: 5 });
    await page.mouse.up();
    const numberInput = page.locator('#pr-value');
    await expect(numberInput).toBeVisible();
    await numberInput.fill('128B');
    await page.click('#pr-ok');

    // ---- 5. Duplicate in a row (D), accept the auto-incremented number ----
    await page.click('.tool-btn[data-tool="select"]');
    // select the room we just drew (drawing a room does not auto-select it);
    // click near a corner, not dead center, so we hit the room body and not
    // its centered number label (clicking the label starts a label-drag and
    // does not select the room).
    await page.mouse.click(box.x + box.width * 0.37, box.y + box.height * 0.37);
    await page.keyboard.press('d');
    await expect(numberInput).toBeVisible();
    await expect(numberInput).toHaveValue('128C');
    await page.click('#pr-ok');

    // ---- 6. Drop a door on the outline edge ----
    await page.click('.tool-btn[data-tool="door"]');
    const doorPoint = { x: (corners[0].x + corners[1].x) / 2, y: corners[0].y };
    await page.mouse.click(doorPoint.x, doorPoint.y);
    await expect(page.locator('line.door[data-id]')).toHaveCount(1);

    // ---- 7. Validation shows 0 errors ----
    await page.click('.tool-btn[data-tool="select"]');
    await expect(page.locator('.validation-header')).toContainText('0 errors', { timeout: 5000 });

    // ---- 8. Reload; confirm the project card exists and reopens with the same items ----
    // count doc items only (data-part="body"), not selection-handle nodes
    // (resize/repeat/floor-vertex handles also carry data-id but a different
    // data-part, and only render while something is selected).
    const itemCountBefore = await page.locator('#canvas [data-part="body"]').count();
    // autosave is debounced (300ms) before the IndexedDB write; give it time
    // to land before reloading, so the reload doesn't race the write.
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(page.locator('#start')).toBeVisible();
    const card = page.locator('.project-card').first();
    await expect(card).toBeVisible();
    await card.locator('.btn-open').click();
    await expect(page.locator('#studio')).toBeVisible();
    await expect
      .poll(async () => page.locator('#canvas [data-part="body"]').count())
      .toBe(itemCountBefore);

    // ---- 9. Export: capture the downloaded .svg text ----
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fps-smoke-'));
    const [download1] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-export'),
    ]);
    // a second download (-posted.jpg) fires alongside the .svg; wait briefly
    // for it too so it doesn't leak into the next export's wait.
    let svgDownload = download1;
    if (!download1.suggestedFilename().endsWith('.svg')) {
      const [download2] = await Promise.all([page.waitForEvent('download')]);
      svgDownload = download2.suggestedFilename().endsWith('.svg') ? download2 : download1;
    } else {
      await page.waitForEvent('download', { timeout: 3000 }).catch(() => {});
    }
    const svgPath1 = path.join(tmpDir, 'export1.svg');
    await svgDownload.saveAs(svgPath1);
    const svgText1 = fs.readFileSync(svgPath1, 'utf8');
    await page.click('#ed-close');

    // ---- 10. Import that saved SVG through the Import .svg input; re-export and diff ----
    await page.click('#btn-close');
    await expect(page.locator('#start')).toBeVisible();
    await page.setInputFiles('#import-svg-input', svgPath1);
    await expect(page.locator('#studio')).toBeVisible();

    const [download3] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-export'),
    ]);
    let svgDownload2 = download3;
    if (!download3.suggestedFilename().endsWith('.svg')) {
      const [download4] = await Promise.all([page.waitForEvent('download')]);
      svgDownload2 = download4.suggestedFilename().endsWith('.svg') ? download4 : download3;
    } else {
      await page.waitForEvent('download', { timeout: 3000 }).catch(() => {});
    }
    const svgPath2 = path.join(tmpDir, 'export2.svg');
    await svgDownload2.saveAs(svgPath2);
    const svgText2 = fs.readFileSync(svgPath2, 'utf8');

    expect(svgText2).toBe(svgText1);

    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});

function readJpegSize(filePath) {
  const buf = fs.readFileSync(filePath);
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  throw new Error(`Could not read JPEG dimensions from ${filePath}`);
}
