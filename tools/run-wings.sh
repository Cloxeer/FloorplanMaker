#!/bin/bash
# one draft per Chemistry wing (single-photo flow): tools/run-wings.sh [outDir]
P="C:/Users/sebastian/Desktop/maps/_source-photos"
OUT=${1:-tools/wings}
one() { node tools/build-floor.mjs "{\"building\":\"Chemistry Building\",\"property\":\"187\",\"code\":\"cb\",\"slug\":\"$1\",\"floor\":$2,\"photos\":[\"$P/$3.webp\"]}" "$OUT" 2>&1 | head -2; }
one cb-1-1957 1 chem-f1-1957
one cb-1-1967 1 chem-f1-1967
one cb-1-1995 1 chem-f1-1995
one cb-1-biochem 1 chem-f1-biochem
one cb-2-1955 2 chem-f2-1955
one cb-2-1967 2 chem-f2-1967
one cb-2-1995 2 chem-f2-1995
one cb-3-1967 3 chem-f3-1967
one cb-3-1995 3 chem-f3-1995
