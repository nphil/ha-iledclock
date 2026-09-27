import { test } from "node:test";
import assert from "node:assert/strict";
import { ledSizeFor } from "../../frontend/src/lib/led-size.ts";

test("hero previews use integer pitch at phone, tablet, laptop, and wide-screen widths", () => {
  const cases = [[320, 9], [390, 11], [768, 12], [1280, 12], [1920, 12]] as const;
  for (const [viewportWidth, expected] of cases) {
    const availableWidth = Math.min(viewportWidth - 32, 1200);
    const size = ledSizeFor("hero", availableWidth, availableWidth / 2);
    assert.equal(size.pitch, expected, "viewport " + viewportWidth);
    assert.deepEqual([size.width, size.height], [32 * expected, 16 * expected]);
  }
});

test("editor sizing respects available height, pitch limits, and zoom", () => {
  assert.equal(ledSizeFor("editor", 358, 520).pitch, 11);
  assert.equal(ledSizeFor("editor", 720, 400).pitch, 22);
  assert.equal(ledSizeFor("editor", 720, 240).pitch, 15);
  assert.equal(ledSizeFor("editor", 720, 96).pitch, 8);
  assert.equal(ledSizeFor("editor", 1200, 1000, { zoom: 2 }).pitch, 40);
});

test("card cap, tile art scale, and thumbnail pitch remain bounded", () => {
  assert.equal(ledSizeFor("hero", 1200, 600, { maxPitch: 10 }).pitch, 10);
  const tile = ledSizeFor("tile", 148, 148, { artWidth: 8, artHeight: 8 });
  assert.deepEqual([tile.pitch, tile.width, tile.height], [18, 144, 144]);
  assert.equal(ledSizeFor("thumb", 96, 48).pitch, 3);
  assert.equal(ledSizeFor("thumb", 64, 32).pitch, 2);
});
