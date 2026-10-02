/** The harness's stand-in for the screens A/B part of the integration (docs/SLOTS-AND-REMINDERS.md): the per-screen
 * record in the state envelope (`slots`), `capabilities.slots`, `now_showing` / `history` with the `slot` on every
 * descriptor, and `iledclock/show` honouring `slot`, including the refusals the real server gives (`slot_unsupported`)
 * and Undo going back on the SAME screen as the entry being undone.
 *
 * Starting point by URL query `?slots=` : `populated` (default; screen A a design, screen B a clock page, A last sent),
 * `b-last` (the same, B last sent), `rotation` (A holds a four-program rotation), `empty` (nothing sent yet).
 * `?bart=1` makes screen B accept plain art too (what the server does once the live art test passes).
 */

import type { Capabilities, ClockStateEnvelope, ContentClass, PlaylistItem, ShowItem, SlotId, SlotRecord, SlotsState, StoredDesign } from "../src/types.ts";

type WsError = { code: string; message: string };

export interface MockDescriptor {
  kind: string;
  title: string;
  shown_at: string;
  slot: SlotId;
  [key: string]: unknown;
}

export interface SlotsMockDeps {
  /** The Library, for design names and clock regions. */
  designs: () => readonly StoredDesign[];
  /** Tell every open subscription the state changed. */
  push: () => void;
}

const HISTORY_LIMIT = 8;
const MINUTE_MS = 60_000;
const REASON_B = "Screen B only takes clock, date and temperature pages for now; pictures go on screen A.";
const REASON_TIMER = "Timers and scoreboards only work on screen A.";

function wsError(code: string, message: string): WsError {
  return { code, message };
}

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

function record(descriptor: MockDescriptor, wireKind: 0 | 4, programs = 1): SlotRecord {
  return { title: descriptor.title, descriptor, wire_kind: wireKind, programs, written_at: descriptor.shown_at };
}

function designEntry(id: string, title: string, minutesAgo: number, slot: SlotId = "a"): MockDescriptor {
  return { kind: "design", design_id: id, title, shown_at: ago(minutesAgo), slot };
}

function clockEntry(style: number, minutesAgo: number, slot: SlotId): MockDescriptor {
  return { kind: "clock", style, color: [0, 220, 255], hours24: true, background: true, title: `Clock · style ${style}`, shown_at: ago(minutesAgo), slot };
}

function textEntry(text: string, minutesAgo: number): MockDescriptor {
  return { kind: "text", text, color: [255, 220, 0], effect: 1, is_bold: false, title: `Text · ${text}`, shown_at: ago(minutesAgo), slot: "a" };
}

export type SlotsScenario = "populated" | "b-last" | "rotation" | "empty";

export interface SlotsMock {
  /** The state envelope with `slots`, `capabilities.slots`, `now_showing` and `history` added. */
  decorate(envelope: ClockStateEnvelope): ClockStateEnvelope & { now_showing: MockDescriptor | null; history: MockDescriptor[] };
  /** `iledclock/show`. Resolves `{now_showing}` or throws `{code, message}` like the real WebSocket command. */
  show(message: Record<string, unknown>): Promise<{ now_showing: MockDescriptor }>;
  /** `iledclock/playlist/set` writes screen A (a whole rotation). */
  recordPlaylist(items: readonly PlaylistItem[]): void;
  /** `iledclock/command switch_screen`: the clock's power key pressed once. Nothing comes back and no record changes (Home
   * Assistant cannot see which screen is showing); the number of presses is logged for the harness. */
  switchScreen(): Promise<Record<string, never>>;
}

