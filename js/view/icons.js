// icons.js — shared icon path data for core-room glyphs, used by the stage,
// the palette chips, the preview and the SVG export so all four match.
// Source files: assets/icons/elevator.svg, assets/icons/restroom.svg
// (user-supplied). Each icon is a single <path> on a 0 0 24 24 viewBox.
export const ICONS = {
  elevator: {
    viewBox: 24,
    d: 'm21 16-3-3h6zm0-8-3 3h6zm-12-8h-6c-1.654 0-3 1.346-3 3v21h9zm11 6.171v-3.171c0-1.654-1.346-3-3-3h-6v24h9v-6.171l-4-4v-3.657l4-4z',
  },
  restroom: {
    viewBox: 24,
    d: 'm16 18c0 1.608-2.065 4-5 4-.774 0-1.446.44-1.778 1.084-.277.536-.779.916-1.381.916h-3.34c-.828 0-1.5-.672-1.5-1.5v-13c0-.829.672-1.5 1.5-1.5s1.5.671 1.5 1.5v7.5h8.999c1 0 1 1 1 1zm.5-13c1.381 0 2.5-1.119 2.5-2.5s-1.119-2.5-2.5-2.5-2.5 1.119-2.5 2.5 1.119 2.5 2.5 2.5zm3.162 8.514c-.514-.357-1.143-.514-1.769-.514h-3.727s1.256-3.232 1.256-3.232l2.567 2.34c.611.557 1.559.516 2.119-.098.559-.612.515-1.561-.098-2.119l-4.641-4.231s-.011-.005-.016-.009c-.512-.475-1.23-.742-2.044-.623-.884.129-1.608.779-1.932 1.611l-2.122 5.457c-.453.976-.303 2.12.417 2.959.546.636 1.385.945 2.223.945.137-.001 6.102 0 6.102 0l-1.281 6.121c-.235.937.497 1.912 1.455 1.879.693 0 1.317-.485 1.466-1.191l1.296-6.148c.25-1.185-.218-2.416-1.273-3.148z',
  },
};

// Which icon a room shows, from its class + name (core rooms only).
export function iconForRoom(item) {
  if (item.cls !== 'core') return null;
  const n = (item.name || '').toLowerCase();
  if (n.includes('elevator') || n === 'elev' || n.includes('lift')) return 'elevator';
  if (n.includes('restroom') || n.includes('bathroom') || n.includes('toilet')) return 'restroom';
  return null;
}

// An SVG <g> that draws icon `key` centred in the box (bx,by,bw,bh), scaled to
// `frac` of the smaller side. Used by the exporter and the preview.
export function iconSvg(key, bx, by, bw, bh, frac = 0.5, fill = '#5f6368') {
  const ic = ICONS[key];
  if (!ic) return '';
  const size = Math.min(bw, bh) * frac;
  const s = size / ic.viewBox;
  const tx = bx + bw / 2 - size / 2;
  const ty = by + bh / 2 - size / 2;
  return `<g class="icon" transform="translate(${Math.round(tx)},${Math.round(ty)}) scale(${(Math.round(s * 1000) / 1000)})"><path d="${ic.d}" fill="${fill}"/></g>`;
}
