import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capabilities, ContentClass, HomeAssistant, SlotRecord, SlotsState, StoredDesign } from "../../frontend/src/types.ts";
import {
  SLOT_A_DATE_REASON,
  SLOT_B_PAGES_ONLY_REASON,
  SLOT_B_TIMER_REASON,
  SLOT_B_UNAVAILABLE_REASON,
  bothScreensInUse,
  clearSlotCapabilities,
  contentClassOf,
  createSlotChoiceStore,
  descriptorSlot,
  effectiveSlot,
  getSlotChoice,
  keyedSlot,
  loadSlotCapabilities,
  primeSlotCapabilities,
  resolveSlot,
  sentAgo,
  setSlotChoice,
  slotAllowance,
  slotChoiceKey,
  slotRecordCaption,
  switchScreenBlockReason,
} from "../../frontend/src/lib/slots.ts";

function caps(bAccepts: ContentClass[]): Capabilities {
  return {
    max_playlist_items: 20,
    clock_styles: 41,
    text_color_modes: 28,
    max_alarms: 8,
    max_timer_switches: 8,
    max_reminders: 16,
    has_temperature: true,
    has_humidity: true,
    slots: { ids: ["a", "b"], b_accepts: bAccepts },
  };
}

const CONSERVATIVE = caps(["clock", "date", "temperature", "humidity", "art_clock"]);
const WITH_ART = caps(["clock", "date", "temperature", "humidity", "art_clock", "art"]);

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

// ---- allowance ----

test("screen A takes every kind of content", () => {
  for (const contentClass of ["clock", "temperature", "humidity", "art", "art_clock", "timer", "scoreboard"] as const) {
    assert.deepEqual(slotAllowance("a", contentClass, CONSERVATIVE), { ok: true, reason: null });
    assert.deepEqual(slotAllowance("a", contentClass, undefined), { ok: true, reason: null }, "A never depends on the capability list");
  }
});

test("screen B takes exactly what the server's capability list says, with the server's words when it does not", () => {
  assert.deepEqual(slotAllowance("b", "clock", CONSERVATIVE), { ok: true, reason: null });
  assert.deepEqual(slotAllowance("b", "art_clock", CONSERVATIVE), { ok: true, reason: null });
  assert.deepEqual(slotAllowance("b", "art", CONSERVATIVE), { ok: false, reason: SLOT_B_PAGES_ONLY_REASON });
  assert.deepEqual(slotAllowance("b", "timer", CONSERVATIVE), { ok: false, reason: SLOT_B_TIMER_REASON });
  assert.deepEqual(slotAllowance("b", "scoreboard", CONSERVATIVE), { ok: false, reason: SLOT_B_TIMER_REASON });
  assert.equal(SLOT_B_TIMER_REASON, "Timers and scoreboards only work on screen A.");
  assert.equal(SLOT_B_PAGES_ONLY_REASON, "Screen B only takes clock, date and temperature pages for now; pictures go on screen A.");
});

test("a capability flag flipped on the server opens screen B to art, and closing art_clock shuts that out", () => {
  assert.equal(slotAllowance("b", "art", WITH_ART).ok, true);
  assert.equal(slotAllowance("b", "art_clock", caps(["clock", "date", "temperature", "humidity"])).ok, false);
});

test("screen B is not offered while its capability list is unknown", () => {
  assert.deepEqual(slotAllowance("b", "clock", undefined), { ok: false, reason: SLOT_B_UNAVAILABLE_REASON });
  assert.deepEqual(slotAllowance("b", "clock", null), { ok: false, reason: SLOT_B_UNAVAILABLE_REASON });
  const noSlots: Capabilities = { ...CONSERVATIVE };
  delete noSlots.slots;
  assert.equal(slotAllowance("b", "clock", noSlots).ok, false, "an older integration that does not report screens");
});

// ---- the remembered choice ----

test("the choice starts on screen A, is remembered per clock and survives a reload through storage", () => {
  const storage = new MemoryStorage();
  const store = createSlotChoiceStore(storage);
  assert.equal(store.get("clock-1"), "a");
  store.set("clock-1", "b");
  assert.equal(store.get("clock-1"), "b");
  assert.equal(store.get("clock-2"), "a", "another clock is unaffected");
  assert.equal(storage.getItem(slotChoiceKey("clock-1")), "b");

  const afterReload = createSlotChoiceStore(storage);
  assert.equal(afterReload.get("clock-1"), "b");
  assert.equal(afterReload.get("clock-2"), "a");
});

