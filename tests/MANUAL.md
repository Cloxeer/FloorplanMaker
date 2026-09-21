# Manual test checklist

Mirrors `tests/browser/smoke.spec.js`. Run against `npx --yes serve -l 8080 .`
at <http://localhost:8080/>. Numbers match the automated spec's steps.

## 1. Start blueprint

1. On the start screen, click **Start blueprint**.
2. Fill Building name, NMSU property number, Floor number. File name auto-fills
   as you type (e.g. "Hardman Jacobs Learning Center" / floor 1 -> `hjlc-1`).
3. Click **Start**.
   - Expected: the "Straighten the evacuation plan photo" screen appears.

## 2. Add photo

4. Drop `samples/hjlc-1-straight.jpg` (or another sample) onto the drop zone,
   or use "Choose a photo".
5. Drag the four blue corner handles onto the map outline in the photo (or
   leave the default 5%-inset corners for a quick check).
6. Click **Straighten**.
   - Expected: the studio screen appears, with the photo as a faint
     onion-skin background sized to fill the canvas.

## 3. Draw the floor outline

7. Click **Outline (F)** in the palette (or press `F`).
8. Click 4 points inside the canvas to trace the outer wall.
9. Press **Enter** to close the outline.
   - Expected: a floor polygon appears; the hint bar no longer prompts for
     outline corners.

## 4. Draw a room

10. Click **Room (R)** (or press `R`).
11. Drag a rectangle inside the floor outline (at least 10x10 plan units).
12. On release, a number-entry dialog appears. Type `128B` and click **OK**
    (or press Enter).
    - Expected: a room rectangle with label "128B" appears.

## 5. Duplicate in a row

13. Switch to **Select (V)**, click the room's edge or corner (not dead on
    its number label, which instead starts a label drag).
14. Press `D`.
    - Expected: a new room appears flush to the right (or below, if it would
      overflow the floor), with the number field pre-filled `128C`.
15. Click **OK**.

## 6. Drop a door

16. Click **Door (O)** (or press `O`).
17. Click a point on the floor outline edge (within ~12 plan units).
    - Expected: a door mark (white gap + EXIT text) appears on the wall.

## 7. Validation

18. Open the **Validation** panel (right side, below Properties).
    - Expected: "0 errors" (a "room unreachable" warning is fine if no other
      door/room path exists to it — this only requires 0 *errors*).

## 8. Reload / autosave

19. Wait ~1 second (autosave debounces 300ms before writing to IndexedDB),
    then reload the page (F5).
    - Expected: you land back on the start screen and a project card for
      this building/floor is present.
20. Click **Open** on that card.
    - Expected: the same floor outline, rooms and door reappear.

## 9. Export

21. Click **Export**.
    - Expected: two files download — `<slug>.svg` and `<slug>-posted.jpg` —
      and a dialog shows the `building-extras.json` snippet plus two commands
      to run, each with a Copy button.
22. Close the dialog.

## 10. Import .svg round-trip

23. Click **Projects** to return to the start screen.
24. Click **Import .svg** and choose the `.svg` file downloaded in step 21.
    - Expected: the studio reopens with the same floor/rooms/door recreated
      from the SVG (no crash, no toast error).
25. Click **Export** again.
    - Expected: the newly downloaded `.svg` is byte-identical to the one
      from step 21 (diff the two files if you want to confirm exactly).

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
