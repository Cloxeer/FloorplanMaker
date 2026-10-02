import test from 'node:test';
import assert from 'node:assert/strict';
import {
  repairNumber, repairNumberLegacy, inferFormat, floorPrior, flagOutliers, parseNumber,
  matchName, classify, voteReads, repairRuns, NAME_VOCAB,
} from '../js/model/autobuild/text.js';

const ours = ['128B', 'S117', 'T106', 'M118', 'R134', 'J129', 'E127', 'H149', '101A', '219A', '005', '016', 'H001A', 'M017B'];

test('our formats are unchanged and equal the legacy repair', () => {
  for (const n of ours) assert.equal(repairNumber(n).value, n);
  for (const raw of ['I28B', 'O05', 'R1O1', 'T1O6', '5122', 'S122', '1288', 'HELP', '12', '', 'ST1', '2105', 'LOB']) {
    assert.deepEqual(repairNumber(raw), repairNumberLegacy(raw));
  }
});

test("other schools' exact formats are accepted without a format", () => {
  for (const n of ['B-104', '1-204', 'ENG 101', 'A101B', '203-A', '3.14']) {
    const r = repairNumber(n);
    assert.ok(r, n);
    assert.equal(r.value, n === '203-A' ? '203A' : n === '3.14' ? '314' : parseNumber(n).value); // legacy drops the dash before a suffix
  }
  const sfx = inferFormat(['203-A', '204-B', '205-A', '206', '207-C']);
  assert.equal(repairNumber('2O3A', sfx).value, '203-A');
  assert.equal(repairNumber('B-104').value, 'B-104');
  assert.equal(repairNumber('1-204').value, '1-204');
  assert.equal(repairNumber('3.14').value, '314'); // legacy drops separators
  assert.equal(repairNumber('3.14', inferFormat(['3.14', '3.15', '3.20', '2.11'])).value, '3.14');
  assert.equal(repairNumber('ENG 101').value, 'ENG 101');
});

test('words and stray letters are not numbers', () => {
  for (const w of ['HELP', 'UP', 'ROOM', 'EXIT', 'R01', 'X03', 'MEN 12']) assert.equal(repairNumber(w), null, w);
});

test('inferFormat finds the dominant format', () => {
  const f = inferFormat(ours);
  assert.equal(f.digits, 3);
  assert.ok(f.prefixRate > 0.3 && f.prefixRate < 0.7);
  assert.ok(f.sufRate > 0.2);
  assert.equal(inferFormat(['1']), null);
  const g = inferFormat(['B-104', 'B-105', 'B-112', 'B-118', 'B-120']);
  assert.equal(g.preSep, '-');
  assert.equal(g.prefixRate, 1);
  assert.deepEqual(g.prefixSet, ['B']);
  assert.equal(g.lead, '1');
});

test('format repairs look-alikes in digit and letter slots', () => {
  const f = inferFormat(['B-104', 'B-105', 'B-112', 'B-118', 'B-120']);
  assert.equal(repairNumber('B-1O4', f).value, 'B-104');
  assert.equal(repairNumber('81O4', f).value, 'B-104'); // 8 -> B, O -> 0, separator restored
  assert.equal(repairNumber('B1I2', f).value, 'B-112');
  assert.equal(repairNumber('B-l05', f).value, 'B-105');
  const four = inferFormat(['2105', '2106', '2110', '2111', '2120', '2121']);
  assert.equal(repairNumber('2I05', four).value, '2105');
  assert.equal(repairNumber('2105', four).cost, 0);
  const sfx = inferFormat(['A101B', 'A101C', 'A102A', 'A103', 'A104B']);
  assert.equal(repairNumber('A1O1B', sfx).value, 'A101B');
  assert.equal(repairNumber('A1016', sfx).value, 'A101G');
});

test('one extra character is dropped at low confidence, a missing one is never invented', () => {
  const f = inferFormat(['B-104', 'B-105', 'B-112', 'B-118', 'B-120']);
  const r = repairNumber('B-1104', f);
  assert.equal(r.value, 'B-104');
  assert.ok(r.weak);
  assert.equal(repairNumber('B-14', f), null);
  const g = inferFormat(['101', '102', '103', '112', '115']);
  assert.equal(repairNumber('12', g), null);
  assert.equal(repairNumber('HELP', g), null);
});

test('format prefers matching candidates over legacy look-alikes', () => {
  const four = inferFormat(['2105', '2106', '2110', '2111', '2120', '2121']);
  assert.equal(repairNumberLegacy('2105').value, '210S'); // legacy only knows 3 digits + letter
  assert.equal(repairNumber('2105', four).value, '2105');
});

test('floor prior and outliers', () => {
  const all = ['101', '102', 'S117', '105A', '119', '230'];
  assert.equal(floorPrior(all).digit, '1');
  assert.deepEqual(flagOutliers(all), ['230']);
  assert.deepEqual(flagOutliers(['101', '202', '303']), []);
  assert.equal(floorPrior([]), null);
});