test("a stored value that is not a screen id is ignored", () => {
  const storage = new MemoryStorage();
  storage.setItem(slotChoiceKey("clock-1"), "c");
  assert.equal(createSlotChoiceStore(storage).get("clock-1"), "a");
});

test("without usable storage the choice is still remembered while the page lives", () => {
  const broken = {
    getItem: (): string | null => {
      throw new Error("blocked");
    },
    setItem: (): void => {
      throw new Error("quota");
    },
  };
  for (const storage of [null, broken]) {
    const store = createSlotChoiceStore(storage);
    assert.equal(store.get("clock-1"), "a");
    store.set("clock-1", "b");
    assert.equal(store.get("clock-1"), "b");
  }
});

test("subscribers hear about a real change once, not about setting the same screen again, and stop when they unsubscribe", () => {
  const store = createSlotChoiceStore(new MemoryStorage());
  const heard: string[] = [];
  const stop = store.subscribe((change) => heard.push(`${change.entryId}:${change.slot}`));
  store.set("clock-1", "a");
  assert.deepEqual(heard, [], "A was already the choice");
  store.set("clock-1", "b");
  store.set("clock-1", "b");
  store.set("clock-1", "a");
  assert.deepEqual(heard, ["clock-1:b", "clock-1:a"]);
  stop();
  store.set("clock-1", "b");
  assert.equal(heard.length, 2);
});

test("the shared store behind getSlotChoice / setSlotChoice keeps each clock apart", () => {
  setSlotChoice("shared-clock-1", "b");
  assert.equal(getSlotChoice("shared-clock-1"), "b");
  assert.equal(getSlotChoice("shared-clock-2"), "a");
  setSlotChoice("shared-clock-1", "a");
});

// ---- the screen a show goes to ----

test("a remembered B is used for content B takes, and falls back to A (without forgetting B) for content it does not", () => {
  const store = createSlotChoiceStore(null);
  store.set("clock-1", "b");
  assert.equal(effectiveSlot("clock-1", "clock", CONSERVATIVE, store), "b");
  assert.equal(effectiveSlot("clock-1", "art_clock", CONSERVATIVE, store), "b");
  assert.equal(effectiveSlot("clock-1", "art", CONSERVATIVE, store), "a");
  assert.equal(effectiveSlot("clock-1", "scoreboard", CONSERVATIVE, store), "a");
  assert.equal(store.get("clock-1"), "b", "the preference stays B for the next clock face");
  assert.equal(effectiveSlot("clock-1", "art", WITH_ART, store), "b", "once the server accepts art, the same choice goes to B");
});

test("a remembered A always goes to A, and an unknown capability list never sends anything to B", () => {
  const store = createSlotChoiceStore(null);
  assert.equal(effectiveSlot("clock-1", "clock", CONSERVATIVE, store), "a");
  store.set("clock-1", "b");
  assert.equal(effectiveSlot("clock-1", "clock", undefined, store), "a");
});

// ---- what kind of content a show is ----

test("contentClassOf follows the kind for clock, date, temperature, humidity, timer and scoreboard", () => {
  for (const kind of ["clock", "date", "temperature", "humidity", "timer", "scoreboard"] as const) {
    assert.equal(contentClassOf({ kind }), kind, `descriptor ${kind}`);
    assert.equal(contentClassOf({ spec: { type: kind } } as never), kind, `spec ${kind}`);
  }
});

test("text, images and generated effects are art, in descriptors and in show specs", () => {
  assert.equal(contentClassOf({ kind: "text", text: "hi" }), "art");
  assert.equal(contentClassOf({ kind: "image", frames: [] }), "art");
  assert.equal(contentClassOf({ kind: "generative", effect: "plasma" }), "art");
  assert.equal(contentClassOf({ spec: { type: "text", text: "hi", color: [255, 255, 255] } }), "art");
  assert.equal(contentClassOf({ spec: { type: "generative", kind: "fire", seconds: 4 } }), "art");
});

