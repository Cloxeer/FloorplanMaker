// building.js
// A building is every floor project that shares a building name (and property number, when both have
// one). These pure helpers pick a building's floors out of a project list, check a new floor number and
// make a file name for it that is not taken. No storage and no DOM in here.
// Depends on: nothing.

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

// Projects made before buildings existed have no building name: they live in "Unnamed building" until moved.
export const UNNAMED = 'Unnamed building';
export const isUnnamed = (name) => { const k = norm(name); return !k || k === norm(UNNAMED); };

// Does project entry `p` belong to the building described by `meta` ({building, property})?
export function sameBuilding(p, meta) {
  if (!p || !meta) return false;
  const b = norm(p.building != null ? p.building : p.name);
  if (isUnnamed(meta.building)) return isUnnamed(b); // the unnamed bucket: no name, or the placeholder
  if (!b || b !== norm(meta.building)) return false;
  const pa = norm(p.property), pb = norm(meta.property);
  return !pa || !pb || pa === pb; // an old entry without a property number still counts
}

const floorNum = (f) => (Number.isFinite(Number(f)) ? Number(f) : 0);

// -> [{ slug, floor, id, savedAt, onDisk, hasPhoto, current }] one per floor, lowest floor first.
// `entries` may hold the same slug twice (browser copy + folder copy): they merge, newest wins.
export function floorsOf(entries, meta, currentSlug) {
  const by = new Map();
  for (const p of entries || []) {
    if (!p || !p.slug || !sameBuilding(p, meta)) continue;
    const old = by.get(p.slug);
    by.set(p.slug, old ? { ...old, ...p, id: p.id || old.id, onDisk: !!(old.onDisk || p.onDisk), savedAt: Math.max(old.savedAt || 0, p.savedAt || 0) } : { ...p });
  }
  return [...by.values()]
    .map((p) => ({ slug: p.slug, floor: p.floor, id: p.id || null, savedAt: p.savedAt || 0, onDisk: !!p.onDisk, hasPhoto: !!p.hasPhoto, current: p.slug === currentSlug }))
    .sort((a, b) => floorNum(a.floor) - floorNum(b.floor) || String(a.slug).localeCompare(String(b.slug)));
}

// Parse what the user typed for "What floor is this?". -> { floor } or { error }
export function parseFloor(raw, takenFloors) {
  const t = String(raw == null ? '' : raw).trim();
  if (!t) return { error: 'Type the floor number, like 0, 1 or 2.' };
  if (!/^-?\d{1,3}$/.test(t)) return { error: 'Use a whole number (0 is the ground or basement floor, -1 a lower one).' };
  const floor = parseInt(t, 10);
  if ((takenFloors || []).some((f) => floorNum(f) === floor && f !== '' && f != null)) return { error: `Floor ${floor} is already in this building.` };
  return { floor };
}

// A file name that no other project uses: "jh-2", or "jh-2-b" when "jh-2" is taken by another building.
export function freeSlug(base, takenSlugs) {
  const taken = new Set(takenSlugs || []);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base}-${String.fromCharCode(96 + ((i - 2) % 26) + 1)}${i > 27 ? i : ''}`;
    if (!taken.has(s)) return s;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Folder / zip name for a building: letters, digits, spaces and hyphens only.
export function buildingFolderName(building) {
  const s = String(building || '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ');
  return s || 'Building';
}

export const floorLabel = (floor) => (floor === '' || floor == null ? 'Floor' : `Floor ${floor}`);
