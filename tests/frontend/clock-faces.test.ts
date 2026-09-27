import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOCK_FACE_COUNT, CLOCK_FACE_STYLE_IDS, CLOCK_FACES, clockFaceLabel, clockFacePreviewFrames, isClockFaceStyle } from "../../frontend/src/lib/clock-faces.ts";

test("clock picker lists real 32x16 firmware faces without the missing style 36", () => {
  assert.equal(CLOCK_FACE_COUNT, 41);
  assert.equal(CLOCK_FACES.length, 40);
  assert.equal(CLOCK_FACES[0]?.style, 1);
  assert.equal(CLOCK_FACES[34]?.style, 35);
  assert.equal(CLOCK_FACES[35]?.style, 37);
  assert.equal(CLOCK_FACES.at(-1)?.style, 41);
  assert.equal(CLOCK_FACE_STYLE_IDS.includes(36), false);
});

test("clock face validation accepts only whole firmware face ids", () => {
  assert.equal(isClockFaceStyle(1), true);
  assert.equal(isClockFaceStyle(41), true);
  assert.equal(isClockFaceStyle(36), false);
  assert.equal(isClockFaceStyle(0), false);
  assert.equal(isClockFaceStyle(1.5), false);
  assert.equal(isClockFaceStyle(Number.NaN), false);
  assert.equal(clockFaceLabel(37), "Style 37");
});

test("clock previews use style geometry and cache by color and hour format", () => {
  const white24 = clockFacePreviewFrames(1, [255, 255, 255], true)[0]!;
  const style10 = clockFacePreviewFrames(10, [255, 255, 255], true)[0]!;
  const red24 = clockFacePreviewFrames(1, [255, 0, 0], true)[0]!;
  const white12 = clockFacePreviewFrames(1, [255, 255, 255], false)[0]!;

  assert.equal(white24.pixels.length, 32 * 16 * 3);
  assert.notDeepEqual([...white24.pixels], [...style10.pixels]);
  assert.notDeepEqual([...white24.pixels], [...red24.pixels]);
  assert.notDeepEqual([...white24.pixels], [...white12.pixels]);
  assert.strictEqual(clockFacePreviewFrames(1, [255, 255, 255], true)[0], white24);
});
