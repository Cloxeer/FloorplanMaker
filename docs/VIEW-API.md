# View-layer API (what main.js wires together)

All view modules are ES modules that receive the shared `app` object. Nothing
in `js/model` touches the DOM; everything in `js/view` may.

## `app` (created in js/main.js)

```js
app = {
  project,            // project record (see ARCHITECTURE.md) or null on the start screen
  doc,                // current document (immutable snapshots)
  selection: Set,     // item ids
  tool,               // current tool object
  toolName,           // 'select' | 'room' | 'poly' | 'floor' | 'door' | 'stair' | 'compass' | 'pan'
  magnet: true,       // Alt held -> temporarily false (main.js tracks the key)
  gridOn: true,
  onion: 0.5,         // photo opacity 0..1
  canvas,             // canvas object (see below)
  validation: [],     // last validate() results (+ room-unreachable warnings from the route worker)
  clipboard: null,

  commit(newDoc, label)        // push undo snapshot, set app.doc, emit 'doc', autosave
  replaceDoc(newDoc)           // no undo entry (used by undo/redo/import)
  undo() / redo()
  setSelection(ids)            // emits 'selection'
  setTool(name)                // cancels current tool, emits 'tool', updates hint
  setHint(text)                // bottom one-line hint
  snap(pt, opts)               // -> {x,y,guides}; applies magnet+grid using geometry.magnetSnap; opts: { ignoreIds:Set, box:{x,y,w,h} }
                               // also calls canvas.setGuides(guides). Returns pt unchanged when app.magnet is false and grid off.
  prompt(title, defaultValue)  // -> Promise<string|null>; small inline dialog (number entry). Enter confirms, Esc cancels.
  confirm(text)                // -> Promise<boolean>
  toast(text)                  // transient message
  subscribe(fn)                // fn(evt) with evt.type in 'doc'|'selection'|'tool'|'view'|'saved'|'validation'|'project'|'route'; returns unsubscribe
  duplicateInRow(id)           // clone room flush against the previous one (to the right, or below if it would leave the floor bbox), ask for the number (auto-incremented), commit
  copy() / paste()             // multi-selection with relative layout; paste offers auto-increment via app.confirm
  routeToRoom(id)              // asks the route worker; emits 'route' with {roomId, reachable, path}; canvas.setRoutePath
  exportAll()                  // runs validate; if errors -> shows the validation panel and refuses; else downloads svg+jpg and shows the export dialog
  openProject(project) / closeProject()
}
```

## `canvas.js`

```js
createCanvas(svgEl, app) -> canvas
canvas.setDoc(doc)                 // diff render (add/remove/update nodes by data-id)
canvas.patchNode(id, attrs)        // set attributes on an existing node (used during drags, no re-render)
canvas.patchLabel(id, {x,y,text,cls})
canvas.setSelection(ids)           // draw selection outline + 8 resize handles + repeat handle (small "+" at the right edge) for a single room
canvas.setGuides([{axis,at}])      // magnet guide lines
canvas.setGhosts([{x,y,w,h,number,index}])  // suggestion ghosts; clicking one dispatches app event 'ghost-accept' with the index
canvas.setRoutePath([[x,y]...])    // arrow polyline
canvas.setPhoto(photo|null)        // onion-skin <image>, sized to viewBox
canvas.setOnion(opacity) / flashPhoto(on)
canvas.setGrid(on)
canvas.toPlan(clientX, clientY) -> {x,y}
canvas.zoomTo(fit=true) / setView({zoom,panX,panY}) / getView()
canvas.hitTest(clientX, clientY) -> { id, part } | null   // part: 'body' | 'label' | 'handle:nw'... | 'repeat' | 'floor-vertex:i' | 'floor-edge:i'
canvas.onPointer(handler)          // handler(kind:'down'|'move'|'up'|'cancel', e, pt) after pan/zoom gestures are filtered out
canvas.destroy()
```

Rendering conventions: rooms as `<rect>/<polygon class="room|big|ours|core|void">`
(void drawn hatched grey via a CSS class `void`), labels as `<text class="lbl|lblS">`,
name texts, stairs as `<g class="stair">` with lines, doors as `<line class="door">`
over a dark floor stroke so the white gap reads as a door, plus EXIT text; the
floor polygon with class `floor`; the compass group. Use the same class names as
the export so the studio looks like the final file. Label text nodes carry
`data-id` and `data-part="label"`. Grid is an `<pattern>`-filled rect (studio
only; never exported).

## Tools (`js/view/tools/*.js`)

