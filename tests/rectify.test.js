import test from 'node:test';
import assert from 'node:assert/strict';
import { rectifyOutline, straightenOutline } from '../js/view/rectify.js';

function edges(pts) {
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
}
function isAxis([a, b]) { return a[0] === b[0] || a[1] === b[1]; }
function is45([a, b]) { return Math.abs(Math.abs(b[0] - a[0]) - Math.abs(b[1] - a[1])) <= 1; }

test('rectifyOutline straightens a jagged outline', () => {
  const jagged = [
    [0, 0], [102, 4], [98, 103], [201, 97], [198, 201], [3, 198],
  ];
  const out = rectifyOutline(jagged);
  assert.ok(out.length >= 3);
  for (let i = 0; i < out.length; i += 1) {
    const [x1, y1] = out[i];
    const [x2, y2] = out[(i + 1) % out.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    assert.ok(dx === 0 || dy === 0, `edge ${i} not axis-aligned: ${dx},${dy}`);
  }
});

test('a wobbly rectangle becomes a clean rectangle on the grid, in place (no drift)', () => {
  const out = rectifyOutline([[100, 102], [598, 97], [603, 401], [97, 398]]);
  assert.deepEqual(out, [[100, 100], [600, 100], [600, 400], [100, 400]]);
});

test('a real 45° corner wall is kept (made exactly 45°), not squared away', () => {
  const out = rectifyOutline([[100, 101], [502, 99], [601, 202], [599, 400], [100, 399]]);
  assert.equal(out.length, 5, `the corner wall was removed: ${JSON.stringify(out)}`);
  const es = edges(out);
  assert.equal(es.filter(isAxis).length, 4);
  assert.equal(es.filter((e) => !isAxis(e) && is45(e)).length, 1, 'one exact 45° wall');
});

test('an odd-angle wall (e.g. 25°) is left as drawn', () => {
  const pts = [[100, 100], [500, 100], [600, 147], [600, 400], [100, 400]];
  const out = rectifyOutline(pts);
  assert.equal(out.length, 5);
  assert.ok(out.some(([x, y]) => Math.abs(x - 500) <= 2 && Math.abs(y - 100) <= 2));
  assert.ok(out.some(([x, y]) => Math.abs(x - 600) <= 2 && Math.abs(y - 147) <= 2));
});

test('a tilted photo: walls are squared along the building\'s own lean, and it says so', () => {
  const rot = ([x, y], d) => {
    const a = (d * Math.PI) / 180;
    return [Math.round(350 + (x - 350) * Math.cos(a) - (y - 250) * Math.sin(a)), Math.round(250 + (x - 350) * Math.sin(a) + (y - 250) * Math.cos(a))];
  };
  const pts = [[100, 100], [600, 100], [600, 400], [100, 400]].map((p) => rot(p, 4));
  const { points: out, tilt } = straightenOutline(pts);
  assert.ok(Math.abs(tilt - 4) < 0.6, `lean found: ${tilt}`);
  assert.equal(out.length, 4);
  // Still a rectangle (right angles), same size, not blown up to the page axes.
  for (let i = 0; i < 4; i += 1) {
    const a = out[i]; const b = out[(i + 1) % 4]; const c = out[(i + 2) % 4];
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
    assert.ok(Math.abs(dot / len) < 0.02, 'right angle');
  }
  const side = Math.hypot(out[1][0] - out[0][0], out[1][1] - out[0][1]);
  assert.ok(Math.abs(side - 500) < 4, `long side kept its length: ${side}`);
});

test('straightening twice changes nothing more', () => {
  for (const pts of [
    [[100, 102], [598, 97], [603, 401], [97, 398]],
    [[100, 101], [502, 99], [601, 202], [599, 400], [100, 399]],
  ]) {
    const once = rectifyOutline(pts);
    assert.deepEqual(rectifyOutline(once), once);
  }
});
