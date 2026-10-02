// grammar.js
// Room-number grammar: the strict legacy repair (our school's formats), a
// generic parser for other schools' formats, per-plan format inference and a
// format-guided repair that fixes look-alike characters. Pure.

const PREFIXES = 'RSTMJEH';
const SUFFIX_OK = /^[A-HJ-NP-Z]$/; // I and O are skipped in room suffixes
const DIGIT_FIX = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', T: '1', S: '5', B: '8', Z: '2', G: '6', A: '4' };
const LETTER_FIX = { 0: 'O', 5: 'S', 1: 'I', 8: 'B', 2: 'Z' };
// digit -> plausible letters (best first) for slots that must be letters
const LETTER_ALTS = { 0: 'OQD', 1: 'ILT', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 8: 'B' };
const NOT_PREFIX = new Set(['UP', 'DN', 'MEN', 'LAB', 'FL', 'ST', 'PM', 'AM', 'NO', 'WC', 'EXIT', 'DOWN']);

function fixDigit(ch) { return /\d/.test(ch) ? { ch, cost: 0 } : DIGIT_FIX[ch] ? { ch: DIGIT_FIX[ch], cost: 1 } : null; }

// Our school's grammar (unchanged behaviour): [RSTMJEH]ddd[A-Z] or ddd[A-Z]. -> { value, cost } | null
export function repairNumberLegacy(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9|]/g, '');
  if (s.length < 3 || s.length > 6) return null;
  const cands = [];
  const tryParse = (prefix, rest) => {
    if (rest.length < 3 || rest.length > 4) return;
    let cost = prefix ? (PREFIXES.includes(prefix) ? 0 : 99) : 0;
    let digits = '';
    for (let i = 0; i < 3; i++) {
      const f = fixDigit(rest[i]);
      if (!f) return;
      digits += f.ch; cost += f.cost;
    }
    let suffix = '';
    if (rest.length === 4) {
      let c = rest[3];
      if (/\d/.test(c)) { if (!LETTER_FIX[c]) return; c = LETTER_FIX[c]; cost += 1; }
      if (!SUFFIX_OK.test(c)) { if (c === 'I' || c === 'O') { c = c === 'O' ? 'D' : 'J'; cost += 2; } else return; }
      suffix = c;
    }
    cands.push({ value: `${prefix}${digits}${suffix}`, cost });
  };
  tryParse('', s);
  if (s.length >= 4) {
    let p = s[0];
    if (/\d/.test(p) && LETTER_FIX[p]) p = LETTER_FIX[p];
    if (/[A-Z]/.test(p)) tryParse(PREFIXES.includes(p) ? p : '?', s.slice(1));
  }
  const ok = cands.filter((c) => c.cost < 90 && !c.value.startsWith('?'));
  if (!ok.length) return null;
  ok.sort((a, b) => a.cost - b.cost);
  return ok[0];
}

// --- generic parse ---------------------------------------------------------
// Strict (no repairs) parse of a room-number-like token into parts, or null.
// parts: { pre, preSep, num, sufSep, suf }   value = pre+preSep+num+sufSep+suf
const STRICT = [
  [/^([A-Z]{1,3})([-. ]?)(\d{1,4})(?:([-. ]?)([A-Z]))?$/, (m) => ({ pre: m[1], preSep: m[2], num: m[3], sufSep: m[4] || '', suf: m[5] || '' })],
  [/^(\d{1,2})([-.])(\d{1,4})$/, (m) => ({ pre: m[1], preSep: m[2], num: m[3], sufSep: '', suf: '' })],
  [/^(\d[A-Z])([-. ]?)(\d{2,3})$/, (m) => ({ pre: m[1], preSep: m[2], num: m[3], sufSep: '', suf: '' })],
  [/^(\d{1,4})([-. ]?)([A-Z])$/, (m) => ({ pre: '', preSep: '', num: m[1], sufSep: m[2], suf: m[3] })],
  [/^(\d{1,4})$/, (m) => ({ pre: '', preSep: '', num: m[1], sufSep: '', suf: '' })],
];
export function parseNumber(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9.\- ]/g, '').replace(/\s+/g, ' ').trim();
  for (const [re, f] of STRICT) {
    const m = re.exec(s);
    if (m) {
      const p = f(m);
      if (NOT_PREFIX.has(p.pre)) return null;
      return { ...p, value: p.pre + p.preSep + p.num + p.sufSep + p.suf };
    }
  }
  return null;
}

