// connect.test.js: joining buildings by hand (js/model/connect.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { openingOf, linksOf, linkState, mergeReady, pieceOutlines, mergeOutlines, wallAt, onWall, nextColor, LINK_COLORS, openingCentres, wallStretches, dropOrphanConnects } from '../js/model/connect.js';

const room = (id, piece, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', piece, number: id, x, y, w, h, name: '', label: {} });
const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const base = () => ({ items: [room('101', 'A', 0, 0, 200, 150), room('102', 'A', 200, 0, 200, 150), room('201', 'B', 800, 0, 200, 150), room('202', 'B', 1000, 0, 200, 150)], floor: null });

test('one outline per piece, none bridged to the other', () => {
  const o = pieceOutlines(base());
  assert.equal(o.length, 2);
  assert.deepEqual(o.map((x) => x.piece).sort(), ['A', 'B']);
  const xs = (r) => r.points.map((p) => p[0]);
  assert.ok(Math.max(...xs(o.find((x) => x.piece === 'A'))) <= 420, 'A stays round A');
  assert.ok(Math.min(...xs(o.find((x) => x.piece === 'B'))) >= 780, 'B stays round B');
});

function withLinks() {
  const d = base();
  const [a, b] = pieceOutlines(d);
  d.items.push(a, b);
  d.items.push({ id: 'c1', type: 'connect', pair: 'p1', slot: 1, color: LINK_COLORS[0], outline: a.id, x: 400, y: 75 });
  d.items.push({ id: 'c2', type: 'connect', pair: 'p1', slot: 2, color: LINK_COLORS[0], outline: b.id, x: 800, y: 75 });
  return d;
}

test('a point opens its wall: the opening is centred on the point and lies on that wall', () => {
  const d = withLinks();
  const o = openingOf(d, d.items.find((i) => i.id === 'c1'));
  assert.ok(o, 'an opening exists');
  assert.ok(Math.abs(o.a[1] - o.b[1]) <= 1 || Math.abs(o.a[0] - o.b[0]) <= 1, 'it runs along a wall');
  assert.equal(linksOf(d).length, 1);
  assert.equal(openingCentres(d).length, 2);
});

test('the links are ready to merge only when a hallway reaches both openings; merging gives ONE outline round everything', () => {
  const d = withLinks();
  assert.equal(mergeReady(d), false);
  const [c1, c2] = openingCentres(d).map((o) => o.centre);
  const link = linksOf(d)[0];
  assert.deepEqual(linkState(d, link), { placed: true, oneHall: false, twoHall: false });
  d.items.push(hall('h', Math.min(c1[0], c2[0]) - 10, Math.min(c1[1], c2[1]) - 20, Math.abs(c2[0] - c1[0]) + 20, 40));
  assert.equal(mergeReady(d), true);
  const m = mergeOutlines(d);
  assert.ok(m.floor && m.floor.points.length >= 4);
  assert.ok(!m.items.some((i) => i.type === 'outline' || i.type === 'connect'));
  const xs = m.floor.points.map((p) => p[0]);
  assert.ok(Math.min(...xs) <= 5 && Math.max(...xs) >= 1195, 'one ring round both buildings');
});

test('walls: a click near a wall lands on it; colors are not reused', () => {
  const d = withLinks();
  const a = d.items.find((i) => i.type === 'outline' && i.piece === 'A');
  assert.equal(wallAt(d, [200, 500], 40), null);
  const w = wallAt(d, [215, 3], 40);
  assert.equal(w.outline, a.id);
  assert.equal(onWall(d, a.id, [300, -20]).y, Math.min(...a.points.map((p) => p[1])));
  assert.notEqual(nextColor(d), LINK_COLORS[0]);
});

test('an outline is drawn as separate stretches with a gap at each opening, only once both points of a link exist', () => {
  const d = withLinks();
  const a = d.items.find((i) => i.type === 'outline' && i.piece === 'A');
  const st = wallStretches(d, a.id);
  assert.equal(st.length, 1, 'one opening splits the ring into one open stretch');
  const op = openingOf(d, d.items.find((i) => i.id === 'c1'));
  assert.deepEqual(st[0][st[0].length - 1], op.a);
  assert.deepEqual(st[0][0], op.b);
  const half = { ...d, items: d.items.filter((i) => i.id !== 'c2') };
  assert.equal(wallStretches(half, a.id).length, 1);
  assert.deepEqual(wallStretches(half, a.id)[0][0], wallStretches(half, a.id)[0][wallStretches(half, a.id)[0].length - 1], 'closed ring while the link is unfinished');
});

test('removing an outline takes its connect points with it', () => {
  const d = withLinks();
  const a = d.items.find((i) => i.type === 'outline' && i.piece === 'A');
  const out = dropOrphanConnects({ ...d, items: d.items.filter((i) => i.id !== a.id) });
  assert.equal(out.items.filter((i) => i.type === 'connect').length, 1);
});

// ---- extra outlines: several separate buildings on one floor
import { ringsOf, withOutline, withoutOutline, nextOutlineName, outlineLabel } from '../js/model/connect.js';
import { createDoc, setFloor } from '../js/model/document.js';
import { validate } from '../js/model/validate.js';
import { exportSvg } from '../js/model/svgExport.js';

const twoBuildings = () => {
  let d = setFloor(createDoc({ building: 'B', property: '1', floor: 1, slug: 'b-1' }, { x: 0, y: 0, w: 2000, h: 600 }), [[0, 0], [400, 0], [400, 300], [0, 300]]);
  d = withOutline(d, [[1000, 0], [1400, 0], [1400, 300], [1000, 300]], { name: 'North wing' });
  return d;
};

test('extra outlines: add keeps the first outline, names default to Outline 2, 3...; redraw keeps id and name; remove drops its connect points', () => {
  let d = twoBuildings();
  assert.equal(d.floor.points.length, 4);
  const o = d.items.find((i) => i.type === 'outline');
  assert.equal(outlineLabel(o), 'North wing');
  assert.equal(nextOutlineName(d), 'Outline 2');
  d = withOutline(d, [[0, 400], [300, 400], [300, 500]]);
  assert.equal(d.items.filter((i) => i.type === 'outline').map(outlineLabel).join(','), 'North wing,Outline 2');
  const again = withOutline(d, [[1000, 0], [1500, 0], [1500, 300]], { id: o.id });
  assert.equal(again.items.filter((i) => i.type === 'outline').length, 2);
  assert.equal(again.items.find((i) => i.id === o.id).name, 'North wing');
  assert.equal(again.items.find((i) => i.id === o.id).points[1][0], 1500);
  const withConnect = { ...d, items: [...d.items, { id: 'c9', type: 'connect', pair: 'p', slot: 1, color: '#e5484d', outline: o.id, x: 1000, y: 100 }] };
  assert.equal(withoutOutline(withConnect, o.id).items.some((i) => i.id === 'c9' || i.id === o.id), false);
  assert.equal(ringsOf(d).length, 3);
});

test('extra outlines: a door on the second building is on an outline; one in the open is not; the export draws every building', () => {
  let d = twoBuildings();
  const door = (id, x1, y1, x2, y2) => ({ id, type: 'door', x1, y1, x2, y2, kind: 'EXIT', label: { x: x1 - 20, y: y1 } });
  d = { ...d, items: [...d.items, door('d1', 1000, 100, 1000, 160), door('d2', 700, 100, 700, 160)] };
  const bad = validate(d).filter((e) => e.code === 'door-off-outline').map((e) => e.itemId);
  assert.deepEqual(bad, ['d2']);
  const svg = exportSvg(d);
  assert.equal((svg.match(/class="floor-edge"/g) || []).length, 2);
});
