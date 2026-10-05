// tests/browser/photos-merge.spec.js
// The several-photo flow: pick/drop 2+ photos -> each one gets the corners + Flatten screens ("Photo 1 of 2") ->
// all of them side by side on the merge board where they are lined up -> Start tracing (separate layers) or
// AutoBuild (joined into one picture). Back walks back; nothing is "just plopped" into the studio.

import { test, expect } from '@playwright/test';
import { A, B, C } from './png.helpers.js';

let errors = [];
let ids = [];
test.beforeEach(({ page }) => {
  errors = []; ids = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
});
test.afterEach(async ({ page }) => {
  await page.evaluate(async (list) => {
    const { deleteProject, listProjects } = await import('/js/store/autosave.js');
    for (const p of await listProjects()) if (list.includes(p.id) || p.building === 'Photos Merge') await deleteProject(p.id);
  }, ids).catch(() => {});
  expect(errors).toEqual([]);
});

async function startProject(page) {
  await page.goto('/#/new');
  await page.waitForFunction(() => !!window.__app);
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Photos Merge');
  await page.fill('#bp-property', '1');
  await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await expect(page.locator('#ps-multi-initial')).toBeVisible();
  ids.push(await page.evaluate(() => window.__app.project && window.__app.project.id));
}
const header = (page) => page.locator('.photo-step-header h2');
async function toMerge(page, files) {
  await startProject(page);
  await page.setInputFiles('#ps-multi-file', files);
  for (let i = 0; i < files.length; i++) {
    await expect(header(page)).toHaveText(`Photo ${i + 1} of ${files.length}: flatten it`);
    await page.click('#ps-straighten');
    await expect(header(page)).toHaveText(`Photo ${i + 1} of ${files.length}: check it`);
    await page.click('#ps-next-photo');
  }
  await expect(page.locator('#ms-svg')).toBeVisible();
  await expect(header(page)).toHaveText('Put the photos together');
}
// the placements on the board, read back from the SVG
const board = (page) => page.evaluate(async () => {
  const { photoCorners, tOf } = await import('/js/model/photos.js');
  const svg = document.getElementById('ms-svg');
  return [...svg.querySelectorAll('image')].map((im) => {
    const tr = im.parentNode.getAttribute('transform');
    const [, x, y, a, s] = tr.match(/translate\(([-\d.e]+) ([-\d.e]+)\) rotate\(([-\d.e]+)\) scale\(([-\d.e]+)\)/).map(Number);
    const p = { width: +im.getAttribute('width'), height: +im.getAttribute('height'), t: { x, y, a, s } };
    const c = photoCorners(p), xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
    return { t: tOf(p), w: p.width, h: p.height, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
});
const toClient = (page, [x, y]) => page.evaluate(([px, py]) => {
  const svg = document.getElementById('ms-svg');
  const pt = new DOMPoint(px, py).matrixTransform(svg.getScreenCTM());
  return { x: pt.x, y: pt.y };
}, [x, y]);
async function dragBoard(page, from, to) {
  const a = await toClient(page, from), b = await toClient(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}
const centre = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

test('two photos: each is flattened first, then both sit side by side on the board (not in the studio yet)', async ({ page }) => {
  await toMerge(page, [A(), B()]);
  await expect(page.locator('#studio')).toBeHidden();
  const [p1, p2] = await board(page);
  expect(p2.x0).toBeGreaterThanOrEqual(p1.x1); // beside, not on top
  expect(Math.abs(p1.y0 - p2.y0)).toBeLessThan(1); // lined up along the top
  expect(Math.abs((p1.y1 - p1.y0) - (p2.y1 - p2.y0))).toBeLessThan(1); // same height
  await expect(page.locator('#ms-chips button')).toHaveCount(2);
});

test('move, size and turn a photo on the board; See through; Side by side puts them back', async ({ page }) => {
  await toMerge(page, [A(), B()]);
  const [p1, p2] = await board(page);
  await dragBoard(page, centre(p2), [centre(p2)[0] - 150, centre(p2)[1] + 80]);
  const [, q2] = await board(page);
  expect(q2.x0).toBeLessThan(p2.x0 - 100);
  expect(q2.y0).toBeGreaterThan(p2.y0 + 40);
  await page.locator('#ms-size').fill('120');
  expect((await board(page))[1].t.s).toBeCloseTo(1.2, 2);
  await page.locator('#ms-turn').fill('10');
  expect((await board(page))[1].t.a).toBeCloseTo(10, 1);
  await page.click('#ms-turn-r');
  expect((await board(page))[1].t.a).toBeCloseTo(100, 1);
  await expect(page.locator('#ms-turn-out')).toHaveText('100.0°');
  expect((await board(page))[0].t).toEqual(p1.t); // photo 1 never moved by any of that
  await page.click('#ms-see');
  expect(await page.locator('#ms-svg image').first().getAttribute('opacity')).toBe('0.55');
  await page.click('#ms-see');
  expect(await page.locator('#ms-svg image').first().getAttribute('opacity')).toBe('1');
  await page.click('#ms-reset');
  const [r1, r2] = await board(page);
  expect(r2.x0).toBeGreaterThanOrEqual(r1.x1);
  expect(r2.t.a).toBe(0);
  const before = (await board(page))[1].t.x;
  await page.keyboard.press('ArrowRight');
  expect((await board(page))[1].t.x).toBeGreaterThan(before);
});

test('Start tracing keeps separate photo layers, the first photo as the frame; the studio opens normally', async ({ page }) => {
  await toMerge(page, [A(), B()]);
  const [, p2] = await board(page);
  await dragBoard(page, centre(p2), [centre(p2)[0] - 40, centre(p2)[1] + 100]);
  const [m1, m2] = await board(page);
  await page.click('#ms-trace');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.pl-pill')).toHaveCount(0); // normal trace mode, not the arrange mode
  const proj = await page.evaluate(() => {
    const p = window.__app.project;
    return { main: p.photo.t || null, extra: p.extraPhotos.map((e) => ({ t: e.t, w: e.width, h: e.height })), w: p.photo.width, h: p.photo.height, vb: window.__app.doc.viewBox };
  });
  expect(proj.main).toBeNull();
  expect(proj.extra.length).toBe(1);
  expect(proj.extra[0].t.x).toBeCloseTo(m2.t.x - m1.t.x, 0); // placement relative to the first photo is what was on the board
  expect(proj.extra[0].t.y).toBeCloseTo(m2.t.y - m1.t.y, 0);
  expect(proj.vb).toMatchObject({ w: proj.w, h: proj.h });
});

test('photo 1 is the frame: it can be moved but not turned or sized; the arrangement is still kept relative to it the same arrangement relative to it', async ({ page }) => {
  await toMerge(page, [A(), B()]);
  await page.locator('#ms-chips button').first().click();
  const [p1] = await board(page);
  await dragBoard(page, centre(p1), [centre(p1)[0] + 90, centre(p1)[1] + 30]);
  await expect(page.locator('#ms-turn')).toBeDisabled(); // photo 1 is the frame: no turn / size for it
  await expect(page.locator('#ms-size')).toBeDisabled();
  const [m1, m2] = await board(page);
  await page.click('#ms-trace');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  const out = await page.evaluate(async () => {
    const { photoCorners } = await import('/js/model/photos.js');
    const p = window.__app.project;
    return { c1: photoCorners(p.photo), c2: photoCorners(p.extraPhotos[0]), w: p.extraPhotos[0].width, h: p.extraPhotos[0].height };
  });
  // the extra's corners in the first photo's own frame == the board's corners mapped into that frame by hand
  const rad = (d) => (d * Math.PI) / 180;
  const a = -rad(m1.t.a), cs = Math.cos(a), sn = Math.sin(a);
  const inFrame = ([x, y]) => { const dx = x - m1.t.x, dy = y - m1.t.y; return [(dx * cs - dy * sn) / m1.t.s, (dx * sn + dy * cs) / m1.t.s]; };
  const ux = Math.cos(rad(m2.t.a)) * m2.t.s, uy = Math.sin(rad(m2.t.a)) * m2.t.s;
  const want = [[m2.t.x, m2.t.y], [m2.t.x + ux * out.w, m2.t.y + uy * out.w], [m2.t.x + ux * out.w - uy * out.h, m2.t.y + uy * out.w + ux * out.h], [m2.t.x - uy * out.h, m2.t.y + ux * out.h]].map(inFrame);
  out.c2.forEach((c, i) => { expect(c[0]).toBeCloseTo(want[i][0], 0); expect(c[1]).toBeCloseTo(want[i][1], 0); });
  expect(out.c1[0]).toEqual([0, 0]);
});

test('Back walks back: board -> last photo -> first photo -> the drop screen; the corners are remembered', async ({ page }) => {
  await toMerge(page, [A(), B()]);
  await page.click('#ms-back');
  await expect(header(page)).toHaveText('Photo 2 of 2: flatten it');
  await page.click('#ps-back-corners');
  await expect(header(page)).toHaveText('Photo 1 of 2: flatten it');
  const h0 = page.locator('#ps-overlay circle').first();
  const box = await h0.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 50, { steps: 5 }); await page.mouse.up();
  const cx = await h0.getAttribute('cx');
  await page.click('#ps-straighten'); await page.click('#ps-next-photo');
  await expect(header(page)).toHaveText('Photo 2 of 2: flatten it');
  await page.click('#ps-back-corners');
  await expect(header(page)).toHaveText('Photo 1 of 2: flatten it');
  expect(await page.locator('#ps-overlay circle').first().getAttribute('cx')).toBe(cx);
  await page.click('#ps-back-corners'); // the first photo's Back leaves the flow
  await expect(page.locator('#ps-multi-initial')).toBeVisible();
  await expect(page.locator('#studio')).toBeHidden();
});

test('three photos go through three flatten screens; Skip and Add-multiple are not offered mid-flow', async ({ page }) => {
  await toMerge(page, [A(), B(), C()]);
  await expect(page.locator('#ms-chips button')).toHaveCount(3);
  await page.click('#ms-back');
  await expect(page.locator('#ps-skip')).toBeHidden();
  await expect(page.locator('#ps-multi')).toBeHidden();
});

test('"Add multiple photos" from an open photo keeps that photo first, with the corners already placed', async ({ page }) => {
  await startProject(page);
  await page.setInputFiles('#ps-file', A());
  await expect(page.locator('#ps-straighten')).toBeVisible({ timeout: 15000 });
  const h = page.locator('#ps-overlay circle').first();
  const box = await h.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + 40, box.y + 30, { steps: 5 }); await page.mouse.up();
  const cx = await h.getAttribute('cx');
  const chooser = page.waitForEvent('filechooser');
  await page.click('#ps-multi'); // the button next to Flatten
  await (await chooser).setFiles([B()]);
  await expect(header(page)).toHaveText('Photo 1 of 2: flatten it');
  expect(await page.locator('#ps-overlay circle').first().getAttribute('cx')).toBe(cx);
});

test('AutoBuild on the board joins the photos into one picture (no extra layers)', async ({ page }) => {
  await toMerge(page, [A(), B()]);
  await page.click('#ms-auto');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 60000 });
  const proj = await page.evaluate(() => { const p = window.__app.project; return { extra: (p.extraPhotos || []).length, w: p.photo.width, h: p.photo.height }; });
  expect(proj.extra).toBe(0);
  expect(proj.w).toBeGreaterThan(900); // both photos wide, side by side
});

