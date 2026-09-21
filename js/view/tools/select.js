// select.js
// Select tool: click/shift-click, marquee, move selection (magnet snap;
// clicking a label moves the whole item, it never drags independently),
// resize via handles, repeat handle -> duplicateInRow, arrow-key nudge,
// delete, 1-5 class change, floor vertex drag, double-click rename. Every
// pointermove patches shape+label+selection overlay together via
// canvas.patchItem/setSelection so nothing lags a frame; the handle scale is
// cached at pointerdown so no layout read happens during the drag. Depends
// on: js/model/document.js (updateItem, setFloor, getItem), js/model/geometry.js
// (bbox), ./common.js (boxOf, moveItem, resizeRect, collectSnapTargets,
// patchedItem).

import { updateItem, setFloor, getItem, removeItems } from '../../model/document.js';
import { bbox, dist } from '../../model/geometry.js';
import { boxOf, moveItem, resizeRect, collectSnapTargets, patchedItem } from './common.js';

export function createSelectTool(app) {
  let drag = null; // { kind, ... }

  function itemsForSelection() {
    return [...app.selection].map((id) => getItem(app.doc, id)).filter(Boolean);
  }

  function startMove(ids, pt) {
    const items = ids.map((id) => getItem(app.doc, id)).filter(Boolean);
    const boxes = items.map((it) => boxOf(it));
    const unionBox = boxes.reduce((acc, b) => {
      if (!acc) return { ...b };
      const x2 = Math.max(acc.x + acc.w, b.x + b.w);
      const y2 = Math.max(acc.y + acc.h, b.y + b.h);
      const x = Math.min(acc.x, b.x);
      const y = Math.min(acc.y, b.y);
      return { x, y, w: x2 - x, h: y2 - y };
    }, null);
    drag = {
      kind: 'move', startPt: pt, ids: ids.filter((id) => {
        const it = getItem(app.doc, id);
        return it && it.type !== 'door';
      }), unionBox,
      scale: app.canvas.getHandleScale(),
    };
  }

  function onDown(e, pt) {
    const hit = app.canvas.hitTest(e.clientX, e.clientY);

    if (hit && hit.id === 'floor' && hit.part.startsWith('floor-vertex:') && app.selection.has('floor')) {
      const i = parseInt(hit.part.split(':')[1], 10);
      drag = {
        kind: 'floor-vertex', index: i, startPts: app.doc.floor.points.map((p) => [...p]),
        scale: app.canvas.getHandleScale(),
        floorNode: document.querySelector('[data-id="floor"]'),
      };
      return;
    }

    if (hit && hit.part === 'repeat') {
      app.duplicateInRow(hit.id);
      return;
    }

    if (hit && hit.part && hit.part.startsWith('vertex:') && app.selection.has(hit.id)) {
      const i = parseInt(hit.part.split(':')[1], 10);
      const item = getItem(app.doc, hit.id);
      if (item && item.shape === 'poly') {
        drag = {
          kind: 'vertex', id: hit.id, index: i, startPts: item.points.map((p) => [...p]),
          scale: app.canvas.getHandleScale(),
        };
      }
      return;
    }

    if (hit && hit.part && hit.part.startsWith('handle:')) {
      const handleName = hit.part.split(':')[1];
      const item = getItem(app.doc, hit.id);
      if (item) {
        drag = {
          kind: 'resize', id: hit.id, handle: handleName, startItem: item,
          scale: app.canvas.getHandleScale(),
        };
      }
      return;
    }

    // Clicking a label (data-part="label") behaves exactly like clicking the
    // item body: select it and start a move. Labels never drag independently
    // any more (label.pinned is left untouched for imported docs).
    if (hit && hit.id) {
      let ids = [...app.selection];
      if (e.shiftKey) {
        if (ids.includes(hit.id)) ids = ids.filter((id) => id !== hit.id);
        else ids = [...ids, hit.id];
        app.setSelection(ids);
      } else if (!ids.includes(hit.id)) {
        ids = [hit.id];
        app.setSelection(ids);
      }
      if (ids.includes(hit.id) && !e.shiftKey) {
        startMove(ids, pt);
      } else if (ids.length && ids.includes(hit.id)) {
        startMove(ids, pt);
      }
      return;
    }

    // empty space: marquee
    if (!e.shiftKey) app.setSelection([]);
    drag = { kind: 'marquee', startPt: pt, additive: e.shiftKey, base: [...app.selection] };
  }

  function onMove(e, pt) {
    if (!drag) return;

    if (drag.kind === 'move') {
      const dx0 = pt.x - drag.startPt.x;
      const dy0 = pt.y - drag.startPt.y;
      const movedBox = { x: drag.unionBox.x + dx0, y: drag.unionBox.y + dy0, w: drag.unionBox.w, h: drag.unionBox.h };
      const targets = collectSnapTargets(app.doc, new Set(drag.ids), movedBox);
      const snapped = app.snap({ x: movedBox.x, y: movedBox.y }, { ignoreIds: new Set(drag.ids), box: movedBox, targets });
      const dx = snapped.x - drag.unionBox.x;
      const dy = snapped.y - drag.unionBox.y;
      drag.lastDx = dx;
      drag.lastDy = dy;
      // Patch shape+label (one piece) for every dragged item, then redraw
      // the selection outline/handles/repeat handle from the same patched
      // geometry, all within this one pointermove tick.
      const overrides = new Map();
      for (const id of drag.ids) {
        const item = getItem(app.doc, id);
        if (!item) continue;
        const patched = patchedItem(item, dx, dy);
        app.canvas.patchItem(patched);
        overrides.set(id, patched);
      }
      app.canvas.setSelection([...app.selection], { scale: drag.scale, overrides });
      return;
    }

    if (drag.kind === 'resize') {
      const patch = resizeRect(drag.startItem, drag.handle, pt);
      drag.lastPatch = patch;
      const patched = { ...drag.startItem, ...patch };
      app.canvas.patchItem(patched);
      app.canvas.setSelection([...app.selection], { scale: drag.scale, overrides: new Map([[drag.id, patched]]) });
      return;
    }

    if (drag.kind === 'vertex') {
      const snapped = app.snap(pt, { ignoreIds: new Set([drag.id]) });
      const pts = drag.startPts.map((p) => [...p]);
      pts[drag.index] = [Math.round(snapped.x), Math.round(snapped.y)];
      drag.lastPts = pts;
      const item = getItem(app.doc, drag.id);
      const patched = { ...item, points: pts };
      app.canvas.patchItem(patched);
      app.canvas.setSelection([...app.selection], { scale: drag.scale, overrides: new Map([[drag.id, patched]]) });
      return;
    }

    if (drag.kind === 'floor-vertex') {
      const pts = drag.startPts.map((p) => [...p]);
      pts[drag.index] = [Math.round(pt.x), Math.round(pt.y)];
      drag.lastPts = pts;
      if (drag.floorNode) drag.floorNode.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
      app.canvas.setSelection([...app.selection], { scale: drag.scale, floor: { points: pts } });
      return;
    }

    if (drag.kind === 'marquee') {
      drag.lastPt = pt;
    }
  }

  function onUp(e, pt) {
    if (!drag) return;
    if (drag.kind === 'move' && (drag.lastDx || drag.lastDy)) {
      let doc = app.doc;
      for (const id of drag.ids) {
        const item = getItem(doc, id);
        if (!item) continue;
        const patch = moveItem(item, drag.lastDx, drag.lastDy);
        doc = updateItem(doc, id, patch);
      }
      app.commit(doc, 'Move');
    } else if (drag.kind === 'resize' && drag.lastPatch) {
      const doc = updateItem(app.doc, drag.id, drag.lastPatch);
      app.commit(doc, 'Resize');
    } else if (drag.kind === 'vertex' && drag.lastPts) {
      const doc = updateItem(app.doc, drag.id, { points: drag.lastPts });
      app.commit(doc, 'Edit corner');
    } else if (drag.kind === 'floor-vertex' && drag.lastPts) {
      const doc = setFloor(app.doc, drag.lastPts);
      app.commit(doc, 'Edit floor');
    } else if (drag.kind === 'marquee') {
      const a = drag.startPt;
      const b = drag.lastPt || a;
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
      const hits = app.doc.items.filter((item) => {
        const box = boxOf(item);
        return box.x >= minX && box.y >= minY && box.x + box.w <= maxX && box.y + box.h <= maxY;
      }).map((it) => it.id);
      const ids = drag.additive ? [...new Set([...drag.base, ...hits])] : hits;
      app.setSelection(ids);
    }
    app.canvas.setGuides([]);
    drag = null;
  }

  function onKey(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (app.selection.size === 0) return false;
      const ids = [...app.selection].filter((id) => id !== 'floor');
      let doc = app.doc;
      if (ids.length) doc = removeItems(doc, ids);
      if (app.selection.has('floor')) doc = setFloor(doc, null);
      app.commit(doc, 'Delete');
      app.setSelection([]);
      return true;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (app.selection.size === 0) return false;
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      let doc = app.doc;
      for (const id of app.selection) {
        if (id === 'floor') continue;
        const item = getItem(doc, id);
        if (!item) continue;
        doc = updateItem(doc, id, moveItem(item, dx, dy));
      }
      app.commit(doc, 'Nudge');
      return true;
    }
    if (e.key === 'd' || e.key === 'D') {
      const ids = [...app.selection];
      if (ids.length === 1) {
        app.duplicateInRow(ids[0]);
        return true;
      }
    }
    if (/^[1-5]$/.test(e.key)) {
      const classes = ['room', 'big', 'ours', 'core', 'void'];
      const cls = classes[parseInt(e.key, 10) - 1];
      const ids = [...app.selection].filter((id) => {
        const it = getItem(app.doc, id);
        return it && it.type === 'room';
      });
      if (!ids.length) return false;
      let doc = app.doc;
      for (const id of ids) doc = updateItem(doc, id, { cls });
      app.commit(doc, 'Set class');
      return true;
    }
    return false;
  }

  function onDoubleClick(e, pt) {
    const hit = app.canvas.hitTest(e.clientX, e.clientY);
    if (!hit) return;
    const item = getItem(app.doc, hit.id);
    if (!item || item.type !== 'room') return;
    if (item.shape === 'poly' && hit.part === 'body') {
      // Insert a vertex at the nearest point on the closest edge to the click.
      const pts = item.points;
      let best = null;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const t = clamp01(projectT(pt, a, b));
        const px = a[0] + (b[0] - a[0]) * t;
        const py = a[1] + (b[1] - a[1]) * t;
        const d = dist([pt.x, pt.y], [px, py]);
        if (!best || d < best.d) best = { d, i, point: [Math.round(px), Math.round(py)] };
      }
      if (best && best.d < 20) {
        const newPts = pts.slice(0, best.i + 1).concat([best.point], pts.slice(best.i + 1));
        app.commit(updateItem(app.doc, item.id, { points: newPts }), 'Add corner');
        return;
      }
    }
    app.prompt('Room number', item.number, { validate: 'roomNumber' }).then((value) => {
      if (value == null) return;
      const doc = updateItem(app.doc, item.id, { number: value });
      app.commit(doc, 'Rename');
    });
  }

  function projectT(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return 0;
    return ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / len2;
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function cancel() {
    drag = null;
    app.canvas.setGuides([]);
  }

  return {
    name: 'select',
    hint: 'Click to select, drag to move, Delete to remove. 1-5 change class.',
    onDown,
    onMove,
    onUp,
    onKey,
    onDoubleClick,
    cancel,
  };
}
