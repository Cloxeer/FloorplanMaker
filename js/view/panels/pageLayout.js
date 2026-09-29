// pageLayout.js
// On a paper page (Letter / A4) in the Preview: an invisible square around the
// whole drawing (plan, compass, legend) that the user drags to move it on the
// sheet and pulls by a corner to make it bigger or smaller. Resizing is
// uniform — the drawing's proportions never change. Only the preview shows
// the square; it's never in the downloaded file.
//
// The box doesn't move shapes: it reports a new { fx, fy, scale } and the
// Preview turns that into the page's viewBox (js/model/pageFit.js).
// Depends on: nothing (SVG DOM).

const NS = 'http://www.w3.org/2000/svg';
const CORNERS = [['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]];

export function createLayoutBox(svgEl, { onChange, onEnd }) {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'layout-box');
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('class', 'layout-box-rect');
  g.appendChild(rect);
  const hint = document.createElementNS(NS, 'text');
  hint.setAttribute('class', 'layout-box-hint');
  hint.textContent = 'Drag to move · drag a corner to resize';
  g.appendChild(hint);
  const handles = CORNERS.map(([name]) => {
    const h = document.createElementNS(NS, 'rect');
    h.setAttribute('class', `layout-box-handle layout-box-${name}`);
    g.appendChild(h);
    return h;
  });

  let frame = null;
  let drag = null;
  let raf = 0;
  let pending = null;

  function sheetRect() { return svgEl.getBoundingClientRect(); }

  function render(f) {
    frame = f;
    if (!f || !f.content) { hide(); return; }
    if (svgEl.lastChild !== g) svgEl.appendChild(g); // stay above the legend
    g.style.display = '';
    const r = sheetRect();
    const upx = r.width > 0 ? f.w / r.width : 1; // plan units per screen pixel
    const pad = 6 * upx;
    const x = f.content.x - pad;
    const y = f.content.y - pad;
    const w = f.content.w + pad * 2;
    const h = f.content.h + pad * 2;
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('stroke-width', 1.5 * upx);
    rect.setAttribute('stroke-dasharray', `${6 * upx} ${4 * upx}`);
    const hs = 12 * upx;
    CORNERS.forEach(([, cx, cy], i) => {
      handles[i].setAttribute('x', x + cx * w - hs / 2);
      handles[i].setAttribute('y', y + cy * h - hs / 2);
      handles[i].setAttribute('width', hs);
      handles[i].setAttribute('height', hs);
      handles[i].setAttribute('stroke-width', 1.5 * upx);
    });
    hint.setAttribute('x', x);
    hint.setAttribute('y', y - 8 * upx);
    hint.setAttribute('font-size', 12 * upx);
    // The hint needs a little room above the box; hide it when it'd be clipped.
    hint.style.display = y - 20 * upx > f.y ? '' : 'none';
  }
  function hide() {
    g.style.display = 'none';
  }

  function flush() {
    raf = 0;
    if (pending) { onChange(pending); pending = null; }
  }
  function emit(layout) {
    pending = layout;
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function start(evt, mode) {
    if (!frame) return;
    evt.preventDefault();
    evt.stopPropagation();
    const r = sheetRect();
    drag = {
      mode,
      id: evt.pointerId,
      x0: evt.clientX,
      y0: evt.clientY,
      fx: frame.fx,
      fy: frame.fy,
      scale: frame.scale,
      sheetW: r.width,
      sheetH: r.height,
      // Screen position of the drawing's center, which stays put while resizing.
      cx: r.left + frame.fx * r.width,
      cy: r.top + frame.fy * r.height,
    };
    drag.d0 = Math.max(8, Math.hypot(evt.clientX - drag.cx, evt.clientY - drag.cy));
    evt.target.setPointerCapture(evt.pointerId);
    g.classList.add('is-dragging');
  }
  function move(evt) {
    if (!drag || evt.pointerId !== drag.id) return;
    if (drag.mode === 'move') {
      emit({
        fx: drag.fx + (evt.clientX - drag.x0) / drag.sheetW,
        fy: drag.fy + (evt.clientY - drag.y0) / drag.sheetH,
        scale: drag.scale,
      });
    } else {
      const d = Math.hypot(evt.clientX - drag.cx, evt.clientY - drag.cy);
      emit({ fx: drag.fx, fy: drag.fy, scale: drag.scale * (d / drag.d0) });
    }
  }
  function end(evt) {
    if (!drag || evt.pointerId !== drag.id) return;
    drag = null;
    g.classList.remove('is-dragging');
    if (raf) { cancelAnimationFrame(raf); flush(); }
    if (onEnd) onEnd();
  }

  rect.addEventListener('pointerdown', (e) => start(e, 'move'));
  handles.forEach((h) => h.addEventListener('pointerdown', (e) => start(e, 'resize')));
  for (const el of [rect, ...handles]) {
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  hide();
  return { render, hide, isDragging: () => !!drag };
}