test("a design is art_clock only when it has a clock region, found through the library passed in", () => {
  const plain = { id: "plain", clock_region: null };
  const withClock = { id: "with-clock", clock_region: { x: 16, y: 0, w: 16, h: 16 } };
  const library = [plain, withClock];
  assert.equal(contentClassOf({ design_id: "plain" }, library), "art");
  assert.equal(contentClassOf({ design_id: "with-clock" }, library), "art_clock");
  assert.equal(contentClassOf({ kind: "design", design_id: "with-clock" }, library), "art_clock");
  assert.equal(contentClassOf({ spec: { type: "design", design_id: "with-clock" } }, library), "art_clock");
  assert.equal(contentClassOf({ design_id: "with-clock" }, (id) => library.find((design) => design.id === id)), "art_clock");
  assert.equal(contentClassOf({ design_id: "unknown" }, library), "art", "a design that cannot be found counts as plain art, the stricter answer");
  assert.equal(contentClassOf({ design_id: "with-clock" }), "art", "without the library nothing is assumed");
});

test("a stored design itself is classified by its clock region", () => {
  const design = { id: "d", name: "d", kind: "animation", width: 32, height: 16, frames: [], delays: [], created: 0, updated: 0 } as StoredDesign;
  assert.equal(contentClassOf(design), "art");
  assert.equal(contentClassOf({ ...design, clock_region: { x: 0, y: 0, w: 16, h: 16 } }), "art_clock");
  assert.equal(contentClassOf({ ...design, clock_region: null }), "art");
});

// ---- capabilities for surfaces without a live state ----

function fakeHass(handler: (message: Record<string, unknown>) => Promise<unknown>) {
  const messages: Array<Record<string, unknown>> = [];
  const hass = {
    callWS: async (message: Record<string, unknown>) => {
      messages.push(message);
      return handler(message);
    },
  } as unknown as Pick<HomeAssistant, "callWS">;
  return { hass, messages };
}

test("capabilities are fetched once per clock even when several controls ask at the same moment", async () => {
  clearSlotCapabilities();
  const { hass, messages } = fakeHass(async () => ({ capabilities: CONSERVATIVE }));
  const [first, second] = await Promise.all([loadSlotCapabilities(hass, "fetch-1"), loadSlotCapabilities(hass, "fetch-1")]);
  assert.equal(first, CONSERVATIVE);
  assert.equal(second, CONSERVATIVE);
  await loadSlotCapabilities(hass, "fetch-1");
  assert.deepEqual(messages, [{ type: "iledclock/state", entry_id: "fetch-1" }], "later calls come from the cache");
});

test("capabilities a live subscription already carried are used without any request", async () => {
  clearSlotCapabilities();
  const { hass, messages } = fakeHass(async () => {
    throw new Error("must not be called");
  });
  primeSlotCapabilities("primed-1", CONSERVATIVE);
  assert.equal(await loadSlotCapabilities(hass, "primed-1"), CONSERVATIVE);
  assert.equal(messages.length, 0);
  primeSlotCapabilities("primed-2", { ...CONSERVATIVE, slots: undefined });
  assert.equal(await loadSlotCapabilities(fakeHass(async () => ({})).hass, "primed-2"), null, "a state without screens is not cached as if it had them");
});

test("a failed capability read resolves null and is retried next time", async () => {
  clearSlotCapabilities();
  let calls = 0;
  const { hass } = fakeHass(async () => {
    calls += 1;
    if (calls === 1) throw new Error("offline");
    return { capabilities: CONSERVATIVE };
  });
  assert.equal(await loadSlotCapabilities(hass, "retry-1"), null);
  assert.equal(await loadSlotCapabilities(hass, "retry-1"), CONSERVATIVE);
  assert.equal(calls, 2);
});

test("resolveSlot picks the screen at click time: remembered B when allowed, A when not, and nothing when B cannot be checked", async () => {
  clearSlotCapabilities();
  const { hass } = fakeHass(async () => ({ capabilities: CONSERVATIVE }));
  setSlotChoice("resolve-1", "b");
  assert.equal(await resolveSlot(hass, "resolve-1", "clock"), "b");
  assert.equal(await resolveSlot(hass, "resolve-1", "art"), "a");
  assert.equal(await resolveSlot(hass, "resolve-1", "art", WITH_ART), "b", "capabilities the caller already holds win over the cache");

  clearSlotCapabilities();
  const offline = fakeHass(async () => {
    throw new Error("offline");
  });
  assert.equal(await resolveSlot(offline.hass, "resolve-1", "art"), null, "B is remembered but cannot be checked: send nothing rather than guess a screen");
  assert.equal(await resolveSlot(undefined, "resolve-1", "clock"), null, "no connection at all");
});

