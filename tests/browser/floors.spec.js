// tests/browser/floors.spec.js
// Floors panel (View > Floors): lists the floors of the current building, switches between them and adds
// a new blank floor ("What floor is this?").

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup, allProjects } from './building.helpers.js';

const B = 'Floors Test Hall';
let ids = [];

test.beforeEach(async ({ page }) => { ids = []; await openApp(page); });
test.afterEach(async ({ page }) => {
  // also remove floors the app created during the test
  const created = (await allProjects(page)).filter((p) => p.building === B).map((p) => p.id);
  await cleanup(page, [...ids, ...created]);
});

async function seed(page, floor, extra = {}) {
  const slug = `ft-${floor}`;
  const p = await seedProject(page, { building: B, floor, slug, outline: true, room: true, ...extra });
  ids.push(p.id);
  return slug;
}
async function openFloors(page) {
  await page.click('#btn-view');
  await expect(page.locator('#view-popover')).toBeVisible();
  // Floors is the first control of the View popover
  expect(await page.locator('#view-popover').evaluate((p) => p.firstElementChild.id)).toBe('btn-floors');
  await page.click('#btn-floors');
  await expect(page.locator('#floors-panel')).toBeVisible();
}
const hash = (page) => page.evaluate(() => location.hash);

test('lists the building floors and marks the one being edited', async ({ page }) => {
  const s1 = await seed(page, 1), s2 = await seed(page, 2);
  // a different building must not show up
  const other = await seedProject(page, { building: 'Some Other Building', floor: 1, slug: 'ft-other', outline: true });
  ids.push(other.id);
  await openTrace(page, s1);
  await openFloors(page);
  const rows = page.locator('#floors-panel .fl-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-slug', s1);
  await expect(rows.nth(1)).toHaveAttribute('data-slug', s2);
  await expect(rows.nth(0)).toContainText('Floor 1');
  await expect(rows.nth(0)).toContainText('Editing');
  await expect(rows.nth(1)).not.toContainText('Editing');
  await expect(page.locator('#floors-panel h3')).toHaveText(B);
});

test('clicking another floor switches the editor to it', async ({ page }) => {
  const s1 = await seed(page, 1), s2 = await seed(page, 2);
  await openTrace(page, s1);
  await openFloors(page);
  await page.locator(`#floors-panel .fl-row[data-slug="${s2}"]`).click();
  await expect.poll(() => hash(page)).toBe(`#/p/${s2}/trace`);
  await page.waitForFunction((s) => window.__app.project && window.__app.project.slug === s, s2);
  expect(await page.evaluate(() => window.__app.doc.meta.floor)).toBe('2');
  // and the panel now marks floor 2 as the one being edited
  await openFloors(page);
  await expect(page.locator(`#floors-panel .fl-row[data-slug="${s2}"]`)).toContainText('Editing');
});

test('a floor with no photo and no outline opens the photo step', async ({ page }) => {
  const s1 = await seed(page, 1);
  const s3 = await seed(page, 3, { outline: false, room: false });
  await openTrace(page, s1);
  await openFloors(page);
  await page.locator(`#floors-panel .fl-row[data-slug="${s3}"]`).click();
  await expect.poll(() => hash(page)).toBe(`#/p/${s3}/photo`);
  await expect(page.locator('#photo-step')).toBeVisible();
});

test('+ Add a floor: validates, refuses duplicates, then starts a blank floor at the photo step', async ({ page }) => {
  const s1 = await seed(page, 1);
  await openTrace(page, s1);
  await openFloors(page);
  await page.getByRole('button', { name: '+ Add a floor' }).click();
  await expect(page.getByRole('heading', { name: 'What floor is this?' })).toBeVisible();

  await page.fill('#pr-value', 'abc');
  await page.click('#pr-ok');
  await expect(page.locator('.toast', { hasText: 'whole number' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'What floor is this?' })).toBeVisible(); // asked again
  await page.fill('#pr-value', '1');
  await page.click('#pr-ok');
  await expect(page.locator('.toast', { hasText: 'Floor 1 is already in this building' })).toBeVisible();

  await page.fill('#pr-value', '4');
  await page.click('#pr-ok');
  await expect.poll(() => hash(page)).toMatch(/^#\/p\/[^/]+\/photo$/);
  await expect(page.locator('#photo-step')).toBeVisible();
  const slug = (await hash(page)).split('/')[2];
  expect(slug).not.toBe(s1);

  const made = (await allProjects(page)).find((p) => p.slug === slug);
  expect(made).toBeTruthy();
  expect(made.building).toBe(B);
  expect(made.property).toBe('1');
  expect(String(made.floor)).toBe('4');
  expect(made.hasPhoto).toBe(false);
});

test('cancelling the prompt adds nothing', async ({ page }) => {
  const s1 = await seed(page, 1);
  await openTrace(page, s1);
  await openFloors(page);
  await page.getByRole('button', { name: '+ Add a floor' }).click();
  await page.click('#pr-cancel');
  expect((await allProjects(page)).filter((p) => p.building === B).length).toBe(1);
  expect(await hash(page)).toBe(`#/p/${s1}/trace`);
});
