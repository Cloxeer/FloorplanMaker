// select.js
// Select tool: click/shift-click, marquee, move selection (magnet snap),
// resize via handles, label drag (pins label), repeat handle -> duplicateInRow,
// arrow-key nudge, delete, 1-5 class change, floor vertex drag, double-click
// rename. Depends on: js/model/document.js (updateItem, setFloor, getItem),
// js/model/geometry.js (bbox), ./common.js (boxOf, moveItem, resizeRect,
// collectSnapTargets).

import { updateItem, setFloor, getItem, removeItems } from '../../model/document.js';
import { bbox, dist } from '../../model/geometry.js';
import { boxOf, moveItem, resizeRect, collectSnapTargets } from './common.js';

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
    };
  }

  function onDown(e, pt) {
    const hit = app.canvas.hitTest(e.clientX, e.clientY);

    if (hit && hit.id === 'floor' && hit.part.startsWith('floor-vertex:') && app.selection.has('floor')) {
      const i = parseInt(hit.part.split(':')[1], 10);
      drag = { kind: 'floor-vertex', index: i, startPts: app.doc.floor.points.map((p) => [...p]) };
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
        drag = { kind: 'vertex', id: hit.id, index: i, startPts: item.points.map((p) => [...p]) };
      }
      return;
    }

    if (hit && hit.part && hit.part.startsWith('handle:')) {
      const handleName = hit.part.split(':')[1];
      const item = getItem(app.doc, hit.id);
      if (item) drag = { kind: 'resize', id: hit.id, handle: handleName, startItem: item };
      return;
    }

    if (hit && hit.part === 'label') {
      const item = getItem(app.doc, hit.id);
      if (item) {
        if (!app.selection.has(hit.id)) app.setSelection([hit.id]);
        drag = { kind: 'label', id: hit.id, startPt: pt, startLabel: { ...(item.label || {}) } };
      }
      return;
    }

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
      for (const id of drag.ids) {
        const item = getItem(app.doc, id);
        if (!item) continue;
        const patch = moveItem(item, dx, dy);
        if (item.shape === 'poly') {
          app.canvas.patchNode(id, {}); // polygon points handled via patchLabel-less path
          const node = document.querySelector(`[data-id="${id}"][data-part="body"]`);
          if (node) node.setAttribute('points', patch.points.map((p) => p.join(',')).join(' '));
        } else {
          app.canvas.patchNode(id, { x: patch.x, y: patch.y });
        }
        const p = { x: (item.x != null ? item.x + dx : 0), y: (item.y != null ? item.y + dy : 0) };
        if (item.type === 'room') {
          app.canvas.patchLabel(id, {});
        }
      }
      return;
    }

    if (drag.kind === 'resize') {
      const patch = resizeRect(drag.startItem, drag.handle, pt);
      drag.lastPatch = patch;
      app.canvas.patchNode(drag.id, { x: patch.x, y: patch.y, width: patch.w, height: patch.h });
      return;
    }

    if (drag.kind === 'label') {
      const dx = pt.x - drag.startPt.x;
      const dy = pt.y - drag.startPt.y;
      if (!drag.lastLabel && Math.abs(dx) < 3 && Math.abs(dy) < 3) return; // a click, not a drag: keep the label unpinned
      const baseX = drag.startLabel.x != null ? drag.startLabel.x : 0;
      const baseY = drag.startLabel.y != null ? drag.startLabel.y : 0;
      const item = getItem(app.doc, drag.id);
      const x = Math.round((drag.startLabel.pinned ? baseX : (item ? itemCentroidX(item) : 0)) + dx);
      const y = Math.round((drag.startLabel.pinned ? baseY : (item ? itemCentroidY(item) : 0)) + dy);
      drag.lastLabel = { x, y };
      app.canvas.patchLabel(drag.id, { x, y });
      return;
    }

    if (drag.kind === 'vertex') {
      const snapped = app.snap(pt, { ignoreIds: new Set([drag.id]) });
      const pts = drag.startPts.map((p) => [...p]);
      pts[drag.index] = [Math.round(snapped.x), Math.round(snapped.y)];
      drag.lastPts = pts;
      const node = document.querySelector(`[data-id="${drag.id}"][data-part="body"]`);
      if (node) node.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
      return;
    }

    if (drag.kind === 'floor-vertex') {
      const pts = drag.startPts.map((p) => [...p]);
      pts[drag.index] = [Math.round(pt.x), Math.round(pt.y)];
      drag.lastPts = pts;
      const node = document.querySelector('[data-id="floor"]');
      if (node) node.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
      return;
    }

    if (drag.kind === 'marquee') {
      drag.lastPt = pt;
    }
  }

  function itemCentroidX(item) {
    const b = boxOf(item);
    return b.x + b.w / 2;
  }
  function itemCentroidY(item) {
    const b = boxOf(item);
    return b.y + b.h / 2;
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
    } else if (drag.kind === 'label' && drag.lastLabel) {
      const doc = updateItem(app.doc, drag.id, { label: { pinned: true, x: drag.lastLabel.x, y: drag.lastLabel.y } });
      app.commit(doc, 'Move label');
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
    app.prompt('Room number', item.number).then((value) => {
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
