// tests/browser/wheel-and-frame.spec.js
// 1. The map: a two-finger drag (slow OR a fast flick) moves it, a pinch and a mouse-wheel notch zoom it.
// 2. Drawing select: the frame travels with the drawing while it is moved or resized, and is gone after Done.

import { test, expect } from '@playwright/test';

// nav: the View > Navigation setting these tests run under. Their subject is the trackpad (two-finger scroll moves the map),
// so they run in 'trackpad'; the default ('mouse': the wheel always zooms) is covered by the last tests of this file.
async function openStudio(page, nav = 'trackpad') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  await page.addInitScript((n) => { try { localStorage.setItem('fp.navMode', n); } catch (e) { /* ok */ } }, nav);
  await page.goto('/#/new');
  await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
  await page.fill('#bp-building', 'Wheel Test'); await page.fill('#bp-property', '1'); await page.fill('#bp-floor', '1');
  await page.click('#bp-ok');
  await page.click('#ps-skip-initial');
  await expect(page.locator('#studio')).toBeVisible();
  await page.evaluate(async () => {
    const { setFloor, addItem, makeRoom } = await import('/js/model/document.js');
    let d = setFloor(window.__app.doc, [[100, 100], [500, 100], [500, 300], [100, 300]]);
    d = addItem(d, makeRoom('room', 100, 100, 200, 200, '101'));
    window.__app.commit(d, 'Seed');
  });
  return errors;
}

// dispatch wheel events the way a trackpad / mouse would, `gap` ms apart
const wheels = (page, list, gap, extra = {}) => page.evaluate(async ({ list, gap, extra }) => {
  const u = window.__app.canvas.fabricCanvas.upperCanvasEl, r = u.getBoundingClientRect();
  for (const [dx, dy] of list) {
    u.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaX: dx, deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, ...extra }));
    await new Promise((res) => setTimeout(res, gap));
  }
}, { list, gap, extra });
const vt = (page) => page.evaluate(() => [...window.__app.canvas.fabricCanvas.viewportTransform]);
const settle = (page) => page.waitForTimeout(450); // zoom glides over a few frames

test('two-finger drag (slow or a fast flick) moves the map; pinch and wheel notch zoom it', async ({ page }) => {
  const errors = await openStudio(page);
  let a = await vt(page);
  await wheels(page, [[0, 3], [0, 7], [0, 12], [0, 20], [0, 31], [0, 40]], 8);
  await settle(page);
  let b = await vt(page);
  expect(b[5]).toBeLessThan(a[5] - 50); // moved
  expect(b[0]).toBeCloseTo(a[0], 6); // not zoomed

  // a fast flick: big whole numbers a few ms apart used to be mistaken for a wheel and zoom out
  await wheels(page, [[0, 60], [0, 90], [0, 130], [0, 160], [0, 180], [0, 160]], 8);
  await settle(page);
  let c = await vt(page);
  expect(c[5]).toBeLessThan(b[5] - 300);
  expect(c[0]).toBeCloseTo(b[0], 6);

  // sideways drag moves left / right
  await wheels(page, [[40, 0], [60, 0], [80, 0]], 8);
  await settle(page);
  const c2 = await vt(page);
  expect(c2[4]).toBeLessThan(c[4] - 100);

  // pinch (ctrl + small deltas): out then in
  await wheels(page, [[0, 8], [0, 8]], 10, { ctrlKey: true });
  await settle(page);
  const d = await vt(page);
  expect(d[0]).toBeLessThan(c2[0]);
  await wheels(page, [[0, -8], [0, -8]], 10, { ctrlKey: true });
  await settle(page);
  const e = await vt(page);
  expect(e[0]).toBeGreaterThan(d[0]);

  // a lone mouse wheel notch zooms
  await page.waitForTimeout(300);
  await wheels(page, [[0, -100]], 10);
  await settle(page);
  const f = await vt(page);
  expect(f[0]).toBeGreaterThan(e[0]);
  await page.waitForTimeout(300);
  await wheels(page, [[0, 100]], 10);
  await settle(page);
  expect((await vt(page))[0]).toBeLessThan(f[0]);
  expect(errors).toEqual([]);
});

