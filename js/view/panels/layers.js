// layers.js
// "View layers" sidebar: a two-layer tree on top (Photo: each photo of the project; Drawing: everything on the plan, grouped by
// piece and then by type, with an eye on every row and header), then the selected item(s) and the items overlapping the
// selection (red, click to select).
// It temporarily replaces the properties column while open (toggle: the
// View > View layers button, or the panel's x).
// Depends on: js/model/overlaps.js, js/model/document.js (roomPolygon).

import { findOverlaps, allOverlapPairs, overlapClusters } from '../../model/overlaps.js';
import { proposeFix } from '../../model/fixOverlaps.js';
import { roomPolygon } from '../../model/document.js';
import { bbox } from '../../model/geometry.js';
import { createNotesFlow, STYLE as FIXFLOW_STYLE } from './fixflow.js';

const STYLE = `
#layers-panel { font:13px/1.35 system-ui,sans-serif; color:#23272e; padding:10px 12px; overflow:auto; height:100%; box-sizing:border-box; }
#layers-panel[hidden] { display:none; }
#layers-panel h3 { margin:0; font-size:15px; }
#layers-panel header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
#layers-panel h4 { margin:12px 0 4px; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#6b7078; }
#layers-panel .ly-x { all:unset; cursor:pointer; padding:0 6px; font-size:18px; line-height:1; color:#6b7078; }
#layers-panel .ly-row { display:block; width:100%; box-sizing:border-box; text-align:left; font:inherit; color:inherit; background:#fff; border:1px solid #e1e4e9; border-radius:6px; padding:5px 8px; margin:0 0 3px; cursor:pointer; }
#layers-panel .ly-row:hover { background:#eef3fe; }
#layers-panel .ly-row small { display:block; color:#6b7078; font-size:11px; }
#layers-panel .ly-sel { background:#e8f0ff; border-color:#8fb1f5; }
#layers-panel .ly-red { background:#fde8e8; border-color:#e5484d; color:#9b1c1f; }
#layers-panel .ly-red:hover { background:#fbd3d3; }
#layers-panel .ly-red small { color:#b4373a; }
#layers-panel .ly-hint { color:#6b7078; margin:4px 0; }
#layers-panel .ly-cluster { border:1px solid #e5484d; border-radius:8px; padding:6px; margin:0 0 8px; background:#fff7f7; }
#layers-panel .ly-chead { display:flex; justify-content:space-between; align-items:center; font-weight:600; color:#9b1c1f; margin:0 0 5px; font-size:12px; }
#layers-panel .ly-fixbtn { font:inherit; font-size:12px; font-weight:600; padding:4px 10px; border:1px solid #2f6feb; border-radius:6px; background:#2f6feb; color:#fff; cursor:pointer; margin-right:6px; }
#layers-panel .ly-fixcard { border:1px solid #2f6feb; border-radius:10px; padding:10px; background:#f3f7ff; margin:0 0 10px; }
#layers-panel .ly-fixcard ul { margin:6px 0 8px 16px; padding:0; }
#layers-panel .ly-fixbtns { display:flex; gap:6px; margin-top:8px; }
#layers-panel .ly-fixbtns button { font:inherit; font-size:12px; padding:5px 12px; border-radius:6px; border:1px solid #c5ccd6; background:#fff; cursor:pointer; }
#layers-panel .ly-fixbtns .ly-yes { background:#2f6feb; border-color:#2f6feb; color:#fff; font-weight:600; }
#layers-panel .ly-line { display:flex; align-items:stretch; gap:4px; margin:0 0 3px; }
#layers-panel .ly-line .ly-row { flex:1; min-width:0; margin:0; }
#layers-panel .ly-line .ly-row.ly-static { cursor:default; }
#layers-panel .ly-eye { flex:none; width:30px; display:flex; align-items:center; justify-content:center; padding:0; border:1px solid #e1e4e9; border-radius:6px; background:#fff; color:#2f6feb; cursor:pointer; }
#layers-panel .ly-eye:hover { background:#eef3fe; }
#layers-panel .ly-eye[aria-pressed="true"] { color:#9aa0a8; background:#f3f4f6; }
#layers-panel .ly-eye svg { width:16px; height:16px; display:block; }
#layers-panel .ly-off .ly-row { opacity:.5; }
#layers-panel .ly-pbtn { flex:none; font:inherit; font-size:12px; padding:0 10px; border:1px solid #c5ccd6; border-radius:6px; background:#fff; cursor:pointer; }
#layers-panel .ly-pbtn:hover { background:#eef3fe; }
#layers-panel .ly-gh { display:flex; align-items:stretch; gap:4px; margin:0 0 3px; }
#layers-panel .ly-chev { flex:none; width:20px; display:flex; align-items:center; justify-content:center; padding:0; border:0; background:none; color:#6b7078; cursor:pointer; }
#layers-panel .ly-chev svg { width:12px; height:12px; display:block; transition:transform .12s; }
#layers-panel .ly-chev[aria-expanded="true"] svg { transform:rotate(90deg); }
#layers-panel .ly-gname { flex:1; min-width:0; text-align:left; font:inherit; color:inherit; background:none; border:0; padding:3px 2px; cursor:pointer; }
#layers-panel .ly-gname small { color:#6b7078; font-size:11px; margin-left:6px; font-weight:400; text-transform:none; letter-spacing:0; }
#layers-panel .ly-lv0 .ly-gname { font-weight:600; font-size:13px; }
#layers-panel .ly-lv1 .ly-gname { font-weight:600; }
#layers-panel .ly-lv2 .ly-gname { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:#6b7078; }
#layers-panel .ly-gh.ly-off .ly-gname { opacity:.5; }
#layers-panel .ly-gb { margin:0 0 6px 9px; padding-left:6px; border-left:2px solid #e1e4e9; }
#layers-panel .ly-lv0-wrap { margin:0 0 8px; }
#layers-panel .ly-selall { font:inherit; font-size:11px; font-weight:500; padding:2px 8px; border:1px solid #e5484d; border-radius:6px; background:#fff; color:#9b1c1f; cursor:pointer; }
`;

