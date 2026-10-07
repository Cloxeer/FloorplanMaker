// mergeStage.js
// The last step of the several-photo flow: every flattened photo is shown side by side on one board, and you line
// them up into one floor. Drag a photo to move it (its edges and middle catch on the other photos' edges), the
// Size and Turn sliders (and quarter-turn buttons) match their scale and angle, "See through" lets the overlap
// show, arrow keys nudge the picked photo. Wheel zooms, dragging empty space pans.
// Then "Start tracing" keeps the photos as separate layers (they can still be moved later, View > Photo) and
// "AutoBuild" first joins them into one picture. The first photo is the plan's frame (it ends up unmoved).
// Depends on: js/model/photos.js (placement maths).

import { pixelsOf } from './autobuildMulti.js';
import { tOf, T0, photoCorners, hitPhoto, unionBox, moved, scaledBy, turnedBy, snapPhoto, layoutExtras, normalizeToMain } from '../../model/photos.js';

const NS = 'http://www.w3.org/2000/svg';
const STYLE = `
.ms-wrap { display:flex; flex-direction:column; gap:10px; width:100%; }
.ms-bar { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; justify-content:center; font-size:13px; }
.ms-chips { display:flex; gap:6px; }
.ms-chips button, .ms-bar button { font:inherit; padding:5px 12px; border-radius:999px; border:1px solid #c9ced6; background:#fff; color:#23272e; cursor:pointer; }
.ms-chips button[aria-pressed="true"], .ms-bar button[aria-pressed="true"] { background:#2f6feb; border-color:#2f6feb; color:#fff; }
.ms-bar label { display:flex; align-items:center; gap:6px; }
.ms-bar input[type=range] { width:130px; }
.ms-bar output { min-width:46px; font-variant-numeric:tabular-nums; color:#515154; }
.ms-view { position:relative; border:1px solid var(--border,#dfe3e8); border-radius:8px; background:#e9ebee; overflow:hidden; height:calc(100vh - 340px); min-height:320px; touch-action:none; }
.ms-view svg { width:100%; height:100%; display:block; cursor:grab; user-select:none; }
.ms-view svg.ms-drag { cursor:grabbing; }
.ms-tip { margin:0; font-size:12px; color:#6b7078; text-align:center; }
.ms-actions { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top:4px; }
.ms-actions button { font-size:16px; padding:11px 28px; }
.ms-actions .ms-back { background:none; border:0; color:var(--accent,#2f6feb); cursor:pointer; }
`;

const rad = (d) => (d * Math.PI) / 180;
const el = (name, attrs = {}) => { const n = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const signed = (a) => { const m = ((a % 360) + 360) % 360; return m > 180 ? m - 360 : m; };
const loadImage = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });

// Photos side by side, same height, each placed to the right of the one before. First = the frame.
export function sideBySide(photos) {
  const [main, ...rest] = photos.map((p) => { const { t, ...o } = p; void t; return o; });
  const gap = Math.max(40, (main.width || 1000) * 0.02);
  return [{ ...main, t: { ...T0 }, }, ...layoutExtras(main, rest, gap)];
}

