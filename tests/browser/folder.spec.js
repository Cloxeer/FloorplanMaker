// folder.spec.js — Playwright test for js/store/folderStore.js using an OPFS
// directory handle (createWritable-capable in Chromium) in place of a real
// local folder.
import { test, expect } from '@playwright/test';

test('folderStore writes, lists, reads, and deletes projects atomically', async ({ page }) => {
  await page.goto('http://localhost:8080/');

  const result = await page.evaluate(async () => {
    const mod = await import('/js/store/folderStore.js');
    const handle = await navigator.storage.getDirectory();

    const project = {
      id: 't',
      slug: 'test-1',
      name: 'T',
      doc: {
        version: 1,
        meta: { building: 'T', property: '1', floor: 1, slug: 'test-1' },
        viewBox: { x: 0, y: 0, w: 10, h: 10 },
        floor: null,
        items: [],
        sections: [],
      },
      photo: null,
      view: {},
      history: { past: [], future: [] },
      savedAt: 1,
    };

    await mod.writeProject(handle, project);

    const listed = await mod.listProjects(handle);
    const found = listed.find((p) => p.slug === 'test-1');

    const read = await mod.readProject(handle, 'test-1');

    let tmpExists = true;
    try {
      await handle.getFileHandle('test-1.floorplan.json.tmp');
    } catch {
      tmpExists = false;
    }

    let subHas = false;
    try { await (await handle.getDirectoryHandle('T')).getFileHandle('test-1.floorplan.json'); subHas = true; } catch { /* top level */ }

    await mod.deleteProject(handle, 'test-1');

    let finalExistsAfterDelete = true;
    try {
      await handle.getFileHandle('test-1.floorplan.json');
    } catch {
      finalExistsAfterDelete = false;
    }

    return { found, readSlug: read.slug, tmpExists, finalExistsAfterDelete, subHas };
  });

  expect(result.found).toBeTruthy();
  expect(result.found.slug).toBe('test-1');
  expect(result.readSlug).toBe('test-1');
  expect(result.subHas).toBe(true); // lives in the building's subfolder
  expect(result.tmpExists).toBe(false);
  expect(result.finalExistsAfterDelete).toBe(false);
});

test('Start blueprint with a chosen folder writes the floor into the building subfolder', async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => navigator.storage.getDirectory();
  });
  await page.goto('http://localhost:8080/');

  // Create building -> building page -> Start blueprint (this is where the folder is asked for)
  await page.click('#btn-start-blueprint');
  await page.fill('#cb-name', 'Test Hall');
  await page.fill('#cb-prop', '99');
  await page.click('#cb-ok');
  await page.click('#bd-start');
  await page.click('#folder-modal-choose');

  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');

  await page.click('#ps-skip-initial');

  await page.waitForSelector('#stage', { state: 'visible' });
  await page.click('#btn-overlay-draw');
  const stage = page.locator('#stage');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx - 100, cy - 100);
  await page.mouse.click(cx + 100, cy - 100);
  await page.mouse.click(cx + 100, cy + 100);
  await page.mouse.dblclick(cx - 100, cy + 100);

  await page.waitForTimeout(500);

  const found = await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    const top = [];
    let inBuilding = [];
    let hasBuildingJson = false;
    for await (const [name, h] of dir.entries()) {
      top.push(name);
      if (h.kind === 'directory' && name === 'Test Hall') {
        for await (const [n] of h.entries()) { inBuilding.push(n); if (n === 'building.json') hasBuildingJson = true; }
      }
    }
    return { top, inBuilding, hasBuildingJson };
  });
  // the floor file lives inside the building's folder (no building.json: the building was created before a
  // folder was connected, so it is only in the browser registry; its floor on disk still makes it appear)
  expect(found.inBuilding.some((n) => n.endsWith('.floorplan.json') && n.startsWith('th-1'))).toBe(true);
  // ... and not loose at the top level
  expect(found.top.some((n) => n.endsWith('.floorplan.json'))).toBe(false);

  // the building page lists the floor from disk
  await page.click('#btn-close');
  await expect(page.locator('#bd-floors .project-card')).toHaveCount(1);
  await expect(page.locator('#bd-floors .project-card .chip')).toHaveText('on disk');
});
