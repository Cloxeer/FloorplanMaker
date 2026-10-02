import test from 'node:test';
import assert from 'node:assert/strict';
import { createWheelIntent, zoomFactor, createZoomSmoother } from '../js/view/wheelIntent.js';

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
  assert.equal(run([ev(100, 0, { ctrlKey: true })])[0], 'pinch'); // ctrl + scroll is one continuous zoom
  assert.equal(run([ev(7.5, 0)])[0], 'drag');
  assert.equal(run([ev(0, 0, { deltaX: 12 })])[0], 'drag');
  assert.equal(run([ev(3, 0, { deltaMode: 1 })])[0], 'wheel');
});

test('a pause ends a drag: the next lone notch zooms again', () => {
  assert.deepEqual(run([ev(5, 0), ev(9, 10), ev(100, 500)]), ['drag', 'drag', 'wheel']);
});

test('zoomFactor: continuous and capped for pinch / ctrl+scroll; a wheel notch is a fixed 10% step', () => {
  const f = (dy, kind, o = {}) => zoomFactor({ deltaY: dy, deltaMode: 0, ...o }, kind);
  assert.ok(f(-4, 'pinch') > 1 && f(4, 'pinch') < 1);
  assert.ok(f(-2, 'pinch') < f(-4, 'pinch') && f(-4, 'pinch') < f(-8, 'pinch'), 'bigger delta, bigger step');
  assert.equal(f(-30, 'pinch'), f(-500, 'pinch'), 'one huge event never jumps past the cap');
  assert.ok(Math.abs(f(-500, 'pinch') * f(500, 'pinch') - 1) < 1e-9, 'in and out cancel');
  assert.ok(Math.abs(f(-100, 'wheel') - 1.1) < 1e-9);
  assert.ok(Math.abs(f(-120, 'wheel') - 1.1 ** 1.2) < 1e-9);
  assert.ok(f(-100, 'wheel', { deltaMode: 1 }) > 1.1, 'lines mode counts for more');
});

test('zoom smoother: glides toward the target over several frames, merges a burst, never overshoots', () => {
  let z = 1, frames = [], seen = [];
  const raf = (fn) => { frames.push(fn); return frames.length; };
  const sm = createZoomSmoother({ min: 0.1, max: 8, get: () => z, set: (v) => { z = v; seen.push(v); }, raf, caf: () => { frames = []; } });
  for (let i = 0; i < 10; i++) sm.push(1.1, 5, 5); // a burst of ten events in one frame
  assert.ok(Math.abs(sm.target() - 1.1 ** 10) < 1e-9);
  let n = 0;
  while (frames.length && n++ < 200) { const fn = frames.shift(); fn(); }
  assert.ok(seen.length >= 5, `eased over ${seen.length} frames`);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'monotonic: no spike back');
  assert.ok(Math.max(...seen) <= 1.1 ** 10 + 1e-9, 'no overshoot');
  assert.ok(Math.abs(z - 1.1 ** 10) < 1e-9, 'lands exactly on the target');
  assert.equal(sm.active(), false);
  // clamps to the limits
  sm.push(100, 0, 0); n = 0; while (frames.length && n++ < 200) frames.shift()();
  assert.equal(z, 8);
  sm.push(1e-9, 0, 0); n = 0; while (frames.length && n++ < 200) frames.shift()();
  assert.equal(z, 0.1);
  // cancel stops it
  sm.push(2, 0, 0); sm.cancel(); assert.equal(sm.active(), false);
});
