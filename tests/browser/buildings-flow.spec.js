// tests/browser/buildings-flow.spec.js
// The start screen lists buildings. Create building (name + property) -> the building page -> Start
// blueprint (building + property pre-filled and read-only; only floor + file name are asked) -> photo step
// -> back returns to the building page. Duplicate names are refused, empty buildings survive a reload,
// Delete asks first and removes the building and its floors.

import { test, expect } from '@playwright/test';
import { openApp, seedProject, allProjects } from './building.helpers.js';

function watch(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  return errors;
}

const hashOf = (name) => `#/b/${encodeURIComponent(name)}`;
const registry = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('fp.buildings') || '[]'));
const card = (page, name) => page.locator(`.building-card[data-building="${name}"]`);

async function createBuilding(page, name, prop = '55') {
  await page.click('#btn-start-blueprint');
  await page.fill('#cb-name', name);
  await page.fill('#cb-prop', prop);
  await page.click('#cb-ok');
}

// Removes the building the app way (its floors, registry entry, folder), so nothing is left behind.
async function cleanUp(page, name) {
  await page.evaluate(async (n) => {
    const { findBuilding, deleteBuilding } = await import('/js/store/buildings.js');
    const b = await findBuilding(window.__app, n);
    if (b) await deleteBuilding(window.__app, b);
  }, name);
}

