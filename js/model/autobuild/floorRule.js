// floorRule.js
// A room number starts with its floor: on floor 3 a "131" is wrong, it is a misread "331". AutoBuild knows which floor
// it is building, so a number with the wrong leading digit is repaired from the other readings of that room, else by
// fixing the digit, and flagged. Pure. Depends on: ./grammar.js (parseNumber).

import { parseNumber } from './grammar.js';

// The digit(s) a 3+-digit room number of this floor starts with. Floors 1-9 -> '1'..'9'; 10+ -> the floor itself ('12' for 12xx); else ''.
export function floorLead(floor) {
  const n = parseInt(floor, 10);
  return Number.isFinite(n) && n >= 1 ? String(n) : '';
}

// -> { wrong, p } : wrong = true when `number` (3+ digits, not a stair label) does not start with the floor's lead.
export function wrongFloor(number, lead) {
  const p = parseNumber(number);
  if (!lead || !p || p.num.length < 3 || p.pre === 'ST') return { wrong: false, p };
  return { wrong: !p.num.startsWith(lead), p };
}

// Fix `number` for a floor: -> { number, from } ; from is set when it was changed ('' when blanked).
// `ranked` = this room's other readings [{ val }]; `used` = numbers already taken.
export function fixForFloor(number, ranked, lead, used = new Set()) {
  const { wrong, p } = wrongFloor(number, lead);
  if (!wrong) return { number, from: '' };
  for (const c of ranked || []) {
    const cp = parseNumber(c.val);
    if (cp && cp.num.length >= 3 && cp.num.startsWith(lead) && !used.has(c.val)) return { number: c.val, from: number };
  }
  const swapped = p.pre + p.preSep + lead + p.num.slice(lead.length) + p.sufSep + p.suf;
  if (parseNumber(swapped) && !used.has(swapped)) return { number: swapped, from: number };
  return { number: '', from: number };
}
