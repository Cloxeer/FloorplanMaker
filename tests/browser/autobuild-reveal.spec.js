// tests/browser/autobuild-reveal.spec.js
// AutoBuild reveals the plan slowly and in stages. First the outline is drawn and the build WAITS for a
// yes ("Is the outline right?"); only after Enter / the button do hallways, rooms, stairs and the compass
// follow. "I'll fix it myself" (or Esc) stops after the outline, as one undo step.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const PHOTO = readFileSync(new URL('../../samples/hjlc-1-posted.jpg', import.meta.url));

function watch(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  return errors;
}

// the photo step may or may not have the Flatten screen in front of AutoBuild: handle both
async function startAutoBuild(page) {
  await page.goto('/#/new'); // the legacy blank 4-field dialog (the building flow has its own spec)
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Reveal Test');
  await page.fill('#bp-property', '1');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await page.setInputFiles('#ps-file', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: PHOTO });
  const ab = page.locator('#ps-autobuild');
  await expect.poll(async () => (await ab.isVisible()) || (await page.locator('#ps-straighten').isVisible()), { timeout: 15000 }).toBe(true);
  if (!(await ab.isVisible())) await page.click('#ps-straighten');
  await expect(ab).toBeVisible({ timeout: 30000 });
  await ab.click();
}

const counts = (page) => page.evaluate(() => {
  const d = window.__app._autobuildShown() || window.__app.doc; // what is on the stage (the build commits at the end)
  const n = (t) => d.items.filter((i) => i.type === t).length;
  return { floor: !!d.floor, rooms: n('room'), halls: n('hall'), compass: n('compass'), total: d.items.length };
});

test('outline first and the build waits; Enter continues; compass is last', async ({ page }) => {
  test.setTimeout(300000);
  const errors = watch(page);
  await startAutoBuild(page);
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });

  // stage 1: the outline card appears and nothing but the outline is on the plan
  const card = page.locator('.ab-confirm');
  await expect(card).toBeVisible({ timeout: 180000 });
  await expect(card.locator('h3')).toHaveText('Is the outline right?');
  await expect(card).toContainText(/Orange dashed sections|wall all the way round/);
  await expect(page.locator('.ab-confirm .ab-ok')).toHaveText('Looks right, continue');
  await expect(page.locator('.ab-confirm .ab-fix')).toHaveText("I'll fix it myself");
  for (let k = 0; k < 5; k++) { // the build WAITS: >= 2 s with only the outline in the document
    await page.waitForTimeout(500);
    const c = await counts(page);
    expect(c.rooms).toBe(0);
    expect(c.total).toBe(0);
    await expect(card).toBeVisible();
  }
  expect(await counts(page)).toMatchObject({ floor: true, rooms: 0 });

  // Enter = looks right, continue: rooms appear afterwards, the compass last
  await page.keyboard.press('Enter');
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await counts(page)).rooms, { timeout: 60000 }).toBeGreaterThan(0);
  const order = [];
  await expect.poll(async () => {
    const c = await counts(page);
    if (c.compass && !order.includes('compass')) order.push('compass');
    if (c.rooms && !order.includes('rooms')) order.push('rooms');
    return await page.locator('.ab-card').count();
  }, { timeout: 120000, intervals: [100] }).toBe(0);
  const done = await counts(page);
  expect(done.rooms).toBeGreaterThan(5);
  expect(done.compass).toBeLessThanOrEqual(1);
  if (done.compass) expect(order.indexOf('rooms')).toBeLessThan(order.indexOf('compass')); // rooms before the compass
  expect(errors).toEqual([]);
});

test("I'll fix it myself keeps only the outline, as one undo step", async ({ page }) => {
  test.setTimeout(300000);
  const errors = watch(page);
  await startAutoBuild(page);
  await expect(page.locator('.ab-confirm')).toBeVisible({ timeout: 180000 });
  await page.click('.ab-confirm .ab-fix');
  await expect(page.locator('.ab-card')).toHaveCount(0);
  await page.waitForTimeout(1500);
  const c = await counts(page);
  expect(c).toMatchObject({ floor: true, rooms: 0, total: 0 });
  expect(await page.evaluate(() => window.__app.doc.floor.points.length)).toBeGreaterThanOrEqual(4);
  await page.click('#btn-undo'); // one undo step takes the outline away again
  expect(await page.evaluate(() => !!window.__app.doc.floor)).toBe(false);
  expect(errors).toEqual([]);
});

test('Esc on the outline card also means fix it myself; Cancel leaves the plan empty', async ({ page }) => {
  test.setTimeout(300000);
  const errors = watch(page);
  await startAutoBuild(page);
  await expect(page.locator('.ab-confirm')).toBeVisible({ timeout: 180000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.ab-card')).toHaveCount(0);
  expect(await counts(page)).toMatchObject({ floor: true, rooms: 0 });
  await page.click('#btn-undo');

  await startAutoBuild(page);
  await expect(page.locator('.ab-confirm')).toBeVisible({ timeout: 180000 });
  await page.click('.ab-confirm .ab-cancel2');
  await expect(page.locator('.ab-card')).toHaveCount(0);
  expect(await counts(page)).toMatchObject({ floor: false, total: 0 });
  expect(errors).toEqual([]);
});
