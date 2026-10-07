// ignored.js
// "Ignore": a problem the person has chosen to leave alone. The plan items they said "ignore" to are kept in the project
// (project.ignored = [item ids]); everything that lists or counts problems leaves those items out, and Fix all never touches them.
// Nothing is changed on the plan itself, and Stop ignoring puts the problem back.
// Pure. Depends on: js/model/attention.js.

import { overlappingHalls, unconnectedHalls, roomsNotTouchingHall } from './attention.js';

export const ignoredIds = (project) => new Set(Array.isArray(project && project.ignored) ? project.ignored.filter((x) => typeof x === 'string') : []);

// ids still on the plan (an ignored item that was deleted is forgotten)
export function pruneIgnored(doc, ids) {
  const here = new Set(((doc && doc.items) || []).filter(Boolean).map((i) => i.id));
  return new Set([...ids].filter((id) => here.has(id)));
}

// validation results without the ignored ones. Notes that name no single item (hallways that overlap / are not connected, rooms that do
// not reach a hallway) go when every item they are about is ignored.
export function applyIgnores(doc, results, ids) {
  if (!ids || !ids.size) return results;
  const items = ((doc && doc.items) || []).filter(Boolean);
  const allIgnored = (list) => list.every((i) => ids.has(i.id));
  const drop = new Set();
  const g = (code, list) => { if (list.length && allIgnored(list)) drop.add(code); };
  try { g('hall-overlap', overlappingHalls(items)); } catch { /* keep */ }
  try { g('hall-unconnected', unconnectedHalls(doc)); } catch { /* keep */ }
  try { g('room-not-touching-hall', roomsNotTouchingHall(items)); } catch { /* keep */ }
  return results.filter((r) => !(r.itemId && ids.has(r.itemId)) && !drop.has(r.code));
}
