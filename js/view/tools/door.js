// door.js
// Door tool: accepts a click within 12 plan units of the floor outline, uses
// doorFor to compute the door geometry, commits kind EXIT. Depends on:
// js/model/document.js (doorFor, addItem, newId).

import { doorFor, addItem, newId } from '../../model/document.js';
import { nearestPointOnPolyline } from '../../model/geometry.js';

const TOL = 12;
const DOOR_LEN = 36;

export function createDoorTool(app) {
  function guidesLayer() {
    const svg = document.getElementById('canvas');
    return svg && svg.querySelector('.layer-guides');
  }
  function clearPreview() {
    const layer = guidesLayer();
    const line = layer && layer.querySelector('.door-ghost-preview');
    if (line) line.remove();
  }
  function drawPreview(near, points, ready) {
    const layer = guidesLayer();
    if (!layer) return;
    // unit tangent along the outline segment at the snapped point
    const a = points[near.segIndex];
    const b = points[(near.segIndex + 1) % points.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = (dx / len) * (DOOR_LEN / 2);
    const uy = (dy / len) * (DOOR_LEN / 2);
    let line = layer.querySelector('.door-ghost-preview');
    if (!line) {
      line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      layer.appendChild(line);
    }
    line.setAttribute('class', `door-ghost-preview ${ready ? 'ready' : 'far'}`);
    line.setAttribute('x1', near.x - ux);
    line.setAttribute('y1', near.y - uy);
    line.setAttribute('x2', near.x + ux);
    line.setAttribute('y2', near.y + uy);
  }
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

  function onMove(e, pt) {
    const floor = app.doc.floor;
    if (!floor || !floor.points || floor.points.length < 3) { clearPreview(); return; }
    const near = nearestPointOnPolyline([pt.x, pt.y], floor.points, true);
    if (!near) { clearPreview(); return; }
    drawPreview(near, floor.points, near.dist <= TOL);
  }
  function onUp() {}
  function onKey(e) {
    if (e.key === 'Escape') {
      clearPreview();
      app.setTool('select');
      return true;
    }
    return false;
  }
  function cancel() { clearPreview(); }

  return {
    name: 'door',
    hint: 'Click on the outside wall where a door is. Press Esc when done.',
    onDown,
    onMove,
    onUp,
    onKey,
    cancel,
  };
}