test('Drawing select: the frame moves with the drawing while dragging and resizing, and is gone after Done', async ({ page }) => {
  const errors = await openStudio(page);
  await page.click('#btn-view');
  await page.locator('.vp-sel[data-sel="drawing"]').click();
  await expect(page.locator('.pl-pill')).toContainText('Drawing selected');
  const frame = () => page.evaluate(() => window.__app._photoLayer.frame());
  const toClient = (p) => page.evaluate(([x, y]) => {
    const c = window.__app.canvas.fabricCanvas, r = c.upperCanvasEl.getBoundingClientRect(), v = c.viewportTransform;
    return { x: r.left + x * v[0] + v[4], y: r.top + y * v[3] + v[5] };
  }, p);
  const f0 = await frame();
  expect(f0).toMatchObject({ x: 100, y: 100, w: 400, h: 200 });

  // move: press inside the drawing, drag, and look at the frame BEFORE letting go
  const from = await toClient([300, 200]), to = await toClient([380, 250]);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  const mid = await frame();
  expect(mid.x).toBeGreaterThan(f0.x + 40); // the frame went with the drawing
  expect(mid.y).toBeGreaterThan(f0.y + 20);
  await page.mouse.up();
  const f1 = await frame();
  expect(f1).toMatchObject({ w: 400, h: 200 });
  expect(f1.x).toBe(mid.x);

  // resize from the bottom-right corner: the frame follows the cursor before release
  const corner = await toClient([f1.x + f1.w, f1.y + f1.h]), out = await toClient([f1.x + f1.w * 1.5, f1.y + f1.h * 1.5]);
  await page.mouse.move(corner.x, corner.y); await page.mouse.down();
  await page.mouse.move((corner.x + out.x) / 2, (corner.y + out.y) / 2, { steps: 4 });
  await page.mouse.move(out.x, out.y, { steps: 4 });
  const growing = await frame();
  expect(growing.w).toBeGreaterThan(500);
  expect(growing.w / growing.h).toBeCloseTo(2, 2); // 1:1, never stretched
  await page.mouse.up();
  const f2 = await frame();
  expect(f2.w / f2.h).toBeCloseTo(2, 1);

  await page.click('.pl-done');
  await expect(page.locator('.pl-pill')).toHaveCount(0);
  expect(await page.evaluate(() => window.__app._photoLayer.mode())).toBe(null);
  expect(await frame()).toMatchObject({ w: expect.any(Number) }); // still computable, but nothing draws it
  expect(errors).toEqual([]);
});

// ---- fluid zoom + the scroll wheel pressed in
const sampleZoom = (page, readExpr, run) => page.evaluate(async ({ readExpr, run }) => {
  const read = new Function(`return (${readExpr})();`);
  const frames = []; let on = true;
  const loop = () => { frames.push(read()); if (on) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, 60));
  await (new Function(`return (${run})();`))();
  await new Promise((r) => setTimeout(r, 900));
  on = false; await new Promise((r) => setTimeout(r, 40));
  return frames;
}, { readExpr, run });

