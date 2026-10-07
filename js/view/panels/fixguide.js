// fixguide.js
// "Worth a look", made walkable. In the checklist (right sidebar) the long note list becomes a few
// clear groups; clicking one takes you straight to the first problem: the room is selected, the map
// flies to it, and a guide card at the top of the sidebar says what is wrong and what to do:
//   - a room with no number: type it right there (Enter saves and jumps to the next one),
//   - overlaps / hallways / labels: a preview of the fix with Yes / Skip,
//   - anything that cannot be fixed automatically: plain instructions and the right tool.
// The original note list is only hidden (validation.js is untouched); "Fix all" (fixAll.js) walks the
// approval fixes through this same card.
// Depends on: js/model/noteGroups.js, js/model/fix*.js, js/view/panels/fixflow.js, js/view/panels/validation.js.

import { noteGroups, boxOfIds, stopLabel } from '../../model/noteGroups.js';
import { applyIgnores } from '../../model/ignored.js';
import { docChecklistCodes } from './validation.js';
import { NUMBER_RE, updateItem } from '../../model/document.js';
import { createNotesFlow } from './fixflow.js';
import { findNumberFixes, findManualNumbers } from '../../model/fixNumbers.js';
import { findHallFixes, findManualHalls } from '../../model/fixHalls.js';
import { findLabelFixes, findManualLabels } from '../../model/fixLabels.js';
import { proposeFix } from '../../model/fixOverlaps.js';
import { validate } from '../../model/validate.js';

