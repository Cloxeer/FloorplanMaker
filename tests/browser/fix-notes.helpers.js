// tests/browser/fix-notes.helpers.js
// Shared helpers for the fix-notes browser specs: build a plan with AutoBuild from a fixture photo.

import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

export const fixture = (name) => readFileSync(new URL(`../fixtures/autobuild/${name}`, import.meta.url));

export function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  return errors;
}

export async function buildPlan(page, name = '06-jett-b-a.webp') {
  await page.goto('/');
  await page.goto('/#/new');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Fix Notes Test');
  await page.fill('#bp-property', '1');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await page.setInputFiles('#ps-file', { name: 'p.webp', mimeType: 'image/webp', buffer: fixture(name) });
  await expect(page.locator('#ps-straighten')).toBeVisible({ timeout: 10000 });
  await page.click('#ps-straighten');
  await page.click('#ps-autobuild');
  await page.locator('.ab-ok').click({ timeout: 60000 }); // the outline check waits for "Looks right, continue"
  await page.waitForFunction(() => window.__app && window.__app.doc && window.__app.doc.items.length > 3 && !document.querySelector('.ab-card'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  // AutoBuild keeps getting better, so what it leaves to fix varies: these specs test the fixing, so make sure there is something
  // to fix (two neighbouring rooms pushed into each other) instead of depending on AutoBuild's mistakes.
  await page.evaluate(async () => {
    const { updateItem } = await import('/js/model/document.js');
    let d = window.__app.doc;
    const rects = d.items.filter((i) => i.type === 'room' && i.shape !== 'poly' && Number.isFinite(i.x) && Number.isFinite(i.w));
    for (const a of rects) {
      const b = rects.find((o) => o !== a && Math.abs(a.x + a.w - o.x) <= 6 && Math.min(a.y + a.h, o.y + o.h) - Math.max(a.y, o.y) > 40);
      if (b) { d = updateItem(d, a.id, { w: a.w + 25 }); break; }
    }
    window.__app.replaceDoc(d);
  });
  await page.waitForTimeout(500);
}

export async function openLayers(page) {
  await page.click('#btn-view');
  await page.click('#btn-layers');
  await expect(page.locator('#layers-panel')).toBeVisible();
}

export const notesCount = (page) => page.locator('.notes-list li').count();
export const docState = (page) => page.evaluate(() => JSON.stringify(window.__app.doc));
export const undoDepth = (page) => page.evaluate(() => window.__app.project.history.past.length);
