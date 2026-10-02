/** The harness's stand-in for the Alarms & reminders part of the integration (docs/SLOTS-AND-REMINDERS.md): the
 * clock's 16 reminder slots, the managed items that live in Home Assistant, reminders made with the vendor app
 * ("on the clock only"), and the four commands `reminder_set`, `reminder_set_enabled`, `reminder_delete` and
 * `reminder_resend`. It answers the way the real server does -- definition kept first, ids allocated lowest-free
 * (a Monday-Friday item really takes five), upload progress pushed while it "sends", `{item}` returned -- and
 * refuses the same things (clock full, time already passed, unknown design, clock out of range).
 *
 * Every state is reachable from the address bar (read once, at page load):
 *   ?alarms=empty | populated (default) | full     which fixture to start from
 *   &alarms-delay=2500                             how long a save takes (ms; default 700) -- the "saving" state
 *   &alarms-offline=1                              the clock is out of range: nothing can be sent
 *   &alarms-fail=1                                 the clock looks connected but refuses every upload (a send that fails)
 *   &alarms-mask=1                                 the clock takes a weekday mask (Monday-Friday = one slot)
 * and at run time from `window.__alarmsMock` (setScenario / setOffline / setFail / setDelay / setWeekMask). */

import type { ClockStateEnvelope, ManagedReminder, ReminderAttachment, ReminderCapabilities, ReminderItem, ReminderList, ReminderRepeat, StoredDesign } from "../src/types.ts";
import { designHasClockRegion } from "../src/lib/clock-region.ts";
import { nextOccurrenceDate, nextRing, normalizeDays, parseIsoDate, slotsNeeded, wallClockNow } from "../src/lib/reminders.ts";
import { REMINDER_CAPABILITIES, reminderFixture, type AlarmsScenario } from "./fixtures.ts";

interface WsError {
  code: string;
  message: string;
}

