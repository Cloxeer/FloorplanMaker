// floors.js (view)
// "Floors" sidebar, opened from View: every floor of the current building (floors are projects that share
// a building name), the one you are on highlighted. Click a floor to switch the editor to it (all four
// steps stay the same per floor); "Add a floor" asks "What floor is this?" and starts it at the photo.
// It temporarily replaces the properties column, like View layers.
// Depends on: js/model/building.js, js/store/autosave.js (listProjects), js/store/folderStore.js,
// app.startFloor / app.switchFloor (js/mainActions.js).

import { floorsOf, parseFloor, floorLabel } from '../../model/building.js';
import { listProjects, loadProject } from '../../store/autosave.js';
import * as folderStore from '../../store/folderStore.js';

const STYLE = `
#floors-panel { font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; color:#1d1d1f; padding:12px; overflow:auto; height:100%; box-sizing:border-box; }
#floors-panel[hidden] { display:none; }
#floors-panel header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; }
#floors-panel h3 { margin:0; font-size:15px; }
#floors-panel .fl-sub { color:#6e6e73; font-size:12px; margin-top:2px; }
#floors-panel .fl-x { all:unset; cursor:pointer; padding:0 6px; font-size:18px; line-height:1; color:#6e6e73; }
#floors-panel .fl-row { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; box-sizing:border-box; text-align:left; font:inherit; color:inherit; background:#fff; border:1px solid #e1e4e9; border-radius:10px; padding:10px 12px; margin:0 0 6px; cursor:pointer; }
#floors-panel .fl-row:hover { background:#f2f6ff; }
#floors-panel .fl-row small { color:#6e6e73; font-size:11px; display:block; margin-top:1px; }
#floors-panel .fl-row.fl-cur { background:#e8f1ff; border-color:#0a84ff; cursor:default; }
#floors-panel .fl-badge { font-size:11px; font-weight:600; color:#0a84ff; }
#floors-panel .fl-add { width:100%; margin-top:6px; padding:10px; font:600 13px inherit; border-radius:10px; border:1px dashed #0a84ff; background:#fff; color:#0a84ff; cursor:pointer; }
#floors-panel .fl-add:hover { background:#f2f6ff; }
#floors-panel .fl-hint { color:#6e6e73; font-size:12px; margin:10px 2px 0; }
`;


async function entries(app) {
  let list = [];
  try { list = await listProjects(); } catch (e) { /* none */ }
  const h = app.folder && app.folder.state === 'granted' ? app.folder.handle : null;
  if (h) { try { list = list.concat((await folderStore.listProjects(h)).map((p) => ({ ...p, onDisk: true }))); } catch (e) { /* ignore */ } }
  return list;
}

// Every floor of the building being edited, lowest first (the floor on screen is always included).
export async function listFloors(app) {
  const meta = app.doc && app.doc.meta;
  if (!meta) return [];
  const floors = floorsOf(await entries(app), meta, app.project && app.project.slug);
  if (app.project && !floors.some((f) => f.slug === app.project.slug)) {
    floors.push({ slug: app.project.slug, floor: meta.floor, id: app.project.id, savedAt: Date.now(), onDisk: false, hasPhoto: !!app.project.photo, current: true });
    floors.sort((a, b) => Number(a.floor) - Number(b.floor));
  }
  return floors;
}

// The saved project behind every floor; the floor on screen uses its live document. -> [{ floor, slug, current, project }]
export async function loadFloorProjects(app) {
  const out = [];
  for (const f of await listFloors(app)) {
    let project = null;
    if (f.current) project = { ...app.project, doc: app.doc };
    else {
      try { if (f.id) project = await loadProject(f.id); } catch (e) { /* try the folder */ }
      const h = app.folder && app.folder.state === 'granted' ? app.folder.handle : null;
      if (!project && h) { try { project = await folderStore.readProject(h, f.slug); } catch (e) { /* skip */ } }
    }
    if (project && project.doc) out.push({ floor: f.floor, slug: f.slug, current: f.current, project });
  }
  return out;
}

