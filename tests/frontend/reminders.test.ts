import { setImmediate as flush } from "node:timers/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TextArtCache,
  addBlockedReason,
  availableSlots,
  blankForm,
  changeRepeat,
  decodeRenderedFrames,
  describeNextRing,
  designEligibility,
  designMeta,
  durationLabel,
  editingRecord,
  foreignRepeatSummary,
  formFromItem,
  formToInput,
  formatClockTime,
  friendlyReminderError,
  nextMonthlyDate,
  nextOccurrenceDate,
  nextRing,
  nextYearlyDate,
  normalizeDays,
  ordinal,
  parseIsoDate,
  parseTimeValue,
  playedFrameCount,
  repeatSummary,
  resolveReminderCapabilities,
  savedStatusText,
  slotChip,
  slotsNeeded,
  sortReminders,
  statusView,
  timeLocaleFromHass,
  uploadPercent,
  usesSlotsText,
  validateForm,
  wallClockNow,
  type AlarmForm,
  type FormContext,
  type TimeLocale,
} from "../../frontend/src/lib/reminders.ts";
import type { ManagedReminder, StoredDesign } from "../../frontend/src/types.ts";

const GB: TimeLocale = { locale: "en-GB" };
const US: TimeLocale = { locale: "en-US" };
const CAPS = resolveReminderCapabilities(null);
/** Friday 2 October 2026, 06:40 in the machine's own time zone, like every other date here. */
const NOW = new Date(2026, 9, 2, 6, 40);

function item(patch: Partial<ManagedReminder> = {}): ManagedReminder {
  return { key: "k1", name: "Wake up", kind: "alarm", hour: 7, minute: 0, date: null, repeat: "daily", days: [], duration_s: 30, attachment: { kind: "text" }, enabled: true, status: "synced", slots: 1, device_ids: [3], last_error: null, updated: 0, ...patch };
}

function design(patch: Partial<StoredDesign> = {}): StoredDesign {
  return { id: "d1", name: "Dot", kind: "image", width: 32, height: 16, frames: ["x"], delays: [100], created: 0, updated: 0, ...patch };
}

function form(patch: Partial<AlarmForm> = {}): AlarmForm {
  return { name: "Wake up", kind: "alarm", time: "07:00", repeat: "daily", days: [], date: "", durationS: 30, attachment: { kind: "text" }, enabled: true, ...patch };
}

function context(patch: Partial<FormContext> = {}): FormContext {
  return { now: NOW, capabilities: CAPS, list: { free: 10 }, ...patch };
}

// ---- capabilities and slot cost ------------------------------------------------------------------------

test("capabilities fall back to the server defaults and drop what the screen does not know", () => {
  assert.deepEqual(resolveReminderCapabilities(undefined).durations, [30, 60, 120, 180]);
  const caps = resolveReminderCapabilities({ capacity: 8, repeats: ["once", "daily", "fortnightly" as never], durations: [], max_frames: 12, week_mask: true });
  assert.equal(caps.capacity, 8);
  assert.deepEqual(caps.repeats, ["once", "daily"]);
  assert.deepEqual(caps.durations, [30, 60, 120, 180]);
  assert.equal(caps.max_frames, 12);
  assert.equal(caps.week_mask, true);
});

test("slot cost mirrors the server: one slot per weekday unless the clock takes a week mask", () => {
  for (const repeat of ["once", "daily", "monthly", "yearly"] as const) assert.equal(slotsNeeded(repeat, [], false), 1);
  assert.equal(slotsNeeded("weekly", [2], false), 1);
  assert.equal(slotsNeeded("weekdays", [], false), 5);
  assert.equal(slotsNeeded("weekends", [], false), 2);
  assert.equal(slotsNeeded("custom", [0, 2, 4], false), 3);
  assert.equal(slotsNeeded("custom", [0, 1, 2, 3, 4, 5], false), 6);
  // Duplicates and out-of-range days are not days.
  assert.equal(slotsNeeded("custom", [1, 1, 9, -1], false), 1);
  assert.equal(slotsNeeded("custom", [], false), 1);
});

test("picking all seven days for a custom repeat is every day, which costs one slot", () => {
  assert.equal(slotsNeeded("custom", [0, 1, 2, 3, 4, 5, 6], false), 1);
  // Order, duplicates and stray values change nothing; six distinct days still cost six.
  assert.equal(slotsNeeded("custom", [6, 5, 4, 3, 2, 1, 0, 0, 9], false), 1);
  assert.equal(slotsNeeded("custom", [6, 5, 4, 3, 2, 1, 1], false), 6);
  // The form agrees: a clock with one free slot takes it, six days need six.
  assert.equal(validateForm(form({ repeat: "custom", days: [0, 1, 2, 3, 4, 5, 6] }), context({ list: { free: 1 } })).slots, undefined);
  assert.match(validateForm(form({ repeat: "custom", days: [0, 1, 2, 3, 4, 5] }), context({ list: { free: 5 } })).slots!, /needs 6 clock slots but only 5 are free/);
});

test("with a week mask every pattern fits in one slot", () => {
  assert.equal(slotsNeeded("weekdays", [], true), 1);
  assert.equal(slotsNeeded("weekends", [], true), 1);
  assert.equal(slotsNeeded("custom", [0, 1, 2, 3], true), 1);
  assert.equal(slotsNeeded("custom", [], true), 1);
  assert.equal(slotsNeeded("weekly", [6], true), 1);
});

