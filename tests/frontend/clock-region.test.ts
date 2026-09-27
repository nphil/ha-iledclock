import { test } from "node:test";
import assert from "node:assert/strict";
import { clockRegionForDesign, designHasClockRegion, editableWidth, isEditablePixel, mirrorEditableFrame, moveEditableCell, preserveClockRegionPixels } from "../../frontend/src/lib/clock-region.ts";
import { createFrame, getPixel, setPixel } from "../../frontend/src/lib/grid.ts";

test("clock layouts reserve the right half and recognize saved designs", () => {
  assert.deepEqual(clockRegionForDesign(true), { x: 16, y: 0, w: 16, h: 16 });
  assert.equal(clockRegionForDesign(false), null);
  assert.equal(designHasClockRegion({ clock_region: { x: 16, y: 0, w: 16, h: 16 } }), true);
  assert.equal(designHasClockRegion({ clock_region: null, tags: ["with_clock"] }), true);
  assert.equal(designHasClockRegion({ clock_region: null, tags: [] }), false);
});

test("clock-safe edits cannot overwrite the reserved pixels", () => {
  const original = createFrame(4, 1, [10, 20, 30]);
  const candidate = setPixel(setPixel(original, 0, 0, [200, 0, 0]), 3, 0, [0, 200, 0]);
  const result = preserveClockRegionPixels(original, candidate, true);
  assert.deepEqual(getPixel(result, 0, 0), [200, 0, 0]);
  assert.deepEqual(getPixel(result, 3, 0), [10, 20, 30]);
  assert.deepEqual(getPixel(original, 0, 0), [10, 20, 30]);
  assert.equal(editableWidth(5, true), 2);
  assert.equal(isEditablePixel(1, 4, true), true);
  assert.equal(isEditablePixel(2, 4, true), false);
  assert.equal(isEditablePixel(-1, 4, true), false);
  assert.deepEqual(moveEditableCell({ x: 15, y: 0 }, { x: 1, y: -1 }, 32, 16, true), { x: 15, y: 0 });
  assert.deepEqual(moveEditableCell({ x: 2, y: 3 }, { x: -1, y: 1 }, 32, 16, false), { x: 1, y: 4 });
});

test("mirror changes only the editable half when the clock region is enabled", () => {
  let frame = createFrame(4, 1, [0, 0, 0]);
  frame = setPixel(frame, 0, 0, [255, 0, 0]);
  frame = setPixel(frame, 1, 0, [0, 255, 0]);
  frame = setPixel(frame, 2, 0, [0, 0, 255]);
  frame = setPixel(frame, 3, 0, [255, 255, 0]);
  const mirrored = mirrorEditableFrame(frame, "horizontal", true);
  assert.deepEqual(getPixel(mirrored, 0, 0), [0, 255, 0]);
  assert.deepEqual(getPixel(mirrored, 1, 0), [255, 0, 0]);
  assert.deepEqual(getPixel(mirrored, 2, 0), [0, 0, 255]);
  assert.deepEqual(getPixel(mirrored, 3, 0), [255, 255, 0]);
});