const STYLE = `
#validation .wl-hidden { display:none !important; }
#validation .wl-groups { display:flex; flex-direction:column; gap:5px; margin:4px 0 10px; }
#validation .wl-group { display:flex; align-items:center; gap:8px; width:100%; text-align:left; font:inherit; font-size:13px; padding:8px 10px; background:#fff; border:1px solid #f0d58a; border-left:4px solid #f2b600; border-radius:8px; color:#23272e; cursor:pointer; }
#validation .wl-group:hover { background:#fff8e1; }
#validation .wl-group.on { background:#fff3c4; border-color:#f2b600; }
#validation .wl-group .wl-t { flex:1; line-height:1.3; }
#validation .wl-group .wl-go { color:#9a6b00; font-weight:700; }
#validation .wl-group.k-overlap { border-left-color:#e5484d; border-color:#f3c3c4; }
#validation .wl-group.k-number, #validation .wl-group.k-numfix { border-left-color:#2f6feb; border-color:#c9d8f7; }
#validation .wl-group.k-hall, #validation .wl-group.k-hall-overlap, #validation .wl-group.k-room-hall, #validation .wl-group.k-route { border-left-color:#1f9d55; border-color:#bfe3cd; }
#validation .wl-group .wl-go { display:inline-block; transition:transform .15s; }
#validation .wl-group.on .wl-go { transform:rotate(90deg); }
#validation .wl-stops { margin:-2px 0 6px 10px; padding-left:8px; border-left:2px solid #f0d58a; display:flex; flex-direction:column; gap:3px; }
#validation .wl-stop { display:block; width:100%; box-sizing:border-box; text-align:left; font:inherit; font-size:12.5px; background:#fff; border:1px solid #e6e8ec; border-radius:8px; padding:6px 9px; cursor:pointer; color:#23272e; }
#validation .wl-stop:hover { background:#f3f7ff; }
#validation .wl-stop.cur { border-color:#2f6feb; background:#f3f7ff; }
#validation .wl-stop small { color:#6b7078; margin-left:6px; }
#validation .wl-inline { margin-top:6px; display:flex; flex-direction:column; gap:5px; cursor:default; }
#validation .wl-inline .wl-input { font-size:15px; padding:6px 8px; }
#validation .wl-inline .wl-err { min-height:0; }
#validation .wl-inline .wl-row { margin-top:0; }
#validation .wl-inline .wl-btn { font-size:12px; padding:4px 10px; }
#validation .wl-stop { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
#validation .wl-stop > span { flex:1; min-width:0; }
#validation .wl-ign { font:inherit; font-size:11px; padding:2px 8px; border-radius:6px; border:1px solid #c5ccd6; background:#fff; color:#4a5059; cursor:pointer; }
#validation .wl-ign:hover { background:#f0f2f5; }
#validation .wl-ignall { margin:2px 0 2px; align-self:flex-start; }
#validation .wl-ignored { margin:8px 0 4px; font-size:12.5px; color:#4a5059; }
#validation .wl-ignored summary { cursor:pointer; font-weight:600; padding:3px 0; }
#validation .wl-ignored .wl-igrow { display:flex; align-items:center; gap:6px; padding:3px 0 3px 4px; border-bottom:1px solid #eceef1; }
#validation .wl-ignored .wl-igrow > span { flex:1; min-width:0; }
#validation .wl-ignored .wl-igrow small { color:#6b7078; margin-left:5px; }
#validation .fix-list li .fix-ign { margin-left:6px; font:inherit; font-size:11px; padding:1px 7px; border-radius:6px; border:1px solid #c5ccd6; background:#fff; cursor:pointer; }
#wl-guide { font:13px/1.4 system-ui,sans-serif; color:#23272e; padding:10px 12px 12px; border-bottom:1px solid #dfe3e8; background:#f7faff; }
#wl-guide[hidden] { display:none; }
#wl-guide header { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
#wl-guide header h3 { margin:0; font-size:14px; flex:1; line-height:1.25; }
#wl-guide .wl-nav { all:unset; cursor:pointer; padding:2px 8px; border:1px solid #c5ccd6; border-radius:6px; background:#fff; font-size:13px; }
#wl-guide .wl-nav:hover { background:#eef3fe; }
#wl-guide .wl-pos { color:#6b7078; font-size:12px; white-space:nowrap; }
#wl-guide .wl-what { font-weight:600; margin:4px 0 2px; }
#wl-guide .wl-say { margin:0 0 8px; }
#wl-guide .wl-hint { color:#6b7078; font-size:12px; margin:4px 0; }
#wl-guide .wl-err { color:#b3261e; font-size:12px; margin:4px 0; min-height:15px; }
#wl-guide .wl-input { width:100%; box-sizing:border-box; font:inherit; font-size:18px; font-weight:600; padding:8px 10px; border:2px solid #2f6feb; border-radius:8px; letter-spacing:.02em; text-transform:uppercase; }
#wl-guide .wl-row { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
#wl-guide .wl-btn { font:inherit; font-size:13px; padding:6px 12px; border-radius:7px; border:1px solid #c5ccd6; background:#fff; cursor:pointer; }
#wl-guide .wl-btn.main { background:#2f6feb; border-color:#2f6feb; color:#fff; font-weight:600; }
#wl-guide .wl-btn:disabled { opacity:.55; cursor:default; }
#wl-guide ul { margin:4px 0 6px 16px; padding:0; }
#wl-guide .wl-done { font-weight:600; color:#17693a; }
#wl-guide .ly-fixcard { border:0; background:none; padding:0; margin:0; }
#wl-guide .ly-fixcard h4 { margin:0 0 4px; font-size:13px; }
#wl-guide .ly-badge { display:inline-block; font-size:10px; font-weight:700; text-transform:uppercase; padding:1px 7px; border-radius:9px; background:#dbe5fb; color:#1d4fb8; margin-left:6px; }
#wl-guide .ly-badge.g-hall { background:#d9f2e3; color:#17693a; }
#wl-guide .ly-badge.g-overlap { background:#fde0e0; color:#9b1c1f; }
#wl-guide .ly-badge.g-label { background:#fdeccb; color:#8a5300; }
#wl-guide .ly-fixnotes { max-height:150px; overflow:auto; }
#wl-guide .ly-fixbtns { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
#wl-guide .ly-fixbtns button { font:inherit; font-size:12px; padding:5px 11px; border-radius:7px; border:1px solid #c5ccd6; background:#fff; cursor:pointer; }
#wl-guide .ly-fixbtns .ly-yes { background:#2f6feb; border-color:#2f6feb; color:#fff; font-weight:600; }
#wl-guide .ly-fixbtns .ly-all { border-color:#2f6feb; color:#1d4fb8; }
#wl-guide .ly-hint { color:#6b7078; font-size:12px; margin:4px 0; }
#wl-guide .ly-need { max-height:220px; overflow:auto; }
#wl-guide .ly-row { display:block; width:100%; box-sizing:border-box; text-align:left; font:inherit; font-size:12px; padding:5px 8px; margin:0 0 3px; background:#fff; border:1px solid #e1e4e9; border-radius:6px; cursor:pointer; }
#wl-guide .ly-row:hover { background:#eef3fe; }
`;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