```js
createSelectTool(app) / createRoomTool(app, {poly:false}) / createFloorTool(app) /
createDoorTool(app) / createStairTool(app) / createCompassTool(app) / createPanTool(app)
-> { name, hint, onDown(e, pt), onMove(e, pt), onUp(e, pt), onKey(e) -> handled:boolean, cancel(), onDoubleClick?(e, pt) }
```

`pt` is the raw plan-space point. Tools call `app.snap` themselves. During a
drag the tool calls `canvas.patchNode` for live feedback and commits once on
pointer-up. Select tool handles: click/shift-click select, marquee, move
(magnet: vertices, extended edges, floor outline, grid, equal spacing), resize via
handles, label nudge (drag a label -> pins it), repeat handle drag ->
`app.duplicateInRow`, Delete key, arrow keys nudge by 1 (Shift 10), 1..5 change
class of selected rooms, D duplicate in row, floor vertex drag when the floor is
selected, double-click a room -> rename number prompt.

Room tool: drag a rectangle (min 10x10), snap, on pointer-up prompt for the
number then commit (Esc cancels). Poly variant: click corners, Enter or click
the first corner closes, then prompt. Number keys 1-5 before drawing set the class.
Floor tool: click outline corners, Enter/double-click closes; if a floor exists,
the tool edits its vertices (drag) and adds a vertex on edge click.
Door tool: only accepts clicks within 12 units of the floor outline; uses
`doorFor`; commits a door with kind EXIT; hint says "Click on the outside wall to place a door".
Stair tool: drag a rect (default palette size on click). Compass tool: click to place.

## Panels (`js/view/panels/*.js`)

Each: `mountXxx(containerEl, app) -> { update(evt), destroy() }` and subscribes via `app.subscribe`.

* `palette.js`: drag-and-drop pieces (room, small room, big room, our room,
  restroom core, elevator core, stair block, door, void, compass). Dragging a
  piece onto the canvas (Pointer Events, works on touch) drops it at the pointer
  with the standard size from `STD.palette`, snapped; rooms prompt for the
  number; door piece switches to the door tool. Also tool buttons with hotkeys.
* `properties.js`: for the selection: number, name, class (radio 1-5), show name
  toggle, font-size override (auto / 24 / 19 / custom), label "Re-center" (un-pin,
  shows a pin icon when pinned), section dropdown, door kind toggle EXIT/Door,
  stair direction, compass rotation, x/y/w/h numeric fields, plus align buttons
  when 2+ selected: left, right, top, bottom, center-h, center-v, distribute-h,
  distribute-v, match width, match height, square up. Floor selected: point count
  and "Remove outline".
* `validation.js`: list of problems; click -> select item and center it; shows
  counts; errors block export (export button disabled with reason).
* `projects.js`: start screen: list of projects (open, delete, duplicate), "Start
  blueprint" button, "Open .json project" file input.
* `blueprint.js`: `showBlueprint() -> Promise<{building, property, floor, slug}|null>` modal with 4 fields, slug auto-suggested (e.g. hjlc-1), validation.
* `photoStep.js`: `mountPhotoStep(containerEl, { onDone(photo), onSkip() })`. Drop zone / file input, shows image on a `<canvas>`, four draggable corner handles (Pointer Events), "Straighten" computes a homography from the 4 corners to an axis-aligned rect whose size is the average of the quad's side lengths (rounded), warps by inverse mapping per pixel (nearest neighbour is fine), produces JPEG dataUrl (quality 0.85), returns `{dataUrl, width, height, corners, originalDataUrl}`. Corners default to 5% inset.
* `suggest.js`: "Suggest rooms" button: sends the photo pixels to trace.worker, shows ghosts via canvas.setGhosts, then runs OCR on the regions (progress bar), fills numbers; "Accept all" / click one to accept / "Dismiss". Accepted ghosts become rect rooms (class room) via app.commit. Nothing enters the doc until accepted.
* `exportDialog.js`: `showExportDialog(app, {svgText, jpgDataUrl, meta})` downloads `<slug>.svg` and `<slug>-posted.jpg`, shows the JSON snippet and the two commands with copy buttons.

## index.html ids

`#start` (projects screen), `#photo-step`, `#studio` (the build screen),
`#topbar` (project name, undo/redo, Suggest rooms, Save .json, Export, saved chip
`#saved-chip`, onion slider `#onion`), `#palette`, `#stage` containing
`<svg id="canvas">`, `#props`, `#validation`, `#hint`, `#dialogs`.
Screens toggled with the `hidden` attribute.
