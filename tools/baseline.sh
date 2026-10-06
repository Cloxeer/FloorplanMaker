#!/bin/bash
# runs the single-photo flow on every source photo; usage: tools/baseline.sh [outDir]
P="C:/Users/sebastian/Desktop/maps/_source-photos"
OUT=${1:-tools/out}
run() { node tools/build-floor.mjs "{\"building\":\"$1\",\"property\":\"$2\",\"code\":\"$3\",\"floor\":$4,\"photos\":[\"$P/$5.webp\"]}" "$OUT" 2>&1 | head -3; }
run "Hadley Hall" 172 hh 1 hadley-f1
run "Hadley Hall" 172 hh 2 hadley-f2
run "Chemistry Building" 187 cb 11 chem-f1-1957
run "Chemistry Building" 187 cb 12 chem-f1-1967
run "Chemistry Building" 187 cb 13 chem-f1-1995
run "Chemistry Building" 187 cb 14 chem-f1-biochem
run "Chemistry Building" 187 cb 21 chem-f2-1955
run "Chemistry Building" 187 cb 22 chem-f2-1967
run "Chemistry Building" 187 cb 23 chem-f2-1995
run "Chemistry Building" 187 cb 31 chem-f3-1967
run "Chemistry Building" 187 cb 32 chem-f3-1995
run "Gardiner Hall" 188 gn 1 gardiner-f1
run "Gardiner Hall" 188 gn 2 gardiner-f2
run "Biology Annex" 82 bx 1 bioannex-f1
run "Rentfrow Hall" 211 rh 1 rentfrow-f1
