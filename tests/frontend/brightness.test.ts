import { test } from "node:test";
import assert from "node:assert/strict";
import { brightnessToPercent, haBrightnessToPercent, percentToBrightness, percentToWireBrightness } from "../../frontend/src/lib/brightness.ts";

test("clock wire brightness maps its native 5-255 range to user 5-100%", () => {
  assert.equal(brightnessToPercent(5), 5);
  assert.equal(brightnessToPercent(163), 65);
  assert.equal(brightnessToPercent(255), 100);
  assert.equal(percentToWireBrightness(5), 5);
  assert.equal(percentToWireBrightness(100), 255);
  assert.equal(percentToWireBrightness(50), 123);
});

test("HA light brightness maps to the same percentage range", () => {
  assert.equal(haBrightnessToPercent(1), 5);
  assert.equal(haBrightnessToPercent(255), 100);
  assert.equal(percentToBrightness(5), 1);
  assert.equal(percentToBrightness(100), 255);
});

test("both brightness mappings clamp out-of-range and non-finite inputs", () => {
  assert.equal(brightnessToPercent(0), 5);
  assert.equal(brightnessToPercent(9999), 100);
  assert.equal(brightnessToPercent(Number.NaN), 5);
  assert.equal(percentToWireBrightness(0), 5);
  assert.equal(percentToWireBrightness(9999), 255);
  assert.equal(percentToWireBrightness(Number.POSITIVE_INFINITY), 5);
  assert.equal(haBrightnessToPercent(0), 5);
  assert.equal(haBrightnessToPercent(9999), 100);
  assert.equal(percentToBrightness(0), 1);
  assert.equal(percentToBrightness(9999), 255);
  assert.equal(percentToBrightness(Number.NaN), 1);
});

test("wire and HA brightness round-trips stay within one displayed percentage point", () => {
  for (let percent = 5; percent <= 100; percent++) {
    const wirePercent = brightnessToPercent(percentToWireBrightness(percent));
    const haPercent = haBrightnessToPercent(percentToBrightness(percent));
    assert.ok(Math.abs(wirePercent - percent) <= 1, "wire percent " + percent + " round-tripped to " + wirePercent);
    assert.ok(Math.abs(haPercent - percent) <= 1, "HA percent " + percent + " round-tripped to " + haPercent);
  }
});
