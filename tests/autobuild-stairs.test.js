// autobuild-stairs.test.js
// Stair detection on synthetic plans: 3..12 treads, tiny to large, faint, bold, both
// directions, boxed or bare, at several scales; and lookalikes that must not be stairs
// (text lines, a column of door ticks, an empty room, a lone wall pair).

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/model/autobuild/layers.js';
import { findStairs } from '../js/model/autobuild/symbols.js';
import { makeImage } from '../js/model/autobuild/raster.js';
import { fillRect, strokeRect, drawLine } from './autobuild-geometry.helpers.js';

// stair: `n` treads of length `len`, `gap` apart, `t` thick. dir 'v' = horizontal treads stacked down y
function stairAt(img, x, y, n, len, gap, t, dir, gray = 25, box = false) {
  const rgb = [gray, gray, gray];
  for (let k = 0; k < n; k++) {
    if (dir === 'v') fillRect(img, x, y + k * gap, x + len, y + k * gap + t, rgb);
    else fillRect(img, x + k * gap, y, x + k * gap + t, y + len, rgb);
  }
  if (box) {
    const span = (n - 1) * gap + t;
    if (dir === 'v') strokeRect(img, x - 3, y - 3, x + len + 3, y + span + 3, Math.max(1, t), rgb);
    else strokeRect(img, x - 3, y - 3, x + span + 3, y + len + 3, Math.max(1, t), rgb);
  }
}

const paper = (w = 320, h = 240) => { const img = makeImage(w, h, 255); fillRect(img, 0, 0, w, h, [255, 255, 255]); return img; };
const run = (img, textH) => findStairs(analyze(img), img.width, img.height, textH);
const near = (s, x, y, tol = 6) => Math.abs(s.x - x) <= tol && Math.abs(s.y - y) <= tol;

for (const dir of ['v', 'h']) {
  for (const n of [3, 4, 5, 6, 8, 12]) {
    test(`stair: ${n} treads, direction ${dir}`, () => {
      const img = paper();
      stairAt(img, 140, 90, n, 30, 6, 1, dir);
      const st = run(img, 8);
      const s = st.find((q) => near(q, 140, 90));
      assert.ok(s, `found (${JSON.stringify(st)})`);
      assert.equal(s.dir, dir);
      assert.equal(st.length, 1);
    });
  }
}

test('stair: dir is v for horizontal treads stacked down y, with a sane box', () => {
  const img = paper();
  stairAt(img, 100, 60, 6, 36, 7, 1, 'v');
  const [s] = run(img, 8);
  assert.equal(s.dir, 'v');
  assert.ok(Math.abs(s.w - 36) <= 4 && Math.abs(s.h - 36) <= 5, `box ${s.w}x${s.h}`);
});

test('stair: faint grey, bold, and boxed treads', () => {
  for (const [gray, t, box] of [[170, 1, false], [190, 2, true], [30, 3, false], [60, 4, true], [30, 1, true]]) {
    const img = paper();
    stairAt(img, 140, 90, 6, 34, 8, t, 'v', gray, box);
    const st = run(img, 8);
    assert.ok(st.some((q) => near(q, 140, 90, 8)), `gray ${gray} t ${t} box ${box}: ${JSON.stringify(st)}`);
  }
});

test('stair: tread lengths short and long', () => {
  for (const len of [14, 24, 60, 70]) {
    const img = paper(360, 260);
    stairAt(img, 100, 90, 5, len, 6, 1, 'v');
    const st = run(img, 8);
    assert.ok(st.some((q) => near(q, 100, 90)), `len ${len}: ${JSON.stringify(st)}`);
  }
});

test('stair: scale free (half size, double size, triple size)', () => {
  for (const sc of [0.75, 1, 2, 3]) {
    for (const dir of ['v', 'h']) {
      const img = paper(Math.round(320 * sc), Math.round(240 * sc));
      const t = Math.max(1, Math.round(sc));
      stairAt(img, Math.round(140 * sc), Math.round(90 * sc), 6, Math.round(30 * sc), Math.round(7 * sc), t, dir);
      const st = run(img, Math.round(8 * sc));
      assert.ok(st.some((q) => q.dir === dir && near(q, 140 * sc, 90 * sc, 6 * sc)), `scale ${sc} ${dir}: ${JSON.stringify(st)}`);
    }
  }
});

