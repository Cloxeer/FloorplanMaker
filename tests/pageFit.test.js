// tests/pageFit.test.js
// The exported frame must contain everything drawn (plan, labels, compass,
// legend) for tall and wide buildings, in Fit and on Letter/A4 paper.
// Depends on: node:test, node:assert, js/model/pageFit.js, js/model/svgExport.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentBounds, pageFrame, applyFrame } from '../js/model/pageFit.js';
import { exportSvg } from '../js/model/svgExport.js';
import { importSvg } from '../js/model/svgImport.js';

const LEGEND = { w: 180, h: 260 };

function planDoc(w, h) {
  // A photo-sized viewBox that is SMALLER than what gets drawn: the compass
  // sits past the top-right corner, the way users drop it outside the photo.
  return {
    meta: { building: 'Test', property: '1', floor: 1, slug: 't-1' },
    viewBox: { x: 0, y: 0, w, h },
    floor: { points: [[40, 40], [w - 40, 40], [w - 40, h - 40], [40, h - 40]] },
    items: [
      { id: 'r', type: 'room', cls: 'room', shape: 'rect', x: 80, y: 80, w: 200, h: 120, number: '101', name: '', label: { pinned: false, x: null, y: null, fontSize: null }, showName: false },
      { id: 'hl', type: 'hall', x: 60, y: 220, w: w - 120, h: 60 },
      { id: 'd', type: 'door', x1: 100, y1: 40, x2: 136, y2: 40, label: { x: 118, y: 95 }, kind: 'EXIT' },
      { id: 'c', type: 'compass', x: w + 30, y: -30, deg: 0 },
    ],
    sections: [],
  };
}

function contains(frame, box) {
  return frame.x <= box.x && frame.y <= box.y
    && frame.x + frame.w >= box.x + box.w && frame.y + frame.h >= box.y + box.h;
}

for (const [name, w, h] of [['wide (landscape) building', 1600, 500], ['tall (portrait) building', 500, 1400]]) {
  test(`${name}: every page choice contains plan, compass and legend`, () => {
    const doc = planDoc(w, h);
    const legend = { x: w + 60, y: h - 200, scale: 1.2 }; // off to the right, outside the photo
    const b = contentBounds(doc, legend, LEGEND);
    const compass = { x: w + 30 - 82, y: -30 - 82, w: 164, h: 164 };
    const legendBox = { x: legend.x, y: legend.y, w: LEGEND.w * 1.2, h: LEGEND.h * 1.2 };
    assert.ok(contains(b, compass), 'bounds include the whole compass');
    assert.ok(contains(b, legendBox), 'bounds include the whole legend');

    for (const page of ['fit', 'letter', 'a4']) {
      for (const orient of ['auto', 'portrait', 'landscape']) {
        const f = pageFrame(b, page, orient);
        assert.ok(contains(f, b), `${page}/${orient} frame cuts content off`);
        for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(f[k]), `${page} ${k} not integer`);
      }
    }
  });
}

test('Fit hugs the content with a small margin (no photo-sized blank space)', () => {
  const doc = planDoc(1600, 500);
  doc.viewBox = { x: 0, y: 0, w: 4000, h: 3000 }; // huge photo
  const b = contentBounds(doc);
  const f = pageFrame(b, 'fit');
  assert.ok(f.w < 1900 && f.h < 800, `fit frame too big: ${f.w}x${f.h}`);
  assert.equal(f.width, undefined, 'fit frame has no paper size');
});

test('paper frames have the paper shape and orientation', () => {
  const wide = contentBounds(planDoc(1600, 500));
  const tall = contentBounds(planDoc(500, 1400));
  const L = pageFrame(wide, 'letter', 'auto');
  assert.equal(L.orientation, 'landscape');
  assert.equal(L.width, '11in');
  assert.equal(L.height, '8.5in');
  assert.ok(Math.abs(L.w / L.h - 11 / 8.5) < 0.01);
  const P = pageFrame(tall, 'a4', 'auto');
  assert.equal(P.orientation, 'portrait');
  assert.equal(P.width, '210mm');
  assert.ok(Math.abs(P.w / P.h - 210 / 297) < 0.01);
  // Forcing portrait on a wide plan still fits everything.
  const forced = pageFrame(wide, 'letter', 'portrait');
  assert.equal(forced.orientation, 'portrait');
  assert.ok(contains(forced, wide));
});

