import { test } from "node:test";
import assert from "node:assert/strict";
import { EVERY_DAY, isRepeatDayOn, repeatSummary, toggleRepeatDay } from "../../frontend/src/lib/repeat-days.ts";

test("isRepeatDayOn reads the correct bit for each day index", () => {
  assert.equal(isRepeatDayOn(0b0000001, 0), true); // Monday
  assert.equal(isRepeatDayOn(0b0000001, 1), false);
  assert.equal(isRepeatDayOn(0b1000000, 6), true); // Sunday
});

test("toggleRepeatDay flips exactly one bit without touching the others", () => {
  let repeat = 0;
  repeat = toggleRepeatDay(repeat, 0);
  assert.equal(repeat, 0b0000001);
  repeat = toggleRepeatDay(repeat, 3);
  assert.equal(repeat, 0b0001001);
  repeat = toggleRepeatDay(repeat, 0); // toggling back off
  assert.equal(repeat, 0b0001000);
});

test("repeatSummary special-cases 0, every day, and weekdays", () => {
  assert.equal(repeatSummary(0), "Once");
  assert.equal(repeatSummary(EVERY_DAY), "Every day");
  assert.equal(repeatSummary(0b0011111), "Weekdays");
});

test("repeatSummary lists an arbitrary combination by name, in day order", () => {
  const monWedFri = toggleRepeatDay(toggleRepeatDay(toggleRepeatDay(0, 0), 2), 4);
  assert.equal(repeatSummary(monWedFri), "Mon, Wed, Fri");
});

test("repeatSummary for a single day", () => {
  assert.equal(repeatSummary(toggleRepeatDay(0, 6)), "Sun");
});