test("the slot chip warns from two free slots and says when the clock is full", () => {
  assert.deepEqual(slotChip({ capacity: 16, used: 5 }), { label: "5 of 16 clock slots used", kind: "neutral", full: false });
  assert.equal(slotChip({ capacity: 16, used: 13 }).kind, "neutral");
  assert.equal(slotChip({ capacity: 16, used: 14 }).kind, "warning");
  assert.deepEqual(slotChip({ capacity: 16, used: 16 }), { label: "16 of 16 clock slots used", kind: "warning", full: true });
});

test("an item being edited can reuse the slots it already holds", () => {
  assert.equal(availableSlots(null, null), null);
  assert.equal(availableSlots({ free: 2 }, null), 2);
  assert.equal(availableSlots({ free: 2 }, { device_ids: [1, 2, 3, 4, 5] }), 7);
  assert.equal(availableSlots({ free: 2 }, { device_ids: [] }), 2);
  // Switched off, but the clock never confirmed the delete: it still holds those slots, and enabling it reuses them.
  assert.equal(availableSlots({ free: 0 }, { device_ids: [4, 5] }), 2);
});

test("the item a form edits is looked up by its key in the current list", () => {
  const stored = item({ key: "made1", status: "error", device_ids: [1, 2, 3, 4, 5] });
  const opened = item({ key: "k1" });
  assert.equal(editingRecord({ items: [stored, opened] }, "made1", null), stored);
  // A first save stored the item although the clock failed: the sheet was opened as "new", so nothing was passed in.
  assert.equal(editingRecord({ items: [stored] }, "made1", null), stored);
  // The list is fresher than what the sheet was opened with.
  const fresher = item({ key: "k1", status: "missing" });
  assert.equal(editingRecord({ items: [fresher] }, "k1", opened), fresher);
  // Not in the list (yet): fall back to what the sheet was opened with, but only for the same key.
  assert.equal(editingRecord({ items: [] }, "k1", opened), opened);
  assert.equal(editingRecord({ items: [] }, "other", opened), null);
  assert.equal(editingRecord(null, "k1", null), null);
  // A brand-new form has no key and edits nothing.
  assert.equal(editingRecord({ items: [stored] }, undefined, opened), null);
});

test("after a failed first save the stored item's held slots count, so Save is not stuck at zero free", () => {
  const weekdays = form({ repeat: "weekdays", key: "made1" });
  const list = { free: 0, items: [item({ key: "made1", status: "error", device_ids: [1, 2, 3, 4, 5] })] };
  assert.equal(validateForm(weekdays, context({ list, editing: editingRecord(list, weekdays.key, null) })).slots, undefined);
  // Looking nothing up (the sheet was opened as "new") credits nothing and leaves Save blocked.
  assert.match(validateForm(weekdays, context({ list, editing: null })).slots!, /needs 5 clock slots but none are free/);
});

test("Add stays blocked only when no clock slot is free", () => {
  assert.equal(addBlockedReason(null), null);
  assert.equal(addBlockedReason({ free: 1, capacity: 16 }), null);
  assert.match(addBlockedReason({ free: 0, capacity: 16 })!, /clock is full \(16 of 16 slots\)/);
});

// ---- wording -------------------------------------------------------------------------------------------

test("repeat summaries read like the iOS clock", () => {
  const base = { date: null, days: [] as number[] };
  assert.equal(repeatSummary({ ...base, repeat: "daily" }, GB), "Every day");
  assert.equal(repeatSummary({ ...base, repeat: "weekdays" }, GB), "Weekdays");
  assert.equal(repeatSummary({ ...base, repeat: "weekends" }, GB), "Weekends");
  assert.equal(repeatSummary({ ...base, repeat: "custom", days: [2, 0] }, GB), "Mon, Wed");
  assert.equal(repeatSummary({ ...base, repeat: "weekly", days: [4] }, GB), "Every Friday");
  assert.equal(repeatSummary({ ...base, repeat: "monthly", date: "2026-10-15" }, GB), "Every month on the 15th");
  assert.equal(repeatSummary({ ...base, repeat: "yearly", date: "2026-10-02" }, GB), "Every year on 2 Oct");
  assert.equal(repeatSummary({ ...base, repeat: "once", date: "2026-10-02" }, GB), "Once · Fri 2 Oct");
  assert.equal(repeatSummary({ ...base, repeat: "once", date: "2026-10-02" }, US), "Once · Fri Oct 2");
});

test("a custom pick that equals a named pattern is called by that name", () => {
  const custom = (days: number[]) => repeatSummary({ repeat: "custom", date: null, days }, GB);
  assert.equal(custom([0, 1, 2, 3, 4]), "Weekdays");
  assert.equal(custom([6, 5]), "Weekends");
  assert.equal(custom([0, 1, 2, 3, 4, 5, 6]), "Every day");
  assert.equal(custom([]), "No days picked");
});

test("ordinals handle the teens and the twenties", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "28th"]);
});