test('paper layout: resizing is uniform and the drawing can never leave the sheet', () => {
  const b = contentBounds(planDoc(1600, 500));
  const base = pageFrame(b, 'letter', 'landscape');
  assert.equal(base.scale, 1);
  assert.ok(base.maxScale > 1, 'can grow past the print margin up to the sheet edge');

  // Half size: the page covers twice as many plan units, same paper shape.
  const half = pageFrame(b, 'letter', 'landscape', { scale: 0.5 });
  assert.ok(Math.abs(half.w / base.w - 2) < 0.01 && Math.abs(half.h / base.h - 2) < 0.01);
  assert.ok(Math.abs(half.w / half.h - 11 / 8.5) < 0.01, 'paper proportions unchanged');

  // Way too big / dragged off the corner: clamped so it still fits.
  for (const layout of [{ scale: 50 }, { scale: 0.5, fx: -3, fy: 9 }, { scale: 1.05, fx: 1, fy: 0 }]) {
    const f = pageFrame(b, 'letter', 'landscape', layout);
    assert.ok(contains(f, b), `layout ${JSON.stringify(layout)} pushed content off the page`);
    assert.ok(f.scale <= f.maxScale + 1e-9 && f.scale >= 0.2);
    // ...and stays out of the 1/4 in edge band printers can't print.
    const safe = 0.25 * (f.w / 11); // plan units in 1/4 in (landscape sheet is 11 in wide)
    const gaps = [b.x - f.x, b.y - f.y, f.x + f.w - (b.x + b.w), f.y + f.h - (b.y + b.h)];
    assert.ok(gaps.every((gap) => gap >= safe - 2), `inside the unprintable edge: ${gaps.map(Math.round)}`);
  }

  // Moving to the left edge really moves it there.
  const left = pageFrame(b, 'letter', 'landscape', { scale: 0.5, fx: 0 });
  assert.ok(left.content.x - left.x < (half.content.x - half.x), 'drawing moved left on the sheet');
});

test('paper SVG tells the printer its size and orientation (@page)', () => {
  const doc = planDoc(1600, 500);
  const svg = exportSvg(doc);
  const land = applyFrame(svg, pageFrame(contentBounds(doc), 'letter', 'landscape'));
  assert.ok(land.includes('@page { size: 11in 8.5in; margin: 0; }'));
  const a4p = applyFrame(land, pageFrame(contentBounds(doc), 'a4', 'portrait'));
  assert.equal((a4p.match(/@page/g) || []).length, 1, 'rule replaced, not duplicated');
  assert.ok(a4p.includes('size: 210mm 297mm'));
  const fit = applyFrame(a4p, pageFrame(contentBounds(doc), 'fit'));
  assert.ok(!fit.includes('@page'), 'Fit to SVG has no print rule');
  const { problems } = importSvg(a4p);
  assert.deepEqual(problems.filter((p) => p.code !== 'label-orphan'), []);
});

test('applyFrame rewrites the root tag and the result still imports', () => {
  const doc = planDoc(1600, 500);
  const svg = exportSvg(doc);
  const frame = pageFrame(contentBounds(doc), 'letter', 'auto');
  const out = applyFrame(svg, frame);
  const root = out.match(/<svg\b[^>]*>/)[0];
  assert.ok(root.includes(`viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}"`));
  assert.ok(root.includes('width="11in"') && root.includes('height="8.5in"'));
  // Switching back to Fit removes the paper size again.
  const fit = applyFrame(out, pageFrame(contentBounds(doc), 'fit'));
  assert.ok(!/<svg\b[^>]*\swidth=/.test(fit));
  const { doc: back, problems } = importSvg(fit);
  assert.deepEqual(problems.filter((p) => p.code !== 'label-orphan'), []);
  assert.equal(back.items.filter((i) => i.type === 'compass').length, 1);
});
