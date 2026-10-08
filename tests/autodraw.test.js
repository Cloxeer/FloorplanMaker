// autodraw.test.js: Auto draw (js/model/autoDraw.js) on the real Chemistry floor 1 wings (tools/wings): the main building and
// its wing share room numbers (127, 126, 113), the two W photos are the W building.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoDraw, prefixOf } from '../js/model/autoDraw.js';
import { pointInPolygon } from '../js/model/geometry.js';

const load = (n) => {
  const d = JSON.parse(readFileSync(new URL(`../tools/wings/cb-1-${n}.floorplan.json`, import.meta.url), 'utf8'));
  const c = d.doc.items.find((i) => i.type === 'compass');
  return { id: n, items: d.doc.items.filter((i) => i.type !== 'door'), floor: d.doc.floor, compass: c ? { x: c.x, y: c.y, deg: c.deg } : null };
};
const plans = ['1957', '1967', '1995', 'biochem'].map(load);
const at = (xs) => xs.map((x) => ({ q: 0, s: 1, tx: x, ty: 20, how: 'board' }));
const centre = (r) => (r.points ? [r.points.reduce((a, p) => a + p[0], 0) / r.points.length, r.points.reduce((a, p) => a + p[1], 0) / r.points.length] : [r.x + r.w / 2, r.y + r.h / 2]);

test('prefixOf: the W rooms are a W building; plain numbers or too few rooms say nothing', () => {
  assert.equal(prefixOf(plans[2]), 'W');
  assert.equal(prefixOf(plans[0]), '');
  assert.equal(prefixOf({ items: [{ type: 'room', number: 'W1' }] }), '');
});

test('photos side by side (as AutoBuild leaves them): two buildings, one outline each, nothing moved, no room lost', () => {
  const out = autoDraw(plans, at([20, 1200, 2800, 4300]));
  assert.deepEqual(out.buildings.map((b) => b.name).sort(), ['Main building', 'W building']);
  assert.ok(out.floor && out.floor.points.length >= 4, 'the biggest building is the plan outline');
  assert.equal(out.outlines.length, 1);
  assert.equal(out.outlines[0].name, 'W building');
  assert.equal(out.outlines[0].type, 'outline');
  // the wing shares 127 / 126 / 113 with the main photo: same building; but the two photos are not on top of each other,
  // so both 127s stay where their photos put them (nothing is merged or moved on a guess)
  const mains = out.items.filter((i) => i.piece === 'Main building' && i.type === 'room' && i.number === '127');
  assert.equal(mains.length, 2);
  assert.notDeepEqual(centre(mains[0]), centre(mains[1]));
  // every room and hall lies inside the outline of its own building
  const ringOf = { 'Main building': out.floor.points, 'W building': out.outlines[0].points };
  for (const it of out.items.filter((i) => (i.type === 'room' || i.type === 'hall') && i.cls !== 'void')) {
    const c = centre(it), r = ringOf[it.piece], xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    assert.ok(c[0] >= Math.min(...xs) && c[0] <= Math.max(...xs) && c[1] >= Math.min(...ys) && c[1] <= Math.max(...ys), `${it.number || it.type} inside its building's box`);
    assert.ok(pointInPolygon(c, r), `${it.number || it.type} (${it.piece}) inside its outline`);
  }
  const rooms = (p) => p.items.filter((i) => i.type === 'room' && i.cls !== 'void').length;
  assert.equal(out.items.filter((i) => i.type === 'room' && i.cls !== 'void').length, plans.reduce((n, p) => n + rooms(p), 0), 'every room is kept');
});

test('photos far apart: a building never gets a bridge across the gap, each stretch is outlined on its own and the note says how to fix it', () => {
  const out = autoDraw(plans, at([20, 1200, 2800, 9000]));
  const names = [out.buildings.map((b) => b.name), ...[]].flat();
  assert.ok(names.includes('W building') && names.includes('W building (2)'), names.join());
  assert.ok(out.notes.some((n) => /lie apart/.test(n)));
});

test('one photo, no neighbours: one outline, no notes about joining', () => {
  const out = autoDraw([plans[0]], at([20]));
  assert.equal(out.buildings.length, 1);
  assert.equal(out.outlines.length, 0);
  assert.ok(out.floor);
});
