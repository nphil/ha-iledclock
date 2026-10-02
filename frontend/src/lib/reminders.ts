/** Alarms & reminders: the pure rules behind the "Alarms & reminders" screen (`iledclock-dest-alarms`,
 * `iledclock-alarm-sheet`, `iledclock-alarm-art-picker`). No DOM, no Lit, no network: everything the screen
 * decides lives here so it can be unit-tested (`tests/frontend/reminders.test.ts`).
 *
 * The server owns the truth (`custom_components/iledclock/reminders.py`). Anything here that restates a
 * server rule -- slot cost, name limits, which repeat needs which date -- is a client-side mirror, kept so
 * the sheet can say "no" before a round trip. The server still re-checks everything on `reminder_set`.
 *
 * Times are the wall-clock time the clock itself uses; "now" is always passed in, never read from the
 * system clock, so tests stay deterministic.
 */

import type {
  ManagedReminder,
  ReminderAttachment,
  ReminderCapabilities,
  ReminderInput,
  ReminderItem,
  ReminderKind,
  ReminderList,
  ReminderRepeat,
  StoredDesign,
} from "../types.ts";
import { CLOCK_COLORS } from "./clock-faces.ts";
import { designHasClockRegion } from "./clock-region.ts";
import { base64ToFrame } from "./design-codec.ts";
import { GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "./grid.ts";
import { DAY_NAMES } from "./repeat-days.ts";
import { posterFrameIndex } from "./tile-policy.ts";
import type { RGB } from "./color.ts";

// ---- capabilities -------------------------------------------------------------------------------------

/** Every repeat the screen knows, in the order the pills show them. */
export const REMINDER_REPEATS: readonly ReminderRepeat[] = ["once", "daily", "weekdays", "weekends", "custom", "weekly", "monthly", "yearly"];

/** What the screen assumes until `capabilities.reminders` says otherwise (the server's own defaults). */
export const DEFAULT_REMINDER_CAPABILITIES: ReminderCapabilities = {
  capacity: 16,
  id_min: 1,
  id_max: 16,
  week_mask: false,
  name_max: 20,
  durations: [30, 60, 120, 180],
  repeats: [...REMINDER_REPEATS],
  max_frames: 40,
};

/** Mirrors `REMINDER_CONTENT_MAX_LENGTH`: the name's UTF-8 size once saved on the clock. */
export const REMINDER_NAME_MAX_BYTES = 60;

/** The chip turns amber when this many clock slots or fewer are free. */
export const SLOTS_LOW_AT = 2;

export function resolveReminderCapabilities(caps: Partial<ReminderCapabilities> | null | undefined): ReminderCapabilities {
  const base = DEFAULT_REMINDER_CAPABILITIES;
  if (!caps) return { ...base, durations: [...base.durations], repeats: [...base.repeats] };
  const repeats = Array.isArray(caps.repeats) ? REMINDER_REPEATS.filter((repeat) => caps.repeats!.includes(repeat)) : [];
  const durations = Array.isArray(caps.durations) ? caps.durations.filter((value) => Number.isFinite(value) && value > 0) : [];
  const positive = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback);
  return {
    capacity: positive(caps.capacity, base.capacity),
    id_min: typeof caps.id_min === "number" ? caps.id_min : base.id_min,
    id_max: typeof caps.id_max === "number" ? caps.id_max : base.id_max,
    week_mask: caps.week_mask === true,
    name_max: positive(caps.name_max, base.name_max),
    durations: durations.length ? durations : [...base.durations],
    repeats: repeats.length ? repeats : [...base.repeats],
    max_frames: positive(caps.max_frames, base.max_frames),
  };
}

// ---- locale-aware text ----------------------------------------------------------------------------------

/** Home Assistant's language and 12/24-hour choice, reduced to what `Intl` needs. */
export interface TimeLocale {
  locale: string;
  hourCycle?: "h12" | "h23";
}

export function timeLocaleFromHass(
  hass: { language?: string; locale?: { language?: string; time_format?: unknown } } | null | undefined,
): TimeLocale {
  const locale = hass?.locale?.language || hass?.language || "en";
  const format = hass?.locale?.time_format;
  const hourCycle = format === "12" ? "h12" : format === "24" ? "h23" : undefined;
  return hourCycle ? { locale, hourCycle } : { locale };
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tl: TimeLocale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tl.locale + "|" + JSON.stringify(options);
  let cached = formatterCache.get(key);
  if (!cached) {
    try {
      cached = new Intl.DateTimeFormat(tl.locale, options);
    } catch {
      cached = new Intl.DateTimeFormat("en", options);
    }
    if (formatterCache.size > 64) formatterCache.clear();
    formatterCache.set(key, cached);
  }
  return cached;
}

function tidy(text: string): string {
  return text.replace(/[\s\u202f\u00a0]+/g, " ").trim();
}

