// stair.js
// Stair tool: drag a rect, or a plain click drops the palette default size
// (60x110), dir 'v'. Depends on: js/model/document.js (newId, addItem, STD).

import { newId, addItem, STD } from '../../model/document.js';

export function createStairTool(app) {
  let dragStart = null;
  let moved = false;

  function onDown(e, pt) {
    const snapped = app.snap(pt, {});
    dragStart = { x: snapped.x, y: snapped.y };
    moved = false;
  }

  function onMove(e, pt) {
    if (!dragStart) return;
    moved = true;
  }

  function onUp(e, pt) {
    if (!dragStart) return;
    const snapped = app.snap(pt, {});
    let x, y, w, h;
    const dx = Math.abs(snapped.x - dragStart.x);
    const dy = Math.abs(snapped.y - dragStart.y);
    if (!moved || (dx < 10 && dy < 10)) {
      w = STD.palette.stair.w;
      h = STD.palette.stair.h;
      x = Math.round(dragStart.x);
      y = Math.round(dragStart.y);
    } else {
      x = Math.round(Math.min(dragStart.x, snapped.x));
      y = Math.round(Math.min(dragStart.y, snapped.y));
      w = Math.round(dx);
      h = Math.round(dy);
    }
    dragStart = null;
    const item = { id: newId(), type: 'stair', x, y, w, h, dir: 'v' };
    const doc = addItem(app.doc, item);
    app.commit(doc, 'Add stair');
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      dragStart = null;
      return true;
    }
    return false;
  }

  function cancel() {
    dragStart = null;
  }

  return {
    name: 'stair',
    hint: 'Drag to size the stair, or click for a default block.',
    onDown,
    onMove,
    onUp,
    onKey,
    cancel,
  };
}
