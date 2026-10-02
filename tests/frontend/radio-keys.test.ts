import { test } from "node:test";
import assert from "node:assert/strict";
import { radioTargetIndex } from "../../frontend/src/lib/radio-keys.ts";

test("arrow keys move to the next option and wrap around at both ends", () => {
  const all = [true, true, true];
  assert.equal(radioTargetIndex("ArrowRight", 0, all), 1);
  assert.equal(radioTargetIndex("ArrowDown", 1, all), 2);
  assert.equal(radioTargetIndex("ArrowRight", 2, all), 0);
  assert.equal(radioTargetIndex("ArrowLeft", 0, all), 2);
  assert.equal(radioTargetIndex("ArrowUp", 2, all), 1);
});

test("disabled options are skipped, and a lone enabled option stays put", () => {
  assert.equal(radioTargetIndex("ArrowRight", 0, [true, false, false, true]), 3);
  assert.equal(radioTargetIndex("ArrowLeft", 0, [true, false, false, true]), 3);
  assert.equal(radioTargetIndex("ArrowRight", 1, [false, true, false]), 1);
  assert.equal(radioTargetIndex("ArrowRight", 0, [false, false]), 0);
});

test("Home and End jump to the first and last enabled option", () => {
  assert.equal(radioTargetIndex("Home", 3, [false, true, true, true]), 1);
  assert.equal(radioTargetIndex("End", 0, [true, true, false]), 1);
});

test("other keys are not navigation", () => {
  assert.equal(radioTargetIndex("Tab", 0, [true, true]), null);
  assert.equal(radioTargetIndex(" ", 0, [true, true]), null);
  assert.equal(radioTargetIndex("ArrowRight", 0, []), null);
});
