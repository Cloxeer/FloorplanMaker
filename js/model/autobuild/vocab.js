// vocab.js
// Name vocabulary, fuzzy word matching and text classification. Pure.
import { repairNumber, parseNumber } from './grammar.js';

export const NAME_VOCAB = [
  'CLASSROOM', 'LECTURE HALL', 'COMPUTER LAB', 'HELP DESK', 'ICT', 'ICT TRAINING LAB', 'ATRIUM',
  'STUDENT SUCCESS', 'UPWARD BOUND', 'STUDENT SUCCESS/ UPWARD BOUND', 'OPEN TO BELOW', 'RESTROOM', 'RESTROOMS',
  'ELEVATOR', 'LOBBY', 'OFFICE', 'LAB', 'STORAGE', 'MECHANICAL', 'JANITOR', 'MEN', 'WOMEN', 'DOWN', 'UP',
  // added
  'UNISEX', 'UNISEX RESTROOM', 'MENS', 'WOMENS', 'LADIES', 'GENTS', 'STAIRS', 'STAIRWELL', 'CUSTODIAL', 'JANITOR CLOSET',
  'ELECTRICAL', 'CONFERENCE', 'CONFERENCE ROOM', 'LIBRARY', 'STUDIO', 'GYM', 'GYMNASIUM', 'AUDITORIUM', 'CAFETERIA',
  'KITCHEN', 'SERVER', 'SERVER ROOM', 'COPY', 'COPY ROOM', 'MAIL', 'MAIL ROOM', 'BREAK ROOM', 'VOID', 'OPEN BELOW',
  'MECHANICAL ROOM', 'ELECTRICAL ROOM', 'STORAGE ROOM', 'LAUNDRY', 'RECEPTION', 'LOUNGE', 'CLOSET',
];

const KIND_OF = {
  restroom: ['RESTROOM', 'RESTROOMS', 'UNISEX', 'UNISEX RESTROOM', 'MEN', 'WOMEN', 'MENS', 'WOMENS', 'LADIES', 'GENTS'],
  elevator: ['ELEVATOR'],
  void: ['OPEN TO BELOW', 'VOID', 'OPEN BELOW'],
  stair: ['STAIRS', 'STAIRWELL'],
};

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

const DIGIT_AS_LETTER = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z' };

function normalise(raw) {
  let s = String(raw || '').toUpperCase().replace(/['`]/g, '');
  const letters = (s.match(/[A-Z]/g) || []).length;
  if (letters >= 3) s = s.replace(/\d/g, (d) => DIGIT_AS_LETTER[d] || ' ');
  return s.replace(/[^A-Z/ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Edit distance allowed for a vocabulary word: scales with length (short words: one substitution only).
function tolerance(v) { return Math.max(1, Math.floor(v.length * 0.2)); }

// -> { name, dist } best vocabulary hit within tolerance (optionally limited to a word list), else null
function best(s, list) {
  let bn = null, bd = 1e9;
  const sq = s.replace(/ /g, '');
  for (const v of list) {
    const d = Math.min(lev(s, v), lev(sq, v.replace(/ /g, '')));
    if (d < bd) { bd = d; bn = v; }
  }
  if (!bn || bd > tolerance(bn)) return null;
  if (bn.length <= 4 && bd > 0 && s.length !== bn.length) return null; // short words: substitution only
  return { name: bn, dist: bd };
}

// Best vocabulary name for OCR text, else null.
export function matchName(raw) {
  const digits = (String(raw || '').match(/\d/g) || []).length;
  const s = normalise(raw);
  if (s.length < 3 || digits >= 3) return null;
  const b = best(s, NAME_VOCAB);
  return b ? b.name : null;
}

export function titleCase(s) {
  return s.toLowerCase().replace(/(^|[ /])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bIct\b/, 'ICT');
}

// Classify one piece of OCR text. opts.format = inferFormat(...) result (optional).
// -> { kind: 'number'|'name'|'restroom'|'elevator'|'void'|'stair'|'unknown', value, cost }
// number: value is the repaired room number; stair: value 'ST<digit>' (stair label) or the word;
// restroom/elevator/void: value is the vocabulary word; name: the vocabulary word.
export function classify(raw, opts = {}) {
  const text = String(raw || '');
  const up = text.toUpperCase();
  const m = /^\s*S\s?T\s?[-.]?\s?([0-9ILOSB])\s*$/.exec(up);
  if (m) return { kind: 'stair', value: `ST${{ O: '0', I: '1', L: '1', S: '5', B: '8' }[m[1]] || m[1]}`, cost: /^\s*ST\d\s*$/.test(up) ? 0 : 1 };
  const realDigits = (up.match(/\d/g) || []).length;
  const num = repairNumber(text, opts.format);
  const pure = (s) => parseNumber(s) !== null;
  if (num && (realDigits >= 2 || (realDigits >= 1 && (opts.format || pure(text))) || pure(text)) && num.cost <= 2) {
    return { kind: 'number', value: num.value, cost: num.cost };
  }
  const s = normalise(text);
  if (s.length >= 3 && realDigits < 3) {
    for (const kind of Object.keys(KIND_OF)) {
      const b = best(s, KIND_OF[kind]);
      if (b) return { kind, value: b.name, cost: b.dist };
    }
    const b = best(s, NAME_VOCAB);
    if (b) return { kind: 'name', value: b.name, cost: b.dist };
  }
  if (num && realDigits >= 1) return { kind: 'number', value: num.value, cost: num.cost, weak: true };
  return { kind: 'unknown', value: '', cost: 9 };
}
