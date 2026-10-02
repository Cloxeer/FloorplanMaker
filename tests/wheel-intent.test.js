import test from 'node:test';
import assert from 'node:assert/strict';
import { createWheelIntent } from '../js/view/wheelIntent.js';

const ev = (dy, t, o = {}) => ({ deltaX: 0, deltaY: dy, deltaMode: 0, ctrlKey: false, metaKey: false, timeStamp: t, ...o });
const run = (list) => { const c = createWheelIntent(); return list.map((e) => c(e)); };

test('a slow two-finger drag moves the map', () => {
  assert.deepEqual(run([ev(3, 0), ev(7, 10), ev(12, 20), ev(20, 30)]), ['drag', 'drag', 'drag', 'drag']);
});

test('a fast flick (big whole numbers in a quick stream) still moves the map', () => {
  assert.deepEqual(run([ev(60, 0), ev(90, 8), ev(130, 16), ev(160, 24), ev(100, 32), ev(200, 40)]), ['drag', 'drag', 'drag', 'drag', 'drag', 'drag']);
});

test('a flick that happens to start on exactly 100 only zooms one step, then drags on', () => {
  const k = run([ev(100, 0), ev(130, 8), ev(150, 16), ev(100, 24)]);
  assert.equal(k[0], 'wheel');
  assert.deepEqual(k.slice(1), ['drag', 'drag', 'drag'].map((x, i) => (i === 2 ? 'drag' : x)));
});

test('mouse wheel notches (alone, 100 / 120) zoom, also several in a row', () => {
  assert.deepEqual(run([ev(100, 0), ev(-100, 400), ev(120, 900)]), ['wheel', 'wheel', 'wheel']);
  assert.deepEqual(run([ev(100, 0), ev(100, 40), ev(100, 80)]), ['wheel', 'wheel', 'wheel']); // spun quickly
});

test('pinch (ctrl + small deltas) zooms; ctrl + a big notch zooms; fractional or sideways deltas drag; lines mode is a wheel', () => {
  assert.deepEqual(run([ev(-4, 0, { ctrlKey: true }), ev(6, 10, { ctrlKey: true })]), ['pinch', 'pinch']);
  assert.equal(run([ev(100, 0, { ctrlKey: true })])[0], 'wheel');
  assert.equal(run([ev(7.5, 0)])[0], 'drag');
  assert.equal(run([ev(0, 0, { deltaX: 12 })])[0], 'drag');
  assert.equal(run([ev(3, 0, { deltaMode: 1 })])[0], 'wheel');
});

test('a pause ends a drag: the next lone notch zooms again', () => {
  assert.deepEqual(run([ev(5, 0), ev(9, 10), ev(100, 500)]), ['drag', 'drag', 'wheel']);
});
