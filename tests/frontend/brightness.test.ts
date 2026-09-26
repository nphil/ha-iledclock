import { test } from "node:test";
import assert from "node:assert/strict";
import { brightnessToPercent, percentToBrightness } from "../../frontend/src/lib/brightness.ts";

test("brightnessToPercent maps the HA 1-255 range onto 1-100%", () => {
  assert.equal(brightnessToPercent(255), 100);
  assert.equal(brightnessToPercent(1), 1);
  assert.equal(brightnessToPercent(128), 50);
});

test("percentToBrightness maps 1-100% back onto HA's 1-255 range", () => {
  assert.equal(percentToBrightness(100), 255);
  assert.equal(percentToBrightness(1), 3); // round(1/100*255) = round(2.55) = 3
  assert.equal(percentToBrightness(50), 128);
});

test("both directions clamp out-of-range input instead of producing an invalid brightness", () => {
  assert.equal(brightnessToPercent(0), 1);
  assert.equal(brightnessToPercent(9999), 100);
  assert.equal(percentToBrightness(0), 1);
  assert.equal(percentToBrightness(9999), 255);
});

test("round-tripping a percent through brightness and back never drifts by more than one step", () => {
  for (let percent = 1; percent <= 100; percent++) {
    const roundTripped = brightnessToPercent(percentToBrightness(percent));
    assert.ok(Math.abs(roundTripped - percent) <= 1, `percent ${percent} round-tripped to ${roundTripped}`);
  }
});