test("times follow the Home Assistant language and its 12/24-hour choice", () => {
  assert.deepEqual(formatClockTime(7, 0, US), { text: "7:00 AM", main: "7:00", period: "AM", periodFirst: false });
  assert.equal(formatClockTime(0, 5, US).text, "12:05 AM");
  const h23 = formatClockTime(7, 5, { locale: "en-US", hourCycle: "h23" });
  assert.equal(h23.period, "");
  assert.match(h23.main, /^0?7:05$/);
  assert.equal(formatClockTime(0, 5, { locale: "en-US", hourCycle: "h23" }).main, "00:05");
  assert.equal(formatClockTime(13, 30, { locale: "en-US", hourCycle: "h12" }).main, "1:30");
  assert.equal(formatClockTime(7, 0, { locale: "zh-CN", hourCycle: "h12" }).periodFirst, true);
  assert.equal(formatClockTime(7, 0, { locale: "not a locale" }).text, "7:00 AM");
});

test("Home Assistant's own time-format setting wins over the language default", () => {
  assert.deepEqual(timeLocaleFromHass({ language: "en", locale: { language: "de", time_format: "24" } }), { locale: "de", hourCycle: "h23" });
  assert.deepEqual(timeLocaleFromHass({ language: "en", locale: { language: "en-GB", time_format: "12" } }), { locale: "en-GB", hourCycle: "h12" });
  assert.deepEqual(timeLocaleFromHass({ language: "fr", locale: { language: "fr", time_format: "language" } }), { locale: "fr" });
  assert.deepEqual(timeLocaleFromHass(null), { locale: "en" });
});

test("time and date values reject anything that is not a real time or day", () => {
  assert.deepEqual(parseTimeValue("07:05"), { hour: 7, minute: 5 });
  assert.deepEqual(parseTimeValue("7:05"), { hour: 7, minute: 5 });
  for (const bad of ["", "24:00", "07:60", "7", "07:5", "ab:cd", null, undefined]) assert.equal(parseTimeValue(bad as string), null);
  assert.deepEqual(parseIsoDate("2028-02-29"), { year: 2028, month: 2, day: 29 });
  for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-10-32", "26-10-02", "", null]) assert.equal(parseIsoDate(bad as string), null);
});

// ---- next ring ------------------------------------------------------------------------------------------

function ring(patch: Partial<ManagedReminder>, now = NOW): Date | null {
  return nextRing(item(patch), now);
}

test("daily rings later today when the time is still ahead, tomorrow once it has passed", () => {
  assert.deepEqual(ring({ hour: 14, minute: 0 }), new Date(2026, 9, 2, 14, 0));
  assert.deepEqual(ring({ hour: 6, minute: 41 }), new Date(2026, 9, 2, 6, 41));
  // The very minute that is "now" has already begun.
  assert.deepEqual(ring({ hour: 6, minute: 40 }), new Date(2026, 9, 3, 6, 40));
  assert.deepEqual(ring({ hour: 5, minute: 0 }), new Date(2026, 9, 3, 5, 0));
});

test("weekday and weekend items skip to the right days", () => {
  const fridayEvening = new Date(2026, 9, 2, 18, 0);
  assert.deepEqual(ring({ repeat: "weekdays", hour: 7 }, fridayEvening), new Date(2026, 9, 5, 7, 0));
  assert.deepEqual(ring({ repeat: "weekends", hour: 9 }, fridayEvening), new Date(2026, 9, 3, 9, 0));
  assert.deepEqual(ring({ repeat: "weekdays", hour: 7 }, new Date(2026, 9, 3, 12, 0)), new Date(2026, 9, 5, 7, 0));
});

test("custom and weekly items pick the next listed day and wrap into next week", () => {
  assert.deepEqual(ring({ repeat: "custom", days: [0, 2], hour: 7 }), new Date(2026, 9, 5, 7, 0));
  assert.deepEqual(ring({ repeat: "weekly", days: [4], hour: 6, minute: 0 }), new Date(2026, 9, 9, 6, 0));
  assert.deepEqual(ring({ repeat: "weekly", days: [4], hour: 8, minute: 0 }), new Date(2026, 9, 2, 8, 0));
  assert.equal(ring({ repeat: "custom", days: [] }), null);
});

test("monthly rolls to next month, yearly to next year, and both skip dates that do not exist", () => {
  const late = new Date(2026, 9, 20, 12, 0);
  assert.deepEqual(ring({ repeat: "monthly", date: "2026-10-15", hour: 9, minute: 0 }, late), new Date(2026, 10, 15, 9, 0));
  // November has no 31st, so a "31st" item skips it.
  const november = new Date(2026, 10, 5, 12, 0);
  assert.deepEqual(ring({ repeat: "monthly", date: "2026-01-31", hour: 9, minute: 0 }, november), new Date(2026, 11, 31, 9, 0));
  assert.deepEqual(ring({ repeat: "yearly", date: "2026-03-01", hour: 9, minute: 0 }, late), new Date(2027, 2, 1, 9, 0));
  assert.deepEqual(ring({ repeat: "yearly", date: "2028-02-29", hour: 9, minute: 0 }, late), new Date(2028, 1, 29, 9, 0));
});

test("a one-time item rings once; in the past or without a date it never rings", () => {
  assert.deepEqual(ring({ repeat: "once", date: "2026-10-03", hour: 8, minute: 30 }), new Date(2026, 9, 3, 8, 30));
  assert.equal(ring({ repeat: "once", date: "2026-10-02", hour: 6, minute: 0 }), null);
  assert.equal(ring({ repeat: "once", date: null }), null);
  assert.equal(ring({ hour: 25 }), null);
});

