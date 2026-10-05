import test from 'node:test';
import assert from 'node:assert/strict';
import { photoCorners, hitPhoto, layoutExtras, moved, scaledBy, turnedBy, photoCentre, translateDoc, unionBox, tOf } from '../js/model/photos.js';

const P = (w, h, t) => ({ dataUrl: 'x', width: w, height: h, ...(t ? { t } : {}) });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('corners: rotation turns about the top-left corner', () => {
  const c = photoCorners(P(100, 50, { x: 10, y: 20, s: 1, a: 90 }));
  near(c[1][0], 10); near(c[1][1], 120); near(c[3][0], -40); near(c[3][1], 20);
});

test('hitPhoto: top-most wins, rotated photos use their own axes, misses are -1', () => {
  const a = P(100, 100, { x: 0, y: 0, s: 1, a: 0 }), b = P(100, 100, { x: 50, y: 50, s: 1, a: 0 });
  assert.equal(hitPhoto([a, b], [75, 75]), 1);
  assert.equal(hitPhoto([a, b], [10, 10]), 0);
  assert.equal(hitPhoto([a, b], [300, 300]), -1);
  const r = P(100, 20, { x: 0, y: 0, s: 1, a: 90 }); // now runs down from the origin
  assert.equal(hitPhoto([r], [-10, 50]), 0);
  assert.equal(hitPhoto([r], [50, 10]), -1);
});

test('layoutExtras: arrive apart, to the right, about the first photo height', () => {
  const first = P(1000, 800);
  const out = layoutExtras(first, [P(600, 400), P(900, 1600)]);
  assert.ok(out[0].t.x > 1000 && out[1].t.x > out[0].t.x + 600 * out[0].t.s);
  near(out[0].t.s, 2); near(out[1].t.s, 0.5);
  assert.equal(out[0].t.y, 0);
  assert.equal(first.t, undefined, 'input untouched');
  assert.deepEqual(layoutExtras(first, []), []);
});

test('move / scale / turn keep the centre put (scale, turn) and never mutate', () => {
  const p = P(200, 100, { x: 50, y: 50, s: 1, a: 0 });
  const c0 = photoCentre(p);
  const s = scaledBy(p, 2), r = turnedBy(p, 30);
  near(photoCentre(s)[0], c0[0]); near(photoCentre(s)[1], c0[1]);
  near(photoCentre(r)[0], c0[0]); near(photoCentre(r)[1], c0[1]);
  near(tOf(r).a, 30); near(tOf(s).s, 2);
  assert.equal(p.t.s, 1);
  assert.equal(moved(p, 5, -5).t.x, 55);
  near(tOf(turnedBy(p, -10)).a, 350);
  assert.ok(tOf(scaledBy(p, 1e-9)).s >= 0.05);
});

test('unionBox covers every photo', () => {
  const b = unionBox([P(100, 100, { x: 0, y: 0, s: 1, a: 0 }), P(100, 100, { x: 300, y: 50, s: 1, a: 0 })]);
  assert.deepEqual([b.x, b.y, b.w, b.h], [0, 0, 400, 150]);
  assert.equal(unionBox([]), null);
});

test('translateDoc slides every kind of item, labels and the outline', () => {
  const doc = {
    viewBox: { x: 0, y: 0, w: 100, h: 100 }, floor: { points: [[0, 0], [100, 0], [100, 100]] },
    items: [
      { id: 'r', type: 'room', shape: 'rect', x: 10, y: 10, w: 20, h: 20, label: { pinned: true, x: 15, y: 15 } },
      { id: 'p', type: 'room', shape: 'poly', points: [[0, 0], [5, 0], [5, 5]], label: { pinned: false, x: null, y: null } },
      { id: 'd', type: 'door', x1: 0, y1: 0, x2: 10, y2: 0, label: { x: 5, y: 3 } },
      null,
    ],
  };
  const t = translateDoc(doc, 100, -50);
  assert.deepEqual(t.floor.points[1], [200, -50]);
  assert.deepEqual([t.items[0].x, t.items[0].y, t.items[0].label.x, t.items[0].label.y], [110, -40, 115, -35]);
  assert.deepEqual(t.items[1].points[2], [105, -45]); assert.equal(t.items[1].label.x, null);
  assert.deepEqual([t.items[2].x1, t.items[2].y2, t.items[2].label.x], [100, -50, 105]);
  assert.equal(t.items[3], null);
  assert.deepEqual(t.viewBox, doc.viewBox);
  assert.equal(doc.items[0].x, 10, 'input untouched');
  assert.equal(translateDoc(doc, 0, 0), doc);
});

