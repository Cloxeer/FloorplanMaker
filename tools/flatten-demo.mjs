// node tools/flatten-demo.mjs in.png out.png [tilt turn roll]   (no angles = auto-level)
// Needs pngjs. Prints the estimate and writes the re-projected image.
import fs from 'fs';
import { PNG } from 'pngjs';
import { estimateAxes, applyAxes } from '../js/model/autobuild/flatten.js';

const [inp, out, ...n] = process.argv.slice(2);
const p = PNG.sync.read(fs.readFileSync(inp));
const img = { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
const axes = n.length ? { tilt: +n[0], turn: +n[1], roll: +n[2] } : estimateAxes(img);
if (!n.length) console.log('estimate', axes.tilt.toFixed(2), axes.turn.toFixed(2), axes.roll.toFixed(2), 'confidence', axes.confidence.toFixed(2));
const o = applyAxes(img, axes);
const q = new PNG({ width: o.width, height: o.height });
q.data = Buffer.from(o.data);
fs.writeFileSync(out, PNG.sync.write(q));