test("next-ring text counts down, then names the day", () => {
  const text = (next: Date | null, locale = US) => describeNextRing(next, NOW, locale);
  assert.equal(text(new Date(2026, 9, 2, 6, 40, 30)), "Rings in 1 min");
  assert.equal(text(new Date(2026, 9, 2, 7, 5)), "Rings in 25 min");
  assert.equal(text(new Date(2026, 9, 2, 7, 40)), "Rings in 1 h");
  assert.equal(text(new Date(2026, 9, 2, 14, 0)), "Rings in 7 h 20 min");
  assert.equal(text(new Date(2026, 9, 3, 6, 39)), "Rings in 23 h 59 min");
  assert.equal(text(new Date(2026, 9, 3, 8, 0)), "Rings tomorrow at 8:00 AM");
  assert.equal(text(new Date(2026, 9, 5, 7, 0)), "Rings Mon at 7:00 AM");
  assert.equal(text(new Date(2026, 9, 10, 7, 0), GB), "Rings Sat 10 Oct at 7:00");
  assert.equal(text(new Date(2026, 9, 10, 7, 0)), "Rings Sat Oct 10 at 7:00 AM");
  assert.equal(text(null), "Won't ring again");
});

test("the list is sorted by next ring, with finished items last and ties broken by name", () => {
  const items = [
    item({ key: "past", name: "Dentist", repeat: "once", date: "2026-09-01", hour: 9 }),
    item({ key: "tomorrow", name: "Gym", hour: 5 }),
    item({ key: "later", name: "Lunch", hour: 12 }),
    item({ key: "soon-b", name: "Beta", hour: 7 }),
    item({ key: "soon-a", name: "Alpha", hour: 7, enabled: false, status: "disabled" }),
  ];
  assert.deepEqual(sortReminders(items, NOW).map((entry) => entry.key), ["soon-a", "soon-b", "later", "tomorrow", "past"]);
});

// ---- status ----------------------------------------------------------------------------------------------

test("each status has one honest line and, where it helps, a recovery button", () => {
  const view = (patch: Partial<ManagedReminder>) => statusView(item(patch), NOW, US);
  assert.deepEqual(view({ hour: 14 }), { tone: "ok", text: "Rings in 7 h 20 min", action: null, actionLabel: "" });
  assert.deepEqual(view({ status: "disabled", enabled: false }), { tone: "muted", text: "Off", action: null, actionLabel: "" });
  assert.deepEqual(view({ status: "done" }), { tone: "muted", text: "Done", action: null, actionLabel: "" });
  assert.deepEqual(view({ status: "missing" }), { tone: "warn", text: "Not on the clock", action: "resend", actionLabel: "Re-send" });
  assert.deepEqual(view({ status: "changed" }), { tone: "warn", text: "Changed on the clock", action: "resend", actionLabel: "Re-send" });
  assert.deepEqual(view({ status: "pending" }), { tone: "info", text: "Not sent to the clock yet", action: "resend", actionLabel: "Send now" });
  assert.equal(view({ status: "error", last_error: "Out of range" }).text, "Couldn't send · Out of range");
  assert.equal(view({ status: "error", last_error: null }).text, "Couldn't send");
  // A reason that already says "Couldn't ..." is not prefixed a second time.
  assert.equal(view({ status: "error", last_error: "Couldn't reach the clock. Move it closer." }).text, "Couldn't reach the clock. Move it closer.");
  assert.equal(savedStatusText({ status: "error", last_error: "Out of range" }).text, "Saved here · couldn't send · Out of range");
});

test("only a synced item may claim it works without Home Assistant", () => {
  assert.equal(savedStatusText({ status: "synced", last_error: null }).text, "Saved to clock · works without Home Assistant");
  for (const status of ["disabled", "done", "pending", "missing", "changed", "error"] as const) {
    assert.doesNotMatch(savedStatusText({ status, last_error: null }).text, /works without Home Assistant/);
  }
  assert.equal(savedStatusText({ status: "error", last_error: "Out of range" }).tone, "error");
});

test("an item that uses several slots says so, and says it holds them only while on", () => {
  assert.equal(usesSlotsText({ slots: 1, enabled: true }), "");
  assert.equal(usesSlotsText({ slots: 5, enabled: true }), "Uses 5 slots");
  assert.equal(usesSlotsText({ slots: 5, enabled: false }), "Uses 5 slots when on");
});

test("upload progress becomes a clamped whole percent, or nothing when the total is unknown", () => {
  assert.equal(uploadPercent({ upload: { done: 1, total: 3 } }), 33);
  assert.equal(uploadPercent({ upload: { done: 9, total: 3 } }), 100);
  assert.equal(uploadPercent({ upload: { done: 0, total: 0 } }), null);
  assert.equal(uploadPercent({ upload: null }), null);
  assert.equal(uploadPercent(null), null);
});

test("ring lengths read as seconds or whole minutes", () => {
  assert.deepEqual([30, 60, 120, 180, 90].map(durationLabel), ["30 s", "1 min", "2 min", "3 min", "90 s"]);
});

