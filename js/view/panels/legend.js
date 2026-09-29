// legend.js
// Shared "what the colors mean" legend: small swatches drawn with the same
// class names as the exported SVG dialect (js/model/svgExport.js), so the
// legend always looks like the real thing. Used by previewStep.js (beside
// the preview) and palette.js (collapsible section at the bottom of the
// left palette). "Place legend" also writes it into the exported SVG, but via
// legendSvgGroupAt() with plain attributes only (no room/door/floor classes),
// so the map-build parsers never read a swatch as a real room.
// Room, core and void swatches take their colors and dashes from
// js/model/look.js — the same values the exported SVG's style rules use.
// Depends on: js/model/look.js.

import {
  SWATCH_LOOK, cssDecl, svgAttrs, hatchLinesSvg, rectPoints,
} from '../../model/look.js';

const VOID_MESH = SWATCH_LOOK.void.hatch;
// The void swatch: box + the same criss-cross mesh as on the plan.
function voidSwatch(x, y, w, h, attrs) {
  const g = attrs
    ? `<g stroke="${VOID_MESH.stroke}" stroke-width="${VOID_MESH.width}">`
    : '<g class="lg-void-hatch">';
  const box = attrs ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${svgAttrs(SWATCH_LOOK.void)}/>`
    : `<rect class="lg-void" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  return box + g + hatchLinesSvg(rectPoints(x, y, w, h), VOID_MESH) + '</g>';
}

// One "Room" row: a big room is just a room, drawn the same.
const ITEMS = [
  { label: 'Room', svg: '<rect class="lg-room" x="2" y="3" width="20" height="14"/>' },
  {
    label: 'Selected room',
    svg: '<rect class="lg-selected" x="2" y="3" width="20" height="14"/>',
  },
  { label: 'Core', svg: '<rect class="lg-core" x="2" y="3" width="20" height="14"/>' },
  { label: 'Void', svg: voidSwatch(2, 3, 20, 14, false) },
  {
    label: 'Stairs',
    svg: '<rect class="lg-core" x="2" y="3" width="20" height="14"/>'
      + '<g class="lg-stair"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="13" x2="20" y2="13"/></g>',
  },
  {
    // A door is a gap cut in the outside wall, labelled EXIT.
    label: 'Doors',
    svg: '<line class="lg-wall" x1="1" y1="7" x2="8" y2="7"/><line class="lg-wall" x1="16" y1="7" x2="23" y2="7"/>'
      + '<text class="lg-exit" x="12" y="17">EXIT</text>',
  },
  {
    label: 'Hallway',
    svg: '<rect class="lg-hall" x="2" y="3" width="20" height="14"/>',
  },
  {
    // Dashed purple line with a padlock — a staff-only wall inside a hallway.
    label: 'Staff only',
    caption: 'no public access',
    svg: '<line class="lg-staff" x1="1" y1="11" x2="23" y2="11"/>'
      + '<path class="lg-lock" d="M10,10 V8 A2,2 0 0 1 14,8 V10" fill="none"/>'
      + '<rect class="lg-lock" x="9" y="10" width="6" height="5" rx="1"/>',
  },
  {
    label: 'Compass',
    svg: '<circle cx="12" cy="10" r="7" fill="#ffffff" stroke="#e6e6ea" stroke-width="1.5"/>'
      + '<path d="M12,4 L14.5,10 L9.5,10 Z" fill="#8C0B42"/>',
  },
  { label: 'Outline', svg: '<rect class="lg-outline" x="2" y="3" width="20" height="14"/>' },
];

const LEGEND_STYLE = `
  .lg-room  { ${cssDecl(SWATCH_LOOK.room)} }
  .lg-selected { fill: #cfe0ff; stroke: #2f6feb; stroke-width: 1.5; }
  .lg-core  { ${cssDecl(SWATCH_LOOK.core)} }
  .lg-void  { ${cssDecl(SWATCH_LOOK.void)} }
  .lg-void-hatch { stroke: ${VOID_MESH.stroke}; stroke-width: ${VOID_MESH.width}; }
  .lg-stair { stroke: #8f959c; stroke-width: 1.5; }
  .lg-wall  { stroke: #3a3d42; stroke-width: 2.5; }
  .lg-exit  { fill: #1a7f37; font-size: 7px; font-weight: 700; text-anchor: middle; }
  .lg-hall  { fill: #d7dbe0; }
  .lg-staff { stroke: #7c3aed; stroke-width: 2.5; stroke-dasharray: 4 3; }
  .lg-lock  { fill: #ffffff; stroke: #7c3aed; stroke-width: 1.2; }
  .lg-outline { fill: #ffffff; stroke: #3a3d42; stroke-width: 2; }
`;

export function legendHtml(className = 'legend-list') {
  const rows = ITEMS.map((item) => `
    <li class="legend-row">
      <svg class="legend-swatch" viewBox="0 0 24 20" width="24" height="20" aria-hidden="true">
        <style>${LEGEND_STYLE}</style>
        ${item.svg}
      </svg>
      <span>${item.label}${item.caption ? `<br><small class="legend-caption">${item.caption}</small>` : ''}</span>
    </li>
  `).join('');
  return `<ul class="${className}">${rows}</ul>`;
}