test('snapPhoto: edges meet, tops line up, far photos are left alone, turned photos use their box', async () => {
  const { snapPhoto } = await import('../js/model/photos.js');
  const a = P(100, 100, { x: 0, y: 0, s: 1, a: 0 });
  const nearRight = P(100, 100, { x: 104, y: 3, s: 1, a: 0 }); // 4 to the right of a's right edge, 3 low
  const r = snapPhoto(nearRight, [a], 8);
  assert.equal(r.dx, -4); assert.equal(r.dy, -3);
  assert.deepEqual(r.guides.map((g) => g.axis).sort(), ['x', 'y']);
  const far = snapPhoto(P(100, 100, { x: 300, y: 300, s: 1, a: 0 }), [a], 8);
  assert.deepEqual([far.dx, far.dy, far.guides.length], [0, 0, 0]);
  const centred = snapPhoto(P(40, 40, { x: 31, y: 200, s: 1, a: 0 }), [a], 8); // its middle (51) vs a's middle (50)
  assert.equal(centred.dx, -1);
  const turned = snapPhoto(P(100, 20, { x: 105, y: 0, s: 1, a: 90 }), [a], 8); // runs down; its box spans x 85..105
  assert.ok(Number.isFinite(turned.dx));
  assert.deepEqual(snapPhoto(a, [], 8).guides, []);
});

test('scaleDoc: one factor both ways, on the 5-grid, shared edges stay shared, compass and legend keep their size', async () => {
  const { scaleDoc } = await import('../js/model/photos.js');
  const doc = {
    floor: { points: [[0, 0], [400, 0], [400, 200], [0, 200]] },
    items: [
      { id: 'a', type: 'room', shape: 'rect', x: 0, y: 0, w: 200, h: 200 },
      { id: 'b', type: 'room', shape: 'rect', x: 200, y: 0, w: 200, h: 200 },
      { id: 'p', type: 'room', shape: 'poly', points: [[0, 0], [100, 0], [100, 50]] },
      { id: 'd', type: 'door', x1: 0, y1: 100, x2: 0, y2: 140, label: { x: 20, y: 120 } },
      { id: 'c', type: 'compass', x: 380, y: 20, deg: 0 },
      null,
    ],
  };
  const t = scaleDoc(doc, 1.5, 0, 0);
  const [a, b] = t.items;
  assert.deepEqual([a.x, a.w, a.h], [0, 300, 300]);
  assert.equal(a.x + a.w, b.x, 'neighbours still share their edge');
  assert.deepEqual(t.floor.points[2], [600, 300]);
  assert.deepEqual(t.items[2].points[2], [150, 75].map((v) => Math.round(v / 5) * 5));
  assert.deepEqual([t.items[3].y1, t.items[3].y2, t.items[3].label.x, t.items[3].label.y], [150, 210, 30, 180]);
  assert.deepEqual([t.items[4].x, t.items[4].y], [570, 30]);
  assert.equal(t.items[4].w, undefined);
  assert.equal(t.items[5], null);
  assert.equal(doc.items[0].w, 200, 'input untouched');
  assert.equal(scaleDoc(doc, 1, 0, 0), doc);
  assert.equal(scaleDoc(doc, -2, 0, 0), doc);
  const back = scaleDoc(t, 1 / 1.5, 0, 0);
  assert.deepEqual([back.items[0].w, back.items[1].x], [200, 200]);
  // about a corner other than the origin keeps that corner put
  const c2 = scaleDoc(doc, 2, 400, 200);
  assert.deepEqual(c2.floor.points[2], [400, 200]);
});

// ---- normalizeToMain: the first photo becomes the frame, the others keep their exact place relative to it
import { normalizeToMain, photoCorners as corners4, layoutExtras as lay } from '../js/model/photos.js';
test('normalizeToMain: the first photo ends with no placement and every other photo keeps its place relative to it', () => {
  const list = [
    { width: 800, height: 600, t: { x: 40, y: 30, s: 1.25, a: 20 } },
    { width: 500, height: 700, t: { x: 900, y: -50, s: 0.8, a: 75 } },
    { width: 300, height: 300, t: { x: 0, y: 500, s: 2, a: 350 } },
  ];
  const out = normalizeToMain(list);
  assert.equal(out[0].t, undefined);
  // map the original corners into the first photo's own pixel frame by hand, then compare
  const m = list[0].t, a = (-m.a * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const into = ([x, y]) => { const dx = x - m.x, dy = y - m.y; return [(dx * c - dy * s) / m.s, (dx * s + dy * c) / m.s]; };
  for (const i of [1, 2]) {
    const want = corners4(list[i]).map(into), got = corners4(out[i]);
    want.forEach((w, k) => { assert.ok(Math.abs(w[0] - got[k][0]) < 1e-6 && Math.abs(w[1] - got[k][1]) < 1e-6, `photo ${i} corner ${k}`); });
  }
  assert.deepEqual(list[0].t, { x: 40, y: 30, s: 1.25, a: 20 }, 'input untouched');
  assert.deepEqual(normalizeToMain([]), []);
});

test('layoutExtras: a smaller gap puts photos closer, side by side', () => {
  const main = { width: 1000, height: 800 };
  const [e] = lay(main, [{ width: 500, height: 800 }], 20);
  assert.equal(e.t.x, 1020);
  assert.equal(e.t.y, 0);
});
