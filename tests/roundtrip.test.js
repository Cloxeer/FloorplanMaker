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

test('fixtures were found', () => {
  assert.ok(fixtureNames.length > 0, 'expected at least one fixture .svg file');
});

for (const name of fixtureNames) {
  test(`fixture ${name}: import is idempotent under export/import`, () => {
    const original = loadFixture(name);
    const { doc: doc1, problems: problems1 } = importSvg(original);
    assert.deepEqual(problems1, [], `unexpected import problems for ${name}`);

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
    assert.ok(doors.length > 0, `${name}: expected doors > 0`);
    assert.ok(stairs.length > 0, `${name}: expected stairs > 0`);
  });
}