/** "Now" as a wall clock in Home Assistant's time zone: a Date whose LOCAL getters (getHours, getDate, ...) read
 * the wall time there. The schedule maths in this file works on local getters, but the clock is programmed in
 * Home Assistant's zone, which can differ from the browser's: from a laptop in New York, an alarm three hours
 * away in London has to say "Rings in 3 h". The result is a calendar tool only (its getTime() is not the real
 * instant). Without a usable zone name this is simply the browser's own time. One caveat: a wall time that does
 * not exist in the browser's zone (the hour its clocks skip when they spring forward) reads an hour later. */
export function wallClockNow(timeZone: string | null | undefined, instant: number = Date.now()): Date {
  if (!timeZone) return new Date(instant);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatter({ locale: "en-US" }, { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(instant));
  } catch {
    return new Date(instant); // not a zone name this browser knows
  }
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  const wall = new Date(field("year"), field("month") - 1, field("day"), field("hour") % 24, field("minute"), field("second"), ((instant % 1000) + 1000) % 1000);
  return Number.isNaN(wall.getTime()) ? new Date(instant) : wall;
}

export interface ClockText {
  /** The whole time as one string: "7:00 AM", "07:00". */
  text: string;
  /** The digits only: "7:00". */
  main: string;
  /** "AM" / "PM", or "" in 24-hour time. */
  period: string;
  /** Some languages put the day period before the digits. */
  periodFirst: boolean;
}

export function formatClockTime(hour: number, minute: number, tl: TimeLocale): ClockText {
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone: "UTC" };
  if (tl.hourCycle) options.hourCycle = tl.hourCycle;
  const parts = formatter(tl, options).formatToParts(new Date(Date.UTC(2000, 0, 1, hour, minute)));
  const periodAt = parts.findIndex((part) => part.type === "dayPeriod");
  const hourAt = parts.findIndex((part) => part.type === "hour");
  const main = tidy(parts.filter((part) => part.type !== "dayPeriod").map((part) => part.value).join(""));
  const period = periodAt >= 0 ? tidy(parts[periodAt]!.value) : "";
  return {
    text: tidy(parts.map((part) => part.value).join("")),
    main,
    period,
    periodFirst: periodAt >= 0 && periodAt < hourAt,
  };
}

/** "HH:MM" (what a native time input holds) as hour and minute, or null when it is not a real time. */
export function parseTimeValue(value: string | null | undefined): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return validTime(hour, minute) ? { hour, minute } : null;
}

