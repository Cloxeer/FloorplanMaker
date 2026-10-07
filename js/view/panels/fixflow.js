// fixflow.js
// Staged "Fix worth-a-looks" flow for the Layers sidebar. One fix at a time:
// preview on the plan (nothing saved), then Yes / Yes to all of this kind /
// Skip / Stop. Aggregator contract (js/model/fixNotes.js, loaded lazily):
//   nextFix(doc, skippedKeys:Set) -> { key, kind, title, notes[], ids[], doc } | null
//   manualLeft(doc) -> [{ ids, message }]
// Depends on: the app object (doc, canvas, commit, setSelection).

export const STYLE = `
#layers-panel .ly-badge { display:inline-block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:1px 7px; border-radius:9px; background:#dbe5fb; color:#1d4fb8; margin-left:6px; vertical-align:middle; }
#layers-panel .ly-badge.g-hall { background:#d9f2e3; color:#17693a; }
#layers-panel .ly-badge.g-label { background:#fdeccb; color:#8a5300; }
#layers-panel .ly-badge.g-overlap { background:#fde0e0; color:#9b1c1f; }
#layers-panel .ly-fixnotes { max-height:210px; overflow:auto; }
#layers-panel .ly-fixbtns { flex-wrap:wrap; }
#layers-panel .ly-fixbtns button:disabled { opacity:.55; cursor:default; }
#layers-panel .ly-fixbtns .ly-all { border-color:#2f6feb; color:#1d4fb8; }
#layers-panel header { flex-wrap:wrap; gap:4px; }
#layers-panel header h3 { margin-right:auto; }
#layers-panel .ly-fixbtn { white-space:nowrap; margin-right:0; }
#layers-panel .ly-need { max-height:240px; overflow:auto; }
`;

