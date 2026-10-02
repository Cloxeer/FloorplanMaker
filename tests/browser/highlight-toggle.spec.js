// tests/browser/highlight-toggle.spec.js
// A switch beside "Worth a look" turns the yellow plan highlights off and on (on by default, remembered).

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const PHOTO = readFileSync(new URL('../../samples/hjlc-1-posted.jpg', import.meta.url));

// how many canvas pixels are the highlight yellow
const yellowPixels = (page) => page.evaluate(() => {
  const c = document.querySelector('#stage canvas.lower-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 150 && d[i + 1] < 215 && d[i + 2] < 60) n++;
  return n;
});

test('highlight switch: on by default, off hides the yellow, on brings it back, choice is remembered', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));

  await page.goto('/');
  await page.evaluate(() => { try { localStorage.removeItem('fp.worthALookHighlights'); } catch (e) { /* ignore */ } });
  await page.goto('/#/new');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Toggle Test');
  await page.fill('#bp-property', '1');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await page.setInputFiles('#ps-file', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: PHOTO });
  await page.click('#ps-straighten');
  await page.click('#ps-autobuild');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await page.locator('.ab-ok').click({ timeout: 60000 }); // the outline check waits for "Looks right, continue"
  await expect(page.locator('.ab-card')).toHaveCount(0, { timeout: 90000 });
  await page.waitForTimeout(1500);

  const sw = page.locator('#validation .section-title .wl-switch input');
  await expect(sw).toBeChecked(); // on by default
  await expect.poll(() => yellowPixels(page), { timeout: 5000 }).toBeGreaterThan(200);

  await page.locator('#validation .wl-switch').click(); // off
  await expect(sw).not.toBeChecked();
  await expect.poll(() => yellowPixels(page), { timeout: 5000 }).toBeLessThan(20);
  expect(await page.evaluate(() => localStorage.getItem('fp.worthALookHighlights'))).toBe('off');

  await page.locator('#validation .wl-switch').click(); // on again
  await expect(sw).toBeChecked();
  await expect.poll(() => yellowPixels(page), { timeout: 5000 }).toBeGreaterThan(200);

  // the switch survives the checklist re-rendering (it is rebuilt after every change)
  await page.locator('#validation .wl-switch').click(); // off
  await page.click('#btn-undo');
  await page.waitForTimeout(800);
  await expect(page.locator('#validation .section-title .wl-switch input')).not.toBeChecked();
  expect(errors).toEqual([]);
});
