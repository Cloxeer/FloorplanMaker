// properties.js
// Right-panel property editor for the current selection: simple fields for a
// single room/door/stair/compass/floor, plus alignment tools for multi-selection.
// Depends on: js/model/document.js (getItem, updateItem, removeItems, STD, NUMBER_RE).

import { getItem, updateItem, removeItems, NUMBER_RE } from '../../model/document.js';
import { rectToPoints, dist } from '../../model/geometry.js';

const CLASS_OPTIONS = [
  { cls: 'room', label: 'Room' },
  { cls: 'big', label: 'Big' },
  { cls: 'ours', label: 'Ours' },
  { cls: 'core', label: 'Core' },
  { cls: 'void', label: 'Void' },
];

function selectedItems(app) {
  const ids = [...app.selection];
  return ids.map((id) => getItem(app.doc, id)).filter(Boolean);
}

function bboxOf(item) {
  if (item.shape === 'poly') {
    const xs = item.points.map((p) => p[0]);
    const ys = item.points.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

export function mountProperties(el, app) {
  function render() {
    const items = selectedItems(app);
    if (items.length === 0) {
      el.innerHTML = '<p class="section-title">Nothing selected</p><p style="color:var(--muted)">Pick a tool, or click an item on the plan to edit it.</p>';
      return;
    }
    if (items.length === 1) {
      renderSingle(items[0]);
      return;
    }
    renderMulti(items);
  }

  function renderSingle(item) {
    if (item.type === 'room') return renderRoom(item);
    if (item.type === 'door') return renderDoor(item);
    if (item.type === 'stair') return renderStair(item);
    if (item.type === 'compass') return renderCompass(item);
    el.innerHTML = '<p>Unsupported selection.</p>';
  }

  function commitField(id, patch, label) {
    app.commit(updateItem(app.doc, id, patch), label);
  }

  function deleteButtonHtml() {
    return '<button type="button" id="p-delete" class="btn-delete">Delete</button>';
  }

  function wireDelete(item) {
    const btn = el.querySelector('#p-delete');
    if (!btn) return;
    btn.addEventListener('click', () => {
      app.commit(removeItems(app.doc, [item.id]), 'Delete');
      app.setSelection([]);
    });
  }

  function classChipsHtml(item) {
    return `
      <div class="form-row">
        <label>Type</label>
        <div class="chip-row" id="p-class">
          ${CLASS_OPTIONS.map((c) => `<button type="button" class="chip chip-${c.cls} ${item.cls === c.cls ? 'active' : ''}" data-cls="${c.cls}"><span class="chip-swatch"></span>${c.label}</button>`).join('')}
        </div>
      </div>
    `;
  }

  function wireClassChips(item) {
    el.querySelectorAll('#p-class .chip').forEach((btn) => {
      btn.addEventListener('click', () => commitField(item.id, { cls: btn.dataset.cls }, 'Change type'));
    });
  }

  function renderRoom(item) {
    const isVoid = item.cls === 'void';
    const isCore = item.cls === 'core';
    const numberOk = isVoid || isCore || NUMBER_RE.test(item.number || '');

    let numberField = '';
    if (!isVoid) {
      numberField = `
        <div class="form-row">
          <label for="p-number">Number</label>
          <input type="text" id="p-number" value="${escapeAttr(item.number || '')}">
          ${!isCore ? `<div class="field-hint ${numberOk ? 'hidden' : ''}" id="p-number-hint">like 101, 128B or S117</div>` : ''}
        </div>
      `;
    }
    const nameField = !isVoid ? `
      <div class="form-row">
        <label for="p-name">Name</label>
        <input type="text" id="p-name" value="${escapeAttr(item.name || '')}">
      </div>
    ` : '';
    const showNameField = !isVoid ? `
      <div class="form-row-inline">
        <label><input type="checkbox" id="p-showname" ${item.showName ? 'checked' : ''}> Show name inside</label>
      </div>
    ` : '';
    const shapeButtons = !isVoid ? `
      <div class="form-row-inline">
        ${item.shape === 'poly'
          ? '<button type="button" id="p-add-corner">Add corner</button><button type="button" id="p-make-rect">Make rectangle</button>'
          : '<button type="button" id="p-edit-corners">Edit corners</button>'}
      </div>
    ` : '';
    const recenterRow = (!isVoid && item.label && item.label.pinned) ? `
      <div class="pin-row">
        <span class="pinned" title="Label pinned">&#128204;</span>
        <button type="button" id="p-recenter">Re-center label</button>
      </div>
    ` : '';

    el.innerHTML = `
      <div class="section-title">${isVoid ? 'Void' : isCore ? 'Core' : 'Room'}</div>
      ${numberField}
      ${nameField}
      ${classChipsHtml(item)}
      ${showNameField}
      ${recenterRow}
      ${shapeButtons}
      ${deleteButtonHtml()}
    `;

    const numberInput = el.querySelector('#p-number');
    if (numberInput) {
      numberInput.addEventListener('input', () => {
        numberInput.value = numberInput.value.toUpperCase();
        const hint = el.querySelector('#p-number-hint');
        if (hint) hint.classList.toggle('hidden', isCore || NUMBER_RE.test(numberInput.value) || numberInput.value === '');
      });
      numberInput.addEventListener('change', () => {
        const val = numberInput.value.trim().toUpperCase();
        if (isCore || val === '' || NUMBER_RE.test(val)) {
          commitField(item.id, { number: val }, 'Edit number');
        } else {
          numberInput.value = item.number || '';
        }
      });
    }
    const nameInput = el.querySelector('#p-name');
    if (nameInput) nameInput.addEventListener('change', (e) => commitField(item.id, { name: e.target.value }, 'Edit name'));
    wireClassChips(item);
    const showNameInput = el.querySelector('#p-showname');
    if (showNameInput) showNameInput.addEventListener('change', (e) => commitField(item.id, { showName: e.target.checked }, 'Toggle name'));

    const recenterBtn = el.querySelector('#p-recenter');
    if (recenterBtn) {
      recenterBtn.addEventListener('click', () => {
        commitField(item.id, { label: { pinned: false, x: null, y: null } }, 'Re-center label');
      });
    }

    const editCornersBtn = el.querySelector('#p-edit-corners');
    if (editCornersBtn) {
      editCornersBtn.addEventListener('click', () => {
        const points = rectToPoints(bboxOf(item));
        commitField(item.id, { shape: 'poly', points }, 'Edit corners');
      });
    }
    const addCornerBtn = el.querySelector('#p-add-corner');
    if (addCornerBtn) {
      addCornerBtn.addEventListener('click', () => {
        const pts = item.points;
        let best = null;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const len = dist(a, b);
          if (!best || len > best.len) best = { len, i, mid: [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)] };
        }
        if (!best) return;
        const newPts = pts.slice(0, best.i + 1).concat([best.mid], pts.slice(best.i + 1));
        commitField(item.id, { points: newPts }, 'Add corner');
      });
    }
    const makeRectBtn = el.querySelector('#p-make-rect');
    if (makeRectBtn) {
      makeRectBtn.addEventListener('click', () => {
        const b = bboxOf(item);
        commitField(item.id, { shape: 'rect', x: b.x, y: b.y, w: b.w, h: b.h }, 'Make rectangle');
      });
    }

    wireDelete(item);
  }

  function renderDoor(item) {
    el.innerHTML = `
      <div class="section-title">Door</div>
      <div class="form-row">
        <label>Kind</label>
        <div class="radio-row">
          <label><input type="radio" name="p-kind" value="EXIT" ${item.kind === 'EXIT' ? 'checked' : ''}> EXIT</label>
          <label><input type="radio" name="p-kind" value="Door" ${item.kind === 'Door' ? 'checked' : ''}> Door</label>
        </div>
      </div>
      ${deleteButtonHtml()}
    `;
    el.querySelectorAll('input[name="p-kind"]').forEach((r) => {
      r.addEventListener('change', (e) => commitField(item.id, { kind: e.target.value }, 'Door kind'));
    });
    wireDelete(item);
  }

  function renderStair(item) {
    el.innerHTML = `
      <div class="section-title">Stairs</div>
      <button type="button" id="p-rotate">Rotate</button>
      ${deleteButtonHtml()}
    `;
    el.querySelector('#p-rotate').addEventListener('click', () => {
      commitField(item.id, { dir: item.dir === 'v' ? 'h' : 'v' }, 'Rotate stairs');
    });
    wireDelete(item);
  }

  function renderCompass(item) {
    el.innerHTML = `
      <div class="section-title">Compass</div>
      <div class="form-row-inline">
        <button type="button" id="p-rotate-ccw">Rotate &minus;15&deg;</button>
        <button type="button" id="p-rotate-cw">Rotate +15&deg;</button>
      </div>
      ${deleteButtonHtml()}
    `;
    el.querySelector('#p-rotate-ccw').addEventListener('click', () => {
      commitField(item.id, { deg: (item.deg || 0) - 15 }, 'Rotate compass');
    });
    el.querySelector('#p-rotate-cw').addEventListener('click', () => {
      commitField(item.id, { deg: (item.deg || 0) + 15 }, 'Rotate compass');
    });
    wireDelete(item);
  }

  function renderFloor() {
    const floor = app.doc.floor;
    el.innerHTML = `
      <div class="section-title">Floor outline</div>
      <p>Corners: ${floor ? floor.points.length : 0}</p>
      <button type="button" id="p-remove-floor">Remove outline</button>
    `;
    el.querySelector('#p-remove-floor').addEventListener('click', async () => {
      const ok = await app.confirm('Remove the floor outline?');
      if (ok) app.commit({ ...app.doc, floor: null }, 'Remove outline');
    });
  }

  function renderMulti(items) {
    const rooms = items.filter((it) => it.type === 'room');
    el.innerHTML = `
      <div class="section-title">${items.length} items selected</div>
      ${rooms.length >= 2 ? `
      <div class="align-grid">
        <button type="button" data-align="left" title="Align left">&#8676;</button>
        <button type="button" data-align="center-h" title="Align center">&#8646;</button>
        <button type="button" data-align="right" title="Align right">&#8677;</button>
        <button type="button" data-align="top" title="Align top">&#8670;</button>
        <button type="button" data-align="center-v" title="Align middle">&#8645;</button>
        <button type="button" data-align="bottom" title="Align bottom">&#8671;</button>
      </div>
      <div class="form-row-inline">
        <button type="button" data-align="same-size">Same size</button>
        <button type="button" data-align="distribute">Space evenly</button>
      </div>` : '<p style="color:var(--muted)">Select 2+ rooms to align.</p>'}
      ${deleteButtonHtml()}
    `;
    el.querySelectorAll('[data-align]').forEach((btn) => {
      btn.addEventListener('click', () => runAlign(btn.dataset.align, rooms));
    });
    el.querySelector('#p-delete').addEventListener('click', () => {
      app.commit(removeItems(app.doc, items.map((it) => it.id)), 'Delete');
      app.setSelection([]);
    });
  }

  function rectBoxes(rooms) {
    return rooms.filter((r) => r.shape !== 'poly').map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h }));
  }

  function runAlign(kind, rooms) {
    const boxes = rectBoxes(rooms);
    if (boxes.length < 2) return;
    let doc = app.doc;

    if (kind === 'left') {
      const min = Math.min(...boxes.map((b) => b.x));
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { x: min }); });
    } else if (kind === 'right') {
      const max = Math.max(...boxes.map((b) => b.x + b.w));
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { x: max - b.w }); });
    } else if (kind === 'top') {
      const min = Math.min(...boxes.map((b) => b.y));
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { y: min }); });
    } else if (kind === 'bottom') {
      const max = Math.max(...boxes.map((b) => b.y + b.h));
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { y: max - b.h }); });
    } else if (kind === 'center-h') {
      const cx = boxes.reduce((s, b) => s + b.x + b.w / 2, 0) / boxes.length;
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { x: Math.round(cx - b.w / 2) }); });
    } else if (kind === 'center-v') {
      const cy = boxes.reduce((s, b) => s + b.y + b.h / 2, 0) / boxes.length;
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { y: Math.round(cy - b.h / 2) }); });
    } else if (kind === 'same-size') {
      const w = boxes[0].w, h = boxes[0].h;
      boxes.slice(1).forEach((b) => { doc = updateItem(doc, b.id, { w, h }); });
    } else if (kind === 'distribute') {
      const spanX = Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x));
      const spanY = Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y));
      if (spanX >= spanY) {
        const sorted = [...boxes].sort((a, b) => a.x - b.x);
        const first = sorted[0], last = sorted[sorted.length - 1];
        const totalSpan = (last.x + last.w) - first.x;
        const totalW = sorted.reduce((s, b) => s + b.w, 0);
        const gap = (totalSpan - totalW) / (sorted.length - 1);
        let cursor = first.x;
        sorted.forEach((b) => {
          doc = updateItem(doc, b.id, { x: Math.round(cursor) });
          cursor += b.w + gap;
        });
      } else {
        const sorted = [...boxes].sort((a, b) => a.y - b.y);
        const first = sorted[0], last = sorted[sorted.length - 1];
        const totalSpan = (last.y + last.h) - first.y;
        const totalH = sorted.reduce((s, b) => s + b.h, 0);
        const gap = (totalSpan - totalH) / (sorted.length - 1);
        let cursor = first.y;
        sorted.forEach((b) => {
          doc = updateItem(doc, b.id, { y: Math.round(cursor) });
          cursor += b.h + gap;
        });
      }
    }

    app.commit(doc, `Align ${kind}`);
  }

  function update(evt) {
    if (!evt || evt.type === 'selection' || evt.type === 'doc' || evt.type === 'project') {
      const ids = [...app.selection];
      if (ids.length === 1 && ids[0] === 'floor') {
        renderFloor();
        return;
      }
      render();
    }
  }

  const unsub = app.subscribe(update);
  update();

  return {
    update,
    destroy() {
      unsub();
      el.innerHTML = '';
    },
  };
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
