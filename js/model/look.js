// look.js — how each kind of room shape looks, in ONE place. The exported
// SVG's style rules (svgExport.js), the legend swatches (legend.js), the
// palette chips (paletteIcons.js) and the Trace canvas (stageObjects.js) all
// read these values, so what the legend shows is what the SVG shows.
//
// "big" is not a look of its own any more: a big room is just a room.
// Depends on: nothing.

export const ROOM_LOOK = {
  room: { fill: '#eef1f4', stroke: '#8f959c', width: 2 },
  ours: { fill: '#f5e3ea', stroke: '#8f959c', width: 2 },
  core: { fill: '#dfe3e8', stroke: '#8f959c', width: 2 },
  // Empty space (e.g. open to the floor below): white, thick grey dashes.
  void: { fill: '#ffffff', stroke: '#8f959c', width: 5, dash: [16, 10] },
};

// The same looks drawn small (legend swatches, palette chips ~20-40 units
// wide): same colors, the void's dashes shortened so several fit the swatch.
export const SWATCH_LOOK = {
  ...ROOM_LOOK,
  room: { ...ROOM_LOOK.room, width: 1.5 },
  ours: { ...ROOM_LOOK.ours, width: 1.5 },
  core: { ...ROOM_LOOK.core, width: 1.5 },
  void: { ...ROOM_LOOK.void, width: 2.5, dash: [4, 2.5] },
};

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