const slotPattern = (pre) => pre.replace(/[A-Z]/g, 'L').replace(/\d/g, 'D');

// Dominant leading digit of the 3+-digit numbers: { digit, share, n } | null
export function floorPrior(numbers) {
  const cnt = {}; let n = 0;
  for (const x of numbers || []) {
    const p = parseNumber(typeof x === 'string' ? x : x && x.number);
    if (!p || p.num.length < 3 || (p.pre === 'ST')) continue;
    cnt[p.num[0]] = (cnt[p.num[0]] || 0) + 1; n++;
  }
  if (!n) return null;
  const digit = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
  return { digit, share: cnt[digit] / n, n };
}

// Numbers whose leading digit disagrees with a clear floor prior (likely misreads).
export function flagOutliers(numbers, prior = floorPrior(numbers)) {
  if (!prior || prior.n < 4 || prior.share < 0.6) return [];
  return (numbers || []).filter((x) => {
    const p = parseNumber(typeof x === 'string' ? x : x && x.number);
    return p && p.num.length >= 3 && p.num[0] !== prior.digit;
  });
}

// Infer the plan's dominant number format from the tokens read so far.
// tokens: strings or { value|text|number }. -> format object, or null when < 3 usable tokens.
export function inferFormat(tokens) {
  const st = { n: 0, dig: {}, pre: {}, preStr: {}, preSep: {}, withPre: 0, withSuf: 0, sufSep: {}, lead: {} };
  const bump = (o, k, w = 1) => { o[k] = (o[k] || 0) + w; };
  for (const t of tokens || []) {
    const text = typeof t === 'string' ? t : (t && (t.value || t.number || t.text)) || '';
    let p = parseNumber(text), w = 1;
    if (!p || p.pre === 'ST') {
      if (p) continue;
      const r = repairNumberLegacy(text);
      p = r && r.cost <= 1 ? parseNumber(r.value) : null; w = 0.5;
    }
    if (!p || p.num.length < 2) continue;
    st.n += w; bump(st.dig, p.num.length, w);
    if (p.pre) { st.withPre += w; bump(st.pre, slotPattern(p.pre), w); bump(st.preStr, p.pre, w); bump(st.preSep, p.preSep, w); }
    if (p.suf) { st.withSuf += w; bump(st.sufSep, p.sufSep, w); }
    if (p.num.length >= 3) bump(st.lead, p.num[0], w);
  }
  if (st.n < 3) return null;
  const top = (o) => Object.keys(o).sort((a, b) => o[b] - o[a])[0];
  const share = (o, tot) => Object.keys(o).filter((k) => o[k] / tot >= 0.15);
  const leadN = Object.values(st.lead).reduce((a, b) => a + b, 0);
  const lead = leadN ? top(st.lead) : '';
  return {
    n: st.n,
    digitLens: share(st.dig, st.n).map(Number),
    digits: Number(top(st.dig)),
    prefixRate: st.withPre / st.n,
    prePatterns: share(st.pre, Math.max(1, st.withPre)),
    prefixSet: Object.keys(st.preStr),
    preSep: st.withPre ? top(st.preSep) : '',
    sufRate: st.withSuf / st.n,
    sufSep: st.withSuf ? top(st.sufSep) : '',
    lead, leadShare: leadN ? st.lead[lead] / leadN : 0,
  };
}

function matchesFormat(value, fmt) {
  const p = parseNumber(value);
  if (!p) return 0;
  if (!fmt.digitLens.includes(p.num.length)) return 2;
  if (p.pre && !(fmt.prefixRate > 0)) return 2;
  if (!p.pre && fmt.prefixRate > 0.95) return 2;
  if (p.suf && !(fmt.sufRate > 0)) return 2;
  if (p.pre && fmt.prefixSet.length && !fmt.prefixSet.includes(p.pre)) return 1;
  return 0;
}