test('create building -> building page -> Start blueprint (prefilled, read-only) -> photo step -> back', async ({ page }) => {
  const errors = watch(page);
  const NAME = `Flow Hall ${Date.now()}`;
  await openApp(page);

  // start screen: the button is "Create building", and the list begins empty
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#btn-start-blueprint')).toHaveText('Create building');
  await expect(page.locator('#open-json-input')).toHaveCount(1);
  await expect(page.locator('.building-card')).toHaveCount(0);

  // the modal: both fields required, Cancel closes it without creating anything
  await page.click('#btn-start-blueprint');
  await expect(page.locator('#cb-name')).toBeVisible();
  await page.click('#cb-cancel');
  await expect(page.locator('#cb-name')).toHaveCount(0);
  expect(await registry(page)).toEqual([]);
  await page.click('#btn-start-blueprint');
  await page.fill('#cb-name', NAME);
  await page.click('#cb-ok');
  await expect(page.locator('#cb-error')).toBeVisible(); // property is missing
  await expect(page.locator('#cb-name')).toBeVisible();
  await page.fill('#cb-prop', '55');
  await page.click('#cb-ok');

  // the building page
  await expect(page.locator('#building')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/b/${encodeURIComponent(NAME).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await expect(page.locator('#start')).toBeHidden();
  await expect(page.locator('#bd-name')).toHaveText(NAME);
  await expect(page.locator('#bd-sub')).toContainText('Property 55');
  await expect(page.locator('#bd-sub')).toContainText('0 floors');
  await expect(page.locator('#bd-floors .bd-empty')).toContainText('No floors yet');
  await expect(page.locator('#bd-floors .project-card')).toHaveCount(0);
  await expect(page.locator('#bd-start')).toHaveText('Start blueprint');
  await expect(page.locator('#bd-open-json')).toHaveCount(1);
  await expect(page.locator('#bd-import-svg')).toHaveCount(1);
  expect((await registry(page)).map((b) => [b.building, b.property])).toEqual([[NAME, '55']]);

  // Start blueprint: the old 4-field dialog with building + property fixed
  await page.click('#bd-start');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await expect(page).toHaveURL(new RegExp('/new$'));
  await expect(page.locator('#bp-building')).toHaveValue(NAME);
  await expect(page.locator('#bp-property')).toHaveValue('55');
  expect(await page.locator('#bp-building').evaluate((e) => e.readOnly)).toBe(true);
  expect(await page.locator('#bp-property').evaluate((e) => e.readOnly)).toBe(true);
  expect(await page.locator('#bp-floor').evaluate((e) => e.readOnly)).toBe(false);
  expect(await page.locator('#bp-slug').evaluate((e) => e.readOnly)).toBe(false);
  await expect(page.locator('#bp-floor')).toBeFocused();
  await expect(page.locator('.modal h3')).toContainText(`New floor in ${NAME}`);
  // a read-only field ignores typing
  await page.locator('#bp-building').click({ force: true });
  await page.keyboard.type('zzz');
  await expect(page.locator('#bp-building')).toHaveValue(NAME);

  // the file name follows the floor number
  await page.fill('#bp-floor', '0');
  await expect(page.locator('#bp-slug')).toHaveValue(/-0$/);
  await page.click('#bp-ok');
  await expect(page.locator('#photo-step')).toBeVisible();
  await expect(page.locator('#ps-drop')).toBeVisible();

  // back from the photo step -> the building page again (not the start screen)
  await page.click('#ps-back-projects');
  await expect(page.locator('#photo-step')).toBeHidden();
  await expect(page.locator('#building')).toBeVisible();
  await expect(page.locator('#bd-name')).toHaveText(NAME);
  await expect(page.locator('#start')).toBeHidden();
  await expect(page).toHaveURL(new RegExp('#/b/[^/]+$'));

  // cancelling the floor dialog also lands on the building page
  await page.click('#bd-start');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await expect(page.locator('#bp-floor')).toBeVisible();
  await page.click('#bp-cancel');
  await expect(page.locator('#building')).toBeVisible();
  await expect(page.locator('#bp-floor')).toHaveCount(0);

  // the back arrow goes to the start screen, where the building is listed
  await page.click('#bd-back');
  await expect(page.locator('#start')).toBeVisible();
  await expect(card(page, NAME)).toHaveCount(1);
  await expect(card(page, NAME).locator('h3')).toHaveText(NAME);
  await expect(card(page, NAME)).toContainText('Property 55');
  await expect(card(page, NAME)).toContainText('0 floors');

  await cleanUp(page, NAME);
  expect(errors).toEqual([]);
});

test('"Start blueprint" with a floor skipped through the studio and back to the building page lists the floor', async ({ page }) => {
  const errors = watch(page);
  const NAME = `Floors Hall ${Date.now()}`;
  await openApp(page);
  await createBuilding(page, NAME, '12');
  await page.click('#bd-start');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-floor', '0');
  await page.click('#bp-ok');
  await page.click('#ps-skip-initial');
  await expect(page.locator('#studio')).toBeVisible();

  // the studio's top-left button reads "← Floors" and returns to the building page
  await expect(page.locator('#btn-close')).toContainText('Floors');
  await page.click('#btn-close');
  await expect(page.locator('#building')).toBeVisible();
  await expect(page.locator('#studio')).toBeHidden();
  await expect(page.locator('#bd-name')).toHaveText(NAME);
  await expect(page.locator('#bd-floors .project-card')).toHaveCount(1);
  await expect(page.locator('#bd-floors .project-card h3')).toHaveText('Floor 0');
  await expect(page.locator('#bd-sub')).toContainText('1 floor');
  await expect(page.locator('#bd-floors .bd-empty')).toHaveCount(0);

  // Open on the floor card goes into the studio and back again
  await page.locator('#bd-floors .project-card .btn-open').click();
  await expect(page.locator('#studio')).toBeVisible();
  await page.click('#btn-close');
  await expect(page.locator('#building')).toBeVisible();

  // deleting the floor (with confirm) brings back the empty message
  await page.locator('#bd-floors .project-card .btn-delete').click();
  await page.click('#cf-cancel');
  await expect(page.locator('#bd-floors .project-card')).toHaveCount(1);
  await page.locator('#bd-floors .project-card .btn-delete').click();
  await page.click('#cf-ok');
  await expect(page.locator('#bd-floors .project-card')).toHaveCount(0);
  await expect(page.locator('#bd-floors .bd-empty')).toContainText('No floors yet');

  await cleanUp(page, NAME);
  expect(errors).toEqual([]);
});

test('a duplicate building name is refused in the modal (case and spacing ignored)', async ({ page }) => {
  const errors = watch(page);
  const NAME = `Dup Hall ${Date.now()}`;
  await openApp(page);
  await createBuilding(page, NAME, '1');
  await expect(page.locator('#building')).toBeVisible();
  await page.click('#bd-back');
  await expect(card(page, NAME)).toHaveCount(1);

  for (const dup of [NAME, NAME.toUpperCase(), `  ${NAME.replace(' ', '   ')}  `]) {
    await page.click('#btn-start-blueprint');
    await page.fill('#cb-name', dup);
    await page.fill('#cb-prop', '2');
    await page.click('#cb-ok');
    await expect(page.locator('#cb-error')).toBeVisible();
    await expect(page.locator('#cb-error')).toContainText('already exists');
    await expect(page.locator('#start')).toBeVisible(); // still on the start screen, modal still open
    await expect(page.locator('#cb-name')).toBeVisible();
    await page.click('#cb-cancel');
    await expect(page.locator('#cb-name')).toHaveCount(0);
  }
  await expect(page.locator('.building-card')).toHaveCount(1);
  expect(await registry(page)).toHaveLength(1);

  // the same name is fine once it differs
  await page.click('#btn-start-blueprint');
  await page.fill('#cb-name', `${NAME} Annex`);
  await page.fill('#cb-prop', '2');
  await page.click('#cb-ok');
  await expect(page.locator('#bd-name')).toHaveText(`${NAME} Annex`);
  expect(await registry(page)).toHaveLength(2);

  await cleanUp(page, NAME);
  await cleanUp(page, `${NAME} Annex`);
  expect(errors).toEqual([]);
});

test('a building with no floors shows the empty message and survives a reload', async ({ page }) => {
  const errors = watch(page);
  const NAME = `Empty Hall ${Date.now()}`;
  await openApp(page);
  await createBuilding(page, NAME, '77');
  await expect(page.locator('#bd-floors .bd-empty')).toContainText('No floors yet');

  // reload on the building page itself (deep link)
  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  await expect(page.locator('#building')).toBeVisible();
  await expect(page.locator('#bd-name')).toHaveText(NAME);
  await expect(page.locator('#bd-sub')).toContainText('Property 77');
  await expect(page.locator('#bd-floors .bd-empty')).toContainText('No floors yet');

  // and on the start screen
  await page.goto('/');
  await page.waitForFunction(() => !!window.__app);
  await expect(card(page, NAME)).toHaveCount(1);
  await expect(card(page, NAME)).toContainText('Property 77');
  await expect(card(page, NAME)).toContainText('0 floors');
  await card(page, NAME).locator('.btn-open').click();
  await expect(page).toHaveURL(new RegExp(`#/b/${encodeURIComponent(NAME).replace(/%20/g, '(%20|\\+)')}$`));
  await expect(page.locator('#bd-name')).toHaveText(NAME);

  // an unknown building in the URL still renders (name only, empty)
  await page.goto(`/${hashOf('Nobody Home')}`);
  await expect(page.locator('#building')).toBeVisible();
  await expect(page.locator('#bd-name')).toHaveText('Nobody Home');
  await expect(page.locator('#bd-floors .bd-empty')).toBeVisible();

  await cleanUp(page, NAME);
  expect(errors).toEqual([]);
});

test('Delete building asks first; Cancel keeps it, OK removes it and its floors', async ({ page }) => {
  const errors = watch(page);
  const KEEP = `Keep Hall ${Date.now()}`;
  const GONE = `Gone Hall ${Date.now()}`;
  await openApp(page);
  await seedProject(page, { building: GONE, property: '3', floor: 1, slug: `gone-1-${Date.now()}`, outline: true });
  await seedProject(page, { building: GONE, property: '3', floor: 2, slug: `gone-2-${Date.now()}`, outline: true });
  await seedProject(page, { building: KEEP, property: '4', floor: 1, slug: `keep-1-${Date.now()}`, outline: true });
  await createBuilding(page, `${GONE} Empty`, '9'); // a registered building with no floors
  await page.click('#bd-back');

  await page.goto('/');
  await page.waitForFunction(() => !!window.__app);
  await expect(page.locator('.building-card')).toHaveCount(3);
  await expect(card(page, GONE)).toContainText('2 floors');
  await expect(card(page, KEEP)).toContainText('1 floor');

  // Cancel: nothing happens
  await card(page, GONE).locator('.btn-delete').click();
  await expect(page.locator('#cf-ok')).toBeVisible();
  await expect(page.locator('.modal')).toContainText('2 floors');
  await page.click('#cf-cancel');
  await expect(card(page, GONE)).toHaveCount(1);
  expect((await allProjects(page)).filter((p) => p.building === GONE)).toHaveLength(2);

  // OK: the building and both floors are gone, the other building is untouched
  await card(page, GONE).locator('.btn-delete').click();
  await page.click('#cf-ok');
  await expect(card(page, GONE)).toHaveCount(0);
  await expect(card(page, KEEP)).toHaveCount(1);
  expect((await allProjects(page)).filter((p) => p.building === GONE)).toHaveLength(0);
  expect((await allProjects(page)).filter((p) => p.building === KEEP)).toHaveLength(1);

  // the empty registered building: deleting it removes the registry entry for good
  const empty = card(page, `${GONE} Empty`);
  await expect(empty).toContainText('0 floors');
  await empty.locator('.btn-delete').click();
  await expect(page.locator('.modal')).toContainText(`Delete "${GONE} Empty"?`);
  await page.click('#cf-ok');
  await expect(empty).toHaveCount(0);
  expect((await registry(page)).map((b) => b.building)).not.toContain(`${GONE} Empty`);

  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  await expect(page.locator('.building-card')).toHaveCount(1);
  await expect(card(page, KEEP)).toHaveCount(1);

  await cleanUp(page, KEEP);
  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  await expect(page.locator('.building-card')).toHaveCount(0);
  await expect(page.locator('#start')).toContainText('No buildings yet');
  expect(errors).toEqual([]);
});

test('legacy #/new route still opens the blank 4-field blueprint dialog', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/#/new');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await expect(page.locator('#bp-building')).toBeVisible();
  await expect(page.locator('#bp-building')).toHaveValue('');
  expect(await page.locator('#bp-building').evaluate((e) => e.readOnly)).toBe(false);
  expect(await page.locator('#bp-property').evaluate((e) => e.readOnly)).toBe(false);
  await page.click('#bp-cancel');
  await expect(page.locator('#start')).toBeVisible();
  expect(errors).toEqual([]);
});
