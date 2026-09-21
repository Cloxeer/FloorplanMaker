// autosave.js — IndexedDB-backed project storage + cross-tab notification.
// Depends on: nothing (pure browser APIs: indexedDB, BroadcastChannel).
// Exports: openDb, listProjects, loadProject, saveProject, saveNow, flush,
// deleteProject, exportProjectJson, importProjectJson, onExternalChange,
// suspend, resume, lastSavedAt, formatSavedAgo, installAutosaveHooks.
// Guarded so importing this module in Node (no indexedDB) does not throw.

const DB_NAME = 'floorplan-studio';
const DB_VERSION = 1;
const STORE = 'projects';
const CHANNEL_NAME = 'fps-studio';
const DEBOUNCE_MS = 300;
const HAS_IDB = typeof indexedDB !== 'undefined';
const HAS_BC = typeof BroadcastChannel !== 'undefined';

export const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
const channel = HAS_BC ? new BroadcastChannel(CHANNEL_NAME) : null;

let _lastSavedAt = null;
let dbPromise = null;
// id -> { timer, pending, resolvers:[{resolve,reject}], inFlight }
const pendingSaves = new Map();
const suspended = new Set();

export function openDb() {
  if (!HAS_IDB) return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('savedAt', 'savedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open database.'));
  });
  return dbPromise;
}
function tx(mode) { return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE)); }
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(mapError(req.error));
  });
}
function mapError(err) {
  if (err && err.name === 'QuotaExceededError') {
    return new Error('Storage is full — free up space (delete old projects or photos) and try again.');
  }
  return err || new Error('Storage operation failed.');
}

export async function listProjects() {
  const all = await reqToPromise((await tx('readonly')).getAll());
  return all
    .slice()
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      building: p.doc && p.doc.meta ? p.doc.meta.building : undefined,
      floor: p.doc && p.doc.meta ? p.doc.meta.floor : undefined,
      savedAt: p.savedAt,
      hasPhoto: !!(p.photo && p.photo.dataUrl),
    }));
}
export async function loadProject(id) { return (await reqToPromise((await tx('readonly')).get(id))) || null; }
function writeProject(project) {
  return tx('readwrite').then(
    (store) =>
      new Promise((resolve, reject) => {
        const req = store.put(project);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(mapError(req.error));
      })
  );
}
function broadcast(id, savedAt) {
  if (!channel) return;
  try { channel.postMessage({ id, savedAt, tab: TAB_ID }); } catch { /* ignore closed channel */ }
}
function getEntry(id) {
  let entry = pendingSaves.get(id);
  if (!entry) { entry = { timer: null, pending: null, resolvers: [], inFlight: null }; pendingSaves.set(id, entry); }
  return entry;
}
function finishOrRepeat(id) {
  const entry = pendingSaves.get(id);
  if (!entry) return;
  entry.inFlight = null;
  if (entry.pending) doWrite(id); // queued while in flight
  else if (!entry.timer) pendingSaves.delete(id);
}
async function doWrite(id) {
  const entry = pendingSaves.get(id);
  if (!entry) return;
  const project = entry.pending;
  entry.pending = null;
  const resolvers = entry.resolvers;
  entry.resolvers = [];
  if (suspended.has(id)) {
    resolvers.forEach((r) => r.resolve());
    finishOrRepeat(id);
    return;
  }
  project.savedAt = Date.now();
  entry.inFlight = writeProject(project)
    .then(() => {
      _lastSavedAt = project.savedAt;
      broadcast(id, project.savedAt);
      resolvers.forEach((r) => r.resolve());
    })
    .catch((err) => resolvers.forEach((r) => r.reject(err)))
    .finally(() => finishOrRepeat(id));
  return entry.inFlight;
}

export function saveProject(project) {
  const id = project.id;
  if (suspended.has(id)) return Promise.resolve();
  const entry = getEntry(id);
  entry.pending = project;
  return new Promise((resolve, reject) => {
    entry.resolvers.push({ resolve, reject });
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!entry.inFlight) doWrite(id); // else: finishOrRepeat picks up entry.pending
    }, DEBOUNCE_MS);
  });
}
export function saveNow(project) {
  const id = project.id;
  if (suspended.has(id)) return Promise.resolve();
  const entry = getEntry(id);
  entry.pending = project;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  const p = new Promise((resolve, reject) => entry.resolvers.push({ resolve, reject }));
  if (!entry.inFlight) doWrite(id);
  return p;
}
export function flush() {
  const all = [];
  for (const [id, entry] of pendingSaves.entries()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.pending && !entry.inFlight) doWrite(id);
    if (entry.inFlight) all.push(entry.inFlight);
    else if (entry.resolvers.length) {
      all.push(new Promise((resolve) => entry.resolvers.push({ resolve, reject: resolve })));
    }
  }
  return Promise.all(all).then(() => undefined);
}
export async function deleteProject(id) {
  const store = await tx('readwrite');
  await new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(mapError(req.error));
  });
  pendingSaves.delete(id);
  suspended.delete(id);
}

export function exportProjectJson(project) {
  const payload = {
    version: 1,
    id: project.id,
    slug: project.slug,
    name: project.name,
    createdAt: project.createdAt,
    savedAt: project.savedAt,
    doc: project.doc,
    photo: project.photo,
    view: project.view,
  };
  return JSON.stringify(payload, null, 2);
}
export function importProjectJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || typeof data !== 'object') throw new Error('That file does not contain a project.');
  if (data.version !== 1) throw new Error('Unsupported project file version.');
  if (!data.id || !data.doc) throw new Error('That file is missing required project fields (id, doc).');
  return {
    id: data.id,
    slug: data.slug || '',
    name: data.name || '',
    createdAt: data.createdAt || Date.now(),
    savedAt: data.savedAt || Date.now(),
    doc: data.doc,
    photo: data.photo || null,
    view: data.view || { zoom: 1, panX: 0, panY: 0, onion: 0.5 },
    history: { past: [], future: [] },
  };
}
export function onExternalChange(cb) {
  if (!channel) return () => {};
  const handler = (ev) => {
    const msg = ev.data;
    if (!msg || msg.tab === TAB_ID) return;
    cb({ id: msg.id, savedAt: msg.savedAt });
  };
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}
export function suspend(id) { suspended.add(id); }
export function resume(id) { suspended.delete(id); }
export function lastSavedAt() { return _lastSavedAt; }
export function formatSavedAgo(ts, now = Date.now()) {
  if (!ts) return 'Saved · —';
  const diffMin = Math.floor((now - ts) / 60000);
  if (diffMin < 1) return 'Saved · just now';
  if (diffMin < 60) return `Saved · ${diffMin} min ago`;
  const d = new Date(ts);
  return `Saved · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function installAutosaveHooks(getProject) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const onVisibility = () => {
    if (document.hidden) {
      const project = getProject();
      if (project) saveNow(project);
    }
  };
  const onPageHide = () => {
    const project = getProject();
    if (project) saveNow(project);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}
