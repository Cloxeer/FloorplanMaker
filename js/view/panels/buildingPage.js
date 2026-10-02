// buildingPage.js (view)
// One building's page: its floors (Open / Delete), "Start blueprint" for a new floor, "Open .json project"
// and "Import .svg". Everything after that is the normal photo -> trace -> preview -> export flow.
// Depends on: js/store/buildings.js, js/store/autosave.js, js/store/folderStore.js, js/view/panels/blueprint.js.

import { findBuilding, listBuildings, moveFloor, createBuilding } from '../../store/buildings.js';
import { deleteProject } from '../../store/autosave.js';
import * as folderStore from '../../store/folderStore.js';
import { showConfirm, showCreateBuilding } from './blueprint.js';
import { floorLabel } from '../../model/building.js';

const STYLE = `
#building { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
#building .bd-floors-title { font-size: 15px; margin: 0 0 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
#bd-floors { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
#bd-floors .bd-move { width: 100%; margin-top: 8px; font: inherit; font-size: 12px; padding: 5px 6px; border-radius: 6px; border: 1px solid var(--border, #ccd); background: #fff; }
#bd-floors .bd-hint { color: var(--muted); grid-column: 1 / -1; margin: 0 0 4px; }
#bd-floors .bd-empty { color: var(--muted); grid-column: 1 / -1; }
`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (ts) => {
  if (!ts) return 'never saved';
  const m = Math.floor((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};

export function mountBuildingPage(app, { onBack, onOpenFloor, onStart, onImport, onImportSvg } = {}) {
  const root = document.getElementById('building');
  if (!root) return { show() {}, destroy() {} };
  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
  const nameEl = root.querySelector('#bd-name'), subEl = root.querySelector('#bd-sub'), listEl = root.querySelector('#bd-floors');
  const openJson = root.querySelector('#bd-open-json'), importSvg = root.querySelector('#bd-import-svg');
  let current = null, alive = true;

  root.querySelector('#bd-back').addEventListener('click', () => { if (onBack) onBack(); });
  root.querySelector('#bd-start').addEventListener('click', () => { if (current && onStart) onStart(current); });
  const fileText = (input, cb) => async () => { const f = input.files[0]; if (!f) return; const t = await f.text(); input.value = ''; if (cb) cb(t, current); };
  openJson.addEventListener('change', fileText(openJson, onImport));
  importSvg.addEventListener('change', fileText(importSvg, onImportSvg));

  // "Move to a building...": every other building, plus a new one. Floors made before buildings existed
  // start in "Unnamed building"; this is how they get a home.
  async function fillMove(select, floor) {
    let all = [];
    try { all = await listBuildings(app); } catch (e) { return; }
    for (const b of all) {
      if (b.building === current.building || b.unnamed) continue;
      const o = document.createElement('option'); o.value = `b:${b.building}`; o.textContent = b.building; select.appendChild(o);
    }
    const n = document.createElement('option'); n.value = 'new'; n.textContent = '+ New building…'; select.appendChild(n);
    select.addEventListener('change', async () => {
      const v = select.value; select.value = '';
      let target = null;
      if (v === 'new') {
        const made = await showCreateBuilding(async (x) => (!x.building || !x.property ? 'Both fields are required.' : ''));
        if (!made) return;
        const r = await createBuilding(app, made);
        if (r.error && !/already exists/.test(r.error)) { app.toast(r.error); return; }
        target = made;
      } else if (v.startsWith('b:')) {
        const b = all.find((x) => x.building === v.slice(2));
        target = b ? { building: b.building, property: b.property } : null;
      }
      if (!target) return;
      const res = await moveFloor(app, floor, target);
      if (res.error) { app.toast(res.error); return; }
      app.toast(`Floor ${floor.floor} moved to ${target.building}.`);
      show(current.building);
    });
  }

  async function show(name) {
    nameEl.textContent = name; subEl.textContent = ''; listEl.innerHTML = '';
    const b = await findBuilding(app, name);
    if (!alive) return null;
    current = b || { building: name, property: '', floors: [] };
    nameEl.textContent = current.building;
    subEl.textContent = [current.property ? `Property ${current.property}` : '', `${current.floors.length} ${current.floors.length === 1 ? 'floor' : 'floors'}`].filter(Boolean).join(' · ');
    if (current.unnamed && current.floors.length) { const hint = document.createElement('p'); hint.className = 'bd-hint'; hint.textContent = 'These floors were made before buildings existed. Use Move to a building on each one to file it.'; listEl.appendChild(hint); }
    if (!current.floors.length) { listEl.innerHTML = '<p class="bd-empty">No floors yet. Press Start blueprint to add the first one.</p>'; return current; }
    for (const f of current.floors) {
      const card = document.createElement('div');
      card.className = 'project-card'; card.dataset.slug = f.slug;
      card.innerHTML = `<h3>${esc(floorLabel(f.floor))}</h3><div class="meta">${esc(f.slug)} ${f.onDisk ? '<span class="chip">on disk</span>' : ''}</div><div class="meta">Saved ${ago(f.savedAt)}</div>
        <div class="row"><button type="button" class="btn-open">Open</button><button type="button" class="btn-delete">Delete</button></div>
        <select class="bd-move" aria-label="Move this floor to a building"><option value="">Move to a building…</option></select>`;
      fillMove(card.querySelector('.bd-move'), f);
      card.querySelector('.btn-open').addEventListener('click', () => { if (onOpenFloor) onOpenFloor(f); });
      card.querySelector('.btn-delete').addEventListener('click', async () => {
        if (!(await showConfirm(`Delete ${floorLabel(f.floor)} of "${current.building}"? This cannot be undone.`))) return;
        try {
          if (f.id) await deleteProject(f.id);
          const h = app.folder && app.folder.state === 'granted' ? app.folder.handle : null;
          if (h && f.onDisk) await folderStore.deleteProject(h, f.slug);
        } catch (e) { app.toast('Could not delete that floor.'); }
        show(current.building);
      });
      listEl.appendChild(card);
    }
    return current;
  }

  return { show, current: () => current, destroy() { alive = false; style.remove(); } };
}
