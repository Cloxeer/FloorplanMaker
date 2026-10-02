// tests/browser/reenter-studio.spec.js
// Regression: entering the studio for an already-open project (View > Change
// photo, then Flatten) used to throw "Trying to initialize a canvas that has
// already been initialized" because the first studio was never torn down.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const PHOTO = readFileSync(new URL('../fixtures/autobuild/06-jett-b-a.webp', import.meta.url));

async function upload(page) {
  await page.setInputFiles('#ps-file', { name: 'p.webp', mimeType: 'image/webp', buffer: PHOTO });
  await expect(page.locator('#ps-straighten')).toBeVisible({ timeout: 10000 });
}

test('Change photo -> Flatten re-enters the studio cleanly', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));

  await page.goto('/#/new'); // the legacy blank 4-field dialog (the building flow has its own spec)
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Reenter Test');
  await page.fill('#bp-property', '1');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await upload(page);
  await page.click('#ps-straighten');
  await page.click('#ps-start-tracing');
  await expect(page.locator('#studio')).toBeVisible();

  await page.click('#btn-view');
  await page.click('#btn-photo');
  await expect(page.locator('#photo-step')).toBeVisible();
  await upload(page);
  await page.click('#ps-straighten');
  await page.click('#ps-start-tracing');
  await expect(page.locator('#studio')).toBeVisible();
  await page.waitForTimeout(500);

  expect(await page.locator('#stage .canvas-container').count()).toBe(1);
  expect(errors).toEqual([]);
});
