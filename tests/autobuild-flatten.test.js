// autobuild-flatten.test.js
// flatten.js: applyAxes (tilt / turn / roll re-projection) and estimateAxes (wall lines -> correction).

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAxes, axesHomography, estimateAxes } from '../js/model/autobuild/flatten.js';
import { makeImage, homography, warp, toGray } from '../js/model/autobuild/raster.js';
import { poster, drawLine } from './autobuild-geometry.helpers.js';

const RAD = Math.PI / 180;

function grid(W = 1000, H = 760, step = 100, t = 3) {
  const img = makeImage(W, H, 255);
  for (let x = step / 2; x < W; x += step) drawLine(img, x, 0, x, H - 1, t, [20, 20, 20]);
  for (let y = step / 2; y < H; y += step) drawLine(img, 0, y, W - 1, y, t, [20, 20, 20]);
  return img;
}

// Independent camera simulation: rays (x, y, f) rotated by tilt, then turn, then roll, projected;
// the four corners define the homography, applied with warp().
function camShot(img, tilt, turn, roll) {
  const W = img.width, H = img.height, f = 1.2 * Math.max(W, H), cx = (W - 1) / 2, cy = (H - 1) / 2;
  const t = tilt * RAD, u = turn * RAD, r = roll * RAD;
  const proj = (x, y) => {
    const y1 = y * Math.cos(t) + f * Math.sin(t), z1 = -y * Math.sin(t) + f * Math.cos(t);
    const x1 = x * Math.cos(u) - z1 * Math.sin(u), z2 = x * Math.sin(u) + z1 * Math.cos(u);
    const X = (f * x1) / z2, Y = (f * y1) / z2;
    return [X * Math.cos(r) - Y * Math.sin(r) + cx, X * Math.sin(r) + Y * Math.cos(r) + cy];
  };
  const c = [[-cx, -cy], [cx, -cy], [cx, cy], [-cx, cy]];
  return warp(img, homography(c.map(([x, y]) => [x + cx, y + cy]), c.map(([x, y]) => proj(x, y))), W, H);
}

// Mean tilt (deg) of the horizontal ('h') or vertical ('v') lines: projection-sharpness in the middle 70%.
function lineTilt(img, kind) {
  const { width: w, height: h } = img, g = toGray(img);
  const pts = [];
  for (let y = Math.round(h * 0.15); y < h * 0.85; y++) for (let x = Math.round(w * 0.15); x < w * 0.85; x++) if (g[y * w + x] < 100) pts.push(x - w / 2, y - h / 2);
  let best = 0, bs = -1;
  const hist = new Float32Array(Math.ceil(2 * Math.hypot(w, h)));
  for (let a = -6; a <= 6; a += 0.05) {
    const s = Math.sin(a * RAD), c = Math.cos(a * RAD);
    hist.fill(0);
    for (let i = 0; i < pts.length; i += 2) hist[((kind === 'h' ? -pts[i] * s + pts[i + 1] * c : pts[i] * c - pts[i + 1] * s) + hist.length / 2) | 0]++;
    let sc = 0;
    for (const v of hist) sc += v * v;
    if (sc > bs) { bs = sc; best = a; }
  }
  return best;
}

// width of the non-white region on a given row / height on a given column
const span = (img, y) => {
  let a = -1, b = -1;
  for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4] < 128) { if (a < 0) a = x; b = x; }
  return a < 0 ? 0 : b - a;
};
const colSpan = (img, x) => {
  let a = -1, b = -1;
  for (let y = 0; y < img.height; y++) if (img.data[(y * img.width + x) * 4] < 128) { if (a < 0) a = y; b = y; }
  return a < 0 ? 0 : b - a;
};

test('identity returns an equal image', () => {
  const g = grid();
  const o = applyAxes(g, { tilt: 0, turn: 0, roll: 0 });
  assert.equal(o.width, g.width); assert.equal(o.height, g.height);
  assert.deepEqual(o.data, g.data);
  assert.notEqual(o.data, g.data);
  assert.deepEqual(applyAxes(g).data, g.data);
});

