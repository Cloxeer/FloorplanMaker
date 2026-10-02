import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeZip } from '../js/model/zip.js';
import { floorsOf, parseFloor, freeSlug, sameBuilding, buildingFolderName } from '../js/model/building.js';

test('makeZip: a valid archive that unzips with the folder and contents intact', () => {
  const bytes = makeZip([{ name: 'Jett Hall/jh-0.svg', data: '<svg>é</svg>' }, { name: 'Jett Hall/jh-1.svg', data: new Uint8Array([1, 2, 3]) }]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const f = join(dir, 'a.zip');
  writeFileSync(f, bytes);
  let ok = true;
  try { execFileSync('python', ['-c', `import zipfile,sys;z=zipfile.ZipFile(r'${f}');assert z.testzip() is None;assert z.namelist()==['Jett Hall/jh-0.svg','Jett Hall/jh-1.svg'];assert z.read('Jett Hall/jh-0.svg').decode('utf8')=='<svg>é</svg>'`]); } catch (e) { ok = false; }
  assert.ok(ok);
  assert.ok(readFileSync(f).length > 100);
});

test('floorsOf: groups by building, merges copies, sorts by floor', () => {
  const meta = { building: 'Jett Hall', property: '12' };
  const list = [
    { slug: 'jh-2', building: 'jett hall ', property: '12', floor: 2, id: 'a', savedAt: 5 },
    { slug: 'jh-0', building: 'Jett Hall', floor: 0, id: 'b', savedAt: 1 },
    { slug: 'jh-0', building: 'Jett Hall', floor: 0, onDisk: true, savedAt: 9 },
    { slug: 'xx-1', building: 'Other', floor: 1 },
    { slug: 'jh-9', building: 'Jett Hall', property: '99', floor: 9 },
  ];
  const f = floorsOf(list, meta, 'jh-2');
  assert.deepEqual(f.map((x) => x.slug), ['jh-0', 'jh-2']);
  assert.equal(f[0].onDisk, true); assert.equal(f[0].id, 'b'); assert.equal(f[1].current, true);
  assert.equal(sameBuilding(null, meta), false);
});

test('parseFloor / freeSlug / folder name', () => {
  assert.equal(parseFloor('2', []).floor, 2);
  assert.equal(parseFloor('-1', []).floor, -1);
  assert.ok(parseFloor('', []).error); assert.ok(parseFloor('1.5', []).error); assert.ok(parseFloor('B1', []).error);
  assert.ok(parseFloor('2', [2]).error);
  assert.equal(freeSlug('jh-2', ['jh-1']), 'jh-2');
  assert.notEqual(freeSlug('jh-2', ['jh-2']), 'jh-2');
  assert.equal(buildingFolderName('A/B: Hall?'), 'AB Hall');
  assert.equal(buildingFolderName(''), 'Building');
});

test('unnamed building: floors with no building name group together', async () => {
  const { UNNAMED, isUnnamed } = await import('../js/model/building.js');
  assert.ok(isUnnamed('') && isUnnamed('  ') && isUnnamed(UNNAMED) && !isUnnamed('Jett Hall'));
  const list = [{ slug: 'a-1', floor: 1 }, { slug: 'b-2', floor: 2, building: '' }, { slug: 'c-1', floor: 1, building: 'Jett Hall' }];
  assert.deepEqual(floorsOf(list, { building: UNNAMED }, null).map((f) => f.slug), ['a-1', 'b-2']);
  assert.deepEqual(floorsOf(list, { building: 'Jett Hall' }, null).map((f) => f.slug), ['c-1']);
});
