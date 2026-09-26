import { test } from "node:test";
import assert from "node:assert/strict";
import { plotEllipse, plotLine, plotRect } from "../../frontend/src/lib/rasterize.ts";
import { quantizePreviewRgb, quantizePreviewRgbLinear } from "../../frontend/src/lib/color.ts";
import { createFrame, getPixel, type PixelFrame } from "../../frontend/src/lib/grid.ts";

function litPixels(frame: PixelFrame): Array<[number, number]> {
  const lit: Array<[number, number]> = [];
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const [r, g, b] = getPixel(frame, x, y);
      if (r || g || b) lit.push([x, y]);
    }
  }
  return lit;
}

test("plotLine draws a fully connected diagonal with no gaps", () => {
  const frame = createFrame(10, 10);
  const lined = plotLine(frame, 0, 0, 5, 5, [255, 255, 255]);
  const lit = litPixels(lined);
  assert.equal(lit.length, 6); // (0,0)..(5,5) inclusive, one step per axis
  for (let i = 0; i <= 5; i++) assert.ok(lit.some(([x, y]) => x === i && y === i));
});

test("plotLine endpoints are both included for a single-pixel line", () => {
  const frame = createFrame(4, 4);
  const lined = plotLine(frame, 2, 2, 2, 2, [255, 0, 0]);
  assert.deepEqual(litPixels(lined), [[2, 2]]);
});

test("plotLine handles a horizontal line without stray pixels off-axis", () => {
  const frame = createFrame(10, 10);
  const lined = plotLine(frame, 1, 3, 6, 3, [200, 200, 200]);
  const lit = litPixels(lined);
  assert.equal(lit.length, 6);
  assert.ok(lit.every(([, y]) => y === 3));
});

test("plotRect outline touches only the border, not the interior", () => {
  const frame = createFrame(6, 6);
  const rect = plotRect(frame, 1, 1, 4, 4, [255, 255, 255], false);
  assert.deepEqual(getPixel(rect, 2, 2), [0, 0, 0]); // interior stays clear
  assert.deepEqual(getPixel(rect, 1, 1), [255, 255, 255]); // corner
  assert.deepEqual(getPixel(rect, 4, 1), [255, 255, 255]); // corner
  assert.deepEqual(getPixel(rect, 2, 1), [255, 255, 255]); // top edge
});

test("plotRect filled covers the entire bounding box", () => {
  const frame = createFrame(6, 6);
  const rect = plotRect(frame, 1, 1, 3, 3, [255, 255, 255], true);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) assert.deepEqual(getPixel(rect, x, y), [255, 255, 255]);
  assert.deepEqual(getPixel(rect, 0, 0), [0, 0, 0]);
});

test("plotRect normalises reversed drag coordinates (x1<x0, y1<y0)", () => {
  const forward = plotRect(createFrame(6, 6), 1, 1, 4, 4, [255, 255, 255], true);
  const reversed = plotRect(createFrame(6, 6), 4, 4, 1, 1, [255, 255, 255], true);
  assert.deepEqual(litPixels(forward), litPixels(reversed));
});

test("plotEllipse filled is symmetric about its bounding box centre", () => {
  const frame = createFrame(11, 11);
  const ellipse = plotEllipse(frame, 0, 0, 10, 10, [255, 255, 255], true);
  assert.deepEqual(getPixel(ellipse, 5, 5), [255, 255, 255]); // centre of a filled circle is lit
  assert.deepEqual(getPixel(ellipse, 0, 5), getPixel(ellipse, 10, 5)); // left/right symmetry
  assert.deepEqual(getPixel(ellipse, 5, 0), getPixel(ellipse, 5, 10)); // top/bottom symmetry
});

test("plotEllipse outline leaves the centre unlit", () => {
  const frame = createFrame(11, 11);
  const ellipse = plotEllipse(frame, 0, 0, 10, 10, [255, 255, 255], false);
  assert.deepEqual(getPixel(ellipse, 5, 5), [0, 0, 0]);
  assert.ok(litPixels(ellipse).length > 0);
});

test("plotEllipse degenerates to a filled rectangle when the box has no width or height", () => {
  const frame = createFrame(6, 6);
  const flat = plotEllipse(frame, 1, 2, 4, 2, [255, 255, 255], false);
  for (let x = 1; x <= 4; x++) assert.deepEqual(getPixel(flat, x, 2), [255, 255, 255]);
});

test("plotLine/plotRect/plotEllipse default to the CURVED quantize path (quantizePreviewRgb)", () => {
  const [r, g, b] = quantizePreviewRgb([100, 100, 100]);
  assert.deepEqual(getPixel(plotLine(createFrame(4, 4), 1, 1, 1, 1, [100, 100, 100]), 1, 1), [r, g, b]);
  assert.deepEqual(getPixel(plotRect(createFrame(4, 4), 1, 1, 1, 1, [100, 100, 100], true), 1, 1), [r, g, b]);
  assert.deepEqual(getPixel(plotEllipse(createFrame(4, 4), 1, 1, 1, 1, [100, 100, 100], true), 1, 1), [r, g, b]);
});

test("plotLine/plotRect/plotEllipse accept an explicit quantize function (e.g. the LINEAR path for native clock/date/timer content)", () => {
  const [r, g, b] = quantizePreviewRgbLinear([100, 100, 100]);
  assert.notDeepEqual([r, g, b], quantizePreviewRgb([100, 100, 100])); // the two curves genuinely differ at this value
  assert.deepEqual(getPixel(plotLine(createFrame(4, 4), 1, 1, 1, 1, [100, 100, 100], quantizePreviewRgbLinear), 1, 1), [r, g, b]);
  assert.deepEqual(getPixel(plotRect(createFrame(4, 4), 1, 1, 1, 1, [100, 100, 100], true, quantizePreviewRgbLinear), 1, 1), [r, g, b]);
  assert.deepEqual(getPixel(plotEllipse(createFrame(4, 4), 1, 1, 1, 1, [100, 100, 100], true, quantizePreviewRgbLinear), 1, 1), [r, g, b]);
});
