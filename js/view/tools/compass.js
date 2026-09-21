// compass.js
// Compass tool: click to place {type:'compass', x, y, deg:0}; only one
// compass is allowed at a time (placing a new one replaces it). Depends on:
// js/model/document.js (newId, addItem, removeItems).

import { newId, addItem, removeItems } from '../../model/document.js';

export function createCompassTool(app) {
  function onDown(e, pt) {
    const snapped = app.snap(pt, {});
    const existing = app.doc.items.filter((it) => it.type === 'compass').map((it) => it.id);
    let doc = app.doc;
    if (existing.length) doc = removeItems(doc, existing);
    const item = { id: newId(), type: 'compass', x: Math.round(snapped.x), y: Math.round(snapped.y), deg: 0 };
    doc = addItem(doc, item);
    app.commit(doc, 'Place compass');
  }

  function onMove() {}
  function onUp() {}
  function onKey() { return false; }
  function cancel() {}

  return {
    name: 'compass',
    hint: 'Click to place the compass.',
    onDown,
    onMove,
    onUp,
    onKey,
    cancel,
  };
}
