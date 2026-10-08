// outlineEdit.js (view)
// "Edit outline": grab a corner or a wall of the building outline and move it. Click a corner or a wall to SELECT it; Delete /
// Backspace removes the selected corner or wall and the outline closes over the gap (a notch fills in, square walls stay square,
// see model/outlineTidy.js). Drag a "+" in the middle of a wall to bend it (a click on it only selects the wall); a corner dropped
// on its neighbour merges with it. Double-clicking does nothing special. Corners have a big hit area. Moves snap to the 5-unit grid and line up with the neighbouring corners.
// Doors that sit on a wall travel with it. One undo step per gesture. Also a small hint that lights the
// hand button while the middle button, Space or a two-finger scroll is panning the plan.
// Drawn on the stage canvas after each render; never touches the document until a gesture ends.
// Depends on: js/model/document.js (setFloor), js/model/fixOverlaps.js (cleanRing: validity), app.canvas.

import { setFloor } from '../model/document.js';
import { cleanRing } from '../model/fixOverlaps.js';
import { tidyRing, removeVertices, removeEdge } from '../model/outlineTidy.js';

const BLUE = '#0a84ff', RED = '#ff453a';
const G = 5;
const VERT_HIT = 18, MID_HIT = 12, EDGE_HIT = 12, DRAG_PX = 4, ALIGN_PX = 8, MERGE_PX = 12; // screen pixels
const snapG = (v) => Math.round(v / G) * G;

const CSS = `
.oe-pill { position:absolute; left:50%; bottom:16px; transform:translateX(-50%); z-index:6; display:flex; align-items:center; gap:12px;
  padding:8px 8px 8px 16px; border-radius:999px; background:rgba(255,255,255,.82); -webkit-backdrop-filter:saturate(180%) blur(18px); backdrop-filter:saturate(180%) blur(18px);
  box-shadow:0 6px 24px rgba(0,0,0,.16), 0 0 0 .5px rgba(0,0,0,.1); font:500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#1d1d1f; max-width:calc(100% - 32px); }
.oe-pill span { color:#515154; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.oe-pill b { color:#1d1d1f; font-weight:600; }
.oe-pill button { border:0; border-radius:999px; background:${BLUE}; color:#fff; font:600 13px inherit; padding:6px 16px; cursor:pointer; }
.oe-pill button:hover { filter:brightness(1.08); }
.oe-pill.oe-bad { background:rgba(255,236,235,.92); }
.hand-toggle.oe-held { background: var(--accent); color: var(--accent-ink); }
`;

// distance and nearest point from p to segment a-b
function toSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  const x = a[0] + t * dx, y = a[1] + t * dy;
  return { x, y, t, d: Math.hypot(p[0] - x, p[1] - y) };
}

const validRing = (pts) => pts.length >= 3 && !!cleanRing(pts);

// doors that sit on the old outline follow the new one
function followDoors(doc, oldPts, newPts) {
  const near = (pts, x, y) => { let best = null; for (let i = 0; i < pts.length; i++) { const s = toSeg([x, y], pts[i], pts[(i + 1) % pts.length]); if (!best || s.d < best.d) best = s; } return best; };
  let changed = false;
  const items = doc.items.map((it) => {
    if (!it || it.type !== 'door' || ![it.x1, it.y1, it.x2, it.y2].every(Number.isFinite)) return it;
    const a = near(oldPts, it.x1, it.y1), b = near(oldPts, it.x2, it.y2);
    if (!a || !b || a.d > 4 || b.d > 4) return it; // not on the wall: leave it
    const na = near(newPts, it.x1, it.y1), nb = near(newPts, it.x2, it.y2);
    if (!na || !nb) return it;
    const dx = Math.round((na.x + nb.x) / 2 - (it.x1 + it.x2) / 2), dy = Math.round((na.y + nb.y) / 2 - (it.y1 + it.y2) / 2);
    const n = { ...it, x1: Math.round(na.x), y1: Math.round(na.y), x2: Math.round(nb.x), y2: Math.round(nb.y) };
    if (it.label && Number.isFinite(it.label.x)) n.label = { ...it.label, x: it.label.x + dx, y: it.label.y + dy };
    if (n.x1 !== it.x1 || n.y1 !== it.y1 || n.x2 !== it.x2 || n.y2 !== it.y2) changed = true;
    return n;
  });
  return changed ? { ...doc, items } : doc;
}