export function timeValue(hour: number, minute: number): string {
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

function validTime(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export interface IsoDate {
  year: number;
  month: number;
  day: number;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "YYYY-MM-DD" as a real calendar date, or null. */
export function parseIsoDate(value: string | null | undefined): IsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function toIsoDate(year: number, month: number, day: number): string {
  return String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

/** The local calendar date of `date` as "YYYY-MM-DD". */
export function isoDateOf(date: Date): string {
  return toIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function formatDateText(iso: IsoDate, tl: TimeLocale, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(Date.UTC(iso.year, iso.month - 1, iso.day));
  // "Fri, 2 Oct" -> "Fri 2 Oct": the comma is noise in a one-line summary, and drops out the same way in every locale.
  return tidy(formatter(tl, { ...options, timeZone: "UTC" }).format(date).replace(/,\s*/g, " "));
}

/** "Fri 2 Oct" (the order follows the language: "Fri Oct 2" in US English). */
export function formatShortDate(iso: IsoDate, tl: TimeLocale): string {
  return formatDateText(iso, tl, { weekday: "short", day: "numeric", month: "short" });
}

/** "2 Oct". */
export function formatDayMonth(iso: IsoDate, tl: TimeLocale): string {
  return formatDateText(iso, tl, { day: "numeric", month: "short" });
}

/** "October". */
export function monthName(month: number, tl: TimeLocale): string {
  return tidy(formatter(tl, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2001, month - 1, 1))));
}

export function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return n + "th";
  switch (n % 10) {
    case 1: return n + "st";
    case 2: return n + "nd";
    case 3: return n + "rd";
    default: return n + "th";
  }
}

// ---- repeat rules -------------------------------------------------------------------------------------

/** The fields the schedule maths needs; `ManagedReminder` satisfies it. */
export interface Schedule {
  repeat: ReminderRepeat;
  hour: number;
  minute: number;
  date: string | null;
  days: readonly number[];
}

export const DAY_FULL_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4];
const WEEKENDS: readonly number[] = [5, 6];

/** Distinct valid weekdays (Monday = 0 .. Sunday = 6), in order. */
export function normalizeDays(days: readonly number[] | null | undefined): number[] {
  const unique = new Set<number>();
  for (const day of days ?? []) if (Number.isInteger(day) && day >= 0 && day <= 6) unique.add(day);
  return [...unique].sort((a, b) => a - b);
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((day, index) => day === b[index]);
}

/** The weekdays a schedule rings on; empty for once / monthly / yearly, which follow a date. */
export function ringDays(schedule: Pick<Schedule, "repeat" | "days">): number[] {
  switch (schedule.repeat) {
    case "daily": return [...ALL_DAYS];
    case "weekdays": return [...WEEKDAYS];
    case "weekends": return [...WEEKENDS];
    case "custom":
    case "weekly": return normalizeDays(schedule.days);
    default: return [];
  }
}

/** Clock slots an item uses while on. Mirrors the server's table (`reminders.slots_needed`): one slot each for
 * once / daily / weekly / monthly / yearly, five for Monday-Friday, two for the weekend, one per picked day for
 * custom -- unless the clock takes a weekday mask, when every pattern fits in one. Picking all seven days for
 * custom is "every day": the server stores it as a daily item, so it costs one slot, like no days picked. */
export function slotsNeeded(repeat: ReminderRepeat, days: readonly number[], weekMaskSupported: boolean): number {
  if (weekMaskSupported) return 1;
  switch (repeat) {
    case "weekdays": return WEEKDAYS.length;
    case "weekends": return WEEKENDS.length;
    case "custom": {
      const picked = normalizeDays(days).length;
      return picked === 0 || picked === ALL_DAYS.length ? 1 : picked;
    }
    default: return 1;
  }
}

export function repeatLabel(repeat: ReminderRepeat): string {
  switch (repeat) {
    case "once": return "Never";
    case "daily": return "Every day";
    case "weekdays": return "Weekdays";
    case "weekends": return "Weekends";
    case "custom": return "Custom";
    case "weekly": return "Weekly";
    case "monthly": return "Monthly";
    case "yearly": return "Yearly";
  }
}

function summariseDays(days: readonly number[]): string {
  const picked = normalizeDays(days);
  if (picked.length === 0) return "No days picked";
  if (picked.length === 7) return "Every day";
  if (sameDays(picked, WEEKDAYS)) return "Weekdays";
  if (sameDays(picked, WEEKENDS)) return "Weekends";
  return picked.map((day) => DAY_NAMES[day]).join(", ");
}

/** One line for the list: "Every day", "Weekdays", "Mon, Wed", "Every month on the 15th", "Once · Fri 2 Oct". */
export function repeatSummary(schedule: Pick<Schedule, "repeat" | "date" | "days">, tl: TimeLocale): string {
  switch (schedule.repeat) {
    case "daily": return "Every day";
    case "weekdays": return "Weekdays";
    case "weekends": return "Weekends";
    case "custom": return summariseDays(schedule.days);
    case "weekly": {
      const day = normalizeDays(schedule.days)[0];
      return day === undefined ? "Every week" : "Every " + DAY_FULL_NAMES[day];
    }
    case "monthly": {
      const iso = parseIsoDate(schedule.date);
      return iso ? "Every month on the " + ordinal(iso.day) : "Every month";
    }
    case "yearly": {
      const iso = parseIsoDate(schedule.date);
      return iso ? "Every year on " + formatDayMonth(iso, tl) : "Every year";
    }
    case "once": {
      const iso = parseIsoDate(schedule.date);
      return iso ? "Once · " + formatShortDate(iso, tl) : "Once";
    }
  }
}

// ---- next ring ----------------------------------------------------------------------------------------

function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** The next moment (strictly after `now`) this schedule rings, or null when it never will again (a one-time
 * item in the past, or an incomplete schedule). Ignores whether the item is switched on. */
export function nextRing(schedule: Schedule, now: Date): Date | null {
  const { hour, minute } = schedule;
  if (!validTime(hour, minute)) return null;
  const after = (moment: Date): boolean => moment.getTime() > now.getTime();
  switch (schedule.repeat) {
    case "once": {
      const iso = parseIsoDate(schedule.date);
      if (!iso) return null;
      const moment = new Date(iso.year, iso.month - 1, iso.day, hour, minute);
      return after(moment) ? moment : null;
    }
    case "daily":
    case "weekdays":
    case "weekends":
    case "custom":
    case "weekly": {
      const rings = new Set(ringDays(schedule));
      if (rings.size === 0) return null;
      for (let offset = 0; offset <= 7; offset++) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        if (!rings.has(mondayIndex(day))) continue;
        const moment = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
        if (after(moment)) return moment;
      }
      return null;
    }
    case "monthly": {
      const iso = parseIsoDate(schedule.date);
      if (!iso) return null;
      for (let offset = 0; offset <= 13; offset++) {
        const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        if (iso.day > daysInMonth(first.getFullYear(), first.getMonth() + 1)) continue;
        const moment = new Date(first.getFullYear(), first.getMonth(), iso.day, hour, minute);
        if (after(moment)) return moment;
      }
      return null;
    }
    case "yearly": {
      const iso = parseIsoDate(schedule.date);
      if (!iso) return null;
      for (let offset = 0; offset <= 8; offset++) {
        const year = now.getFullYear() + offset;
        if (iso.day > daysInMonth(year, iso.month)) continue;
        const moment = new Date(year, iso.month - 1, iso.day, hour, minute);
        if (after(moment)) return moment;
      }
      return null;
    }
  }
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Rings in 25 min", "Rings in 7 h 20 min", "Rings tomorrow at 7:00 AM", "Rings Fri at 7:00 AM",
 * "Rings Fri 2 Oct at 7:00 AM". */
export function describeNextRing(next: Date | null, now: Date, tl: TimeLocale): string {
  if (!next) return "Won't ring again";
  const minutes = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return "Rings in " + minutes + " min";
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return "Rings in " + hours + " h" + (rest ? " " + rest + " min" : "");
  }
  const at = formatClockTime(next.getHours(), next.getMinutes(), tl).text;
  const dayDiff = Math.round((startOfDay(next) - startOfDay(now)) / 86_400_000);
  if (dayDiff <= 1) return "Rings tomorrow at " + at;
  if (dayDiff < 7) return "Rings " + DAY_NAMES[mondayIndex(next)] + " at " + at;
  const iso: IsoDate = { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() };
  return "Rings " + formatShortDate(iso, tl) + " at " + at;
}

