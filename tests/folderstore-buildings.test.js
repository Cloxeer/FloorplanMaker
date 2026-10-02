// folderstore-buildings.test.js — the project folder keeps each building's floors in its own subfolder
// (<Building>/<slug>.floorplan.json). Runs folderStore.js against an in-memory FileSystemDirectoryHandle,
// plus the store/buildings.js registry with a mocked localStorage (no IndexedDB, no connected folder).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  writeProject, listProjects, readProject, deleteProject,
  createBuildingFolder, listBuildingFolders, deleteBuildingFolder, writeBuildingFiles,
} from '../js/store/folderStore.js';
import { listBuildings, createBuilding, deleteBuilding, findBuilding } from '../js/store/buildings.js';

// ---- in-memory FileSystemDirectoryHandle ---------------------------------------------------------------
class NotFound extends Error { constructor(n) { super(`not found: ${n}`); this.name = 'NotFoundError'; } }
class MemFile {
  constructor(name) { this.kind = 'file'; this.name = name; this.text = ''; }
  async createWritable() {
    const self = this; let buf = '';
    return { async write(d) { buf += typeof d === 'string' ? d : String(d); }, async close() { self.text = buf; } };
  }
  async getFile() { const t = this.text; return { size: t.length, text: async () => t }; }
}
class MemDir {
  constructor(name) { this.kind = 'directory'; this.name = name; this.map = new Map(); }
  async getDirectoryHandle(name, { create = false } = {}) {
    const e = this.map.get(name);
    if (e && e.kind === 'directory') return e;
    if (e) throw Object.assign(new Error('type mismatch'), { name: 'TypeMismatchError' });
    if (!create) throw new NotFound(name);
    const d = new MemDir(name); this.map.set(name, d); return d;
  }
  async getFileHandle(name, { create = false } = {}) {
    const e = this.map.get(name);
    if (e && e.kind === 'file') return e;
    if (e) throw Object.assign(new Error('type mismatch'), { name: 'TypeMismatchError' });
    if (!create) throw new NotFound(name);
    const f = new MemFile(name); this.map.set(name, f); return f;
  }
  async removeEntry(name, { recursive = false } = {}) {
    const e = this.map.get(name);
    if (!e) throw new NotFound(name);
    if (e.kind === 'directory' && e.map.size && !recursive) throw Object.assign(new Error('not empty'), { name: 'InvalidModificationError' });
    this.map.delete(name);
  }
  async *entries() { for (const [n, h] of [...this.map]) yield [n, h]; }
  names() { return [...this.map.keys()].sort(); }
}

let seq = 0; // folderStore dedups writes per slug for the life of the process, so every test uses its own slugs
const uid = () => `t${++seq}`;
function project(slug, building, floor = 1, property = '7', extra = {}) {
  return {
    id: `id-${slug}`, slug, name: building || slug, createdAt: 1, savedAt: 1000 + seq,
    doc: { version: 1, meta: { building, property, floor, slug }, viewBox: { x: 0, y: 0, w: 10, h: 10 }, floor: null, items: [], sections: [] },
    photo: null, view: { zoom: 1, panX: 0, panY: 0, onion: 0.5 }, history: { past: [], future: [] }, ...extra,
  };
}
const jsonOf = (p) => JSON.stringify({ version: 1, id: p.id, slug: p.slug, name: p.name, createdAt: p.createdAt, savedAt: p.savedAt, doc: p.doc, photo: null, view: p.view });
async function putTopLevel(root, p) { const f = await root.getFileHandle(`${p.slug}.floorplan.json`, { create: true }); const w = await f.createWritable(); await w.write(jsonOf(p)); await w.close(); }

// ---- folderStore -----------------------------------------------------------------------------------------
test('writeProject puts the file in the building subfolder, not at the top level', async () => {
  const root = new MemDir('root'); const s = uid();
  await writeProject(root, project(s, 'Jett Hall', 0));
  assert.deepEqual(root.names(), ['Jett Hall']);
  const dir = await root.getDirectoryHandle('Jett Hall');
  assert.deepEqual(dir.names(), [`${s}.floorplan.json`]); // the .tmp file is cleaned up
  const back = await readProject(root, s);
  assert.equal(back.slug, s);
  assert.equal(back.doc.meta.building, 'Jett Hall');
});

test('a project with no building name stays at the top level', async () => {
  const root = new MemDir('root'); const s = uid();
  await writeProject(root, project(s, ''));
  assert.deepEqual(root.names(), [`${s}.floorplan.json`]);
});

test('building folder names drop characters a folder cannot hold', async () => {
  const root = new MemDir('root'); const s = uid();
  await writeProject(root, project(s, 'A/B: "C"'));
  assert.deepEqual(root.names(), ['AB C']);
});

