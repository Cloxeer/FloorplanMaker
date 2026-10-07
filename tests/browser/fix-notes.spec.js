// tests/browser/fix-notes.spec.js
// End-to-end: "Worth a look" groups + guide card (right sidebar), "Fix all" (safe fixes in one Undo step, then
// approval cards: Yes / Yes to all of this kind / Skip / Stop, a "Needs you" summary), the yellow outlines
// on the plan, and the Layers sidebar's "Fix overlaps" (unchanged).

import { test, expect } from '@playwright/test';
import { buildPlan, openLayers, watchErrors, notesCount, docState, undoDepth } from './fix-notes.helpers.js';

const guide = (page) => page.locator('#wl-guide');
const card = (page) => guide(page).locator('.ly-fixcard');
const press = (page, name) => card(page).getByRole('button', { name, exact: true }).click();
const outlined = (page) => page.evaluate(() => window.__app._attention.count());
const overlapCount = (page) => page.evaluate(async () => (await import('/js/model/overlaps.js')).allOverlapPairs(window.__app.doc).length);
const isDone = async (page) => /done/i.test(await card(page).locator('h4').first().innerText());
const openFirstGuide = async (page) => {
  const g = page.locator('#validation .wl-group:not(.k-number):not(.k-numfix)').first();
  test.skip(!(await g.count()), 'this plan has no group with a guide card');
  await g.click();
  await page.locator('#validation .wl-stop').first().click();
  const how = page.locator('#validation .wl-inline').getByRole('button', { name: 'Show me how to fix it' });
  if (await how.count()) await how.click();
};
const fixAll = (page) => page.locator('#validation .wl-fixall').click();

async function runToEnd(page, action) {
  for (let i = 0; i < 200 && (await card(page).count()) && !(await isDone(page)); i++) await press(page, action(i));
}
const stubModel = (page, body) => page.route('**/js/model/fixNotes.js', (r) => r.fulfill({ contentType: 'text/javascript', body }));

