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

    await mod.deleteProject(handle, 'test-1');

    let finalExistsAfterDelete = true;
    try {
      await handle.getFileHandle('test-1.floorplan.json');
    } catch {
      finalExistsAfterDelete = false;
    }

    return { found, readSlug: read.slug, tmpExists, finalExistsAfterDelete };
  });

  expect(result.found).toBeTruthy();
  expect(result.found.slug).toBe('test-1');
  expect(result.readSlug).toBe('test-1');
  expect(result.tmpExists).toBe(false);
  expect(result.finalExistsAfterDelete).toBe(false);
});

test('Start blueprint with a chosen folder writes a .floorplan.json into it', async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => navigator.storage.getDirectory();
  });
  await page.goto('http://localhost:8080/');

  await page.click('#btn-start-blueprint');
  await page.click('#folder-modal-choose');

  await page.fill('#bp-building', 'Test Hall');
  await page.fill('#bp-property', '99');
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

  const exists = await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    for await (const [name] of dir.entries()) {
      if (name.endsWith('.floorplan.json') && name.startsWith('th-1')) return true;
    }
    return false;
  });
  expect(exists).toBe(true);
});
