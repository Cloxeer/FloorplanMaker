// fixNumbers.js
// Pure "fill in the missing room number" proposals for the "Worth a look" checklist.
// A room with no number that sits in a row / column of numbered neighbours is given the number
// the neighbours pin down: 128B [?] 128D -> 128C (suffix letters skip I and O), 124 [?] 128 -> 126
// (steps 1, 2, 5, 10; prefixes and leading zeros kept), several blanks at once when they all fill
// uniquely. Never guesses: ambiguity, a number already used anywhere in the plan, one-sided runs
// or disagreeing neighbours produce no fix, only a Manual note ("type it yourself").
// Also repairs an obvious slip (128B 128C 128C 128E -> second 128C becomes 128D) but only when
// both neighbours pin it, the current number breaks the run and is a duplicate or invalid.
// Depends on: js/model/document.js (roomPolygon), js/model/geometry.js (bbox).

import { roomPolygon, NUMBER_RE, NUMBERED_CLASSES } from './document.js';
import { bbox } from './geometry.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I and O are skipped in room suffixes
const STEPS = [1, 2, 5, 10];
const SHAPE = /^([A-Za-z]{0,3})(\d{1,4})([A-Za-z]?)$/;
const norm = (n) => String(n == null ? '' : n).trim().toUpperCase();

function parse(raw) {
  const s = norm(raw);
  const m = SHAPE.exec(s);
  if (!m) return null;
  const suf = m[3];
  if (suf && LETTERS.indexOf(suf) < 0) return null;
  return { s, pre: m[1], digits: m[2], v: parseInt(m[2], 10), suf, li: suf ? LETTERS.indexOf(suf) : -1,
    padded: m[2].length > 1 && m[2][0] === '0' };
}

const isRoom = (it) => it && it.type === 'room' && (it.cls === undefined || it.cls === 'room' || it.cls === 'ours');

function boxOf(it) {
  try { return bbox(roomPolygon(it)); } catch { return null; }
}

// ---- geometry: rows (axis 'x') and columns (axis 'y') of neighbouring rooms ----
function lines(entries, axis) {
  const cross = axis === 'x' ? (b) => b.y + b.h / 2 : (b) => b.x + b.w / 2;
  const csz = axis === 'x' ? (b) => b.h : (b) => b.w;
  const lo = axis === 'x' ? (b) => b.x : (b) => b.y;
  const len = axis === 'x' ? (b) => b.w : (b) => b.h;
  const groups = [];
  const sorted = entries.slice().sort((a, b) => cross(a.box) - cross(b.box));
  for (const e of sorted) {
    const c = cross(e.box), s = csz(e.box);
    let best = null, bd = Infinity;
    for (const g of groups) {
      const d = Math.abs(g.c - c);
      if (d > 0.4 * Math.min(g.s, s) || d >= bd) continue;
      const clash = g.items.some((q) => {
        const o = Math.min(lo(q.box) + len(q.box), lo(e.box) + len(e.box)) - Math.max(lo(q.box), lo(e.box));
        return o > 0.3 * Math.min(len(q.box), len(e.box));
      });
      if (!clash) { best = g; bd = d; }
    }
    if (best) {
      best.items.push(e);
      best.c = (best.c * (best.items.length - 1) + c) / best.items.length;
      best.s = Math.min(best.s, s);
    } else groups.push({ c, s, items: [e] });
  }
  const out = [];
  for (const g of groups) {
    const it = g.items.slice().sort((a, b) => lo(a.box) - lo(b.box));
    let seg = [it[0]];
    const flush = () => { if (seg.length >= 3) out.push(seg); };
    for (let i = 1; i < it.length; i++) {
      const p = it[i - 1].box, q = it[i].box;
      const gap = lo(q) - (lo(p) + len(p));
      if (gap > Math.max(len(p), len(q))) { flush(); seg = [it[i]]; } else seg.push(it[i]);
    }
    flush();
  }
  return out;
}

// ---- number arithmetic ----
const fmtNum = (L, R, v) => {
  if (v <= 0) return null;
  let d = String(v);
  if (L.padded || R.padded) {
    if (L.digits.length !== R.digits.length) return null;
    d = d.padStart(L.digits.length, '0');
    if (d.length > L.digits.length) return null;
  }
  return L.pre + d;
};

// What do neighbours L and R (m = blanks + 1 steps apart) pin down? { values } | { why }
function between(L, R, m) {
  if (!L || !R) return { why: 'one' };
  if (L.pre !== R.pre) return { why: 'pattern' };
  if (L.suf || R.suf) {
    if (!L.suf || !R.suf || L.digits !== R.digits) return { why: 'pattern' };
    const d = R.li - L.li;
    if (d <= 0) return { why: 'order' };
    if (d < m) return { why: 'tight' };
    if (d > m) return { why: 'loose', cands: Array.from({ length: d - 1 }, (_, i) => L.pre + L.digits + LETTERS[L.li + 1 + i]) };
    return { values: Array.from({ length: m - 1 }, (_, i) => L.pre + L.digits + LETTERS[L.li + 1 + i]) };
  }
  const D = R.v - L.v;
  if (!D) return { why: 'order' };
  const step = D / m;
  if (!Number.isInteger(step) || !STEPS.includes(Math.abs(step))) return { why: 'step' };
  const values = [];
  for (let i = 1; i < m; i++) {
    const f = fmtNum(L, R, L.v + i * step);
    if (!f) return { why: 'step' };
    values.push(f);
  }
  return { values };
}