test.describe('Worth a look: groups, guide, Fix all', () => {
  test.beforeEach(async ({ page }) => { page.errors = watchErrors(page); await buildPlan(page, '02-hjlc-f2.webp'); });
  test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

  test('groups replace the long list; a group expands, a row flies to the problem and opens the guide card', async ({ page }) => {
    expect(await page.locator('#validation .wl-group').count()).toBeGreaterThan(0);
    await expect(page.locator('#validation .notes-list')).toBeHidden();
    expect(await outlined(page)).toBeGreaterThan(0);
    await openFirstGuide(page);
    await expect(guide(page)).toBeVisible();
    expect(await page.evaluate(() => window.__app.selection.size)).toBeGreaterThan(0);
    await guide(page).getByRole('button', { name: '×' }).click();
    await expect(guide(page)).toBeHidden();
  });

  test('the guide card stays in view when the sidebar is scrolled down to the group list', async ({ page }) => {
    await page.evaluate(() => { const p = document.getElementById('props'); p.scrollTop = p.scrollHeight; });
    await openFirstGuide(page);
    await expect(guide(page)).toBeInViewport();
    await guide(page).getByRole('button', { name: '×' }).click();
    await page.evaluate(() => { const p = document.getElementById('props'); p.scrollTop = p.scrollHeight; });
    await fixAll(page);
    await expect(page.locator('.toast').first()).toBeVisible();
    if (await card(page).count()) await expect(card(page)).toBeInViewport();
  });

  test('missing numbers: Enter saves (one Undo step) and jumps on; bad input explains itself', async ({ page }) => {
    const group = page.locator('#validation .wl-group.k-number').first();
    test.skip(!(await group.count()), 'this plan has no blank numbers');
    await group.click();
    await page.locator('#validation .wl-stop').first().click();
    const input = page.locator('#validation .wl-inline .wl-input');
    await expect(input).toBeVisible();
    const depth0 = await undoDepth(page);
    await input.fill('ab');
    await page.keyboard.press('Enter');
    await expect(page.locator('#validation .wl-inline .wl-err')).toContainText('Use a number');
    expect(await undoDepth(page)).toBe(depth0);
    await input.fill('901');
    await page.keyboard.press('Enter');
    expect(await undoDepth(page)).toBe(depth0 + 1);
    await page.click('#btn-undo');
    expect(await undoDepth(page)).toBe(depth0);
  });

  test('Fix all: safe fixes in one step, approvals one by one, every step undoable', async ({ page }) => {
    const notes = await notesCount(page);
    const outlined0 = await outlined(page);
    const start = await docState(page), depth0 = await undoDepth(page), overlaps0 = await overlapCount(page);
    await fixAll(page);
    await expect(page.locator('.toast').first()).toBeVisible();
    expect(await undoDepth(page)).toBeLessThanOrEqual(depth0 + 1); // all the safe fixes are ONE undo step
    if (await card(page).count()) {
      await expect(card(page)).toContainText('Apply it?');
      await press(page, 'Yes, apply');
      if (await card(page).count() && !(await isDone(page))) await press(page, 'Skip');
      if (await isDone(page)) await press(page, 'Close'); else await page.keyboard.press('Escape'); // stop, or close the summary
      await expect(card(page)).toHaveCount(0);
      await fixAll(page); // resume: skips are forgotten
      if (await card(page).count()) await page.keyboard.press('Enter'); // = yes
      await runToEnd(page, (i) => (i % 3 === 2 ? 'Skip' : 'Yes to all of this kind'));
    }
    const applied = (await undoDepth(page)) - depth0;
    expect(applied).toBeGreaterThan(0);
    expect(await notesCount(page)).toBeLessThan(notes);
    expect(await outlined(page)).toBeLessThanOrEqual(outlined0); // fixed notes lose their yellow outline (a room can still be flagged for another reason)
    expect(await overlapCount(page)).toBeLessThanOrEqual(overlaps0);
    if (await card(page).count()) {
      const rows = card(page).locator('.ly-need .ly-row');
      if (await rows.count()) {
        await rows.first().click();
        expect(await page.evaluate(() => window.__app.selection.size)).toBeGreaterThan(0);
      }
      await press(page, 'Close');
    }
    const end = await docState(page);
    for (let i = 0; i < applied; i++) await page.click('#btn-undo');
    expect(await docState(page)).toBe(start);
    for (let i = 0; i < applied; i++) await page.click('#btn-redo');
    expect(await docState(page)).toBe(end);
  });

  test('undo during an approval card recomputes it; rapid double click is harmless', async ({ page }) => {
    const start = await docState(page), depth0 = await undoDepth(page);
    await fixAll(page);
    test.skip(!(await card(page).count()), 'nothing needed approval');
    await press(page, 'Yes, apply');
    const steps = (await undoDepth(page)) - depth0;
    for (let i = 0; i < steps; i++) { await page.click('#btn-undo'); await page.waitForTimeout(100); }
    await page.waitForTimeout(300);
    expect(await docState(page)).toBe(start);
    await page.dblclick('#validation .wl-fixall');
    await page.waitForTimeout(300);
  });

  test('preview step: keys cannot apply a hidden fix, click-to-zoom still works', async ({ page }) => {
    await fixAll(page);
    test.skip(!(await card(page).count()), 'nothing needed approval');
    await page.locator('#step-strip button', { hasText: 'Preview' }).click();
    await page.waitForTimeout(500);
    const d0 = await undoDepth(page);
    await page.keyboard.press('Enter');
    expect(await undoDepth(page)).toBe(d0);
    await page.locator('#preview-svg-wrap svg').first().click({ position: { x: 300, y: 200 } });
    await expect.poll(() => page.locator('#preview-svg-wrap').evaluate((w) => (w.parentElement.innerText.match(/\d+%/g) || []).join())).toBe('250%');
    await page.click('#preview-back-top');
    await expect(card(page)).toHaveCount(1);
  });

  test('two-finger pan moves the map, a wheel step zooms, ctrl+wheel zooms', async ({ page }) => {
    const view = () => page.evaluate(() => window.__app.canvas.fabricCanvas.viewportTransform.slice());
    const wheel = (dx, dy, ctrl) => page.evaluate(([dx, dy, ctrl]) => {
      const c = document.querySelector('#stage canvas.upper-canvas'); const r = c.getBoundingClientRect();
      c.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, ctrlKey: ctrl, clientX: r.left + 300, clientY: r.top + 300, bubbles: true, cancelable: true }));
    }, [dx, dy, ctrl]);
    const v0 = await view();
    await wheel(3, 5, false);
    const v1 = await view();
    expect(v1[0]).toBeCloseTo(v0[0], 6);
    expect(v1[4]).not.toBe(v0[4]);
    await page.waitForTimeout(250); // a lone notch, after the drag has ended
    await wheel(0, 100, false);
    // the zoom eases in over a few animation frames, so wait for it to move
    await expect.poll(async () => (await view())[0], { timeout: 5000 }).not.toBeCloseTo(v1[0], 3);
    await page.waitForTimeout(600);
    const z = (await view())[0];
    await wheel(0, -4, true);
    await expect.poll(async () => (await view())[0], { timeout: 5000 }).not.toBeCloseTo(z, 4);
  });

  test('a throwing aggregator ends with "Could not compute a fix, left for you"', async ({ page }) => {
    await stubModel(page, "export const nextFix = () => { if (/at next \\(/.test(new Error().stack)) throw new Error('boom'); return null; };\n"
      + "export const manualLeft = () => [{ ids: [], message: 'Something for you' }];");
    await buildPlan(page, '02-hjlc-f2.webp');
    await fixAll(page);
    await expect(card(page)).toContainText('Could not compute a fix, left for you');
  });

  test('a clean plan says so', async ({ page }) => {
    await stubModel(page, 'export const nextFix = () => null;\nexport const manualLeft = () => [];');
    await page.route('**/js/model/tidyRooms.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const tidyRooms = (d) => ({ doc: d, changed: [], count: 0, notes: [] });' }));
    await buildPlan(page, '02-hjlc-f2.webp');
    await fixAll(page);
    await expect(page.locator('.toast').filter({ hasText: 'Nothing to fix' })).toBeVisible();
  });

  test('Layers: popover closes, Fix overlaps still works exactly as before', async ({ page }) => {
    await openLayers(page);
    await expect(page.locator('#view-popover')).toBeHidden();
    const lc = page.locator('#layers-panel .ly-fixcard');
    const depth0 = await undoDepth(page);
    await page.getByRole('button', { name: 'Fix overlaps' }).click();
    await expect(lc).toContainText('Fix overlaps: group 1');
    await lc.getByRole('button', { name: 'Yes, apply' }).click();
    expect(await undoDepth(page)).toBe(depth0 + 1);
    for (let i = 0; i < 60 && !/done/i.test(await lc.locator('h4').first().innerText()); i++) await lc.getByRole('button', { name: 'Yes, apply' }).click();
    await expect(lc).toContainText('Fix overlaps: done');
  });

  test('narrowest supported viewport (768px): the guide card fits the sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 700 });
    await openFirstGuide(page);
    await expect(guide(page)).toBeVisible();
    expect(await guide(page).evaluate((g) => g.scrollWidth - g.clientWidth)).toBeLessThanOrEqual(1);
  });
});
