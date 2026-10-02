// reading.js
// Runs the injected OCR over the label lines of each room (several renderings,
// stopping early when two agree) and turns the raw reads into one decision per
// room: a number, a kind (restroom / open-to-below / elevator / stair label) or a
// name. Nothing here invents text: every result comes from what was read.
// Pure. Depends on: ./text.js (uses classify / voteReads when it exports them).

// (T.classify / T.voteReads / T.inferFormat / T.floorPrior come from text.js)
import * as T from './text.js';

async function mapLimit(list, n, fn) {
  let i = 0;
  const run = async () => { while (i < list.length) { const k = i++; await fn(list[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, run));
}

const norm = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
const realDigits = (s) => (String(s).match(/\d/g) || []).length;

// -> { kind: 'restroom'|'void'|'elevator'|'stair'|'name'|'number'|null, name?, label?, value? }
export function classifyText(text, format) {
  const c = T.classify(text, { format });
  if (!c || c.kind === 'unknown') return { kind: null };
  if (c.kind === 'stair') return { kind: 'stair', label: c.value };
  if (c.kind === 'name') return { kind: 'name', name: c.value };
  return { ...c };
}

// A token one edit away from a valid number: -> { value, cost } or null. Flagged by the caller.
export function nearMiss(tok, prefixes = 'RSTMJEH') {
  const s = String(tok || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 2 || s.length > 7 || realDigits(s) < 2) return null;
  const found = new Map();
  const add = (cand, extra) => {
    const r = T.repairNumber(cand);
    if (!r || realDigits(cand) < 2) return;
    const c = r.cost + extra;
    if (!found.has(r.value) || found.get(r.value) > c) found.set(r.value, c);
  };
  if (s.length >= 4) for (let i = 0; i < s.length; i++) add(s.slice(0, i) + s.slice(i + 1), 2); // one stray character
  if (s.length === 3 && prefixes.includes(s[0]) && /\d/.test(s[1]) && /\d/.test(s[2])) add(`${s[0]}0${s.slice(1)}`, 2); // R01 -> R001
  if (s.length >= 4 && /\d/.test(s[0]) && realDigits(s.slice(1)) >= 3) for (const p of prefixes) if (/^[JT]$/.test(p) && s[0] === (p === 'J' ? '2' : '7')) add(p + s.slice(1), 2); // look-alike prefix
  const list = [...found].map(([value, cost]) => ({ value, cost })).sort((a, b) => a.cost - b.cost);
  if (!list.length || (list[1] && list[1].cost === list[0].cost)) return null; // ambiguous: say nothing
  return list[0];
}

const agreeOk = (a) => {
  const ra = T.repairNumber(a), k = classifyText(a).kind;
  return (ra && ra.cost === 0 && realDigits(a) >= 3) || (k && k !== 'number');
};

// OCR every label line. line.reads = [{text, conf}] ; stops after two agreeing, grammar-valid reads.
export async function readLines(lines, ocr, render, prof, tick = () => {}, concurrency = 3) {
  let done = 0;
  await mapLimit(lines, concurrency, async (l) => {
    l.reads = [];
    for (let i = 0; i < prof.attempts.length; i++) {
      const [th, psm] = prof.attempts[i];
      try { l.reads.push(await ocr(render(l, th), { psm })); } catch { /* skip this rendering */ }
      const rs = l.reads.map((r) => r.text || '');
      if (rs.length >= 2 && i === 1 && rs.every((t) => !norm(t))) break; // two blank readings: nothing to read here
      const agree = (a, b) => norm(a) && norm(a) === norm(b) && agreeOk(a);
      if (rs.length >= 2 && (i === 1 || i === 2) && rs.some((a, x) => rs.some((b, y) => x < y && agree(a, b)))) break;
    }
    done++;
    tick(done, lines.length);
  });
}

// Decide one room from its lines' reads. ctx = { prior: leading floor digit or '', format: inferFormat result or null }.
export function interpret(lines, prof, ctx = {}) {
  const { prior = '', format = null } = ctx;
  const kinds = new Map(), reads = [];
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const l of lines) {
    for (const rd of l.reads || []) {
      const c = classifyText(rd.text, format);
      if (c.kind && c.kind !== 'name' && c.kind !== 'number') bump(kinds, c.kind + '|' + (c.label || ''));
      else reads.push(rd);
    }
  }
  const voted = T.voteReads(reads, { format });
  const score = (c) => c.n - (c.cost / c.n) * 0.3 + (prior && /^\d/.test(c.val) && c.val[0] === prior ? 1.2 : 0) - (c.weak ? 0.8 : 0);
  const ranked = voted.filter((c) => (String(c.val).match(/\d/g) || []).length >= 2).sort((a, b) => score(b) - score(a));
  let best = ranked[0] || null, near = false, guess = '';
  // a format-guessed (weak) number is never used: the room stays blank and the guess goes to the review note
  if (best && best.weak) { guess = best.val; best = null; }
  if (!best && prof.nearMiss) {
    // no clean reading: a token one character off a valid number, flagged as low confidence
    const nv = new Map();
    for (const l of lines) for (const rd of l.reads || []) for (const tk of (rd.text || '').split(/\s+/)) {
      const m = nearMiss(tk, prof.prefixes);
      if (m) { const v = nv.get(m.value) || { val: m.value, n: 0, cost: 0, conf: 0, near: true }; v.n++; v.cost += m.cost; nv.set(m.value, v); }
    }
    const nr = [...nv.values()].filter((v) => v.n >= 2 && !/^0+$/.test(v.val.replace(/\D/g, ''))).sort((a, b) => b.n - a.n || a.cost - b.cost);
    if (nr.length) { ranked.push(...nr); best = nr[0]; near = true; }
  }
  const top = (m) => { let k = '', n = 0; for (const [a, b] of m) if (b > n) { n = b; k = a; } return { k, n }; };
  const kind = top(kinds);
  const name = (voted.names && voted.names[0]) || { name: '', n: 0 };
  const [kk, label] = kind.k ? kind.k.split('|') : ['', ''];
  return {
    guess: guess || (best && best.near ? best.val : ''), number: best ? best.val : '', votes: best ? best.n : 0, cost: best ? best.cost / best.n : 9, ranked, near,
    kind: kind.n && kind.n >= (best ? best.n : 0) && kind.n >= name.n ? kk : '', label, name: name.name,
  };
}
