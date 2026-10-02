// buildings.js (store)
// Buildings: a name + property number, with floors. The floors are ordinary projects that share the
// building name; a building with no floors yet is remembered in a small registry (localStorage) and, when a
// project folder is connected, as a subfolder with a building.json, so it shows up on the start screen.
// Depends on: js/model/building.js, js/store/autosave.js, js/store/folderStore.js.

import { floorsOf, buildingFolderName, UNNAMED, isUnnamed } from '../model/building.js';
import { listProjects, deleteProject, loadProject, saveNow } from './autosave.js';
import * as folderStore from './folderStore.js';

const KEY = 'fp.buildings';
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
export const buildingKey = (name) => norm(name);

function readRegistry() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((b) => b && b.building) : []; } catch (e) { return []; }
}
function writeRegistry(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* private mode: still listed through its floors */ } }
const folderOf = (app) => (app && app.folder && app.folder.state === 'granted' && app.folder.handle ? app.folder.handle : null);

// Every project entry (browser copy + folder copy), as projects.js lists them.
export async function allEntries(app) {
  let list = [];
  try { list = (await listProjects()).map((p) => ({ ...p })); } catch (e) { /* none */ }
  const h = folderOf(app);
  if (h) { try { list = list.concat((await folderStore.listProjects(h)).map((p) => ({ ...p, onDisk: true }))); } catch (e) { /* ignore */ } }
  return list;
}

// -> [{ building, property, createdAt, floors:[{slug,floor,id,onDisk,savedAt,hasPhoto}] }] sorted by name
export async function listBuildings(app) {
  const entries = await allEntries(app);
  const by = new Map();
  const touch = (rawName, property, createdAt) => {
    const name = isUnnamed(rawName) ? UNNAMED : rawName; // floors with no building go in "Unnamed building"
    const k = buildingKey(name);
    if (!k) return null;
    if (!by.has(k)) by.set(k, { building: String(name).trim(), property: property || '', createdAt: createdAt || 0, unnamed: name === UNNAMED });
    const b = by.get(k);
    if (!b.property && property) b.property = property;
    return b;
  };
  for (const r of readRegistry()) touch(r.building, r.property, r.createdAt);
  const h = folderOf(app);
  if (h) { try { for (const f of await folderStore.listBuildingFolders(h)) touch(f.building, f.property); } catch (e) { /* ignore */ } }
  for (const p of entries) touch(p.building || p.name || '', p.property);
  return [...by.values()]
    .map((b) => ({ ...b, floors: floorsOf(entries, b, null) }))
    .sort((a, b) => a.building.localeCompare(b.building, undefined, { sensitivity: 'base' }));
}

export async function findBuilding(app, name) {
  const k = buildingKey(name);
  return (await listBuildings(app)).find((b) => buildingKey(b.building) === k) || null;
}

// -> { ok:true, building } | { error }
export async function createBuilding(app, { building, property }) {
  const name = String(building || '').trim(), prop = String(property || '').trim();
  if (!name) return { error: 'Type the building name.' };
  if (!prop) return { error: 'Type the property number.' };
  if (isUnnamed(name)) return { error: `"${UNNAMED}" is a reserved name. Pick the building's real name.` };
  if (await findBuilding(app, name)) return { error: `"${name}" already exists. Open it from the list.` };
  const reg = readRegistry();
  reg.push({ building: name, property: prop, createdAt: Date.now() });
  writeRegistry(reg);
  const h = folderOf(app);
  if (h) { try { await folderStore.createBuildingFolder(h, { building: name, property: prop }); } catch (e) { /* the registry still has it */ } }
  return { ok: true, building: { building: name, property: prop, floors: [] } };
}

// Removes the building and every floor in it.
export async function deleteBuilding(app, b) {
  const h = folderOf(app);
  for (const f of b.floors || []) {
    try { if (f.id) await deleteProject(f.id); } catch (e) { /* keep going */ }
    if (h && f.onDisk) { try { await folderStore.deleteProject(h, f.slug); } catch (e) { /* keep going */ } }
  }
  if (h) { try { await folderStore.deleteBuildingFolder(h, b.building); } catch (e) { /* keep going */ } }
  writeRegistry(readRegistry().filter((r) => buildingKey(r.building) !== buildingKey(b.building)));
}
export { buildingFolderName };

// Move one floor into another building: sets its building name and property and saves it (the project folder
// copy moves into the new building's subfolder). Refuses when that building already has the same floor.
// -> { ok:true } | { error }
export async function moveFloor(app, floor, target) {
  const dest = (await findBuilding(app, target.building)) || { floors: [] };
  if (dest.floors.some((f) => Number(f.floor) === Number(floor.floor) && f.slug !== floor.slug)) {
    return { error: `${target.building} already has Floor ${floor.floor}.` };
  }
  const h = folderOf(app);
  let project = null;
  try { if (floor.id) project = await loadProject(floor.id); } catch (e) { /* try the folder */ }
  if (!project && h) { try { project = await folderStore.readProject(h, floor.slug); } catch (e) { /* none */ } }
  if (!project || !project.doc) return { error: 'Could not open that floor to move it.' };
  const property = target.property || (project.doc.meta && project.doc.meta.property) || '';
  project.doc = { ...project.doc, meta: { ...project.doc.meta, building: target.building, property } };
  project.name = target.building;
  try { await saveNow(project); } catch (e) { return { error: 'Could not save the moved floor.' }; }
  if (h) { try { await folderStore.writeProject(h, project); } catch (e) { return { error: 'Moved in the browser, but could not write the folder copy.' }; } }
  return { ok: true };
}
