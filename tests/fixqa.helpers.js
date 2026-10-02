// fixqa.helpers.js
// Seeded random plan generator for the Fix-flow property tests (tests/fixqa.test.js).
// genDoc(seed, 'sane'|'nasty') -> doc. 'sane' plans are well-formed (rooms in a grid with random blanks,
// duplicates and misnumbering, halls, doors, stairs, polygon rooms); 'nasty' adds zero sizes, missing
// fields, NaN, huge coordinates, duplicate ids and junk items.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const lbl = { pinned: false, x: null, y: null, fontSize: null };

export function genDoc(seed, mode = 'sane') {
  const R = rng(seed), ri = (a, b) => a + Math.floor(R() * (b - a + 1)), pick = (a) => a[Math.floor(R() * a.length)], chance = (p) => R() < p;
  let n = 0;
  const id = () => `g${seed}_${n++}`;
  const items = [];
  const rows = ri(1, 4), cols = ri(1, 7), w = ri(8, 24) * 5, h = ri(8, 20) * 5, gap = pick([0, 0, 5, 10]), corridor = ri(2, 6) * 10;
  const ox = ri(0, 4) * 50, oy = ri(0, 4) * 50;
  const base = ri(100, 900), step = pick([1, 2, 1, 5]), lettered = chance(0.3), prefix = chance(0.2) ? pick(['R', 'M', 'S']) : '';
  let y = oy;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let num = lettered ? `${base}${LET[c % LET.length]}` : String(base + r * 100 + c * step);
      num = prefix + num;
      const roll = R();
      if (roll < 0.2) num = '';
      else if (roll < 0.28 && c > 0) num = prefix + String(base + r * 100); // duplicate-ish
      else if (roll < 0.33) num = prefix + String(ri(100, 999));
      const rm = { id: id(), type: 'room', cls: chance(0.05) ? pick(['core', 'void', 'ours', 'big']) : 'room', shape: 'rect', x: ox + c * (w + gap), y, w, h, number: num, name: '', label: { ...lbl }, showName: false, section: null };
      if (chance(0.04)) rm.label = { pinned: true, x: rm.x + w + 80, y: rm.y - 60, fontSize: chance(0.5) ? 8 : null };
      if (chance(0.04)) { rm.shape = 'poly'; rm.points = [[rm.x, rm.y], [rm.x + w, rm.y], [rm.x + w, rm.y + 5 * Math.round(h / 10)], [rm.x + 5 * Math.round(w / 10), rm.y + h], [rm.x, rm.y + h]]; delete rm.w; delete rm.h; delete rm.x; delete rm.y; }
      if (chance(0.05)) { rm.x += 5 * ri(-Math.floor(w / 10), Math.floor(w / 10)); rm.y += 5 * ri(-Math.floor(h / 10), Math.floor(h / 10)); } // nudges make overlaps
      items.push(rm);
    }
    y += h + (r % 2 === 0 ? corridor : gap);
    if (r % 2 === 0 && chance(0.85)) items.push({ id: id(), type: 'hall', x: ox, y: y - corridor + 5, w: cols * (w + gap), h: corridor - 10 });
  }
  const W = cols * (w + gap) + ox * 2, H = y + oy;
  if (chance(0.5)) for (let k = ri(1, 3); k > 0; k--) items.push({ id: id(), type: 'hall', x: ri(0, 20) * 10, y: ri(0, 20) * 10, w: pick([10, 20, 400]), h: pick([10, 20, 300]) });
  if (chance(0.3)) items.push({ id: id(), type: 'stair', x: ri(0, 10) * 20, y: ri(0, 10) * 20, w: 40, h: 60, dir: 'v' });
  if (chance(0.4)) items.push({ id: id(), type: 'door', x1: 0, y1: 100, x2: 0, y2: 140 });
  if (chance(0.3)) items.push({ id: id(), type: 'compass', x: W + 20, y: 20 });
  const doc = { items };
  if (!chance(0.15)) doc.floor = { points: chance(0.7) ? [[0, 0], [W, 0], [W, H], [0, H]] : [[0, 0], [W, 0], [W, H / 2], [W / 2, H / 2], [W / 2, H], [0, H]] };
  if (mode === 'nasty') nastify(doc, R, ri, pick, chance, id);
  return doc;
}

function nastify(doc, R, ri, pick, chance, id) {
  const items = doc.items;
  const bomb = () => items[ri(0, Math.max(0, items.length - 1))];
  for (let k = ri(1, 6); k > 0; k--) {
    const it = bomb();
    if (!it || typeof it !== 'object') continue;
    switch (ri(0, 9)) {
      case 0: it.w = 0; break;
      case 1: it.h = 0; break;
      case 2: it.x = NaN; break;
      case 3: if (it.type === 'room' && it.shape !== 'poly') delete it.w; else delete it.id; break;
      case 4: it.x = 1e9 * (R() - 0.5); it.y = 1e9; break;
      case 5: it.id = items[0] && items[0].id; break;
      case 6: it.w = -it.w || -5; break;
      case 7: it.number = pick([null, undefined, 0, 128, '  ', 'ab', '12', '1234567']); break;
      case 8: items.push(null, 5, 'x', {}, { type: 'room' }, { type: 'hall' }, { id: id(), type: 'banana', x: 1, y: 1, w: 1, h: 1 }); break;
      default: if (it.type === 'room') it.shape = 'poly', it.points = pick([[], [[0, 0]], [[0, 0], [10, 0]], null]);
    }
  }
  if (chance(0.15)) doc.floor = pick([{}, { points: [] }, { points: [[0, 0]] }, { points: [[NaN, 0], [1, 1], [2, 2]] }, null]);
  if (chance(0.05)) doc.items = undefined;
}
