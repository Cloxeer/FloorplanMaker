// fixqa-lib.mjs
// Invariant checker for the staged "Fix worth-a-looks" flow (js/model/fixNotes.js).
// checkFix(doc) runs fixAll headlessly and returns { applied, manual, before, after, violations[] }.
// Used by tests/fixqa.test.js and tools/fixqa-posters.mjs. Pure (no DOM); needs only the model modules.
import { fixAll } from '../js/model/fixNotes.js';
import { validate } from '../js/model/validate.js';
import { docChecklistCodes } from '../js/view/panels/validation.js';
import { NUMBER_RE } from '../js/model/document.js';
import { allOverlapPairs } from '../js/model/overlaps.js';
import { overlappingHalls, unconnectedHalls, roomsNotTouchingHall, attentionTargets } from '../js/model/attention.js';

export const ALLOWED_TYPES = new Set(['room', 'hall', 'stair', 'door', 'compass', 'legend']);
const NUM_FIELDS = ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2'];

export function noteCounts(doc) {
  const out = {};
  const add = (c) => { out[c] = (out[c] || 0) + 1; };
  let v = [];
  try { v = validate(doc); } catch (e) { add('validate-threw'); }
  v.forEach((r) => add(r.code));
  try { docChecklistCodes(doc).forEach((r) => add(r.code)); } catch (e) { add('checklist-threw'); }
  const n = (key, f) => { try { out[key] = f().length; } catch (e) { out[key + '-threw'] = 1; } };
  n('n:hall-overlap', () => overlappingHalls(doc.items || []));
  n('n:hall-unconnected', () => unconnectedHalls(doc));
  n('n:room-no-hall', () => roomsNotTouchingHall(doc.items || []));
  n('n:room-overlap-pairs', () => allOverlapPairs(doc));
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

const pairKey = (p) => [p.a.id, p.b.id].sort().join('|');
const on5 = (v) => Number.isInteger(v) && v % 5 === 0;

function dupNumbers(doc) {
  const seen = new Map();
  for (const it of doc.items || []) if (it && it.type === 'room' && it.number) seen.set(String(it.number), (seen.get(String(it.number)) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
}

function pointOk(pts, x, y, halls) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  if (c) return true;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) : 0;
    if (Math.hypot(x - x1 - t * dx, y - y1 - t * dy) <= 3) return true;
  }
  return halls.some((h) => x >= h.x - 1 && x <= h.x + h.w + 1 && y >= h.y - 1 && y <= h.y + h.h + 1);
}

// an existing number may change only to repair a slip: it was a duplicate or not a valid number
const slipOk = (doc, o) => !NUMBER_RE.test(String(o.number)) || doc.items.filter((i) => i && i.type === 'room' && i.number === o.number).length > 1;

const hallInside = (pts, o) => [o.x, o.x + o.w / 2, o.x + o.w].every((x) => [o.y, o.y + o.h / 2, o.y + o.h].every((y) => pointOk(pts, x, y, [])));

function itemChecks(doc, after, bad) {
  const beforeItems = new Map((doc.items || []).filter(Boolean).map((i) => [i.id, i]));
  const items = (after.items || []).filter(Boolean);
  const used0 = new Set((doc.items || []).filter((i) => i && i.number).map((i) => String(i.number)));
  for (const it of items) {
    const o = beforeItems.get(it.id);
    if (!o) { if (it.type !== 'hall') bad(`new non-hall item ${it.type}`); }
    else {
      if (o.type !== it.type) bad(`item ${it.id} changed type`);
      if (it.type === 'room' && o.cls !== it.cls) bad(`room ${it.id} changed cls`);
      if (o.number && it.number !== o.number && it.cls !== 'void' && !slipOk(doc, o)) bad(`room ${it.id} number changed ${o.number} -> ${it.number}`);
      if (it.number && String(it.number) !== String(o.number || '') && used0.has(String(it.number))) bad(`room ${it.id} given already-used number ${it.number}`);
    }
    for (const f of NUM_FIELDS) {
      if (it[f] === undefined) continue;
      if (o && Object.is(o[f], it[f])) continue;
      if (typeof it[f] !== 'number' || !Number.isFinite(it[f])) { bad(`item ${it.id}.${f} is ${it[f]}`); continue; }
      if ((f === 'w' || f === 'h') && it[f] < 0) bad(`item ${it.id}.${f} negative`);
      if (!o) { if (!Number.isInteger(it[f])) bad(`new item ${it.id}.${f} not an integer: ${it[f]}`); continue; }
      if (on5(o[f]) && !on5(it[f]) && it.type === 'hall') bad(`hall ${it.id}.${f} left the 5-grid: ${o[f]} -> ${it[f]}`);
      else if (Number.isInteger(o[f]) && !Number.isInteger(it[f])) bad(`item ${it.id}.${f} lost integer: ${o[f]} -> ${it[f]}`);
    }
  }
  const oldHalls = (doc.items || []).filter((i) => i && i.type === 'hall');
  const pts = after.floor && Array.isArray(after.floor.points) && after.floor.points.length >= 3 ? after.floor.points : null;
  if (!pts) return;
  for (const h of items.filter((i) => i.type === 'hall')) {
    const o = beforeItems.get(h.id);
    if (o && o.x === h.x && o.y === h.y && o.w === h.w && o.h === h.h) continue;
    if (o && !hallInside(pts, o)) continue; // it was already (partly) outside
    const others = items.filter((i) => i.type === 'hall' && i !== h).concat(oldHalls);
    outer: for (const x of [h.x, h.x + h.w / 2, h.x + h.w]) for (const y of [h.y, h.y + h.h / 2, h.y + h.h]) {
      if (o && x >= o.x - 1 && x <= o.x + o.w + 1 && y >= o.y - 1 && y <= o.y + o.h + 1) continue;
      if (!pointOk(pts, x, y, others)) { bad(`hall ${h.id} sticks out of the outline at ${x},${y}`); break outer; }
    }
  }
}

