// tests/browser/perf.spec.js
// Drag performance on a large plan: commit 2,000 rooms in one batch, then drag
// one of them through 100 mouse moves and measure how long the stage's
// `object:moving` handling takes per event. Uses window.__app (exposed by
// js/main.js) and app.canvas.fabricCanvas (exposed by js/view/stage.js).
//
// Run with: node_modules/.bin/playwright test --config tests/browser/playwright.config.js

import { test, expect } from '@playwright/test';

const BUDGET_MS = 4;

test.describe('stage performance', () => {
  test('object:moving stays under 4ms with 2,000 rooms', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.stack || e)));

    await page.goto('/');
    await page.click('#btn-start-blueprint');
    await page.click('#folder-modal-skip', { timeout: 3000 }).catch(() => {});
    await page.fill('#bp-building', 'Perf Building');
    await page.fill('#bp-property', '9999');
    await page.fill('#bp-floor', '1');
    await page.click('#bp-ok');
    await expect(page.locator('#photo-step')).toBeVisible();
    await page.click('#ps-skip-initial');
    await expect(page.locator('#studio')).toBeVisible();

    // ---- 2,000 rooms in one commit ----
    const buildMs = await page.evaluate(async () => {
      const app = window.__app;
      const m = await import('/js/model/document.js');
      let doc = m.setFloor(app.doc, [[0, 0], [4000, 0], [4000, 3000], [0, 3000]]);
      doc = { ...doc, viewBox: { x: 0, y: 0, w: 4000, h: 3000 } };
      const items = [];
      for (let i = 0; i < 2000; i += 1) {
        const col = i % 50;
        const row = Math.floor(i / 50);
        items.push(m.makeRoom('room', 20 + col * 78, 20 + row * 72, 70, 60, ''));
      }
      const t0 = performance.now();
      app.commit({ ...doc, items }, 'perf seed');
      const ms = performance.now() - t0;
      app.canvas.zoomTo(true);
      return ms;
    });
    const itemCount = await page.evaluate(() => window.__app.doc.items.length);
    expect(itemCount).toBe(2000);

    // ---- drag one room through 100 mouse moves ----
    const target = await page.evaluate(() => {
      const app = window.__app;
      const canvas = app.canvas.fabricCanvas;
      window.__perf = { total: 0, n: 0, max: 0, mark: 0 };
      // Bracket the work: t0 at the raw pointer event (capture phase, before
      // Fabric sees it), t1 in an `object:moving` listener registered after the
      // stage's own, so the window covers everything the stage does per move.
      const mark = () => { window.__perf.mark = performance.now(); };
      canvas.upperCanvasEl.addEventListener('pointermove', mark, true);
      canvas.upperCanvasEl.addEventListener('mousemove', mark, true);
      canvas.on('object:moving', () => {
        if (!window.__perf.mark) return;
        const dt = performance.now() - window.__perf.mark;
        window.__perf.mark = 0;
        window.__perf.total += dt;
        window.__perf.n += 1;
        window.__perf.max = Math.max(window.__perf.max, dt);
      });
      const item = app.doc.items[1000];
      app.setSelection([item.id]);
      const v = app.canvas.getView();
      const r = document.querySelector('#stage').getBoundingClientRect();
      const cx = item.x + item.w / 2;
      const cy = item.y + item.h / 2;
      return {
        x: r.left + (cx - v.x) * v.zoom,
        y: r.top + (cy - v.y) * v.zoom,
        id: item.id,
      };
    });

    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    for (let i = 1; i <= 100; i += 1) {
      await page.mouse.move(target.x + i * 0.9, target.y + i * 0.6);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    const perf = await page.evaluate(() => window.__perf);
    const avg = perf.n ? perf.total / perf.n : 0;
    // eslint-disable-next-line no-console
    console.log(`[perf] 2000-room commit: ${buildMs.toFixed(1)} ms | object:moving events: ${perf.n} | avg ${avg.toFixed(3)} ms | max ${perf.max.toFixed(3)} ms`);

    expect(perf.n).toBeGreaterThan(30);
    expect(avg).toBeLessThan(BUDGET_MS);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});
