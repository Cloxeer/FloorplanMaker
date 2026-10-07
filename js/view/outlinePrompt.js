// outlinePrompt.js (view)
// The card shown over the stage while the building has no outline. A plan with no outline yet: "Draw outline".
// An outline that was just removed (Delete key, Remove outline, undo...): the old outline is remembered, so the
// card offers Restore outline (puts it back, carried to wherever the rooms are now, moved or turned), Auto-outline
// (draws a fresh one round the pieces on the plan) and Draw it again (by hand). Each is one undo step.
// The buttons are static in index.html (#btn-overlay-draw is wired in mainActions.js); this only shows / hides them.
// Depends on: js/model/outlineRestore.js, js/model/document.js (setFloor), app.commit, app.toast.

import { setFloor } from '../model/document.js';
import { rememberOutline, restoreOutline, autoOutline, hasOutline } from '../model/outlineRestore.js';
import { hasPieces, outlinesOf } from '../model/connect.js';

const hasPlan = (doc) => !!(doc && (doc.items || []).some((it) => it.type === 'room' || it.type === 'hall' || it.type === 'stair'));

export function mountOutlinePrompt(app) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('start-overlay');
  if (!overlay) return { update() {}, destroy() {} };
  const title = $('overlay-title'), text = $('overlay-text');
  const btnRestore = $('btn-overlay-restore'), btnAuto = $('btn-overlay-auto'), btnDraw = $('btn-overlay-draw');
  const idle = (b) => { if (b && b.blur) b.blur(); };

  // the last outline this floor had; seeded from the undo history so it survives re-opening the project
  let memory = null;
  const hist = (app.project && app.project.history) || {};
  for (const list of [hist.past || [], hist.future || []]) {
    for (let i = list.length - 1; i >= 0 && !memory; i--) {
      try { memory = rememberOutline(JSON.parse(list[i])); } catch { /* skip an unreadable step */ }
    }
  }

  function update() {
    const doc = app.doc;
    if (hasOutline(doc)) { memory = rememberOutline(doc); overlay.hidden = true; return; }
    // a floor built from several photos is drawn building by building (Layers, then Auto-outline / Connect hallways): no prompt
    if (hasPieces(doc) || outlinesOf(doc).length) { overlay.hidden = true; return; }
    const plan = hasPlan(doc);
    overlay.hidden = false;
    overlay.classList.toggle('has-plan', plan && !!memory);
    btnRestore.hidden = !memory;
    btnAuto.hidden = !plan;
    if (memory) {
      title.textContent = 'The building outline is gone';
      text.textContent = plan
        ? 'Put it back where it was (it follows your rooms if they moved), or let the app draw a new one around them.'
        : 'Put it back where it was, or draw a new one.';
      btnDraw.textContent = 'Draw it again';
      btnDraw.className = 'btn btn-secondary';
    } else {
      title.textContent = 'Start by outlining the building';
      text.textContent = plan ? 'Click the corners of the building on the photo, or let the app draw it around your rooms.' : 'Click the corners of the building on the photo.';
      btnDraw.textContent = 'Draw outline';
      btnDraw.className = 'btn btn-primary';
    }
  }

  function apply(points, label, message) {
    let doc = setFloor(app.doc, points);
    app.commit(doc, label);
    if (app.setSelection) app.setSelection(['floor']);
    if (app.toast) app.toast(message);
  }
  function onRestore(e) {
    idle(e.currentTarget);
    const r = restoreOutline(memory, app.doc);
    if (!r) { if (app.toast) app.toast('Could not restore it. Draw it again instead.'); return; }
    const how = { same: 'Outline restored.', moved: 'Outline restored, moved to where your rooms are now.', refit: 'Outline restored and widened to fit your rooms. Check the edges.' }[r.how];
    apply(r.points, 'Restore outline', how + (r.turned ? ' (It was turned with them.)' : ''));
  }
  function onAuto(e) {
    idle(e.currentTarget);
    const r = autoOutline(app.doc);
    if (!r) { if (app.toast) app.toast('Add a room first, or draw the outline by hand.'); return; }
    apply(r.points, 'Auto-outline', 'Drew a new outline around your rooms. Use Edit outline to fine-tune it.');
  }
  btnRestore.addEventListener('click', onRestore);
  btnAuto.addEventListener('click', onAuto);
  update();

  return {
    update,
    destroy() { btnRestore.removeEventListener('click', onRestore); btnAuto.removeEventListener('click', onAuto); },
  };
}