export function createSlotsMock(deps: SlotsMockDeps, scenario: SlotsScenario = readScenario(), bAcceptsArt = readBAcceptsArt()): SlotsMock {
  const bAccepts: ContentClass[] = ["clock", "date", "temperature", "humidity", "art_clock", ...(bAcceptsArt ? (["art"] as const) : [])];
  const slots: SlotsState = { a: null, b: null, last_written: null };
  let history: MockDescriptor[] = [];
  let nowShowing: MockDescriptor | null = null;
  let switches = 0;

  function seed(): void {
    if (scenario === "empty") return;
    const clockB = clockEntry(12, scenario === "b-last" ? 5 : 180, "b");
    const designA = designEntry("design-slide-hello", "Sliding hello", scenario === "b-last" ? 12 : 12);
    slots.a = record(scenario === "rotation" ? { ...designA, source: "playlist" } : designA, 0, scenario === "rotation" ? 4 : 1);
    slots.b = record(clockB, 4);
    slots.last_written = scenario === "b-last" ? "b" : "a";
    const older = [textEntry("Good morning!", 26 * 60), designEntry("design-smiley", "Smiley", 50 * 60)];
    history = scenario === "b-last" ? [clockB, designA, ...older] : [designA, clockB, ...older];
    nowShowing = history[0] ?? null;
  }
  seed();

  function contentClass(fields: Record<string, unknown> & { kind: string }): ContentClass {
    switch (fields.kind) {
      case "clock":
      case "date":
      case "temperature":
      case "humidity":
      case "timer":
      case "scoreboard":
        return fields.kind;
      case "design":
        return deps.designs().find((design) => design.id === fields.design_id)?.clock_region ? "art_clock" : "art";
      default:
        return "art";
    }
  }

  function describe(item: Exclude<ShowItem, { restore: "previous" }>): Record<string, unknown> & { kind: string; title: string } {
    if ("design_id" in item) {
      const design = deps.designs().find((candidate) => candidate.id === item.design_id);
      if (!design) throw wsError("show_failed", `There is no saved design ${item.design_id}.`);
      return { kind: "design", design_id: design.id, title: design.name, ...("speed" in item ? { speed: item.speed } : {}), ...("smooth" in item ? { smooth: item.smooth } : {}) };
    }
    const { type, ...rest } = item.spec as unknown as { type: string; [key: string]: unknown };
    switch (type) {
      case "clock": {
        const { h24, ...fields } = rest;
        return { kind: "clock", ...fields, hours24: h24 ?? true, title: `Clock · style ${String(rest.style ?? 1)}` };
      }
      case "text": {
        const { bold, ...fields } = rest;
        return { kind: "text", ...fields, ...(bold !== undefined ? { is_bold: bold } : {}), title: `Text · ${String(rest.text ?? "")}` };
      }
      case "generative":
        return { kind: "generative", effect: rest.kind, ...Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "kind")), title: String(rest.kind ?? "Effect").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) };
      case "image":
        return { kind: "image", ...rest, title: "Image" };
      default:
        return { kind: type, ...rest, title: type.charAt(0).toUpperCase() + type.slice(1) };
    }
  }

  function write(slot: SlotId, fields: Record<string, unknown> & { kind: string; title: string }): MockDescriptor {
    const descriptor: MockDescriptor = { ...fields, slot, shown_at: new Date().toISOString() };
    slots[slot] = record(descriptor, slot === "b" ? 4 : 0);
    slots.last_written = slot;
    nowShowing = descriptor;
    history = [descriptor, ...history].slice(0, HISTORY_LIMIT);
    deps.push();
    return descriptor;
  }

  function restorePrevious(): MockDescriptor {
    const current = history[0];
    const slot: SlotId = current?.slot === "b" ? "b" : "a";
    const previous = history.slice(1).find((entry) => (entry.slot === "b" ? "b" : "a") === slot && !entry.unavailable);
    if (!previous) throw wsError("nothing_to_restore", "There is nothing earlier on this screen to go back to.");
    const { slot: _slot, shown_at: _shownAt, ...fields } = previous;
    return write(slot, fields as Record<string, unknown> & { kind: string; title: string });
  }

  return {
    decorate(envelope) {
      const capabilities: Capabilities = { ...envelope.capabilities, slots: { ids: ["a", "b"], b_accepts: [...bAccepts] } };
      return { ...envelope, capabilities, slots: { a: slots.a, b: slots.b, last_written: slots.last_written }, now_showing: nowShowing, history: history.map((entry) => ({ ...entry })) };
    },
    async show(message) {
      const item = message.item as ShowItem | undefined;
      if (!item || typeof item !== "object") throw wsError("invalid_format", "iledclock/show needs an item.");
      if ("restore" in item) return { now_showing: restorePrevious() };
      if (message.slot !== undefined && message.slot !== "a" && message.slot !== "b") throw wsError("invalid_format", "slot must be a or b.");
      const slot: SlotId = message.slot === "b" ? "b" : "a";
      const fields = describe(item);
      const kind = contentClass(fields);
      // The clock files a date page on screen B whichever screen was asked for; the answer says where it really went.
      const filedOn: SlotId = kind === "date" ? "b" : slot;
      if (filedOn === "b" && !bAccepts.includes(kind)) throw wsError("slot_unsupported", kind === "timer" || kind === "scoreboard" ? REASON_TIMER : REASON_B);
      return { now_showing: write(filedOn, fields) };
    },
    async switchScreen() {
      switches += 1;
      console.log("[mock hass] switch_screen pressed", switches);
      return {};
    },
    recordPlaylist(items) {
      const first = items[0];
      if (!first) return;
      const fields = describe(first.kind === "design" ? { design_id: String(first.params.design_id ?? "") } : { spec: { type: first.kind, ...first.params } as never });
      const descriptor: MockDescriptor = { ...fields, slot: "a", source: "playlist", shown_at: new Date().toISOString() };
      slots.a = record(descriptor, 0, items.length);
      slots.last_written = "a";
      nowShowing = descriptor;
      deps.push();
    },
  };
}

function readScenario(): SlotsScenario {
  const value = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("slots");
  return value === "empty" || value === "b-last" || value === "rotation" ? value : "populated";
}

function readBAcceptsArt(): boolean {
  return typeof location !== "undefined" && new URLSearchParams(location.search).get("bart") === "1";
}
