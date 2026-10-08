// photoLayer.js (view)
// Several photos on one floor, and moving photos or the drawing to line them up.
//  - Extra photos (project.extraPhotos) are drawn under the plan, next to the main photo.
//  - View > the buttons left of "Photo" and "Drawing" select that layer. Photo: every photo is outlined, drag one
//    to move it, drag a corner of the selected one to turn it (Shift: 15 degree steps; the cursor shows a turn arrow
//    there), use - + to match size; the drawing is shown faint. Drawing:
//    drag anywhere to slide the whole drawing over the photos. "Done" (or Esc) puts you back to normal.
//  - app._photoLayer.arrange() is used right after importing several photos: they arrive apart, ready to move.
// A photo's placement is saved with the project (photo.t); sliding the drawing is one undo step.
// Depends on: js/model/photos.js, fabric (same build as the stage), app.canvas.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
import { tOf, photoCorners, photoCentre, hitPhoto, unionBox, moved, scaledBy, turnedBy, translateDoc, scaleDoc, snapPhoto } from '../model/photos.js';

const BLUE = '#0a84ff';
const FAINT = 0.12;
const GRAB_PX = 18; // a corner of the selected photo turns it when the pointer is within this many screen pixels
const TURN_STEP = 15; // degrees, with Shift held
const TURN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(['<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">',
  ...[['#fff', 4.5], ['#111', 2]].map(([c, w]) => `<path d="M18.5 12a6.5 6.5 0 1 1-1.9-4.6M19 4v4.5h-4.5" stroke="${c}" stroke-width="${w}"/>`), '</svg>'].join(''))}") 12 12, crosshair`;
const CSS = `
.pl-pill { position:absolute; left:50%; bottom:16px; transform:translateX(-50%); z-index:6; display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:center;
  padding:8px 8px 8px 16px; border-radius:22px; background:rgba(255,255,255,.86); -webkit-backdrop-filter:saturate(180%) blur(18px); backdrop-filter:saturate(180%) blur(18px);
  box-shadow:0 6px 24px rgba(0,0,0,.16), 0 0 0 .5px rgba(0,0,0,.1); font:500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#1d1d1f; max-width:calc(100% - 32px); }
.pl-pill span { color:#515154; }
.pl-pill b { color:#1d1d1f; font-weight:600; }
.pl-pill button { border:1px solid #d2d2d7; border-radius:999px; background:#fff; color:#1d1d1f; font:600 13px inherit; padding:5px 11px; cursor:pointer; }
.pl-pill button:disabled { opacity:.4; cursor:default; }
.pl-pill button.pl-done { border:0; background:${BLUE}; color:#fff; padding:6px 16px; }
.pl-pill .pl-tools { display:inline-flex; gap:4px; }
#view-popover .vp-sel { border:1px solid #d2d2d7; border-radius:999px; background:#fff; font-size:11px; padding:2px 9px; cursor:pointer; flex:none; }
#view-popover .vp-sel[aria-pressed="true"] { background:${BLUE}; border-color:${BLUE}; color:#fff; }
`;

