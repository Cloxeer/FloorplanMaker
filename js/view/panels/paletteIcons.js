// paletteIcons.js
// Builds small inline-SVG markup for palette chips/ghosts, reusing the same
// dialect looks (room/ours/core/void from js/model/look.js; door/stair/compass) as the real
// canvas rendering (see js/view/stageObjects.js) so chips look like the
// real thing. Pure string templates, no DOM dependency.

import { iconSvg } from '../icons.js';
import { legendSvgGroupAt, legendGroupSize } from './legend.js';
import {
  SWATCH_LOOK, CHIP_LOOK, svgAttrs, hatchLinesSvg, rectPoints,
} from '../../model/look.js';

// A room-kind box drawn with the shared look (js/model/look.js).
function box(w, h, cls) {
  return `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" ${svgAttrs(SWATCH_LOOK[cls] || SWATCH_LOOK.room)}/>`;
}

// Each entry: { w, h } = plan-unit footprint used for the drag ghost's scale.
export const PIECE_SIZE = {
  room: { w: 120, h: 100 },
  small: { w: 70, h: 60 },
  ours: { w: 120, h: 100 },
  restroom: { w: 100, h: 90 },
  elevator: { w: 90, h: 90 },
  stair: { w: 90, h: 140 },
  door: { w: 90, h: 20 },
  void: { w: 100, h: 90 },
  compass: { w: 60, h: 60 },
  closet: { w: 70, h: 60 },
  authwall: { w: 120, h: 16 },
  legend: legendGroupSize(),
};

function svgWrap(vb, inner) {
  return `<svg viewBox="0 0 ${vb[0]} ${vb[1]}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// Scales a label's font-size down (with an average-glyph-width estimate) so
// it always fits inside a boxW x boxH area with a small margin, then adds an
// SVG `textLength`/`lengthAdjust` safety net for the rare case the estimate
// still runs long. Shared by every chip preview so no label ever spills past
// its box edge (mirrors stageObjects.js's `fitText`, which does the same via
// real canvas measurement on the stage).
function fitLabelSvg(text, cx, cy, boxW, boxH, opts = {}) {
  if (!text) return '';
  const margin = opts.margin != null ? opts.margin : 4;
  const maxW = Math.max(4, boxW - margin * 2);
  const maxH = Math.max(4, boxH - margin * 2);
  const charW = 0.58; // average glyph width as a fraction of font-size, for this sans-serif
  const maxSize = opts.max != null ? opts.max : 16;
  const minSize = opts.min != null ? opts.min : 6;
  let size = maxW / Math.max(1, text.length * charW);
  size = Math.min(size, maxH * 0.85, maxSize);
  size = Math.max(size, minSize);
  const estW = text.length * size * charW;
  const lengthAttr = estW > maxW ? ` textLength="${maxW.toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '';
  const fill = opts.fill || '#2b2e33';
  const weight = opts.weight || 400;
  // font-size is set via the `style` attribute, not the bare presentation
  // attribute: studio.css defines fixed-size `.lbl`/`.lblS` rules for the
  // exported-SVG dialect, and a stylesheet rule always beats a plain
  // presentation attribute, which silently ignored our computed size and
  // let long names (e.g. "Classroom") overflow the small chip box.
  return `<text x="${cx}" y="${(cy + size * 0.35).toFixed(1)}" text-anchor="middle" fill="${fill}" style="font-size:${size.toFixed(1)}px;font-weight:${weight}"${lengthAttr}>${text}</text>`;
}

function roomChip(cls, label, vb) {
  const [w, h] = vb;
  const text = label ? fitLabelSvg(label, w / 2, h / 2, w, h, {}) : '';
  return svgWrap(vb, `${box(w, h, cls)}${text}`);
}

function closetChip(vb) {
  const [w, h] = vb;
  return svgWrap(vb, `${box(w, h, 'core')}${fitLabelSvg('Utility', w / 2, h / 2, w, h, {})}`);
}