test('matchName extended vocabulary and tolerance', () => {
  assert.equal(matchName('RESTR00M'), 'RESTROOM');
  assert.equal(matchName('WOMENS'), 'WOMENS');
  assert.equal(matchName('MECHANlCAL'), 'MECHANICAL');
  assert.equal(matchName('CONFERENCE R0OM'), 'CONFERENCE ROOM');
  assert.equal(matchName('0PEN TO BELOW'), 'OPEN TO BELOW');
  assert.equal(matchName('OPENTO BELOW'), 'OPEN TO BELOW');
  assert.equal(matchName("MEN'S"), 'MENS');
  assert.equal(matchName('CAFETERIA'), 'CAFETERIA');
  assert.equal(matchName('LIBRAFY'), 'LIBRARY');
  assert.equal(matchName('128B'), null);
  assert.equal(matchName('S117'), null);
  assert.equal(matchName('105A'), null);
  assert.equal(matchName('QZW'), null);
  assert.ok(NAME_VOCAB.includes('ELEVATOR'));
});

test('classify', () => {
  assert.deepEqual(classify('128B'), { kind: 'number', value: '128B', cost: 0 });
  assert.equal(classify('I28B').kind, 'number');
  assert.equal(classify('ST1').kind, 'stair');
  assert.equal(classify('ST1').value, 'ST1');
  assert.equal(classify('STI').value, 'ST1');
  assert.equal(classify('Restrooms').kind, 'restroom');
  assert.equal(classify('WOMEN').kind, 'restroom');
  assert.equal(classify('Unisex').kind, 'restroom');
  assert.equal(classify('ELEVAT0R').kind, 'elevator');
  assert.equal(classify('OPEN TO BELOW').kind, 'void');
  assert.equal(classify('Open to belaw').kind, 'void');
  assert.equal(classify('VOID').kind, 'void');
  assert.equal(classify('CLASSROOM').kind, 'name');
  assert.equal(classify('SOD').kind, 'unknown');
  assert.equal(classify('xyzzy').kind, 'unknown');
  assert.equal(classify('B-104').kind, 'number');
  assert.equal(classify('ENG 101').value, 'ENG 101');
});

test('voteReads ranks, drops garbage and exposes names', () => {
  const r = voteReads([{ text: '128G', conf: 80 }, { text: '1286', conf: 60 }, { text: '128G', conf: 70 }, { text: '', conf: 0 }]);
  assert.equal(r[0].val, '128G');
  assert.equal(r[0].n, 2);
  assert.ok(r[0].score > 0 && r[0].score <= 1);
  assert.equal(r.total, 4);
  const names = voteReads([{ text: 'STUDENT SUCCESS/', conf: 90 }, { text: 'STUDENT SUCCESS/', conf: 90 }]);
  assert.equal(names.length, 0);
  assert.equal(names.names[0].name, 'STUDENT SUCCESS');
  const f = inferFormat(['B-104', 'B-105', 'B-112', 'B-118']);
  const v = voteReads([{ text: 'B-1O4' }, { text: '8104' }, { text: 'B-104' }], { format: f });
  assert.equal(v[0].val, 'B-104');
  assert.equal(v[0].n, 3);
});

const row = (nums, y = 0, votes = 3) => nums.map((n, i) => ({ x: i * 100, y, w: 90, h: 60, number: n, votes: n ? votes : 0 }));

test('repairRuns: letter suffix runs still work', () => {
  const rooms = row(['128B', '128C', '', '128E', '128F']);
  repairRuns(rooms);
  assert.equal(rooms[2].number, '128D');
  assert.ok(rooms[2].inferred);
});

test('repairRuns: even runs along a corridor', () => {
  const rooms = row(['124', '126', '', '130', '132']);
  const ch = repairRuns(rooms);
  assert.equal(rooms[2].number, '128');
  assert.ok(rooms[2].inferred);
  assert.equal(ch.length, 1);
});

test('repairRuns: odd one out with weak votes is replaced, strong ones are kept', () => {
  const a = row(['201', '202', '208', '204', '205']); a[2].votes = 1;
  repairRuns(a); assert.equal(a[2].number, '203');
  const b = row(['201', '202', '208', '204', '205']);
  repairRuns(b); assert.equal(b[2].number, '208');
});

test('repairRuns: never invents without both neighbours and support, never duplicates', () => {
  const a = row(['', '102', '103', '104']); repairRuns(a); assert.equal(a[0].number, '');
  const b = row(['124', '', '126', '128']); repairRuns(b); assert.equal(b[1].number, '');
  const c = row(['101', '', '103', '104', '105']); c.push({ x: 900, y: 500, w: 90, h: 60, number: '102', votes: 3 });
  repairRuns(c); assert.equal(c[1].number, '');
  const d = row(['R101', '', 'S103', 'S104', 'S105']); repairRuns(d); assert.equal(d[1].number, '');
});

test('repairRuns: stacked rooms (column) are inferred too', () => {
  const rooms = ['310', '312', '', '316', '318'].map((n, i) => ({ x: 0, y: i * 80, w: 70, h: 70, number: n, votes: n ? 3 : 0 }));
  repairRuns(rooms);
  assert.equal(rooms[2].number, '314');
  assert.ok(rooms[2].inferred);
});