test('Back from the board and forward again keeps how the photos were lined up', async ({ page }) => {
  await toMerge(page, [A(), B()]);
  const [, p2] = await board(page);
  await dragBoard(page, centre(p2), [centre(p2)[0] - 60, centre(p2)[1] + 70]);
  await page.locator('#ms-size').fill('90');
  const lined = (await board(page))[1].t;
  await page.click('#ms-back');
  await page.click('#ps-straighten');
  await page.click('#ps-next-photo');
  await expect(page.locator('#ms-svg')).toBeVisible();
  expect((await board(page))[1].t).toEqual(lined);
});

test('after Start tracing the studio fits the view to all the photos, not just the first', async ({ page }) => {
  await toMerge(page, [A(), B()]);
  await page.click('#ms-trace');
  await expect(page.locator('#studio')).toBeVisible({ timeout: 30000 });
  await page.click('#btn-zoom-fit');
  const r = await page.evaluate(async () => {
    const { photoCorners } = await import('/js/model/photos.js');
    const cv = window.__app.canvas.fabricCanvas, vt = cv.viewportTransform, p = window.__app.project;
    const c = photoCorners(p.extraPhotos[0]);
    const right = Math.max(...c.map((q) => q[0])) * vt[0] + vt[4], bottom = Math.max(...c.map((q) => q[1])) * vt[3] + vt[5];
    return { right, bottom, w: cv.getWidth(), h: cv.getHeight() };
  });
  expect(r.right).toBeLessThanOrEqual(r.w);
  expect(r.bottom).toBeLessThanOrEqual(r.h);
});