/** Sort by when each item rings next (switched on or off alike, so flipping a switch never moves a row).
 * Items that will never ring again go last; ties fall back to time of day, then name. */
export function sortReminders<T extends Schedule & { name: string; key: string }>(items: readonly T[], now: Date): T[] {
  const decorated = items.map((item) => ({ item, next: nextRing(item, now)?.getTime() ?? Number.POSITIVE_INFINITY }));
  decorated.sort((a, b) => {
    if (a.next !== b.next) return a.next < b.next ? -1 : 1;
    return a.item.hour - b.item.hour || a.item.minute - b.item.minute || a.item.name.localeCompare(b.item.name) || a.item.key.localeCompare(b.item.key);
  });
  return decorated.map((entry) => entry.item);
}

/** The ISO date (today or tomorrow) on which "HH:MM" next comes round, for a one-time item. */
export function nextOccurrenceDate(time: { hour: number; minute: number }, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hour, time.minute);
  if (today.getTime() > now.getTime()) return isoDateOf(today);
  return isoDateOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

/** A monthly item's date for "day N of the month": the next time that day comes round. */
export function nextMonthlyDate(day: number, time: { hour: number; minute: number }, now: Date): string {
  const clamped = Math.max(1, Math.min(28, Math.round(day)));
  const next = nextRing({ repeat: "monthly", hour: time.hour, minute: time.minute, date: toIsoDate(now.getFullYear(), now.getMonth() + 1, clamped), days: [] }, now);
  return next ? isoDateOf(next) : toIsoDate(now.getFullYear(), now.getMonth() + 1, clamped);
}

/** A yearly item's date for "D Month": the next time that day comes round (Feb 29 is not offered). */
export function nextYearlyDate(month: number, day: number, time: { hour: number; minute: number }, now: Date): string {
  const m = Math.max(1, Math.min(12, Math.round(month)));
  const d = Math.max(1, Math.min(m === 2 ? 28 : daysInMonth(2001, m), Math.round(day)));
  const next = nextRing({ repeat: "yearly", hour: time.hour, minute: time.minute, date: toIsoDate(now.getFullYear(), m, d), days: [] }, now);
  return next ? isoDateOf(next) : toIsoDate(now.getFullYear() + 1, m, d);
}

// ---- status -------------------------------------------------------------------------------------------

export type StatusTone = "ok" | "muted" | "info" | "warn" | "error";

export interface StatusView {
  tone: StatusTone;
  /** The one-line status the row shows. */
  text: string;
  /** The recovery button, when there is one. */
  action: "resend" | null;
  actionLabel: string;
}

const NO_ACTION = { action: null, actionLabel: "" } as const;