// Builds a standalone <g class="legend"> block for the exported SVG, drawn
// with plain attributes (no room/door/floor classes) so the parser never
// mistakes it for real geometry. Positioned in the bottom-right margin of
// the given viewBox {x,y,w,h}.
const SWATCH_FILLS = {
  'lg-room': SWATCH_LOOK.room,
  'lg-selected': { fill: '#cfe0ff', stroke: '#2f6feb', width: 1.5 },
  'lg-core': SWATCH_LOOK.core,
  'lg-void': SWATCH_LOOK.void,
  'lg-hall': { fill: '#d7dbe0', stroke: '#d7dbe0', width: 1.5 },
  'lg-outline': { fill: '#ffffff', stroke: '#3a3d42', width: 1.5 },
};
function swatchFor(item) {
  const m = item.svg.match(/class="(lg-[a-z]+)"/);
  const key = m ? m[1] : 'lg-room';
  const style = SWATCH_FILLS[key] || SWATCH_LOOK.room;
  if (item.label === 'Stairs') {
    return `<rect x="0" y="0" width="20" height="14" ${svgAttrs(style)}/>`
      + '<line x1="3" y1="4" x2="17" y2="4" stroke="#8f959c" stroke-width="1.5"/>'
      + '<line x1="3" y1="7" x2="17" y2="7" stroke="#8f959c" stroke-width="1.5"/>'
      + '<line x1="3" y1="10" x2="17" y2="10" stroke="#8f959c" stroke-width="1.5"/>';
  }
  if (item.label === 'Doors') {
    return '<line x1="0" y1="4" x2="7" y2="4" stroke="#3a3d42" stroke-width="2.5"/>'
      + '<line x1="13" y1="4" x2="20" y2="4" stroke="#3a3d42" stroke-width="2.5"/>'
      + '<text x="10" y="13" fill="#1a7f37" font-size="7" font-weight="700" text-anchor="middle">EXIT</text>';
  }
  if (item.label === 'Staff only') {
    return '<line x1="0" y1="8" x2="20" y2="8" stroke="#7c3aed" stroke-width="2.5" stroke-dasharray="4 3"/>'
      + '<path d="M8,7 V5 A2,2 0 0 1 12,5 V7" fill="none" stroke="#7c3aed" stroke-width="1.2"/>'
      + '<rect x="7" y="7" width="6" height="5" rx="1" fill="#ffffff" stroke="#7c3aed" stroke-width="1.2"/>';
  }
  if (item.label === 'Void') return voidSwatch(0, 0, 20, 14, true);
  if (item.label === 'Compass') {
    return '<circle cx="10" cy="7" r="6" fill="#ffffff" stroke="#e6e6ea" stroke-width="1.5"/>'
      + '<path d="M10,2 L12,7 L8,7 Z" fill="#8C0B42"/>';
  }
  return `<rect x="0" y="0" width="20" height="14" ${svgAttrs(style)}/>`;
}
const LEGEND_ROW_H = 24;
const LEGEND_GROUP_W = 190;
const LEGEND_GROUP_H = ITEMS.length * LEGEND_ROW_H + 16;

// Fixed footprint of the legend group, in SVG user units — used by callers
// (previewStep.js) that need to lay the legend out before rendering it.
export function legendGroupSize() {
  return { w: LEGEND_GROUP_W, h: LEGEND_GROUP_H };
}

function legendRows() {
  return ITEMS.map((item, i) => {
    const y = 12 + i * LEGEND_ROW_H;
    const label = item.caption ? `${item.label} (${item.caption})` : item.label;
    return `<g transform="translate(4,${y})">${swatchFor(item)}<text x="28" y="11" font-size="11" fill="#1d1f23" font-family="sans-serif">${label}</text></g>`;
  }).join('');
}

// Builds the legend <g> at an explicit position (SVG user units), optionally
// uniformly scaled (used by the preview's resizable legend placement).
export function legendSvgGroupAt(x, y, scale = 1) {
  const gx = Math.round(x);
  const gy = Math.round(y);
  const s = scale && Number.isFinite(scale) ? scale : 1;
  const transform = s === 1 ? `translate(${gx},${gy})` : `translate(${gx},${gy}) scale(${s})`;
  return `<g class="legend" transform="${transform}">`
    + `<rect x="0" y="0" width="${LEGEND_GROUP_W}" height="${LEGEND_GROUP_H}" fill="#ffffff" fill-opacity="0.92" stroke="#c7cad0" stroke-width="1"/>`
    + legendRows()
    + '</g>';
}

export function legendSvgGroup(viewBox) {
  const gx = viewBox.x + viewBox.w - LEGEND_GROUP_W - 20;
  const gy = viewBox.y + viewBox.h - LEGEND_GROUP_H - 20;
  return legendSvgGroupAt(gx, gy);
}

export const LEGEND_NOTE = 'What each mark on the plan means. Click “Place legend” to put this key on the downloaded SVG.';
