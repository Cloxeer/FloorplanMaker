// canvas.js
// Owns the single <svg> element: layer groups, node map keyed by item id,
// diff-render on setDoc, pan/zoom/pinch, hit-testing, selection/guides/ghosts/
// route/photo overlays. Depends on: ./canvasRender.js (node/overlay builders),
// ./canvasInput.js (pointer/wheel gesture handling).
// No file over 400 lines: rendering helpers live in canvasRender.js, gesture
// handling in canvasInput.js.

import {
  renderRoom,
  renderDoor,
  renderStair,
  renderCompass,
  renderFloor,
  updateSelectionHandles,
  clearGroup,
  renderGuides,
  renderGhosts,
  renderRoutePath,
  renderPhoto,
  ensureGridPattern,
} from './canvasRender.js';
import { attachCanvasInput } from './canvasInput.js';

const LAYER_NAMES = [
  'photo', 'grid', 'floor', 'rooms', 'labels', 'stairs', 'doors',
  'route', 'ghosts', 'guides', 'selection',
];

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  if (attrs) {
    for (const k in attrs) node.setAttribute(k, attrs[k]);
  }
  return node;
}

export function createCanvas(svgEl, app) {
  const listeners = []; // [target, type, fn]
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  svgEl.setAttribute('touch-action', 'none');
  svgEl.style.touchAction = 'none';

  const layers = {};
  for (const name of LAYER_NAMES) {
    const g = el('g', { class: `layer-${name}` });
    svgEl.appendChild(g);
    layers[name] = g;
  }

  // node map: id -> { root, kind, ...parts }
  const nodes = new Map();
  let doc = null;
  let photoState = null;
  let onionOpacity = 0.5;

  // ---- view state ----
  let view = { x: 0, y: 0, w: 1000, h: 800 };
  function applyViewBox() {
    svgEl.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  }

  function getClientRect() {
    return svgEl.getBoundingClientRect();
  }

  function toPlan(clientX, clientY) {
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(inv);
    return { x: p.x, y: p.y };
  }

  // ---- diff render ----
  function itemKind(item) {
    return item.type;
  }

  function removeNode(id) {
    const n = nodes.get(id);
    if (!n) return;
    if (n.root && n.root.parentNode) n.root.parentNode.removeChild(n.root);
    if (n.hit && n.hit.parentNode) n.hit.parentNode.removeChild(n.hit);
    if (n.label && n.label.parentNode) n.label.parentNode.removeChild(n.label);
    if (n.name && n.name.parentNode) n.name.parentNode.removeChild(n.name);
    nodes.delete(id);
  }

  function buildNode(item) {
    const kind = itemKind(item);
    if (kind === 'room') return renderRoom(item, layers.rooms, layers.labels, el);
    if (kind === 'door') return renderDoor(item, layers.doors, el);
    if (kind === 'stair') return renderStair(item, layers.stairs, el);
    if (kind === 'compass') return renderCompass(item, layers.floor, el);
    return null;
  }

  function updateNode(prevItem, item, rec) {
    const kind = itemKind(item);
    if (prevItem === item) return; // identity unchanged
    if (kind === 'room') {
      renderRoom(item, layers.rooms, layers.labels, el, rec);
    } else if (kind === 'door') {
      renderDoor(item, layers.doors, el, rec);
    } else if (kind === 'stair') {
      renderStair(item, layers.stairs, el, rec);
    } else if (kind === 'compass') {
      renderCompass(item, layers.floor, el, rec);
    }
  }

  let floorNode = null; // { poly }
  let prevDoc = null;

  function diffFloor(newDoc) {
    const prevFloor = prevDoc ? prevDoc.floor : null;
    const nextFloor = newDoc.floor;
    if (prevFloor === nextFloor) return;
    if (floorNode && floorNode.poly && floorNode.poly.parentNode) {
      floorNode.poly.parentNode.removeChild(floorNode.poly);
      floorNode = null;
    }
    if (nextFloor) {
      floorNode = renderFloor(nextFloor, layers.floor, el);
    }
  }

  function setDoc(newDoc) {
    const prevItems = prevDoc ? prevDoc.items : [];
    const prevById = new Map(prevItems.map((it) => [it.id, it]));
    const nextIds = new Set(newDoc.items.map((it) => it.id));

    // removals
    for (const it of prevItems) {
      if (!nextIds.has(it.id)) removeNode(it.id);
    }
    // add/update
    for (const item of newDoc.items) {
      const prevItem = prevById.get(item.id);
      if (!prevItem) {
        const rec = buildNode(item);
        if (rec) nodes.set(item.id, rec);
      } else {
        const rec = nodes.get(item.id);
        if (rec) updateNode(prevItem, item, rec);
      }
    }
    diffFloor(newDoc);
    doc = newDoc;
    prevDoc = newDoc;
  }

  function patchNode(id, attrs) {
    const rec = nodes.get(id);
    if (!rec || !rec.root) return;
    for (const k in attrs) {
      rec.root.setAttribute(k, attrs[k]);
    }
  }

  // Re-render a single item's shape (+ its label, recomputed from the
  // patched geometry, for rooms) using its normal render path, without
  // touching app.doc. Used for live drag feedback so shape/label/name move
  // as one piece with no extra frame of lag.
  function patchItem(item) {
    const rec = nodes.get(item.id);
    if (!rec) return;
    const kind = itemKind(item);
    if (kind === 'room') renderRoom(item, layers.rooms, layers.labels, el, rec);
    else if (kind === 'door') renderDoor(item, layers.doors, el, rec);
    else if (kind === 'stair') renderStair(item, layers.stairs, el, rec);
    else if (kind === 'compass') renderCompass(item, layers.floor, el, rec);
  }

  function patchLabel(id, { x, y, text, cls } = {}) {
    const rec = nodes.get(id);
    if (!rec || !rec.label) return;
    if (x != null) rec.label.setAttribute('x', x);
    if (y != null) rec.label.setAttribute('y', y);
    if (text != null) rec.label.textContent = text;
    if (cls != null) rec.label.setAttribute('class', cls);
  }

  // ---- selection / overlays ----
  function computeScale() {
    return view && view.w ? (svgEl.clientWidth || 1) / view.w : 1;
  }
  // Scale (px per plan unit) for sizing handles. Read once at gesture start
  // and reused for the whole drag so pointermove never touches layout.
  function getHandleScale() {
    return computeScale();
  }
  // opts.scale: precomputed scale (avoids a layout read during drags).
  // opts.overrides: Map id->item with live/patched geometry to draw instead
  // of the committed doc's copy (drag feedback). opts.floor: same, for the
  // floor outline/vertex handles.
  function setSelection(ids, opts) {
    clearGroup(layers.selection);
    if (!doc || !ids || ids.length === 0) return;
    const scale = (opts && opts.scale) || computeScale();
    const overrides = opts && opts.overrides;
    const itemMap = new Map(doc.items.map((it) => [it.id, it]));
    if (overrides) for (const [id, item] of overrides) itemMap.set(id, item);
    const floor = (opts && opts.floor) || doc.floor;
    updateSelectionHandles(itemMap, floor, ids, layers.selection, el, scale);
  }

  function setGuides(guides) {
    renderGuides(guides, layers.guides, el, view);
  }

  function setGhosts(ghosts) {
    renderGhosts(ghosts, layers.ghosts, el);
  }

  function setRoutePath(pts) {
    renderRoutePath(pts, layers.route, svgEl, el);
  }

  function setPhoto(photo) {
    photoState = photo;
    renderPhoto(photo, layers.photo, el, onionOpacity);
  }

  function setOnion(op) {
    onionOpacity = op;
    const img = layers.photo.querySelector('image');
    if (img) img.setAttribute('opacity', op);
  }

  function flashPhoto(on) {
    const img = layers.photo.querySelector('image');
    if (!img) return;
    img.setAttribute('opacity', on ? 1 : onionOpacity);
  }

  function setGrid(on) {
    layers.grid.style.display = on ? '' : 'none';
    if (on) ensureGridPattern(layers.grid, svgEl, el);
  }

  function zoomTo(fit = true) {
    if (!doc) return;
    const vb = doc.viewBox;
    const rect = getClientRect();
    const margin = 24;
    const availW = Math.max(1, rect.width - margin * 2);
    const availH = Math.max(1, rect.height - margin * 2);
    const scale = Math.min(availW / vb.w, availH / vb.h);
    const w = rect.width / scale;
    const h = rect.height / scale;
    const cx = vb.x + vb.w / 2;
    const cy = vb.y + vb.h / 2;
    view = { x: cx - w / 2, y: cy - h / 2, w, h };
    applyViewBox();
  }

  function getView() {
    return { ...view };
  }

  function setView(v) {
    view = { ...view, ...v };
    applyViewBox();
  }

  // ---- hit testing ----
  function hitTest(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return null;
    let node = target;
    while (node && node !== svgEl) {
      if (node.dataset && node.dataset.id) {
        return { id: node.dataset.id, part: node.dataset.part || 'body' };
      }
      node = node.parentNode;
    }
    return null;
  }

  // ---- pointer handling: pan/zoom/pinch (canvasInput.js) + delegate ----
  const { onPointer } = attachCanvasInput(svgEl, on, {
    getView: () => view,
    setView: (v) => {
      view = v;
      applyViewBox();
    },
    getClientRect,
    toPlan,
  });

  function destroy() {
    for (const [target, type, fn, opts] of listeners) {
      target.removeEventListener(type, fn, opts);
    }
    listeners.length = 0;
    if (unsubscribeTool) unsubscribeTool();
  }

  applyViewBox();

  // Cursor feedback: crosshair for drawing tools, default otherwise (CSS
  // keyed off data-tool handles hover-over-selected/handles via classes).
  function applyToolCursor() {
    const drawingTools = new Set(['room', 'poly', 'floor', 'door', 'stair', 'compass']);
    svgEl.dataset.tool = app.toolName || '';
    svgEl.style.cursor = drawingTools.has(app.toolName) ? 'crosshair'
      : app.toolName === 'pan' ? 'grab' : '';
  }
  const unsubscribeTool = app.subscribe ? app.subscribe((evt) => {
    if (evt.type === 'tool') applyToolCursor();
  }) : null;
  applyToolCursor();

  return {
    setDoc,
    patchNode,
    patchItem,
    patchLabel,
    getHandleScale,
    setSelection,
    setGuides,
    setGhosts,
    setRoutePath,
    setPhoto,
    setOnion,
    flashPhoto,
    setGrid,
    toPlan,
    zoomTo,
    setView,
    getView,
    hitTest,
    onPointer,
    destroy,
  };
}