test("reminders made with the vendor app are summarised from the clock's own repeat code", () => {
  const base = { year: 2026, month: 10, day: 2, week_mask: 0 };
  assert.equal(foreignRepeatSummary({ ...base, repeat_type: 0 }, GB), "Once · Fri 2 Oct");
  assert.equal(foreignRepeatSummary({ ...base, repeat_type: 1, week_mask: 0x7f }, GB), "Every day");
  assert.equal(foreignRepeatSummary({ ...base, repeat_type: 1 }, GB), "Every day");
  assert.equal(foreignRepeatSummary({ ...base, repeat_type: 1, week_mask: 0b0011111 }, GB), "Weekdays");
  assert.equal(foreignRepeatSummary({ ...base, repeat_type: 2, week_mask: 0b0010000 }, GB), "Every Friday");
  // No mask: the weekday of its own date (2 Oct 2026 is a Friday).
  assert.equal(foreignRepeatSummary({ ...base, repeat_type: 2 }, GB), "Every Friday");
  assert.equal(foreignRepeatSummary({ ...base, repeat_type: 3 }, GB), "Every month on the 2nd");
  assert.equal(foreignRepeatSummary({ ...base, repeat_type: 4 }, GB), "Every year on 2 Oct");
});

// ---- art -----------------------------------------------------------------------------------------------

test("art must be short enough and must not reserve space for the live clock", () => {
  assert.deepEqual(designEligibility(design(), 40), { ok: true, reason: null });
  assert.deepEqual(designEligibility(design({ frames: Array(40).fill("x") }), 40), { ok: true, reason: null });
  assert.equal(designEligibility(design({ frames: Array(41).fill("x") }), 40).reason, "Over the 40-frame limit");
  assert.equal(designEligibility(design({ clock_region: { x: 16, y: 0, w: 16, h: 16 } }), 40).reason, "Can't include a live clock");
  assert.equal(designEligibility(design({ tags: ["with_clock"] }), 40).ok, false);
  assert.equal(designEligibility(design({ frames: [] }), 40).ok, false);
  assert.equal(designMeta(design()), "Still picture");
  assert.equal(designMeta(design({ frames: ["x", "y", "z"] })), "Animated · 3 frames");
});

test("art is judged by the frames actually played: a long design set to Still is one frame", () => {
  const long = (patch: Partial<StoredDesign> = {}) => design({ kind: "animation", frames: Array(41).fill("x"), ...patch });
  assert.equal(designEligibility(long(), 40).ok, false);
  assert.equal(designEligibility(long({ speed: null }), 40).ok, false);
  // Still plays one poster frame whatever the authored count.
  assert.deepEqual(designEligibility(long({ speed: 0 }), 40), { ok: true, reason: null });
  assert.equal(playedFrameCount(long({ speed: 0 })), 1);
  // Any other saved speed keeps the authored count (the real number depends on the pictures, so the server has the last word).
  assert.equal(designEligibility(long({ speed: 35 }), 40).ok, false);
  assert.equal(playedFrameCount(long({ speed: 35 })), 41);
  // A live-clock area rules it out Still or not; a single picture is one frame whatever its speed says.
  assert.equal(designEligibility(long({ speed: 0, tags: ["with_clock"] }), 40).ok, false);
  assert.equal(playedFrameCount(design({ speed: 0 })), 1);
  assert.equal(playedFrameCount(design({ frames: [] })), 0);
  assert.equal(designMeta(long({ speed: 0 })), "Set to Still · 41 frames");
  // The form takes the Still design and refuses the same design at its normal speed.
  const chosen = form({ attachment: { kind: "design", design_id: "d1" } });
  assert.equal(validateForm(chosen, context({ designs: [long({ speed: 0 })] })).attachment, undefined);
  assert.match(validateForm(chosen, context({ designs: [long()] })).attachment!, /Over the 40-frame limit/);
});

const BLANK_FRAME = btoa("\0".repeat(1536));
const RENDERED = { frames: [BLANK_FRAME], delays: [100] };
const WHITE = [255, 255, 255] as const;

test("rendered text frames decode to 32x16 frames with their delays", () => {
  const frames = decodeRenderedFrames({ frames: [BLANK_FRAME, BLANK_FRAME], delays: [40, 80] });
  assert.deepEqual(frames.map((frame) => [frame.width, frame.height, frame.durationMs, frame.pixels.length]), [[32, 16, 40, 1536], [32, 16, 80, 1536]]);
});

test("the text-art cache asks once per name and colour, and tries again after a failure", async () => {
  let calls = 0;
  let fail = true;
  const cache = new TextArtCache(async () => {
    calls++;
    if (fail) throw new Error("render failed");
    return RENDERED;
  });
  await assert.rejects(cache.load("Wake up", WHITE), /render failed/);
  assert.equal(cache.peek("Wake up", WHITE), undefined);
  fail = false;
  const [a, b] = await Promise.all([cache.load("Wake up", WHITE), cache.load("Wake up", WHITE)]);
  assert.equal(a, b);
  assert.equal(calls, 2);
  await cache.load("Wake up", WHITE);
  assert.equal(calls, 2);
  await cache.load("Wake up", [255, 0, 0]);
  assert.equal(calls, 3);
  assert.equal(cache.peek("Wake up", WHITE), a);
});

