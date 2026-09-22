// paletteIcons.js
// Builds small inline-SVG markup for palette chips/ghosts, reusing the same
// dialect classes (room/big/ours/core/void/door/stair/compass) as the real
// canvas rendering (see js/view/stageObjects.js) so chips look like the
// real thing. Pure string templates, no DOM dependency.

// Each entry: { w, h } = plan-unit footprint used for the drag ghost's scale.
export const PIECE_SIZE = {
  room: { w: 120, h: 100 },
  small: { w: 70, h: 60 },
  big: { w: 180, h: 140 },
  ours: { w: 120, h: 100 },
  restroom: { w: 100, h: 90 },
  elevator: { w: 90, h: 90 },
  stair: { w: 90, h: 140 },
  door: { w: 90, h: 20 },
  void: { w: 100, h: 90 },
  compass: { w: 60, h: 60 },
};

function svgWrap(vb, inner) {
  return `<svg viewBox="0 0 ${vb[0]} ${vb[1]}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function roomChip(cls, label, vb) {
  const [w, h] = vb;
  const text = label
    ? `<text x="${w / 2}" y="${h / 2 + 5}" class="${label.length > 4 ? 'lblS' : 'lbl'}" text-anchor="middle" font-size="${label.length > 4 ? 11 : 16}">${label}</text>`
    : '';
  return svgWrap(vb, `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" class="${cls}"/>${text}`);
}

function hatchLinesSvg(w, h, spacing = 8) {
  const lines = [];
  const step = Math.max(4, spacing);
  for (let d = -h; d < w; d += step) {
    lines.push(`<line x1="${d}" y1="0" x2="${d + h}" y2="${h}" stroke="#b9bec6" stroke-width="1"/>`);
    lines.push(`<line x1="${d + h}" y1="0" x2="${d}" y2="${h}" stroke="#b9bec6" stroke-width="1"/>`);
  }
  return lines.join('');
}

function voidChip(vb) {
  const [w, h] = vb;
  return svgWrap(vb, `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" class="void"/>
    <clipPath id="void-clip"><rect x="2" y="2" width="${w - 4}" height="${h - 4}"/></clipPath>
    <g clip-path="url(#void-clip)">${hatchLinesSvg(w, h)}</g>
  `);
}

function elevatorChip(vb) {
  const [w, h] = vb;
  return svgWrap(vb, `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" class="core"/>
    <text x="${w / 2}" y="${h / 2 + 6}" text-anchor="middle" font-size="20" font-weight="700" fill="#5f6368">&#8645;</text>
  `);
}

function restroomChip(vb) {
  const [w, h] = vb;
  const cx = w / 2, cy = h / 2;
  const bodyW = 16, bodyH = 12, tankH = 5;
  return svgWrap(vb, `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" class="core"/>
    <rect x="${cx - bodyW * 0.35}" y="${cy - bodyH / 2 - tankH}" width="${bodyW * 0.7}" height="${tankH}" rx="1.5" fill="none" stroke="#5f6368" stroke-width="1.5"/>
    <rect x="${cx - bodyW / 2}" y="${cy - bodyH / 2}" width="${bodyW}" height="${bodyH}" rx="${bodyH / 2}" fill="none" stroke="#5f6368" stroke-width="1.5"/>
  `);
}

function stairChip(vb) {
  const [w, h] = vb;
  const treads = [];
  const n = 4;
  for (let i = 1; i <= n; i++) {
    const y = (h * i) / (n + 1);
    treads.push(`<line x1="6" y1="${y}" x2="${w - 6}" y2="${y}"/>`);
  }
  return svgWrap(vb, `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="#8a8690"/><g class="stair">${treads.join('')}</g>`);
}

function doorChip(vb) {
  const [w, h] = vb;
  const midY = h / 2;
  const gapStart = w * 0.3, gapEnd = w * 0.7;
  return svgWrap(vb, `
    <line x1="0" y1="${midY}" x2="${gapStart}" y2="${midY}" stroke="#333" stroke-width="4"/>
    <line x1="${gapEnd}" y1="${midY}" x2="${w}" y2="${midY}" stroke="#333" stroke-width="4"/>
    <line x1="${gapStart}" y1="${midY}" x2="${gapEnd}" y2="${midY}" class="door" stroke-width="3"/>
    <text x="${w / 2}" y="${midY - 6}" class="exit" font-size="9">EXIT</text>
  `);
}

function compassChip(vb) {
  const [w, h] = vb;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 4;
  return svgWrap(vb, `
    <g transform="translate(${cx},${cy})">
      <circle r="${r}" fill="none" stroke="#8a8690" stroke-width="1.5"/>
      <polygon class="compass-north" points="0,${-r * 0.85} ${r * 0.28},0 ${-r * 0.28},0"/>
      <polygon points="0,${r * 0.85} ${r * 0.28},0 ${-r * 0.28},0" fill="#8a8690"/>
      <text class="compass-letter" y="${-r - 4}" font-size="10">N</text>
    </g>
  `);
}

// key -> viewBox (chip preview size, small)
const CHIP_VB = { w: 44, h: 34 };

export function chipSvg(key) {
  const vb = [CHIP_VB.w, CHIP_VB.h];
  switch (key) {
    case 'room': return roomChip('room', '101', vb);
    case 'small': return roomChip('room', '1', vb);
    case 'big': return roomChip('big', 'Classroom', vb);
    case 'ours': return roomChip('ours', '101', vb);
    case 'restroom': return restroomChip(vb);
    case 'elevator': return elevatorChip(vb);
    case 'stair': return stairChip(vb);
    case 'door': return doorChip(vb);
    case 'void': return voidChip(vb);
    case 'compass': return compassChip(vb);
    default: return svgWrap(vb, '');
  }
}

// Ghost SVG at plan scale: `zoom` = screen px per plan unit. Returns
// {svg, w, h} in *screen pixels* for sizing the floating ghost element.
export function ghostSvg(key, zoom) {
  const size = PIECE_SIZE[key] || { w: 100, h: 80 };
  const w = Math.max(20, size.w * zoom);
  const h = Math.max(16, size.h * zoom);
  const vb = [size.w, size.h];
  let inner;
  switch (key) {
    case 'room': inner = roomChip('room', '101', vb); break;
    case 'small': inner = roomChip('room', '1', vb); break;
    case 'big': inner = roomChip('big', 'Classroom', vb); break;
    case 'ours': inner = roomChip('ours', '101', vb); break;
    case 'restroom': inner = restroomChip(vb); break;
    case 'elevator': inner = elevatorChip(vb); break;
    case 'stair': inner = stairChip(vb); break;
    case 'door': inner = doorChip(vb); break;
    case 'void': inner = voidChip(vb); break;
    case 'compass': inner = compassChip(vb); break;
    default: inner = svgWrap(vb, '');
  }
  return { svg: inner, w, h };
}