const GROUPS = [
  ['Outline', (i) => i.type === 'outline'],
  ['Hallways', (i) => i.type === 'hall'],
  ['Rooms', (i) => i.type === 'room' && !['core', 'void'].includes(i.cls)],
  ['Cores & voids', (i) => i.type === 'room' && ['core', 'void'].includes(i.cls)],
  ['Stairs', (i) => i.type === 'stair'],
  ['Doors', (i) => i.type === 'door'],
  ['Compass & legend', (i) => i.type === 'compass' || i.type === 'legend'],
  ['Connections', (i) => i.type === 'connect'],
];
const KNOWN = (i) => GROUPS.some(([, pred]) => pred(i));

export function itemTitle(it) {
  if (it.type === 'room') {
    const nm = [it.name, it.number].filter(Boolean).join(' ');
    const kind = it.cls === 'void' ? 'Void' : it.cls === 'core' ? 'Core' : 'Room';
    return nm ? `${kind} ${nm}` : kind;
  }
  if (it.type === 'stair') return `Stair ${it.label || ''}`.trim();
  if (it.type === 'door') return `Door ${it.kind || ''}`.trim();
  if (it.type === 'hall') return 'Hallway';
  if (it.type === 'outline') return 'Building outline';
  return it.type.charAt(0).toUpperCase() + it.type.slice(1);
}

