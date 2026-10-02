import test from 'node:test';
import assert from 'node:assert/strict';
import { hallLabels } from '../js/model/hallLabels.js';
import { exportSvg } from '../js/model/svgExport.js';
import { createDoc } from '../js/model/document.js';

const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: '101', name: '', label: { pinned: false, x: null, y: null, fontSize: null } });

test('a knot of small touching pieces gets ONE label, inside the hallway', () => {
  const items = [hall('a', 100, 100, 60, 40), hall('b', 160, 100, 50, 40), hall('c', 100, 140, 60, 40), hall('d', 160, 140, 50, 40), hall('e', 120, 180, 60, 40)];
  const l = hallLabels(items);
  assert.equal(l.length, 1);
  assert.ok(l[0].x >= 100 && l[0].x <= 210 && l[0].y >= 100 && l[0].y <= 220);
});

test('a narrow vertical corridor gets a vertical label; a wide one a horizontal one', () => {
  const v = hallLabels([hall('v', 100, 0, 30, 500)]);
  assert.equal(v.length >= 1 && v.every((x) => x.vertical), true);
  const h = hallLabels([hall('h', 0, 100, 500, 40)]);
  assert.equal(h.length >= 1 && h.every((x) => !x.vertical), true);
});

test('an L-shaped network gets at most three labels, and a long one is not labelled per piece', () => {
  const items = [];
  for (let i = 0; i < 12; i++) items.push(hall('p' + i, i * 100, 0, 100, 50)); // twelve pieces in a row
  for (let i = 0; i < 8; i++) items.push(hall('q' + i, 1100, 50 + i * 100, 50, 100)); // and an arm down
  const l = hallLabels(items);
  assert.ok(l.length >= 1 && l.length <= 3, `labels: ${l.length}`);
});

test('labels keep off EXIT / door labels, rooms and padlocks', () => {
  const items = [hall('h', 0, 100, 600, 60), { id: 'd', type: 'door', x1: 280, y1: 100, x2: 330, y2: 100, label: { x: 300, y: 130 } }, room('r', 400, 100, 100, 60), { id: 'w', type: 'authwall', x1: 100, y1: 100, x2: 100, y2: 160 }];
  for (const l of hallLabels(items)) {
    assert.ok(Math.abs(l.x - 300) > 54 || Math.abs(l.y - 130) > 24, 'on the EXIT label');
    assert.ok(l.x + 42 < 400 || l.x - 42 > 500, 'inside the room');
    assert.ok(Math.abs(l.x - 100) > 60, 'on the padlock');
  }
});

test('bad input never throws', () => {
  assert.deepEqual(hallLabels(null), []);
  assert.deepEqual(hallLabels([null, { type: 'hall' }, hall('n', NaN, 0, 10, 10), hall('z', 0, 0, 0, 5)]), []);
});

test('export: one Hallway word per stretch, vertical ones carry a rotation', () => {
  const doc = createDoc({ building: 'T', property: '1', floor: 1, slug: 't-1' }, { x: 0, y: 0, w: 1000, h: 1000 });
  doc.items.push(hall('a', 0, 0, 40, 30), hall('b', 40, 0, 40, 30), hall('c', 80, 0, 40, 30), hall('d', 120, 0, 40, 30), hall('v', 300, 0, 30, 500));
  const svg = exportSvg(doc);
  const n = (svg.match(/class="hall-lbl"/g) || []).length;
  assert.ok(n >= 1 && n <= 3, `labels ${n}`);
  assert.ok(/class="hall-lbl" transform="rotate\(-90/.test(svg));
});
