#!/bin/bash
# the six single-photo floors through the real flow: tools/run-singles.sh <outDir>
P="C:/Users/sebastian/Desktop/maps/_source-photos"
OUT=${1:-tools/auto}
one() { node tools/build-floor.mjs "{\"building\":\"$1\",\"property\":\"$2\",\"code\":\"$3\",\"slug\":\"$3-$4\",\"floor\":$4,\"photos\":[\"$P/$5.webp\"]}" "$OUT" 2>&1 | head -1; }
one "Hadley Hall" 172 hh 1 hadley-f1
one "Hadley Hall" 172 hh 2 hadley-f2
one "Gardiner Hall" 188 gn 1 gardiner-f1
one "Gardiner Hall" 188 gn 2 gardiner-f2
one "Biology Annex" 82 bx 1 bioannex-f1
one "Rentfrow Hall" 211 rh 1 rentfrow-f1
