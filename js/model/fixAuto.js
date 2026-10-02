// fixAuto.js
// "Fix all": apply every fix that is safe to apply without asking, in one go (one undo step), and hand
// back the doc that is left plus what still needs the user's approval.
// A fix is SAFE (no approval) when it only tidies: label resets, trimming hallways that overlap,
// shifting a shared room edge by a few units, extending a hallway that already exists. It NEEDS
// APPROVAL when it adds or removes things, guesses, or changes a shape:
//   - a room number inferred from its neighbours
//   - clearing text on a void
//   - an overlap fix that turns a room into a notched/L polygon or moves an edge by more than a few units
//   - a link that adds a new hallway piece, or runs through a room
// Pure. Depends on: js/model/fixNotes.js.

import { nextFix } from './fixNotes.js';
import { tidyRooms } from './tidyRooms.js';

const SMALL_EDGE = 12; // units a shared edge may move without asking
const sizeOf = (it) => {
  if (it.shape === 'poly' && it.points) {
    const xs = it.points.map((p) => p[0]), ys = it.points.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  return { x: it.x, y: it.y, x2: it.x + it.w, y2: it.y + it.h };
};

// Why a fix needs approval, or '' when it is safe.
export function approvalReason(fix, before) {
  if (!fix || !fix.doc) return 'unknown fix';
  const kind = fix.kind || '';
  if (kind === 'number') return 'fills in a room number from its neighbours';
  if (kind === 'void-label') return 'removes text from a space';
  if (kind === 'label') return '';
  const was = new Map(((before && before.items) || []).map((i) => [i.id, i]));
  const now = new Map((fix.doc.items || []).map((i) => [i.id, i]));
  if ([...now.keys()].some((id) => !was.has(id))) return 'adds a new piece to the plan';
  if ([...was.keys()].some((id) => !now.has(id))) return 'removes a piece from the plan';
  if ((fix.notes || []).some((n) => /runs through|crosses/i.test(n))) return 'runs through a room';
  if (kind === 'overlap') {
    for (const [id, a] of now) {
      const b = was.get(id);
      if (!b || b === a || a.type !== 'room') continue;
      if (a.shape === 'poly' || b.shape === 'poly') {
        if (JSON.stringify(a.points) !== JSON.stringify(b.points)) return 'reshapes a room';
        continue;
      }
      const p = sizeOf(a), q = sizeOf(b);
      const moved = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.x2 - q.x2), Math.abs(p.y2 - q.y2));
      if (moved > SMALL_EDGE) return 'moves a room edge a long way';
    }
    return '';
  }
  if (kind === 'hall-overlap' || kind === 'hall-connect' || kind === 'room-hall') return '';
  return 'unrecognised kind of fix';
}

export const needsApproval = (fix, before) => approvalReason(fix, before) !== '';

// Apply all safe fixes. -> { doc, applied:[{key,kind,title,notes,ids}], held:[{key,kind,title,reason}] }
// `held` lists the fixes that were found but need approval (they are NOT applied; run the staged flow
// on the returned doc to approve them one by one).
export function autoFixAll(doc, opts) {
  const max = (opts && opts.maxSteps) || 300;
  const skipped = new Set(), held = new Map(), applied = [];
  const seen = new Set([JSON.stringify(doc)]);
  const uses = new Map();
  let cur = doc;
  for (let i = 0; i < max; i++) {
    const f = nextFix(cur, skipped, { avoidDocs: seen });
    if (!f) break;
    const reason = approvalReason(f, cur);
    if (reason) { skipped.add(f.key); held.set(f.key, { key: f.key, kind: f.kind, title: f.title, reason }); continue; }
    uses.set(f.key, (uses.get(f.key) || 0) + 1);
    if (uses.get(f.key) >= 3) skipped.add(f.key);
    seen.add(JSON.stringify(f.doc));
    applied.push({ key: f.key, kind: f.kind, title: f.title, notes: f.notes, ids: f.ids });
    cur = f.doc;
  }
  // last: close the small gaps (rooms to the wall, corner to corner, on the 5-grid); never adds overlaps
  try {
    const t = tidyRooms(cur);
    if (t.count) { cur = t.doc; applied.push({ key: 'tidy', kind: 'tidy', title: 'Close the gaps', notes: t.notes, ids: t.changed }); }
  } catch (e) { /* nothing to tidy */ }
  return { doc: cur, applied, held: [...held.values()] };
}
