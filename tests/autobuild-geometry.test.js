// autobuild-geometry.test.js
// Geometry detection on synthetic, text-free posters in several print styles:
// wall/room extraction, wall snapping, shapes, straightening, exit signs, stairs, compass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/model/autobuild/layers.js';
import { extractFaces, footprint } from '../js/model/autobuild/faces.js';
import { faceShape, alignShapes, resolveOverlaps, snapToWalls, rectOfPoly } from '../js/model/autobuild/shapes.js';
import { findExitSigns, findStairs, findCompass } from '../js/model/autobuild/symbols.js';
import { rectify } from '../js/model/autobuild/rectify.js';
import { rotateImage, homography, warp, components } from '../js/model/autobuild/raster.js';
import { poster, addExitSign, addCompass, addStair, fillRect, drawLine } from './autobuild-geometry.helpers.js';

const STYLES = {
  hairline: {}, thick: { t: 6 }, thick14: { t: 14 }, lightGrey: { wall: 150 }, veryLight: { wall: 185, t: 1 }, fainter: { wall: 222, t: 2 },
  tinted: { tint: [235, 225, 205] }, pastelBlue: { tint: [160, 180, 230] }, doubleLine: { double: 5, t: 2 },
  noisy: { noise: 14, paper: 200, wall: 60 }, glare: { glare: 0.8 }, blur: { blur: 1 }, lowRes: { W: 420, H: 320, t: 1, wall: 110, noise: 8 },
  blueprint: { paperRGB: [20, 50, 120], wallRGB: [235, 235, 250] }, cream: { paperRGB: [245, 232, 200], wall: 50 }, big: { W: 2000, H: 1520, t: 3 },
  darkPrint: { paper: 200, wall: 60, blur: 1, noise: 8 },
};

function roomFaces(p) {
  const { width: w, height: h } = p.img;
  const layers = analyze(p.img);
  const foot = footprint(layers, w, h, Math.max(w, h));
  const F = extractFaces(p.img, layers, { closeR: 1, foot });
  return { w, h, layers, foot, F };
}

const centreId = (F, w, r) => F.labels[Math.round(r.y + r.h / 2) * w + Math.round(r.x + r.w / 2)];

for (const [name, style] of Object.entries(STYLES)) {
  test(`rooms are found within 3 px of the drawn centre lines: ${name}`, () => {
    const p = poster(style);
    const { w, layers, F } = roomFaces(p);
    const g = layers.wallHalf;
    for (const r of p.rooms) {
      const f = F.faces.find((q) => q.id === centreId(F, w, r));
      assert.ok(f, 'room has a face');
      const e = Math.max(Math.abs(f.x0 - g - r.x), Math.abs(f.y0 - g - r.y), Math.abs(f.x1 + 1 + g - r.x - r.w), Math.abs(f.y1 + 1 + g - r.y - r.h));
      assert.ok(e <= 3, `edge error ${e}`);
    }
    const ids = new Set(p.rooms.map((r) => centreId(F, w, r)));
    assert.equal(ids.size, p.rooms.length, 'no two rooms merged into one face');
  });
}

test('building footprint is the drawn outline, also for an L-shaped building', () => {
  for (const lShape of [false, true]) {
    const p = poster({ lShape });
    const { w, h, foot } = roomFaces(p);
    let inside = 0, truth = 0, wrong = 0;
    const b = p.building, rowH = p.rooms[0].h;
    const inRoom = (x, y) => p.rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const gt = inRoom(x, y) || (x >= b.x0 && x < b.x1 && y >= b.y0 + rowH && y < b.y1 - rowH);
      if (gt) truth++;
      if (foot.mask[y * w + x]) { inside++; if (!gt) wrong++; }
    }
    assert.ok(wrong / truth < 0.06, `outside area claimed: ${wrong / truth}`);
    assert.ok(inside / truth > 0.9, `footprint covers ${inside / truth}`);
  }
});

test('snapToWalls pulls rooms that are a few px off back onto the wall lines; neighbours then share edges', () => {
  const p = poster({ t: 3 });
  const { w, h, layers } = roomFaces(p);
  const rects = p.rooms.map((r, i) => ({ x: r.x + ((i % 3) - 1) * 3, y: r.y + (i % 2 ? 3 : -3), w: r.w + 2, h: r.h - 2 }));
  snapToWalls(rects, layers.wallInk, w, h, 5);
  alignShapes(rects, 3);
  rects.forEach((r, i) => {
    const t = p.rooms[i];
    for (const [a, b] of [[r.x, t.x], [r.y, t.y], [r.x + r.w, t.x + t.w], [r.y + r.h, t.y + t.h]]) assert.ok(Math.abs(a - b) <= 5, `snapped edge off by ${Math.abs(a - b)}`);
  });
  // rooms 0 and 2 are neighbours in the top row: they share one exact edge
  assert.equal(rects[0].x + rects[0].w, rects[2].x);
});

test('snapToWalls leaves an edge alone when no wall is near (nothing invented)', () => {
  const p = poster({});
  const { w, h, layers } = roomFaces(p);
  const r = { x: 400, y: 350, w: 40, h: 40 };
  const before = { ...r };
  snapToWalls([r], layers.wallInk, w, h, 4);
  assert.deepEqual(r, before);
});

test('resolveOverlaps: boxy polygons become rects and a crossing is split without squashing rooms', () => {
  const a = { points: [[0, 0], [103, 0], [103, 50], [0, 50]] };
  const b = { x: 100, y: 0, w: 100, h: 50 };
  resolveOverlaps([a, b]);
  assert.ok(!a.points && a.x + a.w <= b.x);
  const big = { x: 0, y: 0, w: 200, h: 100 }, small = { x: 50, y: 20, w: 30, h: 30 };
  resolveOverlaps([big, small]);
  assert.deepEqual([big.w, small.w], [200, 30]);
  assert.equal(rectOfPoly([[0, 0], [10, 0], [10, 8], [3, 8], [0, 3]]), null);
});

