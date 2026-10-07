// tests/browser/autobuild-multi.spec.js
// One floor posted as several photos: pick them all, flatten each, AutoBuild on the merge board builds every photo ON ITS OWN
// and leaves each plan over its own photo as a separate piece (items tagged piece: "Photo N"). Nothing is joined, turned or
// guessed: combining the pieces is the person's job.
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

test('two posters of one floor are built separately: one piece per photo, nothing joined', async ({ page }) => {
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
  await page.waitForFunction(() => window.__app.doc.items.length > 10 && !document.querySelector('.ab-card'), null, { timeout: 200000 });
  const r = await page.evaluate(() => {
    const d = window.__app.doc, p = window.__app.project;
    const nums = d.items.filter((i) => i.type === 'room' && i.number).map((i) => i.number);
    const m = window.__app._lastMulti;
    const pieces = {};
    for (const it of d.items) if (it.piece) pieces[it.piece] = (pieces[it.piece] || 0) + (it.type === 'room' ? 1 : 0);
    return { rooms: nums.length, extra: (p.extraPhotos || []).length, hasT: !!(p.extraPhotos[0] && p.extraPhotos[0].t), pieces, untagged: d.items.filter((i) => !i.piece).length, outline: !!d.floor };
  });
  expect(r.extra).toBe(1);
  expect(r.hasT).toBe(true);
  expect(Object.keys(r.pieces).sort()).toEqual(['Photo 1', 'Photo 2']);
  expect(r.pieces['Photo 1']).toBeGreaterThan(10);
  expect(r.pieces['Photo 2']).toBeGreaterThan(10);
  expect(r.untagged).toBe(0);
  expect(r.rooms).toBeGreaterThan(20); // every room of both photos is kept: a room on both posters is there twice, for the person to combine
  expect(r.outline).toBe(false); // no outline is guessed over the pieces: Auto-outline after they are lined up
});
