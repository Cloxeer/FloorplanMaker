// tests/browser/overlap-dot.spec.js
// A red notification dot sits on View and View layers while any rooms overlap, and stays until the
// last overlap is fixed (here with the staged "Fix overlaps" flow).

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const PHOTO = readFileSync(new URL('../../samples/hjlc-1-posted.jpg', import.meta.url));

test('red dot on View and View layers until every overlap is fixed', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));

  await page.goto('/#/new'); // the legacy blank 4-field dialog (the building flow has its own spec)
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Dot Test');
  await page.fill('#bp-property', '1');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await page.setInputFiles('#ps-file', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: PHOTO });
  await expect(page.locator('#ps-straighten')).toBeVisible({ timeout: 10000 });
  await page.click('#ps-straighten');
  await page.click('#ps-autobuild');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await page.locator('.ab-ok').click({ timeout: 60000 }); // the outline check waits for "Looks right, continue"
  await expect(page.locator('.ab-card')).toHaveCount(0, { timeout: 90000 });

  // the dot appears on View ...
  await expect(page.locator('#btn-view.has-overlap')).toHaveCount(1, { timeout: 5000 });
  // ... and on View layers once the menu is open
  await page.click('#btn-view');
  await expect(page.locator('#btn-layers.has-overlap')).toHaveCount(1);
  await page.click('#btn-layers');
  await expect(page.locator('#layers-panel .ly-cluster').first()).toBeVisible();

  // fix every group: the dot must stay until the very last one
  await page.getByRole('button', { name: 'Fix overlaps' }).click();
  for (let guard = 0; guard < 30; guard++) {
    const yes = page.getByRole('button', { name: 'Yes, apply' });
    if (!(await yes.count())) break;
    await expect(page.locator('#btn-view.has-overlap')).toHaveCount(1); // still red while groups remain
    await yes.first().click();
    await page.waitForTimeout(350);
  }
  // Overlaps the fixer cannot settle (a room fully inside another) keep the dot on: that is the rule.
  // Remove those by hand and the dot must go.
  const left = await page.evaluate(async () => {
    const { countOverlaps } = await import('/js/model/overlapCount.js');
    return [...countOverlaps(window.__app.doc).ids];
  });
  if (left.length) {
    await expect(page.locator('#btn-view.has-overlap')).toHaveCount(1); // still red while any overlap is left
    await page.evaluate(async (ids) => {
      const { removeItems } = await import('/js/model/document.js');
      window.__app.commit(removeItems(window.__app.doc, ids), 'test: remove leftovers');
    }, left);
  }
  await expect(page.locator('#btn-view.has-overlap')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('#btn-layers.has-overlap')).toHaveCount(0);

  // undo brings the overlap (and the dot) back
  await page.click('#btn-undo');
  await expect(page.locator('#btn-view.has-overlap')).toHaveCount(1, { timeout: 5000 });
  expect(errors).toEqual([]);
});