// Empty space: the "transparent" criss-cross pattern, like the legend, Trace
// and the SVG.
function voidChip(vb) {
  const [w, h] = vb;
  const look = CHIP_LOOK.void;
  const mesh = `<g stroke="${look.hatch.stroke}" stroke-width="${look.hatch.width}">`
    + `${hatchLinesSvg(rectPoints(2, 2, w - 4, h - 4), look.hatch)}</g>`;
  return svgWrap(vb, `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" ${svgAttrs(look)}/>${mesh}`);
}

// Elevator and restroom chips draw the exact user-supplied icons from
// js/view/icons.js (ICONS.elevator / ICONS.restroom via iconSvg), the same
// source the stage glyph (stageObjects.js) and the SVG export
// (js/model/svgExport.js) use, so all three match.
function elevatorChip(vb) {
  const [w, h] = vb;
  return svgWrap(vb, `
    ${box(w, h, 'core')}
    ${iconSvg('elevator', 2, 2, w - 4, h - 4, 0.55)}
  `);
}

function restroomChip(vb) {
  const [w, h] = vb;
  return svgWrap(vb, `
    ${box(w, h, 'core')}
    ${iconSvg('restroom', 2, 2, w - 4, h - 4, 0.65)}
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

function authwallChip(vb) {
  const [w, h] = vb;
  const y = h / 2;
  return svgWrap(vb, `
    <line x1="4" y1="${y}" x2="${w - 4}" y2="${y}" stroke="#7c3aed" stroke-width="5" stroke-dasharray="6 4" stroke-linecap="round"/>
    <circle cx="${w / 2}" cy="${y}" r="5" fill="#7c3aed"/>
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

// A tiny legend card: three swatch-and-line rows.
function legendChip(vb) {
  const [w, h] = vb;
  const rows = [0, 1, 2].map((i) => {
    const y = 7 + i * 8;
    return `<rect x="8" y="${y}" width="6" height="5" fill="#eef1f4" stroke="#8f959c" stroke-width="0.8"/>`
      + `<line x1="17" y1="${y + 2.5}" x2="${w - 8}" y2="${y + 2.5}" stroke="#8a8690" stroke-width="1.5"/>`;
  }).join('');
  return svgWrap(vb, `<rect x="4" y="3" width="${w - 8}" height="${h - 6}" rx="2" fill="#ffffff" stroke="#8a8690" stroke-width="1"/>${rows}`);
}

// key -> viewBox (chip preview size, small)
const CHIP_VB = { w: 44, h: 34 };

export function chipSvg(key) {
  const vb = [CHIP_VB.w, CHIP_VB.h];
  switch (key) {
    case 'room': return roomChip('room', '101', vb);
    case 'small': return roomChip('room', '1', vb);
    case 'ours': return roomChip('ours', '101', vb);
    case 'restroom': return restroomChip(vb);
    case 'elevator': return elevatorChip(vb);
    case 'stair': return stairChip(vb);
    case 'door': return doorChip(vb);
    case 'void': return voidChip(vb);
    case 'compass': return compassChip(vb);
    case 'closet': return closetChip(vb);
    case 'authwall': return authwallChip(vb);
    case 'legend': return legendChip(vb);
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
    case 'ours': inner = roomChip('ours', '101', vb); break;
    case 'restroom': inner = restroomChip(vb); break;
    case 'elevator': inner = elevatorChip(vb); break;
    case 'stair': inner = stairChip(vb); break;
    case 'door': inner = doorChip(vb); break;
    case 'void': inner = voidChip(vb); break;
    case 'compass': inner = compassChip(vb); break;
    case 'closet': inner = closetChip(vb); break;
    case 'authwall': inner = authwallChip(vb); break;
    case 'legend': inner = svgWrap(vb, legendSvgGroupAt(0, 0, 1)); break;
    default: inner = svgWrap(vb, '');
  }
  return { svg: inner, w, h };
}
