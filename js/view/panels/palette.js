// palette.js
// Left palette: the four guided steps (outline, doors, hallways, rooms) plus
// draggable piece chips. Steps 2-4 stay disabled until a building outline
// exists. Drops are handed to the Fabric stage via app.canvas.dropPiece().
// Depends on: js/view/panels/paletteIcons.js, app.canvas (js/view/stage.js).

import { chipSvg, ghostSvg } from './paletteIcons.js';
import { setFloor, removeItems, findLegend } from '../../model/document.js';
import { straightenOutline } from '../rectify.js';
import { autoOutline } from '../../model/outlineRestore.js';
import {
  hasPieces, outlinesOf, pieceOutlines, linksOf, linkState, mergeReady, mergeOutlines, nextColor, LINK_COLORS, COLOR_NAMES,
} from '../../model/connect.js';

const PIECES = [
  { key: 'room', label: 'Room' },
  { key: 'ours', label: 'Our room' },
  { key: 'restroom', label: 'Restroom' },
  { key: 'elevator', label: 'Elevator' },
  { key: 'closet', label: 'Closet' },
  { key: 'stair', label: 'Stairs' },
  { key: 'void', label: 'Void' },
  { key: 'compass', label: 'Compass' },
  { key: 'legend', label: 'Legend' },
];
const ONE_LEGEND_TITLE = 'This plan already has a legend. Select it and press Delete to remove it.';

const LOCKED_TITLE = 'Finish the previous step first';

