// outlinetidy.test.js: taking corners and walls out of the building outline (js/model/outlineTidy.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyRing, removeVertices, removeEdge } from '../js/model/outlineTidy.js';

// a building with a notch (a jog) cut into its left wall: the mistake that has to go
//   (0,0) .. (100,0) .. (100,300) .. (0,300) .. up the left wall with the notch between y = 100 and y = 200
const NOTCH = [[0, 0], [100, 0], [100, 300], [0, 300], [0, 200], [50, 200], [50, 100], [0, 100]];
const area = (p) => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;

test('tidyRing: repeated corners and spikes go; straight breaks stay', () => {
  assert.deepEqual(tidyRing([[0, 0], [0, 0], [100, 0], [100, 100], [0, 100]]), [[0, 0], [100, 0], [100, 100], [0, 100]]);
  assert.deepEqual(tidyRing([[0, 0], [100, 0], [150, 0], [100, 0], [100, 100], [0, 100]]), [[0, 0], [100, 0], [100, 100], [0, 100]], 'a spike out and back');
  assert.equal(tidyRing([[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]]).length, 5, 'a break on a straight wall is kept');
});

test('removing one inner corner of a notch fills the notch in, with square corners', () => {
  for (const inner of [5, 6]) {
    const r = removeVertices(NOTCH, [inner]);
    assert.ok(r, `corner ${inner}`);
    assert.equal(area(r), 100 * 300, 'the notch is gone: the building is the whole rectangle');
    assert.ok(r.every((p, i) => { const q = r[(i + 1) % r.length]; return p[0] === q[0] || p[1] === q[1]; }), 'no slanted wall');
  }
});

test('removing the notch\'s back wall (an edge) fills it too; removing its end wall squares it off', () => {
  const back = removeEdge(NOTCH, 5); // (50,200) -> (50,100)
  assert.equal(area(back), 100 * 300);
  assert.equal(back.length, 4);
  const end = removeEdge(NOTCH, 4); // (0,200) -> (50,200): the lower end wall of the notch
  assert.ok(end && end.every((p, i) => { const q = end[(i + 1) % end.length]; return p[0] === q[0] || p[1] === q[1]; }), 'still square');
  assert.ok(area(end) > area(NOTCH) - 1e-9 || area(end) < 100 * 300 + 1e-9);
});

test('removing the four corners of the notch\'s jog squares the wall; two corners that are one point merge', () => {
  const four = removeVertices(NOTCH, [4, 5, 6, 7]);
  assert.deepEqual(four, [[0, 0], [100, 0], [100, 300], [0, 300]]);
  const dup = removeVertices([[0, 0], [100, 0], [100, 100], [100, 100], [0, 100]], [3]);
  assert.equal(dup.length, 4);
});

test('a plain corner of a box cannot go (it would be a triangle only if square corners fail): it goes straight across', () => {
  const r = removeVertices([[0, 0], [100, 0], [100, 100], [0, 100]], [2]);
  assert.equal(r.length, 3);
});

test('angled walls are left alone: the neighbours are simply joined; fewer than 3 corners left is refused', () => {
  const tri = [[0, 0], [100, 0], [120, 60], [100, 100], [0, 100]];
  const r = removeVertices(tri, [2]);
  assert.deepEqual(r, [[0, 0], [100, 0], [100, 100], [0, 100]]);
  assert.equal(removeVertices([[0, 0], [100, 0], [0, 100]], [1]), null);
});

test('a wall that wraps round the start of the list works too', () => {
  const r = removeEdge(NOTCH, 7); // (0,100) -> (0,0) wraps
  assert.ok(r && r.length >= 4);
});
