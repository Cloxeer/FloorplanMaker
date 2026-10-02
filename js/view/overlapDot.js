// overlapDot.js
// A red notification dot on the View button and on "View layers" while the plan has any overlapping
// rooms/stairs; it stays until the last overlap is fixed (by hand, by Fix overlaps, or by undo).
// Counts with js/model/overlapCount.js (same rule as the Layers panel), debounced after every change.
// Depends on: js/model/overlapCount.js.

import { countOverlaps } from '../model/overlapCount.js';

const STYLE = `
.ov-dot-host { position: relative; }
.ov-dot-host.has-overlap::after {
  content: ''; position: absolute; top: -4px; right: -4px; width: 11px; height: 11px; border-radius: 50%;
  background: #e5242b; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(229,36,43,.35); pointer-events: none;
  animation: ov-dot-pop .35s ease-out;
}
@keyframes ov-dot-pop { from { transform: scale(0); } 70% { transform: scale(1.25); } to { transform: scale(1); } }
`;

export function mountOverlapDot(app) {
  if (!document.getElementById('ov-dot-style')) {
    const s = document.createElement('style');
    s.id = 'ov-dot-style'; s.textContent = STYLE; document.head.appendChild(s);
  }
  const hosts = () => ['btn-view', 'btn-layers'].map((id) => document.getElementById(id)).filter(Boolean);
  const base = new Map(); // original title / aria-label so they can be restored
  let timer = 0, alive = true, last = -1;

  function paint(pairs) {
    for (const el of hosts()) {
      el.classList.add('ov-dot-host');
      if (!base.has(el)) base.set(el, { title: el.getAttribute('title'), aria: el.getAttribute('aria-label') });
      el.classList.toggle('has-overlap', pairs > 0);
      const b = base.get(el);
      const msg = `${pairs} overlapping ${pairs === 1 ? 'pair' : 'pairs'} of rooms - open View layers to fix`;
      if (pairs > 0) { el.setAttribute('title', msg); el.setAttribute('aria-label', msg); }
      else {
        if (b.title == null) el.removeAttribute('title'); else el.setAttribute('title', b.title);
        if (b.aria == null) el.removeAttribute('aria-label'); else el.setAttribute('aria-label', b.aria);
      }
    }
  }
  function refresh() {
    timer = 0;
    if (!alive) return;
    let pairs = 0;
    try { pairs = app.doc ? countOverlaps(app.doc).pairs : 0; } catch { pairs = 0; }
    last = pairs;
    paint(pairs);
  }
  const schedule = () => { if (alive && !timer) timer = setTimeout(refresh, 120); };
  const unsub = app.subscribe((e) => { if (e.type === 'doc' || e.type === 'project' || e.type === 'step') schedule(); });
  refresh();

  return {
    count: () => last,
    destroy() {
      alive = false;
      unsub();
      if (timer) clearTimeout(timer);
      paint(0);
    },
  };
}