/** "Couldn't send · <reason>", without saying "Couldn't" twice when the reason already does. */
function sendFailedText(reason: string | null | undefined): string {
  const why = reason?.trim();
  if (!why) return "Couldn't send";
  return /^(couldn'?t|could not|can'?t|cannot|unable)\b/i.test(why) ? why : "Couldn't send · " + why;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function statusView(item: Pick<ManagedReminder, "status" | "last_error" | "enabled"> & Schedule, now: Date, tl: TimeLocale): StatusView {
  switch (item.status) {
    case "synced":
      return { tone: "ok", text: describeNextRing(nextRing(item, now), now, tl), ...NO_ACTION };
    case "disabled":
      return { tone: "muted", text: "Off", ...NO_ACTION };
    case "pending":
      return { tone: "info", text: "Not sent to the clock yet", action: "resend", actionLabel: "Send now" };
    case "missing":
      return { tone: "warn", text: "Not on the clock", action: "resend", actionLabel: "Re-send" };
    case "changed":
      return { tone: "warn", text: "Changed on the clock", action: "resend", actionLabel: "Re-send" };
    case "error":
      return { tone: "error", text: sendFailedText(item.last_error), action: "resend", actionLabel: "Re-send" };
    case "done":
      return { tone: "muted", text: "Done", ...NO_ACTION };
  }
}

/** What the sheet's footer says after a save, from the item the server returned. Only a `synced` item may
 * claim it works without Home Assistant. */
export function savedStatusText(item: Pick<ManagedReminder, "status" | "last_error">): { tone: StatusTone; text: string } {
  switch (item.status) {
    case "synced": return { tone: "ok", text: "Saved to clock · works without Home Assistant" };
    case "disabled": return { tone: "muted", text: "Saved · switched off, so it's not on the clock" };
    case "done": return { tone: "muted", text: "Saved · that time has already passed" };
    case "pending": return { tone: "info", text: "Saved here · not on the clock yet" };
    case "missing": return { tone: "warn", text: "Saved here · the clock doesn't have it yet" };
    case "changed": return { tone: "warn", text: "Saved here · the clock still shows a different version" };
    case "error": return { tone: "error", text: "Saved here · " + (item.last_error ? lowerFirst(sendFailedText(item.last_error)) : "couldn't reach the clock") };
  }
}

/** "Uses 5 slots" for an item that takes several clock slots; "" for the usual single slot. */
export function usesSlotsText(item: Pick<ManagedReminder, "slots" | "enabled">): string {
  if (item.slots <= 1) return "";
  return "Uses " + item.slots + " slots" + (item.enabled ? "" : " when on");
}

export function slotsNoteText(needed: number): string {
  return needed === 1 ? "Uses 1 clock slot" : "Uses " + needed + " clock slots";
}

export interface SlotChip {
  label: string;
  kind: "neutral" | "warning";
  full: boolean;
}

export function slotChip(list: Pick<ReminderList, "capacity" | "used">): SlotChip {
  const used = Math.max(0, Math.min(list.capacity, list.used));
  return {
    label: used + " of " + list.capacity + " clock slots used",
    kind: list.capacity - used <= SLOTS_LOW_AT ? "warning" : "neutral",
    full: used >= list.capacity,
  };
}

/** The stored item a form with this key is editing: looked up in the CURRENT list, so it is fresh and is also
 * found when the sheet was opened as "new" and a first save stored the item anyway; else the item the sheet
 * was opened with. */
export function editingRecord(list: Pick<ReminderList, "items"> | null | undefined, key: string | undefined, opened: ManagedReminder | null | undefined): ManagedReminder | null {
  if (!key) return null;
  return list?.items.find((entry) => entry.key === key) ?? (opened?.key === key ? opened : null);
}

/** Slots a save of `editing` can count on: the free ones plus the ones the item already holds on the clock (an
 * edit reuses its own slots first, also when it was switched off but the clock never confirmed the delete). */
export function availableSlots(list: Pick<ReminderList, "free"> | null | undefined, editing: Pick<ManagedReminder, "device_ids"> | null | undefined): number | null {
  if (!list) return null;
  return list.free + (editing?.device_ids.length ?? 0);
}

export function uploadPercent(event: { upload?: { done: number; total: number } | null } | null | undefined): number | null {
  const progress = event?.upload;
  if (!progress || !(progress.total > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100)));
}

export function durationLabel(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return seconds / 60 + " min";
  return seconds + " s";
}

export function kindLabel(kind: ReminderKind): string {
  return kind === "reminder" ? "Reminder" : "Alarm";
}

// ---- on the clock only (made with the vendor app) -------------------------------------------------------

/** Repeat summary for a reminder that lives only on the clock (the clock's own repeat enum and mask). */
export function foreignRepeatSummary(item: Pick<ReminderItem, "repeat_type" | "week_mask" | "year" | "month" | "day">, tl: TimeLocale): string {
  const iso: IsoDate | null = parseIsoDate(toIsoDate(item.year, item.month, item.day));
  const maskDays = ALL_DAYS.filter((day) => (item.week_mask & (1 << day)) !== 0);
  switch (item.repeat_type) {
    case 1: return maskDays.length === 0 || maskDays.length === 7 ? "Every day" : summariseDays(maskDays);
    case 2: {
      if (maskDays.length === 1) return "Every " + DAY_FULL_NAMES[maskDays[0]!];
      if (maskDays.length > 1) return summariseDays(maskDays);
      if (!iso) return "Every week";
      return "Every " + DAY_FULL_NAMES[(new Date(Date.UTC(iso.year, iso.month - 1, iso.day)).getUTCDay() + 6) % 7];
    }
    case 3: return iso ? "Every month on the " + ordinal(iso.day) : "Every month";
    case 4: return iso ? "Every year on " + formatDayMonth(iso, tl) : "Every year";
    default: return iso ? "Once · " + formatShortDate(iso, tl) : "Once";
  }
}

// ---- art ----------------------------------------------------------------------------------------------

export interface ArtEligibility {
  ok: boolean;
  /** One short line, shown under the tile when `ok` is false. */
  reason: string | null;
}

