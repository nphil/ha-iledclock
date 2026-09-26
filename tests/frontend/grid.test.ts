import { test } from "node:test";
import assert from "node:assert/strict";
import { cloneFrame, createFrame, framesEqual, getPixel, GRID_HEIGHT, GRID_WIDTH, mirrorFrame, setPixel, shiftFrame } from "../../frontend/src/lib/grid.ts";

test("createFrame fills every pixel with the given colour at the default 32x16 size", () => {
  const frame = createFrame(undefined, undefined, [1, 2, 3]);
  assert.equal(frame.width, GRID_WIDTH);
  assert.equal(frame.height, GRID_HEIGHT);
  assert.equal(frame.pixels.length, GRID_WIDTH * GRID_HEIGHT * 3);
  assert.deepEqual(getPixel(frame, 0, 0), [1, 2, 3]);
  assert.deepEqual(getPixel(frame, GRID_WIDTH - 1, GRID_HEIGHT - 1), [1, 2, 3]);
});

test("getPixel out of bounds reads as black instead of throwing", () => {
  const frame = createFrame(4, 4, [9, 9, 9]);
  assert.deepEqual(getPixel(frame, -1, 0), [0, 0, 0]);
  assert.deepEqual(getPixel(frame, 4, 0), [0, 0, 0]);
});

test("setPixel returns a new frame and leaves the original untouched", () => {
  const frame = createFrame(4, 4, [0, 0, 0]);
  const next = setPixel(frame, 1, 1, [255, 0, 0]);
  assert.deepEqual(getPixel(frame, 1, 1), [0, 0, 0]);
  assert.deepEqual(getPixel(next, 1, 1), [255, 0, 0]);
  assert.notEqual(next.pixels, frame.pixels);
});

test("setPixel out of bounds is a no-op clone", () => {
  const frame = createFrame(4, 4);
  const next = setPixel(frame, 99, 99, [1, 1, 1]);
  assert.ok(framesEqual(frame, next));
});

test("cloneFrame copies the pixel buffer, not just the reference", () => {
  const frame = createFrame(2, 2, [5, 5, 5]);
  const clone = cloneFrame(frame);
  assert.ok(framesEqual(frame, clone));
  assert.notEqual(clone.pixels, frame.pixels);
});

test("framesEqual rejects a different duration even with identical pixels", () => {
  const a = createFrame(2, 2, [0, 0, 0], 100);
  const b = createFrame(2, 2, [0, 0, 0], 200);
  assert.equal(framesEqual(a, b), false);
});

test("shiftFrame without wrap drops pixels pushed off the edge and fills the gap", () => {
  let frame = createFrame(3, 3, [0, 0, 0]);
  frame = setPixel(frame, 0, 0, [255, 0, 0]);
  const shifted = shiftFrame(frame, 1, 0, false, [9, 9, 9]);
  assert.deepEqual(getPixel(shifted, 1, 0), [255, 0, 0]);
  assert.deepEqual(getPixel(shifted, 0, 0), [9, 9, 9]); // vacated column fills with fillColor
});

test("shiftFrame with wrap carries pixels around to the opposite edge", () => {
  let frame = createFrame(3, 3, [0, 0, 0]);
  frame = setPixel(frame, 0, 0, [255, 0, 0]);
  const shifted = shiftFrame(frame, -1, 0, true);
  assert.deepEqual(getPixel(shifted, 2, 0), [255, 0, 0]); // wrapped from column 0 to column 2
});

test("mirrorFrame horizontal flips columns left-right", () => {
  let frame = createFrame(3, 1, [0, 0, 0]);
  frame = setPixel(frame, 0, 0, [255, 0, 0]);
  const mirrored = mirrorFrame(frame, "horizontal");
  assert.deepEqual(getPixel(mirrored, 2, 0), [255, 0, 0]);
  assert.deepEqual(getPixel(mirrored, 0, 0), [0, 0, 0]);
});

test("mirrorFrame vertical flips rows top-bottom", () => {
  let frame = createFrame(1, 3, [0, 0, 0]);
  frame = setPixel(frame, 0, 0, [0, 255, 0]);
  const mirrored = mirrorFrame(frame, "vertical");
  assert.deepEqual(getPixel(mirrored, 0, 2), [0, 255, 0]);
});
