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
