# Architecture and module contracts

Plain HTML + CSS + ES modules. No build step. No server. Libraries only from
cdnjs / jsDelivr, version-pinned, and only Tesseract.js (lazy, in a Worker).
Every file starts with a comment: what it does, what it depends on.
No file over 400 lines. `js/model/*` is pure (no DOM, no window).

```
index.html   README.md   LICENSE   docs/DIALECT.md   docs/ARCHITECTURE.md
css/studio.css
js/main.js
js/model/{document,validate,svgExport,svgImport,geometry,route}.js
js/view/{canvas.js, tools/*.js, panels/*.js}
js/store/autosave.js
js/workers/{trace,route}.worker.js
tests/
```

## Document shape (`js/model/document.js`)

```js
{
  version: 1,
  meta: { building: 'Hardman and Jacobs Undergraduate Learning Center', property: '323', floor: 1, slug: 'hjlc-1' },
  viewBox: { x: 0, y: 0, w: 1500, h: 2000 },     // from straightened photo; never changes after
  floor: null | { points: [[x,y], ...] },           // polygon, integer coords
  items: [ Item, ... ],
  sections: [ { id, title } ]                      // optional grouping for section comments; rooms carry section id
}
```

The photo is NOT part of the undo document. It lives in the project record:

```js
project = {
  id, slug, name, createdAt, savedAt,
  doc,
  photo: { dataUrl, width, height, corners: [[x,y],[x,y],[x,y],[x,y]], originalDataUrl } | null,
  view: { zoom, panX, panY, onion: 0.5 },
  history: { past: [docJsonString...], future: [docJsonString...] }
}
```

### Items (all coords integers; `id` is internal only, never exported)

```js
{ id, type:'room', cls:'room'|'big'|'ours'|'core'|'void', shape:'rect', x,y,w,h,
  number:'128B', name:'', label:{ pinned:false, x:null, y:null, fontSize:null }, showName:false, section:null }
{ id, type:'room', cls, shape:'poly', points:[[x,y],...], number, name, label, showName, section }
{ id, type:'stair', x,y,w,h, dir:'v' }               // dir 'v' = treads are horizontal lines stacked down the y axis, 18 apart; 'h' = vertical lines across x
{ id, type:'door', x1,y1,x2,y2, kind:'EXIT'|'Door', label:{ x,y } } // on the floor outline, 36 long
{ id, type:'compass', x, y, deg }
```

Class hotkeys 1..5 = room, big, ours, core, void.

### Exports of `document.js` (pure, immutable: functions return new docs, never mutate)

```js
createDoc(meta, viewBox) -> doc
newId() -> string
addItem(doc, item) -> doc
updateItem(doc, id, patch) -> doc          // shallow merge; label patch merges into label
removeItems(doc, ids) -> doc
setFloor(doc, points|null) -> doc
addSection(doc, title) -> { doc, id }
getItem(doc, id) -> item | undefined
roomPolygon(item) -> [[x,y],...]           // rect or poly as point list
roomCentroid(item) -> {x,y}
roomShortSide(item) -> number              // min(w,h) for rect; min bbox side for poly
labelPos(item) -> {x,y}                    // pinned label pos or centroid (rounded)
labelClass(item) -> 'lbl'|'lblS'           // short side < 70 -> lblS
labelText(item) -> string                  // name ? `${name} ${number}` : number
nextNumber(n) -> string                    // '128B'->'128C', '128'->'129', 'S117'->'S118', '128Z'->'128Z', ''->''
stairTreads(item) -> [{x1,y1,x2,y2},...]   // 18 apart, inset 0, starting at edge + 9
doorFor(outlinePoints, point) -> { x1,y1,x2,y2, label:{x,y} } | null
     // nearest point on outline; door 36 long centered there along that edge, clamped inside the edge;
     // label 55 units inward along the inside normal. Returns null if outline < 3 points.
makeRoom(cls, x, y, w, h, number='') -> item
STD = { wallOut:6, wallIn:2, doorLen:36, exitInset:55, tread:18, lbl:24, lblS:19, smallSide:70, grid:5, exitRadius:100,
        palette:{ room:{cls:'room',w:120,h:90}, small:{cls:'room',w:70,h:60}, big:{cls:'big',w:300,h:220},
                  ours:{cls:'ours',w:120,h:90}, restroom:{cls:'core',w:110,h:90,name:'Restrooms'},
                  elevator:{cls:'core',w:60,h:60,name:'Elevator'}, stair:{w:60,h:110}, void:{cls:'void',w:100,h:100} } }
NUMBER_RE = /^[A-Z]?\d{3}[A-Z]?$/
```