const maskOf = (w, h, fn) => { const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fn(x, y)) m[y * w + x] = 1; return m; };
function faceOf(mask, w, h) {
  const { labels, comps } = components(mask, w, h, 1);
  const c = comps.sort((a, b) => b.area - a.area)[0];
  return { labels, f: { id: c.id, area: c.area, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, fill: c.area / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1)) } };
}

test('faceShape: a rectangle is a rect, an L room has 6 axis-aligned corners, an angled corner stays simple', () => {
  const w = 300, h = 300;
  let { labels, f } = faceOf(maskOf(w, h, (x, y) => x >= 50 && x < 200 && y >= 60 && y < 160), w, h);
  assert.equal(faceShape(labels, w, h, f, 0).kind, 'rect');
  ({ labels, f } = faceOf(maskOf(w, h, (x, y) => (x >= 50 && x < 200 && y >= 60 && y < 110) || (x >= 50 && x < 110 && y >= 60 && y < 200)), w, h));
  let s = faceShape(labels, w, h, f, 0);
  assert.equal(s.kind, 'poly');
  assert.equal(s.points.length, 6);
  for (let i = 0; i < 6; i++) { const p = s.points[i], q = s.points[(i + 1) % 6]; assert.ok(p[0] === q[0] || p[1] === q[1], 'edges are axis-aligned'); }
  ({ labels, f } = faceOf(maskOf(w, h, (x, y) => x >= 50 && x < 220 && y >= 60 && y < 200 && (x - 50) + (200 - y) > 100), w, h));
  s = faceShape(labels, w, h, f, 0);
  assert.ok(s.kind === 'poly' && s.points.length <= 8, `vertices ${s.points && s.points.length}`);
});

test('exit signs: red and green boxes are found, thin red strokes are not', () => {
  const p = poster({});
  addExitSign(p.img, 40, 40, 44, 28, [200, 30, 40]);
  addExitSign(p.img, 900, 40, 44, 28, [20, 150, 70]);
  drawLine(p.img, 40, 700, 100, 700, 3, [200, 30, 40]);
  const { w, h, layers } = roomFaces(p);
  const signs = findExitSigns(layers, w, h, 8);
  assert.equal(signs.length, 2);
  assert.deepEqual(signs.map((s) => s.color).sort(), ['green', 'red']);
});

test('stairs: treads drawn both ways are found', () => {
  const p = poster({});
  addStair(p.img, 460, 340, 40, 8, 5, 'v');
  addStair(p.img, 560, 340, 40, 8, 5, 'h');
  const { w, h, layers } = roomFaces(p);
  const st = findStairs(layers, w, h, 8);
  const a = st.find((s) => Math.abs(s.x - 460) < 6 && Math.abs(s.y - 340) < 6);
  const b = st.find((s) => Math.abs(s.x - 560) < 6 && Math.abs(s.y - 340) < 6);
  assert.ok(a && b, 'both blocks found');
  assert.notEqual(a.dir, b.dir, 'one per direction');
});

const angErr = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('compass: found in any corner, direction within 8 degrees', () => {
  const spots = [[60, 60], [940, 60], [60, 700], [940, 700]];
  for (const [cx, cy] of spots) {
    for (const deg of [0, 37, 135, 250]) {
      const p = poster({ W: 1000, H: 760 });
      addCompass(p.img, cx, cy, 8, deg);
      const { w, h, layers, foot } = roomFaces(p);
      const comps = components(layers.ink, w, h, 1, true).comps;
      const c = findCompass(comps, foot.mask, w, h, 8, layers.paper, layers.ink);
      assert.ok(c, `compass at ${cx},${cy} deg ${deg}`);
      assert.ok(Math.hypot(c.x - cx, c.y - cy) < 4, 'centre');
      assert.ok(angErr(c.deg, deg) <= 8, `deg ${c.deg} vs ${deg}`);
    }
  }
});

test('compass: a ring without a needle is not a compass', () => {
  const p = poster({});
  for (let t = 0; t < 400; t++) fillRect(p.img, 60 + 9 * Math.cos(t / 63.7), 60 + 9 * Math.sin(t / 63.7), 61 + 9 * Math.cos(t / 63.7), 61 + 9 * Math.sin(t / 63.7), [20, 20, 20]);
  const { w, h, layers, foot } = roomFaces(p);
  const comps = components(layers.ink, w, h, 1, true).comps;
  assert.equal(findCompass(comps, foot.mask, w, h, 8, layers.paper, layers.ink), null);
});

const residual = (r) => Math.max(...r.tilt.h.map(Math.abs), ...r.tilt.v.map(Math.abs));

test('rectify: a rotated poster is straightened (residual under 0.5 degrees)', () => {
  for (const deg of [-4, 2.5, 5]) {
    const p = poster({ t: 2 });
    const r = rectify(rotateImage(p.img, deg));
    assert.ok(r, 'plan found');
    assert.ok(residual(rectify(r.image)) < 0.5, `residual after ${deg}`);
  }
});

test('rectify: a keystoned poster comes out with parallel walls', () => {
  const p = poster({ t: 2 });
  const { width: w, height: h } = p.img;
  const H = homography([[0, 0], [w, 0], [w, h], [0, h]], [[40, 20], [w - 10, 0], [w - 60, h - 30], [0, h - 5]]);
  const r = rectify(warp(p.img, H, w, h));
  assert.ok(r, 'plan found');
  assert.ok(residual(rectify(r.image)) < 0.6, 'residual');
});