test('a legacy top-level file is still listed and read, and moves into the subfolder on the next write', async () => {
  const root = new MemDir('root'); const s = uid();
  const p = project(s, 'Old Hall', 2);
  await putTopLevel(root, p);

  let list = await listProjects(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].slug, s);
  assert.equal(list[0].building, 'Old Hall');
  assert.equal(list[0].dir, '');
  assert.equal((await readProject(root, s)).slug, s);

  await writeProject(root, { ...p, savedAt: 5000 });
  assert.deepEqual(root.names(), ['Old Hall']); // the stray top-level copy is gone
  list = await listProjects(root);
  assert.equal(list.length, 1); // not duplicated
  assert.equal(list[0].dir, 'Old Hall');
  assert.equal(list[0].floor, 2);
  assert.equal(list[0].property, '7');
});

test('listProjects walks every building subfolder and skips Finished', async () => {
  const root = new MemDir('root'); const a = uid(), b = uid(), c = uid();
  await writeProject(root, project(a, 'North', 1));
  await writeProject(root, project(b, 'South', 1));
  await putTopLevel(root, project(c, 'Legacy', 3));
  // something that looks like a project but lives in Finished must be ignored
  const fin = await root.getDirectoryHandle('Finished', { create: true });
  await putTopLevel(fin, project(uid(), 'Decoy', 1));
  const slugs = (await listProjects(root)).map((p) => p.slug).sort();
  assert.deepEqual(slugs, [a, b, c].sort());
});

test('listProjects skips corrupt files and non-project files', async () => {
  const root = new MemDir('root'); const s = uid();
  await writeProject(root, project(s, 'Fine'));
  const dir = await root.getDirectoryHandle('Fine');
  const bad = await dir.getFileHandle('broken.floorplan.json', { create: true });
  const w = await bad.createWritable(); await w.write('{nope'); await w.close();
  await dir.getFileHandle('notes.txt', { create: true });
  assert.deepEqual((await listProjects(root)).map((p) => p.slug), [s]);
});

test('deleteProject finds a file in a subfolder and at the top level; missing slug throws', async () => {
  const root = new MemDir('root'); const a = uid(), b = uid();
  await writeProject(root, project(a, 'Delta', 1));
  await putTopLevel(root, project(b, 'Echo', 1));
  await deleteProject(root, a);
  await deleteProject(root, b);
  assert.deepEqual((await listProjects(root)).length, 0);
  assert.deepEqual((await root.getDirectoryHandle('Delta')).names(), []); // folder stays, file is gone
  await assert.rejects(() => deleteProject(root, a), /No project file/);
  await assert.rejects(() => readProject(root, 'never-existed'), /No project file/);
});

test('deleteProject drops the write cache, so the same project can be written again', async () => {
  const root = new MemDir('root'); const s = uid(); const p = project(s, 'Foxtrot');
  await writeProject(root, p);
  await deleteProject(root, s);
  await writeProject(root, p); // identical content: would be skipped if the cache survived the delete
  assert.equal((await listProjects(root)).length, 1);
});

test('a saved project with unchanged content is not rewritten (dedup still works inside the subfolder)', async () => {
  const root = new MemDir('root'); const s = uid(); const p = project(s, 'Golf');
  await writeProject(root, p);
  const dir = await root.getDirectoryHandle('Golf');
  const before = (await dir.getFileHandle(`${s}.floorplan.json`)).text;
  (await dir.getFileHandle(`${s}.floorplan.json`)).text = 'tampered';
  await writeProject(root, p); // same signature: skipped
  assert.equal((await dir.getFileHandle(`${s}.floorplan.json`)).text, 'tampered');
  assert.ok(before.length > 20);
});

test('building folders: create, list (with property), delete', async () => {
  const root = new MemDir('root');
  await createBuildingFolder(root, { building: 'Alpha Hall', property: '11' });
  await createBuildingFolder(root, { building: 'Beta Hall', property: '22' });
  await root.getDirectoryHandle('Just A Folder', { create: true }); // no building.json: not a building
  await root.getFileHandle('loose.txt', { create: true });
  const list = await listBuildingFolders(root);
  assert.deepEqual(list.map((b) => [b.building, b.property, b.dir]).sort(), [['Alpha Hall', '11', 'Alpha Hall'], ['Beta Hall', '22', 'Beta Hall']]);

  await deleteBuildingFolder(root, 'Alpha Hall');
  assert.deepEqual((await listBuildingFolders(root)).map((b) => b.building), ['Beta Hall']);
  await deleteBuildingFolder(root, 'Alpha Hall'); // already gone: no throw
});