test("a remembered A needs no capability check at all", async () => {
  clearSlotCapabilities();
  const { hass, messages } = fakeHass(async () => {
    throw new Error("must not be called");
  });
  setSlotChoice("resolve-2", "a");
  assert.equal(await resolveSlot(hass, "resolve-2", "scoreboard"), "a");
  assert.equal(messages.length, 0);
});

// ---- words ----

test("descriptors without a screen (written before screens existed) count as screen A", () => {
  assert.equal(descriptorSlot({ slot: "b" }), "b");
  assert.equal(descriptorSlot({ slot: "a" }), "a");
  assert.equal(descriptorSlot({}), "a");
  assert.equal(descriptorSlot({ slot: "z" }), "a");
  assert.equal(descriptorSlot(null), "a");
});

test("the headline and history name their screen only once screen B has been used", () => {
  const record: SlotRecord = { title: "Clock", descriptor: null, wire_kind: 4, programs: 1, written_at: "2026-10-02T01:00:00Z" };
  const onlyA: SlotsState = { a: { ...record, wire_kind: 0 }, b: null, last_written: "a" };
  assert.equal(bothScreensInUse(onlyA, [{ slot: "a" }, {}]), false);
  assert.equal(bothScreensInUse(undefined, []), false);
  assert.equal(bothScreensInUse({ ...onlyA, b: record, last_written: "b" }, []), true, "a record on B");
  assert.equal(bothScreensInUse(onlyA, [{ slot: "a" }, { slot: "b" }]), true, "an older history entry went to B");
});

test("sentAgo reads as a person would say it, at the boundaries", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const ago = (seconds: number): string => sentAgo(new Date(now - seconds * 1000).toISOString(), now, "en-GB");
  assert.equal(ago(0), "just now");
  assert.equal(ago(44), "just now");
  assert.equal(ago(45), "1 min ago");
  assert.equal(ago(5 * 60), "5 min ago");
  assert.equal(ago(59 * 60), "59 min ago");
  assert.equal(ago(59.6 * 60), "1 h ago", "59.6 minutes does not read as 60 min");
  assert.equal(ago(2 * 3600), "2 h ago");
  assert.equal(ago(23 * 3600), "23 h ago");
  assert.equal(ago(30 * 3600), "yesterday");
  assert.equal(ago(-120), "just now", "a clock slightly ahead of the browser is not in the future");
  assert.match(ago(5 * 24 * 3600), /^27 Sep/, "older than two days is a plain date (month spelling depends on the ICU data)");
  assert.equal(sentAgo("not a date", now), "");
});

test("the tile caption says when it was sent and, for a rotation, how many programs", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const record: SlotRecord = { title: "Heart + clock", descriptor: null, wire_kind: 0, programs: 1, written_at: new Date(now - 5 * 60 * 1000).toISOString() };
  assert.equal(slotRecordCaption(record, now), "Sent 5 min ago");
  assert.equal(slotRecordCaption({ ...record, programs: 4 }, now), "Sent 5 min ago · 4 programs");
  assert.equal(slotRecordCaption({ ...record, written_at: "garbage" }, now), "Sent");
});

test("Switch screen is available while the clock is in range, and says why when it is not or when the display is off", () => {
  assert.equal(switchScreenBlockReason({ connected: true, power: true }), null);
  assert.equal(switchScreenBlockReason({ connected: true, power: undefined }), null, "an unknown display state does not block it");
  assert.equal(switchScreenBlockReason({ connected: false, power: true }), "The clock is out of range.");
  assert.equal(switchScreenBlockReason({ connected: true, power: false }), "The display is off.");
  assert.equal(switchScreenBlockReason({ connected: false, power: false }), "The clock is out of range.", "out of range is the more basic reason");
});

