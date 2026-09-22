// stage.js
// The drawing surface, built on Fabric.js 6 (pinned, from jsDelivr). Owns the
// <canvas id="canvas">: viewport (wheel zoom / space+drag / touch pan), the
// object registry and its diff against the immutable document, the onion-skin
// background image, grid, guides, ghosts and route overlays.
// The viewport itself lives in stageView.js, interaction (move/scale/rotate/
// point editing/commits) in stageEdit.js, the drawing tools in stageTools.js,
// snapping in stageSnap.js.
// Depends on: fabric@6.7.1, js/view/stageObjects.js, js/view/stageView.js,
// js/view/stageEdit.js, js/view/stageTools.js, js/view/stageSnap.js.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
import {
  LAYER, buildItem, buildFloor, rebuildFloorPoints, buildGhost, buildGuide, buildRoute, pulseGhost,
  hallIntersection, buildHallOverlap,
} from './stageObjects.js';
import { createSnapper } from './stageSnap.js';
import { attachView } from './stageView.js';
import { attachEditing } from './stageEdit.js';
import { attachTools } from './stageTools.js';

function gridPattern() {
  const c = document.createElement('canvas');
  c.width = 20;
  c.height = 20;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#cfd4da';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(20, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 20);
  ctx.stroke();
  return new fabric.Pattern({ source: c, repeat: 'repeat' });
}