test('creating a building folder twice keeps one folder and the floors already in it', async () => {
  const root = new MemDir('root'); const s = uid();
  await createBuildingFolder(root, { building: 'Hotel', property: '1' });
  await writeProject(root, project(s, 'Hotel'));
  await createBuildingFolder(root, { building: 'Hotel', property: '1' });
  assert.deepEqual(root.names(), ['Hotel']);
  assert.equal((await listProjects(root)).length, 1);
  assert.equal((await listBuildingFolders(root)).length, 1);
});

test('a building folder keeps its floors listed; deleting the folder removes them too', async () => {
  const root = new MemDir('root'); const s = uid();
  await createBuildingFolder(root, { building: 'India', property: '5' });
  await writeProject(root, project(s, 'India'));
  assert.equal((await listProjects(root)).length, 1);
  await deleteBuildingFolder(root, 'India');
  assert.equal((await listProjects(root)).length, 0);
  assert.deepEqual(root.names(), []);
});

test('Finished is never a building', async () => {
  const root = new MemDir('root');
  await writeBuildingFiles(root, 'Juliet', [{ name: 'j-1.svg', data: '<svg/>' }]);
  // even a building.json planted inside Finished must not make it show up
  const fin = await root.getDirectoryHandle('Finished');
  const f = await fin.getFileHandle('building.json', { create: true });
  const w = await f.createWritable(); await w.write(JSON.stringify({ building: 'Finished', property: '0' })); await w.close();
  assert.deepEqual(await listBuildingFolders(root), []);
  assert.deepEqual(await listProjects(root), []);
  assert.deepEqual((await (await fin.getDirectoryHandle('Juliet')).getFileHandle('j-1.svg')).text, '<svg/>');
  assert.deepEqual(fin.names().sort(), ['Juliet', 'building.json']);
});

test('a building literally named Finished is not hidden-by-accident: its floors land in Finished and are not listed', async () => {
  // Documents the current behaviour: the Finished folder is reserved for exports, so projects written into it
  // are not part of the project list. (Guards against someone silently changing the reservation.)
  const root = new MemDir('root'); const s = uid();
  await writeProject(root, project(s, 'Finished'));
  assert.deepEqual((await listProjects(root)).map((p) => p.slug), []);
});

test('buildings whose names look alike do not collide', async () => {
  const root = new MemDir('root'); const a = uid(), b = uid(), c = uid(), d = uid();
  await writeProject(root, project(a, 'Smith Hall', 1));
  await writeProject(root, project(b, 'Smith  Hall ', 1)); // extra spaces fold to the same folder name
  await writeProject(root, project(c, 'Smith-Hall', 1));
  await writeProject(root, project(d, 'smith hall', 1)); // different case: its own folder on a case-sensitive disk
  const names = root.names();
  assert.ok(names.includes('Smith Hall'));
  assert.ok(names.includes('Smith-Hall'));
  // whichever folders they share, every project is still its own file and is listed once
  const list = await listProjects(root);
  assert.deepEqual(list.map((p) => p.slug).sort(), [a, b, c, d].sort());
  for (const s of [a, b, c, d]) assert.equal((await readProject(root, s)).slug, s);
});

test('two buildings with the same floor number keep separate files (distinct slugs, distinct folders)', async () => {
  const root = new MemDir('root'); const a = uid(), b = uid();
  await writeProject(root, project(a, 'Kilo', 1));
  await writeProject(root, project(b, 'Lima', 1));
  const kilo = await root.getDirectoryHandle('Kilo'), lima = await root.getDirectoryHandle('Lima');
  assert.deepEqual(kilo.names(), [`${a}.floorplan.json`]);
  assert.deepEqual(lima.names(), [`${b}.floorplan.json`]);
  assert.deepEqual((await listProjects(root)).map((p) => p.building).sort(), ['Kilo', 'Lima']);
});

test('moving a project to another building moves its file', async () => {
  const root = new MemDir('root'); const s = uid(); const p = project(s, 'Mike');
  await writeProject(root, p);
  await writeProject(root, { ...p, doc: { ...p.doc, meta: { ...p.doc.meta, building: 'November' } } });
  const list = await listProjects(root);
  assert.equal(list.length >= 1, true);
  assert.ok((await root.getDirectoryHandle('November')).names().includes(`${s}.floorplan.json`));
});

// ---- store/buildings.js (registry in localStorage; no IndexedDB, no folder) ---------------------------------
function mockStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
  return m;
}
const app = { folder: undefined };

test('buildings: empty registry lists nothing', async () => {
  mockStorage();
  assert.deepEqual(await listBuildings(app), []);
  assert.deepEqual(await listBuildings(undefined), []);
});

