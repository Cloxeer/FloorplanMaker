// look.js — how each kind of room shape looks, in ONE place. The exported
// SVG's style rules (svgExport.js), the legend swatches (legend.js), the
// palette chips (paletteIcons.js) and the Trace canvas (stageObjects.js) all
// read these values, so what the legend shows is what the SVG shows.
//
// "big" is not a look of its own any more: a big room is just a room.
// Depends on: nothing.

// A void (empty space, e.g. open to the floor below): a very light grey box
// with a dashed outline, labelled "Open to below" in grey — exactly the
// original hand-drawn plans' .void / .dim styles.
export const ROOM_LOOK = {
  room: { fill: '#eef1f4', stroke: '#8f959c', width: 2 },
  ours: { fill: '#f5e3ea', stroke: '#8f959c', width: 2 },
  core: { fill: '#dfe3e8', stroke: '#8f959c', width: 2 },
  void: { fill: '#f7f7f8', stroke: '#b5bac0', width: 2, dash: [10, 8] },
};
export const VOID_TEXT = { text: 'Open to below', fill: '#8a8f96', size: 19, small: 15 };

// The same looks drawn small (legend swatches ~20 wide, palette chips ~40
// wide): same colors, the dashes shortened so several fit.
export const SWATCH_LOOK = {
  ...ROOM_LOOK,
  room: { ...ROOM_LOOK.room, width: 1.5 },
  ours: { ...ROOM_LOOK.ours, width: 1.5 },
  core: { ...ROOM_LOOK.core, width: 1.5 },
  void: { ...ROOM_LOOK.void, width: 1.5, dash: [3, 2] },
};
export const CHIP_LOOK = SWATCH_LOOK;

// Where the "Open to below" words go inside a void's box {x, y, w, h}, as
// the original plans do it: one line (19px) when it fits, else two lines
// "Open to" / "below" (15px, or smaller for a tiny void). Returns
// [{ text, x, y, size }] — [] when even small text won't fit.
const CHAR_W = 0.62; // glyph width / font size, a little generous so words never spill out
export function voidLabelLines(box) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const { text, size, small } = VOID_TEXT;
  if (box.w >= text.length * size * CHAR_W + 8 && box.h >= size + 8) {
    return [{ text, x: cx, y: cy, size }];
  }
  const fs = Math.min(small, (box.w - 6) / (7 * CHAR_W), (box.h - 4) / 2.6);
  if (fs < 7) return [];
  const gap = fs * 0.75;
  return [
    { text: 'Open to', x: cx, y: cy - gap, size: fs },
    { text: 'below', x: cx, y: cy + gap, size: fs },
  ];
}

// The class written into the SVG for a room item (big -> room).
export function exportClass(cls) {
  return cls === 'big' ? 'room' : cls;
}

export function roomLook(cls, table = ROOM_LOOK) {
  return table[exportClass(cls)] || table.room;
}

// "fill: …; stroke: …; stroke-width: …;" (+ dashes) for a CSS rule.
export function cssDecl(look) {
  const dash = look.dash ? ` stroke-dasharray: ${look.dash.join(' ')};` : '';
  return `fill: ${look.fill}; stroke: ${look.stroke}; stroke-width: ${look.width};${dash}`;
}

// The same as SVG presentation attributes.
export function svgAttrs(look) {
  const dash = look.dash ? ` stroke-dasharray="${look.dash.join(' ')}"` : '';
  return `fill="${look.fill}" stroke="${look.stroke}" stroke-width="${look.width}"${dash}`;
}

export function rectPoints(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