test('round trip restores the grid (central region)', () => {
  const g = grid();
  for (const a of [{ tilt: 12 }, { turn: -10 }, { roll: 5 }]) {
    const neg = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, -v]));
    const back = applyAxes(applyAxes(g, a, { crop: 'same' }), neg, { crop: 'same' });
    let bad = 0, n = 0;
    for (let y = 190; y < 570; y++) for (let x = 250; x < 750; x++) { n++; if (Math.abs(back.data[(y * 1000 + x) * 4] - g.data[(y * 1000 + x) * 4]) > 110) bad++; }
    assert.ok(bad / n < 0.03, `${JSON.stringify(a)} differing pixels ${(bad / n).toFixed(3)}`);
  }
});

test('each axis moves the lines in the documented direction', () => {
  const black = makeImage(800, 600, 0);
  const t = applyAxes(black, { tilt: 15 }, { crop: 'bbox' });
  assert.ok(span(t, 3) < span(t, t.height - 4) - 20, 'tilt>0: top narrower');
  const t2 = applyAxes(black, { tilt: -15 }, { crop: 'bbox' });
  assert.ok(span(t2, 3) > span(t2, t2.height - 4) + 20, 'tilt<0: top wider');
  const u = applyAxes(black, { turn: 15 }, { crop: 'bbox' });
  assert.ok(colSpan(u, u.width - 4) < colSpan(u, 3) - 20, 'turn>0: right side shorter');
  const r = applyAxes(grid(), { roll: 5 }, { crop: 'same' });
  assert.ok(Math.abs(lineTilt(r, 'h') - 5) < 0.3, 'roll>0 is clockwise (+5 deg)');
});

test('estimateAxes recovers a single known distortion on a wall grid', () => {
  const g = grid();
  for (const [ti, tu, ro] of [[8, 0, 0], [-9, 0, 0], [0, 8, 0], [0, -10, 0], [0, 0, 3]]) {
    const e = estimateAxes(camShot(g, ti, tu, ro));
    assert.ok(Math.abs(e.tilt + ti) < 0.7 && Math.abs(e.turn + tu) < 0.7 && Math.abs(e.roll + ro) < 0.7, `${[ti, tu, ro]} -> ${e.tilt.toFixed(2)},${e.turn.toFixed(2)},${e.roll.toFixed(2)}`);
    assert.ok(e.confidence > 0.5);
  }
});

test('the estimated correction makes horizontal and vertical lines parallel to the axes (<0.5 deg)', () => {
  const sources = [grid(), poster({ W: 1000, H: 760 }).img];
  for (const src of sources) {
    for (const [ti, tu, ro] of [[10, 0, 2], [-8, 7, -2], [6, -9, 3], [0, 12, 0], [12, 10, -4]]) {
      const d = camShot(src, ti, tu, ro);
      const e = estimateAxes(d);
      assert.ok(e.confidence > 0.4, `confidence ${e.confidence}`);
      const fixed = applyAxes(d, e, { crop: 'same' });
      const h = lineTilt(fixed, 'h'), v = lineTilt(fixed, 'v');
      assert.ok(Math.abs(h) < 0.5 && Math.abs(v) < 0.5, `${[ti, tu, ro]}: residual h ${h.toFixed(2)} v ${v.toFixed(2)}`);
      assert.ok(Math.max(Math.abs(e.tilt), Math.abs(e.turn), Math.abs(e.roll)) > 1.5, 'was clearly distorted');
    }
  }
});

test('estimateAxes: flat image gives ~zero; blank / tiny images give zero with no confidence', () => {
  const e = estimateAxes(grid());
  assert.ok(Math.abs(e.tilt) < 0.3 && Math.abs(e.turn) < 0.3 && Math.abs(e.roll) < 0.3);
  for (const img of [makeImage(400, 300, 255), makeImage(2, 2, 255), makeImage(1, 1, 0), null, undefined]) {
    const z = estimateAxes(img);
    assert.deepEqual([z.tilt, z.turn, z.roll], [0, 0, 0]);
    assert.ok(z.confidence < 0.2);
  }
  const s = estimateAxes(camShot(grid(), 40, 0, 0));
  assert.ok(Math.abs(s.tilt) <= 35 && Math.abs(s.turn) <= 35 && Math.abs(s.roll) <= 15, 'clamped to slider ranges');
});