test('stair: tiny low-res flight (5 treads 3 px apart, text 6 px)', () => {
  const img = paper(200, 160);
  stairAt(img, 80, 60, 6, 12, 3, 1, 'v');
  const st = run(img, 6);
  assert.ok(st.some((q) => near(q, 80, 60, 4)), JSON.stringify(st));
});

test('stair: a treads broken by a handrail line are one stair', () => {
  const img = paper();
  stairAt(img, 140, 90, 7, 40, 6, 1, 'v');
  fillRect(img, 159, 88, 161, 135, [255, 255, 255]); // handrail gap through the middle
  const st = run(img, 8);
  assert.ok(st.some((q) => near(q, 140, 90, 6)), JSON.stringify(st));
});

test('stair: an arrow drawn along the stair does not hide it', () => {
  const img = paper();
  stairAt(img, 140, 90, 6, 36, 7, 1, 'v');
  drawLine(img, 158, 86, 158, 132, 1, [25, 25, 25]);
  drawLine(img, 154, 94, 158, 86, 1, [25, 25, 25]);
  drawLine(img, 162, 94, 158, 86, 1, [25, 25, 25]);
  const st = run(img, 8);
  assert.ok(st.some((q) => near(q, 140, 90, 8)), JSON.stringify(st));
});

test('stair: two half-flights side by side are one stair', () => {
  const img = paper();
  stairAt(img, 100, 90, 5, 24, 6, 1, 'v');
  stairAt(img, 130, 90, 5, 24, 6, 1, 'v');
  const st = run(img, 8);
  assert.equal(st.length, 1, JSON.stringify(st));
  assert.ok(st[0].w >= 50);
});

// ---- lookalikes -------------------------------------------------------------------------

// a text-like row: small blocks with strokes of letter size, 'E', 'H', '8' shapes
function textRow(img, x, y, str, h = 8) {
  const w = Math.round(h * 0.6), rgb = [30, 30, 30];
  let cx = x;
  for (const ch of str) {
    if ('E8SBF'.includes(ch)) for (const dy of [0, Math.round(h / 2), h - 1]) fillRect(img, cx, y + dy, cx + w, y + dy + 1, rgb);
    if ('EFBH8'.includes(ch)) fillRect(img, cx, y, cx + 1, y + h, rgb);
    if ('H8B'.includes(ch)) fillRect(img, cx + w - 1, y, cx + w, y + h, rgb);
    if (ch === 'T') { fillRect(img, cx, y, cx + w, y + 1, rgb); fillRect(img, cx + w / 2, y, cx + w / 2 + 1, y + h, rgb); }
    if (ch === 'I') fillRect(img, cx + 2, y, cx + 3, y + h, rgb);
    cx += w + 3;
  }
}

test('not a stair: lines of text and numbers', () => {
  const img = paper(360, 260);
  for (let r = 0; r < 5; r++) textRow(img, 40, 40 + r * 14, ['EHTB8', 'TEHIS', '8E8EH', 'HHIIE', 'BTEFT'][r].repeat(3));
  assert.deepEqual(run(img, 8), []);
});

test('not a stair: a column of door ticks and a wall with tick marks', () => {
  const img = paper();
  drawLine(img, 100, 40, 100, 200, 1, [25, 25, 25]);
  for (let k = 0; k < 10; k++) drawLine(img, 100, 50 + k * 14, 106, 50 + k * 14, 1, [25, 25, 25]); // ticks, 6 px
  assert.deepEqual(run(img, 8), []);
});

test('not a stair: an empty room, a wall pair and a long ruler', () => {
  const img = paper(400, 300);
  strokeRect(img, 40, 40, 200, 160, 2, [25, 25, 25]);
  drawLine(img, 230, 60, 230, 200, 2, [25, 25, 25]);
  drawLine(img, 236, 60, 236, 200, 2, [25, 25, 25]);
  for (let k = 0; k < 4; k++) drawLine(img, 40, 200 + k * 10, 380, 200 + k * 10, 1, [25, 25, 25]); // long lines
  assert.deepEqual(run(img, 8), []);
});

test('not a stair: nothing outside the paper (textured wall behind the poster)', () => {
  const img = paper(300, 200);
  fillRect(img, 220, 0, 300, 200, [120, 100, 80]);
  for (let k = 0; k < 12; k++) fillRect(img, 230, 20 + k * 6, 262, 21 + k * 6, [60, 50, 40]);
  assert.deepEqual(run(img, 8), []);
});
