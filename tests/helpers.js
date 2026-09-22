// tests/helpers.js
// Shared test fixtures: a synthetic sample doc exercising every item type/
// feature, and a fixture file loader. Depends on: js/model/document.js.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createDoc,
  setFloor,
  addItem,
  updateItem,
  addSection,
  makeRoom,
  doorFor,
} from '../js/model/document.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadFixture(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

export function makeSampleDoc() {
  const meta = { building: 'Hardman and Jacobs Undergraduate Learning Center', property: '323', floor: 1, slug: 'hjlc-1' };
  let doc = createDoc(meta, { x: 0, y: 0, w: 1000, h: 800 });

  // Non-rectangular L-shaped floor polygon within the 1000x800 viewBox.
  const floorPts = [
    [0, 0],
    [1000, 0],
    [1000, 500],
    [600, 500],
    [600, 800],
    [0, 800],
  ];
  doc = setFloor(doc, floorPts);

  let sec1, sec2;
  ({ doc, id: sec1 } = addSection(doc, 'TOP ROW'));
  ({ doc, id: sec2 } = addSection(doc, 'SOUTH'));

  // Six rect rooms with numbers.
  const r1 = makeRoom('room', 10, 10, 80, 60, '128B');
  doc = addItem(doc, { ...r1, section: sec1 });

  const r2 = makeRoom('room', 100, 10, 80, 60, '128C');
  doc = addItem(doc, { ...r2, section: sec1 });

  const r3 = makeRoom('room', 190, 10, 80, 60, 'S117');
  doc = addItem(doc, { ...r3, section: sec1 });

  const r4 = makeRoom('ours', 10, 90, 80, 60, '101');
  doc = addItem(doc, r4); // 'ours' class, unsectioned

  const r5 = makeRoom('room', 100, 90, 100, 80, '105');
  doc = addItem(doc, { ...r5, name: 'Help Desk', section: sec2 });

  const r6 = makeRoom('big', 10, 190, 300, 220, '126');
  doc = addItem(doc, { ...r6, name: 'Lecture Hall', showName: true, section: sec2 });

  // One poly room (5 points).
  const pentagon = {
    id: 'poly-room',
    type: 'room',
    cls: 'room',
    shape: 'poly',
    points: [[350, 90], [420, 90], [440, 140], [385, 180], [330, 140]],
    number: '107',
    name: '',
    label: { pinned: false, x: null, y: null, fontSize: null },
    showName: false,
    section: null,
  };
  doc = addItem(doc, pentagon);

  // A small room (60x50 short side < 70 -> lblS).
  const small = makeRoom('room', 430, 90, 60, 50, 'S108');
  doc = addItem(doc, small);

  // A void.
  const voidRoom = makeRoom('void', 500, 90, 80, 60, '');
  doc = addItem(doc, voidRoom);

  // A core elevator room (gets the elevator icon in the export). Needs a
  // real number (not just a name) — roomLabelLines() only emits the
  // separate <text class="name"> line when the main label text is
  // non-empty, so an unnumbered showName room would round-trip its name
  // away.
  const elevator = makeRoom('core', 600, 90, 80, 70, '150');
  doc = addItem(doc, { ...elevator, name: 'Elevator', showName: true });

  // A core restroom room (gets the restroom icon in the export).
  const restroom = makeRoom('core', 700, 90, 80, 70, '151');
  doc = addItem(doc, { ...restroom, name: 'Restroom', showName: true });

  // A pinned label with a font-size override, on r1 (128B). Pin inside shape.
  const r1Item = doc.items.find((it) => it.number === '128B');
  doc = updateItem(doc, r1Item.id, {
    label: { pinned: true, x: 50, y: 40, fontSize: 22 },
  });

  // Two sections already created above (sec1, sec2) and used by some rooms.

  // A stair dir 'v' and a stair dir 'h'.
  doc = addItem(doc, { id: 'stair-v', type: 'stair', x: 20, y: 300, w: 60, h: 120, dir: 'v' });
  doc = addItem(doc, { id: 'stair-h', type: 'stair', x: 700, y: 20, w: 120, h: 60, dir: 'h' });

  // Two doors via doorFor: one EXIT, one Door.
  const doorA = doorFor(floorPts, { x: 0, y: 400 });
  doc = addItem(doc, { id: 'door-exit', type: 'door', ...doorA, kind: 'EXIT' });

  const doorB = doorFor(floorPts, { x: 800, y: 800 });
  doc = addItem(doc, { id: 'door-door', type: 'door', ...doorB, kind: 'Door' });

  // Compass.
  doc = addItem(doc, { id: 'compass-1', type: 'compass', x: 950, y: 50, deg: 0 });

  return doc;
}