function reason(why, A, B, res) {
  const nb = A && B ? `neighbours ${A.s} and ${B.s}` : `its only numbered neighbour ${(A || B).s}`;
  switch (why) {
    case 'one': return `only one neighbour (${(A || B).s}) has a number`;
    case 'loose': return `${nb} leave ${res.cands.slice(0, 4).join(' or ')}`;
    case 'tight': return `${nb} leave no room for the blank rooms between them`;
    case 'order': return `${nb} are out of order or equal`;
    case 'step': return `${nb} do not fit a steady step of 1, 2, 5 or 10`;
    default: return `${nb} do not follow the same pattern`;
  }
}

// ---- analysis ----
function analyse(doc) {
  const items = (doc && doc.items) || [];
  const rooms = [];
  const used = new Map(); // number -> count over every item
  for (const it of items) {
    if (it && it.number != null && norm(it.number)) used.set(norm(it.number), (used.get(norm(it.number)) || 0) + 1);
    if (!isRoom(it)) continue;
    const box = boxOf(it);
    if (!box || !(box.w > 0) || !(box.h > 0)) continue;
    rooms.push({ it, box, num: norm(it.number), p: parse(it.number) });
  }
  const stretches = []; // blank stretches: { rooms, A, B, res }
  const slips = new Map(); // id -> Set of values proposed
  const slipInfo = new Map();
  for (const axis of ['x', 'y']) {
    for (const line of lines(rooms, axis)) {
      for (let i = 0; i < line.length; i++) {
        const e = line[i];
        if (e.num) { slipCheck(line, i, used, slips, slipInfo); continue; }
        if (i > 0 && !line[i - 1].num) continue; // not the start of a stretch
        let j = i; while (j < line.length && !line[j].num) j++;
        const A = i > 0 ? line[i - 1].p : null, B = j < line.length ? line[j].p : null;
        const hasA = i > 0, hasB = j < line.length;
        if (!hasA && !hasB) continue;
        const blanks = line.slice(i, j);
        const rawA = hasA ? line[i - 1] : null, rawB = hasB ? line[j] : null;
        let res;
        if (!hasA || !hasB) res = { why: 'one' };
        else if (!A || !B) res = { why: 'pattern' };
        else res = between(A, B, blanks.length + 1);
        stretches.push({ blanks, A: A || (rawA && { s: rawA.num }), B: B || (rawB && { s: rawB.num }), res });
      }
    }
  }
  return { rooms, used, stretches, slips, slipInfo };
}

function slipCheck(line, i, used, slips, slipInfo) {
  const e = line[i], L = i > 0 ? line[i - 1].p : null, R = i + 1 < line.length ? line[i + 1].p : null;
  if (!L || !R) return;
  const res = between(L, R, 2);
  if (!res.values) return;
  const want = res.values[0];
  if (want === e.num) return;
  const bad = !e.p || (used.get(e.num) || 0) > 1;
  if (!bad || used.has(want)) return;
  const id = e.it.id;
  if (!slips.has(id)) slips.set(id, new Set());
  slips.get(id).add(want);
  slipInfo.set(id, { room: e, L, R });
}

const name = (r) => r.it.name ? `"${r.it.name}"` : 'Room';
const at = (r) => `at ${Math.round(r.box.x + r.box.w / 2)}, ${Math.round(r.box.y + r.box.h / 2)}`;

