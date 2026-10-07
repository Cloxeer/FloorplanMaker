# Finishing one floor: from AutoBuild's draft to an accurate copy of the poster

You are given one floor that AutoBuild drew from a photographed NMSU "Emergency Evacuation Plan" poster. Your job is to compare
the draft with the photo, room by room, and correct it until the plan is a faithful, clean, CAD-quality copy. You work on
**your own copy** of the project file and write the corrections as small JSON "ops" with `tools/floorkit.mjs`.

Run everything from the repo root `C:\Users\sebastian\Desktop\Coding\Tools\FloorplanMaker`. The app must be served on
http://localhost:8080 (it is running; floorkit only uses it to draw pictures).

## What a good result is
* Every room of the poster is on the plan, with the room number **exactly as printed** (letters included: `132E`, `R117B`, `W289`, `J184`, `M100`, `2ST1`...), in the right place and about the right size. Room edges follow the walls in the photo (they may be rectangles; an L-shaped room may be a polygon, but prefer rectangles that tile the real shape).
* A room number starts with the floor digit (floor 1 -> 1xx, floor 3 -> 3xx; `W` / `R` / `S` / `T` / `M` / `J` / `H` prefixes are fine: `W289` is a floor-2 room). A 131 on floor 3 is a misread.
* No two rooms share a number. No room overlaps another (walls are shared, boxes touch). Rooms stay inside the outline.
* Elevator = a `core` room named `Elevator`; restrooms = `core` named `Restrooms`; "open to below" areas = `void` rooms (no number). Stairs = `stair` items (labels like ST1 belong to the stair, not to a room). Big named rooms may carry a name (Lecture Hall, Computer Lab...).
* Hallways (`hall` items) are the corridors: the open space between rooms where the blue evacuation arrows run. Not empty paper, not room interiors. Corridors that meet are connected.
* The outline is the building's outer wall as printed (not the paper edge, not the caption). EXIT doors (`door` items, kind EXIT) sit on the outline where the poster has a red exit sign at the outside wall.
* One compass, pointing the way the poster's compass does (deg = clockwise from straight up to the N end).
* Coordinates are on a 5-unit grid where possible.

## Tools (all take the project file path)
```
node tools/floorkit.mjs show   <file>              every room / hall / stair / door with ids, positions, numbers
node tools/floorkit.mjs check  <file>              the app's own checks (duplicate numbers, overlaps, wrong-floor numbers...)
node tools/floorkit.mjs render <file>              writes <file-base>.overlay.png (the plan drawn over the photo, with a grid labelled in plan units) and <file-base>.svg.png (the finished map)
node tools/floorkit.mjs view   <file> x y w h      zoomed overlay of a plan-unit region -> <file-base>.view.png  (use this to read small text and check edges; w,h of 150-400 is good)
node tools/floorkit.mjs apply  <file> <ops.json>   apply an array of ops, save, re-render
```
The op list is documented at the top of `tools/floorkit.mjs` (setNumber, setBox, setName, addRoom, deleteRoom, addHall/setHall/deleteHall, addStair, addDoor, moveItem, setOutline, setCompass). Rooms are addressed by `number`, `id`, or `at:[x,y]` (smallest room containing that plan point). View the PNGs with the Read tool. The original photos (low resolution: read them with the Read tool too) are in `C:\Users\sebastian\Desktop\maps\_source-photos\`.

## Method
1. `show`, then look at `<base>.overlay.png` and the source photo. Pink boxes are numbered rooms, orange boxes have no number, blue = halls, green = outline. The grid lines are labelled in plan units.
2. Work region by region with `view`. For each room box compare with the photo: right number? right extent? Missing rooms? Boxes that cover two rooms or cut one in half? Junk (boxes on the legend, on paper margin, on exit signs)? Wrong halls? Wrong outline?
3. Write ops in batches (a file under your work folder), `apply`, `view` again. Check your work with the overlay, not by trust. Use `check` until it reports no errors; remaining warnings must be justified (e.g. rooms with no number because the number is hidden by the You-Are-Here pin and cannot be inferred).
4. Do not invent: if a number is unreadable, say so in your report (and leave it blank) unless neighbours make it certain.
5. When finished run `render`, then copy `<base>.floorplan.json` and `<base>.svg` to the output folder you were given, and look at the final `<base>.svg.png` once more.

## Report back (short)
* what you fixed (counts), what is still uncertain (list rooms/areas);
* **systematic AutoBuild failures** you saw (e.g. "numbers read as ...", "rooms next to the legend", "halls drawn on blank paper", "outline includes the caption") so the algorithm can be improved: be specific and give examples with coordinates.
