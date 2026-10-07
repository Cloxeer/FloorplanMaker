#!/bin/bash
# builds every floor of the maps set through the real app flow: tools/run-all.sh [outDir]
P="C:/Users/sebastian/Desktop/maps/_source-photos"
OUT=${1:-tools/final}
one() { node tools/build-floor.mjs "{\"building\":\"$1\",\"property\":\"$2\",\"code\":\"$3\",\"slug\":\"$3-$4\",\"floor\":$4,\"photos\":[$5]}" "$OUT" 2>&1 | head -3; }
ph() { local out=""; for n in "$@"; do out="$out\"$P/$n.webp\","; done; echo "${out%,}"; }
one "Hadley Hall" 172 hh 1 "$(ph hadley-f1)"
one "Hadley Hall" 172 hh 2 "$(ph hadley-f2)"
one "Chemistry Building" 187 cb 1 "$(ph chem-f1-1957 chem-f1-1967 chem-f1-1995 chem-f1-biochem)"
one "Chemistry Building" 187 cb 2 "$(ph chem-f2-1955 chem-f2-1967 chem-f2-1995)"
one "Chemistry Building" 187 cb 3 "$(ph chem-f3-1967 chem-f3-1995)"
one "Gardiner Hall" 188 gn 1 "$(ph gardiner-f1)"
one "Gardiner Hall" 188 gn 2 "$(ph gardiner-f2)"
one "Biology Annex" 82 bx 1 "$(ph bioannex-f1)"
one "Rentfrow Hall" 211 rh 1 "$(ph rentfrow-f1)"