// Decide every stretch: fills (all rooms agree across rows and columns, no duplicates) or failures.
function decide(doc) {
  const { used, stretches, slips, slipInfo } = analyse(doc);
  const cand = new Map(); // room id -> Set of values from every stretch
  for (const s of stretches) s.blanks.forEach((r, k) => {
    if (!s.res.values) return;
    if (!cand.has(r.it.id)) cand.set(r.it.id, new Set());
    cand.get(r.it.id).add(s.res.values[k]);
  });
  const claimed = new Set();
  const covered = new Set();
  const fixes = [], failed = new Map(); // failed: room id -> {room, msg, rank}
  const fail = (r, msg, rank) => {
    const old = failed.get(r.it.id);
    if (!old || rank > old.rank) failed.set(r.it.id, { room: r, msg, rank });
  };
  for (const s of stretches) {
    const A = s.A, B = s.B;
    if (!s.res.values) {
      const rank = s.res.why === 'one' ? 0 : 1;
      s.blanks.forEach((r) => fail(r, `${name(r)} ${at(r)} has no number; ${reason(s.res.why, A, B, s.res)}, type it yourself`, rank));
      continue;
    }
    const vals = s.res.values;
    let problem = null;
    s.blanks.forEach((r, k) => {
      if (problem) return;
      const c = cand.get(r.it.id);
      if (c.size > 1) problem = `its row and its column disagree (${[...c].join(' or ')})`;
      else if (used.has(vals[k]) || claimed.has(vals[k])) problem = `${vals[k]} is already used elsewhere in the plan`;
    });
    if (new Set(vals).size !== vals.length) problem = 'the fill would repeat a number';
    const odd = vals.find((v) => !NUMBER_RE.test(v));
    if (odd) problem = `${odd} is not in the usual room-number form (like 128 or R134A)`;
    if (!problem && s.blanks.some((r) => covered.has(r.it.id))) continue; // done by another run already
    if (problem) {
      s.blanks.forEach((r) => fail(r, `${name(r)} ${at(r)} has no number; neighbours ${A.s} and ${B.s} point to ${vals.join(', ')} but ${problem}, type it yourself`, 2));
      continue;
    }
    vals.forEach((v) => claimed.add(v));
    s.blanks.forEach((r) => covered.add(r.it.id));
    const notes = s.blanks.map((r, k) => `Room ${s.blanks.length > 1 ? `${k + 1} of ${s.blanks.length} ` : ''}between ${A.s} and ${B.s} becomes ${vals[k]}`);
    fixes.push({
      key: `number:${s.blanks[0].it.id}`, kind: 'number',
      title: s.blanks.length > 1 ? `Number ${s.blanks.length} rooms ${vals[0]} to ${vals[vals.length - 1]}` : `Number a room ${vals[0]}`,
      notes, ids: s.blanks.map((r) => r.it.id),
      doc: withNumbers(doc, new Map(s.blanks.map((r, k) => [r.it.id, vals[k]]))),
    });
  }
  for (const [id, set] of slips) {
    if (set.size !== 1 || covered.has(id)) continue;
    const want = [...set][0];
    if (claimed.has(want) || !NUMBER_RE.test(want)) continue;
    claimed.add(want);
    const { room, L, R } = slipInfo.get(id);
    fixes.push({
      key: `number:${id}`, kind: 'number',
      title: `Change ${room.num} to ${want}`,
      notes: [`Room between ${L.s} and ${R.s} is ${room.num}, which breaks the run; it becomes ${want}`],
      ids: [id], doc: withNumbers(doc, new Map([[id, want]])),
    });
  }
  const fixedIds = new Set(fixes.flatMap((f) => f.ids));
  return { fixes, failed, fixedIds };
}

function withNumbers(doc, map) {
  return { ...doc, items: doc.items.map((it) => (it && map.has(it.id) ? { ...it, number: map.get(it.id) } : it)) };
}

export function findNumberFixes(doc) {
  if (!doc || !Array.isArray(doc.items) || doc.items.length < 3) return [];
  return decide(doc).fixes;
}

// Everything the number checks still flag after the fills, as Manual notes (never silent):
// rooms the neighbours cannot number, numbers in a wrong format, and numbers used twice.
function leftovers(doc, skip, say) {
  const out = [];
  const rooms = doc.items.filter((it) => it && it.type === 'room' && NUMBERED_CLASSES.has(it.cls));
  const blank = rooms.filter((r) => !r.number && !skip.has(r.id));
  if (blank.length) {
    out.push({ ids: blank.map((r) => r.id), message: blank.length === 1
      ? 'A room has no number and nothing around it pins one down; click it and type its number.'
      : `${blank.length} rooms have no number and nothing around them pins one down; click each one and type its number.` });
  }
  const bad = rooms.filter((r) => r.number && !NUMBER_RE.test(String(r.number)));
  for (const r of bad) out.push({ ids: [r.id], message: `${say(r)} has a number that is not in the usual form (like 128 or R134A); fix it by hand.` });
  const by = new Map();
  for (const r of rooms) if (r.number && NUMBER_RE.test(String(r.number))) by.set(String(r.number), (by.get(String(r.number)) || []).concat(r.id));
  for (const [n, ids] of by) if (ids.length > 1) out.push({ ids, message: `Room number ${n} is used ${ids.length} times; give each room its own number by hand.` });
  return out;
}

export function findManualNumbers(doc) {
  if (!doc || !Array.isArray(doc.items)) return [];
  const small = doc.items.length < 3;
  const { failed, fixedIds } = small ? { failed: new Map(), fixedIds: new Set() } : decide(doc);
  const manual = [...failed.values()].filter((f) => !fixedIds.has(f.room.it.id)).map((f) => ({ ids: [f.room.it.id], message: f.msg }));
  const skip = new Set([...failed.keys(), ...fixedIds]);
  return manual.concat(leftovers(doc, skip, (r) => (r.name ? `"${r.name}"` : `Room ${r.number}`)));
}
