// tests/floor-rule.test.js: a room number starts with its floor (js/model/autobuild/floorRule.js + validate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorLead, wrongFloor, fixForFloor } from '../js/model/autobuild/floorRule.js';
import { validate } from '../js/model/validate.js';
import { createDoc, addItem, makeRoom, setFloor } from '../js/model/document.js';

test('floorLead', () => {
  assert.equal(floorLead(3), '3'); assert.equal(floorLead('2'), '2'); assert.equal(floorLead(12), '12'); assert.equal(floorLead(''), ''); assert.equal(floorLead(0), '');
});
test('a 131 on floor 3 is wrong; W289 on floor 2 and 132E / R100A on floor 1 are fine; stair labels and short numbers are exempt', () => {
  assert.equal(wrongFloor('131', '3').wrong, true);
  assert.equal(wrongFloor('W289', '2').wrong, false);
  assert.equal(wrongFloor('132E', '1').wrong, false);
  assert.equal(wrongFloor('R100A', '1').wrong, false);
  assert.equal(wrongFloor('ST1', '3').wrong, false);
  assert.equal(wrongFloor('12', '3').wrong, false);
  assert.equal(wrongFloor('W190', '3').wrong, true);
});
test('fixForFloor: another reading of the room wins, else the digit is replaced, else blank when taken', () => {
  assert.deepEqual(fixForFloor('131', [{ val: '131' }, { val: '331' }], '3'), { number: '331', from: '131' });
  assert.deepEqual(fixForFloor('131', [], '3'), { number: '331', from: '131' });
  assert.deepEqual(fixForFloor('W190', [], '3'), { number: 'W390', from: 'W190' });
  assert.deepEqual(fixForFloor('131', [], '3', new Set(['331'])), { number: '', from: '131' });
  assert.deepEqual(fixForFloor('331', [], '3'), { number: '331', from: '' });
});
test('validate warns about a number from another floor', () => {
  let d = createDoc({ building: 'B', property: '1', floor: '3', slug: 'b-3' }, { x: 0, y: 0, w: 500, h: 500 });
  d = setFloor(d, [[0, 0], [400, 0], [400, 400], [0, 400]]);
  d = addItem(d, makeRoom('room', 10, 10, 100, 100, '131'));
  d = addItem(d, makeRoom('room', 150, 10, 100, 100, '331'));
  const w = validate(d).filter((v) => v.code === 'number-wrong-floor');
  assert.equal(w.length, 1);
  assert.match(w[0].message, /131/);
});