test("a date page is always filed on screen B: A is refused with the rule's reason, B is open whatever the capability list says", () => {
  assert.deepEqual(slotAllowance("a", "date", CONSERVATIVE), { ok: false, reason: SLOT_A_DATE_REASON });
  assert.equal(SLOT_A_DATE_REASON, "The clock always keeps its date page on screen B.");
  assert.deepEqual(slotAllowance("b", "date", CONSERVATIVE), { ok: true, reason: null });
  assert.deepEqual(slotAllowance("b", "date", undefined), { ok: true, reason: null }, "a rule of the wire format, not a capability");
  assert.deepEqual(slotAllowance("b", "date", caps([])), { ok: true, reason: null });
});

test("a date page goes to B whatever was remembered, and that never rewrites the remembered choice", () => {
  const store = createSlotChoiceStore(null);
  assert.equal(effectiveSlot("clock-1", "date", CONSERVATIVE, store), "b", "A remembered (the default)");
  store.set("clock-1", "b");
  assert.equal(effectiveSlot("clock-1", "date", CONSERVATIVE, store), "b");
  store.set("clock-1", "a");
  assert.equal(effectiveSlot("clock-1", "date", undefined, store), "b", "even with no capability list");
  assert.equal(store.get("clock-1"), "a", "the next non-date show still goes where the user last chose");
  assert.equal(effectiveSlot("clock-1", "clock", CONSERVATIVE, store), "a");
});

test("resolveSlot sends a date to B without any capability lookup, even when A is remembered or the clock cannot be asked", async () => {
  clearSlotCapabilities();
  const { hass, messages } = fakeHass(async () => {
    throw new Error("must not be called");
  });
  setSlotChoice("resolve-date", "a");
  assert.equal(await resolveSlot(hass, "resolve-date", "date"), "b");
  assert.equal(await resolveSlot(undefined, "resolve-date", "date"), "b");
  assert.equal(messages.length, 0);
  assert.equal(await resolveSlot(hass, "resolve-date", "clock"), "a", "other content still follows the remembered A");
});

const press = (key: string, modifiers: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, ...modifiers });

test("keyedSlot: arrows step through the screens that may be chosen and wrap round; Home and End jump to the ends", () => {
  assert.equal(keyedSlot(press("ArrowRight"), "a", ["a", "b"]), "b");
  assert.equal(keyedSlot(press("ArrowRight"), "b", ["a", "b"]), "a", "wraps forwards");
  assert.equal(keyedSlot(press("ArrowDown"), "a", ["a", "b"]), "b");
  assert.equal(keyedSlot(press("ArrowLeft"), "a", ["a", "b"]), "b", "wraps backwards");
  assert.equal(keyedSlot(press("ArrowUp"), "b", ["a", "b"]), "a");
  assert.equal(keyedSlot(press("Home"), "b", ["a", "b"]), "a");
  assert.equal(keyedSlot(press("End"), "a", ["a", "b"]), "b");
});

test("keyedSlot: a screen that may not be chosen is never the answer, though the key still belongs to the group", () => {
  assert.equal(keyedSlot(press("ArrowRight"), "a", ["a"]), "a", "B is blocked: stays on A");
  assert.equal(keyedSlot(press("End"), "a", ["a"]), "a");
  assert.equal(keyedSlot(press("Home"), "b", ["b"]), "b", "a date page can only be on B");
  assert.equal(keyedSlot(press("ArrowLeft"), "b", ["b"]), "b");
});

test("keyedSlot: keys the group does not handle, and keys held with Alt, Ctrl or Meta, are left to the browser", () => {
  for (const key of ["Tab", "Enter", " ", "a", "Escape", "PageDown"]) assert.equal(keyedSlot(press(key), "a", ["a", "b"]), null, key);
  assert.equal(keyedSlot(press("ArrowLeft", { altKey: true }), "b", ["a", "b"]), null, "Alt+Left is the browser's Back");
  assert.equal(keyedSlot(press("ArrowRight", { metaKey: true }), "a", ["a", "b"]), null);
  assert.equal(keyedSlot(press("Home", { ctrlKey: true }), "b", ["a", "b"]), null);
  assert.equal(keyedSlot(press("ArrowRight"), "a", []), null, "nothing can be chosen");
});

test("keyedSlot: when the current screen is not one of those available, arrows enter at the end they point away from", () => {
  assert.equal(keyedSlot(press("ArrowRight"), "a", ["b"]), "b");
  assert.equal(keyedSlot(press("ArrowLeft"), "a", ["b"]), "b");
});