test("the text-art cache forgets the oldest drawing beyond its limit", async () => {
  const cache = new TextArtCache(async () => RENDERED, { max: 2 });
  await cache.load("one", WHITE);
  await cache.load("two", WHITE);
  await cache.load("three", WHITE);
  assert.equal(cache.peek("one", WHITE), undefined);
  assert.notEqual(cache.peek("two", WHITE), undefined);
  assert.notEqual(cache.peek("three", WHITE), undefined);
});

test("the text-art cache never runs more requests at once than it was allowed", async () => {
  let active = 0;
  let peak = 0;
  const gates: Array<() => void> = [];
  const cache = new TextArtCache(async () => {
    active++;
    peak = Math.max(peak, active);
    const gate = Promise.withResolvers<void>();
    gates.push(gate.resolve);
    await gate.promise;
    active--;
    return RENDERED;
  }, { concurrency: 2 });
  const loads = ["a", "b", "c", "d"].map((name) => cache.load(name, WHITE));
  await flush();
  assert.equal(gates.length, 2);
  gates.splice(0).forEach((open) => open());
  await flush();
  assert.equal(gates.length, 2);
  gates.splice(0).forEach((open) => open());
  await Promise.all(loads);
  assert.equal(peak, 2);
});

// ---- the form -------------------------------------------------------------------------------------------

test("a new item starts at the next whole hour, once, on the day that hour falls", () => {
  assert.deepEqual(blankForm(NOW), { name: "", kind: "alarm", time: "07:00", repeat: "once", days: [], date: "2026-10-02", durationS: 30, attachment: { kind: "text" }, enabled: true });
  const lateNight = blankForm(new Date(2026, 9, 2, 23, 30));
  assert.equal(lateNight.time, "00:00");
  assert.equal(lateNight.date, "2026-10-03");
});

test("the form and the server payload round-trip, and the payload is always complete", () => {
  const original = item({ repeat: "custom", days: [4, 0, 4], name: "Gym", kind: "reminder", duration_s: 120, attachment: { kind: "design", design_id: "d9" }, hour: 18, minute: 5 });
  const input = formToInput(formFromItem(original));
  assert.deepEqual(input, { key: "k1", name: "Gym", kind: "reminder", hour: 18, minute: 5, date: null, repeat: "custom", days: [0, 4], duration_s: 120, attachment: { kind: "design", design_id: "d9" }, enabled: true });
});

test("switching to a repeat that needs no date or days clears them from the payload", () => {
  const daily = formToInput(form({ repeat: "daily", date: "2026-10-02", days: [1, 2] }));
  assert.equal(daily.date, null);
  assert.deepEqual(daily.days, []);
  const weekdays = formToInput(form({ repeat: "weekdays", days: [6] }));
  assert.deepEqual(weekdays.days, []);
  const monthly = formToInput(form({ repeat: "monthly", date: "2026-10-15", days: [3] }));
  assert.equal(monthly.date, "2026-10-15");
  assert.deepEqual(monthly.days, []);
});

test("the payload trims the name, leaves out the key for a new item and keeps a chosen text colour", () => {
  const fresh = formToInput(form({ name: "  Take pills  " }));
  assert.equal(fresh.name, "Take pills");
  assert.equal("key" in fresh, false);
  assert.deepEqual(fresh.attachment, { kind: "text" });
  assert.deepEqual(formToInput(form({ attachment: { kind: "text", color: [255, 255, 255] } })).attachment, { kind: "text" });
  assert.deepEqual(formToInput(form({ attachment: { kind: "text", color: [0, 255, 0] } })).attachment, { kind: "text", color: [0, 255, 0] });
});

test("picking a repeat fills in the date or day it needs", () => {
  const start = form({ repeat: "daily", time: "07:00" });
  assert.equal(changeRepeat(start, "once", NOW).date, "2026-10-02");
  assert.equal(changeRepeat({ ...start, time: "05:00" }, "once", NOW).date, "2026-10-03");
  assert.deepEqual(changeRepeat(start, "weekly", NOW).days, [4]);
  assert.deepEqual(changeRepeat({ ...start, days: [1, 3] }, "weekly", NOW).days, [1]);
  assert.deepEqual(changeRepeat({ ...start, days: [1, 3] }, "custom", NOW).days, [1, 3]);
  assert.deepEqual(changeRepeat({ ...start, days: [1, 3] }, "daily", NOW).days, []);
  assert.equal(changeRepeat(start, "daily", NOW).date, "");
  assert.equal(changeRepeat(start, "monthly", NOW).date, "2026-10-02");
  assert.equal(changeRepeat({ ...start, time: "06:00" }, "monthly", NOW).date, "2026-11-02");
  assert.equal(changeRepeat(start, "yearly", NOW).date, "2026-10-02");
  assert.equal(changeRepeat({ ...start, time: "06:00" }, "yearly", NOW).date, "2027-10-02");
  // A kept date survives a switch between date-based repeats.
  assert.equal(changeRepeat(form({ repeat: "once", date: "2026-10-20" }), "once", NOW).date, "2026-10-20");
});

