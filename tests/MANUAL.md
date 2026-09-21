# Manual test checklist

Mirrors `tests/browser/smoke.spec.js` and `tests/browser/walkthrough.spec.js`
(the guided, "as a person would actually use it" flow). Run against
`npx --yes serve -l 8080 .` at <http://localhost:8080/>.

## The guided four-step flow

The app's own step strip (top of the studio) names these steps: **1 Photo ·
2 Trace · 3 Export**; blueprint entry is the implicit step before Photo. This
checklist walks all four in order, matching `walkthrough.spec.js`.

### Step 1 — Start blueprint

1. On the start screen, click **Start blueprint**.
2. Fill Building name (`HJLC`), NMSU property number (`323`), Floor number
   (`1`). File name auto-fills as you type (e.g. `hjlc-1`); edit it to
   `hjlc-1-walkthrough` if you want a throwaway project.
3. Click **Start**.
   - Expected: the "Straighten the evacuation plan photo" screen appears.

### Step 2 — Photo: choose, straighten

4. Choose `samples/hjlc-1-posted.jpg` (drop it or use "Choose a photo").
   - Expected: the photo fills the available area **without overflowing the
     viewport** — all 4 blue corner handles must be visible on screen, even
     on a short window. (This is the fix for the "handles off-screen on a
     tall photo" bug: the image is scaled to fit `viewport height - header`,
     handles scale with it, and the straighten math still runs in the
     original photo's pixel space.)
5. Drag the four corner handles onto the building outline in the photo.
6. Click **Straighten**.
   - Expected: the studio screen appears, with the straightened photo as a
     faint onion-skin background, and the **"Start by outlining the
     building"** overlay card centered on the canvas.

### Step 3 — Trace: outline, doors, rooms, hallway, compass

7. Click **Draw outline** on the overlay card.
   - Expected: the overlay disappears and the floor tool is active
     immediately — click 4 corners of the building **right away**; the very
     first click must register as the first outline point (this was
     previously lost, requiring a second attempt).
8. Press **Enter** to close the outline.
   - Expected: a floor polygon appears.
9. Click **Door (O)** in the palette, then click the left wall twice.
10. Press **Esc** to leave the door tool.
    - Expected: two door marks (white gap + EXIT text) appear on the wall.
11. Wait for the **"We found N rooms"** bar at the bottom (auto-suggest runs
    on its own once the outline exists on a fresh project; it can also be
    run again via View > Find rooms on the photo).
12. Click **Keep all**.
    - Expected: all suggested rooms are added in one commit. Open the
      **Checklist** panel immediately (don't wait) — "Every room has a
      number" must show the correct pending mark (○) right away if any
      room lacks a number, not a stale ✓ that "corrects itself" a moment
      later.
13. Click an unnumbered room, type `101` in the **Number** field.
    - Expected: the room's label updates immediately.
14. Click **Hallway (A)**, drag a guide box across a corridor.
    - Expected: a translucent hallway guide appears. It will **not** appear
      in the exported SVG (hallways are a studio-only guide) — confirm this
      in step 16.
15. Press `C`, then click to place the compass; select it and click
    **Rotate +15°** in Properties.
    - Expected: the compass rotates 15° clockwise.

### Step 4 — Export

16. Click **Export**.
    - Expected: two files download — `<slug>.svg` and `<slug>-posted.jpg` —
      and a dialog shows the `building-extras.json` snippet plus two
      commands to run, each with a Copy button. Open the `.svg`: it should
      contain one floor polygon, all the kept room rects, exactly 2 `EXIT`
      texts, a `rotate(15)` on the compass, no hallway shapes, and no empty
      `<text>` elements.
17. Close the dialog.

## Extra checks (not part of the 4-step flow)

### Duplicate in a row

18. Switch to **Select (V)**, click a room's edge or corner (not its number
    label, which instead starts a label drag), press `D`.
    - Expected: a new room appears flush to the right (or below, if it
      would overflow the floor), with the number field pre-filled with the
      next letter (e.g. `128B -> 128C`).

### Reload / autosave

19. Wait ~1 second (autosave debounces before writing to IndexedDB), reload
    (F5), then **Open** the project card.
    - Expected: the same floor outline, rooms, doors, hallway and compass
      reappear.

### Import .svg round-trip

20. From the start screen, click **Import .svg** and choose the `.svg` from
    step 16.
    - Expected: the studio reopens with the same floor/rooms/doors recreated
      from the SVG (no crash, no toast error; hallways will be absent, since
      they were never in the SVG to begin with).
21. Click **Export** again.
    - Expected: the newly downloaded `.svg` is byte-identical to the one
      from step 16 for everything except hallways (which round-trip through
      the `.json` project only, not the SVG).

---

## Touch / iPad notes

- **Pinch-zoom the canvas**: with two fingers on `#stage`, pinch in/out.
  The canvas uses Pointer Events for its pan/zoom gestures
  (`js/view/canvasInput.js`), so this should behave the same as a trackpad
  pinch — zoom stays centered between the two touch points, no page-level
  zoom should trigger (the canvas sets `touch-action: none`).
- **Dragging palette pieces via touch**: press and hold a piece chip in the
  left palette, drag it onto the canvas, and release. `palette.js` uses
  Pointer Events (`pointerdown`/`pointermove`/`pointerup`) with pointer
  capture, which works identically for touch and mouse; a small drag ghost
  should follow your finger. A plain tap (no drag) instead places the piece
  at the center of the current view.
- **Dragging photo corner handles via touch**: on the "Straighten" screen,
  press and drag each of the 4 blue circular handles onto the photo's real
  corners. `photoStep.js` also uses Pointer Events with pointer capture, so
  a finger drag should track as smoothly as a mouse drag; verify the handle
  doesn't "let go" if your finger moves fast (pointer capture should prevent
  that).

