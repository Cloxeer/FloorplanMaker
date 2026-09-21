// tests/stress.test.js
// Perf smoke tests on a 300-room doc: validate(), exportSvg(), importSvg(),
// and simulated magnetSnap pointer moves. Depends on: node:test, node:assert,
// js/model/*.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc, setFloor, addItem, makeRoom, roomPolygon } from '../js/model/document.js';
import { validate } from '../js/model/validate.js';
import { exportSvg } from '../js/model/svgExport.js';
import { importSvg } from '../js/model/svgImport.js';
import { magnetSnap } from '../js/model/geometry.js';

function build300RoomDoc() {
  const meta = { building: 'Stress Test Building', property: '999', floor: 1, slug: 'stress' };
  const vb = { x: 0, y: 0, w: 1500, h: 2000 };
  let doc = createDoc(meta, vb);
  doc = setFloor(doc, [[0, 0], [1500, 0], [1500, 2000], [0, 2000]]);

  const cols = 30;
  const rows = 10;
  const cellW = 1500 / cols;
  const cellH = 2000 / rows;
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      n++;
      const room = makeRoom('room', c * cellW + 5, r * cellH + 5, cellW - 10, cellH - 10, String(100 + n));
      doc = addItem(doc, { ...room, id: `r${n}` });
    }
  }
  return doc;
}

function collectSnapTargets(doc) {
  const xs = [];
  const ys = [];
  const vertices = [];
  for (const item of doc.items) {
    if (item.type !== 'room') continue;
    const poly = roomPolygon(item);
    for (const [x, y] of poly) {
      xs.push(x);
      ys.push(y);
      vertices.push([x, y]);
    }
  }
  return { xs, ys, vertices, grid: 5 };
}

test('build 300-room doc', () => {
  const doc = build300RoomDoc();
  const rooms = doc.items.filter((i) => i.type === 'room');
  assert.equal(rooms.length, 300);
});

test('perf: validate() on 300 rooms', () => {
  const doc = build300RoomDoc();
  const start = performance.now();
  const probs = validate(doc);
  const ms = performance.now() - start;
  console.log(`  validate(300 rooms) took ${ms.toFixed(1)}ms`);
  assert.ok(Array.isArray(probs));
  assert.ok(ms < 5000, `validate took ${ms.toFixed(1)}ms`);
});

test('perf: exportSvg() on 300 rooms', () => {
  const doc = build300RoomDoc();
  const start = performance.now();
  const svg = exportSvg(doc);
  const ms = performance.now() - start;
  console.log(`  exportSvg(300 rooms) took ${ms.toFixed(1)}ms`);
  assert.ok(svg.includes('<svg'));
  assert.ok(ms < 5000, `exportSvg took ${ms.toFixed(1)}ms`);
});

test('perf: importSvg() on 300 rooms', () => {
  const doc = build300RoomDoc();
  const svg = exportSvg(doc);
  const start = performance.now();
  const { doc: doc2, problems } = importSvg(svg);
  const ms = performance.now() - start;
  console.log(`  importSvg(300 rooms) took ${ms.toFixed(1)}ms`);
  assert.deepEqual(problems, []);
  assert.equal(doc2.items.filter((i) => i.type === 'room').length, 300);
  assert.ok(ms < 5000, `importSvg took ${ms.toFixed(1)}ms`);
});

test('perf: 200 simulated pointer moves via magnetSnap, avg < 10ms', () => {
  const doc = build300RoomDoc();
  const targets = collectSnapTargets(doc);

  const start = performance.now();
  for (let i = 0; i < 200; i++) {
    const x = (i * 37) % 1500;
    const y = (i * 53) % 2000;
    magnetSnap({ x, y }, targets, 6);
  }
  const ms = performance.now() - start;
  const avg = ms / 200;
  console.log(`  200 magnetSnap moves took ${ms.toFixed(1)}ms total, avg ${avg.toFixed(3)}ms/move`);
  assert.ok(avg < 10, `average magnetSnap took ${avg.toFixed(3)}ms, expected < 10ms`);
});
