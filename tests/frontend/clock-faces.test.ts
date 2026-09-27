import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOCK_FACE_COUNT, CLOCK_FACE_STYLE_IDS, CLOCK_FACES, clockFaceLabel, isClockFaceStyle } from "../../frontend/src/lib/clock-faces.ts";

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
  assert.equal(clockFaceLabel(37), "Face 37");
});
