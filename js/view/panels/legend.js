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
  { label: 'Our room', svg: '<rect class="lg-ours" x="2" y="3" width="20" height="14"/>' },
  { label: 'Core', svg: '<rect class="lg-core" x="2" y="3" width="20" height="14"/>' },
  { label: 'Void', svg: '<rect class="lg-void" x="2" y="3" width="20" height="14"/>' },
  {
    label: 'Stairs',
    svg: '<rect class="lg-core" x="2" y="3" width="20" height="14"/>'
      + '<g class="lg-stair"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="13" x2="20" y2="13"/></g>',
  },
  {
    label: 'Door + EXIT',
    svg: '<line class="lg-door" x1="2" y1="9" x2="22" y2="9"/><text class="lg-exit" x="12" y="18">EXIT</text>',
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
  .lg-ours  { fill: #f5e3ea; stroke: #8f959c; stroke-width: 1.5; }
  .lg-core  { fill: #dfe3e8; stroke: #8f959c; stroke-width: 1.5; }
  .lg-void  { fill: none; stroke: #b7bbc1; stroke-width: 1.5; stroke-dasharray: 3 2; }
  .lg-stair { stroke: #8f959c; stroke-width: 1.5; }
  .lg-door  { stroke: #ffffff; stroke-width: 4; filter: drop-shadow(0 0 0 #cfd3d8); }
  .lg-exit  { fill: #1a7f37; font-size: 7px; font-weight: 700; text-anchor: middle; }
  .lg-outline { fill: #ffffff; stroke: #3a3d42; stroke-width: 2; }
`;

export function legendHtml(className = 'legend-list') {
  const rows = ITEMS.map((item) => `
    <li class="legend-row">
      <svg class="legend-swatch" viewBox="0 0 24 20" width="24" height="20" aria-hidden="true">
        <style>${LEGEND_STYLE}</style>
        ${item.svg}
      </svg>
      <span>${item.label}</span>
    </li>
  `).join('');
  return `<ul class="${className}">${rows}</ul>`;
}

export const LEGEND_NOTE = 'This legend is for preview only — it is never written into the exported SVG.';
