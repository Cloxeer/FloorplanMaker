import test from 'node:test';
import assert from 'node:assert/strict';
import { rectifyOutline } from '../js/view/rectify.js';

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
