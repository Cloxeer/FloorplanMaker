// look.js — how each kind of room shape looks, in ONE place. The exported
// SVG's style rules (svgExport.js), the legend swatches (legend.js), the
// palette chips (paletteIcons.js) and the Trace canvas (stageObjects.js) all
// read these values, so what the legend shows is what the SVG shows.
//
// "big" is not a look of its own any more: a big room is just a room.
// Depends on: nothing.

// A void (empty space, e.g. open to the floor below) shows the "transparent"
// pattern: a light grey box covered in a fine diagonal criss-cross mesh.
const VOID_FILL = '#eceef1';
const VOID_LINE = '#b9bec6';

export const ROOM_LOOK = {
  room: { fill: '#eef1f4', stroke: '#8f959c', width: 2 },
  ours: { fill: '#f5e3ea', stroke: '#8f959c', width: 2 },
  core: { fill: '#dfe3e8', stroke: '#8f959c', width: 2 },
  void: {
    fill: VOID_FILL, stroke: VOID_LINE, width: 2,
    hatch: { stroke: VOID_LINE, width: 1.5, spacing: 16 },
  },
};

// The same looks drawn small (legend swatches ~20 wide, palette chips ~40
// wide): same colors, the mesh just tighter so it reads as the same pattern.
export const SWATCH_LOOK = {
  ...ROOM_LOOK,
  room: { ...ROOM_LOOK.room, width: 1.5 },
  ours: { ...ROOM_LOOK.ours, width: 1.5 },
  core: { ...ROOM_LOOK.core, width: 1.5 },
  void: { ...ROOM_LOOK.void, width: 1, hatch: { stroke: VOID_LINE, width: 0.75, spacing: 4 } },
};
export const CHIP_LOOK = {
  ...SWATCH_LOOK,
  void: { ...ROOM_LOOK.void, width: 1, hatch: { stroke: VOID_LINE, width: 1, spacing: 8 } },
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

// The criss-cross mesh inside a shape: 45° lines both ways, `spacing` apart,
// lined up with the shape's top-left corner (so it matches a repeating tile
// with both diagonals drawn — how Trace fills a void), and clipped exactly to
// the shape's outline (a rectangle or any polygon). Returns [x1, y1, x2, y2]s.
export function hatchSegments(points, spacing) {
  if (!points || points.length < 3 || !(spacing > 0)) return [];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const out = [];
  // Lines x - y = c (going down-right) and x + y = c (going down-left).
  for (const [a, b] of [[1, -1], [1, 1]]) {
    const vals = points.map(([x, y]) => a * x + b * y);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const anchor = a * x0 + b * y0 + (b === 1 ? spacing : 0);
    let c = anchor + Math.ceil((lo - anchor) / spacing) * spacing;
    for (; c <= hi; c += spacing) {
      const hits = [];
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const q = points[(i + 1) % points.length];
        const fp = a * p[0] + b * p[1] - c;
        const fq = a * q[0] + b * q[1] - c;
        if ((fp < 0) === (fq < 0)) continue;
        const t = fp / (fp - fq);
        hits.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
      hits.sort((u, v) => u[0] - v[0]);
      for (let k = 0; k + 1 < hits.length; k += 2) {
        const [u, v] = [hits[k], hits[k + 1]];
        if (Math.hypot(v[0] - u[0], v[1] - u[1]) > 0.01) out.push([u[0], u[1], v[0], v[1]]);
      }
    }
  }
  return out;
}

// <line>s for the mesh (no class) — used by the export, legend and chips.
export function hatchLinesSvg(points, hatch, round = (n) => Math.round(n * 100) / 100) {
  return hatchSegments(points, hatch.spacing)
    .map(([x1, y1, x2, y2]) => `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}"/>`)
    .join('');
}

export function rectPoints(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
