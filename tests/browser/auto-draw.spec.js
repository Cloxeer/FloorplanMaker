// tests/browser/auto-draw.spec.js
// Auto draw on the real Chemistry floor 1 photos (the four photos of tools/pieces/cb-1.floorplan.json, no rooms, no outline):
// the card offers Auto draw, one click reads every photo and draws the buildings: rooms, halls, one outline per building,
// the biggest as the plan's outline; one undo step takes it all back.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, openTrace, cleanup } from './building.helpers.js';

test('Auto draw reads the four Chemistry photos and draws the main building and the W building', async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  const proj = JSON.parse(readFileSync(new URL('../../tools/pieces/cb-1.floorplan.json', import.meta.url), 'utf8'));
  await openApp(page);
  const id = await page.evaluate(async (pr) => {
    const { saveNow } = await import('/js/store/autosave.js');
    const { createDoc } = await import('/js/model/document.js');
    const doc = createDoc({ building: 'Chem Auto', property: '187', floor: '1', slug: 'cb-auto-1' }, { x: 0, y: 0, w: pr.photo.width + 40, h: pr.photo.height + 40 });
    const p = { id: crypto.randomUUID(), slug: 'cb-auto-1', name: 'Chem Auto', createdAt: Date.now(), savedAt: 0, doc, photo: pr.photo, extraPhotos: pr.extraPhotos, view: { zoom: 1, panX: 0, panY: 0, onion: 0.5 }, history: { past: [], future: [] } };
    await saveNow(p);
    return p.id;
  }, proj);
  try {
    await openTrace(page, 'cb-auto-1');
    // the card: Auto draw sits right next to Draw outline; step 1 offers it too (several photos)
    await expect(page.locator('#btn-overlay-autodraw')).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('btn-overlay-draw').nextElementSibling.id)).toBe('btn-overlay-autodraw');
    await expect(page.locator('#btn-auto-draw')).toBeVisible();

    await page.click('#btn-overlay-autodraw');
    await page.waitForFunction(() => window.__app.doc.floor && window.__app.doc.items.some((i) => i.type === 'outline'), null, { timeout: 280000 });
    const r = await page.evaluate(() => {
      const d = window.__app.doc, rooms = d.items.filter((i) => i.type === 'room' && i.cls !== 'void');
      return {
        rooms: rooms.length, halls: d.items.filter((i) => i.type === 'hall').length, doors: d.items.filter((i) => i.type === 'door').length,
        outlines: d.items.filter((i) => i.type === 'outline').map((o) => o.name), floorPts: d.floor.points.length,
        pieces: [...new Set(d.items.map((i) => i.piece))].sort(), past: window.__app.project.history.past.length,
        w: rooms.filter((i) => /^W\d/.test(i.number || '')).map((i) => i.piece),
      };
    });
    expect(r.rooms).toBeGreaterThan(60);
    expect(r.halls).toBeGreaterThan(5);
    expect(r.doors).toBe(0); // doors are never placed on their own
    expect(r.floorPts).toBeGreaterThanOrEqual(4);
    expect(r.outlines).toEqual(['W building']); // the main building's is the plan outline, the W building's an outline of its own
    expect(r.pieces).toEqual(['Main building', 'W building']);
    expect(new Set(r.w)).toEqual(new Set(['W building'])); // every W room is in the W building
    expect(r.past).toBe(1); // one undo step
    await expect(page.locator('#start-overlay')).toBeHidden();
    await expect(page.locator('.outline-row')).toHaveCount(1);
    await expect(page.locator('.outline-name')).toHaveText('W building');

    await page.click('#btn-undo');
    expect(await page.evaluate(() => [window.__app.doc.floor, window.__app.doc.items.length])).toEqual([null, 0]);
    expect(errors).toEqual([]);
  } finally {
    await openApp(page);
    await cleanup(page, [id]);
  }
});
