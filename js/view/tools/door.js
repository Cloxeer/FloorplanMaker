// door.js
// Door tool: accepts a click within 12 plan units of the floor outline, uses
// doorFor to compute the door geometry, commits kind EXIT. Depends on:
// js/model/document.js (doorFor, addItem, newId).

import { doorFor, addItem, newId } from '../../model/document.js';
import { nearestPointOnPolyline } from '../../model/geometry.js';

const TOL = 12;

export function createDoorTool(app) {
  function onDown(e, pt) {
    const floor = app.doc.floor;
    if (!floor || !floor.points || floor.points.length < 3) {
      app.toast('Click on the outside wall to place a door');
      return;
    }
    const near = nearestPointOnPolyline([pt.x, pt.y], floor.points, true);
    if (!near || near.dist > TOL) {
      app.toast('Click on the outside wall to place a door');
      return;
    }
    const res = doorFor(floor.points, pt);
    if (!res) {
      app.toast('Click on the outside wall to place a door');
      return;
    }
    const item = { id: newId(), type: 'door', ...res, kind: 'EXIT' };
    const doc = addItem(app.doc, item);
    app.commit(doc, 'Add door');
  }

  function onMove() {}
  function onUp() {}
  function onKey() { return false; }
  function cancel() {}

  return {
    name: 'door',
    hint: 'Click on the outside wall to place a door.',
    onDown,
    onMove,
    onUp,
    onKey,
    cancel,
  };
}
