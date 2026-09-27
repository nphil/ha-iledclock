import { test } from "node:test";
import assert from "node:assert/strict";
import { brightnessToPercent, percentToBrightness } from "../../frontend/src/lib/brightness.ts";

test("brightnessToPercent maps HA brightness onto the user percentage range", () => {
  assert.equal(brightnessToPercent(255), 100);
  assert.equal(brightnessToPercent(1), 1);
  assert.equal(brightnessToPercent(128), 50);
});

test("percentToBrightness maps user percentage onto HA's 1-255 range", () => {
  assert.equal(percentToBrightness(100), 255);
  assert.equal(percentToBrightness(1), 3);
  assert.equal(percentToBrightness(50), 128);
});

test("both directions clamp finite out-of-range and non-finite input", () => {
  assert.equal(brightnessToPercent(0), 1);
  assert.equal(brightnessToPercent(9999), 100);
  assert.equal(brightnessToPercent(Number.NaN), 1);
  assert.equal(brightnessToPercent(Number.POSITIVE_INFINITY), 1);
  assert.equal(percentToBrightness(0), 1);
  assert.equal(percentToBrightness(9999), 255);
  assert.equal(percentToBrightness(Number.NaN), 1);
  assert.equal(percentToBrightness(Number.NEGATIVE_INFINITY), 1);
});

test("round-tripping a percent through brightness and back never drifts by more than one step", () => {
  for (let percent = 1; percent <= 100; percent++) {
    const roundTripped = brightnessToPercent(percentToBrightness(percent));
    assert.ok(Math.abs(roundTripped - percent) <= 1, "percent " + percent + " round-tripped to " + roundTripped);
  }
});
