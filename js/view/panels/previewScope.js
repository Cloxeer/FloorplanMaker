// previewScope.js (view)
// Beside the "Preview" title: choose what to look at, "This floor" or "All floors" of the building.
// All floors shows every floor's finished plan as a card (floor label on top) so the whole building can be
// checked before exporting. The choice is handed back through onScope so Export can offer the same.
// Depends on: js/view/buildingExport.js data (floors prepared by prepareBuilding).

const STYLE = `
#preview .pv-scope { display:inline-flex; vertical-align:middle; margin-left:14px; }
#preview .pv-title-row { display:flex; align-items:center; flex-wrap:wrap; }
#preview .pv-all { flex:1; min-width:0; overflow:auto; background:#e8eaed; border-radius:8px; padding:14px; display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:14px; align-content:start; }
#preview .pv-all[hidden] { display:none; }
#preview .pv-card { background:#fff; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.15); padding:10px; display:flex; flex-direction:column; gap:6px; min-width:0; }
#preview .pv-card h4 { margin:0; font-size:13px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
#preview .pv-card .pv-bad { color:#b3261e; font-size:11px; font-weight:600; }
#preview .pv-card .pv-svg { height:300px; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:6px; overflow:hidden; }
#preview .pv-card svg { max-width:100%; max-height:100%; width:auto; height:auto; }
#preview .pv-card .pv-empty { color:#6e6e73; font-size:12px; }
`;

export function mountPreviewScope(root, { floorsPromise, getPage, finalSvgFor, scope = 'this', onScope }) {
  if (!floorsPromise) return;
  floorsPromise.then((floors) => {
    if (!root.isConnected || !floors || floors.length < 2) return;
    const h2 = root.querySelector('.preview-header h2');
    const body = root.querySelector('.preview-body');
    const wrap = root.querySelector('#preview-svg-wrap');
    const side = root.querySelector('.preview-side');
    if (!h2 || !body || !wrap) return;
    const style = document.createElement('style'); style.textContent = STYLE; root.appendChild(style);
    const row = document.createElement('div'); row.className = 'pv-title-row';
    h2.parentNode.insertBefore(row, h2); row.appendChild(h2);
    const seg = document.createElement('div'); seg.className = 'seg pv-scope'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'What to preview');
    seg.innerHTML = `<button type="button" data-scope="this">This floor</button><button type="button" data-scope="all">All floors (${floors.length})</button>`;
    row.appendChild(seg);
    const all = document.createElement('div'); all.className = 'pv-all'; all.hidden = true;
    body.insertBefore(all, side || null);

    function fill() {
      all.textContent = '';
      for (const f of floors) {
        const card = document.createElement('div'); card.className = 'pv-card';
        const h = document.createElement('h4');
        const t = document.createElement('span'); t.textContent = `Floor ${f.floor}`;
        h.appendChild(t);
        if (f.errors) { const b = document.createElement('span'); b.className = 'pv-bad'; b.textContent = `${f.errors} to fix`; h.appendChild(b); }
        const box = document.createElement('div'); box.className = 'pv-svg';
        let svg = '';
        try { svg = finalSvgFor(f, getPage()); } catch (e) { svg = ''; }
        if (svg) box.innerHTML = svg; else { box.innerHTML = '<span class="pv-empty">Nothing drawn on this floor yet</span>'; }
        const el = box.querySelector('svg');
        if (el) { el.removeAttribute('width'); el.removeAttribute('height'); }
        card.append(h, box); all.appendChild(card);
      }
    }
    function set(v) {
      scope = v;
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.scope === v));
      wrap.hidden = v === 'all'; wrap.style.display = v === 'all' ? 'none' : '';
      all.hidden = v !== 'all';
      if (v === 'all') fill();
      if (onScope) onScope(v);
    }
    seg.addEventListener('click', (e) => { const b = e.target.closest('button[data-scope]'); if (b) set(b.dataset.scope); });
    root.querySelector('#preview-page').addEventListener('click', () => { if (scope === 'all') setTimeout(fill, 0); });
    set(scope);
  }).catch(() => { /* one floor only: nothing to add */ });
}
