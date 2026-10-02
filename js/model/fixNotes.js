// fixNotes.js
// The aggregator behind the staged "Fix these" flow. The UI applies one Fix, then asks again with the
// new doc, so each call re-evaluates everything from scratch:
//   nextFix(doc, skippedKeys, opts?) -> Fix | null   first fix in priority order, never a skipped key,
//                                                     never one that leaves the doc unchanged
//   manualLeft(doc) -> Manual[]                       what no automatic fix can settle
//   fixAll(doc, opts?) -> { doc, applied, manual }    headless loop (tests, tools); capped, cycle-proof
// Priority: overlaps, labels, numbers, hallways (overlaps, connections, rooms reaching a hallway).
// Fix = { key, kind, title, notes, ids, doc }; Manual = { ids, message }.
// Depends on: fixOverlaps.js, overlaps.js, fixLabels.js, fixNumbers.js, fixHalls.js.

import { proposeFix } from './fixOverlaps.js';
import { overlapClusters } from './overlaps.js';
import { findLabelFixes, findManualLabels } from './fixLabels.js';
import { findNumberFixes, findManualNumbers } from './fixNumbers.js';
import { findHallFixes, findManualHalls } from './fixHalls.js';
import { validate } from './validate.js';
import { attentionTargets } from './attention.js';

const MAX_STEPS = 300;
const safe = (fn, doc) => { try { return fn(doc) || []; } catch (e) { return []; } };
const sameDoc = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const nameOf = (it) => (it ? ([it.name, it.number].filter(Boolean).join(' ') || it.label || it.id) : 'an item');

const clusterKey = (c) => `overlap:${c.items.map((i) => i.id).sort().join('|')}`;

// overlap fixes, one per cluster that can be improved; the rest come back as manual notes
function overlapState(doc) {
  const fixes = [], manual = [];
  for (const c of safe(overlapClusters, doc)) {
    let prop;
    try { prop = proposeFix(doc, c); } catch (e) { continue; }
    const ids = [...new Set(prop.changedIds)];
    if (ids.length) {
      fixes.push({
        key: clusterKey(c), kind: 'overlap', title: `Fix ${c.items.length} overlapping items`,
        notes: prop.notes.slice(), ids, doc: prop.doc, cover: c.items.map((i) => i.id),
      });
    }
    for (const u of prop.unresolved) manual.push({ ids: [u.a.id, u.b.id], message: u.reason || `${nameOf(u.a)} and ${nameOf(u.b)} overlap; move one of them` });
  }
  return { fixes, manual };
}

// Fixes find their items by id, so items that share an id (or have none) would be changed together.
// That cannot come from the studio itself; a damaged file is left alone and reported once.
function sharedIds(doc) {
  const seen = new Set(), dup = new Set();
  let missing = 0;
  for (const it of doc.items) {
    if (!it || typeof it !== 'object') continue;
    if (it.id == null || it.id === '') { missing++; continue; }
    if (seen.has(it.id)) dup.add(it.id); else seen.add(it.id);
  }
  return { ids: [...dup], missing };
}

const cache = new WeakMap();
function overlaps(doc) {
  if (!doc || typeof doc !== 'object') return { fixes: [], manual: [] };
  if (!cache.has(doc)) cache.set(doc, overlapState(doc));
  return cache.get(doc);
}

const SOURCES = [
  (doc) => overlaps(doc).fixes,
  (doc) => safe(findLabelFixes, doc),
  (doc) => safe(findNumberFixes, doc),
  (doc) => safe(findHallFixes, doc),
];

export function nextFix(doc, skippedKeys, opts) {
  if (!doc || !Array.isArray(doc.items)) return null;
  const bad = sharedIds(doc);
  if (bad.ids.length || bad.missing) return null;
  const skipped = skippedKeys instanceof Set ? skippedKeys : new Set(skippedKeys || []);
  const avoid = (opts && opts.avoidDocs) || null; // optional Set of doc signatures already visited
  for (const source of SOURCES) {
    for (const f of source(doc)) {
      if (!f || !f.key || skipped.has(f.key)) continue;
      const nd = f.doc; // (hall fixes build their doc lazily)
      if (!nd || sameDoc(nd, doc)) continue;
      if (avoid && avoid.has(JSON.stringify(nd))) continue;
      return { key: f.key, kind: f.kind, title: f.title, notes: f.notes || [], ids: f.ids || [], doc: nd };
    }
  }
  return null;
}

// Safety net for the "else": anything the plan still highlights (a validation note with an item, a
// hallway or room the hallway notes name) that no fix is waiting on and no Manual above explains,
// e.g. a door with no label. One Manual per message, so a hundred alike stay one line.
function stragglers(doc, known) {
  let targets;
  try { targets = attentionTargets(doc, validate(doc)); } catch (e) { return []; }
  const pending = new Set(known);
  for (const src of SOURCES) for (const f of src(doc)) { (f.ids || []).forEach((i) => pending.add(i)); (f.cover || []).forEach((i) => pending.add(i)); }
  const by = new Map();
  for (const [id, t] of targets) {
    if (pending.has(id)) continue;
    const msg = t.reasons[0] || 'This item needs a look';
    if (!by.has(msg)) by.set(msg, []);
    by.get(msg).push(id);
  }
  return [...by].map(([message, ids]) => ({ ids, message: ids.length > 1 ? `${message} (${ids.length} items)` : message }));
}

export function manualLeft(doc) {
  if (!doc || !Array.isArray(doc.items)) return [];
  const bad = sharedIds(doc);
  if (bad.ids.length || bad.missing) {
    return [{ ids: bad.ids, message: `${bad.ids.length + bad.missing} item(s) share an id or have none (the file looks damaged), so nothing can be fixed automatically. Delete and redraw the duplicates, or reopen the original file.` }];
  }
  const list = [
    ...overlaps(doc).manual,
    ...safe(findManualLabels, doc),
    ...safe(findManualNumbers, doc),
    ...safe(findManualHalls, doc),
  ].map((m) => ({ ids: m.ids || [], message: m.message }));
  return list.concat(stragglers(doc, list.flatMap((m) => m.ids)));
}

// Apply fixes until none is left. A fix that would bring back an earlier state is skipped, and the
// loop is capped, so it always terminates.
export function fixAll(doc, opts) {
  const max = (opts && opts.maxSteps) || MAX_STEPS;
  const skipped = new Set(), uses = new Map(), seen = new Set([JSON.stringify(doc)]), applied = [];
  let cur = doc;
  for (let i = 0; i < max; i++) {
    const f = nextFix(cur, skipped, { avoidDocs: seen });
    if (!f) break;
    uses.set(f.key, (uses.get(f.key) || 0) + 1);
    if (uses.get(f.key) >= 3) skipped.add(f.key); // a key that keeps coming back is not settling anything
    seen.add(JSON.stringify(f.doc));
    applied.push({ key: f.key, kind: f.kind, title: f.title, notes: f.notes, ids: f.ids });
    cur = f.doc;
  }
  return { doc: cur, applied, manual: manualLeft(cur) };
}