// Fit the raw characters to the format's templates; fixes look-alikes (cost 1 each), drops one extra
// character (cost 3, weak). Never invents a character that was not read.
function fmtRepair(raw, fmt) {
  const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9|]/g, '');
  if (c.length < 2 || c.length > 8) return null;
  const pres = [];
  if (fmt.prefixRate < 0.95) pres.push('');
  if (fmt.prefixRate > 0.03) for (const p of fmt.prePatterns.length ? fmt.prePatterns : ['L']) pres.push(p);
  const sufs = [];
  if (fmt.sufRate < 0.97) sufs.push(0);
  if (fmt.sufRate > 0.03) sufs.push(1);
  let best = null;
  for (const pp of pres) for (const dl of fmt.digitLens) for (const sf of sufs) {
    if (dl < 2) continue;
    const slots = pp.split('').map((t) => ({ k: 'P', t })).concat(Array.from({ length: dl }, () => ({ k: 'D' })), sf ? [{ k: 'S' }] : []);
    const T = slots.length;
    const attempts = [];
    if (c.length === T) attempts.push({ s: c, extra: 0 });
    if (c.length === T + 1) for (let i = 0; i < c.length; i++) attempts.push({ s: c.slice(0, i) + c.slice(i + 1), extra: 4 });
    for (const at of attempts) {
      let cost = at.extra, ok = true, realDigits = 0, pre = '', num = '', suf = '';
      for (let i = 0; i < T && ok; i++) {
        const ch = at.s[i], sl = slots[i];
        if (sl.k === 'D' || (sl.k === 'P' && sl.t === 'D')) {
          const f = fixDigit(ch);
          if (!f) { ok = false; break; }
          cost += f.cost;
          if (f.cost === 0 ) realDigits++;
          if (sl.k === 'D') num += f.ch; else pre += f.ch;
        } else if (sl.k === 'P') {
          let x = ch;
          if (/\d/.test(ch)) { const alts = LETTER_ALTS[ch]; if (!alts) { ok = false; break; } x = alts[0]; cost += 1; }
          pre += x;
        } else {
          let x = ch;
          if (/\d/.test(ch)) { const alt = LETTER_FIX[ch] || (ch === '6' ? 'G' : ''); if (!alt) { ok = false; break; } x = alt; cost += 1; }
          if (!SUFFIX_OK.test(x)) { if (x === 'I' || x === 'O') { x = x === 'O' ? 'D' : 'J'; cost += 2; } else { ok = false; break; } }
          suf = x;
        }
      }
      if (!ok) continue;
      const need = dl >= 3 ? 2 : 1;
      if (num.split('').filter((d, i) => at.s[pp.length + i] === d ).length < need) continue;
      if (at.extra && cost - at.extra > 1) continue;
      let value = pre + (pre ? fmt.preSep : '') + num + (suf ? fmt.sufSep : '') + suf;
      if (pre && fmt.prefixSet.length && !fmt.prefixSet.includes(pre)) cost += 3;
      if (cost > 5) continue;
      void realDigits;
      if (!best || cost < best.cost) best = { value, cost, weak: cost >= 3 };
    }
  }
  return best;
}

// Turn raw OCR text into a valid room number, or null. -> { value, cost, weak? }
// Without `format` our school's formats behave exactly as before and other schools' exact
// formats (B-104, 1-204, G12, ENG 101 ...) are accepted. With a `format` (see inferFormat)
// candidates matching it win, look-alikes are repaired inside its slots and one dropped or
// extra character is tolerated at low confidence (weak = true).
export function repairNumber(raw, format) {
  const legacy = repairNumberLegacy(raw);
  if (!format) {
    if (legacy) return legacy;
    const p = parseNumber(raw);
    return p && (p.num.length >= 3 ? (p.pre || p.suf || p.preSep || p.sufSep) : (p.preSep || p.sufSep) && p.num.length >= 2) ? { value: p.value, cost: 1.5 } : null;
  }
  const f = fmtRepair(raw, format);
  if (!legacy || (String(raw).match(/\d/g) || []).length < 2) return f;
  const mf = matchesFormat(legacy.value, format);
  if (mf === 2 && legacy.cost > 0) return f; // a repair that contradicts the plan's format
  const lc = legacy.cost + mf;
  if (!f) return { ...legacy, cost: lc };
  return f.cost < lc || (f.cost === lc && !f.weak) ? f : { ...legacy, cost: lc };
}