// kind -> [friendly name, colour group]; unknown kinds fall back to their own name
const KINDS = {
  overlap: ['Overlap', 'overlap'], label: ['Label', 'label'], 'void-label': ['Void label', 'label'], number: ['Number', 'number'],
  'hall-overlap': ['Hallway overlap', 'hall'], 'hall-connect': ['Hallway link', 'hall'], 'room-hall': ['Room to hallway', 'hall'],
};
const kindIdx = (k) => { const i = Object.keys(KINDS).indexOf(k); return i < 0 ? 99 : i; };
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function createNotesFlow(app, h, injected) {
  // h: { el, render, revert }
  let mod = injected || null;
  let flow = null;
  if (!mod) import('../../model/fixNotes.js').then((m) => { mod = m; h.render(); }).catch(() => {});

  const safe = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };
  const ign = () => (app.ignoredIds ? app.ignoredIds() : null); // items the person chose to ignore are left alone
  const nextOf = (doc, sk) => mod.nextFix(doc, sk, { ignoredIds: ign() });

  function canStart() {
    if (!mod || !app.doc) return false;
    return safe(() => !!nextOf(app.doc, new Set()) || mod.manualLeft(app.doc, ign()).length > 0, false);
  }
  function estimate() {
    let d = app.doc, n = 0; const sk = new Set();
    try {
      for (; n < 60; n++) {
        const f = nextOf(d, sk);
        if (!f || sk.has(f.key) || same(f.doc, d)) break;
        sk.add(f.key); d = f.doc;
      }
    } catch (e) { /* estimate only */ }
    return n;
  }
  function start() {
    flow = { skipped: new Set(), fixed: {}, step: 0, total: estimate(), cur: null, done: false, auto: null, busy: false, failed: false, base: null };
    next();
  }
  function finish() { flow.cur = null; flow.done = true; flow.final = app.doc; h.revert(); h.render(); }
  function next() {
    flow.cur = null;
    for (let guard = 0; guard < 500; guard++) {
      let f;
      try { f = nextOf(app.doc, flow.skipped); } catch (e) { flow.failed = true; return finish(); }
      if (!f || flow.skipped.has(f.key)) return finish();
      if (!f.doc || same(f.doc, app.doc)) { flow.skipped.add(f.key); continue; }
      flow.base = app.doc;
      if (flow.auto === f.kind) {
        flow.step++; flow.cur = f;
        if (!commit()) continue;
        continue;
      }
      flow.auto = null;
      flow.step++; flow.cur = f;
      app.canvas.setDoc(f.doc); // preview only: nothing is saved until the user says yes
      app.setSelection(f.ids || []);
      return h.render();
    }
    finish();
  }
  function commit() {
    const f = flow.cur, before = app.doc;
    flow.busy = true;
    try { app.commit(f.doc, 'Fix worth-a-looks: ' + f.kind); } finally { flow.busy = false; }
    if (app.doc === before) { flow.skipped.add(f.key); return false; }
    flow.fixed[f.kind] = (flow.fixed[f.kind] || 0) + 1;
    return true;
  }
  function yes(all) {
    if (!flow || !flow.cur || flow.busy) return;
    const kind = flow.cur.kind;
    flow.busy = true;
    try {
      if (!commit()) { h.revert(); } else if (all) flow.auto = kind;
    } finally { flow.busy = false; }
    next();
  }
  function skip() {
    if (!flow || !flow.cur || flow.busy) return;
    flow.skipped.add(flow.cur.key);
    h.revert();
    next();
  }
  function stop() { if (!flow) return; h.revert(); flow = null; h.render(); }
  function reset() { if (flow) { h.revert(); flow = null; } }
  function close() { flow = null; h.render(); }
  // The plan changed by other means (undo, edits) while a card is open: recompute.
  function onDoc() {
    if (flow && flow.done && !flow.busy && app.doc !== flow.final) { flow = null; h.render(); return; } // summary is stale now
    if (!flow || flow.busy || flow.done || !flow.cur) return;
    if (app.doc !== flow.base) { flow.auto = null; flow.skipped = new Set(); flow.step = Math.max(0, flow.step - 1); h.revert(); next(); }
  }
  function onKey(e) {
    if (!flow || !flow.cur || flow.busy) return;
    if (app._previewHandle || app._exportHandle) return; // the card is out of sight: keys must not apply fixes
    if (e.key === 'Escape') { e.preventDefault(); stop(); }
    else if (e.key === 'Enter' && !/^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(e.target && e.target.tagName)) { e.preventDefault(); yes(false); }
  }
  document.addEventListener('keydown', onKey);

  function badge(kind) {
    const [name, group] = KINDS[kind] || [kind.replace(/-/g, ' '), 'x'];
    return h.el('span', 'ly-badge g-' + group, name);
  }
  function btn(label, cls, fn) {
    const b = h.el('button', cls, label); b.type = 'button';
    b.addEventListener('click', fn); return b;
  }

  function summary(card) {
    const kinds = Object.keys(flow.fixed).sort((a, b) => kindIdx(a) - kindIdx(b));
    const total = kinds.reduce((s, k) => s + flow.fixed[k], 0);
    let left = [];
    try { left = mod.manualLeft(app.doc, ign()) || []; } catch (e) { flow.failed = true; }
    card.appendChild(h.el('h4', null, 'Fix worth-a-looks: done'));
    if (flow.failed) card.appendChild(h.el('div', 'ly-hint', 'Could not compute a fix, left for you.'));
    if (total) {
      card.appendChild(h.el('div', null, `${total} ${total === 1 ? 'fix' : 'fixes'} applied:`));
      const ul = h.el('ul');
      for (const k of kinds) { const li = h.el('li', null, `${flow.fixed[k]} `); li.appendChild(badge(k)); ul.appendChild(li); }
      card.appendChild(ul);
    }
    if (flow.skipped.size) card.appendChild(h.el('div', 'ly-hint', `${flow.skipped.size} skipped.`));
    if (left.length) {
      card.appendChild(h.el('div', total ? 'ly-hint' : null, total ? 'Needs you (click to select):'
        : 'Nothing here can be fixed automatically. Select the highlighted rooms and fix them by hand.'));
      const box = h.el('div', 'ly-need');
      for (const m of left) {
        const b = h.el('button', 'ly-row', m.message); b.type = 'button';
        b.addEventListener('click', () => app.setSelection(m.ids || []));
        box.appendChild(b);
      }
      card.appendChild(box);
    } else if (!total && !flow.failed && !flow.skipped.size) card.appendChild(h.el('div', 'ly-hint', 'Nothing to fix.'));
    const bar = h.el('div', 'ly-fixbtns');
    bar.appendChild(btn('Close', 'ly-yes', close));
    card.appendChild(bar);
  }

  function renderCard(panel) {
    if (!flow) return;
    const card = h.el('div', 'ly-fixcard');
    if (flow.done) summary(card);
    else {
      const f = flow.cur;
      const hd = h.el('h4', null, `Fix ${flow.step} of about ${Math.max(flow.total, flow.step)}`);
      hd.appendChild(badge(f.kind));
      card.appendChild(hd);
      card.appendChild(h.el('div', null, f.title));
      const ul = h.el('ul', 'ly-fixnotes');
      for (const n of f.notes || []) ul.appendChild(h.el('li', null, n));
      card.appendChild(ul);
      card.appendChild(h.el('div', 'ly-hint', 'The preview on the plan shows the fix. Apply it?'));
      const bar = h.el('div', 'ly-fixbtns');
      const ys = btn('Yes, apply', 'ly-yes', () => yes(false));
      bar.appendChild(ys);
      bar.appendChild(btn('Yes to all of this kind', 'ly-all', () => yes(true)));
      bar.appendChild(btn('Skip', '', skip));
      bar.appendChild(btn('Stop', '', stop));
      card.appendChild(bar);
    }
    panel.appendChild(card);
    if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' }); // the card may sit above a scrolled sidebar
  }

  return {
    canStart, start, renderCard, onDoc, reset,
    active: () => !!flow,
    destroy() { document.removeEventListener('keydown', onKey); reset(); },
  };
}