export function checkFix(doc, opts = {}) {
  const V = [];
  const bad = (m) => V.push(m);
  const snapshot = JSON.stringify(doc);
  const t0 = Date.now();
  let r;
  try { r = fixAll(doc); } catch (e) { return { violations: [`fixAll threw: ${(e && e.stack) || e}`], applied: [], manual: [], before: {}, after: {} }; }
  const ms = Date.now() - t0;
  if (JSON.stringify(doc) !== snapshot) bad('input doc was mutated');
  if (ms > (opts.maxMs || 2000)) bad(`slow: ${ms} ms`);
  const after = r.doc;
  const before = noteCounts(doc), cnt = noteCounts(after);
  const worse = (k) => (k === 'n:hall-unconnected' ? (cnt[k] > 0 && !before[k]) : (cnt[k] || 0) > (before[k] || 0));
  for (const k of Object.keys(cnt)) if (k !== 'validate-threw' && worse(k)) bad(`note ${k} got worse: ${before[k] || 0} -> ${cnt[k]}`);
  if (!r.applied.length) for (const k of new Set([...Object.keys(cnt), ...Object.keys(before)])) if ((cnt[k] || 0) !== (before[k] || 0)) bad(`note ${k} changed with no fix`);
  const dBefore = dupNumbers(doc);
  for (const n of dupNumbers(after)) if (!dBefore.includes(n)) bad(`new duplicate number ${n}`);
  itemChecks(doc, after, bad);
  const p0 = new Set(allOverlapPairs(doc).map(pairKey));
  for (const p of allOverlapPairs(after)) if (!p0.has(pairKey(p))) bad(`new room overlap pair ${pairKey(p)}`);
  try {
    const again = fixAll(after);
    if (again.applied.length) bad(`not idempotent: second run applied ${again.applied.map((a) => a.key).join(',')}`);
  } catch (e) { bad(`second fixAll threw ${e}`); }
  const ids = new Set((after.items || []).filter(Boolean).map((i) => i.id));
  for (const m of r.manual) {
    if (!m || typeof m.message !== 'string' || !m.message.trim()) bad('manual with empty message');
    else if (/undefined|NaN|\[object/.test(m.message)) bad(`manual message looks broken: ${m.message}`);
    if (!m || !Array.isArray(m.ids) || !m.ids.length || m.ids.some((i) => !ids.has(i))) bad(`manual with missing/unknown ids: ${JSON.stringify(m && m.ids)} (${m && m.message})`);
  }
  // the ELSE case: everything the plan still highlights must be explained by a Manual
  if (opts.coverage !== false) {
    const covered = new Set(r.manual.flatMap((m) => (m && m.ids) || []));
    let tg = new Map();
    try { tg = attentionTargets(after, validate(after)); } catch (e) { bad(`attentionTargets threw ${e}`); }
    const silent = [...tg].filter(([id]) => !covered.has(id));
    const byReason = new Map();
    for (const [id, t] of silent) { const k = t.reasons[0]; if (!byReason.has(k)) byReason.set(k, []); byReason.get(k).push(id); }
    for (const [k, ids] of byReason) bad(`SILENT x${ids.length} (${ids[0]}...): "${k}" but no Manual names them`);
  }
  for (const a of r.applied) if (!a.title || !a.ids.length) bad(`fix without title/ids: ${a.key}`);
  return { applied: r.applied, manual: r.manual, before, after: cnt, violations: V, doc: after, ms };
}

// ids of newly added items vary (newId is random): rename them n0, n1, ... for comparisons
export function canon(doc) {
  const m = new Map();
  return JSON.stringify(doc, (k, v) => {
    if (typeof v === 'string' && /^id[0-9a-z]{7,}$/.test(v)) { if (!m.has(v)) m.set(v, 'n' + m.size); return m.get(v); }
    return v;
  });
}

// Lighter checks for junk plans (zero sizes, NaN, missing fields, null items): fixAll must not throw,
// must not touch its input, must be deterministic and must never produce a duplicate number.
export function smoke(doc) {
  const V = [], snap = JSON.stringify(doc, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v));
  let a, b;
  const t0 = Date.now();
  try { a = fixAll(doc); b = fixAll(doc); } catch (e) { return [`threw: ${(e && e.stack) || e}`]; }
  if (Date.now() - t0 > 4000) V.push(`slow: ${Date.now() - t0} ms`);
  if (JSON.stringify(doc, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)) !== snap) V.push('input mutated');
  const str = (r) => canon({ d: r.doc, a: r.applied.map((x) => x.key.replace(/id[0-9a-z]{7,}/g, 'N')), m: r.manual });
  if (str(a) !== str(b)) V.push('not deterministic');
  const dups = (d) => dupNumbers(d && Array.isArray(d.items) ? { items: d.items.filter(Boolean) } : { items: [] });
  const before = dups(doc);
  for (const n of dups(a.doc)) if (!before.includes(n)) V.push(`new duplicate number ${n}`);
  for (const m of a.manual) if (!m || typeof m.message !== 'string' || !m.message.trim()) V.push('manual with empty message');
  return V;
}