test('ctrl + scroll zooms the map fluidly: a glide over many frames, no spike, and it stops when the gesture does', async ({ page }) => {
  const errors = await openStudio(page);
  const frames = await sampleZoom(page, '() => window.__app.canvas.fabricCanvas.getZoom()', `async () => {
    const u = window.__app.canvas.fabricCanvas.upperCanvasEl, r = u.getBoundingClientRect();
    for (let i = 0; i < 30; i++) { // a pinch: small deltas, ~60 per second
      u.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + 200, clientY: r.top + 200, deltaY: -4, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise((res) => setTimeout(res, 16));
    }
  }`);
  const z0 = frames[0], zEnd = frames[frames.length - 1];
  expect(zEnd).toBeGreaterThan(z0 * 1.3); // it actually zoomed in
  expect(zEnd).toBeLessThan(z0 * 4); // ...but did not fly to the far end
  const distinct = new Set(frames.map((v) => Math.round(v * 1e4))).size;
  expect(distinct).toBeGreaterThan(10); // a glide, not one jump
  let worst = 1;
  for (let i = 1; i < frames.length; i++) { expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1] - 1e-9); worst = Math.max(worst, frames[i] / frames[i - 1]); }
  expect(worst).toBeLessThan(1.06); // never a spike from one frame to the next (about 4% at most)
  const tail = frames.slice(-20);
  expect(Math.abs(tail[tail.length - 1] - tail[0])).toBeLessThan(1e-6); // and it has stopped
  expect(errors).toEqual([]);
});

test('the scroll wheel pressed in grabs and drags the map', async ({ page }) => {
  const errors = await openStudio(page);
  const box = await page.locator('#stage canvas.upper-canvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const before = await vt(page);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x - 60, y + 40, { steps: 5 });
  await expect(page.locator('#btn-hand-toggle')).toHaveClass(/oe-held/);
  await page.mouse.move(x - 120, y + 80, { steps: 5 });
  const during = await vt(page);
  expect(during[4]).toBeCloseTo(before[4] - 120, 0); // follows the cursor 1:1
  expect(during[5]).toBeCloseTo(before[5] + 80, 0);
  expect(during[0]).toBeCloseTo(before[0], 6);
  await page.mouse.up({ button: 'middle' });
  await expect(page.locator('#btn-hand-toggle')).not.toHaveClass(/oe-held/);
  const after = await vt(page);
  await page.mouse.move(x + 30, y + 30, { steps: 3 }); // no drag after release
  expect(await vt(page)).toEqual(after);
  expect(errors).toEqual([]);
});

test('wheel ticks and a gliding zoom during a grab never pull the map off the pointer', async ({ page }) => {
  const errors = await openStudio(page);
  const box = await page.locator('#stage canvas.upper-canvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -100); // a zoom starts gliding, and the grab begins right away
  await page.mouse.down({ button: 'middle' });
  const start = await vt(page);
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x + i * 8, y + i * 3);
    if (i % 3 === 0) await page.mouse.wheel(0, 100); // the tiny tick a pressed wheel can send
    const now = await vt(page);
    expect(now[0]).toBeCloseTo(start[0], 6); // zoom untouched while carrying
    expect(now[4]).toBeCloseTo(start[4] + i * 8, 0);
    expect(now[5]).toBeCloseTo(start[5] + i * 3, 0);
  }
  await page.mouse.up({ button: 'middle' });
  expect(errors).toEqual([]);
});