function wsError(message: string, code = "command_failed"): WsError {
  return { code, message };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MockAlarmsDeps {
  designs: () => readonly StoredDesign[];
  /** Send a fresh state envelope to every subscriber. */
  push: () => void;
  /** Send a non-state event (upload progress) to every subscriber. */
  emit: (event: Record<string, unknown>) => void;
}

export interface MockAlarmsControls {
  readonly scenario: AlarmsScenario;
  readonly offline: boolean;
  readonly failSend: boolean;
  readonly delayMs: number;
  readonly weekMask: boolean;
  setScenario(scenario: AlarmsScenario): void;
  setOffline(offline: boolean): void;
  setFail(failSend: boolean): void;
  setDelay(ms: number): void;
  setWeekMask(weekMask: boolean): void;
}

export interface MockAlarms {
  /** Adds `reminder_list`, `capabilities.reminders` and the on-clock `state.reminders` to a state envelope. */
  decorate(envelope: ClockStateEnvelope): ClockStateEnvelope;
  handles(command: string): boolean;
  command(command: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  controls: MockAlarmsControls;
}

function readScenario(query: URLSearchParams): AlarmsScenario {
  const value = query.get("alarms");
  return value === "empty" || value === "full" ? value : "populated";
}

function hexKey(): string {
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/** The clock's own repeat enum for one reminder it holds (0 once, 1 daily, 2 weekly, 3 monthly, 4 yearly). */
function repeatType(repeat: ReminderRepeat, weekMask: boolean): number {
  switch (repeat) {
    case "once": return 0;
    case "daily": return 1;
    case "monthly": return 3;
    case "yearly": return 4;
    case "weekly": return 2;
    default: return weekMask ? 1 : 2;
  }
}

/** The time zone the harness pretends Home Assistant runs in: `?ha-tz=Pacific/Auckland` (default: the browser's own).
 * The mocked server below keeps its time in it, and `createMockHass` publishes it as `hass.config.time_zone`. */
export function mockTimeZone(query: URLSearchParams = new URLSearchParams(typeof location !== "undefined" ? location.search : "")): string | undefined {
  return query.get("ha-tz") || undefined;
}

export function createMockAlarms(deps: MockAlarmsDeps, query: URLSearchParams = new URLSearchParams(typeof location !== "undefined" ? location.search : "")): MockAlarms {
  const settings = {
    scenario: readScenario(query),
    offline: query.get("alarms-offline") === "1",
    failSend: query.get("alarms-fail") === "1",
    delayMs: Number.isFinite(Number(query.get("alarms-delay"))) && query.get("alarms-delay") !== null ? Math.max(0, Number(query.get("alarms-delay"))) : 700,
    weekMask: query.get("alarms-mask") === "1",
  };
  let items: ManagedReminder[] = [];
  let foreign: ReminderItem[] = [];
  /** Ids the clock really holds. */
  const clockIds = new Set<number>();
  /** Items somebody edited on the clock afterwards ("changed"). */
  const drift = new Set<string>();
  const wallNow = (): Date => wallClockNow(mockTimeZone(query));

  const capabilities = (): ReminderCapabilities => ({ ...REMINDER_CAPABILITIES, week_mask: settings.weekMask, durations: [...REMINDER_CAPABILITIES.durations], repeats: [...REMINDER_CAPABILITIES.repeats] });

  function reconcile(now = wallNow()): void {
    for (const item of items) {
      const scheduled = { repeat: item.repeat, hour: item.hour, minute: item.minute, date: item.date, days: item.days };
      if (!item.enabled) item.status = "disabled";
      else if (item.last_error) item.status = "error";
      else if (item.repeat === "once" && nextRing(scheduled, now) === null) item.status = "done";
      else if (item.device_ids.length === 0) item.status = "pending";
      else if (item.device_ids.some((id) => !clockIds.has(id))) item.status = "missing";
      else if (drift.has(item.key)) item.status = "changed";
      else item.status = "synced";
    }
  }

  function load(scenario: AlarmsScenario): void {
    settings.scenario = scenario;
    const fixture = reminderFixture(scenario, wallNow());
    items = fixture.items;
    foreign = fixture.foreign;
    clockIds.clear();
    drift.clear();
    for (const reminder of foreign) clockIds.add(reminder.id);
    for (const item of items) {
      if (item.status === "synced" || item.status === "changed") item.device_ids.forEach((id) => clockIds.add(id));
      if (item.status === "changed") drift.add(item.key);
    }
    reconcile();
  }

  function list(): ReminderList {
    reconcile();
    const caps = capabilities();
    return { capacity: caps.capacity, used: clockIds.size, free: caps.capacity - clockIds.size, items: clone(items), foreign: clone(foreign), synced_at: Math.floor(Date.now() / 1000) };
  }

  /** What `state.reminders` would list: every reminder the clock holds, as the clock reports it. */
  function deviceReminders(): ReminderItem[] {
    const now = wallNow();
    const rows: ReminderItem[] = [...clone(foreign)];
    for (const item of items) {
      if (!item.enabled) continue;
      item.device_ids.filter((id) => clockIds.has(id)).forEach((id, index) => {
        const next = nextRing({ repeat: item.repeat, hour: item.hour, minute: item.minute, date: item.date, days: item.days }, now) ?? now;
        const date = parseIsoDate(item.date) ?? { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() };
        const day = item.repeat === "weekdays" || item.repeat === "weekends" || item.repeat === "custom" ? normalizeDays(item.days.length ? item.days : item.repeat === "weekdays" ? [0, 1, 2, 3, 4] : [5, 6])[index] : undefined;
        rows.push({ id, content: item.name, year: date.year, month: date.month, day: date.day, hour: item.hour, minute: item.minute, repeat_type: repeatType(item.repeat, settings.weekMask), week_mask: item.repeat === "daily" ? 0x7f : day !== undefined ? 1 << day : 0, duration: item.duration_s, sound: 1 });
      });
    }
    return rows.sort((a, b) => a.id - b.id);
  }

  // ---- validation, in the server's words ----------------------------------------------------------------

  function validateAttachment(raw: unknown): ReminderAttachment {
    const attachment = raw as { kind?: string; design_id?: string; color?: number[] } | null | undefined;
    if (attachment?.kind === "design") {
      const design = deps.designs().find((candidate) => candidate.id === attachment.design_id);
      if (!design) throw wsError("That design isn't in the Library any more.");
      if (designHasClockRegion(design)) throw wsError("A design with a live clock area can't be used for an alarm.");
      if (design.frames.length > REMINDER_CAPABILITIES.max_frames) throw wsError(`That design has ${design.frames.length} frames; an alarm can show up to ${REMINDER_CAPABILITIES.max_frames}.`);
      return { kind: "design", design_id: design.id };
    }
    const color = attachment?.color;
    return Array.isArray(color) && color.length === 3 ? { kind: "text", color: [color[0]!, color[1]!, color[2]!] } : { kind: "text" };
  }

  function build(params: Record<string, unknown>, existing: ManagedReminder | undefined): ManagedReminder {
    const caps = capabilities();
    const name = String(params.name ?? "").trim();
    if (!name) throw wsError("The name can't be empty.");
    if (name.length > caps.name_max) throw wsError(`The name can be up to ${caps.name_max} characters.`);
    const hour = Number(params.hour);
    const minute = Number(params.minute);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw wsError("That isn't a real time.");
    let repeat = String(params.repeat ?? "once") as ReminderRepeat;
    if (!caps.repeats.includes(repeat)) throw wsError("That repeat isn't available on this clock.");
    const duration = Number(params.duration_s ?? 30);
    if (!caps.durations.includes(duration)) throw wsError("Choose a ring length of 30, 60, 120 or 180 seconds.");
    const enabled = params.enabled !== false;
    let days = normalizeDays(Array.isArray(params.days) ? (params.days as number[]) : []);
    let date = typeof params.date === "string" && params.date ? params.date : null;
    if (repeat === "custom" && days.length === 0) throw wsError("Pick at least one day.");
    if (repeat === "custom" && days.length === 7) repeat = "daily";
    if (repeat === "weekly" && days.length !== 1) throw wsError("A weekly alarm repeats on exactly one day.");
    if (repeat !== "custom" && repeat !== "weekly") days = [];
    const iso = parseIsoDate(date);
    if (repeat === "once") {
      date = iso ? date : nextOccurrenceDate({ hour, minute }, wallNow());
      if (enabled && nextRing({ repeat, hour, minute, date, days }, wallNow()) === null) throw wsError("That time has already passed.");
    } else if (repeat === "monthly") {
      if (!iso) throw wsError("Pick the day of the month.");
      if (iso.day > 28) throw wsError("Monthly alarms can use days 1 to 28.");
    } else if (repeat === "yearly") {
      if (!iso) throw wsError("Pick the day of the year.");
      if (iso.month === 2 && iso.day === 29) throw wsError("The clock can't repeat on 29 February.");
    } else {
      date = null;
    }
    return {
      key: existing?.key ?? hexKey(),
      name,
      kind: params.kind === "reminder" ? "reminder" : "alarm",
      hour,
      minute,
      date,
      repeat,
      days,
      duration_s: duration,
      attachment: validateAttachment(params.attachment),
      enabled,
      status: existing?.status ?? "pending",
      slots: slotsNeeded(repeat, days, caps.week_mask),
      device_ids: existing ? [...existing.device_ids] : [],
      last_error: null,
      updated: Math.floor(Date.now() / 1000),
    };
  }

  // ---- the clock ---------------------------------------------------------------------------------------------

  function chunkCount(item: ManagedReminder): number {
    if (item.attachment.kind === "text") return 3;
    const design = deps.designs().find((candidate) => candidate.id === (item.attachment as { design_id: string }).design_id);
    return 2 + Math.ceil((design?.frames.length ?? 1) / 4);
  }

  async function transfer(chunks: number): Promise<void> {
    if (settings.offline || settings.failSend) {
      await sleep(Math.min(500, settings.delayMs));
      throw wsError("Couldn't reach the clock. Move it closer and try again.");
    }
    const emit = (state: string, done: number): void => deps.emit({ type: "upload", state, program: 0, programs: 1, chunk: done, chunks, upload: state === "error" ? null : { done, total: chunks } });
    emit("start", 0);
    for (let done = 1; done <= chunks; done++) {
      await sleep(settings.delayMs / (chunks + 1));
      emit("chunk", done);
    }
    await sleep(settings.delayMs / (chunks + 1));
    emit("done", chunks);
  }

  /** Pick the clock ids an enabled item will use: its own first, then the lowest free ones (nothing is written yet). */
  function allocate(item: ManagedReminder): number[] {
    const caps = capabilities();
    const own = item.device_ids;
    const needed = slotsNeeded(item.repeat, item.days, caps.week_mask);
    const taken = new Set<number>([...clockIds, ...items.filter((other) => other.key !== item.key && other.enabled).flatMap((other) => other.device_ids)]);
    const freeIds: number[] = [];
    for (let id = caps.id_min; id <= caps.id_max; id++) if (!taken.has(id) && !own.includes(id)) freeIds.push(id);
    const available = own.length + freeIds.length;
    if (needed > available) throw wsError(`This needs ${needed} clock slots, but only ${available} are free.`);
    const ids = [...own.slice(0, needed)];
    while (ids.length < needed) ids.push(freeIds.shift()!);
    return ids.sort((a, b) => a - b);
  }

  /** The clock accepted the upload: it now holds exactly `ids` for this item. */
  function commit(item: ManagedReminder, ids: number[]): void {
    item.device_ids.filter((id) => !ids.includes(id)).forEach((id) => clockIds.delete(id));
    ids.forEach((id) => clockIds.add(id));
    item.device_ids = ids;
    drift.delete(item.key);
  }

  /** Persist first (nothing typed is lost), then write the clock, then report. A failure after persisting keeps the
   * definition and records why, exactly like the real server, so the list can offer Re-send. When the upload breaks
   * off midway (`&alarms-fail=1`) the clock may hold copies, so the item keeps the slots it claimed and they count as
   * used; when the clock can't be reached at all (`&alarms-offline=1`) nothing was written and nothing is claimed. */
  async function write(item: ManagedReminder): Promise<ManagedReminder> {
    const index = items.findIndex((entry) => entry.key === item.key);
    if (index === -1) items.push(item);
    else items[index] = item;
    let claimed: number[] | null = null;
    try {
      if (item.enabled) {
        claimed = allocate(item);
        await transfer(chunkCount(item));
        commit(item, claimed);
      } else {
        await transfer(1);
        commit(item, []);
      }
    } catch (error) {
      if (claimed && settings.failSend && !settings.offline) commit(item, claimed);
      item.last_error = (error as WsError).message;
      item.updated = Math.floor(Date.now() / 1000);
      reconcile();
      deps.push();
      throw error;
    }
    item.last_error = null;
    item.updated = Math.floor(Date.now() / 1000);
    reconcile();
    deps.push();
    return clone(item);
  }

  function find(params: Record<string, unknown>): ManagedReminder {
    const item = items.find((entry) => entry.key === params.key);
    if (!item) throw wsError("That alarm isn't there any more.");
    return item;
  }

  async function command(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
      case "reminder_set": {
        const existing = typeof params.key === "string" ? find(params) : undefined;
        return { item: await write(build(params, existing)) };
      }
      case "reminder_set_enabled": {
        const item = find(params);
        return { item: await write({ ...item, enabled: params.enabled !== false, last_error: null, updated: Math.floor(Date.now() / 1000) }) };
      }
      case "reminder_resend": {
        const item = find(params);
        return { item: await write({ ...item, last_error: null }) };
      }
      case "reminder_delete": {
        await sleep(Math.min(300, settings.delayMs));
        if (typeof params.key === "string") {
          const item = find(params);
          item.device_ids.forEach((id) => clockIds.delete(id));
          items = items.filter((entry) => entry.key !== item.key);
          drift.delete(item.key);
        } else if (typeof params.id === "number") {
          if (!foreign.some((entry) => entry.id === params.id)) throw wsError("The clock doesn't have that reminder any more.");
          foreign = foreign.filter((entry) => entry.id !== params.id);
          clockIds.delete(params.id);
        } else {
          throw wsError("Say which reminder to delete: a key or a clock id.");
        }
        deps.push();
        return {};
      }
      default:
        throw wsError(`Unknown reminder command ${name}`, "unknown_command");
    }
  }

  const controls: MockAlarmsControls = {
    get scenario() { return settings.scenario; },
    get offline() { return settings.offline; },
    get failSend() { return settings.failSend; },
    get delayMs() { return settings.delayMs; },
    get weekMask() { return settings.weekMask; },
    setScenario(scenario) { load(scenario); deps.push(); },
    setOffline(offline) { settings.offline = offline; deps.push(); },
    setFail(failSend) { settings.failSend = failSend; },
    setDelay(ms) { settings.delayMs = Math.max(0, ms); },
    setWeekMask(weekMask) { settings.weekMask = weekMask; deps.push(); },
  };
  load(settings.scenario);
  if (typeof window !== "undefined") (window as unknown as { __alarmsMock?: MockAlarmsControls }).__alarmsMock = controls;

  return {
    decorate(envelope) {
      const caps = capabilities();
      return {
        ...envelope,
        connected: settings.offline ? false : envelope.connected,
        state: { ...envelope.state, reminders: deviceReminders() },
        capabilities: { ...envelope.capabilities, reminders: caps },
        reminder_list: list(),
      };
    },
    handles: (name) => name === "reminder_set" || name === "reminder_set_enabled" || name === "reminder_delete" || name === "reminder_resend",
    command,
    controls,
  };
}