/** How many frames the clock plays for this design, as far as the panel can tell. The server judges the frames
 * AFTER the design's saved playback setting (it retimes them before sending): Still (speed 0) plays one poster
 * frame whatever the authored count, and Original keeps the authored count. Any other saved speed also keeps the
 * authored count here, because the real number depends on the pictures (the server merges identical neighbouring
 * frames and, when slowed with Smooth motion, adds in-between frames, never beyond 40 in all), so for those this
 * is an estimate and the server's own check when sending has the last word -- its message shows in the sheet. */
export function playedFrameCount(design: Pick<StoredDesign, "frames" | "speed">): number {
  const authored = design.frames.length;
  return authored > 1 && design.speed === 0 ? 1 : authored;
}

/** Reminder art is a still or short animation (by the frames actually played) without a live-clock area. */
export function designEligibility(design: Pick<StoredDesign, "frames" | "clock_region" | "tags" | "speed">, maxFrames: number): ArtEligibility {
  if (designHasClockRegion(design)) return { ok: false, reason: "Can't include a live clock" };
  if (design.frames.length === 0) return { ok: false, reason: "Empty design" };
  if (playedFrameCount(design) > maxFrames) return { ok: false, reason: "Over the " + maxFrames + "-frame limit" };
  return { ok: true, reason: null };
}

export function designMeta(design: Pick<StoredDesign, "frames" | "speed">): string {
  const count = design.frames.length;
  if (count > 1 && design.speed === 0) return "Set to Still · " + count + " frames";
  return count > 1 ? "Animated · " + count + " frames" : "Still picture";
}

/** The colours the name can be drawn in (everything but black, which would be invisible). */
export const REMINDER_TEXT_COLORS: ReadonlyArray<{ label: string; rgb: RGB }> = [6, 2, 3, 4, 5, 1, 0].map((index) => {
  const entry = CLOCK_COLORS[index]!;
  return { label: entry.label, rgb: entry.rgb };
});

export const DEFAULT_TEXT_COLOR: RGB = [255, 255, 255];

export function textColorOf(attachment: ReminderAttachment): RGB {
  if (attachment.kind !== "text" || !attachment.color) return DEFAULT_TEXT_COLOR;
  return attachment.color;
}

export function sameColor(a: RGB, b: RGB): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function decodeRenderedFrames(result: { frames: readonly string[]; delays: readonly number[] }): PixelFrame[] {
  return result.frames.map((encoded, index) => base64ToFrame(encoded, GRID_WIDTH, GRID_HEIGHT, result.delays[index] ?? 100));
}

const posters = new WeakMap<PixelFrame[], PixelFrame[]>();

/** One still frame that stands for an animation in a thumbnail: the one with the most lit LEDs (a scrolling
 * name starts blank, so frame 0 would show nothing). Cached per frames array. */
export function posterFrames(frames: PixelFrame[]): PixelFrame[] {
  let poster = posters.get(frames);
  if (!poster) {
    poster = frames.length ? [frames[posterFrameIndex(frames)] ?? frames[0]!] : [];
    posters.set(frames, poster);
  }
  return poster;
}

/** Draws (and remembers) the name as the clock will show it. One request per distinct name and colour, at most
 * `concurrency` at a time; a failed request is forgotten so the next look tries again. */
export type TextArtFetcher = (name: string, color: RGB) => Promise<{ frames: readonly string[]; delays: readonly number[] }>;

export class TextArtCache {
  private readonly _fetch: TextArtFetcher;
  private readonly _max: number;
  private readonly _concurrency: number;
  private readonly _pending = new Map<string, Promise<PixelFrame[]>>();
  private readonly _ready = new Map<string, PixelFrame[]>();
  private readonly _waiting: Array<() => void> = [];
  private _active = 0;

  constructor(fetcher: TextArtFetcher, options: { max?: number; concurrency?: number } = {}) {
    this._fetch = fetcher;
    this._max = Math.max(1, options.max ?? 48);
    this._concurrency = Math.max(1, options.concurrency ?? 2);
  }

  private static _key(name: string, color: RGB): string {
    return color.join(",") + "|" + name;
  }

  /** The frames if they are already here (no request). */
  peek(name: string, color: RGB): PixelFrame[] | undefined {
    return this._ready.get(TextArtCache._key(name, color));
  }

  load(name: string, color: RGB): Promise<PixelFrame[]> {
    const key = TextArtCache._key(name, color);
    const ready = this._ready.get(key);
    if (ready) return Promise.resolve(ready);
    const pending = this._pending.get(key);
    if (pending) return pending;
    const request = this._run(name, color).then(
      (frames) => {
        this._pending.delete(key);
        this._ready.set(key, frames);
        while (this._ready.size > this._max) this._ready.delete(this._ready.keys().next().value as string);
        return frames;
      },
      (error: unknown) => {
        this._pending.delete(key);
        throw error;
      },
    );
    this._pending.set(key, request);
    return request;
  }

  clear(): void {
    this._ready.clear();
  }