test('inside crop leaves no white border pixels', () => {
  const black = makeImage(900, 700, 0);
  for (const a of [{ tilt: 10 }, { turn: -12 }, { roll: 4 }, { tilt: 8, turn: 8, roll: -3 }, { tilt: -15, turn: 5 }]) {
    const o = applyAxes(black, a);
    for (let x = 0; x < o.width; x++) for (const y of [0, o.height - 1]) assert.ok(o.data[(y * o.width + x) * 4] < 40, `${JSON.stringify(a)} edge (${x},${y})`);
    for (let y = 0; y < o.height; y++) for (const x of [0, o.width - 1]) assert.ok(o.data[(y * o.width + x) * 4] < 40, `${JSON.stringify(a)} edge (${x},${y})`);
    assert.ok(o.width >= 0.6 * 900 - 1 && o.height >= 0.6 * 700 - 1);
  }
});

test('sizes: crop modes, never below 60%, maxSide cap', () => {
  const a = { tilt: 20, turn: 15, roll: 6 };
  const inside = axesHomography(1000, 800, a), bbox = axesHomography(1000, 800, a, { crop: 'bbox' }), same = axesHomography(1000, 800, a, { crop: 'same' });
  assert.deepEqual([same.outW, same.outH], [1000, 800]);
  assert.ok(bbox.outW > inside.outW && bbox.outH > inside.outH);
  assert.ok(inside.outW >= 599 && inside.outH >= 479);
  const extreme = axesHomography(1000, 800, { tilt: 45, turn: 45, roll: 30 });
  assert.ok(extreme.outW >= 599 && extreme.outH >= 479);
  const big = applyAxes(makeImage(3000, 2000, 10), { tilt: 5 });
  assert.ok(Math.max(big.width, big.height) <= 2400);
  const capped = applyAxes(makeImage(800, 600, 10), { tilt: 5, roll: 2 }, { maxSide: 300 });
  assert.ok(Math.max(capped.width, capped.height) <= 300 && capped.width >= 250);
  const idc = applyAxes(makeImage(800, 600, 10), {}, { maxSide: 400 });
  assert.equal(idc.width, 400); assert.equal(idc.height, 300);
  const M = axesHomography(1000, 800, { tilt: 5 });
  assert.equal(M.H.length, 9);
  assert.ok(M.H.every(Number.isFinite));
});

test('non-square and tiny images do not throw', () => {
  for (const [w, h] of [[1200, 300], [300, 1200], [1, 1], [2, 2], [1, 5], [3, 2], [7, 1]]) {
    const img = makeImage(w, h, 128);
    for (const a of [{}, { tilt: 10 }, { turn: -10, roll: 3 }]) {
      for (const crop of ['inside', 'bbox', 'same']) {
        const o = applyAxes(img, a, { crop });
        assert.ok(o.width >= 1 && o.height >= 1 && o.data.length === o.width * o.height * 4, `${w}x${h}`);
      }
    }
    estimateAxes(img);
  }
  const wide = applyAxes(grid(1200, 300, 60), { tilt: 10, turn: 10 });
  assert.ok(wide.width > wide.height * 2.5 && wide.width <= 1200);
});

test('NaN / undefined / huge angles are safe and clamped', () => {
  const g = grid(400, 300);
  assert.deepEqual(applyAxes(g, { tilt: NaN, turn: undefined, roll: 'x' }).data, g.data);
  assert.deepEqual(applyAxes(g, { tilt: Infinity }).data, applyAxes(g, { tilt: 45 }).data);
  assert.deepEqual(applyAxes(g, { turn: -1e9, roll: 1e9 }).data, applyAxes(g, { turn: -45, roll: 30 }).data);
  assert.ok(axesHomography(NaN, undefined, null).outW >= 1);
  assert.equal(applyAxes(g, null).width, 400);
});

test('speed: 1000x1000 preview under 120 ms', () => {
  const img = makeImage(1000, 1000, 200);
  applyAxes(img, { tilt: 5, turn: 5, roll: 1 });
  let best = Infinity;
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); applyAxes(img, { tilt: 12 - i, turn: -7, roll: 2 }); best = Math.min(best, performance.now() - t0); }
  assert.ok(best < 120, `best ${best.toFixed(0)} ms`);
});
