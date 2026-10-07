// stageView.js
// Viewport behaviour for the Fabric stage: plan<->client coordinate mapping,
// fit-to-document zoom, wheel zoom around the pointer, space / middle-button /
// pan-tool dragging, two-finger touch pan+pinch, and the tool cursor.
// Depends on: fabric@6.7.1, the Fabric canvas and the shared `app` object.

import { unionBox } from '../model/photos.js';
import { createWheelIntent, createZoomSmoother, createDragFilter, createMomentumCut, zoomFactor } from './wheelIntent.js';
import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const DRAW_TOOLS = new Set(['room', 'poly', 'floor', 'door', 'hall', 'stair', 'compass', 'connect']);

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
  // The plan's box: its viewBox, grown to hold every photo (a floor made of several photos reaches past the first).
  function planBox() {
    const doc = getDoc && getDoc();
    if (!doc || !doc.viewBox) return null;
    const vb = doc.viewBox;
    let box = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
    const ph = app.project && [app.project.photo, ...((app.project && app.project.extraPhotos) || [])].filter((p) => p && p.dataUrl);
    const u = ph && ph.length ? unionBox(ph) : null;
    if (u) { const x0 = Math.min(box.x, u.x), y0 = Math.min(box.y, u.y); box = { x: x0, y: y0, w: Math.max(box.x + box.w, u.x + u.w) - x0, h: Math.max(box.y + box.h, u.y + u.h) - y0 }; }
    return box;
  }
  function zoomTo(fit = true) {
    const vb = planBox();
    if (!vb || !fit) return;
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

  // A two-finger drag can never carry the plan (or its photos) completely out of sight: at least a strip of it
  // stays on screen, so one stray flick cannot lose the work.
  function keepPlanInView() {
    const box = planBox();
    if (!box) return;
    const v = canvas.viewportTransform, z = v[0] || 1, W = canvas.getWidth(), H = canvas.getHeight();
    const keep = 80; // screen px of the plan that must stay visible
    const left = box.x * z + v[4], right = (box.x + box.w) * z + v[4], top = box.y * z + v[5], bottom = (box.y + box.h) * z + v[5];
    let nx = v[4], ny = v[5];
    if (right < keep) nx += keep - right; else if (left > W - keep) nx -= left - (W - keep);
    if (bottom < keep) ny += keep - bottom; else if (top > H - keep) ny -= top - (H - keep);
    if (nx !== v[4] || ny !== v[5]) canvas.setViewportTransform([v[0], v[1], v[2], v[3], nx, ny]);
  }

  // Two-finger drag on a trackpad moves the map; a pinch (ctrl + wheel) and a mouse wheel notch zoom.
  // wheelIntent.js tells them apart by the whole stream of events, so a fast flick still moves the map.
  const intent = createWheelIntent();
  const dragFilter = createDragFilter(); // a straight up / down drag does not creep sideways
  const momentumCut = createMomentumCut(); // and the map stays where you let go: no coasting on the OS momentum
  const smoother = createZoomSmoother({
    min: MIN_ZOOM, max: MAX_ZOOM,
    get: () => canvas.getZoom(),
    set: (z, x, y) => { canvas.zoomToPoint(new fabric.Point(x, y), z); app.emit({ type: 'view' }); },
  });
  // Listen on the whole stage, not just the canvas: the zoom buttons, the hand button, the start card and the
  // floating bars sit on top of the canvas, and a wheel over them used to do nothing (and ctrl + scroll there
  // zoomed the whole web page instead).
  const onWheel = (e) => {
    const kind = intent(e);
    if (kind === 'drag') {
      if (momentumCut(e.deltaX, e.deltaY, e.timeStamp)) { e.preventDefault(); e.stopPropagation(); return; }
      const [dx, dy] = dragFilter(e.deltaX, e.deltaY, e.timeStamp);
      canvas.relativePan(new fabric.Point(-dx, -dy));
      keepPlanInView();
      e.preventDefault();
      e.stopPropagation();
      app.emit({ type: 'view' });
      return;
    }
    // pinch, ctrl + scroll and wheel notches all feed one smoother, so the zoom glides (and the tail of a
    // gesture never jumps): it eases toward the asked-for zoom a little each frame, about the pointer
    const rect = canvas.upperCanvasEl.getBoundingClientRect();
    smoother.push(zoomFactor(e, kind), e.clientX - rect.left, e.clientY - rect.top);
    e.preventDefault();
    e.stopPropagation();
  };
  on(containerEl, 'wheel', onWheel, { passive: false });
  // ctrl + scroll over the side panels or the top bar would zoom the whole web page: send it to the plan instead
  // (about the middle of the stage). A plain scroll over the panels still scrolls them.
  const studioEl = containerEl.closest('#studio');
  if (studioEl) {
    on(studioEl, 'wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey) || containerEl.contains(e.target)) return;
      e.preventDefault();
      const r = canvas.upperCanvasEl.getBoundingClientRect();
      smoother.push(zoomFactor(e, 'pinch'), r.width / 2, r.height / 2);
    }, { passive: false });
  }

  // the scroll wheel pressed in: grab the map and drag it (fabric does not report the middle button)
  let grab = null;
  const upper = canvas.upperCanvasEl;
  on(upper, 'mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no browser auto-scroll circle
  on(upper, 'pointerdown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    grab = { x: e.clientX, y: e.clientY, view: getView() };
    try { upper.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    canvas.setCursor('grabbing');
  });
  on(upper, 'pointermove', (e) => {
    if (!grab) return;
    const z = grab.view.zoom;
    setView({ x: grab.view.x - (e.clientX - grab.x) / z, y: grab.view.y - (e.clientY - grab.y) / z });
    app.emit({ type: 'view' });
  });
  const endGrab = (e) => { if (!grab) return; grab = null; try { upper.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ } applyCursor(); };
  on(upper, 'pointerup', endGrab);
  on(upper, 'pointercancel', endGrab);

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
    smoother.cancel();
    for (const [target, type, fn, opts] of listeners) target.removeEventListener(type, fn, opts);
    listeners.length = 0;
  }
  void containerEl;

  return {
    getView, setView, zoomTo, toPlan, applyCursor, destroyView,
    isPanning: () => !!panning || spaceHeld,
  };
}
