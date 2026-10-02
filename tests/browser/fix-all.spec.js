// tests/browser/fix-all.spec.js
// "Fix all" to the right of "Worth a look": safe fixes are applied at once (one undo step), the rest
// are walked through as approval cards in the Layers sidebar, and what cannot be fixed is listed.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const PHOTO = readFileSync(new URL('../../samples/hjlc-1-posted.jpg', import.meta.url));

test('Fix all: batch of safe fixes, approval cards, Needs-you list, red dot gone', async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));

  await page.goto('/');
  await page.goto('/#/new');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Fix All Test');
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

  // the button sits in the Worth a look heading
  const btn = page.locator('#validation .section-title .wl-fixall');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('Fix all');
  await expect(page.locator('#btn-view.has-overlap')).toHaveCount(1);
  await page.waitForTimeout(1500);
  const notesBefore = await page.locator('.notes-list li').count();
  await btn.click();

  // approvals show up as cards in the Layers sidebar
  await expect(page.locator('#wl-guide .ly-fixcard')).toBeVisible({ timeout: 10000 });
  for (let guard = 0; guard < 60; guard++) {
    const yes = page.locator('#wl-guide .ly-fixcard').getByRole('button', { name: 'Yes, apply' });
    if (!(await yes.count())) break;
    await yes.first().click();
    await page.waitForTimeout(300);
  }
  // summary with the else list ("Needs you") and the red dot is gone
  await expect(page.locator('#wl-guide .ly-fixcard')).toContainText('fixes applied');
  // the dot follows the plan: gone when no overlap is left, still on when only unfixable ones remain
  const overlapsLeft = await page.evaluate(async () => {
    const { countOverlaps } = await import('/js/model/overlapCount.js');
    return countOverlaps(window.__app.doc).pairs;
  });
  await expect(page.locator('#btn-view.has-overlap')).toHaveCount(overlapsLeft > 0 ? 1 : 0);
  const rows = page.locator('#wl-guide .ly-fixcard li, #wl-guide .ly-fixcard [data-ids]');
  expect(await rows.count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close' }).first().click();

  // everything it did can be undone step by step (stopping before the AutoBuild itself) and the notes return
  let restored = false;
  for (let i = 0; i < 40 && !restored; i++) {
    if (await page.locator('#btn-undo').isDisabled()) break;
    await page.click('#btn-undo');
    await page.waitForTimeout(1300);
    restored = (await page.locator('.notes-list li').count()) >= notesBefore - 2;
  }
  expect(restored).toBe(true);
  expect(errors).toEqual([]);
});
