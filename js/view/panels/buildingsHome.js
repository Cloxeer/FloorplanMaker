// buildingsHome.js (view)
// Start screen: the list of buildings (cards with Open / Delete), "Create building" and "Open building file".
// A building opens onto its own Floors page (buildingPage.js).
// Depends on: js/store/buildings.js, js/view/panels/blueprint.js (showConfirm, showCreateBuilding).

import { listBuildings, createBuilding, deleteBuilding, findBuilding } from '../../store/buildings.js';
import { showConfirm, showCreateBuilding } from './blueprint.js';
import { floorLabel } from '../../model/building.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountBuildings(el, app, { onOpenBuilding, onImport } = {}) {
  const createBtn = document.getElementById('btn-start-blueprint');
  const openInput = document.getElementById('open-json-input');
  let alive = true;

  async function onCreate() {
    const v = await showCreateBuilding(async (x) => {
      if (!x.building || !x.property) return 'Both fields are required.';
      return (await findBuilding(app, x.building)) ? `"${x.building}" already exists. Open it from the list.` : '';
    });
    if (!v) return;
    const r = await createBuilding(app, v);
    if (r.error) { app.toast(r.error); return; }
    if (onOpenBuilding) onOpenBuilding(r.building.building);
  }
  async function onFile() {
    const file = openInput.files[0];
    if (!file) return;
    const text = await file.text();
    if (onImport) onImport(text);
    openInput.value = '';
  }
  if (createBtn) createBtn.addEventListener('click', onCreate);
  if (openInput) openInput.addEventListener('change', onFile);

  async function refresh() {
    if (!alive) return;
    el.innerHTML = '<p style="color:var(--muted)">Loading buildings…</p>';
    let list = [];
    try { list = await listBuildings(app); } catch (e) { el.innerHTML = '<p style="color:var(--muted)">Could not load saved buildings.</p>'; return; }
    if (!alive) return;
    if (!list.length) { el.innerHTML = '<p style="color:var(--muted)">No buildings yet. Create a building to begin.</p>'; return; }
    el.innerHTML = '';
    for (const b of list) {
      const card = document.createElement('div');
      card.className = 'project-card building-card';
      card.dataset.building = b.building;
      const floors = b.floors.map((f) => floorLabel(f.floor).replace('Floor ', '')).join(', ');
      card.innerHTML = `
        <h3>${esc(b.building)}</h3>
        <div class="meta">${b.property ? `Property ${esc(b.property)} &middot; ` : ''}${b.floors.length} ${b.floors.length === 1 ? 'floor' : 'floors'}${floors ? ` (${esc(floors)})` : ''}</div>
        <div class="row"><button type="button" class="btn-open">Open</button><button type="button" class="btn-delete">Delete</button></div>`;
      card.querySelector('.btn-open').addEventListener('click', () => { if (onOpenBuilding) onOpenBuilding(b.building); });
      card.querySelector('.btn-delete').addEventListener('click', async () => {
        const n = b.floors.length;
        const ok = await showConfirm(n ? `Delete "${b.building}" and its ${n} ${n === 1 ? 'floor' : 'floors'}? This cannot be undone.` : `Delete "${b.building}"?`);
        if (!ok) return;
        try { await deleteBuilding(app, b); } catch (e) { app.toast('Could not delete that building.'); }
        refresh();
      });
      el.appendChild(card);
    }
  }
  refresh();

  return {
    refresh,
    destroy() {
      alive = false;
      if (createBtn) createBtn.removeEventListener('click', onCreate);
      if (openInput) openInput.removeEventListener('change', onFile);
      el.innerHTML = '';
    },
  };
}
