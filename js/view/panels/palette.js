// palette.js
// Left palette: tool buttons + draggable piece chips. Drag with Pointer
// Events (ghost div follows pointer); drop on #stage places the item.
// A plain click on a chip places it at the center of the current view.
// Depends on: js/model/document.js (STD, makeRoom, newId).

import { STD, makeRoom, newId, NUMBERED_CLASSES } from '../../model/document.js';
import { chipSvg, ghostSvg } from './paletteIcons.js';

// Pieces shown as draggable chips in section 2 ("Add rooms"). Stairs and
// compass are covered here rather than via dedicated tool buttons.
const PIECES = [
  { key: 'room', label: 'Room', cls: 'room' },
  { key: 'big', label: 'Big room', cls: 'big' },
  { key: 'ours', label: 'Our room', cls: 'ours' },
  { key: 'restroom', label: 'Restroom', cls: 'core' },
  { key: 'elevator', label: 'Elevator', cls: 'core' },
  { key: 'stair', label: 'Stairs', cls: null },
  { key: 'void', label: 'Void', cls: 'void' },
  { key: 'compass', label: 'Compass', cls: null },
];

export function mountPalette(el, app) {
  el.innerHTML = `
    <div class="palette-step">
      <h4>1. Outline the building</h4>
      <p class="step-desc">Trace the outer walls once, from the photo.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-floor">Draw outline <span class="hotkey-hint">F</span></button>
    </div>
    <div class="palette-step">
      <h4>2. Add rooms</h4>
      <p class="step-desc">Draw a room, or drag a piece onto the plan.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-room">Draw a room <span class="hotkey-hint">R</span></button>
      <div id="chip-row"></div>
    </div>
    <div class="palette-step">
      <h4>3. Add doors</h4>
      <p class="step-desc">Click a spot along the outline for each door.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-door">Place doors <span class="hotkey-hint">O</span></button>
    </div>
  `;

  const chipRow = el.querySelector('#chip-row');
  const toolButtons = {
    floor: el.querySelector('#btn-tool-floor'),
    room: el.querySelector('#btn-tool-room'),
    door: el.querySelector('#btn-tool-door'),
  };
  Object.entries(toolButtons).forEach(([name, btn]) => {
    if (btn) btn.addEventListener('click', () => app.setTool(name));
  });

  function refreshToolButtons() {
    Object.entries(toolButtons).forEach(([name, btn]) => {
      if (btn) btn.setAttribute('aria-pressed', String(name === app.toolName));
    });
  }
  refreshToolButtons();

  PIECES.forEach((piece) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.piece = piece.key;
    chip.innerHTML = `<span class="chip-preview">${chipSvg(piece.key)}</span><span class="chip-label">${piece.label}</span>`;
    chipRow.appendChild(chip);
  });

  // --- drag handling ---
  let dragGhost = null;
  let dragPiece = null;
  let dragStart = null;
  let dragging = false;

  function startDrag(piece, e) {
    dragPiece = piece;
    dragStart = { x: e.clientX, y: e.clientY };
    dragging = false;
  }

  function getZoom() {
    const stage = document.getElementById('stage');
    const canvas = app.canvas;
    if (!stage || !canvas || typeof canvas.getView !== 'function') return 1;
    const view = canvas.getView();
    const rect = stage.getBoundingClientRect();
    return view && view.w ? rect.width / view.w : 1;
  }

  function makeGhost(piece, x, y) {
    const zoom = getZoom();
    const { svg, w, h } = ghostSvg(piece.key, zoom);
    const g = document.createElement('div');
    g.style.cssText = `position:fixed; left:${x}px; top:${y}px; width:${w}px; height:${h}px;
      opacity:0.85; pointer-events:none; z-index:200; transform:translate(-50%,-50%);`;
    g.innerHTML = svg;
    const svgEl = g.querySelector('svg');
    if (svgEl) { svgEl.style.width = '100%'; svgEl.style.height = '100%'; }
    document.body.appendChild(g);
    return g;
  }

  async function placePiece(piece, clientX, clientY) {
    const canvas = app.canvas;
    const stage = document.getElementById('stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return; // dropped outside the stage
    }
    const pt = canvas.toPlan(clientX, clientY);
    await dropPieceAt(piece, pt);
  }

  async function dropPieceAt(piece, pt) {
    const canvas = app.canvas;
    if (piece.key === 'door') {
      app.setTool('door');
      app.toast('Now click on the outside wall');
      return;
    }
    if (piece.key === 'compass') {
      const snapped = app.snap(pt);
      const compassItem = { id: newId(), type: 'compass', x: Math.round(snapped.x), y: Math.round(snapped.y), deg: 0 };
      const withoutOldCompass = { ...app.doc, items: app.doc.items.filter((it) => it.type !== 'compass') };
      app.commit({ ...withoutOldCompass, items: [...withoutOldCompass.items, compassItem] }, 'Place compass');
      return;
    }
    if (piece.key === 'stair') {
      const std = STD.palette.stair;
      const snapped = app.snap({ x: pt.x - std.w / 2, y: pt.y - std.h / 2 });
      const stairItem = { id: newId(), type: 'stair', x: Math.round(snapped.x), y: Math.round(snapped.y), w: std.w, h: std.h, dir: 'v' };
      app.commit({ ...app.doc, items: [...app.doc.items, stairItem] }, 'Place stair');
      return;
    }
    const std = STD.palette[piece.key];
    if (!std) return;
    const snapped = app.snap({ x: pt.x - std.w / 2, y: pt.y - std.h / 2 });

    if (piece.key === 'void') {
      const item = makeRoom('void', snapped.x, snapped.y, std.w, std.h, '');
      app.commit({ ...app.doc, items: [...app.doc.items, item] }, 'Place void');
      return;
    }

    let number = '';
    if (NUMBERED_CLASSES.has(std.cls)) {
      const value = await app.prompt('Room number', '', { validate: 'roomNumber' });
      if (value === null) return;
      number = value;
    }
    const item = makeRoom(std.cls, snapped.x, snapped.y, std.w, std.h, number);
    if (std.name) {
      item.name = std.name;
      item.showName = true;
    }
    app.commit({ ...app.doc, items: [...app.doc.items, item] }, 'Place room');
  }

  function centerOfView() {
    const canvas = app.canvas;
    if (canvas && typeof canvas.getView === 'function') {
      const view = canvas.getView();
      const stage = document.getElementById('stage');
      const rect = stage ? stage.getBoundingClientRect() : { width: 800, height: 600 };
      return canvas.toPlan(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    return { x: 0, y: 0 };
  }

  function onPointerDown(e) {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const piece = PIECES.find((p) => p.key === chip.dataset.piece);
    if (!piece) return;
    startDrag(piece, e);
    chip.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const dx = ev.clientX - dragStart.x;
      const dy = ev.clientY - dragStart.y;
      if (!dragging && Math.hypot(dx, dy) > 5) {
        dragging = true;
        dragGhost = makeGhost(piece, ev.clientX, ev.clientY);
      }
      if (dragging && dragGhost) {
        dragGhost.style.left = `${ev.clientX}px`;
        dragGhost.style.top = `${ev.clientY}px`;
      }
    };
    const onUp = (ev) => {
      chip.removeEventListener('pointermove', onMove);
      chip.removeEventListener('pointerup', onUp);
      chip.removeEventListener('pointercancel', onUp);
      if (dragGhost) { dragGhost.remove(); dragGhost = null; }
      if (dragging) {
        placePiece(piece, ev.clientX, ev.clientY);
      } else {
        // plain click: place at center of view
        dropPieceAt(piece, centerOfView());
      }
      dragging = false;
      dragPiece = null;
    };
    chip.addEventListener('pointermove', onMove);
    chip.addEventListener('pointerup', onUp);
    chip.addEventListener('pointercancel', onUp);
  }

  chipRow.addEventListener('pointerdown', onPointerDown);

  const unsub = app.subscribe((evt) => {
    if (evt.type === 'tool') refreshToolButtons();
  });

  return {
    update() { refreshToolButtons(); },
    destroy() {
      chipRow.removeEventListener('pointerdown', onPointerDown);
      unsub();
      el.innerHTML = '';
    },
  };
}
