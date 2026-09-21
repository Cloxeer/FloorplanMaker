// stageView.js
// Viewport behaviour for the Fabric stage: plan<->client coordinate mapping,
// fit-to-document zoom, wheel zoom around the pointer, space / middle-button /
// pan-tool dragging, two-finger touch pan+pinch, and the tool cursor.
// Depends on: fabric@6.7.1, the Fabric canvas and the shared `app` object.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const DRAW_TOOLS = new Set(['room', 'poly', 'floor', 'door', 'hall', 'stair', 'compass']);

export function attachView(canvas, app, containerEl, render) {
  const listeners = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }
  function getDoc() { return app.doc; }

  function getView() {
    const vpt = canvas.viewportTransform;
    const zoom = vpt[0] || 1;
    return {
      x: -vpt[4] / zoom,
      y: -vpt[5] / zoom,
      w: canvas.getWidth() / zoom,
      h: canvas.getHeight() / zoom,
      zoom,
    };
  }
  function setView(v) {
    const cur = getView();
    const zoom = v.zoom || cur.zoom;
    const x = v.x != null ? v.x : cur.x;
    const y = v.y != null ? v.y : cur.y;
    canvas.setViewportTransform([zoom, 0, 0, zoom, -x * zoom, -y * zoom]);
    render();
  }
  function zoomTo(fit = true) {
    const doc = getDoc();
    if (!doc || !fit) return;
    const vb = doc.viewBox;
    const margin = 24;
    const availW = Math.max(1, canvas.getWidth() - margin * 2);
    const availH = Math.max(1, canvas.getHeight() - margin * 2);
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(availW / vb.w, availH / vb.h)));
    const w = canvas.getWidth() / zoom;
    const h = canvas.getHeight() / zoom;
    setView({ zoom, x: vb.x + vb.w / 2 - w / 2, y: vb.y + vb.h / 2 - h / 2 });
  }
  function toPlan(clientX, clientY) {
    const rect = canvas.upperCanvasEl.getBoundingClientRect();
    const p = new fabric.Point(clientX - rect.left, clientY - rect.top);
    return fabric.util.transformPoint(p, fabric.util.invertTransform(canvas.viewportTransform));
  }

  canvas.on('mouse:wheel', (opt) => {
    const e = opt.e;
    let zoom = canvas.getZoom() * 0.999 ** (e.deltaY || 0);
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const rect = canvas.upperCanvasEl.getBoundingClientRect();
    canvas.zoomToPoint(new fabric.Point(e.clientX - rect.left, e.clientY - rect.top), zoom);
    e.preventDefault();
    e.stopPropagation();
    app.emit({ type: 'view' });
  });

  // space / middle-button / pan-tool dragging
  let spaceHeld = false;
  let panning = null;
  function wantsPan(e) {
    return spaceHeld || e.button === 1 || app.toolName === 'pan';
  }
  on(window, 'keydown', (e) => {
    if (e.code === 'Space' && !spaceHeld && !/^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName || '')) {
      spaceHeld = true;
      canvas.defaultCursor = 'grab';
      canvas.selection = false;
    }
  });
  on(window, 'keyup', (e) => {
    if (e.code === 'Space') {
      spaceHeld = false;
      canvas.selection = app.toolName === 'select';
      applyCursor();
    }
  });

  canvas.on('mouse:down', (opt) => {
    if (!wantsPan(opt.e)) return;
    panning = { x: opt.e.clientX, y: opt.e.clientY, view: getView() };
    canvas.selection = false;
    canvas.setCursor('grabbing');
  });
  canvas.on('mouse:move', (opt) => {
    if (!panning) return;
    const zoom = canvas.getZoom();
    setView({
      x: panning.view.x - (opt.e.clientX - panning.x) / zoom,
      y: panning.view.y - (opt.e.clientY - panning.y) / zoom,
    });
  });
  canvas.on('mouse:up', () => {
    if (!panning) return;
    panning = null;
    canvas.selection = app.toolName === 'select';
    applyCursor();
  });

  // two-finger pan / pinch zoom
  let touch = null;
  function touchInfo(e) {
    const [a, b] = [e.touches[0], e.touches[1]];
    return {
      cx: (a.clientX + b.clientX) / 2,
      cy: (a.clientY + b.clientY) / 2,
      d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    };
  }
  on(canvas.upperCanvasEl, 'touchstart', (e) => {
    if (e.touches.length !== 2) return;
    touch = { ...touchInfo(e), view: getView() };
  }, { passive: false });
  on(canvas.upperCanvasEl, 'touchmove', (e) => {
    if (!touch || e.touches.length !== 2) return;
    e.preventDefault();
    const now = touchInfo(e);
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, touch.view.zoom * (now.d / (touch.d || 1))));
    const w = canvas.getWidth() / zoom;
    const h = canvas.getHeight() / zoom;
    setView({
      zoom,
      x: touch.view.x + touch.view.w / 2 - w / 2 - (now.cx - touch.cx) / zoom,
      y: touch.view.y + touch.view.h / 2 - h / 2 - (now.cy - touch.cy) / zoom,
    });
  }, { passive: false });
  on(canvas.upperCanvasEl, 'touchend', () => { touch = null; });

  function applyCursor() {
    if (app.toolName === 'pan' || spaceHeld) canvas.defaultCursor = 'grab';
    else if (DRAW_TOOLS.has(app.toolName)) canvas.defaultCursor = 'crosshair';
    else canvas.defaultCursor = 'default';
    canvas.skipTargetFind = DRAW_TOOLS.has(app.toolName) || app.toolName === 'pan';
    canvas.selection = app.toolName === 'select' && !spaceHeld;
    render();
  }
  function destroyView() {
    for (const [target, type, fn, opts] of listeners) target.removeEventListener(type, fn, opts);
    listeners.length = 0;
  }
  void containerEl;

  return {
    getView, setView, zoomTo, toPlan, applyCursor, destroyView,
    isPanning: () => !!panning || spaceHeld,
  };
}
