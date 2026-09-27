import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOCK_FACE_COUNT, CLOCK_FACE_STYLE_IDS, CLOCK_FACES, CLOCK_COLORS, clockFaceLabel, isClockFaceStyle } from "../../frontend/src/lib/clock-faces.ts";

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

test("every clock colour is a distinct named RGB triple", () => {
  assert.equal(CLOCK_COLORS.length, 8);
  const rgbKeys = new Set(CLOCK_COLORS.map((c) => c.rgb.join(",")));
  assert.equal(rgbKeys.size, CLOCK_COLORS.length);
  assert.deepEqual(CLOCK_COLORS.find((c) => c.index === 6)?.rgb, [255, 255, 255]);
});
