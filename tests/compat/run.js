#!/usr/bin/env node
// tests/compat/run.js
// Cross-checks the exported dialect against the JS and Python compat readers
// (tests/compat/parsers.js, tests/compat/parsers.py). For each fixture and
// for exportSvg(makeSampleDoc()): (a) compares the JS reader's output on the
// original vs re-exported (import->export) text; (b) if python is available,
// runs parsers.py on both and compares its JSON to the JS reader's output.
// Exit code 1 on any mismatch. Depends on: js/model/*, ./parsers.js,
// ../helpers.js, node:child_process.

import { readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { exportSvg } from '../../js/model/svgExport.js';
import { importSvg } from '../../js/model/svgImport.js';
import { readRooms, readEntrances, readStairs, readFloor } from './parsers.js';
import { makeSampleDoc, loadFixture } from '../helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fixtures are hand-traced from a photo, so two kinds of harmless drift show
// up when comparing the original text to the re-exported (import->export)
// text:
//  - a <text class="lbl"> position may sit up to 1 unit off true centroid
//    (still counted as "unpinned" by svgImport, whose pinned threshold is
//    > 1); re-exporting recomputes it at the exact rounded centroid.
//  - stair treads that aren't traced at exactly the dialect's 18-unit
//    spacing (docs/DIALECT.md) get normalized to 18 apart by
//    stairTreads() on re-export, which can shift the stair group's
//    bounding-box center by a few units (observed up to ~4.5 in
//    tests/fixtures/hjlc-2.svg, whose treads are traced ~16 apart).
// Neither is a model bug; compare with a tolerance instead of strict
// equality.
export function almostEqual(a, b, tol = 6) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => almostEqual(v, b[i], tol));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!almostEqual(a[k], b[k], tol)) return false;
    }
    return true;
  }
  return a === b;
}

function assertAlmostEqual(actual, expected, message) {
  if (!almostEqual(actual, expected)) {
    assert.deepEqual(actual, expected, message); // reuse assert's diff output, will throw
  }
}

function jsRead(svgText) {
  return {
    rooms: readRooms(svgText),
    entrances: readEntrances(svgText),
    stairs: readStairs(svgText),
    floor: readFloor(svgText),
  };
}

export function hasPython() {
  const result = spawnSync('python', ['--version']);
  return result.status === 0;
}

export function pythonRead(svgText) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fps-compat-'));
  const file = path.join(dir, 'sample.svg');
  writeFileSync(file, svgText, 'utf8');
  const scriptPath = path.join(__dirname, 'parsers.py');
  const result = spawnSync('python', [scriptPath, file], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`parsers.py failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

export function getCases() {
  const cases = [];
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const fixtureNames = readdirSync(fixturesDir).filter((f) => f.endsWith('.svg'));
  for (const name of fixtureNames) {
    cases.push({ name, text: loadFixture(name) });
  }
  cases.push({ name: 'sample-doc', text: exportSvg(makeSampleDoc()) });
  return cases;
}

function runChecks({ log = true } = {}) {
  const rows = [];
  let anyFail = false;
  const pyAvailable = hasPython();

  for (const { name, text: original } of getCases()) {
    const row = { name, jsRoundtrip: 'skip', pyOriginal: 'skip', pyRoundtrip: 'skip' };

    // (a) JS-read original vs re-exported (import->export) text.
    const { doc } = importSvg(original);
    const reexported = exportSvg(doc);
    const jsOriginal = jsRead(original);
    const jsReexported = jsRead(reexported);
    try {
      assertAlmostEqual(jsReexported, jsOriginal);
      row.jsRoundtrip = 'ok';
    } catch (e) {
      row.jsRoundtrip = 'FAIL';
      row.jsError = e.message;
      anyFail = true;
    }

    // (b) Python parity, if available.
    if (pyAvailable) {
      try {
        const pyOriginal = pythonRead(original);
        assert.deepEqual(pyOriginal, jsOriginal);
        row.pyOriginal = 'ok';
      } catch (e) {
        row.pyOriginal = 'FAIL';
        row.pyOriginalError = e.message;
        anyFail = true;
      }
      try {
        const pyReexported = pythonRead(reexported);
        assert.deepEqual(pyReexported, jsReexported); // same text -> exact match expected
        row.pyRoundtrip = 'ok';
      } catch (e) {
        row.pyRoundtrip = 'FAIL';
        row.pyRoundtripError = e.message;
        anyFail = true;
      }
    }

    rows.push(row);
  }

  if (log) {
    console.log('\nCompat summary:');
    console.log('name'.padEnd(16), 'js-roundtrip'.padEnd(14), 'py-original'.padEnd(13), 'py-roundtrip');
    for (const row of rows) {
      console.log(
        row.name.padEnd(16),
        row.jsRoundtrip.padEnd(14),
        row.pyOriginal.padEnd(13),
        row.pyRoundtrip
      );
      if (row.jsError) console.log('  js error:', row.jsError);
      if (row.pyOriginalError) console.log('  py-original error:', row.pyOriginalError);
      if (row.pyRoundtripError) console.log('  py-roundtrip error:', row.pyRoundtripError);
    }
    console.log(pyAvailable ? '\n(python available)' : '\n(python not available: py checks skipped)');
  }

  return { rows, anyFail, pyAvailable };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { anyFail } = runChecks();
  process.exit(anyFail ? 1 : 0);
}

export { runChecks };
