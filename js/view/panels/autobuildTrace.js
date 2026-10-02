// autobuildTrace.js
// The first, slow stage of the AutoBuild reveal: the outline is drawn around the building as a pen line
// (solid dark where a wall stands in the photo, dashed orange where there is none), then a card asks
// "Is the outline right?" and waits. Drawn on the stage canvas after each render (like view/attention.js),
// so it never touches the document, selection, undo or export.
// Depends on: app.canvas.fabricCanvas, the .ab-overlay / .ab-card styles of panels/autobuild.js.

const STYLE = `
.ab-confirm h3 { margin:0 0 6px; font-size:16px; }
.ab-confirm p { margin:0 0 10px; color:#444b55; }
.ab-confirm .ab-note { color:#8a4a00; font-size:12px; margin:-4px 0 10px; }
.ab-btns { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.ab-btns button { font:inherit; padding:7px 12px; border-radius:8px; border:1px solid #c9ced6; background:#fff; color:#23272e; cursor:pointer; }
.ab-btns button.ab-primary { background:#2f6feb; border-color:#2f6feb; color:#fff; font-weight:600; }
.ab-btns .ab-link { border:0; background:none; color:#6b7078; text-decoration:underline; padding:7px 4px; margin-left:auto; }
.ab-stages { display:flex; flex-wrap:wrap; gap:4px 10px; list-style:none; margin:8px 0 0; padding:0; font-size:11.5px; color:#98a0ab; }
.ab-stages li.on { color:#2f6feb; font-weight:600; }
.ab-stages li.done { color:#2e8b57; }
.ab-stages li.done::after { content:" \\2713"; }
.ab-skip { all:unset; cursor:pointer; color:#2f6feb; font-size:12px; text-decoration:underline; }
`;

export function ensureTraceStyle() {
  if (document.getElementById('ab-style2')) return;
  const el = document.createElement('style');
  el.id = 'ab-style2';
  el.textContent = STYLE;
  document.head.appendChild(el);
}

const INK = '#1b2230', ORANGE = '#ff6a1a';
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Pen-line overlay. animate(segments, ms) resolves when the whole outline is drawn (or skip() was called).
export function createOutlineTrace(app) {
  const canvas = app.canvas && app.canvas.fabricCanvas;
  let segs = [], total = 0, frac = 0, on = false, raf = 0, done = null;
  const render = () => { try { if (canvas) canvas.requestRenderAll(); } catch (e) { /* canvas gone */ } };

  function draw(opt) {
    try {
      if (!on || !segs.length || !canvas || !canvas.viewportTransform) return;
      const ctx = (opt && opt.ctx) || canvas.getContext();
      const vt = canvas.viewportTransform, r = canvas.getRetinaScaling ? canvas.getRetinaScaling() : 1;
      const px = 1 / (canvas.getZoom() || 1);
      ctx.save();
      ctx.setTransform(r * vt[0], r * vt[1], r * vt[2], r * vt[3], r * vt[4], r * vt[5]);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      let left = frac * total, head = null;
      for (const s of segs) {
        if (left <= 0) break;
        const f = Math.min(1, left / Math.max(1e-6, s.len));
        left -= s.len;
        const ex = s.a[0] + (s.b[0] - s.a[0]) * f, ey = s.a[1] + (s.b[1] - s.a[1]) * f;
        head = [ex, ey];
        ctx.beginPath(); ctx.moveTo(s.a[0], s.a[1]); ctx.lineTo(ex, ey);
        ctx.setLineDash([]); ctx.globalAlpha = 0.85; ctx.strokeStyle = '#fff'; ctx.lineWidth = 7 * px; ctx.stroke();
        ctx.globalAlpha = 1;
        if (s.kind === 'gap') { ctx.setLineDash([9 * px, 6 * px]); ctx.strokeStyle = ORANGE; } else { ctx.setLineDash([]); ctx.strokeStyle = INK; }
        ctx.lineWidth = 3.5 * px; ctx.stroke();
      }
      if (head && frac < 1) { ctx.setLineDash([]); ctx.beginPath(); ctx.arc(head[0], head[1], 6 * px, 0, Math.PI * 2); ctx.fillStyle = ORANGE; ctx.fill(); }
      ctx.restore();
    } catch (e) { /* nothing to draw on */ }
  }
  if (canvas) canvas.on('after:render', draw);

  const load = (list) => {
    segs = list.map((s) => ({ ...s, len: Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) })).filter((s) => s.len > 0);
    total = segs.reduce((t, s) => t + s.len, 0);
  };
  const finish = () => { cancelAnimationFrame(raf); raf = 0; frac = 1; render(); if (done) { const d = done; done = null; d(); } };

  return {
    animate(list, ms) {
      load(list); on = true; frac = 0; render();
      return new Promise((resolve) => {
        done = resolve;
        const t0 = performance.now();
        const step = (now) => {
          frac = ease(Math.min(1, (now - t0) / ms));
          render();
          if (frac >= 1) finish(); else raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    },
    show(list) { load(list); on = true; frac = 1; render(); },
    skip() { if (done) finish(); },
    hide() { on = false; if (raf) cancelAnimationFrame(raf); raf = 0; done = null; render(); },
    destroy() { this.hide(); try { if (canvas) canvas.off('after:render', draw); } catch (e) { /* disposed */ } },
  };
}

// The confirmation card -> { promise, close(v) }. The promise resolves 'continue' | 'fix' | 'cancel'; Enter continues, Esc = fix it myself.
export function askOutline(overlay, info) {
  const gaps = (info.segments || []).filter((s) => s.kind === 'gap');
  const text = gaps.length
    ? 'AutoBuild traced the outer wall it could see. Orange dashed sections have no wall in the photo: check them.'
    : 'AutoBuild followed the wall all the way round.';
  const card = document.createElement('div');
  card.className = 'ab-card ab-confirm';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Is the outline right?');
  card.innerHTML = `<h3>Is the outline right?</h3><p class="ab-text"></p>
    <p class="ab-note" hidden></p>
    <div class="ab-btns"><button type="button" class="ab-primary ab-ok">Looks right, continue</button>
    <button type="button" class="ab-fix">I'll fix it myself</button>
    <button type="button" class="ab-link ab-cancel2">Cancel</button></div>`;
  card.querySelector('.ab-text').textContent = text;
  const note = card.querySelector('.ab-note');
  if (gaps.length && info.notes && info.notes[0]) { note.textContent = info.notes[0]; note.hidden = false; }
  overlay.appendChild(card);
  let close = () => {};
  const promise = new Promise((resolve) => {
    const finish = (v) => { document.removeEventListener('keydown', onKey, true); card.remove(); resolve(v); };
    close = finish;
    const onKey = (e) => {
      const onOtherButton = e.target && e.target.tagName === 'BUTTON' && !e.target.classList.contains('ab-ok');
      if (e.key === 'Enter' && !onOtherButton) { e.preventDefault(); e.stopImmediatePropagation(); finish('continue'); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish('fix'); }
    };
    document.addEventListener('keydown', onKey, true);
    card.querySelector('.ab-ok').addEventListener('click', () => finish('continue'));
    card.querySelector('.ab-fix').addEventListener('click', () => finish('fix'));
    card.querySelector('.ab-cancel2').addEventListener('click', () => finish('cancel'));
    card.querySelector('.ab-ok').focus();
  });
  return { promise, close: (v) => close(v) };
}
