import { test } from "node:test";
import assert from "node:assert/strict";
import { cellCenter, computeMatrixLayout, pointToCell } from "../../frontend/src/lib/matrix-layout.ts";

test("computeMatrixLayout is limited by the narrower-ratio axis for a canvas relatively taller than the grid", () => {
  // 32x16 grid (2:1) in a 640x400 canvas (1.6:1, relatively taller than the grid) -> width's own
  // ratio (640/32=20) is smaller than height's (400/16=25), so width is the limiting axis.
  const layout = computeMatrixLayout(640, 400, 32, 16);
  assert.equal(layout.cellSize, 20);
});

test("computeMatrixLayout centres the unused margin on the non-limiting axis", () => {
  const layout = computeMatrixLayout(640, 400, 32, 16);
  // Width is fully used (20*32 = 640, no margin -> offsetX is just half a cell in).
  assert.equal(layout.offsetX, 10);
  // Height has a margin: used height = 20*16 = 320 inside a 400 canvas, 80px spare split evenly
  // (40 each side) plus the usual half-cell inset.
  assert.equal(layout.offsetY, 50);
});

test("computeMatrixLayout exactly fills a canvas already in the grid's own aspect ratio", () => {
  const layout = computeMatrixLayout(320, 160, 32, 16); // exactly 2:1, matching the grid
  assert.equal(layout.cellSize, 10);
  assert.equal(layout.offsetX, 5); // half a cell in from the left edge, no margin on either axis
  assert.equal(layout.offsetY, 5);
});

test("dotRadius stays smaller than half the cell size, leaving a visible gap between LEDs", () => {
  const layout = computeMatrixLayout(320, 160, 32, 16);
  assert.ok(layout.dotRadius < layout.cellSize / 2);
});

test("cellCenter places (0,0) at the first offset and steps by cellSize", () => {
  const layout = computeMatrixLayout(320, 160, 32, 16);
  assert.deepEqual(cellCenter(layout, 0, 0), [5, 5]);
  assert.deepEqual(cellCenter(layout, 1, 0), [15, 5]);
  assert.deepEqual(cellCenter(layout, 0, 1), [5, 15]);
});

test("pointToCell is the exact inverse of cellCenter for every cell in-bounds", () => {
  const layout = computeMatrixLayout(320, 160, 32, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      const [cx, cy] = cellCenter(layout, x, y);
      assert.deepEqual(pointToCell(layout, cx, cy, 32, 16), [x, y]);
    }
  }
});

test("pointToCell returns null for a point in the letterboxed margin", () => {
  const layout = computeMatrixLayout(640, 400, 32, 16); // margin exists on the height axis
  assert.equal(pointToCell(layout, 50, -20, 32, 16), null);
  assert.equal(pointToCell(layout, 50, 2000, 32, 16), null);
});