Undo/redo is snapshot based: `history.past.push(JSON.stringify(doc))`. Unlimited.

## `geometry.js` (pure)

```js
polygonCentroid(pts) -> {x,y}     // area-weighted; falls back to bbox center for degenerate
polygonArea(pts) -> number        // signed
pointInPolygon(pt:[x,y], pts) -> boolean
bbox(pts) -> {x,y,w,h}
rectToPoints({x,y,w,h}) -> [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
dist(a:[x,y], b:[x,y]) -> number
nearestPointOnSegment(p, a, b) -> {x,y,t}
nearestPointOnPolyline(p, pts, closed=true) -> {x,y,segIndex,dist}
segmentsIntersect(a,b,c,d) -> boolean       // proper intersection (shared endpoints/collinear touching = false)
polygonsOverlap(a, b) -> boolean            // proper edge intersection OR one contains the other's centroid; touching edges = false
isOnOutline(seg:{x1,y1,x2,y2}, outline, tol=2) -> boolean   // both endpoints within tol of an outline edge
insideNormal(outline, a:[x,y], b:[x,y]) -> [nx,ny]           // unit normal of edge a->b that points into the polygon
snapToGrid(v, g) -> number
magnetSnap(point:{x,y}, targets:{ xs:number[], ys:number[], vertices:[[x,y]] , grid:number|null }, tol=6)
   -> { x, y, guides:[{axis:'x'|'y', at:number}] }   // vertex snap beats edge snap beats grid
equalSpacingCandidates(movingBox, boxes) -> { xs:number[], ys:number[] }   // positions that give equal gaps to neighbours
```

## `validate.js` (pure)

`validate(doc) -> [{ level:'error'|'warning', code, message, itemId? }]`

Errors: `no-floor`, `floor-not-closed` (<3 points), `room-no-number` (non-void),
`bad-number-format` (must match NUMBER_RE), `duplicate-number`,
`door-off-outline` (isOnOutline false), `door-no-exit-label` (label further than
100 from midpoint), `void-with-label` (void with number or name),
`label-outside-shape` (labelPos not inside roomPolygon), `transform-present`
(doc.problems from import), `door-no-floor`.
Warnings: `overlapping-rooms` (pairwise, one entry per pair, itemId = first),
`label-tiny` (fontSize < 12), `room-unreachable` (added by the view from the route worker, not by validate).
Errors block export.

## `svgExport.js` (pure)

`exportSvg(doc) -> string` following docs/DIALECT.md exactly. Integer coords via
`Math.round`. Rooms grouped by section (section title becomes `<!-- TITLE -->`;
un-sectioned rooms under `<!-- ROOMS -->`, only emitted if any). Each room: shape
line then its `<text class="lbl|lblS" x y [font-size="Npx"]>TEXT</text>` line, then
`<text class="name" x y>NAME</text>` (placed 30 units above the label) if
showName and name. Void rooms have no label. Stairs: `<g class="stair">` with
`<line x1 y1 x2 y2/>` lines. Doors: `<line class="door" .../>` then
`<text class="exit" x y>EXIT</text>` (add `fill="#5f6368"` and text `Door` for
kind Door). Compass verbatim group. Two-space indentation, one element per line.
Also `exportExtrasSnippet(meta) -> string` and `exportCommands() -> string`
and `exportFileNames(meta) -> { svg, jpg }`. XML-escape text.

## `svgImport.js` (pure)

