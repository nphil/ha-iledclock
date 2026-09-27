import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXT_EFFECT_COUNT, TEXT_EFFECTS, isTextEffectMode } from "../../frontend/src/lib/text-effects.ts";

test("text effects expose the complete contiguous firmware mode range", () => {
  assert.equal(TEXT_EFFECT_COUNT, 28);
  assert.equal(TEXT_EFFECTS.length, 28);
  assert.equal(TEXT_EFFECTS[0]?.label, "Solid");
  assert.equal(TEXT_EFFECTS[27]?.mode, 28);
  assert.equal(TEXT_EFFECTS[27]?.label, "Effect 28");
});

test("text effect validation rejects modes the firmware cannot accept", () => {
  assert.equal(isTextEffectMode(1), true);
  assert.equal(isTextEffectMode(28), true);
  assert.equal(isTextEffectMode(0), false);
  assert.equal(isTextEffectMode(29), false);
  assert.equal(isTextEffectMode(1.5), false);
  assert.equal(isTextEffectMode(Number.NaN), false);
});