// ---- the Preview: the same two things
test('Preview: ctrl + scroll glides, and the scroll wheel pressed in drags the plan', async ({ page }) => {
  const errors = await openStudio(page);
  await page.evaluate(() => window.__app.exportAll());
  await expect(page.locator('#preview-svg-wrap svg')).toBeVisible();
  const scaleOf = String.raw`() => { const m = /scale\(([-0-9.]+)\)/.exec(document.querySelector('#preview-svg-wrap svg').style.transform || ''); return m ? parseFloat(m[1]) : 1; }`;
  const frames = await sampleZoom(page, scaleOf, `async () => {
    const w = document.getElementById('preview-svg-wrap'), r = w.getBoundingClientRect();
    for (let i = 0; i < 30; i++) {
      w.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY: -5, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise((res) => setTimeout(res, 16));
    }
  }`);
  expect(frames[frames.length - 1]).toBeGreaterThan(1.2);
  expect(frames[frames.length - 1]).toBeLessThan(5);
  expect(new Set(frames.map((v) => Math.round(v * 1e3))).size).toBeGreaterThan(10);
  let worst = 1;
  for (let i = 1; i < frames.length; i++) { expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1] - 1e-9); worst = Math.max(worst, frames[i] / frames[i - 1]); }
  expect(worst).toBeLessThan(1.06);
  const tail = frames.slice(-15);
  expect(Math.abs(tail[tail.length - 1] - tail[0])).toBeLessThan(1e-6);

  // wheel pressed in: the plan follows the cursor
  const tr = () => page.evaluate(() => { const m = /translate\(([-0-9.]+)px, ([-0-9.]+)px\)/.exec(document.querySelector('#preview-svg-wrap svg').style.transform || ''); return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0]; });
  const t0 = await tr();
  const box = await page.locator('#preview-svg-wrap').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x - 40, y - 30, { steps: 4 });
  await page.mouse.move(x - 80, y - 60, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  const t1 = await tr();
  expect(t1[0]).toBeLessThan(t0[0] - 40);
  expect(t1[1]).toBeLessThan(t0[1] - 30);
  expect(await page.evaluate(() => (/scale\(([-0-9.]+)\)/.exec(document.querySelector('#preview-svg-wrap svg').style.transform) || [])[1])).toBeTruthy(); // a wheel press never zooms/resets
  expect(errors).toEqual([]);
});

test('ctrl + scroll goes in AND out through the middle (never flying between two extremes), and it stops soon after you let go', async ({ page }) => {
  const errors = await openStudio(page);
  await page.evaluate(() => window.__app.canvas.fabricCanvas.setViewportTransform([0.5, 0, 0, 0.5, 0, 0]));
  const drive = (dy, n) => page.evaluate(async ({ dy, n }) => {
    const u = window.__app.canvas.fabricCanvas.upperCanvasEl, r = u.getBoundingClientRect();
    for (let i = 0; i < n; i++) { u.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + 200, clientY: r.top + 200, deltaY: dy, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true })); await new Promise((res) => setTimeout(res, 8)); }
  }, { dy, n });
  const z = async () => (await vt(page))[0];
  const z0 = await z();
  await drive(-30, 40); // a fast ctrl + scroll in
  const t0 = Date.now();
  await page.waitForTimeout(400); // the glide is over well within this
  const zIn = await z();
  expect(zIn).toBeGreaterThan(z0 * 1.2);
  expect(zIn).toBeLessThan(8); // not slammed to the maximum
  await page.waitForTimeout(100);
  expect(await z()).toBeCloseTo(zIn, 6); // and it has stopped: nothing is still moving after you let go
  await drive(30, 40); // and back out
  await page.waitForTimeout(500);
  const zOut = await z();
  expect(zOut).toBeLessThan(zIn * 0.9);
  expect(zOut).toBeGreaterThan(0.1);
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(errors).toEqual([]);
});

test('the page is idle after a drag: no animation loop keeps re-drawing the plan', async ({ page }) => {
  const errors = await openStudio(page);
  await page.evaluate(async () => {
    const D = await import('/js/model/document.js');
    const room = window.__app.doc.items.find((i) => i.type === 'room');
    window.__app.commit(D.updateItem(window.__app.doc, room.id, { x: room.x + 5 }), 'drag'); // makes the yellow notes (rooms without numbers etc.) appear
  });
  await page.waitForTimeout(800);
  const renders = await page.evaluate(async () => {
    let n = 0; const c = window.__app.canvas.fabricCanvas; c.on('after:render', () => { n++; });
    await new Promise((r) => setTimeout(r, 1500));
    return n;
  });
  expect(renders).toBeLessThanOrEqual(2); // it used to redraw ten times a second (the highlight pulse)
  expect(errors).toEqual([]);
});

const dragEvents = (page, dx, dy, n) => page.evaluate(async ({ dx, dy, n }) => {
  const u = window.__app.canvas.fabricCanvas.upperCanvasEl, r = u.getBoundingClientRect();
  for (let i = 0; i < n; i++) { u.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + 300, clientY: r.top + 300, deltaX: dx, deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true })); await new Promise((res) => setTimeout(res, 8)); }
}, { dx, dy, n });