  private async _run(name: string, color: RGB): Promise<PixelFrame[]> {
    // A finishing request hands its slot straight to the next waiting one, so the limit is never exceeded.
    if (this._active >= this._concurrency) await new Promise<void>((resolve) => this._waiting.push(resolve));
    else this._active++;
    try {
      return decodeRenderedFrames(await this._fetch(name, color));
    } finally {
      const next = this._waiting.shift();
      if (next) next();
      else this._active--;
    }
  }
}

// ---- the edit form --------------------------------------------------------------------------------------

/** What the edit sheet holds while the user types; `formToInput` turns it into the `reminder_set` payload. */
export interface AlarmForm {
  /** Present when editing an existing item. */
  key?: string;
  name: string;
  kind: ReminderKind;
  /** "HH:MM", what a native time input holds. */
  time: string;
  repeat: ReminderRepeat;
  /** Weekdays (Monday = 0) for custom and weekly. */
  days: number[];
  /** "YYYY-MM-DD" for once, monthly (the day of the month) and yearly (month and day); "" otherwise. */
  date: string;
  durationS: number;
  attachment: ReminderAttachment;
  enabled: boolean;
}

/** A new item: the next whole hour, once, 30 seconds, the name drawn as text, switched on. */
export function blankForm(now: Date, caps: ReminderCapabilities = DEFAULT_REMINDER_CAPABILITIES): AlarmForm {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
  return {
    name: "",
    kind: "alarm",
    time: timeValue(next.getHours(), 0),
    repeat: "once",
    days: [],
    date: isoDateOf(next),
    durationS: caps.durations.includes(30) ? 30 : caps.durations[0] ?? 30,
    attachment: { kind: "text" },
    enabled: true,
  };
}

export function formFromItem(item: ManagedReminder): AlarmForm {
  return {
    key: item.key,
    name: item.name,
    kind: item.kind,
    time: timeValue(item.hour, item.minute),
    repeat: item.repeat,
    days: normalizeDays(item.days),
    date: item.date ?? "",
    durationS: item.duration_s,
    attachment: item.attachment.kind === "design" ? { kind: "design", design_id: item.attachment.design_id } : item.attachment.color ? { kind: "text", color: item.attachment.color } : { kind: "text" },
    enabled: item.enabled,
  };
}

/** Does the repeat need a date on the form? */
export function repeatUsesDate(repeat: ReminderRepeat): boolean {
  return repeat === "once" || repeat === "monthly" || repeat === "yearly";
}

/** Does the repeat need picked weekdays? Weekly takes exactly one, custom any number. */
export function repeatUsesDays(repeat: ReminderRepeat): boolean {
  return repeat === "custom" || repeat === "weekly";
}

/** Switch the form to another repeat and fill in what the new repeat needs (a date, a default day). */
export function changeRepeat(form: AlarmForm, repeat: ReminderRepeat, now: Date): AlarmForm {
  const time = parseTimeValue(form.time) ?? { hour: now.getHours(), minute: 0 };
  const next: AlarmForm = { ...form, repeat };
  const current = parseIsoDate(form.date);
  if (repeat === "once") next.date = current ? form.date : nextOccurrenceDate(time, now);
  else if (repeat === "monthly") next.date = nextMonthlyDate(current?.day ?? now.getDate(), time, now);
  else if (repeat === "yearly") next.date = current ? nextYearlyDate(current.month, current.day, time, now) : nextYearlyDate(now.getMonth() + 1, now.getDate(), time, now);
  else next.date = "";
  const kept = normalizeDays(form.days);
  if (repeat === "weekly") next.days = kept.length ? [kept[0]!] : [mondayIndex(now)];
  else if (repeat === "custom") next.days = kept.length ? kept : [mondayIndex(now)];
  else next.days = [];
  return next;
}

/** The `reminder_set` payload. Always complete (every field present) so an edit that switches the repeat
 * clears what the old repeat used instead of leaving it behind. */
export function formToInput(form: AlarmForm): ReminderInput {
  const time = parseTimeValue(form.time) ?? { hour: 0, minute: 0 };
  const input: ReminderInput = {
    name: form.name.trim(),
    kind: form.kind,
    hour: time.hour,
    minute: time.minute,
    date: repeatUsesDate(form.repeat) && form.date ? form.date : null,
    repeat: form.repeat,
    days: repeatUsesDays(form.repeat) ? normalizeDays(form.days) : [],
    duration_s: form.durationS,
    attachment: form.attachment.kind === "design" ? { kind: "design", design_id: form.attachment.design_id } : form.attachment.color && !sameColor(form.attachment.color, DEFAULT_TEXT_COLOR) ? { kind: "text", color: form.attachment.color } : { kind: "text" },
    enabled: form.enabled,
  };
  if (form.key) input.key = form.key;
  return input;
}

export function formsEqual(a: AlarmForm, b: AlarmForm): boolean {
  return JSON.stringify(formToInput(a)) === JSON.stringify(formToInput(b));
}

/** The form as a schedule, for "Rings in …" text; null while the time is not a real time. */
export function formSchedule(form: Pick<AlarmForm, "repeat" | "time" | "date" | "days">): Schedule | null {
  const time = parseTimeValue(form.time);
  if (!time) return null;
  return { repeat: form.repeat, hour: time.hour, minute: time.minute, date: form.date || null, days: form.days };
}

