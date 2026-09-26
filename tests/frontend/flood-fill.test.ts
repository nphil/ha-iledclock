import { test } from "node:test";
import assert from "node:assert/strict";
import { floodFill } from "../../frontend/src/lib/flood-fill.ts";
import { createFrame, getPixel, setPixel } from "../../frontend/src/lib/grid.ts";

test("floodFill fills only the 4-connected region matching the start pixel", () => {
  // A 5x5 black frame with a vertical red wall down column 2, splitting it into a left and
  // right region; filling from the left region must never cross into the right one.
  let frame = createFrame(5, 5, [0, 0, 0]);
  for (let y = 0; y < 5; y++) frame = setPixel(frame, 2, y, [255, 0, 0]);

  const filled = floodFill(frame, 0, 0, [0, 255, 0]);
  assert.deepEqual(getPixel(filled, 0, 0), [0, 255, 0]);
  assert.deepEqual(getPixel(filled, 1, 4), [0, 255, 0]);
  assert.deepEqual(getPixel(filled, 2, 0), [255, 0, 0]); // wall itself untouched
  assert.deepEqual(getPixel(filled, 3, 0), [0, 0, 0]); // right region untouched
  assert.deepEqual(getPixel(filled, 4, 4), [0, 0, 0]);
});

test("floodFill on an already-matching colour is a no-op (same frame reference)", () => {
  // 187 is a fixed point of quantizePreviewRgb (quantises to nibble 11, expands back to 187),
  // so the frame's fill and the requested fill colour compare equal without any rounding drift.
  const frame = createFrame(3, 3, [187, 187, 187]);
  const result = floodFill(frame, 1, 1, [187, 187, 187]);
  assert.equal(result, frame);
});

test("floodFill quantises the fill colour to RGB444 before comparing/painting", () => {
  const frame = createFrame(2, 2, [0, 0, 0]);
  // 120 and 128 both quantise to nibble 6 (rgb444Transfer's [117,130] band); filling with 120
  // then re-filling the same region with 128 must be a no-op, proving the comparison is done
  // in quantised space, not raw input space.
  const once = floodFill(frame, 0, 0, [0, 120, 0]);
  const twice = floodFill(once, 0, 0, [0, 128, 0]);
  assert.equal(once, twice);
});

test("floodFill out of bounds start is a no-op", () => {
  const frame = createFrame(3, 3);
  assert.equal(floodFill(frame, 10, 10, [1, 2, 3]), frame);
});

test("floodFill with wrap connects across opposite edges", () => {
  // A single black frame with a red column at x=1 dividing it; without wrap, filling at x=0
  // reaches only column 0, but with wrap the left edge also connects to the right edge (x=2),
  // which the red column at x=1 does NOT separate from x=0 going the other way around.
  let frame = createFrame(3, 1, [0, 0, 0]);
  frame = setPixel(frame, 1, 0, [255, 0, 0]);
  const filled = floodFill(frame, 0, 0, [0, 255, 0], true);
  assert.deepEqual(getPixel(filled, 0, 0), [0, 255, 0]);
  assert.deepEqual(getPixel(filled, 2, 0), [0, 255, 0]); // reached by wrapping around, not by crossing the wall
  assert.deepEqual(getPixel(filled, 1, 0), [255, 0, 0]);
});
