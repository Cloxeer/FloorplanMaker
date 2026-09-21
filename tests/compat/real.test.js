// real.test.js — the real map site's tools Python parsers (build_rooms.py,
// build_entrances.py, indoor_routes.py) must read our re-exported fixtures
// exactly like the originals: same rooms, names, outlines, routes and doors.
// Also checks our route.js port against indoor_routes.py. Skips when the
// repo is absent (read from $MAP_TOOLS_REPO, or tests/compat/repo-path.txt).
// Depends on: js/model/{svgImport,svgExport,route}.js, tests/compat/real_tools.py
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { importSvg } from '../../js/model/svgImport.js';
import { exportSvg } from '../../js/model/svgExport.js';
import { routesForFloor } from '../../js/model/route.js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
function repoPathFromFile() {
  try {
    return fs.readFileSync(path.join(here, 'repo-path.txt'), 'utf8').trim();
  } catch {
    return '';
  }
}
const repo = process.env.MAP_TOOLS_REPO || repoPathFromFile();
const available = !!repo && fs.existsSync(path.join(repo, 'tools', 'build_rooms.py'));

function realRead(svgText, floor) {
  const tmp = path.join(os.tmpdir(), `fps-${process.pid}-${Math.random().toString(36).slice(2)}.svg`);
  fs.writeFileSync(tmp, svgText);
  const r = spawnSync('python', [path.join(here, 'real_tools.py'), tmp, String(floor)], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/); // the tools print "skipped" notes first
  return JSON.parse(lines[lines.length - 1]);
}

for (const name of ['hjlc-1', 'hjlc-2']) {
  const floor = Number(name.split('-')[1]);
  test(`real parsers: ${name} original vs re-exported`, { skip: !available && 'map tools repo not found' }, () => {
    const original = fs.readFileSync(path.join(here, '..', 'fixtures', `${name}.svg`), 'utf8');
    const { doc } = importSvg(original);
    const a = realRead(original, floor);
    const b = realRead(exportSvg(doc), floor);
    assert.deepEqual(b.rooms.map((r) => [r.number, r.name, r.points]), a.rooms.map((r) => [r.number, r.name, r.points]));
    assert.deepEqual(b.doors, a.doors);
    assert.deepEqual(b.rooms.map((r) => r.indoorRoute), a.rooms.map((r) => r.indoorRoute));
    // our route.js port vs indoor_routes.py on the original
    const ours = routesForFloor(doc);
    for (const r of a.rooms) {
      const mine = ours[r.number] || null;
      assert.equal(!!mine, !!r.indoorRoute, `${name} ${r.number} reachability`);
      if (mine) {
        assert.equal(mine.length, r.indoorRoute.length, `${name} ${r.number} path length`);
        mine.forEach((p, i) => assert.ok(Math.hypot(p[0] - r.indoorRoute[i][0], p[1] - r.indoorRoute[i][1]) < 0.6, `${name} ${r.number} point ${i}`));
      }
    }
    console.log(`  ${name}: ${a.rooms.length} rooms, ${a.doors.length} doors, ${a.rooms.filter((r) => r.indoorRoute).length} routed — identical`);
  });
}
