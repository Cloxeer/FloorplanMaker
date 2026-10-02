// attention.js (view)
// Outlines in yellow, on the plan, every item the "Worth a look" list is about (errors in orange),
// with a soft pulse so they catch the eye. Drawn on the stage canvas after each render, so it
// never touches the document, selection, undo or export, and follows zoom and pan exactly.
// Cheap by construction: bounding boxes are precomputed, only items in the viewport are drawn, and
// with many visible items it falls back to one plain stroke per colour with no pulse. The pulse
// loop also pauses while the user drags or zooms.
// Depends on: js/model/attention.js, js/model/document.js (roomPolygon), app.canvas.fabricCanvas.

import { attentionTargets } from '../model/attention.js';
import { roomPolygon } from '../model/document.js';

const YELLOW = '#f2b600', ORANGE = '#ff6a1a';
const RICH_MAX = 120; // more visible items than this: plain style, no animation

function outlineOf(it) {
  if (it.type === 'room') return roomPolygon(it);
  if (it.type === 'hall' || it.type === 'stair') return [[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]];
  if (it.type === 'door') return [[it.x1, it.y1], [it.x2, it.y2]];
  return null;
}

function boxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

function trace(ctx, p) {
  const pts = p.pts;
  for (let i = 0; i < pts.length; i++) (i ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[0][0], pts[0][1]));
  if (!p.line) ctx.closePath();
}

const PREF = 'fp.worthALookHighlights';
const readPref = () => { try { return localStorage.getItem(PREF) !== 'off'; } catch (e) { return true; } };
const savePref = (on) => { try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch (e) { /* private mode: just not remembered */ } };

export function mountAttention(app) {
  let enabled = readPref(); // the yellow outlines: on by default
  const canvas = app.canvas && app.canvas.fabricCanvas;
  let targets = new Map();
  let polys = [];
  let timer = 0, t0 = performance.now(), alive = true, busy = false, busyTimer = 0;

  function recompute() {
    targets = new Map(); polys = [];
    const doc = app.doc;
    if (!doc || !doc.items || !doc.items.length) return;
    targets = attentionTargets(doc, app.validation);
    if (!targets.size) return;
    const byId = new Map();
    for (const i of doc.items) if (targets.has(i.id)) byId.set(i.id, i);
    for (const [id, t] of targets) {
      const it = byId.get(id);
      const pts = it && outlineOf(it);
      if (pts && pts.length >= 2) polys.push({ pts, level: t.level, line: it.type === 'door', box: boxOf(pts) });
    }
  }

  // polys whose box meets the viewport (plan units)
  function visibleNow() {
    const vt = canvas.viewportTransform, z = vt[0] || 1;
    const w = canvas.getWidth(), h = canvas.getHeight();
    const x0 = -vt[4] / z - 10, y0 = -vt[5] / z - 10, x1 = (w - vt[4]) / z + 10, y1 = (h - vt[5]) / z + 10;
    return polys.filter((p) => p.box.x1 >= x0 && p.box.x0 <= x1 && p.box.y1 >= y0 && p.box.y0 <= y1);
  }

  function draw(opt) {
    try {
      if (!enabled || !alive || !canvas || !polys.length || !app.doc || !app.doc.items.length) return;
      const ctx = (opt && opt.ctx) || (canvas.getContext && canvas.getContext());
      if (!ctx || !canvas.viewportTransform) return;
      const vis = visibleNow();
      if (!vis.length) return;
      const vt = canvas.viewportTransform, r = canvas.getRetinaScaling ? canvas.getRetinaScaling() : 1;
      const px = 1 / (canvas.getZoom() || 1); // one screen pixel in plan units
      ctx.save();
      ctx.setTransform(r * vt[0], r * vt[1], r * vt[2], r * vt[3], r * vt[4], r * vt[5]);
      ctx.lineJoin = 'round';
      if (vis.length > RICH_MAX) {
        // cheap: one path and one stroke per colour
        ctx.lineWidth = 2.5 * px; ctx.globalAlpha = 0.9;
        for (const [level, col] of [['warning', YELLOW], ['error', ORANGE]]) {
          ctx.beginPath();
          let any = false;
          for (const p of vis) if ((p.level === 'error') === (level === 'error')) { trace(ctx, p); any = true; }
          if (any) { ctx.strokeStyle = col; ctx.stroke(); }
        }
      } else {
        const pulse = 0.6; // steady
        for (const p of vis) {
          const col = p.level === 'error' ? ORANGE : YELLOW;
          ctx.beginPath();
          trace(ctx, p);
          if (!p.line) { ctx.globalAlpha = 0.10 + 0.12 * pulse; ctx.fillStyle = col; ctx.fill(); }
          ctx.globalAlpha = 0.35 + 0.35 * pulse; // soft glow under the line
          ctx.strokeStyle = col; ctx.lineWidth = 9 * px; ctx.stroke();
          ctx.globalAlpha = 1; ctx.lineWidth = 3.5 * px; ctx.stroke();
        }
      }
      ctx.restore();
    } catch (e) { /* canvas gone (studio re-entry): nothing to draw on */ }
  }

  // No pulsing: a pulse re-draws the whole plan (photo included) ten times a second, which keeps the page busy and
  // makes dragging, panning and zooming lag. The yellow outline is static; it only redraws when something changes.
  const animated = () => false;
  function tick() {
    timer = 0;
    if (!alive || busy || !animated()) return;
    try { canvas.requestRenderAll(); } catch (e) { return; }
    timer = setTimeout(tick, 100);
  }
  function kick() { if (alive && !timer && !busy && animated()) timer = setTimeout(tick, 100); }
  function refresh() {
    if (!alive) return;
    recompute();
    try { if (canvas) canvas.requestRenderAll(); } catch (e) { /* destroyed */ }
    if (!animated() && timer) { clearTimeout(timer); timer = 0; }
    kick();
  }

  const pause = () => { busy = true; if (timer) { clearTimeout(timer); timer = 0; } };
  const resume = () => { busy = false; kick(); };
  const wheel = () => { pause(); clearTimeout(busyTimer); busyTimer = setTimeout(resume, 400); };

  if (canvas) {
    canvas.on('after:render', draw);
    canvas.on('mouse:down', pause);
    canvas.on('mouse:up', resume);
    canvas.on('mouse:wheel', wheel);
  }
  const unsub = app.subscribe((e) => { if (e.type === 'validation' || e.type === 'doc' || e.type === 'project' || e.type === 'step') refresh(); });
  refresh();

  return {
    count: () => targets.size,
    isEnabled: () => enabled,
    setEnabled(on) {
      enabled = !!on;
      savePref(enabled);
      if (!enabled && timer) { clearTimeout(timer); timer = 0; }
      try { if (canvas) canvas.requestRenderAll(); } catch (e) { /* destroyed */ }
      if (enabled) kick();
    },
    destroy() {
      alive = false;
      unsub();
      if (timer) { clearTimeout(timer); timer = 0; }
      clearTimeout(busyTimer);
      try {
        if (canvas) { canvas.off('after:render', draw); canvas.off('mouse:down', pause); canvas.off('mouse:up', resume); canvas.off('mouse:wheel', wheel); }
      } catch (e) { /* canvas already disposed */ }
    },
  };
}
