import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOCK_FACE_COUNT, CLOCK_FACE_STYLE_IDS, CLOCK_FACES, clockFaceLabel, clockFacePreviewFrames, isClockFaceStyle, type ClockBackgroundFrames } from "../../frontend/src/lib/clock-faces.ts";
import { createFrame } from "../../frontend/src/lib/grid.ts";

test("clock picker lists all 41 real 32x16 firmware faces, including style 36", () => {
  assert.equal(CLOCK_FACE_COUNT, 41);
  assert.equal(CLOCK_FACES.length, 41);
  assert.equal(CLOCK_FACES[0]?.style, 1);
  assert.equal(CLOCK_FACES[35]?.style, 36);
  assert.equal(CLOCK_FACES[36]?.style, 37);
  assert.equal(CLOCK_FACES.at(-1)?.style, 41);
  assert.equal(CLOCK_FACE_STYLE_IDS.includes(36), true);
});

test("clock face validation accepts every whole firmware face id 1-41", () => {
  assert.equal(isClockFaceStyle(1), true);
  assert.equal(isClockFaceStyle(36), true);
  assert.equal(isClockFaceStyle(41), true);
  assert.equal(isClockFaceStyle(42), false);
  assert.equal(isClockFaceStyle(0), false);
  assert.equal(isClockFaceStyle(1.5), false);
  assert.equal(isClockFaceStyle(Number.NaN), false);
  assert.equal(clockFaceLabel(37), "Style 37");
});

test("clock previews use style geometry and cache by color, hour format and background", () => {
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

function solidBackground(rgb: readonly [number, number, number], frameCount = 1): ClockBackgroundFrames {
  const frames = Array.from({ length: frameCount }, () => createFrame(32, 16, rgb));
  return { delayMs: 200, frames };
}

test("a background composites under the digits without recolouring the background pixels", () => {
  const digitsOnly = clockFacePreviewFrames(1, [255, 255, 255], true, null)[0]!;
  const withBg = clockFacePreviewFrames(1, [255, 255, 255], true, solidBackground([10, 20, 30]))[0]!;

  assert.notDeepEqual([...digitsOnly.pixels], [...withBg.pixels]);
  // A corner pixel outside every digit region on style 1 (hour/spaceHour/minute all start at
  // row 0) shows the background colour untouched, not the digit colour.
  const cornerIndex = (15 * 32 + 31) * 3;
  assert.deepEqual([...withBg.pixels.slice(cornerIndex, cornerIndex + 3)], [10, 20, 30]);
});

test("an animated background plays back as one output frame per background frame", () => {
  const background = solidBackground([1, 2, 3], 4);
  const frames = clockFacePreviewFrames(1, [255, 255, 255], true, background);
  assert.equal(frames.length, 4);
  assert.ok(frames.every((frame) => frame.durationMs === 200));
});

test("recolouring: the same background renders different digit colours for different users", () => {
  const background = solidBackground([0, 0, 0]);
  const redDigits = clockFacePreviewFrames(1, [255, 0, 0], true, background)[0]!;
  const blueDigits = clockFacePreviewFrames(1, [0, 0, 255], true, background)[0]!;
  assert.notDeepEqual([...redDigits.pixels], [...blueDigits.pixels]);
});
