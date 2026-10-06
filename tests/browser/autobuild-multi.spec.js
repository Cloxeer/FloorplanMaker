// tests/browser/autobuild-multi.spec.js
// One floor posted as several photos: pick them all, flatten each, AutoBuild on the merge board builds every photo
// and joins the plans (shared room numbers), places the photos to match, and the result is ONE plan.
// Uses the Jett Hall floor-2 posters in tests/fixtures/autobuild (two posters of the same floor, one turned 180 degrees).

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const fx = (name) => ({ name, mimeType: 'image/webp', buffer: readFileSync(new URL(`../fixtures/autobuild/${name}`, import.meta.url)) });
let errors = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
});
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const { deleteProject, listProjects } = await import('/js/store/autosave.js');
    for (const p of await listProjects()) if (p.building === 'Multi Test') await deleteProject(p.id);
  }).catch(() => {});
  expect(errors).toEqual([]);
});

test('two posters of one floor become one plan with the photos placed to match', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/#/new');
  await page.waitForFunction(() => !!window.__app);
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Multi Test');
  await page.fill('#bp-property', '9');
  await page.fill('#bp-floor', '2');
  await page.click('#bp-ok');
  await page.setInputFiles('#ps-multi-file', [fx('13-jett-f2-b.webp'), fx('14-jett-f2-c.webp')]);
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('#ps-straighten')).toBeVisible({ timeout: 30000 });
    await page.click('#ps-straighten');
    await page.click('#ps-next-photo');
  }
  await expect(page.locator('#ms-svg')).toBeVisible({ timeout: 30000 });
  await page.click('#ms-auto');
  await page.locator('.ab-ok').click({ timeout: 200000 });
  await page.waitForFunction(() => window.__app.doc.items.length > 10 && !document.querySelector('.ab-card'), null, { timeout: 200000 });
  const r = await page.evaluate(() => {
    const d = window.__app.doc, p = window.__app.project;
    const nums = d.items.filter((i) => i.type === 'room' && i.number).map((i) => i.number);
    const m = window.__app._lastMulti;
    return { rooms: nums.length, dupes: nums.length - new Set(nums).size, extra: (p.extraPhotos || []).length, hasT: !!(p.extraPhotos[0] && p.extraPhotos[0].t), how: m.transforms.map((t) => t.how), outline: !!d.floor };
  });
  expect(r.extra).toBe(1);
  expect(r.hasT).toBe(true);
  expect(r.rooms).toBeGreaterThan(20);
  expect(r.dupes).toBe(0); // a room on both posters is there once
  expect(r.how[1]).toBe('rooms'); // joined by the room numbers they share
  expect(r.outline).toBe(true);
});
