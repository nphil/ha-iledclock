import { test } from "node:test";
import assert from "node:assert/strict";
import { centeredCropBox, clampCropBox, moveCropBox, resizeCropBox, screenDeltaToImageDelta } from "../../frontend/src/lib/gallery-crop.ts";

test("clampCropBox leaves an already in-bounds box untouched (aside from rounding)", () => {
  assert.deepEqual(clampCropBox({ x: 2, y: 3, w: 10, h: 5 }, 32, 16), { x: 2, y: 3, w: 10, h: 5 });
});

test("clampCropBox shrinks a box larger than the image to fit", () => {
  assert.deepEqual(clampCropBox({ x: 0, y: 0, w: 999, h: 999 }, 32, 16), { x: 0, y: 0, w: 32, h: 16 });
});

test("clampCropBox pulls negative x/y back to 0", () => {
  assert.deepEqual(clampCropBox({ x: -5, y: -5, w: 10, h: 10 }, 32, 16), { x: 0, y: 0, w: 10, h: 10 });
});

test("clampCropBox slides x left to keep w in-bounds rather than shrinking w", () => {
  // x=28,w=10 would run to 38 on a 32-wide image -- x must move to 22 (32-10), keeping w=10.
  assert.deepEqual(clampCropBox({ x: 28, y: 0, w: 10, h: 8 }, 32, 16), { x: 22, y: 0, w: 10, h: 8 });
});

test("clampCropBox never shrinks below the 1px floor for a degenerate box", () => {
  assert.deepEqual(clampCropBox({ x: 0, y: 0, w: 0, h: -3 }, 32, 16), { x: 0, y: 0, w: 1, h: 1 });
});

test("centeredCropBox on a wider-than-target image uses the full height, centred horizontally", () => {
  // 64x16 image (4:1) against the default 2:1 target -> height-limited: h=16, w=32, centred.
  const box = centeredCropBox(64, 16);
  assert.deepEqual(box, { x: 16, y: 0, w: 32, h: 16 });
});

test("centeredCropBox on a taller-than-target image uses the full width, centred vertically", () => {
  // 32x32 image (1:1) against the default 2:1 target -> width-limited: w=32, h=16, centred.
  const box = centeredCropBox(32, 32);
  assert.deepEqual(box, { x: 0, y: 8, w: 32, h: 16 });
});

test("centeredCropBox on an already 2:1 image fills it exactly", () => {
  assert.deepEqual(centeredCropBox(32, 16), { x: 0, y: 0, w: 32, h: 16 });
});

test("centeredCropBox honours a custom aspect ratio", () => {
  // 1:1 target on a 32x16 image -> width-limited: w=h=16, centred vertically... image is wider
  // than 1:1, so height is the limiting axis: h=16, w=16, centred horizontally.
  assert.deepEqual(centeredCropBox(32, 16, 1, 1), { x: 8, y: 0, w: 16, h: 16 });
});

test("screenDeltaToImageDelta scales a screen-space delta down when the image is rendered larger than natural size", () => {
  // Rendered at 320x160 for a 32x16 natural image -> 10x scale on screen, so a 10px screen
  // movement is 1 source pixel.
  assert.deepEqual(screenDeltaToImageDelta(10, 20, 320, 160, 32, 16), { dx: 1, dy: 2 });
});

test("screenDeltaToImageDelta treats a not-yet-laid-out (zero-size) render as scale 1", () => {
  assert.deepEqual(screenDeltaToImageDelta(5, 5, 0, 0, 32, 16), { dx: 5, dy: 5 });
});

test("moveCropBox translates the box without changing its size", () => {
  assert.deepEqual(moveCropBox({ x: 5, y: 5, w: 10, h: 10 }, 3, -2, 32, 16), { x: 8, y: 3, w: 10, h: 10 });
});

test("moveCropBox clamps at the image edges instead of leaving the image", () => {
  assert.deepEqual(moveCropBox({ x: 0, y: 0, w: 10, h: 10 }, -50, -50, 32, 16), { x: 0, y: 0, w: 10, h: 10 });
  assert.deepEqual(moveCropBox({ x: 22, y: 6, w: 10, h: 10 }, 50, 50, 32, 16), { x: 22, y: 6, w: 10, h: 10 });
});

test("resizeCropBox on the east handle grows the box rightward, leaving the other edges fixed", () => {
  const box = { x: 4, y: 4, w: 8, h: 8 };
  assert.deepEqual(resizeCropBox(box, "e", 4, 0, 32, 16), { x: 4, y: 4, w: 12, h: 8 });
});

test("resizeCropBox on the west handle moves the left edge and keeps the right edge fixed", () => {
  const box = { x: 10, y: 4, w: 8, h: 8 }; // right edge at 18
  assert.deepEqual(resizeCropBox(box, "w", -3, 0, 32, 16), { x: 7, y: 4, w: 11, h: 8 });
});

test("resizeCropBox on a corner handle moves both of its edges together", () => {
  const box = { x: 4, y: 4, w: 8, h: 8 };
  assert.deepEqual(resizeCropBox(box, "se", 4, 2, 32, 16), { x: 4, y: 4, w: 12, h: 10 });
});

test("resizeCropBox clamps the moving edge at the image bound", () => {
  const box = { x: 20, y: 0, w: 8, h: 8 }; // right edge at 28, image width 32
  assert.deepEqual(resizeCropBox(box, "e", 50, 0, 32, 16), { x: 20, y: 0, w: 12, h: 8 });
});

test("resizeCropBox never collapses the box past the 1px minimum size", () => {
  const box = { x: 4, y: 4, w: 8, h: 8 }; // right edge at 12
  const shrunk = resizeCropBox(box, "e", -50, 0, 32, 16);
  assert.equal(shrunk.w, 1);
  assert.equal(shrunk.x, 4); // left edge untouched by an east-handle drag
});

test("resizeCropBox on the north handle shrinks from the top without moving the bottom edge", () => {
  const box = { x: 4, y: 4, w: 8, h: 8 }; // bottom edge at 12
  assert.deepEqual(resizeCropBox(box, "n", 0, 3, 32, 16), { x: 4, y: 7, w: 8, h: 5 });
});