test("date helpers find the next occurrence and never offer a day that does not exist every time", () => {
  const time = { hour: 7, minute: 0 };
  assert.equal(nextOccurrenceDate(time, NOW), "2026-10-02");
  assert.equal(nextOccurrenceDate({ hour: 6, minute: 0 }, NOW), "2026-10-03");
  assert.equal(nextMonthlyDate(31, time, NOW), "2026-10-28");
  assert.equal(nextMonthlyDate(1, time, NOW), "2026-11-01");
  assert.equal(nextYearlyDate(2, 29, time, NOW), "2027-02-28");
  assert.equal(nextYearlyDate(4, 31, time, NOW), "2027-04-30");
  assert.deepEqual(normalizeDays([6, 2, 2, 9, -1, 0.5]), [2, 6]);
});

// ---- validation ----------------------------------------------------------------------------------------

test("a clean form has no errors", () => {
  assert.deepEqual(validateForm(form(), context()), {});
});

test("names count UTF-16 units like the clock's own app, not letters", () => {
  assert.equal(validateForm(form({ name: "   " }), context()).name, "Give it a name.");
  assert.equal(validateForm(form({ name: "a".repeat(20) }), context()).name, undefined);
  assert.equal(validateForm(form({ name: "a".repeat(21) }), context()).name, "Names can be up to 20 characters.");
  // Ten emoji are twenty UTF-16 units; eleven are twenty-two.
  assert.equal(validateForm(form({ name: "🔔".repeat(10) }), context()).name, undefined);
  assert.match(validateForm(form({ name: "🔔".repeat(11) }), context()).name!, /up to 20/);
  assert.match(validateForm(form({ name: "Wake\nup" }), context()).name!, /control characters/);
});

test("a name that is short enough in characters can still be too big for the clock in bytes", () => {
  const caps = resolveReminderCapabilities({ name_max: 40 });
  assert.equal(validateForm(form({ name: "a".repeat(40) }), context({ capabilities: caps })).name, undefined);
  assert.match(validateForm(form({ name: "あ".repeat(21) }), context({ capabilities: caps })).name!, /too long once saved/);
});

test("a one-time item must be in the future unless it is switched off", () => {
  const once = (patch: Partial<AlarmForm>) => form({ repeat: "once", time: "06:00", date: "2026-10-02", ...patch });
  assert.match(validateForm(once({}), context()).date!, /already passed/);
  assert.equal(validateForm(once({ enabled: false }), context()).date, undefined);
  assert.equal(validateForm(once({ time: "06:41" }), context()).date, undefined);
  assert.equal(validateForm(once({ date: "2026-10-03" }), context()).date, undefined);
  assert.equal(validateForm(once({ date: "" }), context()).date, "Pick a date.");
});

test("monthly and yearly dates avoid the days the clock cannot repeat", () => {
  assert.match(validateForm(form({ repeat: "monthly", date: "2026-10-29" }), context()).date!, /1 to 28/);
  assert.equal(validateForm(form({ repeat: "monthly", date: "2026-10-28" }), context()).date, undefined);
  assert.match(validateForm(form({ repeat: "yearly", date: "2028-02-29" }), context()).date!, /29 February/);
  assert.equal(validateForm(form({ repeat: "yearly", date: "2026-02-28" }), context()).date, undefined);
});

test("weekly takes exactly one day, custom at least one", () => {
  assert.equal(validateForm(form({ repeat: "weekly", days: [] }), context()).days, "Pick the one day it repeats on.");
  assert.equal(validateForm(form({ repeat: "weekly", days: [1, 2] }), context()).days, "Pick the one day it repeats on.");
  assert.equal(validateForm(form({ repeat: "weekly", days: [1] }), context()).days, undefined);
  assert.equal(validateForm(form({ repeat: "custom", days: [] }), context()).days, "Pick at least one day.");
  assert.equal(validateForm(form({ repeat: "custom", days: [3] }), context()).days, undefined);
});

