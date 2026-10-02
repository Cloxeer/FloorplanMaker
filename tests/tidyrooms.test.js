import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyRooms } from '../js/model/tidyRooms.js';
import { autoFixAll } from '../js/model/fixAuto.js';

const room = (id, x, y, w, h) => ({ id, type: 'room', shape: 'rect', x, y, w, h, name: '', number: '' });
const doc = (items) => ({ floor: { points: [[0, 0], [300, 0], [300, 200], [0, 200]] }, items });

test('tidyRooms: gaps to the wall and between rooms close, on the 5-grid', () => {
  const d = doc([room('a', 3, 2, 146, 197), room('b', 153, 0, 143, 200)]);
  const r = tidyRooms(d);
  const [a, b] = r.doc.items;
  assert.equal(a.x, 0); assert.equal(a.y, 0); assert.equal(b.x + b.w, 300); assert.equal(a.y + a.h, 200);
  assert.equal(a.x + a.w, b.x, 'neighbours share one edge');
  assert.equal(a.x % 5 + b.x % 5, 0);
});

test('tidyRooms: idempotent, no overlap created, leaves input untouched', () => {
  const d = doc([room('a', 3, 2, 146, 197), room('b', 153, 0, 143, 200)]);
  const snap = JSON.stringify(d);
  const r1 = tidyRooms(d), r2 = tidyRooms(r1.doc);
  assert.equal(JSON.stringify(d), snap);
  assert.equal(r2.count || 0, 0);
});

test('tidyRooms: items without ids and junk do not crash', () => {
  const d = doc([{ type: 'room', shape: 'rect', x: 4, y: 0, w: 100, h: 100 }, null, { type: 'compass' }]);
  const r = tidyRooms(d);
  assert.equal(r.doc.items[0].x, 0);
  assert.equal('id' in r.doc.items[0], false);
  assert.equal(tidyRooms(null).changed.length, 0);
  assert.equal(tidyRooms({ items: [] }).changed.length, 0);
});

test('tidyRooms: snapping never creates an overlap or leaves the outline', () => {
  const d = doc([room('a', 0, 0, 148, 100), room('b', 152, 0, 148, 100), room('c', 0, 104, 100, 96), room('d', 104, 104, 196, 96)]);
  const r = tidyRooms(d);
  const it = r.doc.items;
  for (let i = 0; i < it.length; i++) {
    assert.ok(it[i].x >= 0 && it[i].y >= 0 && it[i].x + it[i].w <= 300 && it[i].y + it[i].h <= 200);
    for (let j = i + 1; j < it.length; j++) {
      const o = Math.min(it[i].x + it[i].w, it[j].x + it[j].w) > Math.max(it[i].x, it[j].x) && Math.min(it[i].y + it[i].h, it[j].y + it[j].h) > Math.max(it[i].y, it[j].y);
      assert.equal(o, false);
    }
  }
});

test('autoFixAll ends with a gap-closing step', () => {
  const r = autoFixAll(doc([room('a', 3, 2, 146, 197), room('b', 153, 0, 143, 200)]));
  assert.ok(r.applied.some((x) => x.kind === 'tidy'));
});

test('tidyRooms: a tilted, jagged polygon room is straightened to square edges', () => {
  const jag = { id: 'j', type: 'room', shape: 'poly', number: 'R206', name: '', points: [[100, 30], [220, 10], [225, 120], [175, 120], [175, 215], [105, 215], [115, 120], [105, 120]] };
  const r = tidyRooms({ floor: { points: [[90, 0], [300, 0], [300, 300], [90, 300]] }, items: [jag] });
  const pts = r.doc.items[0].points;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    assert.ok(a[0] === b[0] || a[1] === b[1], 'every edge is horizontal or vertical');
    assert.equal(a[0] % 5 + a[1] % 5, 0);
  }
});
