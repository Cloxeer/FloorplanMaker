// folderStore.js — File System Access API wrapper for saving/loading projects
// as plain .floorplan.json files in a user-picked folder. Guarded so importing
// this module in a browser without showDirectoryPicker (or Node) never throws.
// Depends on: ./autosave.js (exportProjectJson, importProjectJson).
// Exports: isSupported, pickFolder, getFolder, forgetFolder, writeProject,
// listProjects, readProject, deleteProject.

import { exportProjectJson, importProjectJson, projectSignature } from './autosave.js';

const DB_NAME = 'floor-plan-studio-settings';
const DB_VERSION = 1;
const STORE = 'settings';
const KEY = 'folder';
const HAS_IDB = typeof indexedDB !== 'undefined';

export function isSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

let dbPromise = null;
function openSettingsDb() {
  if (!HAS_IDB) return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open settings database.'));
  });
  return dbPromise;
}
async function idbGet(key) {
  const db = await openSettingsDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await openSettingsDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function idbDelete(key) {
  const db = await openSettingsDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function pickFolder() {
  if (!isSupported()) throw new Error('This browser does not support picking a local folder.');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'floor-plan-studio' });
  await idbSet(KEY, handle);
  // A newly chosen folder has none of our files yet, so drop the write cache to
  // force the next save of each project to actually land on disk.
  folderSigs.clear();
  return handle;
}

export async function getFolder({ request = false } = {}) {
  if (!HAS_IDB) return { handle: null, state: 'none' };
  let handle;
  try {
    handle = await idbGet(KEY);
  } catch {
    return { handle: null, state: 'none' };
  }
  if (!handle) return { handle: null, state: 'none' };
  if (typeof handle.queryPermission !== 'function') return { handle, state: 'granted' };
  let state;
  try {
    state = await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return { handle, state: 'none' };
  }
  if (state !== 'granted' && request && typeof handle.requestPermission === 'function') {
    try {
      state = await handle.requestPermission({ mode: 'readwrite' });
    } catch {
      /* ignore */
    }
  }
  return { handle, state: state === 'granted' ? 'granted' : 'prompt' };
}

export async function forgetFolder() {
  await idbDelete(KEY);
}

// slug -> signature of the content last written to this folder, so repeated
// saves triggered by no-op interactions (a click, a pan that returns to the
// same view) don't rewrite the whole .floorplan.json — including its embedded
// multi-MB photo — to disk. Cleared when the target folder changes (pickFolder)
// or a project is deleted.
const folderSigs = new Map();

// Serialise writes per slug so concurrent calls for the same project queue.
const writeQueues = new Map();
function queueWrite(slug, fn) {
  const prev = writeQueues.get(slug) || Promise.resolve();
  const next = prev.then(fn, fn);
  writeQueues.set(slug, next.catch(() => {}).then(() => {
    if (writeQueues.get(slug) === next) writeQueues.delete(slug);
  }));
  return next;
}

export function writeProject(handle, project) {
  const slug = project && project.slug;
  if (!slug) return Promise.reject(new Error('Project is missing a slug.'));
  const sig = projectSignature(project);
  return queueWrite(slug, () => {
    if (folderSigs.get(slug) === sig) return null; // unchanged since last write
    return doWriteProject(handle, project, slug).then((h) => {
      folderSigs.set(slug, sig);
      return h;
    });
  });
}

async function doWriteProject(handle, project, slug) {
  const text = exportProjectJson(project);
  const tmpName = `${slug}.floorplan.json.tmp`;
  const finalName = `${slug}.floorplan.json`;

  const tmpHandle = await handle.getFileHandle(tmpName, { create: true });
  const writable = await tmpHandle.createWritable();
  await writable.write(text);
  await writable.close();

  // Verify by reading back and parsing.
  const tmpFile = await tmpHandle.getFile();
  const readBack = await tmpFile.text();
  JSON.parse(readBack); // throws if corrupt

  const finalHandle = await handle.getFileHandle(finalName, { create: true });
  const finalWritable = await finalHandle.createWritable();
  await finalWritable.write(readBack);
  await finalWritable.close();

  await handle.removeEntry(tmpName);
  return finalHandle;
}

// Write the finished, legend-included SVG into a "Finished" subfolder of the
// user's picked project folder, as <slug>.svg (e.g. jh-0.svg). Creates the
// subfolder on first use. This is separate from the browser download in the
// Export step: choosing "SVG -> Finished folder" saves here AND still triggers
// the normal download, so a duplicate lands in the OS Downloads folder too.
export async function writeFinishedSvg(handle, slug, svgText) {
  if (!handle) throw new Error('No project folder is connected.');
  if (!slug) throw new Error('Project is missing a slug.');
  const dir = await handle.getDirectoryHandle('Finished', { create: true });
  const fileHandle = await dir.getFileHandle(`${slug}.svg`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(svgText);
  await writable.close();
  return `Finished/${slug}.svg`;
}

export async function listProjects(handle) {
  const results = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file' || !name.endsWith('.floorplan.json')) continue;
    try {
      const file = await entry.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      const slug = (data && data.slug) || name.replace(/\.floorplan\.json$/, '');
      results.push({
        name: (data && data.name) || slug,
        slug,
        building: data && data.doc && data.doc.meta ? data.doc.meta.building : undefined,
        floor: data && data.doc && data.doc.meta ? data.doc.meta.floor : undefined,
        savedAt: data && data.savedAt,
        size: file.size,
      });
    } catch {
      /* skip unreadable/corrupt file */
    }
  }
  return results;
}

export async function readProject(handle, slug) {
  const fileHandle = await handle.getFileHandle(`${slug}.floorplan.json`);
  const file = await fileHandle.getFile();
  const text = await file.text();
  return importProjectJson(text);
}

export async function deleteProject(handle, slug) {
  await handle.removeEntry(`${slug}.floorplan.json`);
  folderSigs.delete(slug);
}