export function mountPhotoLayer(app) {
  const canvas = app.canvas && app.canvas.fabricCanvas;
  if (!canvas) return { destroy() {}, arrange() {}, mode: () => null };
  const upper = canvas.upperCanvasEl;
  const styleEl = document.createElement('style'); styleEl.textContent = CSS; document.head.appendChild(styleEl);

  let alive = true, mode = null, sel = -1, drag = null, raf = 0;
  let extraObjs = []; // [{ key, obj }] fabric images for project.extraPhotos
  let lastBg = null, savedView = null, pill = null, preview = null, spaceHeld = false, moved_ = false;

  // ---- the photos, as one list: main photo first, then the extras
  // a photo hidden with the eye in Layers ('photo:0' = main, 'photo:1' = first extra...) is not in this list: it cannot be hit or arranged
  const hiddenPh = () => (app.hiddenPhotos ? app.hiddenPhotos() : new Set());
  const refs = () => {
    const p = app.project, out = [], hid = hiddenPh();
    if (p && p.photo && p.photo.dataUrl && !hid.has(0)) out.push({ main: true, idx: 0, photo: p.photo });
    ((p && p.extraPhotos) || []).forEach((e, j) => { if (e && e.dataUrl && !hid.has(j + 1)) out.push({ main: false, j, idx: j + 1, photo: e }); });
    return out;
  };
  const list = () => refs().map((r) => r.photo);
  function setPhoto(i, next) {
    const r = refs()[i]; if (!r) return;
    if (r.main) app.project.photo = next; else app.project.extraPhotos = app.project.extraPhotos.map((e, j) => (j === r.j ? next : e));
    place();
    redraw();
  }

  // ---- drawing the photos on the stage
  let arrangeOpacity = 1; // while arranging, every photo (main and extras) shares ONE opacity; the Photo slider changes it
  const bgOpacity = () => (canvas.backgroundImage ? canvas.backgroundImage.opacity : 0.5);
  function place() {
    const p = app.project; if (!p) return;
    const bg = canvas.backgroundImage, hid = hiddenPh();
    if (bg) {
      bg.visible = !hid.has(0);
      if (!bg.__base) bg.__base = [bg.scaleX, bg.scaleY];
      const t = tOf(p.photo);
      bg.set({ left: t.x, top: t.y, angle: t.a, scaleX: bg.__base[0] * t.s, scaleY: bg.__base[1] * t.s });
      bg.setCoords();
    }
    extraObjs.forEach(({ obj, j }) => {
      const e = (p.extraPhotos || [])[j]; if (!e) return;
      obj.visible = !hid.has(j + 1);
      const t = tOf(e);
      obj.set({ left: t.x, top: t.y, angle: t.a, scaleX: (e.width / obj.width) * t.s, scaleY: (e.height / obj.height) * t.s });
      obj.setCoords();
    });
    paintOpacity();
  }
  function paintOpacity() {
    const op = mode === 'photo' ? arrangeOpacity : bgOpacity();
    if (canvas.backgroundImage && mode === 'photo') canvas.backgroundImage.opacity = op;
    for (const { obj } of extraObjs) obj.opacity = op;
  }
  let syncing = null, again = false; // one sync at a time: overlapping runs each added their own copy of the same photo
  function sync() {
    if (syncing) { again = true; return syncing; }
    syncing = (async () => { do { again = false; await syncOnce(); } while (again && alive); })().finally(() => { syncing = null; });
    return syncing;
  }
  async function syncOnce() {
    const p = app.project; if (!p || !alive) return;
    const want = (p.extraPhotos || []).map((e, j) => ({ j, key: `${j}:${e && e.dataUrl ? e.dataUrl.length : 0}` })).filter((w) => p.extraPhotos[w.j] && p.extraPhotos[w.j].dataUrl);
    // drop the ones that are gone, keep the ones that match
    extraObjs = extraObjs.filter((x) => { const keep = want.some((w) => w.key === x.key && w.j === x.j); if (!keep) canvas.remove(x.obj); return keep; });
    for (const w of want) {
      if (extraObjs.some((x) => x.key === w.key && x.j === w.j)) continue;
      try {
        const e = p.extraPhotos[w.j];
        const obj = await fabric.FabricImage.fromURL(e.dataUrl);
        if (!alive) return;
        obj.set({ originX: 'left', originY: 'top', selectable: false, evented: false, opacity: bgOpacity() });
        obj.zLayer = -20; obj.overlay = false;
        canvas.add(obj); canvas.sendObjectToBack(obj);
        extraObjs.push({ key: w.key, j: w.j, obj });
      } catch (err) { /* an unreadable photo: skip it */ }
    }
    place();
    redraw();
  }

  // ---- overlays: outlines on every photo (photo mode), a frame round the drawing (drawing mode)
  function drawingBox() {
    const d = app.doc; if (!d) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
    (d.floor && d.floor.points || []).forEach(([x, y]) => add(x, y));
    for (const it of d.items || []) {
      if (!it) continue;
      if (Number.isFinite(it.w)) { add(it.x, it.y); add(it.x + it.w, it.y + it.h); }
      (it.points || []).forEach(([x, y]) => add(x, y));
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  // the frame round the drawing; it travels with the drawing while it is moved or resized (never left behind)
  function currentFrame() {
    let b = drawingBox();
    if (b && drag && drag.kind === 'drawing') b = { x: b.x + drag.dx, y: b.y + drag.dy, w: b.w, h: b.h };
    else if (drag && drag.kind === 'scale' && drag.box) b = drag.box;
    return b;
  }
  const corners = (b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  function draw(opt) {
    if (!alive || !mode || (opt && opt.ctx === canvas.contextTop)) return; // never on the top layer: Fabric does not clear it, a ghost would stay
    try {
      const ctx = (opt && opt.ctx) || canvas.getContext();
      const vt = canvas.viewportTransform, r = canvas.getRetinaScaling ? canvas.getRetinaScaling() : 1, px = 1 / (canvas.getZoom() || 1);
      ctx.save();
      ctx.setTransform(r * vt[0], r * vt[1], r * vt[2], r * vt[3], r * vt[4], r * vt[5]);
      ctx.lineJoin = 'round';
      if (mode === 'photo') {
        list().forEach((p, i) => {
          const c = photoCorners(p), on = i === sel;
          ctx.beginPath(); c.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
          ctx.globalAlpha = on ? 0.12 : 0.05; ctx.fillStyle = BLUE; ctx.fill();
          ctx.globalAlpha = 1; ctx.strokeStyle = BLUE; ctx.lineWidth = (on ? 4 : 2) * px; ctx.setLineDash(on ? [] : [10 * px, 6 * px]); ctx.stroke(); ctx.setLineDash([]);
          if (on) c.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 7 * px, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.5 * px; ctx.stroke(); });
          ctx.font = `${600} ${14 * px}px sans-serif`; ctx.fillStyle = BLUE;
          ctx.fillText(refs()[i] && refs()[i].main ? 'Main photo' : `Photo ${refs()[i] ? refs()[i].idx + 1 : i + 1}`, c[0][0] + 8 * px, c[0][1] + 20 * px);
        });
      } else if (mode === 'drawing') {
        const b = currentFrame();
        if (b) {
          ctx.globalAlpha = 0.06; ctx.fillStyle = BLUE; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.globalAlpha = 1; ctx.strokeStyle = BLUE; ctx.lineWidth = 3 * px; ctx.setLineDash([12 * px, 7 * px]); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.setLineDash([]);
          for (const [x, y] of corners(b)) { ctx.beginPath(); ctx.arc(x, y, 8 * px, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3 * px; ctx.stroke(); }
        }
      }
      ctx.restore();
    } catch (e) { /* canvas gone */ }
    // the main photo is a background image that can be replaced: place it again when it is
    if (canvas.backgroundImage && canvas.backgroundImage !== lastBg) { lastBg = canvas.backgroundImage; place(); }
  }
  const redraw = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; try { canvas.requestRenderAll(); } catch (e) { /* gone */ } }); };
  const watchBg = () => { if (canvas.backgroundImage && canvas.backgroundImage !== lastBg) { lastBg = canvas.backgroundImage; place(); redraw(); } };

  // ---- pointer work
  const upperRect = () => upper.getBoundingClientRect();
  function toPlan(e) { const r = upperRect(), vt = canvas.viewportTransform; return [(e.clientX - r.left - vt[4]) / vt[0], (e.clientY - r.top - vt[5]) / vt[3]]; }
  const busy = () => spaceHeld || app.toolName === 'pan';
  // is the pointer on a corner of the selected photo? (the turn handles)
  const onCorner = (p) => { const z = canvas.getZoom() || 1, ph = list()[sel]; return sel >= 0 && !!ph && photoCorners(ph).some(([x, y]) => Math.hypot(x - p[0], y - p[1]) * z <= GRAB_PX); };
  function onDown(e) {
    if (!mode || e.button !== 0 || busy()) return;
    const p = toPlan(e);
    if (mode === 'photo') {
      if (onCorner(p)) {
        const orig = list()[sel], c = photoCentre(orig);
        drag = { kind: 'turn', i: sel, orig, c, a0: Math.atan2(p[1] - c[1], p[0] - c[0]) };
      } else {
        const i = hitPhoto(list(), p);
        if (i < 0) { sel = -1; syncPill(); redraw(); return; }
        sel = i; drag = { kind: 'photo', i, p0: p, orig: list()[i] };
      }
    } else {
      const box = drawingBox(), z = canvas.getZoom() || 1;
      const k = box ? corners(box).findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) * z <= 16) : -1;
      if (k >= 0) { const cs = corners(box); drag = { kind: 'scale', p0: p, box, box0x: box.x, box0y: box.y, box0w: box.w, box0h: box.h, corner: cs[k], anchor: cs[(k + 2) % 4], f: 1 }; }
      else drag = { kind: 'drawing', p0: p, dx: 0, dy: 0 };
    }
    e.preventDefault(); e.stopImmediatePropagation();
    try { upper.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    syncPill(); redraw();
  }
  function onMove(e) {
    if (!drag) { // hovering: the turn arrow shows on the corners of the selected photo
      if (mode === 'photo' && !busy()) canvas.defaultCursor = onCorner(toPlan(e)) ? TURN_CURSOR : 'default';
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    const p = toPlan(e);
    if (drag.kind === 'turn') { // the photo follows the pointer's angle about its centre; Shift snaps the result to 15 degrees
      const a = tOf(drag.orig).a;
      let deg = ((Math.atan2(p[1] - drag.c[1], p[0] - drag.c[0]) - drag.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round((a + deg) / TURN_STEP) * TURN_STEP - a;
      canvas.setCursor(TURN_CURSOR);
      setPhoto(drag.i, turnedBy(drag.orig, deg));
      return;
    }
    const dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1];
    if (drag.kind === 'photo') {
      let next = moved(drag.orig, dx, dy);
      let guides = [];
      if (app.magnet !== false) { // photos magnet to each other like rooms do (hold Alt to move freely)
        const tol = 9 / (canvas.getZoom() || 1);
        const s = snapPhoto(next, list().filter((_, k) => k !== drag.i), tol);
        next = moved(next, s.dx, s.dy); guides = s.guides;
      }
      setPhoto(drag.i, next);
      try { app.canvas.setGuides(guides); } catch (err) { /* gone */ }
    }
    else if (drag.kind === 'scale') {
      // one factor for both axes, so the drawing keeps its proportions: how far the corner went along its diagonal
      const [ax, ay] = drag.anchor, vx = drag.corner[0] - ax, vy = drag.corner[1] - ay;
      drag.f = Math.max(0.2, Math.min(5, ((p[0] - ax) * vx + (p[1] - ay) * vy) / (vx * vx + vy * vy || 1)));
      { const [qx, qy] = drag.anchor; drag.box = { x: qx + (drag.box0x - qx) * drag.f, y: qy + (drag.box0y - qy) * drag.f, w: drag.box0w * drag.f, h: drag.box0h * drag.f }; } // the frame follows the cursor at once
      if (!preview) preview = requestAnimationFrame(() => { preview = 0; if (drag && drag.kind === 'scale') try { const [qx, qy] = drag.anchor; app.canvas.setDoc(scaleDoc(app.doc, drag.f, qx, qy)); } catch (err) { /* keep going */ } redraw(); });
    } else {
      drag.dx = Math.round(dx); drag.dy = Math.round(dy);
      if (!preview) preview = requestAnimationFrame(() => { preview = 0; if (drag && app.doc) try { app.canvas.setDoc(translateDoc(app.doc, drag.dx, drag.dy)); } catch (err) { /* keep going */ } redraw(); });
    }
  }
  function onUp(e) {
    if (!drag) return;
    e.preventDefault(); e.stopImmediatePropagation();
    try { upper.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ }
    const d = drag; drag = null;
    if (d.kind === 'photo' || d.kind === 'turn') { moved_ = true; try { app.canvas.setGuides([]); } catch (err) { /* gone */ } if (app.saveView) app.saveView(); }
    else if (d.kind === 'scale') {
      if (preview) { cancelAnimationFrame(preview); preview = 0; }
      if (Math.abs(d.f - 1) > 0.002) app.commit(scaleDoc(app.doc, d.f, d.anchor[0], d.anchor[1]), 'Scale drawing'); else app.canvas.setDoc(app.doc);
    } else {
      if (preview) { cancelAnimationFrame(preview); preview = 0; }
      if (d.dx || d.dy) app.commit(translateDoc(app.doc, d.dx, d.dy), 'Move drawing'); else app.canvas.setDoc(app.doc);
    }
    redraw();
  }
  function onKey(e) {
    if (e.code === 'Space') spaceHeld = e.type === 'keydown';
    if (mode && e.type === 'keydown' && e.key === 'Escape') { const t = e.target; if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return; setMode(null); e.stopImmediatePropagation(); }
  }

  // ---- the pill and the View buttons
  function nudge(fn) { if (sel < 0) return; moved_ = true; setPhoto(sel, fn(list()[sel])); if (app.saveView) app.saveView(); }
  function syncPill() {
    if (!pill || mode !== 'photo') return; // the drawing pill has its own fixed text
    const has = sel >= 0, isExtra = has && refs()[sel] && !refs()[sel].main;
    pill.querySelectorAll('[data-pl]').forEach((b) => { b.disabled = b.dataset.pl === 'remove' ? !isExtra : !has; });
    pill.querySelector('.pl-msg').innerHTML = has ? '<b>Photo selected</b> &nbsp;Drag to move, drag a corner to turn' : '<b>Arrange photos</b> &nbsp;Click a photo, then drag it';
  }
  function showPill() {
    if (pill) pill.remove();
    pill = document.createElement('div'); pill.className = 'pl-pill'; pill.setAttribute('role', 'status');
    if (mode === 'photo') {
      pill.innerHTML = `<span class="pl-msg"></span><span class="pl-tools">
        <button type="button" data-pl="smaller" title="Smaller">−</button><button type="button" data-pl="bigger" title="Bigger">+</button>
        <button type="button" data-pl="remove" title="Remove this photo">Remove</button></span><button type="button" class="pl-done">Done</button>`;
      pill.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-pl]'); if (!b || b.disabled) return;
        const k = b.dataset.pl;
        if (k === 'smaller') nudge((p) => scaledBy(p, 1 / 1.05));
        else if (k === 'bigger') nudge((p) => scaledBy(p, 1.05));
        else if (k === 'remove') {
          const r = refs()[sel]; if (!r || r.main) return;
          if (!(await app.confirm('Remove this photo from the floor?'))) return;
          app.project.extraPhotos = app.project.extraPhotos.filter((_, j) => j !== r.j);
          sel = -1; await sync(); if (app.saveView) app.saveView(); syncPill();
        }
      });
    } else {
      pill.innerHTML = `<span class="pl-msg"><b>Drawing selected</b> &nbsp;Drag to move it, drag a corner to resize it</span><span class="pl-tools">
        <button type="button" data-pd="smaller" title="Smaller (keeps the proportions)">\u2212</button><button type="button" data-pd="bigger" title="Bigger (keeps the proportions)">+</button></span><button type="button" class="pl-done">Done</button>`;
      pill.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-pd]'); if (!b || !app.doc) return;
        const box = drawingBox(); if (!box) return;
        const f = b.dataset.pd === 'bigger' ? 1.05 : 1 / 1.05;
        app.commit(scaleDoc(app.doc, f, box.x + box.w / 2, box.y + box.h / 2), 'Scale drawing');
      });
    }
    pill.querySelector('.pl-done').addEventListener('click', () => setMode(null));
    (canvas.wrapperEl || upper.parentElement).appendChild(pill);
    syncPill();
  }
  function fitAll() {
    const box = unionBox(list()); if (!box || !app.canvas) return;
    const W = canvas.getWidth(), H = canvas.getHeight(), m = 40;
    const zoom = Math.max(0.05, Math.min(2, Math.min((W - m * 2) / box.w, (H - m * 2) / box.h)));
    app.canvas.setView({ zoom, x: box.x + box.w / 2 - W / zoom / 2, y: box.y + box.h / 2 - H / zoom / 2 });
  }
  function setMode(next) {
    if (next === mode) return;
    const was = mode;
    mode = next; sel = -1; drag = null;
    if (preview) { cancelAnimationFrame(preview); preview = 0; }
    try { app.canvas.setGuides([]); } catch (e) { /* gone */ }
    if (was === 'photo') { try { app.canvas.setPlanOpacity(app.planOpacity); app.canvas.setOnion(app.onion); } catch (e) { /* gone */ } place(); }
    if (was === 'drawing') { try { app.canvas.setDoc(app.doc); } catch (e) { /* gone */ } }
    if (was && !next) {
      // photos were moved: show them where they are now; otherwise go back to the view you had
      if (app.canvas) { try { if (moved_ && was === 'photo') fitAll(); else if (savedView) app.canvas.setView(savedView); } catch (e) { /* gone */ } }
      savedView = null; moved_ = false;
    }
    if (next) {
      if (!savedView && app.canvas) savedView = (({ x, y, zoom }) => ({ x, y, zoom }))(app.canvas.getView());
      if (app.toolName !== 'select' && app.toolName !== 'pan') app.setTool('select');
      try { canvas.discardActiveObject(); } catch (e) { /* none */ }
      if (next === 'photo') { app.canvas.setPlanOpacity(FAINT); fitAll(); }
      const ov = document.getElementById('start-overlay'); if (ov) ov.style.display = 'none'; // the "outline the building" card would hide the photos
      showPill();
    } else {
      const ov = document.getElementById('start-overlay'); if (ov) ov.style.display = '';
      if (pill) { pill.remove(); pill = null; }
    }
    app.canvas.lockObjects('photo', !!next); // the plan's objects are not hot while photos or the drawing are arranged, whatever tool or hand state comes and goes
    paintOpacity(); syncButtons();
    try { canvas.renderAll(); } catch (e) { /* gone */ } // draw now: no outline from before is left on screen
    redraw();
  }
  let buttons = null;
  function syncButtons() { if (buttons) { buttons.photo.setAttribute('aria-pressed', String(mode === 'photo')); buttons.drawing.setAttribute('aria-pressed', String(mode === 'drawing')); } }
  function mountButtons() {
    const pop = document.getElementById('view-popover'); if (!pop) return;
    const labels = [...pop.querySelectorAll('.onion-label')]; if (labels.length < 2) return;
    const mk = (label, which, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'vp-sel'; b.textContent = 'Select'; b.title = title; b.setAttribute('aria-pressed', 'false'); b.dataset.sel = which;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setMode(mode === which ? null : which); if (mode) pop.hidden = true; }); label.insertBefore(b, label.firstChild); return b; };
    buttons = { photo: mk(labels[0], 'photo', 'Select the photos to move them'), drawing: mk(labels[1], 'drawing', 'Select the drawing to move it') };
  }

  upper.addEventListener('pointerdown', onDown, true);
  upper.addEventListener('pointermove', onMove, true);
  upper.addEventListener('pointerup', onUp, true);
  upper.addEventListener('pointercancel', onUp, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  canvas.on('after:render', draw);
  mountButtons();
  // keep the extras' opacity in step with the Photo slider / the H key flash
  const origOnion = app.canvas.setOnion, origFlash = app.canvas.flashPhoto;
  app.canvas.setOnion = (op) => { if (mode === 'photo') arrangeOpacity = op; else origOnion(op); paintOpacity(); canvas.requestRenderAll(); };
  app.canvas.flashPhoto = (on) => { if (mode === 'photo') return; origFlash(on); for (const { obj } of extraObjs) obj.opacity = on ? 1 : bgOpacity(); canvas.requestRenderAll(); };
  const unsub = app.subscribe((e) => { if (e.type === 'project' || e.type === 'step') { sync(); watchBg(); } if (e.type === 'hidden') { sel = -1; drag = null; place(); syncPill(); redraw(); } if (e.type === 'tool' && mode && app.toolName !== 'select' && app.toolName !== 'pan') setMode(null); });
  const poll = setInterval(watchBg, 400); // the main photo loads after the studio opens
  sync();

  return {
    mode: () => mode,
    frame: () => currentFrame(),
    setMode,
    // right after importing several photos: separated, outlined and ready to move
    async arrange() { await sync(); watchBg(); setMode('photo'); },
    refresh() { sync(); watchBg(); }, // photos were replaced (e.g. several photos placed by AutoBuild)
    destroy() {
      alive = false; unsub(); clearInterval(poll); try { app.canvas.lockObjects('photo', false); } catch (e) { /* disposed */ }
      if (raf) cancelAnimationFrame(raf); if (preview) cancelAnimationFrame(preview);
      try { upper.removeEventListener('pointerdown', onDown, true); upper.removeEventListener('pointermove', onMove, true); upper.removeEventListener('pointerup', onUp, true); upper.removeEventListener('pointercancel', onUp, true); canvas.off('after:render', draw); } catch (e) { /* disposed */ }
      window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true);
      for (const { obj } of extraObjs) { try { canvas.remove(obj); } catch (e) { /* gone */ } }
      if (pill) pill.remove();
      if (buttons) { buttons.photo.remove(); buttons.drawing.remove(); }
      styleEl.remove();
    },
  };
}