export function mountFixGuide(app) {
  const host = document.getElementById('validation');
  const props = document.getElementById('props');
  const properties = document.getElementById('properties');
  if (!host || !props) return { destroy() {}, open() {}, runApprovals() {} };
  if (!document.getElementById('wl-guide-style')) {
    const s = document.createElement('style');
    s.id = 'wl-guide-style'; s.textContent = STYLE; document.head.appendChild(s);
  }
  const panel = el('div'); panel.id = 'wl-guide'; panel.hidden = true;
  props.insertBefore(panel, properties || props.firstChild);

  let g = null; // { key, idx }
  let previewing = false, alive = true, raf = 0;
  const revert = () => { if (previewing && app.canvas && app.doc) app.canvas.setDoc(app.doc); previewing = false; };
  const notes = createNotesFlow(app, { el, render: () => render(), revert });

  // Fresh from the doc (not the debounced app.validation) so the list is right the instant a fix is saved;
  // the walking-route notes only exist in app.validation (they come from the router).
  const groupsNow = () => safe(() => {
    const doc = app.doc;
    const rooms = doc.items.filter((i) => i && i.type === 'room').length;
    const base = rooms <= 400 ? validate(doc) : (app.validation || []);
    const route = (app.validation || []).filter((v) => v.code === 'room-unreachable' && doc.items.some((i) => i.id === v.itemId));
    return noteGroups(doc, base.concat(route, docChecklistCodes(doc)), ignoredNow());
  }, []);
  // the problems the person chose to ignore, grouped the same way (so they can be put back)
  const ignoredNow = () => (app.ignoredIds ? app.ignoredIds() : new Set());
  const ignoredGroups = () => safe(() => {
    const ids = ignoredNow();
    if (!ids.size) return [];
    const doc = app.doc;
    const rooms = doc.items.filter((i) => i && i.type === 'room').length;
    const base = rooms <= 400 ? validate(doc) : (app.validation || []);
    const route = (app.validation || []).filter((v) => v.code === 'room-unreachable' && doc.items.some((i) => i.id === v.itemId));
    return noteGroups(doc, base.concat(route, docChecklistCodes(doc)), ids, 'ignored');
  }, []);
  const ignore = (ids) => { revert(); if (app.setIgnored) app.setIgnored(ids, true); app.toast && app.toast('Ignored. It is listed under "Ignored" if you want it back.'); };
  const unignore = (ids) => { if (app.setIgnored) app.setIgnored(ids, false); };
  const ignoreBtn = (stop, label = 'Ignore') => {
    const b = el('button', 'wl-btn', label); b.type = 'button'; b.title = 'Leave this alone: it will not stop you exporting';
    b.addEventListener('click', (e) => { e.stopPropagation(); ignore(stop.ids); });
    return b;
  };

  // ---- fly the map to the problem ------------------------------------------------------------
  function focus(ids) {
    app.setSelection(ids);
    const cv = app.canvas;
    const b = boxOfIds(app.doc, ids);
    if (!cv || !cv.getView || !b) return;
    const v = cv.getView();
    const W = v.w * v.zoom, H = v.h * v.zoom;
    // zoom in enough to see the problem clearly, but keep its neighbours in view for context
    const fit = Math.min((W * 0.3) / Math.max(b.w, 24), (H * 0.3) / Math.max(b.h, 24));
    const zoom = Math.max(0.2, Math.min(2.4, Math.max(v.zoom, fit)));
    cv.setView({ zoom, x: b.x + b.w / 2 - W / zoom / 2, y: b.y + b.h / 2 - H / zoom / 2 });
  }

  // ---- what can be done for one stop ---------------------------------------------------------
  const hits = (ids) => (f) => (f.ids || []).some((i) => ids.has(i));
  function fixFor(group, stop) {
    const ids = new Set(stop.ids), doc = app.doc;
    if (group.kind === 'overlap' && stop.cluster) {
      const p = safe(() => proposeFix(doc, stop.cluster), null);
      return p && p.changedIds.length ? { title: 'Trim the overlap', notes: p.notes, doc: p.doc, ids: p.changedIds, unresolved: p.unresolved } : null;
    }
    const pick = {
      number: findNumberFixes, numfix: findNumberFixes, label: findLabelFixes,
      hall: findHallFixes, 'hall-overlap': findHallFixes, 'room-hall': findHallFixes, route: findHallFixes,
    }[group.kind];
    return pick ? safe(() => pick(doc).find(hits(ids)) || null, null) : null;
  }
  function manualFor(group, stop) {
    const ids = new Set(stop.ids);
    const src = { number: findManualNumbers, numfix: findManualNumbers, label: findManualLabels, hall: findManualHalls, 'hall-overlap': findManualHalls, 'room-hall': findManualHalls, route: findManualHalls }[group.kind];
    const m = src ? safe(() => src(app.doc).find((x) => (x.ids || []).some((i) => ids.has(i))), null) : null;
    return m ? m.message : '';
  }

  const GUIDE = {
    number: ['This room has no number', "Type the room's number as it appears on the door or the poster (like 128, 128B or S117)."],
    numfix: ['This room number needs fixing', 'The number is in the wrong format or another room already uses it. Type the right one.'],
    overlap: ['These rooms overlap', 'The preview shows the rooms trimmed apart so they only touch.'],
    'hall-overlap': ['This hallway overlaps another', 'The preview shows the two hallways joined into one piece.'],
    hall: ["This hallway isn't connected", 'People cannot walk through it yet. The preview shows a link to the other hallways.'],
    'room-hall': ["This room doesn't reach a hallway", 'The preview shows a hallway reaching it.'],
    route: ['No walking route reaches this room', 'There is no hallway path from an entrance. Connect it to a hallway.'],
    label: ['This label is out of place', 'The preview puts it back inside its room.'],
    door: ['This door needs attention', 'Doors sit on the outside wall and carry an EXIT label.'],
    other: ['Worth a look', 'Select the highlighted item and check it.'],
  };
  const TOOL_HINT = {
    hall: ['Draw a hallway', 'hall', 'Draw a short hallway from this one to the others (tool: Draw a hallway).'],
    'room-hall': ['Draw a hallway', 'hall', 'Draw a short hallway from the nearest hallway to this room.'],
    route: ['Draw a hallway', 'hall', 'Draw a hallway to it, or add a door on the outside wall.'],
    door: ['Place doors', 'door', 'Drag the door onto the outside wall and give it an EXIT label.'],
  };

  // ---- rendering ----------------------------------------------------------------------------
  function done(group, title) {
    const gs = groupsNow();
    const nextG = gs.find((x) => x.key !== (group && group.key));
    panel.appendChild(el('div', 'wl-done', title));
    const row = el('div', 'wl-row');
    if (nextG) { const b = el('button', 'wl-btn main', `Next: ${nextG.title}`); b.type = 'button'; b.addEventListener('click', () => open(nextG.key, 0)); row.appendChild(b); }
    const c = el('button', 'wl-btn', 'Close'); c.type = 'button'; c.addEventListener('click', close); row.appendChild(c);
    panel.appendChild(row);
  }

  function render() {
    if (!alive) return;
    panel.textContent = '';
    if (properties) properties.style.display = g || notes.active() ? 'none' : '';
    panel.hidden = !(g || notes.active());
    if (!panel.hidden && panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' }); // the sidebar may be scrolled down to the group list
    if (notes.active()) { // "Fix all" approvals
      const head = el('header'); head.appendChild(el('h3', null, 'Review the fixes'));
      const x = el('button', 'wl-nav', '×'); x.type = 'button'; x.title = 'Close'; x.addEventListener('click', () => { notes.reset(); close(); });
      head.appendChild(x); panel.appendChild(head);
      notes.renderCard(panel);
      decorate();
      return;
    }
    if (!g) { decorate(); return; }
    const groups = groupsNow();
    const group = groups.find((x) => x.key === g.key);
    const head = el('header');
    head.appendChild(el('h3', null, group ? group.title : 'All clear'));
    const x = el('button', 'wl-nav', '×'); x.type = 'button'; x.title = 'Close'; x.addEventListener('click', close);
    if (group && group.stops.length > 1) {
      const n = group.stops.length;
      const pv = el('button', 'wl-nav', '‹'); pv.type = 'button'; pv.title = 'Previous'; pv.addEventListener('click', () => go(g.idx - 1));
      const nx = el('button', 'wl-nav', '›'); nx.type = 'button'; nx.title = 'Next'; nx.addEventListener('click', () => go(g.idx + 1));
      head.appendChild(pv); head.appendChild(el('span', 'wl-pos', `${Math.min(g.idx, n - 1) + 1} of ${n}`)); head.appendChild(nx);
    }
    head.appendChild(x);
    panel.appendChild(head);
    if (!group || !group.stops.length) { revert(); done(group, 'All done - nothing left in this group.'); decorate(); return; }
    g.idx = ((g.idx % group.stops.length) + group.stops.length) % group.stops.length;
    const stop = group.stops[g.idx];
    const [what, say] = GUIDE[group.kind] || GUIDE.other;
    const fix = fixFor(group, stop);
    revert();
    focus(stop.ids);
    panel.appendChild(el('div', 'wl-what', what));

    if (group.kind === 'number' || group.kind === 'numfix') return numberCard(group, stop, say, fix);
    if (fix && fix.doc) panel.appendChild(el('p', 'wl-say', say)); // "the preview shows ..." only when there is a preview
    if (fix && fix.doc) {
      app.canvas.setDoc(fix.doc); previewing = true; // preview only: nothing is saved until "Yes"
      app.setSelection(stop.ids);
      const ul = el('ul');
      for (const n of (fix.notes || []).slice(0, 6)) ul.appendChild(el('li', null, n));
      panel.appendChild(ul);
      const row = el('div', 'wl-row');
      const yes = el('button', 'wl-btn main', 'Yes, fix it'); yes.type = 'button';
      yes.addEventListener('click', () => { yes.disabled = true; apply(fix); });
      const sk = el('button', 'wl-btn', 'Skip'); sk.type = 'button'; sk.addEventListener('click', () => go(g.idx + 1));
      row.appendChild(yes); row.appendChild(sk); row.appendChild(ignoreBtn(stop)); panel.appendChild(row);
    } else {
      const why = manualFor(group, stop) || (stop.cluster ? 'These cannot be separated automatically without reshaping a room.' : '');
      if (why) panel.appendChild(el('div', 'wl-hint', why));
      const tip = TOOL_HINT[group.kind];
      if (tip) panel.appendChild(el('p', 'wl-say', tip[2]));
      else if (group.kind === 'overlap') panel.appendChild(el('p', 'wl-say', 'Drag one of the highlighted rooms (or resize it) so they no longer overlap.'));
      else if (group.kind === 'label') panel.appendChild(el('p', 'wl-say', "Select the room and drag its label inside it, or reset it in the room's properties."));
      const row = el('div', 'wl-row');
      if (tip) { const t = el('button', 'wl-btn main', tip[0]); t.type = 'button'; t.addEventListener('click', () => { revert(); app.setTool(tip[1]); }); row.appendChild(t); }
      const sk = el('button', 'wl-btn', group.stops.length > 1 ? 'Next problem' : 'Close'); sk.type = 'button';
      sk.addEventListener('click', () => (group.stops.length > 1 ? go(g.idx + 1) : close()));
      row.appendChild(sk); row.appendChild(ignoreBtn(stop)); panel.appendChild(row);
    }
    decorate();
  }

  function numberCard(group, stop, say, fix) {
    const id = stop.ids[0];
    const item = app.doc.items.find((i) => i.id === id);
    const suggestion = fix && fix.doc ? ((fix.doc.items.find((i) => i.id === id) || {}).number || '') : '';
    panel.appendChild(el('p', 'wl-say', say));
    if (suggestion) panel.appendChild(el('div', 'wl-hint', `Its neighbours suggest ${suggestion} - check it, then save.`));
    else { const why = manualFor(group, stop); if (why) panel.appendChild(el('div', 'wl-hint', why)); }
    const input = el('input', 'wl-input'); input.type = 'text'; input.maxLength = 8; input.placeholder = 'e.g. 128B';
    input.value = suggestion || (group.kind === 'numfix' && item ? item.number || '' : '');
    input.setAttribute('aria-label', 'Room number');
    const err = el('div', 'wl-err');
    const save = () => {
      const v = input.value.trim().toUpperCase();
      if (!NUMBER_RE.test(v)) { err.textContent = 'Use a number like 128, 128B or S117 (3 digits, optional letter before or after).'; input.focus(); return; }
      const clash = app.doc.items.find((i) => i.type === 'room' && i.id !== id && i.number === v);
      if (clash) { err.textContent = `${v} is already used by another room. Room numbers must be unique.`; input.focus(); return; }
      revert();
      app.commit(updateItem(app.doc, id, { number: v }), 'Set room number');
      render(); // the stop disappears; the next room comes up
    };
    input.addEventListener('input', () => { err.textContent = ''; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    panel.appendChild(input); panel.appendChild(err);
    const row = el('div', 'wl-row');
    const sv = el('button', 'wl-btn main', 'Save number'); sv.type = 'button'; sv.addEventListener('click', save);
    row.appendChild(sv);
    if (group.stops.length > 1) { const sk = el('button', 'wl-btn', 'Skip'); sk.type = 'button'; sk.addEventListener('click', () => go(g.idx + 1)); row.appendChild(sk); }
    row.appendChild(ignoreBtn(stop));
    panel.appendChild(row);
    panel.appendChild(el('div', 'wl-hint', 'Enter saves and jumps to the next room.'));
    decorate();
    setTimeout(() => { if (alive && document.activeElement !== input) { input.focus(); input.select(); } }, 0);
  }

  function apply(fix) {
    revert();
    const before = app.doc;
    app.commit(fix.doc, 'Fix: ' + (fix.title || 'worth a look'));
    if (app.doc === before) { go(g.idx + 1); return; }
    render();
  }
  function go(i) { if (!g) return; g.idx = i; render(); }
  function open(key, idx = 0) { notes.reset(); revert(); expanded = null; activeStop = -1; g = { key, idx }; render(); }
  function close() { revert(); g = null; render(); }

  // ---- the groups in the checklist -------------------------------------------------------------
  // Click a group: it opens in place, one row per problem. Click a row: the map flies to it. A room that
  // needs a number gets its box right there (Enter saves and moves to the next); overlaps can open in
  // Layers; everything else opens the guide card with the fix preview.
  let expanded = null, activeStop = -1, wantFocus = false, ignoredOpen = false;

  function saveNumber(id, raw, errEl) {
    const v = raw.trim().toUpperCase();
    if (!NUMBER_RE.test(v)) { errEl.textContent = 'Use a number like 128, 128B or S117.'; return false; }
    if (app.doc.items.some((i) => i.type === 'room' && i.id !== id && i.number === v)) { errEl.textContent = `${v} is already used by another room.`; return false; }
    app.commit(updateItem(app.doc, id, { number: v }), 'Set room number');
    return true;
  }

  function inlineFor(grp, stop, idx) {
    const box = el('div', 'wl-inline');
    box.addEventListener('click', (e) => e.stopPropagation());
    const id = stop.ids[0];
    if (grp.kind === 'number' || grp.kind === 'numfix') {
      const fix = fixFor(grp, stop);
      const sug = fix && fix.doc ? ((fix.doc.items.find((i) => i.id === id) || {}).number || '') : '';
      const cur = (app.doc.items.find((i) => i.id === id) || {}).number || '';
      if (sug) box.appendChild(el('div', 'wl-hint', `Its neighbours suggest ${sug} - check it, then save.`));
      const input = el('input', 'wl-input'); input.type = 'text'; input.maxLength = 8; input.placeholder = 'e.g. 128B';
      input.value = sug || (grp.kind === 'numfix' ? cur : ''); input.setAttribute('aria-label', 'Room number');
      const err = el('div', 'wl-err');
      const save = () => { if (saveNumber(id, input.value, err)) { wantFocus = true; decorate(); } else input.focus(); };
      input.addEventListener('input', () => { err.textContent = ''; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); activeStop = -1; decorate(); }
      });
      const row = el('div', 'wl-row');
      const sv = el('button', 'wl-btn main', 'Save'); sv.type = 'button'; sv.addEventListener('click', save);
      row.appendChild(sv);
      row.appendChild(ignoreBtn(stop));
      box.append(input, err, row);
      if (wantFocus) setTimeout(() => { if (alive && input.isConnected) { input.focus(); input.select(); } }, 0);
      return box;
    }
    const row = el('div', 'wl-row');
    if (grp.kind === 'overlap') {
      const lb = el('button', 'wl-btn', 'Show in Layers'); lb.type = 'button';
      lb.addEventListener('click', () => {
        app.setSelection(stop.ids);
        const lp = document.getElementById('layers-panel');
        if (app._layers && (!lp || lp.hidden)) app._layers.toggle();
      });
      row.appendChild(lb);
    }
    const fb = el('button', 'wl-btn main', 'Show me how to fix it'); fb.type = 'button';
    fb.addEventListener('click', () => open(grp.key, idx));
    row.appendChild(fb);
    row.appendChild(ignoreBtn(stop));
    box.appendChild(row);
    return box;
  }

  function decorate() {
    if (!alive) return;
    const list = host.querySelector('.notes-list');
    const title = [...host.querySelectorAll('.section-title')].find((t) => /worth a look/i.test(t.textContent));
    if (!list || !title) return;
    list.classList.add('wl-hidden');
    let box = host.querySelector('.wl-groups');
    if (!box) { box = el('div', 'wl-groups'); title.after(box); }
    const groups = groupsNow();
    if (expanded && !groups.some((x) => x.key === expanded)) { expanded = null; activeStop = -1; }
    box.textContent = '';
    for (const grp of groups) {
      const isOpen = expanded === grp.key;
      const b = el('button', `wl-group k-${grp.kind}${isOpen || (g && g.key === grp.key) ? ' on' : ''}`); b.type = 'button';
      b.setAttribute('aria-expanded', String(isOpen));
      b.appendChild(el('span', 'wl-t', grp.title)); b.appendChild(el('span', 'wl-go', '\u203a'));
      b.title = 'Show every one, and take me to it';
      b.addEventListener('click', () => {
        close();
        expanded = isOpen ? null : grp.key; activeStop = -1; wantFocus = false;
        decorate();
      });
      box.appendChild(b);
      if (!isOpen) continue;
      const stops = el('div', 'wl-stops');
      grp.stops.forEach((stop, idx) => {
        const lab = stopLabel(app.doc, stop, grp.kind);
        const r = el('div', 'wl-stop' + (idx === activeStop ? ' cur' : '')); r.tabIndex = 0; r.setAttribute('role', 'button');
        r.appendChild(el('span', null, lab.title)); if (lab.sub) r.appendChild(el('small', null, lab.sub));
        const pick = () => { activeStop = idx; wantFocus = true; focus(stop.ids); decorate(); };
        r.addEventListener('click', pick);
        r.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === r) { e.preventDefault(); pick(); } });
        if (idx === activeStop) r.appendChild(inlineFor(grp, stop, idx));
        stops.appendChild(r);
      });
      const ia = el('button', 'wl-ign wl-ignall', grp.stops.length > 1 ? `Ignore all ${grp.stops.length}` : 'Ignore'); ia.type = 'button';
      ia.title = 'Leave these alone: they will not stop you exporting';
      ia.addEventListener('click', (e) => { e.stopPropagation(); ignore([...new Set(grp.stops.flatMap((s) => s.ids))]); });
      stops.appendChild(ia);
      box.appendChild(stops);
    }
    // what was ignored, so it can be put back
    const ig = ignoredGroups();
    if (ig.length) {
      // one row per ignored thing, even when it had several problems (a room with no number that also misses a hallway)
      const seen = new Set();
      for (const grp of ig) grp.stops = grp.stops.filter((s) => { const k = s.ids.slice().sort().join('+'); if (seen.has(k)) return false; seen.add(k); return true; });
      const total = seen.size;
      const det = el('details', 'wl-ignored');
      if (ignoredOpen) det.open = true;
      det.addEventListener('toggle', () => { ignoredOpen = det.open; });
      det.appendChild(el('summary', null, `Ignored (${total})`));
      for (const grp of ig) {
        for (const stop of grp.stops) {
          const lab = stopLabel(app.doc, stop, grp.kind);
          const r = el('div', 'wl-igrow');
          const t = el('span', null, lab.title); if (lab.sub) t.appendChild(el('small', null, lab.sub));
          t.title = grp.title; t.style.cursor = 'pointer'; t.addEventListener('click', () => focus(stop.ids));
          const b = el('button', 'wl-ign', 'Stop ignoring'); b.type = 'button'; b.addEventListener('click', () => unignore(stop.ids));
          r.append(t, b); det.appendChild(r);
        }
      }
      if (total > 1) { const all = el('button', 'wl-ign wl-ignall', 'Stop ignoring all'); all.type = 'button'; all.addEventListener('click', () => unignore([...ignoredNow()])); det.appendChild(all); }
      box.appendChild(det);
    }
    wantFocus = false;
    if (!groups.length) list.classList.remove('wl-hidden'); // groups unavailable: fall back to the plain list
  }
  const obs = new MutationObserver(() => { if (alive && !host.querySelector('.wl-groups')) decorate(); });
  obs.observe(host, { childList: true });
  const unsub = app.subscribe((e) => {
    if (e.type === 'doc' || e.type === 'validation' || e.type === 'project') {
      if (notes.active()) notes.onDoc();
      if (!raf) raf = setTimeout(() => { raf = 0; if (alive && (g || notes.active())) render(); else if (alive) decorate(); }, 60);
    }
  });
  decorate();

  return {
    open, close,
    runApprovals() { g = null; if (!notes.active() && notes.canStart()) notes.start(); else render(); },
    destroy() {
      alive = false; unsub(); obs.disconnect(); if (raf) clearTimeout(raf);
      notes.destroy(); revert();
      if (properties) properties.style.display = '';
      host.querySelectorAll('.wl-groups').forEach((n) => n.remove());
      host.querySelectorAll('.wl-hidden').forEach((n) => n.classList.remove('wl-hidden'));
      panel.remove();
    },
  };
}
