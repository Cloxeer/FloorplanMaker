// blueprint.js
// Modal dialogs used across the app: showBlueprint() (new-project 4-field
// form), showPrompt(), showConfirm(), showToast(). All render into #dialogs
// and clean up their DOM/listeners when closed.
// Depends on: nothing (pure DOM).

function dialogsEl() {
  return document.getElementById('dialogs');
}

export function slugify(building, floor) {
  const initials = (building || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((w) => w[0].toLowerCase())
    .join('');
  const f = floor === '' || floor == null ? '' : String(floor).trim();
  return f ? `${initials}-${f}` : initials;
}

function makeBackdrop() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  backdrop.appendChild(modal);
  return { backdrop, modal };
}

export function showBlueprint() {
  return new Promise((resolve) => {
    const host = dialogsEl();
    const { backdrop, modal } = makeBackdrop();

    modal.innerHTML = `
      <h3>Start a new blueprint</h3>
      <div class="form-row">
        <label for="bp-building">Building name</label>
        <input type="text" id="bp-building" autocomplete="off">
      </div>
      <div class="form-row">
        <label for="bp-property">NMSU property number</label>
        <input type="text" id="bp-property" autocomplete="off">
      </div>
      <div class="form-row">
        <label for="bp-floor">Floor number</label>
        <input type="text" id="bp-floor" autocomplete="off">
      </div>
      <div class="form-row">
        <label for="bp-slug">File name</label>
        <input type="text" id="bp-slug" autocomplete="off">
      </div>
      <div class="modal-error" id="bp-error" hidden></div>
      <div class="modal-actions">
        <button type="button" id="bp-cancel">Cancel</button>
        <button type="button" id="bp-ok" class="btn-primary">Start</button>
      </div>
    `;

    host.appendChild(backdrop);

    const buildingEl = modal.querySelector('#bp-building');
    const propertyEl = modal.querySelector('#bp-property');
    const floorEl = modal.querySelector('#bp-floor');
    const slugEl = modal.querySelector('#bp-slug');
    const errorEl = modal.querySelector('#bp-error');
    const okBtn = modal.querySelector('#bp-ok');
    const cancelBtn = modal.querySelector('#bp-cancel');

    let slugEdited = false;
    slugEl.addEventListener('input', () => { slugEdited = true; });
    function refreshSlug() {
      if (slugEdited) return;
      slugEl.value = slugify(buildingEl.value, floorEl.value);
    }
    buildingEl.addEventListener('input', refreshSlug);
    floorEl.addEventListener('input', refreshSlug);

    function cleanup() {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
    }

    function fail(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }

    function submit() {
      const building = buildingEl.value.trim();
      const property = propertyEl.value.trim();
      const floorRaw = floorEl.value.trim();
      const slug = slugEl.value.trim();

      if (!building || !property || !floorRaw || !slug) {
        fail('All fields are required.');
        return;
      }
      if (!/^-?\d+$/.test(floorRaw)) {
        fail('Floor number must be an integer.');
        return;
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
        fail('File name must look like "hjulc-1" (lowercase, digits, hyphens).');
        return;
      }
      cleanup();
      resolve({ building, property, floor: parseInt(floorRaw, 10), slug });
    }

    function onKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        resolve(null);
      }
    }

    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => { cleanup(); resolve(null); });
    document.addEventListener('keydown', onKeyDown);

    buildingEl.focus();
  });
}

const ROOM_NUMBER_RE = /^[A-Z]?\d{3}[A-Z]?$/;

// title: string. opts.validate === 'roomNumber' turns on live validation
// against ROOM_NUMBER_RE (uppercased automatically), disables OK while
// invalid, and blocks Enter. Any other title/opts leaves the old free-text
// behavior (used for names, slugs, etc. via other callers if ever added).
export function showPrompt(title, defaultValue = '', opts = {}) {
  const roomNumberMode = opts.validate === 'roomNumber';
  return new Promise((resolve) => {
    const host = dialogsEl();
    const { backdrop, modal } = makeBackdrop();

    modal.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <div class="form-row">
        <input type="text" id="pr-value" autocomplete="off">
        ${roomNumberMode ? '<div class="prompt-example">like 101, 128B or S117</div>' : ''}
      </div>
      <div class="modal-actions">
        <button type="button" id="pr-cancel">Cancel</button>
        <button type="button" id="pr-ok" class="btn-primary">OK</button>
      </div>
    `;
    host.appendChild(backdrop);

    const input = modal.querySelector('#pr-value');
    const okBtn = modal.querySelector('#pr-ok');
    input.value = defaultValue || '';

    function isValid() {
      if (!roomNumberMode) return true;
      return ROOM_NUMBER_RE.test(input.value.trim().toUpperCase());
    }
    function refreshValidity() {
      if (!roomNumberMode) return;
      if (input.value !== input.value.toUpperCase()) {
        const pos = input.selectionStart;
        input.value = input.value.toUpperCase();
        try { input.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
      }
      okBtn.disabled = !isValid();
    }
    if (roomNumberMode) {
      input.addEventListener('input', refreshValidity);
      refreshValidity();
    }

    function cleanup() {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
    }
    function submit() {
      if (!isValid()) return;
      const v = input.value.trim().toUpperCase();
      cleanup();
      resolve(roomNumberMode ? v : input.value.trim());
    }
    function onKeyDown(e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null); }
    }

    okBtn.addEventListener('click', submit);
    modal.querySelector('#pr-cancel').addEventListener('click', () => { cleanup(); resolve(null); });
    document.addEventListener('keydown', onKeyDown);

    input.focus();
    input.select();
  });
}

export function showConfirm(text) {
  return new Promise((resolve) => {
    const host = dialogsEl();
    const { backdrop, modal } = makeBackdrop();

    modal.innerHTML = `
      <h3>${escapeHtml(text)}</h3>
      <div class="modal-actions">
        <button type="button" id="cf-cancel">Cancel</button>
        <button type="button" id="cf-ok" class="btn-primary">OK</button>
      </div>
    `;
    host.appendChild(backdrop);

    function cleanup() {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
    }
    function onKeyDown(e) {
      if (e.key === 'Enter') { e.preventDefault(); cleanup(); resolve(true); }
      else if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(false); }
    }

    modal.querySelector('#cf-ok').addEventListener('click', () => { cleanup(); resolve(true); });
    modal.querySelector('#cf-cancel').addEventListener('click', () => { cleanup(); resolve(false); });
    document.addEventListener('keydown', onKeyDown);
    modal.querySelector('#cf-ok').focus();
  });
}

export function showToast(text) {
  const host = dialogsEl();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
