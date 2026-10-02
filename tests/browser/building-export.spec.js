// tests/browser/building-export.spec.js
// Building preview / export: "This floor | All floors (N)" on the Preview, "What to export" on the Export
// step, a zip with one SVG per floor inside a folder named after the building, and a floor with errors
// blocking the all-floors export.

import { test, expect } from '@playwright/test';
import { openApp, seedProject, openTrace, cleanup, zipEntries } from './building.helpers.js';

const B = 'Export Test Hall';
let ids = [];

test.beforeEach(async ({ page }) => {
  ids = [];
  // record downloads instead of saving them: anchor.download name + the blob bytes behind its object URL
  await page.addInitScript(() => {
    const blobs = new Map();
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { const u = orig(b); blobs.set(u, b); return u; };
    window.__downloads = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        const blob = blobs.get(this.href);
        window.__downloads.push({ name: this.download, blob });
        return;
      }
      return click.call(this);
    };
  });
  await openApp(page);
});
test.afterEach(async ({ page }) => { await cleanup(page, ids); });

async function seedTwo(page, floor2 = {}) {
  const a = await seedProject(page, { building: B, floor: 1, slug: 'et-1', outline: true, room: true, ready: true });
  const b = await seedProject(page, { building: B, floor: 2, slug: 'et-2', outline: true, room: true, ready: true, ...floor2 });
  ids.push(a.id, b.id);
  await openTrace(page, 'et-1');
}
async function openPreview(page) {
  await page.click('#btn-export');
  await expect(page.locator('#preview')).toBeVisible();
}
async function lastDownload(page) {
  await page.waitForFunction(() => window.__downloads.length > 0);
  const r = await page.evaluate(async () => {
    const d = window.__downloads[window.__downloads.length - 1];
    const bytes = new Uint8Array(await d.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { name: d.name, type: d.blob.type, b64: btoa(s), count: window.__downloads.length };
  });
  return { ...r, buf: Buffer.from(r.b64, 'base64') };
}

test('Preview: This floor | All floors (2) shows one card per floor', async ({ page }) => {
  await seedTwo(page);
  await openPreview(page);
  const seg = page.locator('#preview .pv-scope');
  await expect(seg.getByRole('button', { name: 'This floor' })).toBeVisible();
  await expect(seg.getByRole('button', { name: 'All floors (2)' })).toBeVisible();
  // the control sits next to the title
  expect(await page.locator('#preview .pv-title-row').evaluate((r) => [...r.children].map((c) => c.tagName + (c.classList.contains('pv-scope') ? '.pv-scope' : '')))).toEqual(['H2', 'DIV.pv-scope']);
  await expect(page.locator('#preview .pv-card')).toHaveCount(0);
  await expect(page.locator('#preview-svg-wrap')).toBeVisible();

  await seg.getByRole('button', { name: 'All floors (2)' }).click();
  const cards = page.locator('#preview .pv-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('h4')).toContainText('Floor 1');
  await expect(cards.nth(1).locator('h4')).toContainText('Floor 2');
  await expect(cards.nth(0).locator('svg')).toHaveCount(1);
  await expect(cards.nth(1).locator('svg')).toHaveCount(1);
  await expect(page.locator('#preview-svg-wrap')).toBeHidden();

  await seg.getByRole('button', { name: 'This floor' }).click();
  await expect(page.locator('#preview-svg-wrap')).toBeVisible();
  await expect(page.locator('#preview .pv-all')).toBeHidden();
});

test('a single-floor building gets no scope controls', async ({ page }) => {
  const a = await seedProject(page, { building: 'Lonely Hall', floor: 1, slug: 'et-lone', outline: true, room: true, ready: true });
  ids.push(a.id);
  await openTrace(page, 'et-lone');
  await openPreview(page);
  await page.waitForTimeout(400);
  await expect(page.locator('#preview .pv-scope')).toHaveCount(0);
});

test('Export: all floors + Download gives <Building>.zip with <Building>/<slug>.svg per floor', async ({ page }) => {
  await seedTwo(page);
  await openPreview(page);
  await page.getByRole('button', { name: 'All floors (2)' }).click();
  await page.click('#preview-export');
  await expect(page.locator('#export-step')).toBeVisible();
  const scope = page.locator('#export-scope');
  await expect(scope).toBeVisible();
  await expect(scope).toHaveValue('all'); // the Preview choice carries over

  // default (this floor) downloads a single svg, not a zip
  await scope.selectOption('this');
  await page.click('#export-download');
  const single = await lastDownload(page);
  expect(single.name).not.toMatch(/\.zip$/);

  await scope.selectOption('all');
  await page.click('#export-download');
  await expect(page.locator('#export-status')).toContainText(`${B}.zip`);
  const d = await lastDownload(page);
  expect(d.name).toBe(`${B}.zip`);
  expect(d.type).toBe('application/zip');
  const entries = zipEntries(d.buf);
  expect(entries.map((e) => e.name).sort()).toEqual([`${B}/et-1.svg`, `${B}/et-2.svg`]);
  for (const e of entries) {
    expect(e.size).toBeGreaterThan(100);
    expect(e.data.toString('utf8')).toContain('<svg');
  }
});

test('a floor with errors blocks the all-floors export and is named', async ({ page }) => {
  await seedTwo(page, { badRoom: true }); // floor 2 has a malformed room number
  await openPreview(page);
  await page.getByRole('button', { name: 'All floors (2)' }).click();
  await expect(page.locator('#preview .pv-card').nth(1).locator('.pv-bad')).toContainText('to fix');
  await page.click('#preview-export');
  await page.locator('#export-scope').selectOption('all');
  const before = await page.evaluate(() => window.__downloads.length);
  await page.click('#export-download');
  const status = page.locator('#export-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Floor 2');
  await expect(status).toContainText('before exporting all floors');
  await expect(status).not.toContainText('Floor 1');
  expect(await page.evaluate(() => window.__downloads.length)).toBe(before);
});
