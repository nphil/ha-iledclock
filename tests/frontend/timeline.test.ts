import { test } from "node:test";
import assert from "node:assert/strict";
import { clampFrameDelay, deleteFrame, duplicateFrame, insertFrame, MAX_FRAME_COUNT, MAX_FRAME_DELAY_MS, MIN_FRAME_DELAY_MS, reorderFrame, setFrameDelay, totalDurationMs } from "../../frontend/src/lib/timeline.ts";
import { createFrame, framesEqual, setPixel } from "../../frontend/src/lib/grid.ts";

function labelled(n: number) {
  return createFrame(4, 4, [n, n, n], 100 + n);
}

test("insertFrame at -1 inserts at the front", () => {
  const frames = insertFrame([labelled(1), labelled(2)], -1, labelled(0));
  assert.equal(frames.length, 3);
  assert.equal(frames[0]!.durationMs, 100);
});

test("insertFrame after a valid index inserts right after it", () => {
  const frames = insertFrame([labelled(1), labelled(2), labelled(3)], 1, labelled(9));
  assert.equal(frames.length, 4);
  assert.equal(frames[2]!.durationMs, 109);
});

test("insertFrame with no source creates a blank frame matching the timeline's own size", () => {
  const frames = insertFrame([createFrame(8, 4)], 0);
  assert.equal(frames[1]!.width, 8);
  assert.equal(frames[1]!.height, 4);
});

test("duplicateFrame clones the source so later edits to the copy don't affect the original", () => {
  const source = labelled(5);
  const frames = duplicateFrame([source], 0);
  assert.equal(frames.length, 2);
  assert.ok(framesEqual(frames[0]!, frames[1]!));
  const edited = setPixel(frames[1]!, 0, 0, [200, 200, 200]);
  assert.notDeepEqual(edited.pixels, frames[0]!.pixels);
});

test("deleteFrame refuses to drop the last remaining frame", () => {
  const frames = deleteFrame([labelled(1)], 0);
  assert.equal(frames.length, 1);
});

test("deleteFrame removes exactly the targeted index", () => {
  const frames = deleteFrame([labelled(1), labelled(2), labelled(3)], 1);
  assert.deepEqual(frames.map((f) => f.durationMs), [101, 103]);
});

test("reorderFrame moves a frame to a later index, shifting the ones between it back", () => {
  const frames = reorderFrame([labelled(1), labelled(2), labelled(3)], 0, 2);
  assert.deepEqual(frames.map((f) => f.durationMs), [102, 103, 101]);
});

test("reorderFrame with an out-of-range index is a no-op", () => {
  const source = [labelled(1), labelled(2)];
  assert.deepEqual(reorderFrame(source, 0, 5), source);
});

test("setFrameDelay clamps into the allowed range", () => {
  const frames = setFrameDelay([labelled(1)], 0, 5);
  assert.equal(frames[0]!.durationMs, MIN_FRAME_DELAY_MS);
  const frames2 = setFrameDelay([labelled(1)], 0, 999999);
  assert.equal(frames2[0]!.durationMs, MAX_FRAME_DELAY_MS);
});

test("clampFrameDelay rounds to the nearest millisecond", () => {
  assert.equal(clampFrameDelay(150.6), 151);
});

test("totalDurationMs sums every frame's own delay", () => {
  assert.equal(totalDurationMs([labelled(1), labelled(2), labelled(3)]), 101 + 102 + 103);
});

test("add and duplicate preserve the 64-frame maximum", () => {
  const frames = Array.from({ length: MAX_FRAME_COUNT }, (_, index) => labelled(index));
  assert.equal(insertFrame(frames, frames.length - 1).length, MAX_FRAME_COUNT);
  assert.equal(duplicateFrame(frames, 0).length, MAX_FRAME_COUNT);
});
