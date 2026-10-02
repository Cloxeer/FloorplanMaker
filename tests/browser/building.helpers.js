// tests/browser/building.helpers.js
// Shared helpers for the floors / outline-edit / building-export specs: seed projects straight into
// IndexedDB (via the app's own autosave module), open them by hash route, and clean up afterwards.

// Opens the app and waits for window.__app.
export async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__app && !!document.getElementById('btn-start-blueprint'));
}

// Saves a project. opts: { building, property, floor, slug, outline (bool|points), room (bool), ready (bool: export-ready checklist), badRoom (bool), door (bool) }
// Returns { id, slug }.
export async function seedProject(page, opts) {
  return page.evaluate(async (o) => {
    const { saveNow } = await import('/js/store/autosave.js');
    const { createDoc, setFloor, addItem, makeRoom, newId } = await import('/js/model/document.js');
    const meta = { building: o.building, property: o.property || '1', floor: String(o.floor), slug: o.slug };
    let doc = createDoc(meta, { x: 0, y: 0, w: 1000, h: 1000 });
    if (o.outline) {
      const pts = Array.isArray(o.outline) ? o.outline : [[100, 100], [500, 100], [500, 400], [100, 400]];
      doc = setFloor(doc, pts);
    }
    if (o.room) doc = addItem(doc, makeRoom('room', 150, 150, 150, 100, o.badRoom ? 'bad!' : `${o.floor}01`.replace('-', '')));
    if (o.ready) { // enough for the Export button to enable: a 2nd numbered room, a hallway reaching the outline, a compass and a door
      doc = addItem(doc, makeRoom('room', 320, 150, 100, 100, `${o.floor}02`.replace('-', '')));
      doc = addItem(doc, { id: newId(), type: 'hall', x: 100, y: 250, w: 400, h: 40 });
      doc = addItem(doc, { id: newId(), type: 'compass', x: 450, y: 350, deg: 0 });
      o = { ...o, door: true };
    }
    if (o.door) doc = addItem(doc, { id: newId(), type: 'door', x1: 200, y1: 100, x2: 240, y2: 100, label: { x: 220, y: 130 }, kind: 'EXIT' });
    const project = {
      id: crypto.randomUUID(), slug: o.slug, name: o.building, createdAt: Date.now(), savedAt: 0, doc, photo: null,
      view: { zoom: 1, panX: 0, panY: 0, onion: 0.5 }, history: { past: [], future: [] },
    };
    await saveNow(project);
    return { id: project.id, slug: project.slug };
  }, opts);
}

export async function openTrace(page, slug) {
  await page.evaluate((s) => { location.hash = `#/p/${s}/trace`; }, slug);
  await page.waitForFunction((s) => window.__app.project && window.__app.project.slug === s && document.getElementById('studio') && !document.getElementById('studio').hidden, slug);
  await page.waitForSelector('#stage .canvas-container');
}

// Deletes every project in IndexedDB whose id is listed (or all projects of a building).
export async function cleanup(page, ids) {
  await page.evaluate(async (list) => {
    const { deleteProject, listProjects } = await import('/js/store/autosave.js');
    const all = await listProjects();
    for (const p of all) if (list.includes(p.id)) await deleteProject(p.id);
  }, ids);
}

export async function allProjects(page) {
  return page.evaluate(async () => (await (await import('/js/store/autosave.js')).listProjects()));
}

// Minimal zip reader for "store" zips: returns [{ name, size }] by walking local file headers.
export function zipEntries(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = [];
  let p = 0;
  while (p + 30 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true);
    const name = buf.subarray(p + 30, p + 30 + nl).toString('utf8');
    out.push({ name, size, data: buf.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size) });
    p += 30 + nl + xl + size;
  }
  return out;
}
