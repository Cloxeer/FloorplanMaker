// legend.js
// Shared "what the colors mean" legend: small swatches drawn with the same
// class names as the exported SVG dialect (js/model/svgExport.js), so the
// legend always looks like the real thing. Used by previewStep.js (beside
// the preview) and palette.js (collapsible section at the bottom of the
// left palette). Never written into an exported SVG file — the parser would
// read a legend swatch as a real room.
// Depends on: nothing (pure markup string).

const ITEMS = [
  { label: 'Room', svg: '<rect class="lg-room" x="2" y="3" width="20" height="14"/>' },
  { label: 'Big room', svg: '<rect class="lg-big" x="2" y="3" width="20" height="14"/>' },
  {
    label: 'Selected room',
    caption: 'picked out on the live map',
    svg: '<rect class="lg-selected" x="2" y="3" width="20" height="14"/>',
  },
  { label: 'Core', svg: '<rect class="lg-core" x="2" y="3" width="20" height="14"/>' },
  { label: 'Void', svg: '<rect class="lg-void" x="2" y="3" width="20" height="14"/>' },
  {
    label: 'Stairs',
    svg: '<rect class="lg-core" x="2" y="3" width="20" height="14"/>'
      + '<g class="lg-stair"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="13" x2="20" y2="13"/></g>',
  },
  {
    label: 'Doors',
    svg: '<line class="lg-door" x1="2" y1="9" x2="22" y2="9"/><text class="lg-exit" x="12" y="18">EXIT</text>',
  },
  {
    label: 'Hallway',
    svg: '<rect class="lg-hall" x="2" y="3" width="20" height="14"/>',
  },
  {
    label: 'Compass',
    svg: '<circle cx="12" cy="10" r="7" fill="#ffffff" stroke="#e6e6ea" stroke-width="1.5"/>'
      + '<path d="M12,4 L14.5,10 L9.5,10 Z" fill="#8C0B42"/>',
  },
  { label: 'Outline', svg: '<rect class="lg-outline" x="2" y="3" width="20" height="14"/>' },
];

const LEGEND_STYLE = `
  .lg-room  { fill: #eef1f4; stroke: #8f959c; stroke-width: 1.5; }
  .lg-big   { fill: #e6ecf5; stroke: #8f959c; stroke-width: 1.5; }
  .lg-selected { fill: #cfe0ff; stroke: #2f6feb; stroke-width: 1.5; }
  .lg-core  { fill: #dfe3e8; stroke: #8f959c; stroke-width: 1.5; }
  .lg-void  { fill: none; stroke: #b7bbc1; stroke-width: 1.5; stroke-dasharray: 3 2; }
  .lg-stair { stroke: #8f959c; stroke-width: 1.5; }
  .lg-door  { stroke: #ffffff; stroke-width: 4; filter: drop-shadow(0 0 0 #cfd3d8); }
  .lg-exit  { fill: #1a7f37; font-size: 7px; font-weight: 700; text-anchor: middle; }
  .lg-hall  { fill: #d7dbe0; }
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
  'lg-room': { fill: '#eef1f4', stroke: '#8f959c' },
  'lg-big': { fill: '#e6ecf5', stroke: '#8f959c' },
  'lg-selected': { fill: '#cfe0ff', stroke: '#2f6feb' },
  'lg-core': { fill: '#dfe3e8', stroke: '#8f959c' },
  'lg-void': { fill: 'none', stroke: '#b7bbc1' },
  'lg-hall': { fill: '#d7dbe0', stroke: '#d7dbe0' },
  'lg-outline': { fill: '#ffffff', stroke: '#3a3d42' },
};
function swatchFor(item) {
  const m = item.svg.match(/class="(lg-[a-z]+)"/);
  const key = m ? m[1] : 'lg-room';
  const style = SWATCH_FILLS[key] || { fill: '#eef1f4', stroke: '#8f959c' };
  if (item.label === 'Stairs') {
    return `<rect x="0" y="0" width="20" height="14" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.5"/>`
      + '<line x1="3" y1="4" x2="17" y2="4" stroke="#8f959c" stroke-width="1.5"/>'
      + '<line x1="3" y1="7" x2="17" y2="7" stroke="#8f959c" stroke-width="1.5"/>'
      + '<line x1="3" y1="10" x2="17" y2="10" stroke="#8f959c" stroke-width="1.5"/>';
  }
  if (item.label === 'Doors') {
    return '<line x1="0" y1="6" x2="20" y2="6" stroke="#ffffff" stroke-width="4"/>'
      + '<text x="10" y="14" fill="#1a7f37" font-size="7" font-weight="700" text-anchor="middle">EXIT</text>';
  }
  if (item.label === 'Compass') {
    return '<circle cx="10" cy="7" r="6" fill="#ffffff" stroke="#e6e6ea" stroke-width="1.5"/>'
      + '<path d="M10,2 L12,7 L8,7 Z" fill="#8C0B42"/>';
  }
  return `<rect x="0" y="0" width="20" height="14" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.5"/>`;
}
export function legendSvgGroup(viewBox) {
  const rowH = 24;
  const groupW = 190;
  const groupH = ITEMS.length * rowH + 16;
  const gx = Math.round(viewBox.x + viewBox.w - groupW - 20);
  const gy = Math.round(viewBox.y + viewBox.h - groupH - 20);
  const rows = ITEMS.map((item, i) => {
    const y = 12 + i * rowH;
    const label = item.caption ? `${item.label} (${item.caption})` : item.label;
    return `<g transform="translate(4,${y})">${swatchFor(item)}<text x="28" y="11" font-size="11" fill="#1d1f23" font-family="sans-serif">${label}</text></g>`;
  }).join('');
  return `<g class="legend" transform="translate(${gx},${gy})">`
    + `<rect x="0" y="0" width="${groupW}" height="${groupH}" fill="#ffffff" fill-opacity="0.92" stroke="#c7cad0" stroke-width="1"/>`
    + rows
    + '</g>';
}

export const LEGEND_NOTE = 'This legend is for preview only — it is never written into the exported SVG.';
