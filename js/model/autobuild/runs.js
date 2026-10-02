// runs.js
// Number-sequence inference over rooms laid out along a corridor. Pure.
// Never invents a number that already exists; only fills a gap that the numbers on both
// sides pin down, and marks what it changed with r.inferred = true.

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I and O are skipped in room suffixes

// group rects into rows (axis 'x': rooms side by side) or columns (axis 'y': stacked rooms)
function groups(rects, axis) {
  const cx = axis === 'x' ? (r) => r.y + r.h / 2 : (r) => r.x + r.w / 2; // cross-axis centre
  const sz = axis === 'x' ? (r) => r.h : (r) => r.w;
  const out = [];
  for (const r of rects.slice().sort((a, b) => cx(a) - cx(b))) {
    const c = cx(r);
    const g = out.find((q) => Math.abs(q.c - c) < Math.min(q.s, sz(r)) * 0.35 && Math.abs(q.s - sz(r)) < Math.max(q.s, sz(r)) * 0.35);
    if (g) { g.items.push(r); g.c = (g.c * (g.items.length - 1) + c) / g.items.length; } else out.push({ c, s: sz(r), items: [r] });
  }
  const pos = axis === 'x' ? (r) => r.x : (r) => r.y;
  return out.filter((g) => g.items.length >= 3).map((g) => g.items.slice().sort((a, b) => pos(a) - pos(b)));
}

// 128B 128C 128D ...: a missing or odd letter whose neighbours pin it down
function letterPass(list, rooms, changed) {
  const parse = (n) => { const m = /^(\d{3})([A-HJ-NP-Z])$/.exec(n || ''); return m ? { base: m[1], li: LETTERS.indexOf(m[2]) } : null; };
  const bases = {};
  list.forEach((r) => { const p = parse(r.number); if (p) bases[p.base] = (bases[p.base] || 0) + 1; });
  const base = Object.keys(bases).sort((a, b) => bases[b] - bases[a])[0];
  if (!base || bases[base] < 3) return;
  const good = (r) => { const p = parse(r.number); return p && p.base === base ? p : null; };
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.inferred || (good(r) && (r.votes || 0) >= 2)) continue;
    let j = i - 1; while (j >= 0 && !good(list[j])) j--;
    let k = i + 1; while (k < list.length && !good(list[k])) k++;
    if (j < 0 || k >= list.length) continue;
    const a = good(list[j]), b = good(list[k]);
    if (b.li - a.li !== k - j) continue; // neighbours do not agree on a gap this size
    const li = a.li + (i - j);
    if (li < 0 || li >= LETTERS.length) continue;
    const value = base + LETTERS[li];
    if (value === r.number) continue;
    if (rooms.some((q) => q !== r && q.number === value)) continue;
    r.number = value; r.votes = 2; r.inferred = true;
    changed.push(r);
  }
}

// 124 126 128 130 / 101 102 103: a run with a constant step; a gap is filled only when both
// neighbours agree on the step AND that step continues past at least one of them.
function numericPass(list, rooms, changed) {
  const parse = (r) => {
    const m = /^([A-Z]{0,3})(\d{2,4})$/.exec(r.number || '');
    return m && !r.inferred && (r.votes || 0) >= 2 ? { pre: m[1], w: m[2].length, v: parseInt(m[2], 10) } : null;
  };
  const P = list.map(parse);
  const at = (i, j) => (P[i] && P[j] && P[i].pre === P[j].pre && P[i].w === P[j].w && P[i].v !== P[j].v ? (P[j].v - P[i].v) / (j - i) : null);
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.inferred || P[i]) continue;
    let j = i - 1; while (j >= 0 && !P[j]) j--;
    let k = i + 1; while (k < list.length && !P[k]) k++;
    if (j < 0 || k >= list.length) continue;
    const step = at(j, k);
    if (!step || !Number.isInteger(step) || Math.abs(step) > 4) continue;
    let j2 = j - 1; while (j2 >= 0 && !P[j2]) j2--;
    let k2 = k + 1; while (k2 < list.length && !P[k2]) k2++;
    const support = (j2 >= 0 && at(j2, j) === step) || (k2 < list.length && at(k, k2) === step);
    if (!support) continue;
    const v = P[j].v + (i - j) * step;
    if (v <= 0) continue;
    const value = P[j].pre + String(v).padStart(P[j].w, '0');
    if (value === r.number || rooms.some((q) => q !== r && q.number === value)) continue;
    r.number = value; r.votes = 2; r.inferred = true;
    changed.push(r);
  }
}

// rooms: [{x,y,w,h,number,votes}] (rects). Returns the rooms that were changed.
export function repairRuns(rooms) {
  const changed = [];
  const rects = rooms.filter((r) => !r.points && r.w > 0 && r.h > 0);
  for (const axis of ['x', 'y']) {
    for (const list of groups(rects, axis)) {
      letterPass(list, rooms, changed);
      numericPass(list, rooms, changed);
    }
  }
  return changed;
}
