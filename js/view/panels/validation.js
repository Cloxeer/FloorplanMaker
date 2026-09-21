// validation.js
// Renders app.validation as a clickable list of errors/warnings below the
// properties panel. Clicking a row selects the offending item.
// Depends on: nothing beyond app's public API.

export function mountValidation(el, app) {
  function render() {
    const results = app.validation || [];
    const errors = results.filter((r) => r.level === 'error');
    const warnings = results.filter((r) => r.level === 'warning');

    const header = `<div class="validation-header">${errors.length} errors &middot; ${warnings.length} warnings</div>`;
    const blocked = errors.length > 0
      ? '<div class="validation-blocked">Export is blocked until errors are fixed</div>'
      : '';

    const rows = results.map((r, i) => `<li class="${r.level}" data-index="${i}">${escapeHtml(r.message)}</li>`).join('');
    const list = results.length
      ? `<ul class="validation-list">${rows}</ul>`
      : '<p style="color:var(--muted)">No problems found.</p>';

    el.innerHTML = header + blocked + list;

    el.querySelectorAll('.validation-list li').forEach((li) => {
      li.addEventListener('click', () => {
        const idx = parseInt(li.dataset.index, 10);
        const item = results[idx];
        if (item && item.itemId) {
          app.setSelection([item.itemId]);
        }
      });
    });
  }

  function update(evt) {
    if (!evt || evt.type === 'validation' || evt.type === 'doc' || evt.type === 'project') render();
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
