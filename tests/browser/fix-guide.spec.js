// tests/browser/fix-guide.spec.js
// "Worth a look" in the right sidebar: grouped problems, a click takes you straight to the first one
// (selected, map flies there, a guide card says what to do), a missing room number is typed right in
// the card (Enter saves and jumps on), and the old "Fix worth-a-looks" button is gone from View layers.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const PHOTO = readFileSync(new URL('../../samples/hjlc-1-posted.jpg', import.meta.url));

test('click a problem -> taken to it with instructions; type the number in place', async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));

  await page.goto('/');
  await page.goto('/#/new');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Guide Test');
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

  // the long note list is replaced by groups; "Fix all" sits beside the heading
  await expect(page.locator('#validation .wl-group').first()).toBeVisible();
  await expect(page.locator('#validation .notes-list')).toBeHidden();
  await expect(page.locator('#validation .section-title .wl-fixall')).toBeVisible();

  // the Layers sidebar no longer has the worth-a-look fixer
  await page.click('#btn-view');
  await page.click('#btn-layers');
  await expect(page.getByRole('button', { name: 'Fix worth-a-looks' })).toHaveCount(0);
  await page.click('#layers-panel .ly-x');

  // click "rooms need a number": the guide card appears with an input, and something is selected
  const numberGroup = page.locator('#validation .wl-group', { hasText: /needs? a number/  }).first();
  await expect(numberGroup).toBeVisible();
  const countBefore = parseInt((await numberGroup.innerText()).match(/^(\d+)/)[1], 10);
  await numberGroup.click();
  await expect(numberGroup).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#wl-guide')).toBeHidden();
  await page.locator('#validation .wl-stop').first().click();
  const inline = page.locator('#validation .wl-inline');
  await expect(inline.locator('.wl-input')).toBeFocused();
  expect(await page.evaluate(() => window.__app.selection.size)).toBeGreaterThan(0);

  // a bad number is refused with a reason; a good one saves and moves to the next room
  await inline.locator('.wl-input').fill('hello');
  await page.keyboard.press('Enter');
  await expect(inline.locator('.wl-err')).toContainText('Use a number like');
  await inline.locator('.wl-input').fill('S901');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const after = page.locator('#validation .wl-group', { hasText: /needs? a number/  });
  if (countBefore > 1) {
    await expect(after.first()).toContainText(String(countBefore - 1));
    await expect(inline.locator('.wl-input')).toBeVisible(); // jumped to the next room
    // the duplicate is refused
    await inline.locator('.wl-input').fill('S901');
    await page.keyboard.press('Enter');
    await expect(inline.locator('.wl-err')).toContainText('already used');
  }

  // a hallway group opens a card with instructions or a preview, never nothing
  const guide = page.locator('#wl-guide');
  const hall = page.locator('#validation .wl-group', { hasText: 'hallway' }).first();
  if (await hall.count()) {
    await hall.click();
    await page.locator('#validation .wl-stop').first().click();
    await page.locator('#validation .wl-inline').getByRole('button', { name: 'Show me how to fix it' }).click();
    await expect(guide).toBeVisible();
    await expect(guide.locator('.wl-btn').first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

async function buildGuidePlan(page) {
  await page.goto('/');
  await page.goto('/#/new');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Guide Test');
  await page.fill('#bp-property', '1');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await page.setInputFiles('#ps-file', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: PHOTO });
  await page.click('#ps-straighten');
  await page.click('#ps-autobuild');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await page.locator('.ab-ok').click({ timeout: 60000 });
  await expect(page.locator('.ab-card')).toHaveCount(0, { timeout: 90000 });
  await page.waitForTimeout(1500);
}

test('expanding a group lists exactly as many rows as its title count', async ({ page }) => {
  test.setTimeout(240000);
  await buildGuidePlan(page);
  const g = page.locator('#validation .wl-group').first();
  await expect(g).toBeVisible();
  const count = parseInt((await g.innerText()).match(/^(\d+)/)[1], 10);
  await g.click();
  await expect(g).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#validation .wl-stop')).toHaveCount(count);
});

test('saving a number inline removes that row and keeps the group open', async ({ page }) => {
  test.setTimeout(240000);
  await buildGuidePlan(page);
  const g = page.locator('#validation .wl-group.k-number').first();
  test.skip(!(await g.count()), 'this plan has no blank numbers');
  const count = parseInt((await g.innerText()).match(/^(\d+)/)[1], 10);
  await g.click();
  await expect(page.locator('#validation .wl-stop')).toHaveCount(count);
  await page.locator('#validation .wl-stop').first().click();
  await page.locator('#validation .wl-inline .wl-input').fill('S902');
  await page.locator('#validation .wl-inline').getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);
  if (count > 1) {
    await expect(page.locator('#validation .wl-stop')).toHaveCount(count - 1);
    await expect(page.locator('#validation .wl-group.k-number').first()).toHaveAttribute('aria-expanded', 'true');
  } else {
    await expect(page.locator('#validation .wl-stop')).toHaveCount(0);
  }
});