export function createStage(containerEl, app) {
  const el = containerEl.querySelector('#canvas') || document.getElementById('canvas');
  const canvas = new fabric.Canvas(el, {
    preserveObjectStacking: true,
    renderOnAddRemove: false,
    enablePointerEvents: true,
    selection: true,
    uniformScaling: false,
    selectionColor: 'rgba(47,111,235,0.12)',
    selectionBorderColor: '#2f6feb',
    backgroundColor: '#e9ebee',
    fireRightClick: false,
    stopContextMenu: true,
  });
  canvas.setDimensions({
    width: Math.max(1, containerEl.clientWidth),
    height: Math.max(1, containerEl.clientHeight),
  });

  const objects = new Map(); // item id -> main fabric object
  const extras = new Map(); // item id -> [companion objects]
  const overlays = { guides: [], ghosts: [], route: [], hallOverlap: [] };
  let gridRect = null;
  let doc = null;
  let prevDoc = null;
  let photo = null;
  let onion = 0.5;
  let planOpacity = 1;
  let destroyed = false;

  const snapper = createSnapper(app);

  function render() {
    if (!destroyed) canvas.requestRenderAll();
  }

  function restack() {
    canvas._objects.sort((a, b) => (a.zLayer != null ? a.zLayer : LAYER.room) - (b.zLayer != null ? b.zLayer : LAYER.room));
  }

  const view = attachView(canvas, app, containerEl, render);
  const { getView, setView, zoomTo, toPlan, applyCursor } = view;


  // ------------------------------------------------------------ doc diff ---
  function dropItem(id) {
    const obj = objects.get(id);
    if (obj) canvas.remove(obj);
    objects.delete(id);
    const ex = extras.get(id);
    if (ex) for (const o of ex) canvas.remove(o);
    extras.delete(id);
  }
  function addItem(item) {
    const built = buildItem(item, app.gridOn ? 5 : null);
    if (!built.length) return;
    const [main, ...rest] = built;
    main.opacity = planOpacity;
    objects.set(item.id, main);
    canvas.add(main);
    if (rest.length) {
      for (const o of rest) { o.opacity = planOpacity; canvas.add(o); }
      extras.set(item.id, rest);
    }
  }

  function syncFloor(newDoc) {
    const pts = newDoc.floor && newDoc.floor.points;
    const existing = objects.get('floor');
    if (!pts || pts.length < 3) {
      if (existing) dropItem('floor');
      return;
    }
    if (!existing) {
      const poly = buildFloor(pts, 5);
      poly.opacity = planOpacity;
      objects.set('floor', poly);
      canvas.add(poly);
      return;
    }
    if (prevDoc && prevDoc.floor === newDoc.floor) return;
    rebuildFloorPoints(existing, pts);
  }

  function setDoc(newDoc) {
    editing.runSilently(() => applyDoc(newDoc));
    editing.reselect();
    render();
  }

  function applyDoc(newDoc) {
    const prevItems = prevDoc ? prevDoc.items : [];
    const bigChange = Math.abs(newDoc.items.length - prevItems.length) > 50;
    if (bigChange) {
      for (const id of [...objects.keys()]) if (id !== 'floor') dropItem(id);
      for (const item of newDoc.items) addItem(item);
    } else {
      const prevById = new Map(prevItems.map((it) => [it.id, it]));
      const nextIds = new Set(newDoc.items.map((it) => it.id));
      for (const it of prevItems) if (!nextIds.has(it.id)) dropItem(it.id);
      for (const item of newDoc.items) {
        const before = prevById.get(item.id);
        if (before === item && objects.has(item.id)) continue;
        if (objects.has(item.id)) dropItem(item.id);
        addItem(item);
      }
    }
    doc = newDoc;
    prevDoc = newDoc;
    snapper.invalidate();
    syncFloor(newDoc);
    refreshHallOverlaps(newDoc);
    restack();
  }

  function refreshHallOverlaps(newDoc) {
    clearOverlay('hallOverlap');
    const halls = (newDoc.items || []).filter((it) => it.type === 'hall');
    for (let i = 0; i < halls.length; i += 1) {
      for (let j = i + 1; j < halls.length; j += 1) {
        const rect = hallIntersection(halls[i], halls[j]);
        if (rect) {
          const obj = buildHallOverlap(rect);
          overlays.hallOverlap.push(obj);
          canvas.add(obj);
        }
      }
    }
  }

  // ------------------------------------------------------------ overlays ---
  function clearOverlay(name) {
    for (const o of overlays[name]) canvas.remove(o);
    overlays[name] = [];
  }
  function setGuides(list) {
    clearOverlay('guides');
    if (list && list.length) {
      const view = getView();
      for (const g of list) {
        const line = buildGuide(g, view);
        overlays.guides.push(line);
        canvas.add(line);
      }
      restack();
    }
    render();
  }
  function setGhosts(list, fit = false) {
    clearOverlay('ghosts');
    (list || []).forEach((g, i) => {
      const obj = buildGhost(g, g.index != null ? g.index : i);
      obj.opacity = planOpacity;
      overlays.ghosts.push(obj);
      canvas.add(obj);
    });
    restack();
    render();
    if (overlays.ghosts.length) {
      // Only on a fresh detection do we fit the whole plan so every ghost is
      // on screen; re-renders (keeping one, OCR updates) keep the user's zoom.
      if (fit) zoomTo(true);
      overlays.ghosts.forEach((obj) => pulseGhost(obj, render));
    }
  }
  function setRoutePath(pts) {
    clearOverlay('route');
    if (pts && pts.length >= 2) {
      for (const o of buildRoute(pts)) {
        overlays.route.push(o);
        canvas.add(o);
      }
      restack();
    }
    render();
  }

  async function setPhoto(next) {
    photo = next || null;
    if (!photo) {
      canvas.backgroundImage = undefined;
      render();
      return;
    }
    const img = await fabric.FabricImage.fromURL(photo.dataUrl);
    if (destroyed) return;
    img.set({
      left: 0, top: 0, originX: 'left', originY: 'top', opacity: onion,
      selectable: false, evented: false,
    });
    if (photo.width) img.scaleX = photo.width / (img.width || photo.width);
    if (photo.height) img.scaleY = photo.height / (img.height || photo.height);
    canvas.backgroundImage = img;
    render();
  }
  function setOnion(op) {
    onion = op;
    if (canvas.backgroundImage) canvas.backgroundImage.opacity = op;
    render();
  }
  function flashPhoto(onFlag) {
    if (canvas.backgroundImage) canvas.backgroundImage.opacity = onFlag ? 1 : onion;
    render();
  }
  function setPlanOpacity(op) {
    planOpacity = op;
    for (const obj of canvas.getObjects()) {
      if (obj.itemId || obj.itemType) obj.set({ opacity: op });
    }
    render();
  }
  function setGrid(onFlag) {
    if (onFlag && !gridRect) {
      gridRect = new fabric.Rect({
        left: -20000, top: -20000, width: 60000, height: 60000, fill: gridPattern(),
        selectable: false, evented: false, objectCaching: false, excludeFromExport: true,
      });
      gridRect.zLayer = LAYER.grid;
      gridRect.overlay = true;
      canvas.add(gridRect);
      restack();
    } else if (!onFlag && gridRect) {
      canvas.remove(gridRect);
      gridRect = null;
    }
    render();
  }

  // ---------------------------------------------------------- composition --
  const ctx = {
    fabric, canvas, app, objects, extras, snapper, render, restack, toPlan, getView, setGuides,
    getDoc: () => doc,
    isPanning: view.isPanning,
  };
  const editing = attachEditing(ctx);
  const tools = attachTools(ctx, editing);
  app._tools = tools.stubs;

  const unsubTool = app.subscribe((evt) => {
    if (evt.type === 'tool') { tools.cancel(); applyCursor(); }
  });

  const ro = new ResizeObserver(() => {
    if (destroyed) return;
    canvas.setDimensions({
      width: Math.max(1, containerEl.clientWidth),
      height: Math.max(1, containerEl.clientHeight),
    });
    render();
  });
  ro.observe(containerEl);
  applyCursor();

  function destroy() {
    destroyed = true;
    ro.disconnect();
    unsubTool();
    view.destroyView();
    editing.destroy();
    tools.destroy();
    canvas.dispose();
  }

  return {
    setDoc,
    setSelection: (ids) => editing.setSelection(ids),
    setPhoto,
    setOnion,
    setPlanOpacity,
    flashPhoto,
    setGrid,
    setGuides,
    setGhosts,
    setRoutePath,
    dropPiece: (key, clientX, clientY) => tools.dropPiece(key, clientX, clientY),
    toPlan,
    zoomTo,
    getView,
    setView,
    destroy,
    // Escape hatch for the browser test suite (perf measurements).
    fabricCanvas: canvas,
  };
}