export function mountFloors(app) {
  const props = document.getElementById('props');
  const pop = document.getElementById('view-popover');
  if (!props || !pop) return { destroy() {}, toggle() {} };
  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
  const panel = document.createElement('div'); panel.id = 'floors-panel'; panel.hidden = true;
  props.insertBefore(panel, props.firstChild);

  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'btn-floors'; btn.textContent = 'Floors'; btn.title = 'The floors of this building';
  btn.setAttribute('aria-pressed', 'false');
  pop.insertBefore(btn, pop.firstChild); // above the Photo slider

  let open = false, token = 0, alive = true;

  const currentFloors = () => listFloors(app);

  async function render() {
    if (!open || !alive) return;
    const my = ++token;
    const meta = (app.doc && app.doc.meta) || {};
    const floors = await currentFloors();
    if (my !== token || !open) return;
    panel.textContent = '';
    const head = document.createElement('header');
    const t = document.createElement('div');
    t.innerHTML = '<h3></h3><div class="fl-sub"></div>';
    t.querySelector('h3').textContent = meta.building || 'Building';
    t.querySelector('.fl-sub').textContent = `${floors.length} ${floors.length === 1 ? 'floor' : 'floors'}`;
    const x = document.createElement('button'); x.type = 'button'; x.className = 'fl-x'; x.textContent = '×'; x.title = 'Close';
    x.addEventListener('click', () => setOpen(false));
    head.append(t, x); panel.appendChild(head);

    for (const f of floors) {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'fl-row' + (f.current ? ' fl-cur' : ''); row.dataset.slug = f.slug;
      const left = document.createElement('span');
      left.innerHTML = '<b></b><small></small>';
      left.querySelector('b').textContent = floorLabel(f.floor);
      left.querySelector('small').textContent = f.slug;
      const right = document.createElement('span'); right.className = 'fl-badge'; right.textContent = f.current ? 'Editing' : 'Open ›';
      row.append(left, right);
      if (!f.current) row.addEventListener('click', () => { setOpen(false); if (app.switchFloor) app.switchFloor(f.slug); });
      panel.appendChild(row);
    }
    const add = document.createElement('button'); add.type = 'button'; add.className = 'fl-add'; add.textContent = '+ Add a floor';
    add.addEventListener('click', async () => {
      const taken = floors.map((f) => f.floor);
      let value = '';
      for (;;) {
        const raw = await app.prompt('What floor is this?', value);
        if (raw == null) return;
        const r = parseFloor(raw, taken);
        if (r.error) { app.toast(r.error); value = raw; continue; }
        setOpen(false);
        if (app.startFloor) app.startFloor(r.floor);
        return;
      }
    });
    panel.appendChild(add);
    const hint = document.createElement('p'); hint.className = 'fl-hint';
    hint.textContent = 'Each floor has its own photo, outline, rooms and preview. Export can include them all.';
    panel.appendChild(hint);
  }

  function setOpen(v) {
    open = !!v;
    if (open) { // one sidebar at a time
      const lp = document.getElementById('layers-panel');
      if (lp && !lp.hidden && app._layers) app._layers.toggle();
    }
    panel.hidden = !open;
    for (const c of props.children) if (c !== panel && c.id !== 'layers-panel') c.style.display = open ? 'none' : '';
    btn.setAttribute('aria-pressed', String(open));
    if (open) { pop.hidden = true; render(); }
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  const layersBtn = document.getElementById('btn-layers');
  const onLayers = () => { if (open) setOpen(false); };
  if (layersBtn) layersBtn.addEventListener('click', onLayers, true);
  const unsub = app.subscribe((e) => { if (open && (e.type === 'project' || e.type === 'doc')) render(); });

  return {
    toggle: () => setOpen(!open),
    isOpen: () => open,
    destroy() {
      alive = false; unsub();
      if (layersBtn) layersBtn.removeEventListener('click', onLayers, true);
      panel.remove(); btn.remove(); style.remove();
      for (const c of props.children) c.style.display = '';
    },
  };
}
