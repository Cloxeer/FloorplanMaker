// tests/browser/flatten-flow.spec.js
// Photo step flow: Back buttons, Flatten stays on the photo step (Flattened
// screen with Tilt/Turn sliders), then Start tracing or AutoBuild.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const PHOTO = readFileSync(new URL('../fixtures/autobuild/06-jett-b-a.webp', import.meta.url));
const PHOTO2 = readFileSync(new URL('../fixtures/autobuild/01-hjlc-f1.webp', import.meta.url));

function watch(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  return errors;
}

async function newProject(page) {
  await page.goto('/#/new'); // the legacy blank 4-field dialog (the building flow has its own spec)
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Flatten Flow');
  await page.fill('#bp-property', '1');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
}
async function upload(page, buffer = PHOTO) {
  await page.setInputFiles('#ps-file', { name: 'p.webp', mimeType: 'image/webp', buffer });
  await expect(page.locator('#ps-straighten')).toBeVisible({ timeout: 10000 });
}
const setSlider = (page, id, v) => page.evaluate(([i, val]) => {
  const el = document.getElementById(i);
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, v]);
const canvasSig = (page) => page.evaluate(() => document.getElementById('fs-canvas').toDataURL());
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('back buttons, Flatten stays on the photo step, sliders, Start tracing', async ({ page }) => {
  const errors = watch(page);
  await newProject(page);

  // drop zone
  await expect(page.locator('#ps-back-projects')).toBeVisible();
  await expect(page.locator('#ps-drop .ps-tip')).toContainText('The better the photo');

  // corner screen: choose a different photo
  await upload(page);
  await expect(page.locator('#ps-back-corners')).toHaveText(/Choose a different photo/);
  await expect(page.locator('#ps-autobuild')).toHaveCount(0);
  await page.click('#ps-back-corners');
  await expect(page.locator('#ps-drop')).toBeVisible();
  await upload(page, PHOTO2);

  // Flatten -> Flattened screen, not the studio
  await page.click('#ps-straighten');
  await expect(page.locator('#fs-canvas')).toBeVisible();
  await expect(page.locator('#studio')).toBeHidden();
  await expect(page.locator('#photo-step')).toBeVisible();
  await expect(page.locator('#ps-start-tracing')).toBeVisible();
  await expect(page.locator('#ps-autobuild')).toBeVisible();
  await expect(page.locator('.photo-step-header h2')).toHaveText('Flattened');
  await expect(page.locator('#fs-tilt')).toBeVisible();
  await expect(page.locator('#fs-turn')).toBeVisible();

  // sliders change the preview; reset restores it
  const flatSig = await canvasSig(page);
  await setSlider(page, 'fs-tilt', 15);
  await frame(page);
  const tilted = await canvasSig(page);
  expect(tilted).not.toBe(flatSig);
  await expect(page.locator('#fs-tilt-out')).toHaveText('15.0°');
  await setSlider(page, 'fs-turn', -12);
  await frame(page);
  expect(await canvasSig(page)).not.toBe(tilted);
  await page.click('#fs-turn-reset');
  await page.click('#fs-tilt-reset');
  await frame(page);
  expect(await canvasSig(page)).toBe(flatSig);
  await page.click('#fs-grid');
  await expect(page.locator('.fs-imgwrap.fs-grid-on')).toHaveCount(1);

  // values survive Back and return
  await setSlider(page, 'fs-tilt', 7);
  await page.click('#ps-back-flat');
  await expect(page.locator('#ps-editor')).toBeVisible();
  await page.click('#ps-straighten');
  await expect(page.locator('#fs-tilt')).toHaveValue('7');
  await expect(page.locator('.fs-imgwrap.fs-grid-on')).toHaveCount(1);

  // Esc = Back
  await page.keyboard.press('Escape');
  await expect(page.locator('#ps-editor')).toBeVisible();
  await page.click('#ps-straighten');

  await page.click('#ps-start-tracing');
  await expect(page.locator('#studio')).toBeVisible();
  const photoOk = await page.evaluate(() => {
    const p = window.__app.project.photo;
    return !!p && p.dataUrl.startsWith('data:image/') && p.width > 10 && p.height > 10 && !!p.originalDataUrl && p.corners.length === 4;
  });
  expect(photoOk).toBe(true);
  expect(errors).toEqual([]);
});

test('Back from the drop zone returns to the building page', async ({ page }) => {
  const errors = watch(page);
  await newProject(page);
  await page.click('#ps-back-projects');
  await expect(page.locator('#photo-step')).toBeHidden();
  await expect(page.locator('#building')).toBeVisible(); // the building page, not the start screen
  await expect(page.locator('#bd-name')).toHaveText('Flatten Flow');
  await expect(page.locator('#bd-start')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Flatten -> AutoBuild builds the plan in the studio', async ({ page }) => {
  test.setTimeout(120000);
  const errors = watch(page);
  await newProject(page);
  await upload(page);
  await page.click('#ps-straighten');
  await page.click('#ps-autobuild');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await page.locator('.ab-ok').click({ timeout: 60000 }); // the outline check waits for "Looks right, continue"
  await page.waitForFunction(() => window.__app && window.__app.doc && window.__app.doc.items.length > 3 && !document.querySelector('.ab-card'), null, { timeout: 90000 });
  expect(errors).toEqual([]);
});
