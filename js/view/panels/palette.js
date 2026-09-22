// palette.js
// Left palette: the four guided steps (outline, doors, hallways, rooms) plus
// draggable piece chips. Steps 2-4 stay disabled until a building outline
// exists. Drops are handed to the Fabric stage via app.canvas.dropPiece().
// Depends on: js/view/panels/paletteIcons.js, app.canvas (js/view/stage.js).

import { chipSvg, ghostSvg } from './paletteIcons.js';
import { setFloor, removeItems } from '../../model/document.js';
import { rectifyOutline } from '../rectify.js';

const PIECES = [
  { key: 'room', label: 'Room' },
  { key: 'big', label: 'Big room' },
  { key: 'ours', label: 'Our room' },
  { key: 'restroom', label: 'Restroom' },
  { key: 'elevator', label: 'Elevator' },
  { key: 'closet', label: 'Closet' },
  { key: 'stair', label: 'Stairs' },
  { key: 'void', label: 'Void' },
  { key: 'compass', label: 'Compass' },
];

const LOCKED_TITLE = 'Finish the previous step first';

export function mountPalette(el, app) {
  el.innerHTML = `
    <div class="palette-step" data-step="floor">
      <h4>1. Outline the building</h4>
      <p class="step-desc">Trace the outer walls once, from the photo.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-floor">Draw outline <span class="hotkey-hint">F</span></button>
      <button type="button" class="btn-big-tool" id="btn-straighten" hidden>Straighten lines</button>
    </div>
    <div class="palette-step" data-step="door">
      <h4>2. Add doors and stairs</h4>
      <p class="step-desc">Click a spot along the outline for each door.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-door">Place doors <span class="hotkey-hint">O</span></button>
      <button type="button" class="btn-big-tool" id="btn-tool-stair">Place stairs <span class="hotkey-hint">S</span></button>
      <button type="button" class="btn-big-tool btn-detect" id="btn-detect-doors">⌕ Detect doors and stairs</button>
    </div>
    <div class="palette-step" data-step="hall">
      <h4>3. Add hallways</h4>
      <p class="step-desc">Guides only &mdash; hallways are never exported.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-hall">Draw a hallway <span class="hotkey-hint">A</span></button>
      <button type="button" class="btn-big-tool btn-detect" id="btn-detect-halls">⌕ Detect hallways</button>
    </div>
    <div class="palette-step" data-step="room">
      <h4>4. Add rooms</h4>
      <p class="step-desc">Draw a room, or drag a piece onto the plan.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-room">Draw a room <span class="hotkey-hint">R</span></button>
      <div id="chip-row"></div>
      <button type="button" class="btn-big-tool btn-detect" id="btn-detect-rooms">⌕ Detect rooms</button>
      <button type="button" class="btn-big-tool" id="btn-tool-authwall">Staff wall</button>
    </div>
  `;

  const chipRow = el.querySelector('#chip-row');
  const toolButtons = {
    floor: el.querySelector('#btn-tool-floor'),
    door: el.querySelector('#btn-tool-door'),
    stair: el.querySelector('#btn-tool-stair'),
    hall: el.querySelector('#btn-tool-hall'),
    room: el.querySelector('#btn-tool-room'),
    authwall: el.querySelector('#btn-tool-authwall'),
  };
  async function toggleTool(name, pieceKey) {
    if (name === 'room') app.pendingRoomPiece = pieceKey || 'room';
    if (name === 'floor' && hasFloor()) {
      const ok = await app.confirm('Redraw the outline? The current outline and its doors will be removed.');
      if (!ok) return;
      const doorIds = app.doc.items.filter((it) => it.type === 'door').map((it) => it.id);
      app.commit(setFloor(removeItems(app.doc, doorIds), null), 'Redraw outline');
      app.setTool('floor');
      return;
    }
    if (app.toolName === name && (name !== 'room' || app.pendingRoomPiece === (pieceKey || 'room'))) {
      app.setTool('select');
    } else {
      app.setTool(name);
    }
  }

  Object.entries(toolButtons).forEach(([name, btn]) => {
    if (btn) btn.addEventListener('click', () => toggleTool(name));
  });

  const detectDoorsBtn = el.querySelector('#btn-detect-doors');
  const detectHallsBtn = el.querySelector('#btn-detect-halls');
  const detectRoomsBtn = el.querySelector('#btn-detect-rooms');
  if (detectDoorsBtn) {
    detectDoorsBtn.addEventListener('click', () => {
      if (app.suggest && typeof app.suggest.runStairs === 'function') app.suggest.runStairs();
    });
  }
  if (detectHallsBtn) {
    detectHallsBtn.addEventListener('click', () => {
      if (app.suggest && typeof app.suggest.runHalls === 'function') app.suggest.runHalls();
    });
  }
  if (detectRoomsBtn) {
    detectRoomsBtn.addEventListener('click', () => {
      if (app.suggest && typeof app.suggest.run === 'function') app.suggest.run();
    });
  }

  const straightenBtn = el.querySelector('#btn-straighten');
  if (straightenBtn) {
    straightenBtn.addEventListener('click', () => {
      if (!hasFloor()) return;
      const pts = rectifyOutline(app.doc.floor.points);
      app.commit(setFloor(app.doc, pts), 'Straighten lines');
    });
  }

  PIECES.forEach((piece) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.piece = piece.key;
    chip.innerHTML = `<span class="chip-preview">${chipSvg(piece.key)}</span><span class="chip-label">${piece.label}</span>`;
    chipRow.appendChild(chip);
  });

  function hasFloor() {
    const doc = app.doc;
    return !!(doc && doc.floor && doc.floor.points && doc.floor.points.length >= 3);
  }
  function hasDoorOrStair() {
    const doc = app.doc;
    return !!(doc && doc.items && doc.items.some((it) => it.type === 'door' || it.type === 'stair'));
  }
  function hasHall() {
    const doc = app.doc;
    return !!(doc && doc.items && doc.items.some((it) => it.type === 'hall'));
  }

  const STEP_UNLOCKED = {
    floor: () => true,
    door: hasFloor,
    stair: hasFloor,
    hall: hasDoorOrStair,
    room: hasHall,
    authwall: hasHall,
  };

  function refresh() {
    Object.entries(toolButtons).forEach(([name, btn]) => {
      if (!btn) return;
      btn.setAttribute('aria-pressed', String(name === app.toolName));
      const locked = !STEP_UNLOCKED[name]();
      btn.disabled = locked;
      btn.title = locked ? LOCKED_TITLE : '';
    });
    if (toolButtons.floor) {
      toolButtons.floor.innerHTML = hasFloor()
        ? 'Redraw the outline <span class="hotkey-hint">F</span>'
        : 'Draw outline <span class="hotkey-hint">F</span>';
    }
    if (straightenBtn) straightenBtn.hidden = !hasFloor();
    if (detectDoorsBtn) detectDoorsBtn.disabled = !STEP_UNLOCKED.door();
    if (detectHallsBtn) detectHallsBtn.disabled = !STEP_UNLOCKED.hall();
    if (detectRoomsBtn) detectRoomsBtn.disabled = !STEP_UNLOCKED.room();
    el.querySelectorAll('.palette-step').forEach((step) => {
      const name = step.dataset.step;
      const locked = !STEP_UNLOCKED[name]();
      step.classList.toggle('locked', locked);
      step.title = locked ? LOCKED_TITLE : '';
    });
    const roomsUnlocked = STEP_UNLOCKED.room();
    chipRow.querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('disabled', !roomsUnlocked);
      const key = chip.dataset.piece;
      const toolMatch = app.toolName === chipToolName(key);
      const active = toolMatch && (chipToolName(key) !== 'room' || app.pendingRoomPiece === key);
      chip.classList.toggle('active', active);
    });
  }
  refresh();

  // --- drag handling ---
  let dragGhost = null;
  let dragging = false;
  let dragStart = null;

  function getZoom() {
    const view = app.canvas && app.canvas.getView ? app.canvas.getView() : null;
    return view && view.zoom ? view.zoom : 1;
  }
  function makeGhost(piece, x, y) {
    const { svg, w, h } = ghostSvg(piece.key, getZoom());
    const g = document.createElement('div');
    g.style.cssText = `position:fixed; left:${x}px; top:${y}px; width:${w}px; height:${h}px;
      opacity:0.85; pointer-events:none; z-index:200; transform:translate(-50%,-50%);`;
    g.innerHTML = svg;
    const svgEl = g.querySelector('svg');
    if (svgEl) { svgEl.style.width = '100%'; svgEl.style.height = '100%'; }
    document.body.appendChild(g);
    return g;
  }
  function drop(piece, clientX, clientY) {
    if (!app.canvas || !app.canvas.dropPiece) return;
    app.canvas.dropPiece(piece.key, clientX, clientY);
  }
  function chipToolName(key) {
    if (key === 'hall' || key === 'stair' || key === 'compass') return key;
    return 'room';
  }

  function onPointerDown(e) {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (!STEP_UNLOCKED.room()) return;
    const piece = PIECES.find((p) => p.key === chip.dataset.piece);
    if (!piece) return;
    dragStart = { x: e.clientX, y: e.clientY };
    dragging = false;
    chip.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const d = Math.hypot(ev.clientX - dragStart.x, ev.clientY - dragStart.y);
      if (!dragging && d > 5) {
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
      const stage = document.getElementById('stage');
      const rect = stage ? stage.getBoundingClientRect() : null;
      const inside = rect && ev.clientX >= rect.left && ev.clientX <= rect.right
        && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
      if (dragging && inside) drop(piece, ev.clientX, ev.clientY);
      else if (!dragging) {
        toggleTool(chipToolName(piece.key), piece.key);
      }
      dragging = false;
    };
    chip.addEventListener('pointermove', onMove);
    chip.addEventListener('pointerup', onUp);
    chip.addEventListener('pointercancel', onUp);
  }

  chipRow.addEventListener('pointerdown', onPointerDown);
  const unsub = app.subscribe((evt) => {
    if (evt.type === 'tool' || evt.type === 'doc' || evt.type === 'project') refresh();
  });

  return {
    update: refresh,
    destroy() {
      chipRow.removeEventListener('pointerdown', onPointerDown);
      unsub();
      el.innerHTML = '';
    },
  };
}