test("repeats and ring lengths must be ones this clock offers", () => {
  const caps = resolveReminderCapabilities({ repeats: ["once", "daily"], durations: [30, 60] });
  assert.match(validateForm(form({ repeat: "weekdays" }), context({ capabilities: caps })).repeat!, /can't do that repeat/);
  assert.equal(validateForm(form({ durationS: 120 }), context({ capabilities: caps })).duration, "Pick one of the ring lengths.");
});

test("design art must still exist, be short and have no clock area; text art needs no check", () => {
  const chosen = (id: string) => form({ attachment: { kind: "design", design_id: id } });
  const withDesigns = (...designs: StoredDesign[]) => context({ designs });
  assert.equal(validateForm(chosen("d1"), withDesigns(design())).attachment, undefined);
  assert.match(validateForm(chosen("gone"), withDesigns(design())).attachment!, /isn't in your Library/);
  assert.match(validateForm(chosen("d1"), withDesigns(design({ frames: Array(41).fill("x") }))).attachment!, /Over the 40-frame limit/);
  assert.match(validateForm(chosen("d1"), withDesigns(design({ tags: ["with_clock"] }))).attachment!, /live clock/);
  // Designs not loaded yet: nothing to judge.
  assert.equal(validateForm(chosen("d1"), context()).attachment, undefined);
  assert.equal(validateForm(form(), withDesigns()).attachment, undefined);
});

test("a Monday-Friday item needs five clock slots unless the clock takes a week mask", () => {
  const weekdays = form({ repeat: "weekdays" });
  const blocked = validateForm(weekdays, context({ list: { free: 4 } })).slots!;
  assert.match(blocked, /needs 5 clock slots but only 4 are free/);
  assert.equal(validateForm(weekdays, context({ list: { free: 5 } })).slots, undefined);
  const masked = resolveReminderCapabilities({ week_mask: true });
  assert.equal(validateForm(weekdays, context({ list: { free: 1 }, capabilities: masked })).slots, undefined);
  assert.match(validateForm(form({ repeat: "daily" }), context({ list: { free: 0 } })).slots!, /needs 1 clock slot but none are free/);
});

test("editing counts the item's own slots as free, and a switched-off form needs none", () => {
  const weekdays = form({ repeat: "weekdays", key: "k1" });
  const editing = { enabled: true, device_ids: [1, 2, 3, 4, 5] };
  assert.equal(validateForm(weekdays, context({ list: { free: 0 }, editing })).slots, undefined);
  assert.notEqual(validateForm(weekdays, context({ list: { free: 0 }, editing: { enabled: false, device_ids: [] } })).slots, undefined);
  assert.equal(validateForm({ ...weekdays, enabled: false }, context({ list: { free: 0 } })).slots, undefined);
  // Without the clock's list there is nothing to compare against.
  assert.equal(validateForm(weekdays, context({ list: null })).slots, undefined);
});

test("failed commands become plain sentences", () => {
  assert.match(friendlyReminderError({ code: "unauthorized", message: "Unauthorized" }), /administrator/);
  assert.match(friendlyReminderError({ code: "unknown_command", message: "Unknown command." }), /Update it in HACS/);
  assert.equal(friendlyReminderError({ code: "command_failed", message: "The clock is out of range." }), "The clock is out of range.");
  assert.equal(friendlyReminderError(new Error("Boom")), "Boom");
  assert.equal(friendlyReminderError(undefined), "The clock didn't accept that. Try again.");
});

// ---- Home Assistant's wall clock ------------------------------------------------------------------------

/** 2026-10-02 05:00:30.250 UTC: Thursday 22:00 in Los Angeles, Friday 18:00 in Auckland. It sits away from every
 * zone's daylight-saving change, so the results below are the same whichever zone the machine running the tests is
 * in (the suite is also run with TZ set to several zones). */
const INSTANT = Date.UTC(2026, 9, 2, 5, 0, 30, 250);

function wall(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${date.getMilliseconds()}`;
}

test("the wall clock reads Home Assistant's time zone, not the browser's", () => {
  assert.equal(wall(wallClockNow("America/Los_Angeles", INSTANT)), "2026-10-01 22:00:30.250");
  assert.equal(wall(wallClockNow("Pacific/Auckland", INSTANT)), "2026-10-02 18:00:30.250");
  assert.equal(wall(wallClockNow("Asia/Kolkata", INSTANT)), "2026-10-02 10:30:30.250");
  assert.equal(wall(wallClockNow("UTC", INSTANT)), "2026-10-02 05:00:30.250");
  // Midnight reads as 00, never 24.
  assert.equal(wall(wallClockNow("America/Los_Angeles", Date.UTC(2026, 9, 2, 7, 0, 0, 0))), "2026-10-02 00:00:00.0");
});

test("without a usable zone the wall clock is the browser's own time", () => {
  for (const zone of [undefined, null, "", "Mars/Olympus"]) assert.equal(wallClockNow(zone, INSTANT).getTime(), INSTANT);
  assert.ok(Math.abs(wallClockNow(undefined).getTime() - Date.now()) < 5_000);
});

test("next-ring text counts from Home Assistant's clock, whatever zone the browser is in", () => {
  // A daily 07:00 alarm is 9 h away in Los Angeles (22:00 Thursday) and 13 h away in Auckland (18:00 Friday).
  const daily = item({ hour: 7, minute: 0 });
  const ringsIn = (zone: string) => describeNextRing(nextRing(daily, wallClockNow(zone, INSTANT)), wallClockNow(zone, INSTANT), US);
  assert.equal(ringsIn("America/Los_Angeles"), "Rings in 9 h");
  assert.equal(ringsIn("Pacific/Auckland"), "Rings in 13 h");
});

test("a one-time alarm is past or still to come by Home Assistant's clock, not the browser's", () => {
  const today7 = form({ repeat: "once", time: "07:00", date: "2026-10-02" });
  const check = (zone: string) => validateForm(today7, context({ now: wallClockNow(zone, INSTANT) })).date;
  assert.equal(check("America/Los_Angeles"), undefined);
  assert.match(check("Pacific/Auckland")!, /already passed/);
});

test("a new alarm's default time and date follow Home Assistant's clock", () => {
  const la = blankForm(wallClockNow("America/Los_Angeles", INSTANT));
  assert.deepEqual([la.time, la.date], ["23:00", "2026-10-01"]);
  const auckland = blankForm(wallClockNow("Pacific/Auckland", INSTANT));
  assert.deepEqual([auckland.time, auckland.date], ["19:00", "2026-10-02"]);
  assert.equal(nextOccurrenceDate({ hour: 7, minute: 0 }, wallClockNow("America/Los_Angeles", INSTANT)), "2026-10-02");
  assert.equal(nextOccurrenceDate({ hour: 7, minute: 0 }, wallClockNow("Pacific/Auckland", INSTANT)), "2026-10-03");
});
