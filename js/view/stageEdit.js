// stageEdit.js
// Interaction on top of Fabric's own move/scale/rotate/point-edit controls:
// selection round-tripping with app.setSelection, snapped dragging/scaling,
// turning a finished transform into one `app.commit`, vertex insertion by
// double-click, the edge hover dot, keyboard delete/nudge and ghost clicks.
// Depends on: fabric@6.7.1, js/model/document.js, js/model/geometry.js,
// js/view/stagePoly.js, js/view/stageSnap.js.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
import { updateItem, removeItems, setFloor, STD } from '../model/document.js';
import { snapToGrid } from '../model/geometry.js';
import { polyPoints, insertVertex, nearestEdge } from './stagePoly.js';
import { absBox } from './stageSnap.js';

const EDGE_TOL = 10;

export function attachEditing(ctx) {
  const { canvas, app, objects, extras, snapper, render, toPlan, setGuides } = ctx;
  let syncing = false;
  // Guards re-entry: committing rebuilds objects and reselects, and Fabric's
  // discardActiveObject finalizes the running transform, which fires
  // `object:modified` again.
  let committing = false;
  let hoverDot = null;
  let textBases = null;
  const dragColors = new Map(); // fabric object -> its original fill/stroke

  // -------------------------------------------------------- drag highlight --
  function paintYellow(obj) {
    if (!obj || dragColors.has(obj)) return;
    const kids = obj.getObjects ? obj.getObjects() : [obj];
    const saved = kids.map((o) => ({ o, fill: o.fill, stroke: o.stroke }));
    dragColors.set(obj, saved);
    for (const { o } of saved) {
      if (o.fill !== undefined && o.fill !== null) o.set({ fill: '#fff3b0' });
      if (o.stroke !== undefined && o.stroke !== null) o.set({ stroke: '#e0a800' });
    }
  }
  function clearDragColors() {
    if (!dragColors.size) return;
    for (const saved of dragColors.values()) {
      for (const { o, fill, stroke } of saved) o.set({ fill, stroke });
    }
    dragColors.clear();
  }

  function grid(v) {
    return app.gridOn ? snapToGrid(v, STD.grid) : Math.round(v);
  }

  // ----------------------------------------------------------- selection --
  function currentIds() {
    const active = canvas.getActiveObjects();
    return active.map((o) => o.itemId).filter(Boolean);
  }
  function onSelectionEvent() {
    if (syncing) return;
    syncing = true;
    app.setSelection(currentIds());
    syncing = false;
  }
  function setSelection(ids) {
    if (syncing) return;
    syncing = true;
    canvas.discardActiveObject();
    const objs = (ids || []).map((id) => objects.get(id)).filter(Boolean);
    if (objs.length === 1) {
      canvas.setActiveObject(objs[0]);
    } else if (objs.length > 1) {
      canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas }));
    }
    syncing = false;
    render();
  }
  // Removing an object makes Fabric clear the selection, which would wipe
  // app.selection mid-diff; stage.js wraps the whole diff in this.
  function runSilently(fn) {
    const before = syncing;
    syncing = true;
    try { fn(); } finally { syncing = before; }
  }

  // Objects are rebuilt on every commit, so the selection has to be re-applied.
  // It is deferred by a microtask because Fabric finishes its own mouse-up
  // bookkeeping (which clears the selection whose object just disappeared)
  // after our `object:modified` handler returns.
  function reselect() {
    const wanted = [...app.selection];
    if (!wanted.length) return;
    queueMicrotask(() => {
      if (!wanted.every((id) => objects.has(id))) return;
      app.setSelection(wanted);
    });
  }
  canvas.on('selection:created', onSelectionEvent);
  canvas.on('selection:updated', onSelectionEvent);
  canvas.on('selection:cleared', onSelectionEvent);

  // -------------------------------------------------------------- moving --
  function ignoreSet(target) {
    const ids = new Set();
    if (target.itemId) ids.add(target.itemId);
    if (target.getObjects) for (const o of target.getObjects()) if (o.itemId) ids.add(o.itemId);
    return ids;
  }

  canvas.on('object:moving', (opt) => {
    const t = opt.target;
    if (!t) return;
    paintYellow(t);
    const box = absBox(t);
    const { dx, dy, guides } = snapper.snapBox(box, {
      ignoreIds: ignoreSet(t), alt: !!(opt.e && opt.e.altKey),
    });
    if (dx || dy) t.set({ left: t.left + dx, top: t.top + dy });
    followExtras(t);
    setGuides(guides);
  });

  // Poly rooms carry their number as a separate text object; keep it under the
  // pointer while the polygon is dragged (the commit re-centres it exactly).
  function followExtras(t) {
    const companions = t.itemId && extras.get(t.itemId);
    if (!companions) return;
    const last = t.__lastPos;
    if (last) {
      const dx = t.left - last.x;
      const dy = t.top - last.y;
      for (const o of companions) o.set({ left: o.left + dx, top: o.top + dy });
    }
    t.__lastPos = { x: t.left, y: t.top };
  }

  function counterScaleText(t) {
    if (!t.getObjects) return;
    if (!textBases) {
      textBases = new Map();
      for (const c of t.getObjects()) {
        if (c.isType && c.isType('text')) textBases.set(c, { x: c.scaleX, y: c.scaleY });
      }
    }
    for (const [c, base] of textBases) {
      c.set({ scaleX: base.x / (t.scaleX || 1), scaleY: base.y / (t.scaleY || 1) });
    }
  }

  canvas.on('object:scaling', (opt) => {
    const t = opt.target;
    if (!t) return;
    paintYellow(t);
    counterScaleText(t);
    const corner = (opt.transform && opt.transform.corner) || '';
    const box = absBox(t);
    const xEdges = [];
    const yEdges = [];
    if (corner.includes('l')) xEdges.push(box.x);
    if (corner.includes('r')) xEdges.push(box.x + box.w);
    if (corner.includes('t')) yEdges.push(box.y);
    if (corner.includes('b')) yEdges.push(box.y + box.h);
    if (!xEdges.length && !yEdges.length) return;
    const { dx, dy, guides } = snapper.snapBox(box, {
      ignoreIds: ignoreSet(t), alt: !!(opt.e && opt.e.altKey), xEdges, yEdges,
    });
    if (dx && box.w > 1) {
      if (corner.includes('l')) {
        t.scaleX *= (box.w - dx) / box.w;
        t.left += dx;
      } else {
        t.scaleX *= (box.w + dx) / box.w;
      }
    }
    if (dy && box.h > 1) {
      if (corner.includes('t')) {
        t.scaleY *= (box.h - dy) / box.h;
        t.top += dy;
      } else {
        t.scaleY *= (box.h + dy) / box.h;
      }
    }
    setGuides(guides);
  });

  // ------------------------------------------------------ commit changes --
  function patchFor(obj, doc) {
    const item = doc.items.find((it) => it.id === obj.itemId);
    if (!item) return null;
    if (item.type === 'compass') {
      return { x: Math.round(obj.left), y: Math.round(obj.top), deg: Math.round(obj.angle || 0) };
    }
    if (item.type === 'room' && item.shape === 'poly') {
      return { points: polyPoints(obj).map(([x, y]) => [grid(x), grid(y)]) };
    }
    if (item.type === 'door') return null;
    const box = absBox(obj);
    return {
      x: grid(box.x), y: grid(box.y),
      w: Math.max(5, grid(box.w)), h: Math.max(5, grid(box.h)),
    };
  }

  canvas.on('object:modified', (opt) => {
    const t = opt.target;
    if (!t || committing) return;
    committing = true;
    try {
      applyModified(t);
    } finally {
      committing = false;
    }
  });

  function applyModified(t) {
    textBases = null;
    t.__lastPos = null;
    clearDragColors();
    setGuides([]);
    snapper.invalidate();
    const doc = app.doc;
    if (!doc) return;
    if (t.itemType === 'floor') {
      const pts = polyPoints(t).map(([x, y]) => [grid(x), grid(y)]);
      app.commit(setFloor(doc, pts), 'Edit outline');
      return;
    }
    const targets = t.itemId ? [t] : (t.getObjects ? t.getObjects() : []);
    let next = doc;
    let changed = false;
    for (const obj of targets) {
      if (!obj.itemId || obj.itemId === 'floor') continue;
      const patch = patchFor(obj, doc);
      if (!patch) continue;
      next = updateItem(next, obj.itemId, patch);
      changed = true;
    }
    if (changed) app.commit(next, 'Move');
    else render();
  }

  canvas.on('mouse:up', () => { clearDragColors(); setGuides([]); });

  // -------------------------------------------- vertex insert / hover dot --
  function activePoly() {
    const a = canvas.getActiveObject();
    if (!a) return null;
    if (a.itemType === 'floor') return a;
    if (a.itemType === 'room' && a.points) return a;
    return null;
  }

  function clearDot() {
    if (hoverDot) {
      canvas.remove(hoverDot);
      hoverDot = null;
      render();
    }
  }

  canvas.on('mouse:move', (opt) => {
    const poly = activePoly();
    if (!poly || !opt.e) { clearDot(); return; }
    const p = toPlan(opt.e.clientX, opt.e.clientY);
    const edge = nearestEdge(polyPoints(poly), p);
    const scale = canvas.getZoom() || 1;
    if (!edge || edge.dist > EDGE_TOL / scale + 4) { clearDot(); return; }
    if (!hoverDot) {
      hoverDot = new fabric.Circle({
        radius: 5 / scale, fill: '#1a73e8', originX: 'center', originY: 'center',
        selectable: false, evented: false, objectCaching: false,
      });
      hoverDot.zLayer = 9;
      hoverDot.overlay = true;
      canvas.add(hoverDot);
    }
    hoverDot.set({ left: edge.x, top: edge.y, radius: 5 / scale });
    render();
  });

  canvas.on('mouse:dblclick', (opt) => {
    const poly = activePoly();
    if (!poly || !opt.e) return;
    const p = toPlan(opt.e.clientX, opt.e.clientY);
    const pts = polyPoints(poly);
    const edge = nearestEdge(pts, p);
    const scale = canvas.getZoom() || 1;
    if (!edge || edge.dist > EDGE_TOL / scale + 6) return;
    const next = insertVertex(pts, p).map(([x, y]) => [grid(x), grid(y)]);
    clearDot();
    if (poly.itemType === 'floor') app.commit(setFloor(app.doc, next), 'Add corner');
    else app.commit(updateItem(app.doc, poly.itemId, { points: next }), 'Add corner');
  });

  // --------------------------------------------------------- ghost clicks --
  canvas.on('mouse:down', (opt) => {
    const t = opt.target;
    if (t && t.ghostIndex != null) {
      window.dispatchEvent(new CustomEvent('ghost-accept', { detail: { index: t.ghostIndex } }));
    }
  });

  // ------------------------------------------------------------ keyboard --
  function isTyping(e) {
    if (document.querySelector('.modal-backdrop')) return true;
    const el = e.target;
    return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
  }
  function deleteSelection() {
    const ids = [...app.selection];
    if (!ids.length) return;
    let next = app.doc;
    const itemIds = ids.filter((id) => id !== 'floor');
    if (itemIds.length) next = removeItems(next, itemIds);
    if (ids.includes('floor')) next = setFloor(next, null);
    syncing = true;
    canvas.discardActiveObject();
    syncing = false;
    app.commit(next, 'Delete');
    app.setSelection([]);
  }
  function nudge(dx, dy) {
    const ids = [...app.selection].filter((id) => id !== 'floor');
    if (!ids.length) return;
    let next = app.doc;
    for (const id of ids) {
      const item = next.items.find((it) => it.id === id);
      if (!item) continue;
      if (item.shape === 'poly') next = updateItem(next, id, { points: item.points.map(([x, y]) => [x + dx, y + dy]) });
      else if (item.type === 'door') next = updateItem(next, id, { x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy, label: { x: item.label.x + dx, y: item.label.y + dy } });
      else next = updateItem(next, id, { x: item.x + dx, y: item.y + dy });
    }
    app.commit(next, 'Nudge');
  }
  function onKeyDown(e) {
    if (isTyping(e)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key]) {
      e.preventDefault();
      nudge(map[e.key][0], map[e.key][1]);
    }
  }
  window.addEventListener('keydown', onKeyDown);

  return {
    setSelection,
    reselect,
    runSilently,
    clearDot,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