`importSvg(svgText) -> { doc, problems:[] }`. Hand-written regex tokenizer over
tags and comments (no DOM, works in Node). Reads viewBox, header comment
(building, property, floor), floor polygon, rooms (rect/polygon + following lbl/
lblS/name texts; parse number via `(?:^|\s)([A-Z]?\d{3}[A-Z]?)$`; label pinned if
its position differs from the centroid by > 1), stairs (bbox of lines), doors
(+ nearest exit text within 100), compass, section comments (become sections).
Round trip must preserve every coordinate, class, number, name, font-size
override, section title, door kind, compass. `transform` outside compass ->
problem `transform-present`. Unknown elements -> problem `unknown-element`.

## `route.js` (pure, also used by route.worker.js)

Grid-and-Dijkstra: rasterize the floor polygon at `cell` (default 10). A cell is
walkable if its center is inside the floor and not inside any room/void/stair
bbox. Start = door midpoints (all of them) for floor 1, stair centers for floors
above 1. Target = walkable cells adjacent to the room polygon (within 1 cell).
8-connected Dijkstra with diagonal cost sqrt2. Returns `{ reachable, path:[[x,y]...] }`
(path in plan units, simplified by dropping collinear points).
`buildGrid(doc, cell)`, `findPath(grid, starts, goals)`, `routeToRoom(doc, roomId, cell=10)`.

## `store/autosave.js`

IndexedDB database `nmsu-floorplan-studio`, store `projects` keyed by `id`.
`listProjects() -> [{id,slug,name,savedAt,floor,building}]`, `loadProject(id)`,
`saveProject(project)` (debounced 300ms; `flush()` saves now), `deleteProject(id)`,
`exportProjectJson(project) -> string`, `importProjectJson(text) -> project`,
`onExternalChange(cb)`: `BroadcastChannel('nmsu-fps')` posts `{id, savedAt, tab}`
after each save; a tab that receives a change for its open project shows
"Changed in another tab. Reload?" and suspends autosave until reload (prevents
two-tab races). `lastSaved()` -> Date for the "Saved · just now" chip.

## View

`canvas.js`: one `<svg>` element. Renders doc items to SVG nodes keyed by item
id (`data-id`), diff-updates attributes on change; drag updates attributes
directly on existing nodes; full rebuild only when items are added/removed.
Layers (groups): photo (`<image>` onion skin with opacity), grid, floor, rooms,
labels, stairs, doors, guides, selection handles, ghosts. Zoom/pan with wheel,
space+drag, two-finger pinch (touch). Pointer Events only (works on iPad,
`touch-action: none`). Exposes `toPlan(clientX, clientY)`, `setDoc(doc)`,
`patchNode(id, attrs)`, `setSelection(ids)`, `setGuides([])`, `setGhosts([])`,
`setOnion(opacity)`, `flashPhoto(on)`, `setGrid(on)`, `setRoutePath(pts)`.

`tools/*.js`: `select.js` (move, resize handles, repeat handle, marquee, label
nudge), `room.js` (drag rect / click polygon; prompts for number), `door.js`
(click on outline only), `floor.js` (click outline corners, Enter/double-click
closes), `stair.js`, `compass.js`, `pan.js`. Each tool:
`{ name, hint, onDown(e,pt), onMove(e,pt), onUp(e,pt), onKey(e), cancel() }`.

`panels/*.js`: `properties.js`, `palette.js`, `validation.js`, `projects.js`,
`exportDialog.js`, `photoStep.js` (four-corner straighten via canvas
homography warp), `suggest.js` (Tesseract + trace worker ghosts), `blueprint.js`.

Hotkeys: V select, R room, P polygon room, F floor, D duplicate-in-row (room
selected), O door, S stair, G grid, H flash photo (hold), 1-5 class, Delete,
Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+C / Ctrl+V, Alt = disable magnet, Esc
cancel, Enter confirm. Space = pan while held.

## Events / app state (`js/main.js`)

`app = { project, doc, selection:Set, tool, magnet:true, grid:true, onion, subscribe(fn), commit(newDoc, label) }`.
`commit()` pushes the previous doc to history, sets doc, re-renders diff,
revalidates, autosaves. Tools call `app.commit`. Drag previews use `canvas.patchNode`
and commit once on pointer-up.
