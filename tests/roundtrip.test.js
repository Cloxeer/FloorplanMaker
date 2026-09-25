// tests/roundtrip.test.js
// Export/import round-trip and fixture idempotency tests.
// Depends on: node:test, node:assert, js/model/*, ./helpers.js.

import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { exportSvg } from '../js/model/svgExport.js';
import { importSvg } from '../js/model/svgImport.js';
import { validate } from '../js/model/validate.js';
import { makeSampleDoc, loadFixture } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureNames = readdirSync(path.join(__dirname, 'fixtures')).filter((f) => f.endsWith('.svg'));

test('export -> import -> export equality on the sample doc', () => {
  const doc = makeSampleDoc();
  const svg1 = exportSvg(doc);
  const { doc: doc2 } = importSvg(svg1);
  const svg2 = exportSvg(doc2);
  assert.equal(svg2, svg1);
});

test('hallways survive export -> import (and stay idempotent)', () => {
  const doc = makeSampleDoc();
  doc.items.push({ id: 'h1', type: 'hall', x: 100, y: 100, w: 300, h: 60 });
  doc.items.push({ id: 'h2', type: 'hall', x: 380, y: 90, w: 60, h: 200 });
  const svg1 = exportSvg(doc);
  assert.ok(svg1.includes('class="hall"'), 'exported SVG should contain hall rects');
  const { doc: doc2, problems } = importSvg(svg1);
  assert.deepEqual(problems.filter((p) => p.code !== 'label-orphan'), [], 'no import problems for halls');
  const halls = doc2.items.filter((i) => i.type === 'hall');
  assert.equal(halls.length, 2, 'both hallways should be imported back');
  assert.deepEqual(
    halls.map((h) => ({ x: h.x, y: h.y, w: h.w, h: h.h })),
    [{ x: 100, y: 100, w: 300, h: 60 }, { x: 380, y: 90, w: 60, h: 200 }],
  );
  assert.equal(exportSvg(doc2), svg1, 're-export with halls is not idempotent');
});

test('fixtures were found', () => {
  assert.ok(fixtureNames.length > 0, 'expected at least one fixture .svg file');
});

for (const name of fixtureNames) {
  test(`fixture ${name}: import is idempotent under export/import`, () => {
    const original = loadFixture(name);
    const { doc: doc1, problems: problems1 } = importSvg(original);
    assert.deepEqual(problems1.filter((p) => p.code !== 'label-orphan'), [], `unexpected import problems for ${name}`);

    const svgA = exportSvg(doc1);
    const { doc: doc2 } = importSvg(svgA);
    const svgB = exportSvg(doc2);
    assert.equal(svgB, svgA, `re-export of ${name} is not idempotent`);
  });

  test(`fixture ${name}: validate() reports zero errors`, () => {
    const { doc } = importSvg(loadFixture(name));
    const probs = validate(doc);
    const errors = probs.filter((p) => p.level === 'error');
    const warnings = probs.filter((p) => p.level === 'warning');
    if (warnings.length) {
      console.log(`  [${name}] warnings:`, warnings.map((w) => `${w.code}: ${w.message}`));
    }
    assert.deepEqual(errors, [], `unexpected validation errors for ${name}`);
  });

  test(`fixture ${name}: has rooms, doors and stairs`, () => {
    const { doc } = importSvg(loadFixture(name));
    const rooms = doc.items.filter((i) => i.type === 'room');
    const doors = doc.items.filter((i) => i.type === 'door');
    const stairs = doc.items.filter((i) => i.type === 'stair');
    assert.ok(rooms.length > 0, `${name}: expected rooms > 0`);
    if (name === 'hjlc-1.svg') assert.ok(doors.length > 0, `${name}: expected doors > 0`);
    assert.ok(stairs.length > 0, `${name}: expected stairs > 0`);
  });
}
