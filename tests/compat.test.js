// tests/compat.test.js
// Runs the same JS/Python compat checks as tests/compat/run.js under
// node --test. Skips the python half with t.skip if python is missing.
// Depends on: node:test, node:assert, tests/compat/run.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCases, hasPython, pythonRead, almostEqual } from './compat/run.js';
import { exportSvg } from '../js/model/svgExport.js';
import { importSvg } from '../js/model/svgImport.js';
import { readRooms, readEntrances, readStairs, readFloor } from './compat/parsers.js';

function jsRead(svgText) {
  return {
    rooms: readRooms(svgText),
    entrances: readEntrances(svgText),
    stairs: readStairs(svgText),
    floor: readFloor(svgText),
  };
}

for (const { name, text: original } of getCases()) {
  test(`compat [${name}]: JS reader agrees on original vs re-exported`, () => {
    const { doc } = importSvg(original);
    const reexported = exportSvg(doc);
    assert.ok(
      almostEqual(jsRead(reexported), jsRead(original)),
      'JS reader output differs by more than the 1-unit label rounding tolerance'
    );
  });

  test(`compat [${name}]: python reader agrees with JS reader`, (t) => {
    if (!hasPython()) {
      t.skip('python not available');
      return;
    }
    const { doc } = importSvg(original);
    const reexported = exportSvg(doc);
    assert.deepEqual(pythonRead(original), jsRead(original));
    assert.deepEqual(pythonRead(reexported), jsRead(reexported));
  });
}
