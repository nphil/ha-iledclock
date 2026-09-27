import { test } from "node:test";
import assert from "node:assert/strict";
import { EVERY_DAY, isRepeatDayOn, repeatSummary, toggleRepeatDay } from "../../frontend/src/lib/repeat-days.ts";

test("isRepeatDayOn reads the correct bit for each day index", () => {
  assert.equal(isRepeatDayOn(0b0000001, 0), true);
  assert.equal(isRepeatDayOn(0b0000001, 1), false);
  assert.equal(isRepeatDayOn(0b1000000, 6), true);
});

test("toggleRepeatDay flips exactly one bit without touching the others", () => {
  let repeat = 0;
  repeat = toggleRepeatDay(repeat, 0);
  assert.equal(repeat, 0b0000001);
  repeat = toggleRepeatDay(repeat, 3);
  assert.equal(repeat, 0b0001001);
  repeat = toggleRepeatDay(repeat, 0);
  assert.equal(repeat, 0b0001000);
});

test("repeatSummary special-cases once, every day, and weekdays", () => {
  assert.equal(repeatSummary(0), "Once");
  assert.equal(repeatSummary(EVERY_DAY), "Every day");
  assert.equal(repeatSummary(0b0011111), "Weekdays");
});

test("repeatSummary lists arbitrary days in weekday order", () => {
  const monWedFri = toggleRepeatDay(toggleRepeatDay(toggleRepeatDay(0, 0), 2), 4);
  assert.equal(repeatSummary(monWedFri), "Mon, Wed, Fri");
  assert.equal(repeatSummary(toggleRepeatDay(0, 6)), "Sun");
});

test("invalid day indexes never read or toggle a different day", () => {
  for (const index of [-1, 7, 1.5, Number.NaN]) {
    assert.equal(isRepeatDayOn(1, index), false);
    assert.equal(toggleRepeatDay(1, index), 1);
  }
  assert.equal(toggleRepeatDay(0xff, 7), EVERY_DAY);
});

test("repeat summaries ignore bits outside the seven-day mask", () => {
  assert.equal(repeatSummary(0x80), "Once");
  assert.equal(repeatSummary(0xff), "Every day");
});
