// room.js
// Room tool: drag-rect rooms, and (poly:true) click-corner polygon rooms.
// Prompts for a number on completion; Esc cancels. Keys 1-5 set class while
// the tool is active. Depends on: js/model/document.js (makeRoom, addItem,
// nextNumber).

import { makeRoom, addItem, nextNumber } from '../../model/document.js';

const CLASS_KEYS = { 1: 'room', 2: 'big', 3: 'ours', 4: 'core', 5: 'void' };
const CLOSE_TOL = 8;

export function createRoomTool(app, opts = {}) {
  const isPoly = !!opts.poly;
  let cls = 'room';
  let rectDrag = null; // { startPt }
  let polyPts = null; // array of [x,y] while drawing

  function onDown(e, pt) {
    if (isPoly) {
      const snapped = app.snap(pt, {});
      if (!polyPts) {
        polyPts = [[Math.round(snapped.x), Math.round(snapped.y)]];
      } else {
        const first = polyPts[0];
        const dx = snapped.x - first[0];
        const dy = snapped.y - first[1];
        if (Math.hypot(dx, dy) <= CLOSE_TOL && polyPts.length >= 3) {
          finishPoly();
          return;
        }
        polyPts.push([Math.round(snapped.x), Math.round(snapped.y)]);
      }
      return;
    }
    const snapped = app.snap(pt, {});
    rectDrag = { start: { x: snapped.x, y: snapped.y } };
  }

  function onMove(e, pt) {
    if (isPoly) return; // preview drawn via guides only; no live shape node owned by tool
    if (!rectDrag) return;
    const snapped = app.snap(pt, { box: currentBox(pt) });
    rectDrag.current = { x: snapped.x, y: snapped.y };
  }

  function currentBox(pt) {
    if (!rectDrag) return null;
    const x = Math.min(rectDrag.start.x, pt.x);
    const y = Math.min(rectDrag.start.y, pt.y);
    const w = Math.abs(pt.x - rectDrag.start.x);
    const h = Math.abs(pt.y - rectDrag.start.y);
    return { x, y, w, h };
  }

  function onUp(e, pt) {
    if (isPoly) return;
    if (!rectDrag) return;
    const end = rectDrag.current || rectDrag.start;
    const x = Math.min(rectDrag.start.x, end.x);
    const y = Math.min(rectDrag.start.y, end.y);
    const w = Math.abs(end.x - rectDrag.start.x);
    const h = Math.abs(end.y - rectDrag.start.y);
    rectDrag = null;
    if (w < 10 || h < 10) return;
    promptAndCommit(() => makeRoom(cls, x, y, w, h));
  }

  function finishPoly() {
    const pts = polyPts;
    polyPts = null;
    if (!pts || pts.length < 3) return;
    promptAndCommit(() => ({
      id: newIdLike(),
      type: 'room', cls, shape: 'poly', points: pts,
      number: '', name: '', label: { pinned: false, x: null, y: null, fontSize: null },
      showName: false, section: null,
    }));
  }

  function newIdLike() {
    // makeRoom generates ids via newId(); for poly rooms we mimic by building
    // through makeRoom then overriding shape/points to reuse its id.
    const tmp = makeRoom(cls, 0, 0, 10, 10);
    return tmp.id;
  }

  function promptAndCommit(build) {
    const defaultVal = app.lastNumber ? nextNumber(app.lastNumber) : '';
    app.prompt('Room number', defaultVal).then((value) => {
      if (value == null) return;
      const item = build();
      item.number = value;
      const doc = addItem(app.doc, item);
      app.commit(doc, 'Add room');
      app.lastNumber = value;
    });
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      rectDrag = null;
      polyPts = null;
      return true;
    }
    if (e.key === 'Enter' && isPoly) {
      finishPoly();
      return true;
    }
    if (CLASS_KEYS[e.key]) {
      cls = CLASS_KEYS[e.key];
      return true;
    }
    return false;
  }

  function cancel() {
    rectDrag = null;
    polyPts = null;
  }

  return {
    name: isPoly ? 'poly' : 'room',
    hint: isPoly
      ? 'Click to place corners, Enter or click the first corner to close.'
      : 'Drag to draw a room. Keys 1-5 set class.',
    onDown,
    onMove,
    onUp,
    onKey,
    cancel,
  };
}