export function mountPalette(el, app) {
  el.innerHTML = `
    <div class="palette-step" data-step="floor">
      <h4>1. Outline the building</h4>
      <p class="step-desc">Trace the outer walls once, from the photo.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-floor">Draw outline <span class="hotkey-hint">F</span></button>
      <button type="button" class="btn-big-tool" id="btn-auto-outline" hidden title="Draw the outline round the rooms, halls and stairs that are on the plan">Auto-outline</button>
      <button type="button" class="btn-big-tool" id="btn-straighten" hidden>Straighten lines</button>
      <div class="connect-section" id="connect-section" hidden>
        <h5>Connect hallways</h5>
        <p class="step-desc">Mark a point on a wall of each building, then draw the hallway between them with the hallway tool.</p>
        <div id="link-list"></div>
        <button type="button" class="btn-big-tool" id="btn-add-link">Add a connection</button>
        <button type="button" class="btn-big-tool" id="btn-merge">Merge into one outline</button>
        <p class="step-desc" id="merge-hint"></p>
      </div>
    </div>
    <div class="palette-step" data-step="door">
      <h4>2. Add doors and stairs</h4>
      <p class="step-desc">Click the outline for a doorway, or drag along it to size the opening.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-door">Place doors <span class="hotkey-hint">O</span></button>
      <button type="button" class="btn-big-tool" id="btn-tool-stair">Place stairs <span class="hotkey-hint">S</span></button>
      <button type="button" class="btn-big-tool btn-detect" id="btn-detect-doors">⌕ Detect doors and stairs</button>
    </div>
    <div class="palette-step" data-step="hall">
      <h4>3. Add hallways</h4>
      <p class="step-desc">Drawn on the exported plan as grey corridors, just like here.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-hall">Draw a hallway <span class="hotkey-hint">A</span></button>
      <button type="button" class="btn-big-tool btn-detect" id="btn-detect-halls">⌕ Detect hallways</button>
      <button type="button" class="btn-big-tool" id="btn-tool-authwall" aria-pressed="false">Staff wall</button>
    </div>
    <div class="palette-step" data-step="room">
      <h4>4. Add rooms</h4>
      <p class="step-desc">Draw a room, or drag a piece onto the plan.</p>
      <button type="button" class="btn-big-tool" id="btn-tool-room">Draw a room <span class="hotkey-hint">R</span></button>
      <div id="chip-row"></div>
      <button type="button" class="btn-big-tool btn-detect" id="btn-detect-rooms">⌕ Detect rooms</button>
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

  // an outline drawn round what is on the plan (undoable). Doors are left where they are: any that are no longer on the outline are flagged by the checks, not moved.
  const autoBtn = el.querySelector('#btn-auto-outline');
  const hasPlan = () => (app.doc.items || []).some((it) => it.type === 'room' || it.type === 'hall' || it.type === 'stair');
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      autoBtn.blur();
      if (piecesMode()) { autoOutlinePieces(); return; }
      const r = autoOutline(app.doc);
      if (!r) { app.toast('Add a room first, or draw the outline by hand.'); return; }
      app.commit(setFloor(app.doc, r.points), 'Auto-outline');
      if (app.setSelection) app.setSelection(['floor']);
      app.toast('Drew the outline around your rooms. Use Edit outline to fine-tune it (Undo puts the old one back).');
    });
  }

  // A floor built from several photos is outlined building by building: one outline item per piece, never bridged.
  const piecesMode = () => hasPieces(app.doc) && !hasFloor();
  function autoOutlinePieces() {
    const fresh = pieceOutlines(app.doc);
    if (!fresh.length) { app.toast('Add a room first, or draw the outline by hand.'); return; }
    const old = new Map(outlinesOf(app.doc).map((o) => [o.piece, o]));
    const mine = new Set(fresh.map((o) => o.piece));
    // the same piece again replaces its outline (keeping its id, so the connection points on it stay with it)
    const kept = app.doc.items.filter((it) => !(it.type === 'outline' && mine.has(it.piece)));
    const made = fresh.map((o) => (old.has(o.piece) ? { ...o, id: old.get(o.piece).id } : o));
    app.commit({ ...app.doc, items: [...kept, ...made] }, 'Auto-outline');
    app.toast(`Drew an outline round each of ${made.length} building${made.length === 1 ? '' : 's'}. Buildings are not joined: use Connect hallways to link them.`);
  }

  // --- Connect hallways: colored links, point 1 and point 2 each placed by a click on a wall ---
  const connectSection = el.querySelector('#connect-section');
  const linkList = el.querySelector('#link-list');
  const addLinkBtn = el.querySelector('#btn-add-link');
  const mergeBtn = el.querySelector('#btn-merge');
  const mergeHint = el.querySelector('#merge-hint');
  const draftLinks = []; // links with no point placed yet: { pair, color } (they exist in the document once a point is)
  function allLinks() {
    const real = linksOf(app.doc);
    const have = new Set(real.map((l) => l.pair));
    for (let i = draftLinks.length - 1; i >= 0; i--) if (have.has(draftLinks[i].pair)) draftLinks.splice(i, 1);
    return real.concat(draftLinks.map((d) => ({ pair: d.pair, color: d.color, one: null, two: null })));
  }
  const colorName = (c) => COLOR_NAMES[Math.max(0, LINK_COLORS.indexOf(c))] || 'Link';
  function renderLinks() {
    const has = outlinesOf(app.doc).length > 0;
    connectSection.hidden = !has;
    if (!has) return;
    const arm = app.connectArm;
    linkList.innerHTML = allLinks().map((l) => {
      const st = linkState(app.doc, l);
      const pt = (slot, c) => `<button type="button" class="link-pt" data-pair="${l.pair}" data-slot="${slot}" style="--c:${l.color}" aria-pressed="${!!arm && arm.pair === l.pair && arm.slot === slot}" title="${c ? 'Move point ' + slot : 'Place point ' + slot} on a wall">${slot}</button>`;
      const status = !st.placed ? 'Place both points'
        : `Hallway to opening <span class="chk${st.oneHall ? ' ok' : ''}">1${st.oneHall ? ' ✓' : ''}</span> <span class="chk${st.twoHall ? ' ok' : ''}">2${st.twoHall ? ' ✓' : ''}</span>`;
      return `<div class="link-row" data-pair="${l.pair}"><span class="link-dot" style="--c:${l.color}" title="${colorName(l.color)}"></span>${pt(1, l.one)}${pt(2, l.two)}<span class="link-status">${status}</span><button type="button" class="link-x" data-remove="${l.pair}" title="Remove this connection" aria-label="Remove this connection">×</button></div>`;
    }).join('');
    const ready = mergeReady(app.doc);
    mergeBtn.disabled = !ready;
    mergeHint.textContent = ready ? 'Every opening has a hallway.' : 'Draw a hallway to each opening first';
    addLinkBtn.disabled = allLinks().length >= LINK_COLORS.length;
  }
  addLinkBtn.addEventListener('click', () => {
    addLinkBtn.blur();
    const used = new Set(allLinks().map((l) => l.color));
    const color = LINK_COLORS.find((c) => !used.has(c)) || nextColor(app.doc);
    draftLinks.push({ pair: `link-${Date.now().toString(36)}${draftLinks.length}`, color });
    renderLinks();
  });
  linkList.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const pair = rm.dataset.remove;
      const i = draftLinks.findIndex((d) => d.pair === pair);
      if (i >= 0) draftLinks.splice(i, 1);
      if (app.doc.items.some((it) => it.type === 'connect' && it.pair === pair)) app.commit({ ...app.doc, items: app.doc.items.filter((it) => !(it.type === 'connect' && it.pair === pair)) }, 'Remove connection');
      else renderLinks();
      return;
    }
    const b = e.target.closest('.link-pt');
    if (!b) return;
    const slot = Number(b.dataset.slot);
    const arm = app.connectArm;
    if (app.toolName === 'connect' && arm && arm.pair === b.dataset.pair && arm.slot === slot) { app.setTool('select'); return; } // pressed again: cancel
    const l = allLinks().find((x) => x.pair === b.dataset.pair);
    if (!l) return;
    app.connectArm = { pair: l.pair, slot, color: l.color };
    app.setTool('connect');
  });
  mergeBtn.addEventListener('click', () => {
    mergeBtn.blur();
    if (!mergeReady(app.doc)) return;
    const next = mergeOutlines(app.doc);
    if (!next) { app.toast('Could not draw one outline round everything.'); return; }
    draftLinks.length = 0;
    app.commit(next, 'Merge into one outline');
    if (app.setSelection) app.setSelection(['floor']);
    app.toast('The buildings are now one outline. Use Edit outline to fine-tune it (Undo puts the pieces back).');
  });

  const straightenBtn = el.querySelector('#btn-straighten');
  if (straightenBtn) {
    straightenBtn.addEventListener('click', () => {
      if (!hasFloor()) return;
      const { points: pts, tilt } = straightenOutline(app.doc.floor.points);
      app.commit(setFloor(app.doc, pts), 'Straighten lines');
      if (tilt) {
        const deg = Math.abs(tilt).toFixed(1);
        app.toast(`The outline leans about ${deg}°, so walls were squared along that lean. If the photo itself is tilted, use Flatten in step 1.`);
      } else {
        app.toast('Walls straightened. Angled walls were kept (near-45° ones made exactly 45°).');
      }
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
    if (autoBtn) {
      autoBtn.hidden = !hasPlan();
      autoBtn.textContent = (hasFloor() || outlinesOf(app.doc).length) ? 'Auto-outline again' : 'Auto-outline';
      autoBtn.title = piecesMode() ? 'Draw an outline round each building (each photo), without joining them' : 'Draw the outline round the rooms, halls and stairs that are on the plan';
    }
    if (app.toolName !== 'connect') app.connectArm = null; // a placing mode ends with its tool (Esc, another tool, or a click)
    renderLinks();
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
    const legendPlaced = !!findLegend(app.doc);
    chipRow.querySelectorAll('.chip').forEach((chip) => {
      const key = chip.dataset.piece;
      // Only one legend per plan: its piece is greyed out while one is placed.
      const oneLegend = key === 'legend' && legendPlaced;
      chip.classList.toggle('disabled', !roomsUnlocked || oneLegend);
      chip.title = oneLegend ? ONE_LEGEND_TITLE : (!roomsUnlocked ? LOCKED_TITLE : '');
      if (key === 'legend') chip.querySelector('.chip-label').textContent = legendPlaced ? 'Legend · placed' : 'Legend';
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
    if (piece.key === 'legend' && findLegend(app.doc)) { app.toast(ONE_LEGEND_TITLE); return; }
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
        // A click places the legend beside the building; other pieces pick a tool.
        if (piece.key === 'legend') drop(piece, null, null);
        else toggleTool(chipToolName(piece.key), piece.key);
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