test('a straight two-finger drag does not creep sideways, drag after drag, and never loses the plan', async ({ page }) => {
  const errors = await openStudio(page);
  const start = await vt(page);
  for (let round = 0; round < 8; round++) { // eight separate drags, each straight down with the usual finger skew
    await dragEvents(page, 3, 20, 25);
    await page.waitForTimeout(250);
  }
  const end = await vt(page);
  expect(end[5]).toBeLessThan(start[5] - 300); // it went down...
  const bottom = await page.evaluate(() => { const v = window.__app.canvas.fabricCanvas.viewportTransform, vb = window.__app.doc.viewBox; return (vb.y + vb.h) * v[0] + v[5]; });
  expect(bottom).toBeGreaterThanOrEqual(79); // ...but never so far that the plan is gone: a strip of it stays on screen
  expect(Math.abs(end[4] - start[4])).toBeLessThan(40); // and hardly moved sideways (it used to creep ~600 px)
  expect(errors).toEqual([]);
});

test('a real diagonal two-finger drag still moves both ways', async ({ page }) => {
  const errors = await openStudio(page);
  const d0 = await vt(page);
  await dragEvents(page, 8, 8, 20);
  await page.waitForTimeout(150);
  const d1 = await vt(page);
  expect(d0[4] - d1[4]).toBeGreaterThan(100);
  expect(d0[5] - d1[5]).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

// ---- hold Control and scroll: real keyboard + real wheel, wherever the pointer is on the editor
test('hold Ctrl and scroll zooms the plan wherever the pointer is on the editor, never the web page', async ({ page }) => {
  const errors = await openStudio(page); // (no outline yet: the start card is up)
  await page.evaluate(() => { window.__w = []; window.addEventListener('wheel', (e) => setTimeout(() => window.__w.push([e.ctrlKey, e.defaultPrevented]), 0), { passive: true, capture: true }); });
  const z = async () => (await vt(page))[0];
  const stage = await page.locator('#stage').boundingBox();
  const spots = {
    'canvas centre': [stage.x + stage.width / 2, stage.y + stage.height / 2],
    'canvas corner': [stage.x + 40, stage.y + 40],
    'over the zoom buttons': [stage.x + stage.width - 60, stage.y + stage.height - 40],
    'over the hand button': [stage.x + 40, stage.y + stage.height - 40],
  };
  const ctrlScroll = async ([x, y], dy, n = 5) => {
    await page.mouse.move(x, y);
    await page.keyboard.down('Control');
    for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(30); }
    await page.keyboard.up('Control');
    await page.waitForTimeout(600);
  };
  for (const [name, p] of Object.entries(spots)) {
    const a = await z();
    await ctrlScroll(p, -100); // scroll up = zoom in
    const b = await z();
    expect(b, `${name}: in`).toBeGreaterThan(a * 1.3);
    await ctrlScroll(p, 100); // scroll down = zoom out, back through the middle
    const c = await z();
    expect(c, `${name}: out`).toBeLessThan(b * 0.8);
    expect(c, `${name}: back near the start`).toBeGreaterThan(a * 0.7);
  }
  // over the side panel / top bar: still the plan that zooms (not the page), about the middle of the stage
  const side = await page.locator('#palette').boundingBox();
  const a = await z();
  await ctrlScroll([side.x + side.width / 2, side.y + 60], -100, 4);
  expect(await z()).toBeGreaterThan(a * 1.3);
  // every ctrl + wheel event was handled by the app (default prevented = no browser page zoom)
  const seen = await page.evaluate(() => window.__w);
  expect(seen.length).toBeGreaterThan(20);
  expect(seen.every(([ctrl, prevented]) => !ctrl || prevented)).toBe(true);
  // and a plain wheel over the side panel still scrolls the panel, not the plan
  const zBefore = await z();
  await page.mouse.move(side.x + side.width / 2, side.y + 100);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  expect(await z()).toBeCloseTo(zBefore, 6);
  expect(errors).toEqual([]);
});

test('ctrl + scroll zooms about the pointer: the spot under the cursor stays put', async ({ page }) => {
  const errors = await openStudio(page);
  const box = await page.locator('#stage canvas.upper-canvas').boundingBox();
  const px = box.x + box.width * 0.3, py = box.y + box.height * 0.4;
  const planAt = () => page.evaluate(([x, y]) => {
    const c = window.__app.canvas.fabricCanvas, r = c.upperCanvasEl.getBoundingClientRect(), v = c.viewportTransform;
    return [(x - r.left - v[4]) / v[0], (y - r.top - v[5]) / v[3]];
  }, [px, py]);
  const before = await planAt();
  await page.mouse.move(px, py);
  await page.keyboard.down('Control');
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(25); }
  await page.keyboard.up('Control');
  await page.waitForTimeout(700);
  const after = await planAt();
  expect(Math.abs(after[0] - before[0])).toBeLessThan(3); // within a screen pixel or two
  expect(Math.abs(after[1] - before[1])).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test('two-finger drag: when the fingers lift, the map stays where it is (the OS momentum tail is not followed)', async ({ page }) => {
  const errors = await openStudio(page);
  await page.evaluate(() => window.__app.canvas.zoomTo(true));
  const sample = (script) => page.evaluate(async (script) => {
    const u = window.__app.canvas.fabricCanvas.upperCanvasEl, r = u.getBoundingClientRect(), c = window.__app.canvas.fabricCanvas;
    const send = (dx, dy) => u.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + 300, clientY: r.top + 300, deltaX: dx, deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true }));
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const y0 = c.viewportTransform[5];
    const contact = [20, 18, 23, 19, 25, 17, 22, 21, 26, 18, 24, 20, 23, 19, 27, 22];
    for (const m of contact) { send(0, -m); await sleep(8); } // fingers down, moving up the page
    const yLift = c.viewportTransform[5];
    let v = 34; // lift-off: the trackpad keeps sending shrinking events
    for (let i = 0; i < 45; i++) { send(0, -v); v *= 0.94; await sleep(8); }
    await sleep(200);
    return { dragged: Math.round(yLift - y0), coasted: Math.round(c.viewportTransform[5] - yLift) };
  }, script);
  const r = await sample('go');
  expect(r.dragged).toBeGreaterThan(300); // the drag itself moved the map
  expect(Math.abs(r.coasted)).toBeLessThan(150); // the momentum tail (about 500 px) was not followed
  // two-way: left then right still tracks the fingers
  const lr = await page.evaluate(async () => {
    const u = window.__app.canvas.fabricCanvas.upperCanvasEl, r = u.getBoundingClientRect(), c = window.__app.canvas.fabricCanvas;
    const send = (dx) => u.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + 300, clientY: r.top + 300, deltaX: dx, deltaY: 0, deltaMode: 0, bubbles: true, cancelable: true }));
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    await sleep(400);
    const x0 = c.viewportTransform[4];
    for (const m of [20, 22, 19, 24, 18, 21, 23, 20]) { send(m); await sleep(8); }
    const xRight = c.viewportTransform[4];
    await sleep(300);
    for (const m of [20, 22, 19, 24, 18, 21, 23, 20]) { send(-m); await sleep(8); }
    await sleep(300);
    return { out: Math.round(xRight - x0), back: Math.round(c.viewportTransform[4] - x0) };
  });
  expect(lr.out).toBeLessThan(-100);
  expect(Math.abs(lr.back)).toBeLessThan(25); // back to where it started
  expect(errors).toEqual([]);
});