## Two-tab autosave check

`js/store/autosave.js` broadcasts every successful save over a
`BroadcastChannel` named `nmsu-fps`, and `js/mainActions.js`
(`onExternalChangeForProject`) listens for changes to the *currently open*
project from another tab.

1. Open the same project in two browser tabs (Tab A and Tab B), both in the
   studio view.
2. In Tab A, move a room (drag it, or nudge with an arrow key) so a commit
   happens and autosave fires.
3. Switch to Tab B without touching it.
   - Expected: Tab B's project is suspended for further local autosaves
     (`suspend(id)`), and a bar appears at the bottom of the dialogs layer
     reading exactly: **"This project changed in another tab."** with a
     **Reload** button.
4. Click **Reload** in Tab B.
   - Expected: Tab B loads the latest saved doc from IndexedDB (Tab A's
     move is now visible in Tab B), the bar disappears, and Tab B resumes
     normal autosaving (`resume(id)`).

Note: there is no separate "changed" indicator on `#saved-chip` itself — the
chip only ever shows the last-saved-ago text (e.g. "Saved · just now"); the
actual "changed elsewhere" signal is the reload bar described above.

## 300-room stress check

`suggest.js` ("Suggest rooms") runs OCR against the photo and is meant for
tracing a real evacuation map, not for bulk-generating test data — use
**copy/paste** instead, which "offers auto-increment" per the hotkey table:

1. Draw one room (e.g. `100`), select it, `Ctrl+C` to copy.
2. `Ctrl+V` to paste; when prompted "Auto-increment room numbers?", accept.
   A clone appears offset by (20, 20) plan units, numbered `101` (or the
   next increment).
3. Repeat `Ctrl+V` (no need to re-copy — `app.clipboard` still holds the
   original selection) roughly 300 times, or write a short loop using your
   browser's devtools console calling `app.paste()` directly if you want to
   avoid 300 manual keypresses.
4. While pasting, watch for:
   - **Performance**: the canvas should keep re-rendering promptly after
     each paste (diff-render via `canvas.setDoc`); no long freezes.
   - **No console errors**: open devtools console, confirm nothing is
     logged there or via unhandled-rejection toasts.
   - **Validation panel still correct**: with ~300 uniquely-numbered rooms
     inside the floor outline, `0 errors` should still show (duplicate
     numbers would show as `duplicate-number` errors — a case worth
     testing deliberately as a negative check).
   - **Export still works**: click Export and confirm the `.svg` downloads
     without hanging and contains all ~300 `<rect class="room">` elements
     (grep the downloaded file, or eyeball the room count against the
     Validation panel's "no problems" list length).
