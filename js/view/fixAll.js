// fixAll.js (view)
// A "Fix all" button to the right of the "Worth a look" heading in the checklist panel.
// One click: every SAFE fix is applied at once (a single undo step); whatever needs approval (inferred
// room numbers, reshaped rooms, new hallway pieces ...) is then walked through as confirmation cards in
// the right sidebar (js/view/panels/fixguide.js); what cannot be fixed is listed there under "Needs you".
// The button is added from outside (a MutationObserver on the panel), so validation.js stays as it is.
// Depends on: js/model/fixAuto.js, js/model/fixNotes.js, and app._guide.runApprovals (fixguide.js).

import { autoFixAll } from '../model/fixAuto.js';
import { nextFix, manualLeft } from '../model/fixNotes.js';

const STYLE = `
#validation .section-title.wl-title { display:flex; align-items:center; justify-content:space-between; gap:8px; }
#validation .wl-fixall { font:inherit; font-size:12px; font-weight:600; line-height:1; padding:5px 11px; border-radius:6px; border:1px solid #2f6feb; background:#2f6feb; color:#fff; cursor:pointer; text-transform:none; letter-spacing:0; }
#validation .wl-fixall:hover { filter:brightness(1.07); }
#validation .wl-actions { display:flex; align-items:center; gap:10px; }
#validation .wl-switch { display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:600; color:#6b4f00; cursor:pointer; user-select:none; text-transform:none; letter-spacing:0; }
#validation .wl-switch input { position:absolute; opacity:0; width:0; height:0; }
#validation .wl-switch .wl-track { position:relative; width:30px; height:17px; border-radius:9px; background:#c9cdd3; transition:background .15s; flex:none; }
#validation .wl-switch .wl-track::after { content:''; position:absolute; top:2px; left:2px; width:13px; height:13px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.3); transition:transform .15s; }
#validation .wl-switch input:checked + .wl-track { background:#f2b600; }
#validation .wl-switch input:checked + .wl-track::after { transform:translateX(13px); }
#validation .wl-switch input:focus-visible + .wl-track { outline:2px solid #2f6feb; outline-offset:2px; }
#validation .wl-fixall:disabled { opacity:.55; cursor:default; }
`;

export function mountFixAll(app) {
  const host = document.getElementById('validation');
  if (!host) return { destroy() {} };
  if (!document.getElementById('wl-fixall-style')) {
    const s = document.createElement('style');
    s.id = 'wl-fixall-style'; s.textContent = STYLE; document.head.appendChild(s);
  }
  let busy = false, alive = true;

  async function run(btn) {
    if (busy || !app.doc) return;
    busy = true; btn.disabled = true;
    try {
      let fixed = 0;
      const ignoredIds = app.ignoredIds ? app.ignoredIds() : null;
      const r = autoFixAll(app.doc, { ignoredIds });
      if (r.applied.length) {
        app.commit(r.doc, 'Fix all'); // ONE undo step for every safe fix
        fixed = r.applied.length;
      }
      const pending = !!nextFix(r.doc, new Set(), { ignoredIds }); // fixes that need approval
      const manual = manualLeft(r.doc, ignoredIds);
      if (fixed) app.toast(`Fix all: ${fixed} ${fixed === 1 ? 'fix' : 'fixes'} applied${pending ? ' - the rest need your OK' : manual.length ? ` - ${manual.length} left for you` : ''}`);
      if (pending || manual.length) {
        // approvals (and the "Needs you" list) show in the right sidebar guide card, one at a time
        if (app._guide && typeof app._guide.runApprovals === 'function') app._guide.runApprovals();
        else app.toast('Click a group under Worth a look to review the rest.');
      } else if (!fixed) app.toast('Nothing to fix - the plan is clean.');
    } catch (e) {
      app.toast('Fix all could not finish. Click a group under Worth a look to fix the notes one at a time.');
    } finally {
      busy = false; btn.disabled = false;
    }
  }

  function decorate() {
    if (!alive) return;
    for (const t of host.querySelectorAll('.section-title')) {
      if (!/worth a look/i.test(t.textContent) || t.querySelector('.wl-actions')) continue;
      t.classList.add('wl-title');
      const box = document.createElement('span');
      box.className = 'wl-actions';
      // highlights switch: the yellow outlines on the plan (on by default, remembered)
      const sw = document.createElement('label');
      sw.className = 'wl-switch';
      sw.title = 'Outline every Worth a look item in yellow on the plan';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.setAttribute('role', 'switch'); cb.setAttribute('aria-label', 'Highlight on the plan');
      cb.checked = !app._attention || app._attention.isEnabled();
      cb.addEventListener('change', () => { if (app._attention) app._attention.setEnabled(cb.checked); });
      const tr = document.createElement('span'); tr.className = 'wl-track';
      const tx = document.createElement('span'); tx.textContent = 'Highlight';
      sw.append(cb, tr, tx);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'wl-fixall'; b.textContent = 'Fix all';
      b.title = 'Fix everything that is safe to fix, then ask about the rest';
      b.addEventListener('click', () => run(b));
      box.append(sw, b);
      t.appendChild(box);
    }
  }
  const obs = new MutationObserver(() => decorate());
  obs.observe(host, { childList: true, subtree: false });
  decorate();

  return {
    destroy() { alive = false; obs.disconnect(); host.querySelectorAll('.wl-actions').forEach((b) => b.remove()); },
  };
}