export function mountMergeStage(host, { photos, layout, onBack, onTrace, onAutoBuild }) {
  if (!document.getElementById('ms-style')) { const st = document.createElement('style'); st.id = 'ms-style'; st.textContent = STYLE; document.head.appendChild(st); }
  // `layout`: placements kept from an earlier visit (same photos), so Back and forward does not undo the lining up
  let list = layout && layout.length === photos.length ? photos.map((p, i) => ({ ...p, t: layout[i] })) : sideBySide(photos);
  let sel = list.length > 1 ? 1 : 0, see = false, guides = [], destroyed = false, arranged = false; // arranged: the user moved / sized / turned something
  let vb = { x: 0, y: 0, w: 1000, h: 1000 };

  host.innerHTML = `
    <div class="ms-wrap">
      <div class="ms-bar">
        <div class="ms-chips" id="ms-chips" role="group" aria-label="Photos"></div>
        <label>Size <input type="range" id="ms-size" min="20" max="300" step="0.5"><output id="ms-size-out"></output></label>
        <label>Turn <input type="range" id="ms-turn" min="-180" max="180" step="0.1"><output id="ms-turn-out"></output></label>
        <button type="button" id="ms-turn-l" title="Turn this photo a quarter turn to the left">&#10226; Turn left</button>
        <button type="button" id="ms-turn-r" title="Turn this photo a quarter turn to the right">&#10227; Turn right</button>
        <button type="button" id="ms-see" aria-pressed="false" title="See through the photos, to check where they overlap">See through</button>
        <button type="button" id="ms-reset" title="Put the photos back side by side">Side by side</button>
        <button type="button" id="ms-fit">Fit</button>
      </div>
      <div class="ms-view"><svg id="ms-svg" xmlns="${NS}"></svg></div>
      <p class="ms-tip"><b>Quickest:</b> press AutoBuild; it joins the photos by the rooms and hallways they share. To line them up yourself, drag a photo (its edges catch on the others), use Turn / Size, and See through to check the overlap. Scroll zooms, dragging the background pans.</p>
      <div class="ms-actions">
        <button type="button" class="ms-back" id="ms-back">&larr; Back</button>
        <button type="button" id="ms-trace" title="Keep the photos as separate layers and trace the plan by hand">Start tracing by hand</button>
        <button type="button" class="btn-primary" id="ms-auto" title="Build every photo, join the plans where they share rooms or a hallway, and place the photos to match">AutoBuild</button>
      </div>
    </div>`;
  const $ = (s) => host.querySelector(s);
  const svg = $('#ms-svg');
  const layerImgs = el('g'), layerTop = el('g');
  svg.append(layerImgs, layerTop);
  const imgEls = list.map((p) => {
    const g = el('g'), im = el('image', { width: p.width, height: p.height, href: p.dataUrl });
    g.appendChild(im); layerImgs.appendChild(g);
    return { g, im };
  });

  const rect = () => svg.getBoundingClientRect();
  const pxs = () => vb.w / Math.max(1, rect().width); // plan units per screen pixel
  function toPlan(e) {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }
  function setVb() { svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); }
  function fit() {
    const b = unionBox(list), r = rect();
    const aspect = r.width > 10 && r.height > 10 ? r.width / r.height : 1.5;
    const w = Math.max(b.w * 1.15, b.h * 1.15 * aspect);
    vb = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - w / aspect / 2, w, h: w / aspect };
    setVb(); draw();
  }

  function draw() {
    if (destroyed) return;
    list.forEach((p, i) => {
      const t = tOf(p);
      imgEls[i].g.setAttribute('transform', `translate(${t.x} ${t.y}) rotate(${t.a}) scale(${t.s})`);
      imgEls[i].im.setAttribute('opacity', see ? '0.55' : '1');
    });
    layerTop.innerHTML = '';
    const u = pxs();
    list.forEach((p, i) => {
      const c = photoCorners(p), on = i === sel;
      layerTop.appendChild(el('polygon', { points: c.map((q) => q.join(',')).join(' '), fill: 'none', stroke: on ? '#2f6feb' : '#6b7078', 'stroke-width': on ? 3 : 1.5, 'stroke-dasharray': on ? '' : '6 4', 'vector-effect': 'non-scaling-stroke' }));
      const r = 13 * u;
      layerTop.appendChild(el('circle', { cx: c[0][0] + r * 1.4, cy: c[0][1] + r * 1.4, r, fill: on ? '#2f6feb' : '#6b7078' }));
      const tx = el('text', { x: c[0][0] + r * 1.4, y: c[0][1] + r * 1.4 + 5 * u, 'text-anchor': 'middle', fill: '#fff', 'font-size': 14 * u, 'font-weight': 700, 'font-family': 'sans-serif' });
      tx.textContent = String(i + 1);
      layerTop.appendChild(tx);
    });
    for (const g of guides) {
      layerTop.appendChild(g.axis === 'x'
        ? el('line', { x1: g.at, x2: g.at, y1: vb.y, y2: vb.y + vb.h, stroke: '#d6249f', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' })
        : el('line', { y1: g.at, y2: g.at, x1: vb.x, x2: vb.x + vb.w, stroke: '#d6249f', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
    }
    readouts();
  }

  function readouts() {
    const t = tOf(list[sel]);
    $('#ms-size').value = String(Math.round(t.s * 1000) / 10);
    $('#ms-size-out').textContent = `${Math.round(t.s * 100)}%`;
    $('#ms-turn').value = String(Math.round(signed(t.a) * 10) / 10);
    $('#ms-turn-out').textContent = `${signed(t.a).toFixed(1)}°`;
    $('#ms-see').setAttribute('aria-pressed', String(see));
    for (const id of ['#ms-size', '#ms-turn', '#ms-turn-l', '#ms-turn-r']) { $(id).disabled = sel === 0; $(id).title = sel === 0 ? 'Photo 1 is the frame of the plan: turn and size the other photos to match it' : ''; }
    host.querySelectorAll('#ms-chips button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === sel)));
  }
  const chips = $('#ms-chips');
  list.forEach((_, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = `Photo ${i + 1}`; b.dataset.i = String(i);
    b.addEventListener('click', () => { sel = i; draw(); });
    chips.appendChild(b);
  });

  // ---- sliders and buttons act on the picked photo
  const put = (next) => { arranged = true; list = list.map((p, i) => (i === sel ? next : p)); draw(); };
  $('#ms-size').addEventListener('input', (e) => { const v = parseFloat(e.target.value) / 100; if (v > 0) put(scaledBy(list[sel], v / tOf(list[sel]).s)); });
  $('#ms-turn').addEventListener('input', (e) => put(turnedBy(list[sel], parseFloat(e.target.value) - signed(tOf(list[sel]).a))));
  $('#ms-turn-l').addEventListener('click', () => put(turnedBy(list[sel], -90)));
  $('#ms-turn-r').addEventListener('click', () => put(turnedBy(list[sel], 90)));
  $('#ms-see').addEventListener('click', () => { see = !see; draw(); });
  $('#ms-reset').addEventListener('click', () => { arranged = false; list = sideBySide(list.map((p) => ({ ...p }))); fit(); });
  $('#ms-fit').addEventListener('click', fit);

  // ---- pointer: drag a photo, or pan the board; wheel zooms
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    const p = toPlan(e), hit = hitPhoto(list, p);
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('ms-drag');
    if (hit >= 0 && e.button === 0) { sel = hit; drag = { kind: 'photo', i: hit, start: p, orig: list[hit] }; }
    else drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vb: { ...vb } };
    draw();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const k = drag.vb.w / Math.max(1, rect().width);
      vb = { ...drag.vb, x: drag.vb.x - (e.clientX - drag.sx) * k, y: drag.vb.y - (e.clientY - drag.sy) * k };
      setVb(); draw();
      return;
    }
    const p = toPlan(e);
    const cand = moved(drag.orig, p[0] - drag.start[0], p[1] - drag.start[1]);
    const s = e.altKey ? { dx: 0, dy: 0, guides: [] } : snapPhoto(cand, list.filter((_, i) => i !== drag.i), 12 * pxs());
    guides = s.guides;
    arranged = true;
    list = list.map((q, i) => (i === drag.i ? moved(cand, s.dx, s.dy) : q));
    draw();
  });
  const end = () => { drag = null; guides = []; svg.classList.remove('ms-drag'); draw(); };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toPlan(e), f = Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.0015);
    vb = { x: p[0] - (p[0] - vb.x) * f, y: p[1] - (p[1] - vb.y) * f, w: vb.w * f, h: vb.h * f };
    setVb(); draw();
  }, { passive: false });

  function onKey(e) {
    if (host.offsetParent === null) return;
    if (e.key === 'Escape') { onBack(); return; }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const step = (e.shiftKey ? 10 : 1) * Math.max(1, Math.round(pxs()));
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    put(moved(list[sel], d[0], d[1]));
  }
  document.addEventListener('keydown', onKey);

  // ---- finish
  $('#ms-back').addEventListener('click', onBack);
  $('#ms-trace').addEventListener('click', () => {
    const out = normalizeToMain(list);
    const [main, ...extras] = out;
    onTrace(main, extras.map((e) => ({ dataUrl: e.dataUrl, width: e.width, height: e.height, t: e.t })));
  });
  $('#ms-auto').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget, label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Reading the photos…';
    try {
      // every photo is built on its own and the plans joined by what they share; the board is the fallback
      const out = normalizeToMain(list);
      const full = await Promise.all(out.map(async (p, i) => ({ pixels: await pixelsOf(p.dataUrl), photo: { dataUrl: p.dataUrl, width: p.width, height: p.height }, board: i ? { t: p.t } : null, orig: p })));
      full.arranged = arranged;
      if (!destroyed) await onAutoBuild(full);
    } finally { btn.disabled = false; btn.textContent = label; }
  });

  fit();
  window.addEventListener('resize', fit);
  return {
    list: () => list,
    layout: () => list.map((p) => ({ ...tOf(p) })),
    destroy() { destroyed = true; document.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit); host.innerHTML = ''; },
  };
}

// The photos drawn into ONE picture, where they sit on the board (at most 2400 px on the long side).
// -> { photo, pixels } ready for AutoBuild
export async function joinPhotos(list) {
  const b = unionBox(list), f = Math.min(1, 2400 / Math.max(b.w, b.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(b.w * f)); c.height = Math.max(1, Math.round(b.h * f));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  for (const p of list) {
    const im = await loadImage(p.dataUrl), t = tOf(p);
    ctx.save();
    ctx.setTransform(f, 0, 0, f, -b.x * f, -b.y * f);
    ctx.translate(t.x, t.y); ctx.rotate(rad(t.a)); ctx.scale(t.s, t.s);
    ctx.drawImage(im, 0, 0, p.width, p.height);
    ctx.restore();
  }
  const dataUrl = c.toDataURL('image/jpeg', 0.88);
  const px = ctx.getImageData(0, 0, c.width, c.height);
  return {
    photo: { dataUrl, width: c.width, height: c.height, corners: [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]], originalDataUrl: dataUrl },
    pixels: { width: c.width, height: c.height, data: px.data },
  };
}