test('buildings: createBuilding validates, registers, and listBuildings sorts by name', async () => {
  const store = mockStorage();
  assert.deepEqual(await createBuilding(app, { building: '  ', property: '1' }), { error: 'Type the building name.' });
  assert.deepEqual(await createBuilding(app, { building: 'Zed Hall', property: '' }), { error: 'Type the property number.' });
  assert.equal(store.has('fp.buildings'), false);

  const r = await createBuilding(app, { building: '  Zed Hall ', property: ' 9 ' });
  assert.equal(r.ok, true);
  assert.equal(r.building.building, 'Zed Hall');
  assert.equal(r.building.property, '9');
  assert.deepEqual(r.building.floors, []);
  await createBuilding(app, { building: 'Apple Hall', property: '3' });

  const list = await listBuildings(app);
  assert.deepEqual(list.map((b) => [b.building, b.property, b.floors.length]), [['Apple Hall', '3', 0], ['Zed Hall', '9', 0]]);
  assert.equal(JSON.parse(store.get('fp.buildings')).length, 2);
});

test('buildings: a duplicate name is refused, ignoring case and extra spaces', async () => {
  mockStorage();
  await createBuilding(app, { building: 'Jett Hall', property: '1' });
  for (const dup of ['Jett Hall', 'jett hall', '  JETT   hall  ']) {
    const r = await createBuilding(app, { building: dup, property: '2' });
    assert.match(r.error, /already exists/);
  }
  assert.equal((await listBuildings(app)).length, 1);
  assert.equal((await findBuilding(app, 'JETT HALL')).building, 'Jett Hall');
  assert.equal(await findBuilding(app, 'Nope'), null);
});

test('buildings: deleteBuilding removes only that building from the registry', async () => {
  const store = mockStorage();
  await createBuilding(app, { building: 'One', property: '1' });
  await createBuilding(app, { building: 'Two', property: '2' });
  const one = await findBuilding(app, 'One');
  await deleteBuilding(app, one);
  assert.deepEqual((await listBuildings(app)).map((b) => b.building), ['Two']);
  assert.equal(JSON.parse(store.get('fp.buildings')).length, 1);
  // deleting again, or a building that was never there, does not throw
  await deleteBuilding(app, one);
  await deleteBuilding(app, { building: 'Ghost', floors: [] });
  assert.deepEqual((await listBuildings(app)).map((b) => b.building), ['Two']);
});

test('buildings: a corrupt or odd registry is ignored', async () => {
  mockStorage({ 'fp.buildings': '{not json' });
  assert.deepEqual(await listBuildings(app), []);
  mockStorage({ 'fp.buildings': '{"a":1}' });
  assert.deepEqual(await listBuildings(app), []);
  mockStorage({ 'fp.buildings': JSON.stringify([null, { nope: 1 }, { building: 'Kept', property: '4' }]) });
  assert.deepEqual((await listBuildings(app)).map((b) => b.building), ['Kept']);
});

test('buildings: with a connected folder, building folders are listed and created there', async () => {
  mockStorage();
  const root = new MemDir('root');
  const withFolder = { folder: { state: 'granted', handle: root } };
  await createBuildingFolder(root, { building: 'From Disk', property: '8' });
  let list = await listBuildings(withFolder);
  assert.deepEqual(list.map((b) => [b.building, b.property]), [['From Disk', '8']]);

  await createBuilding(withFolder, { building: 'New One', property: '2' });
  assert.ok(root.names().includes('New One'));
  list = await listBuildings(withFolder);
  assert.deepEqual(list.map((b) => b.building), ['From Disk', 'New One']);

  // a floor on disk shows up in its building
  const s = uid();
  await writeProject(root, project(s, 'New One', 4, '2'));
  list = await listBuildings(withFolder);
  const nb = list.find((b) => b.building === 'New One');
  assert.deepEqual(nb.floors.map((f) => [f.slug, f.onDisk]), [[s, true]]);

  // permission not granted: the folder is ignored (registry only)
  const locked = await listBuildings({ folder: { state: 'prompt', handle: root } });
  assert.deepEqual(locked.map((b) => b.building), ['New One']);

  // deleting removes its disk folder and the floor in it
  await deleteBuilding(withFolder, nb);
  assert.ok(!root.names().includes('New One'));
  assert.deepEqual((await listBuildings(withFolder)).map((b) => b.building), ['From Disk']);
});

test('buildings: a project only on disk (no registry entry, no folder file) still makes a building', async () => {
  mockStorage();
  const root = new MemDir('root'); const s = uid();
  await putTopLevel(root, project(s, 'Legacy Lodge', 2));
  const list = await listBuildings({ folder: { state: 'granted', handle: root } });
  assert.deepEqual(list.map((b) => [b.building, b.floors.length]), [['Legacy Lodge', 1]]);
});
