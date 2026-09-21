# Floor-plan SVG dialect (BetterNMSUMaps)

This is the exact output contract. The parsers in BetterNMSUMaps
(`tools/build_rooms.py`, `tools/build_entrances.py`, `tools/indoor_routes.py`)
read these files. Do not deviate.

## Root

```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="minX minY width height" font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif">
```

* Plan units are the straightened photo's pixels. viewBox comes from the photo.
* All coordinates are integers.
* No `transform` on anything except the compass group.
* No `<defs>`, `<image>`, `id` attributes, or inline `style` attributes.

## Header comment (right after the root tag)

```
<!--
  <Building name> (bldg <property number>) - FLOOR <n>
  Traced from the posted "Emergency Evacuation Plan" photo. Coordinates use the
  photo's own pixel positions, so any shape can be checked against the photo.
  One wall weight for outside walls, one for inside walls; nothing in between.
-->
```

## Style block (verbatim, one per file)

```
<style>
.floor { fill: #ffffff; stroke: #3a3d42; stroke-width: 6; stroke-linejoin: round; }
.room  { fill: #eef1f4; stroke: #8f959c; stroke-width: 2; }
.big   { fill: #e6ecf5; stroke: #8f959c; stroke-width: 2; }
.ours  { fill: #f5e3ea; stroke: #8f959c; stroke-width: 2; }
.core  { fill: #dfe3e8; stroke: #8f959c; stroke-width: 2; }
.stair { stroke: #8f959c; stroke-width: 2; }
.door  { stroke: #ffffff; stroke-width: 10; }
.lbl   { fill: #2b2e33; font-size: 24px; text-anchor: middle; dominant-baseline: middle; }
.lblS  { fill: #2b2e33; font-size: 19px; text-anchor: middle; dominant-baseline: middle; }
.name  { fill: #1d1f23; font-size: 30px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
.exit  { fill: #1a7f37; font-size: 20px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
.compass-letter { font-size: 22px; font-weight: 600; fill: #8a8690; text-anchor: middle; }
.compass-north  { fill: #8C0B42; }
</style>
```

## Allowed elements (nothing else)

| Element | Rule |
|---|---|
| `<polygon class="floor" points="...">` | Exactly one. The walkable footprint. |
| `<rect>` / `<polygon>` with class `room`, `big`, `ours`, `core`, `void` | Blocks routing. Corridors are empty floor. `void` has no label. |
| `<g class="stair">` containing only `<line>` treads | Treads 18 units apart. Bounding-box center = arrival point on floors above 1. |
| `<line class="door" x1 y1 x2 y2>` | Lies on the floor outline (outer wall). Midpoint is the entrance. 36 units long. |
| `<text class="exit" x y>EXIT</text>` or `Door` | Within 100 units of a door midpoint. `Door` variant carries `fill="#5f6368"`. Label sits 55 units inside the wall. |
| `<text class="lbl">` / `<text class="lblS">` | At the room centroid. Text ends in the room number matching `(?:^|\s)([A-Z]?\d{3}[A-Z]?)$`. Words before the number are the room name. `lblS` (19px) is picked automatically when the room's short side is under 70 units. Per-element `font-size="Npx"` override allowed. |
| `<text class="name">` | Bold room name inside the same shape (optional). |
| `<g class="compass" transform="translate(x,y) rotate(deg)">` | Optional, copied verbatim (see below). |
| `<!-- SECTION -->` comments | e.g. `<!-- TOP ROW: 128 suite offices -->`. |

Element order in the file: header comment, style, floor polygon, then rooms
(grouped under section comments; each room shape followed immediately by its
label texts), then stairs, then doors + exit labels, then compass.

## Compass group (verbatim)

```
<g class="compass" transform="translate(X,Y) rotate(DEG)">
  <circle r="26" fill="none" stroke="#8a8690" stroke-width="2"/>
  <polygon class="compass-north" points="0,-24 7,0 -7,0"/>
  <polygon points="0,24 7,0 -7,0" fill="#8a8690"/>
  <text class="compass-letter" y="-32">N</text>
</g>
```

## Sizes

* outside wall stroke 6, inside stroke 2
* door 36 long; exit label 55 inside the wall
* stair treads 18 apart
* label 24px (`lbl`) or 19px (`lblS`) when short side < 70
* grid 5 units

## File names

`data/floors/<slug>.svg` and `data/floors/<slug>-posted.jpg`, e.g. `hjlc-1.svg`.

## `data/source/building-extras.json` snippet

```json
"<property number>": {
  "name": "<Building name>",
  "floors": { "<n>": "<slug>" }
}
```

Then run:

```
python tools/build_rooms.py
python tools/build_entrances.py
```
