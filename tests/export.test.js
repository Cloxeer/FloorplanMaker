// tests/export.test.js
// Verifies exportSvg() against the exact dialect contract in
// docs/DIALECT.md. Depends on: node:test, node:assert, js/model/svgExport.js,
// ./helpers.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSvg } from '../js/model/svgExport.js';
import { makeSampleDoc } from './helpers.js';

const STYLE_BLOCK = [
  '  <style>',
  '    .floor { fill: #ffffff; stroke: #3a3d42; stroke-width: 6; stroke-linejoin: round; }',
  '    .room  { fill: #eef1f4; stroke: #8f959c; stroke-width: 2; }',
  '    .big   { fill: #e6ecf5; stroke: #8f959c; stroke-width: 2; }',
  '    .ours  { fill: #f5e3ea; stroke: #8f959c; stroke-width: 2; }',
  '    .core  { fill: #dfe3e8; stroke: #8f959c; stroke-width: 2; }',
  '    .stair { stroke: #8f959c; stroke-width: 2; }',
  '    .door  { stroke: #ffffff; stroke-width: 10; }',
  '    .lbl   { fill: #2b2e33; font-size: 24px; text-anchor: middle; dominant-baseline: middle; }',
  '    .lblS  { fill: #2b2e33; font-size: 19px; text-anchor: middle; dominant-baseline: middle; }',
  '    .name  { fill: #1d1f23; font-size: 30px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }',
  '    .exit  { fill: #1a7f37; font-size: 20px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }',
  '.compass-letter { font-size: 22px; font-weight: 600; fill: #8a8690; text-anchor: middle; }',
  '.compass-north  { fill: #8C0B42; }',
  '  </style>',
].join('\n');

const doc = makeSampleDoc();
const svg = exportSvg(doc);

test('exact root tag', () => {
  assert.ok(svg.startsWith(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800" font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif">\n`
  ));
});

test('header comment lines', () => {
  const expected = [
    '  <!--',
    `    ${doc.meta.building} (bldg ${doc.meta.property}) - FLOOR ${doc.meta.floor}`,
    '    Traced from the posted "Emergency Evacuation Plan" photo. Coordinates use the',
    "    photo's own pixel positions, so any shape can be checked against the photo.",
    '    One wall weight for outside walls, one for inside walls; nothing in between.',
    '  -->',
  ].join('\n');
  assert.ok(svg.includes(expected));
});

test('verbatim style block', () => {
  assert.ok(svg.includes(STYLE_BLOCK));
});

test('exactly one floor polygon', () => {
  const matches = svg.match(/<polygon class="floor"/g) || [];
  assert.equal(matches.length, 1);
});

test('all coordinates are integers', () => {
  const numRe = /(?:x1|y1|x2|y2|x|y|width|height|r)="(-?\d+(?:\.\d+)?)"/g;
  let m;
  let count = 0;
  const body = svg.replace(/<g class="compass"[\s\S]*?<\/g>/, ''); // the compass is copied verbatim (r="4.5")
  while ((m = numRe.exec(body))) {
    count++;
    assert.ok(Number.isInteger(Number(m[1])), `non-integer coordinate: ${m[0]}`);
  }
  assert.ok(count > 0);
});

test('no id=, style=, defs, image attributes/elements', () => {
  assert.equal(/\sid="/.test(svg), false);
  assert.equal(/\sstyle="/.test(svg), false);
  assert.equal(/<defs/.test(svg), false);
  assert.equal(/<image/.test(svg), false);
});

test('transform= only inside the compass group', () => {
  const lines = svg.split('\n');
  let inCompass = false;
  for (const line of lines) {
    if (line.includes('<g class="compass"')) inCompass = true;
    if (line.includes('transform=')) {
      assert.ok(line.includes('class="compass"'), `unexpected transform outside compass: ${line}`);
    }
    if (inCompass && line.trim() === '</g>') inCompass = false;
  }
});

test('void has no label', () => {
  const voidIdx = svg.indexOf('<rect class="void"');
  assert.ok(voidIdx !== -1);
  const nextLineEnd = svg.indexOf('\n', voidIdx);
  const followingLine = svg.slice(nextLineEnd + 1, svg.indexOf('\n', nextLineEnd + 1));
  assert.ok(!followingLine.includes('class="lbl'));
});

test('lblS chosen for the small room', () => {
  const idx = svg.indexOf('S108');
  assert.ok(idx !== -1);
  const lineStart = svg.lastIndexOf('\n', idx) + 1;
  const line = svg.slice(lineStart, svg.indexOf('\n', idx));
  assert.ok(line.includes('class="lblS"'), line);
});

test('fill="#5f6368" only on the Door text', () => {
  const matches = [...svg.matchAll(/^.*fill="#5f6368".*$/gm)];
  assert.ok(matches.length >= 1);
  for (const m of matches) {
    assert.ok(m[0].includes('class="exit"') && m[0].includes('>Door<'), m[0]);
  }
});

test('section comments present', () => {
  assert.ok(svg.includes('<!-- TOP ROW -->'));
  assert.ok(svg.includes('<!-- SOUTH -->'));
});

test('ordering: floor before rooms before stairs before doors before compass', () => {
  const floorIdx = svg.indexOf('<polygon class="floor"');
  const roomIdx = svg.indexOf('<rect class=');
  const stairIdx = svg.indexOf('<g class="stair"');
  const doorIdx = svg.indexOf('<line class="door"');
  const compassIdx = svg.indexOf('<g class="compass"');
  assert.ok(floorIdx < roomIdx);
  assert.ok(roomIdx < stairIdx);
  assert.ok(stairIdx < doorIdx);
  assert.ok(doorIdx < compassIdx);
});
