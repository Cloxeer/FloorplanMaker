// tools/eval.mjs: compares the room numbers in <dir>/<slug>.floorplan.json with tools/truth.json (hand-read from the photos).
//   node tools/eval.mjs <dir>
import { readFileSync, existsSync } from 'node:fs';
const dir = process.argv[2] || 'tools/out';
const truth = JSON.parse(readFileSync('tools/truth.json', 'utf8'));
let tt = 0, tg = 0, tf = 0, tw = 0;
for (const [slug, str] of Object.entries(truth)) {
  const f = `${dir}/${slug}.floorplan.json`;
  if (!existsSync(f)) { console.log(`${slug.padEnd(6)} (missing)`); continue; }
  const doc = JSON.parse(readFileSync(f, 'utf8')).doc;
  const want = new Set(str.split(/\s+/));
  const rooms = doc.items.filter((i) => i.type === 'room');
  const stairs = doc.items.filter((i) => i.type === 'stair' && i.label).map((i) => i.label);
  const got = [...rooms.map((r) => r.number).filter(Boolean), ...stairs];
  const gs = new Set(got);
  const hit = [...want].filter((x) => gs.has(x));
  const wrong = [...gs].filter((x) => !want.has(x));
  const blank = rooms.filter((r) => !r.number).length;
  tt += want.size; tg += hit.length; tf += wrong.length; tw += blank;
  console.log(`${slug.padEnd(6)} found ${String(hit.length).padStart(2)}/${String(want.size).padEnd(2)}  wrong ${String(wrong.length).padStart(2)} [${wrong.join(' ')}]  blank rooms ${blank}  missing [${[...want].filter((x) => !gs.has(x)).join(' ')}]`);
}
console.log(`TOTAL found ${tg}/${tt} (${Math.round((100 * tg) / tt)}%)  wrong ${tf}  blank ${tw}`);
