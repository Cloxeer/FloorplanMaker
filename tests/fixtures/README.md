# tests/fixtures — hand-traced HJLC floor plans

`hjlc-1.svg` and `hjlc-2.svg` were hand-traced directly from the posted
"Emergency Evacuation Plan" photos (floors 1 and 2 of Hardman and Jacobs
Undergraduate Learning Center, property 323, 2902 McFie Circle), because
the map site's tools/build_rooms.py repository was not available in this environment to pull
an existing trace from.

`hjlc-1.svg` was traced from `samples/hjlc-1-straight.jpg`, a
perspective-straightened version of the floor-1 photo. Its viewBox is
`0 0 1220 1888` (the straightened image's own pixel size), not the
1500x2000 used by `hjlc-2.svg` below.

## Room / door / stair counts

### hjlc-1.svg (Floor 1)
- Rooms (`room`/`big`/`core`): 49
  - `big`: Student Success 128R, Lecture Hall 125, Classroom 126, Computer Lab 101, Help Desk 105 (5)
  - `core`: M127, M123, S122, S125, M118 (5)
  - `room`: remaining 39
- Voids (no label): 1 (elevator)
- Stairs (`g.stair`): 4 (ST1, corridor stair near 128P/T130, stair near M118/elevator, bottom stair near R108)
- Doors (`line.door` + EXIT text): 4 (two on left wall near M127/M123, one on right wall near 103/105A, one at bottom near R108)

### hjlc-2.svg (Floor 2)
- Rooms (`room`/`big`/`core`): 22
  - `big`: ICT Training Lab 206, Classroom 210, Classroom 225, Classroom 230, Classroom 228 (5)
  - `room`: remaining 17
- Voids (no label): 4 (three "Open to Below" areas + elevator)
- Stairs (`g.stair`): 4 (ST4, top DOWN stair near M214, left-middle DOWN stair near elevator, bottom-right DOWN stair near Classroom 228)
- Doors (`line.door` + EXIT text): 3 (top near M214, left near the stairs, bottom right near Classroom 228)
