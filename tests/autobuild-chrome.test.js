// tests/autobuild-chrome.test.js: the poster's sidebar and caption band are found and blanked (js/model/autobuild/chrome.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskPosterChrome, posterRoi } from '../js/model/autobuild/chrome.js';
import { makeImage } from '../js/model/autobuild/raster.js';

function poster(side = 'left') {
  const w = 400, h = 300, img = makeImage(w, h, 255);
  const fill = (x0, y0, x1, y1, [r, g, b]) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255; } };
  const sx0 = side === 'left' ? 0 : w - 70, sx1 = side === 'left' ? 70 : w;
  fill(sx0, 0, sx1, 250, [120, 20, 40]);              // maroon sidebar
  fill(sx0 + 10, 60, sx1 - 10, 160, [160, 165, 175]);  // the legend box on it
  fill(0, 250, w, h, [150, 155, 165]);                // grey caption band
  fill(120, 80, 200, 90, [0, 0, 0]);                  // a wall
  fill(sx1 + (side === 'left' ? 5 : -45), 100, sx1 + (side === 'left' ? 40 : -5), 130, [140, 25, 35]); // an exit sign beside the sidebar: maroon, but short
  return img;
}

test('finds the sidebar and the caption band, keeps the plan and the exit sign beside the sidebar', () => {
  const m = maskPosterChrome(poster('left'));
  assert.ok(m.sidebar && m.sidebar.x0 === 0 && m.sidebar.x1 >= 68 && m.sidebar.x1 < 100, JSON.stringify(m.sidebar));
  assert.ok(m.caption && m.caption.y0 >= 240 && m.caption.y0 <= 252, JSON.stringify(m.caption));
  const px = (x, y) => m.img.data[(y * 400 + x) * 4];
  assert.equal(px(30, 30), 255); // sidebar painted white
  assert.equal(px(200, 280), 255); // caption painted white
  assert.equal(px(150, 85), 0); // the wall stays
  assert.ok(px(95, 115) < 200); // the exit sign next to the sidebar stays (it is not sidebar)
});

test('works for a sidebar on the right too, and posterRoi is the paper between sidebar and caption', () => {
  const roi = posterRoi(poster('right'));
  assert.ok(roi && roi.x0 === 0 && roi.x1 <= 335 && roi.x1 >= 300, JSON.stringify(roi));
  assert.ok(roi.y1 >= 240 && roi.y1 <= 252);
});

test('a plain white page has no furniture', () => {
  const img = makeImage(300, 200, 255);
  const m = maskPosterChrome(img);
  assert.equal(m.sidebar, null); assert.equal(m.caption, null);
  assert.equal(posterRoi(img), null);
});
