import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TEXT_EFFECT, TEXT_EFFECTS, textEffectUsesColor } from "../../frontend/src/lib/text-effects.ts";

test("the text effect list is exactly the three modes that draw differently, solid first", () => {
  assert.deepEqual(TEXT_EFFECTS.map((effect) => [effect.mode, effect.label]), [[1, "Solid"], [2, "Rainbow"], [4, "Per-letter rainbow"]]);
  assert.equal(DEFAULT_TEXT_EFFECT, 1);
});

test("only the solid effect uses the colour picker; an unknown mode draws solid so it does too", () => {
  assert.equal(textEffectUsesColor(1), true);
  assert.equal(textEffectUsesColor(2), false);
  assert.equal(textEffectUsesColor(4), false);
  assert.equal(textEffectUsesColor(3), true, "mode 3 is not offered and the server draws it solid");
  assert.equal(textEffectUsesColor(28), true);
});
