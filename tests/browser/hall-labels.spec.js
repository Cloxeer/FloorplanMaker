// tests/browser/hall-labels.spec.js
// On a real AutoBuild result (the HJLC floor 1 poster): the exported plan has a handful of "Hallway" words,
// not one per hallway piece, none of them on an EXIT / door label or inside a room.

import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const PHOTO = readFileSync(new URL('../../samples/hjlc-1-posted.jpg', import.meta.url));

test('AutoBuild plan: few Hallway labels, clear of exits and rooms', async ({ page }) => {
  test.setTimeout(420000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  await page.goto('/#/new');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Label Test'); await page.fill('#bp-property', '1'); await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await page.setInputFiles('#ps-file', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: PHOTO });
  const ab = page.locator('#ps-autobuild');
  await expect.poll(async () => (await ab.isVisible()) || (await page.locator('#ps-straighten').isVisible()), { timeout: 15000 }).toBe(true);
  if (!(await ab.isVisible())) await page.click('#ps-straighten');
  await expect(ab).toBeVisible({ timeout: 30000 });
  await ab.click();
  await expect(page.locator('.ab-confirm .ab-ok')).toBeVisible({ timeout: 180000 });
  await page.click('.ab-confirm .ab-ok');
  await expect(page.locator('.ab-card')).toBeHidden({ timeout: 300000 });

  const r = await page.evaluate(async () => {
    const { exportSvg } = await import('/js/model/svgExport.js');
    const { hallLabels } = await import('/js/model/hallLabels.js');
    const { roomPolygon } = await import('/js/model/document.js');
    const { pointInPolygon } = await import('/js/model/geometry.js');
    const doc = window.__app.doc;
    const svg = exportSvg(doc);
    const labels = hallLabels(doc.items);
    const halls = doc.items.filter((i) => i.type === 'hall').length;
    const box = (l) => (l.vertical ? { x0: l.x - 12, x1: l.x + 12, y0: l.y - 42, y1: l.y + 42 } : { x0: l.x - 42, x1: l.x + 42, y0: l.y - 12, y1: l.y + 12 });
    const onDoor = labels.filter((l) => doc.items.some((d) => d.type === 'door' && d.label && Math.abs(d.label.x - l.x) < 54 && Math.abs(d.label.y - l.y) < 24)).length;
    const inRoom = labels.filter((l) => { const b = box(l); return doc.items.some((it) => it.type === 'room' && [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1], [l.x, l.y]].some((p) => pointInPolygon(p, roomPolygon(it)))); }).length;
    return { svg, labels: labels.length, vertical: labels.filter((l) => l.vertical).length, halls, onDoor, inRoom, inSvg: (svg.match(/class="hall-lbl"/g) || []).length };
  });
  writeFileSync(process.env.HALL_SVG_OUT || 'test-results/hall-labels.svg', r.svg);
  expect(r.halls).toBeGreaterThan(3);
  expect(r.labels).toBeGreaterThan(0);
  expect(r.labels).toBeLessThanOrEqual(Math.max(3, Math.ceil(r.halls / 2)));
  expect(r.inSvg).toBe(r.labels);
  expect(r.onDoor).toBe(0);
  expect(r.inRoom).toBe(0);
  expect(errors).toEqual([]);
  console.log(`hall pieces ${r.halls} -> labels ${r.labels} (${r.vertical} vertical)`);
});
