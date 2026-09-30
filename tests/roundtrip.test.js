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
import { legendHtml, legendSvgGroupAt } from '../js/view/panels/legend.js';

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

test('every traced component of an existing project reaches the SVG and round-trips', () => {
  // Items shaped exactly as older versions saved them in .floorplan.json.
  const doc = makeSampleDoc();
  doc.items.push({ id: 'h1', type: 'hall', x: 100, y: 100, w: 300, h: 60 });
  doc.items.push({ id: 'w1', type: 'authwall', x1: 150, y1: 100, x2: 150, y2: 160 });
  const svg = exportSvg(doc);
  const expectTag = {
    room: 'class="room"', hall: 'class="hall"', stair: 'class="stair"',
    door: 'class="door"', compass: 'class="compass"', authwall: 'class="authwall"',
  };
  for (const type of new Set(doc.items.map((i) => i.type))) {
    assert.ok(expectTag[type], `no export expectation for item type "${type}"`);
    assert.ok(svg.includes(expectTag[type]), `item type "${type}" is missing from the SVG`);
  }
  assert.ok(svg.includes('class="authwall-lock"'), 'staff wall keeps its padlock, as in trace and the legend');
  // Every kind of thing drawn has a legend row, in the panel and in the SVG legend.
  const panel = legendHtml();
  const inSvg = legendSvgGroupAt(0, 0);
  for (const label of ['Room', 'Hallway', 'Doors', 'Stairs', 'Compass', 'Staff only']) {
    assert.ok(panel.includes(label) && inSvg.includes(label), `legend is missing "${label}"`);
  }
  const { doc: back, problems } = importSvg(svg);
  assert.deepEqual(problems.filter((p) => p.code !== 'label-orphan'), []);
  const walls = back.items.filter((i) => i.type === 'authwall');
  assert.deepEqual(walls.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })), [{ x1: 150, y1: 100, x2: 150, y2: 160 }]);
  assert.equal(back.items.filter((i) => i.type === 'hall').length, 1);
  assert.equal(exportSvg(back), svg);
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

test('the legend is a plan item: exported once, read back, and counted in the frame', async () => {
  const { contentBounds, pageFrame } = await import('../js/model/pageFit.js');
  const { legendFromView, findLegend } = await import('../js/model/document.js');
  const doc = makeSampleDoc();
  doc.items.push({ id: 'lg', type: 'legend', x: 1200, y: 100, scale: 1.5 });
  const svg = exportSvg(doc);
  assert.equal((svg.match(/<g class="legend"/g) || []).length, 1, 'one legend in the file');
  assert.ok(svg.includes('translate(1200,100) scale(1.5)'));
  const { doc: back, problems } = importSvg(svg);
  assert.deepEqual(problems.filter((p) => p.code !== 'label-orphan'), [], 'legend group imports cleanly');
  const lg = back.items.filter((i) => i.type === 'legend');
  assert.equal(lg.length, 1);
  assert.deepEqual({ x: lg[0].x, y: lg[0].y, scale: lg[0].scale }, { x: 1200, y: 100, scale: 1.5 });
  assert.equal(exportSvg(back), svg, 'round-trip is exact');
  // Fit to SVG includes the whole legend.
  const f = pageFrame(contentBounds(doc), 'fit');
  assert.ok(f.x + f.w >= 1200 + 190 * 1.5, 'frame reaches the legend\'s right edge');
  // Older projects: the Preview's legendPos becomes the legend item, once.
  const old = makeSampleDoc();
  const migrated = legendFromView(old, { legendPos: { x: 10, y: 20, scale: 2 } });
  assert.deepEqual((({ x, y, scale }) => ({ x, y, scale }))(findLegend(migrated)), { x: 10, y: 20, scale: 2 });
  assert.equal(legendFromView(migrated, { legendPos: { x: 99, y: 99 } }), migrated, 'never a second legend');
});