test('hold and drag (hand tool, Space, wheel press): left then right tracks the cursor, and after you let go the map stays put', async ({ page }) => {
  const errors = await openStudio(page);
  const box = await page.locator('#stage canvas.upper-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const side = await page.locator('#palette').boundingBox();
  const modes = {
    'hand tool': { start: async () => { await page.click('#btn-hand-toggle'); }, end: async () => { await page.click('#btn-hand-toggle'); }, button: 'left' },
    'Space': { start: async () => { await page.keyboard.down('Space'); }, end: async () => { await page.keyboard.up('Space'); }, button: 'left' },
    'wheel press': { start: async () => {}, end: async () => {}, button: 'middle' },
  };
  for (const [name, m] of Object.entries(modes)) {
    await m.start();
    await page.mouse.move(cx, cy);
    const v0 = await vt(page);
    await page.mouse.down({ button: m.button });
    await page.mouse.move(cx - 120, cy + 30, { steps: 6 }); // left
    expect((await vt(page))[4], `${name}: left`).toBeCloseTo(v0[4] - 120, 0);
    await page.mouse.move(cx + 80, cy - 20, { steps: 10 }); // then right, past where it started
    const v1 = await vt(page);
    expect(v1[4], `${name}: right`).toBeCloseTo(v0[4] + 80, 0);
    expect(v1[5], `${name}: up`).toBeCloseTo(v0[5] - 20, 0);
    // let go over the side panel (outside the canvas), then wander: the map must not move
    await page.mouse.move(side.x + 40, side.y + 60, { steps: 4 });
    await page.mouse.up({ button: m.button });
    const v2 = await vt(page);
    await page.mouse.move(cx, cy, { steps: 5 });
    await page.mouse.move(cx + 200, cy + 100, { steps: 5 });
    await page.waitForTimeout(500);
    expect(await vt(page), `${name}: stays put after release`).toEqual(v2);
    expect(v2[0], `${name}: no zoom change`).toBeCloseTo(v0[0], 6);
    await m.end();
  }
  expect(errors).toEqual([]);
});

test('Drawing select: drag left then right in one hold lands exactly where you let go, and nothing moves afterwards', async ({ page }) => {
  const errors = await openStudio(page);
  await page.click('#btn-view');
  await page.locator('.vp-sel[data-sel="drawing"]').click();
  const state = () => page.evaluate(() => ({ pts: window.__app.doc.floor.points[0], frame: window.__app._photoLayer.frame(), past: window.__app.project.history.past.length }));
  const toClient = (p) => page.evaluate(([x, y]) => {
    const c = window.__app.canvas.fabricCanvas, r = c.upperCanvasEl.getBoundingClientRect(), v = c.viewportTransform;
    return { x: r.left + x * v[0] + v[4], y: r.top + y * v[3] + v[5], z: v[0] };
  }, p);
  const s0 = await state();
  const a = await toClient([300, 200]);
  const side = await page.locator('#palette').boundingBox();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x - 90, a.y + 20, { steps: 6 }); // left
  const midLeft = (await state()).frame.x;
  expect(midLeft).toBeLessThan(s0.frame.x - 40);
  await page.mouse.move(a.x + 60, a.y - 10, { steps: 8 }); // right, past the start
  const right = (await state()).frame;
  expect(right.x).toBeGreaterThan(s0.frame.x + 20);
  await page.mouse.move(side.x + 30, side.y + 50, { steps: 4 }); // release outside the canvas
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s1 = await state();
  expect(s1.past).toBe(s0.past + 1); // one undo step
  await page.mouse.move(a.x, a.y, { steps: 4 });
  await page.mouse.move(a.x + 150, a.y + 90, { steps: 6 }); // wander with no button
  await page.waitForTimeout(400);
  const s2 = await state();
  expect(s2.pts).toEqual(s1.pts); // nothing moved after the release
  expect(s2.frame).toEqual(s1.frame);
  expect(s2.past).toBe(s1.past);
  expect(errors).toEqual([]);
});