export function itemGeom(it) {
  const r = Math.round;
  if (it.type === 'door') return `(${r(it.x1)}, ${r(it.y1)}) to (${r(it.x2)}, ${r(it.y2)})`;
  if (it.type === 'room' || it.type === 'stair' || it.type === 'hall') {
    const b = it.type === 'room' ? bbox(roomPolygon(it)) : it;
    return `${r(b.w)} x ${r(b.h)} at (${r(b.x)}, ${r(b.y)})`;
  }
  if (it.type === 'outline') return `${it.points.length} corners`;
  return `at (${r(it.x)}, ${r(it.y)})`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// in the tree an outline item is just "Outline" and a connection point "Connection"
const treeTitle = (it) => (it.type === 'outline' && it.id ? 'Outline' : it.type === 'connect' ? 'Connection' : itemTitle(it));

function row(it, cls, sub, onClick, title) {
  const b = el('button', `ly-row ${cls || ''}`);
  b.type = 'button';
  b.appendChild(document.createTextNode(title || itemTitle(it)));
  b.appendChild(el('small', null, sub));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_SHUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><path d="M3 3l18 18"/></svg>';

// small eye button: aria-pressed = hidden. what = what it hides, for the screen-reader label
function eyeBtn(hidden, what, onToggle) {
  const b = el('button', 'ly-eye'); b.type = 'button';
  b.setAttribute('aria-pressed', String(hidden));
  b.setAttribute('aria-label', `${hidden ? 'Show' : 'Hide'} ${what}`);
  b.title = hidden ? 'Show on the plan' : 'Hide from the plan (nothing is deleted)';
  b.innerHTML = hidden ? EYE_SHUT : EYE_OPEN;
  b.addEventListener('click', onToggle);
  return b;
}

const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

const naturalCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function mountLayers(app) {
  const props = document.getElementById('props');
  const btn = document.getElementById('btn-layers');
  if (!document.getElementById('ly-style')) {
    const s = document.createElement('style');
    s.id = 'ly-style'; s.textContent = STYLE + FIXFLOW_STYLE; document.head.appendChild(s);
  }
  const panel = el('div'); panel.id = 'layers-panel'; panel.hidden = true;
  if (props) props.insertBefore(panel, props.firstChild);
  let open = false, raf = 0;
  let fix = null; // staged "Fix overlaps" session
  const treeOpen = new Map(); // group key -> expanded? (remembered while the app is open)
  const isOpen = (key, dflt) => (treeOpen.has(key) ? treeOpen.get(key) : dflt);

  const notes = createNotesFlow(app, { el, render: () => render(), revert: () => revert() });
  const ckey = (c) => c.items.map((i) => i.id).sort().join('|');
  const revert = () => { if (app.canvas && app.doc) app.canvas.setDoc(app.doc); };
  function nextFix() {
    fix.cur = null;
    for (;;) {
      const cl = overlapClusters(app.doc).filter((c) => !fix.skipped.has(ckey(c)));
      if (!cl.length) { fix.done = true; revert(); render(); return; }
      const c = cl[0];
      const prop = proposeFix(app.doc, c);
      if (!prop.changedIds.length) { fix.skipped.add(ckey(c)); fix.manual.push(...prop.unresolved.map((u) => u.reason)); continue; }
      fix.step++;
      fix.cur = { c, prop };
      app.canvas.setDoc(prop.doc); // preview only: nothing is saved until the user says yes
      app.setSelection(prop.changedIds);
      render();
      return;
    }
  }
  function startFix() {
    fix = { skipped: new Set(), fixed: 0, manual: [], step: 0, total: overlapClusters(app.doc).length, cur: null, done: false };
    nextFix();
  }
  function applyFix() {
    const { prop } = fix.cur;
    app.commit(prop.doc, 'Fix overlaps');
    fix.fixed++;
    for (const u of prop.unresolved) {
      fix.manual.push(u.reason);
      for (const cc of overlapClusters(app.doc)) if (cc.items.some((i) => i.id === u.a.id) && cc.items.some((i) => i.id === u.b.id)) fix.skipped.add(ckey(cc));
    }
    nextFix();
  }
  function skipFix() {
    fix.skipped.add(ckey(fix.cur.c));
    fix.manual.push(`Skipped: ${fix.cur.c.items.map(itemTitle).join(', ')}`);
    revert();
    nextFix();
  }
  function stopFix() { revert(); fix = null; render(); }

  function renderFix() {
    const card = el('div', 'ly-fixcard');
    if (fix.done) {
      card.appendChild(el('h4', null, 'Fix overlaps: done'));
      card.appendChild(el('div', null, `${fix.fixed} ${fix.fixed === 1 ? 'group' : 'groups'} fixed.`));
      const left = [...new Set(fix.manual)];
      if (left.length) {
        card.appendChild(el('div', 'ly-hint', 'Left for you to move by hand:'));
        const ul = el('ul');
        for (const t of left) ul.appendChild(el('li', null, t));
        card.appendChild(ul);
      } else card.appendChild(el('div', 'ly-hint', 'No overlaps left.'));
      const bar = el('div', 'ly-fixbtns');
      const ok = el('button', 'ly-yes', 'Close'); ok.type = 'button';
      ok.addEventListener('click', () => { fix = null; render(); });
      bar.appendChild(ok); card.appendChild(bar);
      panel.appendChild(card);
      return;
    }
    const { c, prop } = fix.cur;
    card.appendChild(el('h4', null, `Fix overlaps: group ${fix.step} of ${Math.max(fix.total, fix.step)}`));
    card.appendChild(el('div', null, `${c.items.length} items overlap here. The preview on the plan shows the fix:`));
    const ul = el('ul');
    for (const n of prop.notes) ul.appendChild(el('li', null, n));
    card.appendChild(ul);
    for (const u of prop.unresolved) card.appendChild(el('div', 'ly-hint', `Needs a manual move: ${u.reason}`));
    card.appendChild(el('div', 'ly-hint', 'Apply this fix?'));
    const bar = el('div', 'ly-fixbtns');
    for (const [label, cls, fn] of [['Yes, apply', 'ly-yes', applyFix], ['Skip', '', skipFix], ['Stop', '', stopFix]]) {
      const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); bar.appendChild(b);
    }
    card.appendChild(bar);
    panel.appendChild(card);
  }

  function setOpen(v) {
    open = v;
    if (!v && fix) { revert(); fix = null; }
    if (!v) notes.reset();
    panel.hidden = !v;
    if (props) for (const c of props.children) if (c !== panel) c.style.display = v ? 'none' : '';
    if (btn) btn.setAttribute('aria-pressed', String(v));
    if (v) render();
  }
  const select = (id) => app.setSelection([id]);

  // one collapsible group of the tree: [chevron] [eye] name (count) [Select]; the rows go in body(parent) when it is open
  function group(parent, o) {
    const open = isOpen(o.key, o.open);
    const wrap = el('div', o.level === 0 ? 'ly-lv0-wrap' : '');
    const head = el('div', `ly-gh ly-lv${o.level}${o.cls ? ` ${o.cls}` : ''}${o.off ? ' ly-off' : ''}`);
    const toggle = () => { treeOpen.set(o.key, !isOpen(o.key, o.open)); render(); };
    const chev = el('button', 'ly-chev'); chev.type = 'button'; chev.innerHTML = CHEV;
    chev.setAttribute('aria-expanded', String(open));
    chev.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${o.title}`);
    chev.addEventListener('click', toggle);
    head.appendChild(chev);
    if (o.onEye) head.appendChild(eyeBtn(o.off, o.what || o.title, o.onEye));
    const nm = el('button', 'ly-gname', o.title); nm.type = 'button';
    if (o.count != null) nm.appendChild(el('small', null, o.count));
    nm.addEventListener('click', toggle);
    head.appendChild(nm);
    if (o.selectIds && o.selectIds.length) {
      const sb = el('button', 'ly-pbtn', 'Select'); sb.type = 'button';
      sb.setAttribute('aria-label', `Select ${o.title}`);
      sb.addEventListener('click', () => app.setSelection(o.selectIds));
      head.appendChild(sb);
    }
    wrap.appendChild(head);
    if (open) { const body = el('div', 'ly-gb'); o.body(body); wrap.appendChild(body); }
    parent.appendChild(wrap);
  }

  // the items of one piece (or of the whole plan) grouped by type, each row with its own eye
  function typeGroups(parent, items, scope, hid, redIds) {
    for (const [title, pred] of [...GROUPS, ['Other', (i) => !KNOWN(i)]]) {
      const list = items.filter(pred);
      if (!list.length) continue;
      const ids = list.filter((i) => i.id).map((i) => i.id);
      const off = ids.length > 0 && ids.every((id) => hid.has(id));
      group(parent, {
        level: 2, key: `${scope}|${title}`, open: true, title, count: String(list.length), off,
        what: `${scope === 'all' ? '' : `${scope.replace(/^piece:/, '')} `}${title}`.trim(),
        onEye: ids.length ? () => app.setHidden(ids, !off) : null,
        body: (box) => {
          for (const it of list) {
            const red = it.id && redIds.has(it.id);
            const on = it.id && app.selection.has(it.id);
            const r = row(it, red ? 'ly-red' : on ? 'ly-sel' : '', itemGeom(it), it.id ? () => select(it.id) : null, treeTitle(it));
            if (!it.id) { box.appendChild(r); continue; } // the building outline is not an item: it has no eye
            const iOff = hid.has(it.id);
            const line = el('div', `ly-line${iOff ? ' ly-off' : ''}`);
            line.appendChild(eyeBtn(iOff, treeTitle(it), () => app.setHidden([it.id], !iOff)));
            line.appendChild(r);
            box.appendChild(line);
          }
        },
      });
    }
  }

  // the two layers: Photo (one row per photo of the project) and Drawing (pieces, then types)
  function renderTree(doc, hid, redIds) {
    const p = app.project, hp = app.hiddenPhotos ? app.hiddenPhotos() : new Set();
    const photos = [];
    if (p && p.photo && p.photo.dataUrl) photos.push({ idx: 0, name: 'Photo 1', ph: p.photo });
    ((p && p.extraPhotos) || []).forEach((e, j) => { if (e && e.dataUrl) photos.push({ idx: j + 1, name: `Photo ${j + 2}`, ph: e }); });
    if (photos.length) {
      const pids = photos.map((x) => `photo:${x.idx}`);
      const off = photos.every((x) => hp.has(x.idx));
      group(panel, {
        level: 0, key: 'layer:photo', open: true, title: 'Photo', count: `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`, off,
        what: 'all photos', onEye: () => app.setHidden(pids, !off),
        body: (box) => {
          for (const x of photos) {
            const o = hp.has(x.idx);
            const line = el('div', `ly-line ly-photo${o ? ' ly-off' : ''}`);
            line.appendChild(eyeBtn(o, `${x.name} picture`, () => app.setHidden([`photo:${x.idx}`], !o)));
            const lab = el('div', 'ly-row ly-static', x.name);
            lab.appendChild(el('small', null, `${x.idx === 0 ? 'Main photo' : 'Extra photo'}${x.ph.width ? ` · ${Math.round(x.ph.width)} x ${Math.round(x.ph.height || 0)}` : ''}`));
            line.appendChild(lab);
            box.appendChild(line);
          }
        },
      });
    }

    const all = doc.items.filter(Boolean);
    const allIds = all.filter((i) => i.id).map((i) => i.id);
    const offAll = allIds.length > 0 && allIds.every((id) => hid.has(id));
    const outlineRow = doc.floor && doc.floor.points ? [{ id: null, type: 'outline', points: doc.floor.points }] : [];
    const pieces = new Map(); // piece name -> items (AutoBuild tags the items of each photo of a multi-photo floor)
    const loose = [];
    for (const it of all) { if (typeof it.piece === 'string' && it.piece) { if (!pieces.has(it.piece)) pieces.set(it.piece, []); pieces.get(it.piece).push(it); } else loose.push(it); }
    group(panel, {
      level: 0, key: 'layer:drawing', open: true, title: 'Drawing', count: `${all.length} ${all.length === 1 ? 'item' : 'items'}`, off: offAll,
      what: 'the whole drawing', onEye: allIds.length ? () => app.setHidden(allIds, !offAll) : null,
      body: (box) => {
        if (!pieces.size) { typeGroups(box, [...outlineRow, ...loose], 'all', hid, redIds); return; }
        const dflt = pieces.size <= 2; // many pieces: start folded so the list stays short
        const sub = (key, name, items, cls) => {
          const ids = items.filter((i) => i.id).map((i) => i.id);
          const off = ids.length > 0 && ids.every((id) => hid.has(id));
          const n = items.length;
          group(box, {
            level: 1, key, open: dflt, title: name, cls, count: `${n} ${n === 1 ? 'item' : 'items'}`, off, what: `${name} plan`,
            onEye: ids.length ? () => app.setHidden(ids, !off) : null, selectIds: ids,
            body: (b2) => typeGroups(b2, items, key, hid, redIds),
          });
        };
        for (const name of [...pieces.keys()].sort(naturalCmp)) sub(`piece:${name}`, name, pieces.get(name), 'ly-piece');
        if (loose.length || outlineRow.length) sub('whole', 'Whole plan', [...outlineRow, ...loose], 'ly-whole');
      },
    });
  }

  function render() {
    if (!open || !app.doc) return;
    const doc = app.doc;
    const sel = [...app.selection].map((id) => doc.items.find((i) => i.id === id)).filter(Boolean);
    const pairs = allOverlapPairs(doc);
    const redIds = new Set();
    for (const p of pairs) { redIds.add(p.a.id); redIds.add(p.b.id); }
    panel.textContent = '';

    const head = el('header');
    head.appendChild(el('h3', null, 'Layers'));
    const x = el('button', 'ly-x', '×'); x.type = 'button'; x.title = 'Close layers';
    x.addEventListener('click', () => setOpen(false));
    if (!fix && !notes.active() && pairs.length) {
      const fb = el('button', 'ly-fixbtn', 'Fix overlaps'); fb.type = 'button';
      fb.title = 'Snap overlapping rooms apart, one group at a time';
      fb.addEventListener('click', startFix);
      head.appendChild(fb);
    }
    head.appendChild(x);
    panel.appendChild(head);
    if (fix) { renderFix(); return; }
    if (notes.active()) { notes.renderCard(panel); return; }

    const hid = app.hiddenIds ? app.hiddenIds() : new Set();
    renderTree(doc, hid, redIds);
    if (sel.length) {
      panel.appendChild(el('h4', null, sel.length > 1 ? `Selected (${sel.length})` : 'Selected'));
      for (const it of sel) panel.appendChild(row(it, 'ly-sel', itemGeom(it)));
      const seen = new Map();
      for (const it of sel) for (const o of findOverlaps(doc, it.id)) if (!seen.has(o.item.id)) seen.set(o.item.id, o);
      for (const it of sel) seen.delete(it.id);
      panel.appendChild(el('h4', null, `Overlapping the selection (${seen.size})`));
      if (!seen.size) panel.appendChild(el('div', 'ly-hint', 'Nothing overlaps the selection.'));
      for (const o of seen.values()) {
        panel.appendChild(row(o.item, 'ly-red', `${o.w} x ${o.h} px overlap · ${itemGeom(o.item)}`, () => select(o.item.id)));
      }
    } else {
      panel.appendChild(el('div', 'ly-hint', 'Select a room to see what overlaps it.'));
      const clusters = overlapClusters(doc);
      panel.appendChild(el('h4', null, `Overlap clusters in the plan (${clusters.length}${clusters.length === 1 ? ' cluster' : ' clusters'}, ${pairs.length} overlapping ${pairs.length === 1 ? 'pair' : 'pairs'})`));
      if (!clusters.length) panel.appendChild(el('div', 'ly-hint', 'No overlaps.'));
      clusters.forEach((c, i) => {
        const wrap = el('div', 'ly-cluster');
        const head2 = el('div', 'ly-chead', `Cluster ${i + 1} · ${c.items.length} items overlapping`);
        const all = el('button', 'ly-selall', 'Select all'); all.type = 'button';
        all.addEventListener('click', () => app.setSelection(c.items.map((it) => it.id)));
        head2.appendChild(all);
        wrap.appendChild(head2);
        for (const it of c.items) {
          const mine = c.pairs.filter((p) => p.a.id === it.id || p.b.id === it.id)
            .map((p) => { const o = p.a.id === it.id ? p.b : p.a; return `${itemTitle(o)} (${p.kind === 'inside' ? 'inside' : `${p.w} x ${p.h} px`})`; });
          wrap.appendChild(row(it, 'ly-red', `overlaps ${mine.join(', ')}`, () => select(it.id)));
        }
        panel.appendChild(wrap);
      });
    }
  }

  function schedule() { if (open && !raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  const unsub = app.subscribe((e) => { if (e.type === 'doc') notes.onDoc(); if (e.type === 'doc' || e.type === 'selection' || e.type === 'hidden' || e.type === 'project') schedule(); });
  const onBtn = (e) => {
    e.stopPropagation();
    setOpen(!open);
    const pop = document.getElementById('view-popover');
    if (pop) pop.hidden = true; // it would sit on top of the panel's header buttons
  };
  if (btn) btn.addEventListener('click', onBtn);

  return {
    toggle: () => setOpen(!open),
    destroy() {
      unsub(); notes.destroy();
      if (btn) { btn.removeEventListener('click', onBtn); btn.setAttribute('aria-pressed', 'false'); }
      if (raf) cancelAnimationFrame(raf);
      if (props) for (const c of props.children) if (c !== panel) c.style.display = '';
      panel.remove();
    },
  };
}
