// palette.js
// Left palette: tool buttons + draggable piece chips. Drag with Pointer
// Events (ghost div follows pointer); drop on #stage places the item.
// A plain click on a chip places it at the center of the current view.
// Depends on: js/model/document.js (STD, makeRoom, newId).

import { STD, makeRoom, newId } from '../../model/document.js';

const TOOLS = [
  { name: 'select', label: 'Select', key: 'V' },
  { name: 'room', label: 'Room', key: 'R' },
  { name: 'poly', label: 'Polygon room', key: 'P' },
  { name: 'floor', label: 'Outline', key: 'F' },
  { name: 'door', label: 'Door', key: 'O' },
  { name: 'stair', label: 'Stair', key: 'S' },
  { name: 'compass', label: 'Compass', key: 'C' },
  { name: 'pan', label: 'Pan', key: '' },
];

const PIECES = [
  { key: 'room', label: 'Room', cls: 'room' },
  { key: 'small', label: 'Small room', cls: 'room' },
  { key: 'big', label: 'Big room', cls: 'big' },
  { key: 'ours', label: 'Our room', cls: 'ours' },
  { key: 'restroom', label: 'Restroom core', cls: 'core' },
  { key: 'elevator', label: 'Elevator core', cls: 'core' },
  { key: 'stair', label: 'Stair block', cls: null },
  { key: 'door', label: 'Door', cls: null },
  { key: 'void', label: 'Void', cls: 'void' },
  { key: 'compass', label: 'Compass', cls: null },
];

function swatchStyle(cls) {
  const fills = {
    room: '#eef1f4', big: '#e6ecf5', ours: '#f5e3ea', core: '#dfe3e8', void: '#d9dce1',
  };
  return cls ? `background:${fills[cls] || '#eef1f4'};` : 'background:#fff;border-style:dashed;';
}

export function mountPalette(el, app) {
  el.innerHTML = `
    <div class="palette-section">
      <h4>Tools</h4>
      <div class="tool-row" id="tool-row"></div>
    </div>
    <div class="palette-section">
      <h4>Pieces</h4>
      <div id="chip-row"></div>
    </div>
  `;

  const toolRow = el.querySelector('#tool-row');
  const chipRow = el.querySelector('#chip-row');

  TOOLS.forEach((t) => {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.type = 'button';
    btn.textContent = t.key ? `${t.label} (${t.key})` : t.label;
    btn.dataset.tool = t.name;
    btn.addEventListener('click', () => app.setTool(t.name));
    toolRow.appendChild(btn);
  });

  function refreshToolButtons() {
    toolRow.querySelectorAll('button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.tool === app.toolName));
    });
  }
  refreshToolButtons();

  PIECES.forEach((piece) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.piece = piece.key;
    chip.innerHTML = `<span class="chip-preview" style="${swatchStyle(piece.cls)}"></span><span class="chip-label">${piece.label}</span>`;
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

  function makeGhost(piece, x, y) {
    const g = document.createElement('div');
    g.style.cssText = `position:fixed; left:${x}px; top:${y}px; width:40px; height:30px;
      background:rgba(47,111,235,0.25); border:2px solid #2f6feb; border-radius:4px;
      pointer-events:none; z-index:200; transform:translate(-50%,-50%);`;
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

    const number = await app.prompt('Room number', '');
    if (number === null) return;
    const item = makeRoom(std.cls, snapped.x, snapped.y, std.w, std.h, number.trim());
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
