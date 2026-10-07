// tests/browser/ignore.spec.js
// "Ignore" on the fix problems: nobody is forced to fix a note. An ignored problem leaves the list (and the yellow outline),
// stops blocking Export, is kept with the project, and can be put back from "Ignored".

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup } from './building.helpers.js';

const SLUG = 'ignore-test-1';
let ids = [];
test.beforeEach(async ({ page }) => { ids = []; await openApp(page); });
test.afterEach(async ({ page }) => { await cleanup(page, ids); });

async function setup(page) {
  const p = await seedProject(page, { building: 'Ignore Test', floor: 1, slug: SLUG, outline: true, room: true, ready: true });
  ids.push(p.id);
  await openTrace(page, SLUG);
  await page.evaluate(async () => { // two rooms with no number: the checklist asks for them
    const { addItem, makeRoom } = await import('/js/model/document.js');
    let d = window.__app.doc;
    d = addItem(d, makeRoom('room', 150, 300, 100, 80, ''));
    d = addItem(d, makeRoom('room', 300, 300, 100, 80, ''));
    window.__app.commit(d, 'add rooms');
  });
}
const numberGroup = (page) => page.locator('#validation .wl-group.k-number');
const open = async (page) => { if ((await numberGroup(page).getAttribute('aria-expanded')) !== 'true') await numberGroup(page).click(); };

test('Ignore on a room that needs a number: it leaves the list, Export unblocks, and Stop ignoring brings it back', async ({ page }) => {
  await setup(page);
  await expect(numberGroup(page)).toContainText('2 rooms need a number');
  await open(page);
  await page.locator('#validation .wl-stop').first().click();
  await page.locator('#validation .wl-inline').getByRole('button', { name: 'Ignore', exact: true }).click();
  await expect(numberGroup(page)).toContainText('1 room needs a number');
  await expect(page.locator('#validation .wl-ignored summary')).toContainText('Ignored (1)');
  expect(await page.evaluate(() => window.__app.project.ignored.length)).toBe(1);
  // ignore the other one with "Ignore all": the group goes, and the checklist no longer blocks Export
  await open(page);
  await page.locator('#validation .wl-stops .wl-ignall').click();
  await expect(numberGroup(page)).toHaveCount(0);
  await expect(page.locator('#validation .wl-ignored summary')).toContainText('Ignored (2)');
  await expect(page.locator('#btn-export')).toBeEnabled();
  expect(await page.evaluate(() => window.__app._attention.count())).toBe(0); // no yellow outlines for ignored rooms
  // it is kept with the project
  await page.reload();
  await page.waitForFunction(() => !!window.__app && window.__app.project && window.__app.project.ignored && window.__app.project.ignored.length === 2);
  // put one back
  await page.locator('#validation .wl-ignored summary').click();
  await page.locator('#validation .wl-ignored .wl-ign').first().click();
  await expect(numberGroup(page)).toContainText('1 room needs a number');
  await page.locator('#validation .wl-ignored .wl-ign').first().click();
  await expect(numberGroup(page)).toContainText('2 rooms need a number');
  await expect(page.locator('#validation .wl-ignored')).toHaveCount(0);
});

test('Fix all leaves ignored rooms alone', async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(() => JSON.stringify(window.__app.doc.items.filter((i) => i.type === 'room' && !i.number)));
  await open(page);
  await page.locator('#validation .wl-stops .wl-ignall').click();
  await page.locator('#validation .wl-fixall').click();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => JSON.stringify(window.__app.doc.items.filter((i) => i.type === 'room' && !i.number)));
  expect(after).toBe(before);
});
