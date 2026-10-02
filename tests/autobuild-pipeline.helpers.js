// Synthetic poster + fake OCR shared by the AutoBuild pipeline tests.
import { makeImage } from '../js/model/autobuild/raster.js';

const fill = (img, x0, y0, x1, y1, rgb) => {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
    const i = (y * img.width + x) * 4;
    img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
  }
};
const stroke = (img, x0, y0, x1, y1, t, rgb) => {
  fill(img, x0 - 1, y0 - 1, x1 + t, y0 + t - 1, rgb); fill(img, x0 - 1, y1 - 1, x1 + t, y1 + t - 1, rgb);
  fill(img, x0 - 1, y0 - 1, x0 + t - 1, y1 + t, rgb); fill(img, x1 - 1, y0 - 1, x1 + t - 1, y1 + t, rgb);
};

// room i -> text it should read as
const TEXTS = ['101', '102', '103', 'R104', 'R104', '106', '107', '', '109', '110', 'RESTROOMS', 'OPEN TO BELOW'];
const WIDTHS = [6, 10, 14];
const code = (i) => [Math.floor(i / 9) % 3, Math.floor(i / 3) % 3, i % 3];

export function synthPoster() {
  const W = 1100, H = 640;
  const img = makeImage(W, H, 255);
  const ink = [30, 30, 30];
  const x0 = 100, rw = 160, cols = 5, topY = 100, rh = 100, midY = 320;
  const rooms = [];
  for (let c = 0; c < cols; c++) {
    rooms.push({ x: x0 + c * rw, y: topY, w: rw, h: rh });
    rooms.push({ x: x0 + c * rw, y: midY, w: rw, h: rh });
  }
  rooms.push({ x: x0 + cols * rw, y: topY, w: rw, h: rh }); // sixth top room, makes 11 rooms
  rooms.push({ x: x0 + cols * rw, y: midY, w: rw, h: rh }); // 12th
  rooms.forEach((r, i) => {
    stroke(img, r.x, r.y, r.x + r.w, r.y + r.h, 3, ink);
    // label: reference block (width 6) then three coded blocks, 12 px tall, centred
    const widths = [6, ...code(i).map((k) => WIDTHS[k])];
    const total = widths.reduce((s, v) => s + v, 0) + 5 * 3;
    let cx = Math.round(r.x + r.w / 2 - total / 2);
    for (const wd of widths) { fill(img, cx, r.y + 44, cx + wd, r.y + 56, ink); cx += wd + 5; }
  });
  const right = x0 + (cols + 1) * rw;
  fill(img, x0 - 1, topY + rh, x0 + 2, midY, ink); fill(img, right - 1, topY + rh, right + 2, midY, ink);
  // exit sign on the left wall of the corridor
  fill(img, x0 - 24, 240, x0 + 14, 272, [200, 25, 25]);
  return { img, rooms };
}

// decodes the block widths in a crop
export function fakeOcr(image) {
  const { data, w, h } = image;
  const runs = [];
  let run = 0;
  for (let x = 0; x < w; x++) {
    let dark = false;
    for (let y = 0; y < h && !dark; y++) if (data[y * w + x] < 110) dark = true;
    if (dark) run++; else if (run) { runs.push(run); run = 0; }
  }
  if (run) runs.push(run);
  if (runs.length !== 4) return { text: '', conf: 10 };
  const k = runs.slice(1).map((r) => Math.max(0, Math.min(2, Math.round((r / runs[0] - 1) / 0.667))));
  const i = k[0] * 9 + k[1] * 3 + k[2];
  return { text: TEXTS[i] ?? '', conf: 90 };
}