// ---- validation ---------------------------------------------------------------------------------------

export type FormField = "name" | "time" | "repeat" | "days" | "date" | "duration" | "attachment" | "slots";
export type FormErrors = Partial<Record<FormField, string>>;

export interface FormContext {
  now: Date;
  capabilities: ReminderCapabilities;
  /** Needed for the clock-slot check; leave out to skip it. */
  list?: Pick<ReminderList, "free"> | null;
  /** The item being edited (its own clock slots can be reused). */
  editing?: Pick<ManagedReminder, "device_ids"> | null;
  designs?: readonly StoredDesign[];
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function validateForm(form: AlarmForm, context: FormContext): FormErrors {
  const errors: FormErrors = {};
  const { capabilities } = context;
  const name = form.name.trim();
  if (name.length === 0) errors.name = "Give it a name.";
  else if (name.length > capabilities.name_max) errors.name = "Names can be up to " + capabilities.name_max + " characters.";
  else if (CONTROL_CHARACTERS.test(name)) errors.name = "The name can't contain line breaks or other control characters.";
  else if (utf8Length(name) > REMINDER_NAME_MAX_BYTES) errors.name = "That name is too long once saved on the clock. Shorten it.";

  const time = parseTimeValue(form.time);
  if (!time) errors.time = "Pick a time.";

  if (!capabilities.repeats.includes(form.repeat)) errors.repeat = "This clock can't do that repeat.";
  if (!capabilities.durations.includes(form.durationS)) errors.duration = "Pick one of the ring lengths.";

  const days = normalizeDays(form.days);
  if (form.repeat === "custom" && days.length === 0) errors.days = "Pick at least one day.";
  if (form.repeat === "weekly" && days.length !== 1) errors.days = "Pick the one day it repeats on.";

  if (repeatUsesDate(form.repeat)) {
    const iso = parseIsoDate(form.date);
    if (!iso) errors.date = form.repeat === "once" ? "Pick a date." : form.repeat === "monthly" ? "Pick the day of the month." : "Pick the day of the year.";
    else if (form.repeat === "monthly" && iso.day > 28) errors.date = "Pick a day from 1 to 28. Not every month has a 29th, 30th or 31st.";
    else if (form.repeat === "yearly" && iso.month === 2 && iso.day === 29) errors.date = "The clock can't repeat on 29 February. Pick another day.";
    else if (form.repeat === "once" && form.enabled && time && !nextRing({ repeat: "once", hour: time.hour, minute: time.minute, date: form.date, days: [] }, context.now)) {
      errors.date = "That time has already passed. Pick a later time or date.";
    }
  }

  const attachment = form.attachment;
  if (attachment.kind === "design" && context.designs) {
    const design = context.designs.find((candidate) => candidate.id === attachment.design_id);
    if (!design) errors.attachment = "That design isn't in your Library any more. Pick other art.";
    else {
      const verdict = designEligibility(design, capabilities.max_frames);
      if (!verdict.ok) errors.attachment = verdict.reason + ". Pick other art.";
    }
  }

  if (form.enabled && !errors.days) {
    const needed = slotsNeeded(form.repeat, days, capabilities.week_mask);
    const available = availableSlots(context.list, context.editing);
    if (available !== null && needed > available) {
      errors.slots = slotsBlockedText(needed, available, form.repeat, capabilities.week_mask);
    }
  }
  return errors;
}

export function slotsBlockedText(needed: number, available: number, repeat: ReminderRepeat, weekMask: boolean): string {
  const need = needed === 1 ? "1 clock slot" : needed + " clock slots";
  const free = available === 0 ? "none are free" : available === 1 ? "only 1 is free" : "only " + available + " are free";
  const hint = !weekMask && needed > 1 && (repeat === "weekdays" || repeat === "weekends" || repeat === "custom")
    ? " Fewer days, or a different repeat, use fewer slots."
    : "";
  return "This needs " + need + " but " + free + "." + hint + " You can also switch another one off or delete it.";
}

/** Add stays available while at least one clock slot is free. */
export function addBlockedReason(list: Pick<ReminderList, "free" | "capacity"> | null | undefined): string | null {
  if (!list) return null;
  if (list.free >= 1) return null;
  return "The clock is full (" + list.capacity + " of " + list.capacity + " slots). Delete an alarm or reminder to make room.";
}

/** Plain-language text for a failed command. */
export function friendlyReminderError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const message = error instanceof Error ? error.message : error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string" ? (error as { message: string }).message : "";
  if (code === "unauthorized" || code === "forbidden") return "Only a Home Assistant administrator can change alarms.";
  if (code === "unknown_command" || /unknown command/i.test(message)) return "This version of the iLedClock integration can't do named alarms yet. Update it in HACS, then restart Home Assistant.";
  return message || "The clock didn't accept that. Try again.";
}
