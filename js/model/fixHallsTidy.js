// fixHallsTidy.js
// "Tight" hallways: after a Fix, hallways it touched that sit end to end with another hallway of exactly
// the same width and line are merged into one rectangle (so a corridor is not left cut into slices).
// Pure; returns a new item list (the input is never changed). Depends on: nothing.

const horiz = (h) => h.w > h.h;
const fin = (h) => [h.x, h.y, h.w, h.h].every(Number.isFinite);
const joins = (a, b) => horiz(a) === horiz(b) && (horiz(a)
  ? a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x)
  : a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y));
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

export function tidyHalls(items, touched) {
  let out = items;
  for (let guard = 0; guard < 50; guard++) {
    const halls = out.filter((it) => it.type === 'hall' && fin(it));
    let pair = null;
    for (const t of halls) {
      if (!touched.has(t.id)) continue;
      const n = halls.find((o) => o !== t && joins(t, o) && union(t, o).w * union(t, o).h === t.w * t.h + o.w * o.h);
      if (n) { pair = [t, n]; break; }
    }
    if (!pair) break;
    const [t, n] = pair, keep = n.w * n.h >= t.w * t.h ? n : t, gone = keep === n ? t : n, u = union(t, n);
    touched.add(keep.id);
    out = out.filter((it) => it !== gone).map((it) => (it === keep ? { ...it, ...u } : it));
  }
  return out;
}
