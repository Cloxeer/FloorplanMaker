#!/bin/bash
cd /c/Users/sebastian/Desktop/Coding/Tools/FloorplanMaker
f=tools/work/cb-1-1957/cb-1-1957.floorplan.json
node tools/floorkit.mjs view $f $1 $2 $3 $4 >/dev/null
cp tools/work/cb-1-1957/cb-1-1957.view.png tools/work/cb-1-1957/v_$1_$2_$3_$4.png