export function mountOutlineEdit(app) {
  const canvas = app.canvas && app.canvas.fabricCanvas;
  if (!canvas) return { destroy() {}, isActive: () => false };
  const upper = canvas.upperCanvasEl;
  const styleEl = document.createElement('style'); styleEl.textContent = CSS; document.head.appendChild(styleEl);

  let active = false, alive = true;
  let pts = null; // working outline while a gesture is running (plan units)
  let drag = null; // { kind:'vertex'|'edge'|'mid'|'pending-edge', ... }
  let hover = null; // { kind, i }
  let selected = -1; // the selected corner
  let selEdge = -1; // or the selected wall (from corner i to i + 1)
  let bad = false;
  let pill = null, button = null, raf = 0;
  let spaceHeld = false;

  const floorPts = () => (app.doc && app.doc.floor && Array.isArray(app.doc.floor.points) && app.doc.floor.points.length >= 3 ? app.doc.floor.points : null);
  const zoom = () => canvas.getZoom() || 1;
  function toPlan(e) {
    const r = upper.getBoundingClientRect(), vt = canvas.viewportTransform;
    return [(e.clientX - r.left - vt[4]) / vt[0], (e.clientY - r.top - vt[5]) / vt[3]];
  }
  const cur = () => pts || floorPts();

  // ---- hit testing (everything in screen pixels, so it feels the same at any zoom)
  function hitTest(p) {
    const P = cur(); if (!P) return null;
    const z = zoom();
    let best = null;
    P.forEach((v, i) => { const d = Math.hypot(v[0] - p[0], v[1] - p[1]) * z; if (d <= VERT_HIT && (!best || d < best.d)) best = { kind: 'vertex', i, d }; });
    if (best) return best;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) * z < 46) continue; // wall too short for a middle handle
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = Math.hypot(m[0] - p[0], m[1] - p[1]) * z;
      if (d <= MID_HIT && (!best || d < best.d)) best = { kind: 'mid', i, d };
    }
    if (best) return best;
    for (let i = 0; i < P.length; i++) {
      const s = toSeg(p, P[i], P[(i + 1) % P.length]);
      if (s.d * z <= EDGE_HIT && (!best || s.d < best.d)) best = { kind: 'edge', i, d: s.d, at: [s.x, s.y] };
    }
    return best;
  }

  // ---- snapping: grid, then line up with other corners when close
  function snapPoint(p, skip) {
    const P = cur() || [];
    const tol = ALIGN_PX / zoom();
    let x = snapG(p[0]), y = snapG(p[1]);
    let bx = tol, by = tol;
    P.forEach((v, i) => {
      if (skip && skip.includes(i)) return;
      if (Math.abs(v[0] - p[0]) < bx) { bx = Math.abs(v[0] - p[0]); x = v[0]; }
      if (Math.abs(v[1] - p[1]) < by) { by = Math.abs(v[1] - p[1]); y = v[1]; }
    });
    return [x, y];
  }

  // ---- drawing
  function draw(opt) {
    if (!active || !alive || (opt && opt.ctx === canvas.contextTop)) return; // never on the top layer: Fabric does not clear it, a ghost would stay
    try {
      const P = cur(); if (!P) return;
      const ctx = (opt && opt.ctx) || canvas.getContext();
      const vt = canvas.viewportTransform, r = canvas.getRetinaScaling ? canvas.getRetinaScaling() : 1, px = 1 / zoom();
      const col = bad ? RED : BLUE;
      ctx.save();
      ctx.setTransform(r * vt[0], r * vt[1], r * vt[2], r * vt[3], r * vt[4], r * vt[5]);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); P.forEach((v, i) => (i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]))); ctx.closePath();
      ctx.globalAlpha = 0.07; ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 0.28; ctx.strokeStyle = col; ctx.lineWidth = 9 * px; ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 2.5 * px; ctx.stroke();
      if (hover && hover.kind === 'edge' && !drag) {
        const a = P[hover.i], b = P[(hover.i + 1) % P.length];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineWidth = 5 * px; ctx.stroke();
      }
      if (selEdge >= 0 && selEdge < P.length && !drag) { // the selected wall, bold, with its two corners
        const a = P[selEdge], b = P[(selEdge + 1) % P.length];
        ctx.globalAlpha = 0.45; ctx.lineWidth = 20 * px; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 7 * px; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      // middle "+" handles
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) * zoom() < 46) continue;
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const hot = hover && hover.kind === 'mid' && hover.i === i;
        const rr = (hot ? 7 : 5) * px;
        ctx.beginPath(); ctx.arc(m[0], m[1], rr, 0, 7); ctx.fillStyle = '#fff'; ctx.globalAlpha = hot ? 1 : 0.9; ctx.fill();
        ctx.lineWidth = 1.5 * px; ctx.strokeStyle = col; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(m[0] - rr * 0.5, m[1]); ctx.lineTo(m[0] + rr * 0.5, m[1]); ctx.moveTo(m[0], m[1] - rr * 0.5); ctx.lineTo(m[0], m[1] + rr * 0.5); ctx.stroke();
      }
      if (selected >= 0 && selected < P.length && !drag) { // the selected corner: its two walls go bold
        const v = P[selected];
        ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 16 * px; ctx.beginPath(); ctx.moveTo(P[(selected + P.length - 1) % P.length][0], P[(selected + P.length - 1) % P.length][1]); ctx.lineTo(v[0], v[1]); ctx.lineTo(P[(selected + 1) % P.length][0], P[(selected + 1) % P.length][1]); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 6 * px; ctx.stroke();
      }
      // corner handles
      P.forEach((v, i) => {
        const hot = (hover && hover.kind === 'vertex' && hover.i === i) || (drag && drag.i === i && drag.kind === 'vertex');
        const sel = selected === i;
        ctx.globalAlpha = 1;
        if (sel) { ctx.beginPath(); ctx.arc(v[0], v[1], 20 * px, 0, 7); ctx.globalAlpha = 0.3; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; } // a halo round the selected corner
        ctx.beginPath(); ctx.arc(v[0], v[1], (sel ? 13 : hot ? 11 : 9) * px, 0, 7);
        ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
        ctx.fillStyle = sel ? col : '#fff'; ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = (sel ? 4 : 2.5) * px; ctx.strokeStyle = sel ? '#fff' : col; ctx.stroke();
        if (sel) { ctx.beginPath(); ctx.arc(v[0], v[1], 13 * px + 2 * px, 0, 7); ctx.lineWidth = 2 * px; ctx.strokeStyle = col; ctx.stroke(); }
      });
      syncPill();
      ctx.restore();
    } catch (e) { /* canvas gone */ }
  }

  const redraw = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; try { canvas.requestRenderAll(); } catch (e) { /* gone */ } }); };
  // live preview: show the working outline in the real plan, without touching undo
  function preview() {
    if (!pts || !app.doc) return;
    try { app.canvas.setDoc(setFloor(app.doc, pts.map((p) => [p[0], p[1]]))); } catch (e) { /* keep going */ }
    bad = !validRing(pts);
    redraw();
  }

  // what the pill says follows what is selected
  function syncPill() {
    if (!pill) return;
    const t = selEdge >= 0 ? '<b>Wall selected</b> &nbsp;Backspace removes it &middot; drag to move it'
      : selected >= 0 ? '<b>Corner selected</b> &nbsp;Backspace removes it &middot; drag to move it'
        : '<b>Edit outline</b> &nbsp;Click a corner or a wall to select it &middot; drag a + to bend a wall';
    const el = pill.querySelector('span');
    if (el.dataset.t !== t) { el.dataset.t = t; el.innerHTML = t; }
  }

  // ---- gestures
  function commit(label) {
    const next = pts, base = floorPts();
    pts = null; drag = null;
    if (!next || !base || JSON.stringify(next) === JSON.stringify(base)) { try { app.canvas.setDoc(app.doc); } catch (e) { /* */ } bad = false; redraw(); return; }
    if (!validRing(next)) {
      try { app.canvas.setDoc(app.doc); } catch (e) { /* */ }
      bad = false; redraw();
      if (app.toast) app.toast('That would make the outline cross itself, so it was put back.');
      return;
    }
    // corners on the same spot merge, a spike (a wall that turns straight back) goes; a break on a straight wall stays
    const clean = tidyRing(next);
    const doc = followDoors(setFloor(app.doc, clean), base, clean);
    if (clean.length !== base.length) { selected = -1; selEdge = -1; } // the numbers of the corners have moved on
    bad = false;
    app.commit(doc, label);
    redraw();
  }

  // take corners out (Delete, double-click): the outline closes over the gap
  function takeOut(idxs, label) {
    const base = floorPts(); if (!base) return;
    const next = removeVertices(base, idxs);
    selected = -1; selEdge = -1; drag = null; pts = null;
    if (!next) { if (app.toast) app.toast('That would not leave an outline, so it was kept.'); redraw(); return; }
    pts = next; commit(label);
  }

  function onDown(e) {
    if (!active || e.button !== 0 || spaceHeld || app.toolName === 'pan') return;
    const base = floorPts(); if (!base) return;
    const p = toPlan(e);
    const h = hitTest(p);
    if (!h) { selected = -1; selEdge = -1; redraw(); return; } // let fabric deal with it (nothing to select in edit mode)
    e.preventDefault(); e.stopImmediatePropagation();
    try { upper.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    pts = base.map((q) => [q[0], q[1]]);
    const start = { x: e.clientX, y: e.clientY };
    if (h.kind === 'vertex') {
      selected = h.i; selEdge = -1;
      drag = { kind: 'vertex', i: h.i, start, orig: pts[h.i].slice() };
    } else if (h.kind === 'mid') { // the + in the middle of a wall: dragged it bends the wall, a click only selects the wall
      const a = pts[h.i], b = pts[(h.i + 1) % pts.length];
      selected = -1; selEdge = h.i;
      drag = { kind: 'pending-mid', i: h.i, start, m: [snapG((a[0] + b[0]) / 2), snapG((a[1] + b[1]) / 2)] };
    } else {
      const a = pts[h.i], b = pts[(h.i + 1) % pts.length];
      selected = -1; selEdge = h.i;
      drag = { kind: 'pending-edge', i: h.i, start, p0: p, a: a.slice(), b: b.slice(), at: h.at };
    }
    redraw();
  }

  function onMove(e) {
    if (!active) return;
    if (!drag) {
      if (spaceHeld || app.toolName === 'pan') return;
      const h = hitTest(toPlan(e));
      const same = (!h && !hover) || (h && hover && h.kind === hover.kind && h.i === hover.i && !(h.kind === 'edge'));
      hover = h;
      canvas.defaultCursor = h ? (h.kind === 'vertex' ? 'grab' : h.kind === 'mid' ? 'copy' : 'pointer') : 'default';
      if (!same || (h && h.kind === 'edge')) redraw();
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    const moved = Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y);
    const p = toPlan(e);
    if (drag.kind === 'pending-edge') {
      if (moved < DRAG_PX) return;
      drag.kind = 'edge';
    }
    if (drag.kind === 'pending-mid') {
      if (moved < DRAG_PX) return;
      pts.splice(drag.i + 1, 0, drag.m); selected = drag.i + 1; selEdge = -1;
      drag = { kind: 'vertex', i: drag.i + 1, start: drag.start, orig: drag.m.slice(), fresh: true };
    }
    if (drag.kind === 'vertex') {
      if (moved < DRAG_PX && !drag.fresh) return;
      canvas.defaultCursor = 'grabbing';
      pts[drag.i] = snapPoint(p, [drag.i]);
      const n = pts.length, z = zoom();
      for (const k of [(drag.i + n - 1) % n, (drag.i + 1) % n]) { // close to a neighbouring corner: they become one
        if (Math.hypot(pts[k][0] - p[0], pts[k][1] - p[1]) * z <= MERGE_PX) { pts[drag.i] = [pts[k][0], pts[k][1]]; break; }
      }
      drag.moved = true;
    } else if (drag.kind === 'edge') {
      const n = pts.length, i = drag.i, j = (i + 1) % n;
      const dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1];
      const horiz = drag.a[1] === drag.b[1], vert = drag.a[0] === drag.b[0];
      const mx = vert || !horiz ? snapG(drag.a[0] + dx) - drag.a[0] : 0;
      const my = horiz || !vert ? snapG(drag.a[1] + dy) - drag.a[1] : 0;
      pts[i] = [drag.a[0] + (horiz ? 0 : mx), drag.a[1] + (vert ? 0 : my)];
      pts[j] = [drag.b[0] + (horiz ? 0 : mx), drag.b[1] + (vert ? 0 : my)];
      drag.moved = true;
    }
    preview();
  }

  function onUp(e) {
    if (!active || !drag) return;
    e.preventDefault(); e.stopImmediatePropagation();
    try { upper.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ }
    const d = drag;
    if (d.kind === 'pending-edge' || d.kind === 'pending-mid') { // a click on a wall only selects it (it is already selected)
      pts = null; drag = null; redraw(); return;
    }
    commit(d.kind === 'edge' ? 'Move wall' : d.fresh ? 'Add corner' : 'Move corner');
    canvas.defaultCursor = 'default';
  }

  function onKey(e) {
    if (e.code === 'Space') spaceHeld = e.type === 'keydown';
    if (!active || e.type !== 'keydown') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape') { setActive(false); e.stopImmediatePropagation(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // always ours while editing: Delete here never removes the whole outline
      e.preventDefault(); e.stopImmediatePropagation();
      if (!floorPts()) return;
      if (selEdge >= 0) { const base = floorPts(), n = base.length, i = selEdge; takeOut([i, (i + 1) % n], 'Remove wall'); }
      else if (selected >= 0) takeOut([selected], 'Remove corner');
      else if (app.toast) app.toast('Click a corner or a wall first, then press Backspace to remove it.');
    }
  }

  // ---- UI: palette button + hint pill
  function ensureButton() {
    const host = document.getElementById('btn-straighten') || document.getElementById('btn-tool-floor');
    if (!host || !host.parentElement) return;
    if (button && button.isConnected) return;
    button = document.createElement('button');
    button.type = 'button'; button.id = 'btn-edit-outline'; button.className = 'btn-big-tool';
    button.textContent = 'Edit outline';
    button.title = 'Move a wall or corner, add a break in a wall';
    button.addEventListener('click', () => setActive(!active));
    const floorBtn = document.getElementById('btn-tool-floor');
    (document.getElementById('btn-auto-outline') || floorBtn || host).after(button); // right under "Redraw the outline" and Auto-outline
  }
  function syncButton() {
    ensureButton();
    if (!button) return;
    button.hidden = !floorPts();
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? 'Done editing outline' : 'Edit outline';
    if (active && !floorPts()) setActive(false);
  }

  function showPill() {
    if (pill) return;
    pill = document.createElement('div'); pill.className = 'oe-pill'; pill.setAttribute('role', 'status');
    pill.innerHTML = '<span></span><button type="button">Done</button>';
    pill.querySelector('button').addEventListener('click', () => setActive(false));
    (canvas.wrapperEl || upper.parentElement).appendChild(pill);
    syncPill();
  }

  function setActive(on) {
    on = !!on && !!floorPts();
    if (on === active) return;
    active = on; pts = null; drag = null; hover = null; selected = -1; selEdge = -1; bad = false;
    if (on) {
      if (app.toolName !== 'select' && app.toolName !== 'pan') app.setTool('select');
      try { canvas.discardActiveObject(); } catch (e) { /* none */ }
      showPill();
    } else if (pill) { pill.remove(); pill = null; }
    app.canvas.lockObjects('outline', on); // the plan's objects are not hot while the outline is edited; the tool's own cursor comes back after
    syncButton(); redraw();
  }

  upper.addEventListener('pointerdown', onDown, true);
  upper.addEventListener('pointermove', onMove, true);
  upper.addEventListener('pointerup', onUp, true);
  upper.addEventListener('pointercancel', onUp, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  canvas.on('after:render', draw);
  const unsub = app.subscribe((e) => {
    if (e.type === 'tool' && active && app.toolName !== 'select' && app.toolName !== 'pan') setActive(false);
    else if (e.type === 'doc' || e.type === 'project' || e.type === 'step' || e.type === 'tool') { if (active && !drag) hover = null; syncButton(); redraw(); }
  });
  syncButton();

  // ---- the hand button lights up while the plan is being panned (middle button, Space, two-finger scroll)
  const hand = () => document.getElementById('btn-hand-toggle');
  let handT = 0;
  const light = (on) => { const b = hand(); if (b) b.classList.toggle('oe-held', on); };
  const holdLight = () => { light(true); clearTimeout(handT); handT = setTimeout(() => light(false), 260); };
  const onHandDown = (e) => { if (e.button === 1 && e.target === upper) light(true); }; // on the window: the map grab (stageView) takes the press first
  const onHandUp = (e) => { if (e.button === 1) light(false); };
  const onHandKey = (e) => { if (e.code === 'Space' && !/^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName || '')) light(e.type === 'keydown'); };
  window.addEventListener('pointerdown', onHandDown, true);
  window.addEventListener('pointerup', onHandUp, true);
  window.addEventListener('keydown', onHandKey, true);
  window.addEventListener('keyup', onHandKey, true);
  upper.addEventListener('wheel', holdLight, { passive: true });

  return {
    isActive: () => active,
    setActive,
    destroy() {
      alive = false; unsub(); clearTimeout(handT); if (raf) cancelAnimationFrame(raf);
      try { upper.removeEventListener('pointerdown', onDown, true); upper.removeEventListener('pointermove', onMove, true); upper.removeEventListener('pointerup', onUp, true); upper.removeEventListener('pointercancel', onUp, true); upper.removeEventListener('wheel', holdLight); canvas.off('after:render', draw); } catch (e) { /* disposed */ }
      window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('pointerdown', onHandDown, true); window.removeEventListener('pointerup', onHandUp, true); window.removeEventListener('keydown', onHandKey, true); window.removeEventListener('keyup', onHandKey, true);
      if (pill) pill.remove(); if (button) button.remove(); styleEl.remove();
      light(false);
    },
  };
}
