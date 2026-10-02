/** Screens A and B: which screen of the clock a "Show" goes to, and what each screen accepts.
 *
 * The clock has two screens behind its power button. Bluetooth cannot pick one and nothing can be read
 * back, so a screen changes only when something is sent to it. Screen A is the program list (every show
 * goes there by default); screen B is the clock-page store, which takes clock, date and temperature pages
 * (and, while the server's capability list says so, designs with a clock).
 *
 * The server is the authority on what B accepts (`capabilities.slots.b_accepts`, from live-unverified
 * flags) and always refuses what it cannot take, so nothing here can write to the wrong screen: this module
 * only decides what the controls offer and remembers the last choice per clock.
 *
 * Pure, framework-free and storage-injectable so it is unit-tested without a browser.
 */

import type { Capabilities, ClockStateEnvelope, ContentClass, HomeAssistant, ShowItem, SlotId, SlotRecord, SlotsState, StoredDesign } from "../types.ts";
import { stateRequest } from "./ws-api.ts";

export const SLOT_IDS: readonly SlotId[] = ["a", "b"];
export const DEFAULT_SLOT: SlotId = "a";

/** The words the server's `slots.slot_unsupported_reason` uses; copied here so a disabled B can say why before
 * anything is sent. Keep them identical to custom_components/iledclock/slots.py. */
export const SLOT_B_TIMER_REASON = "Timers and scoreboards only work on screen A.";
export const SLOT_B_PAGES_ONLY_REASON = "Screen B only takes clock, date and temperature pages for now; pictures go on screen A.";
/** Shown when the clock's screen capabilities could not be read at all. */
export const SLOT_B_UNAVAILABLE_REASON = "Screen B isn't available right now.";
/** A date page is filed on screen B by the wire format itself (its program type carries the screen-B marker), so this is a
 * rule, not a capability. */
export const SLOT_A_DATE_REASON = "The clock always keeps its date page on screen B.";

export function isSlotId(value: unknown): value is SlotId {
  return value === "a" || value === "b";
}

/** "Screen A" / "Screen B". */
export function slotLabel(slot: SlotId): string {
  return slot === "b" ? "Screen B" : "Screen A";
}

/** True for a descriptor written before screens existed: it carries no `slot`. Text speeds in those entries are on the old
 * 0-255 scale, which now means nothing (the server refuses values above 100), so previews and re-shows leave them out. */
export function isLegacyDescriptor(descriptor: object): boolean {
  return !("slot" in descriptor);
}

/** The screen a stored descriptor was written to; entries from before screens existed count as screen A. */
export function descriptorSlot(descriptor: { slot?: unknown } | null | undefined): SlotId {
  return descriptor?.slot === "b" ? "b" : "a";
}

/** The headline and the history rows name their screen only once screen B has been used, so a clock that
 * only ever uses screen A reads exactly as it did before screens existed. */
export function bothScreensInUse(slots: SlotsState | null | undefined, history: ReadonlyArray<{ slot?: unknown }> = []): boolean {
  return Boolean(slots?.b) || history.some((item) => item.slot === "b");
}

// ---- what a screen accepts ----

export interface SlotAllowance {
  ok: boolean;
  /** One line saying why not; null when the screen takes it. */
  reason: string | null;
}

/** Whether `slot` takes content of `contentClass`. Screen A takes everything. Screen B takes what
 * `capabilities.slots.b_accepts` lists; with no list (not loaded, or an older integration) it is not
 * offered. */
export function slotAllowance(slot: SlotId, contentClass: ContentClass, capabilities?: Pick<Capabilities, "slots"> | null): SlotAllowance {
  if (contentClass === "date") return slot === "b" ? { ok: true, reason: null } : { ok: false, reason: SLOT_A_DATE_REASON };
  if (slot === "a") return { ok: true, reason: null };
  const accepted = capabilities?.slots?.b_accepts;
  if (!accepted) return { ok: false, reason: SLOT_B_UNAVAILABLE_REASON };
  if (accepted.includes(contentClass)) return { ok: true, reason: null };
  return { ok: false, reason: contentClass === "timer" || contentClass === "scoreboard" ? SLOT_B_TIMER_REASON : SLOT_B_PAGES_ONLY_REASON };
}

/** The screen a key press moves a screen radio group to, or null when the key is not one the group handles (the caller then leaves
 * the event alone). Arrow keys step through `available` (the screens that may be chosen, in order) and wrap round; Home and End jump to
 * the first and last. A key pressed with Alt, Ctrl or Meta held (browser Back, shortcuts) is never handled. */
export function keyedSlot(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey">, current: SlotId, available: readonly SlotId[]): SlotId | null {
  if (event.altKey || event.ctrlKey || event.metaKey || available.length === 0) return null;
  if (event.key === "Home") return available[0] ?? null;
  if (event.key === "End") return available[available.length - 1] ?? null;
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (step === 0) return null;
  const at = available.indexOf(current);
  if (at < 0) return (step > 0 ? available[0] : available[available.length - 1]) ?? null;
  return available[(at + step + available.length) % available.length] ?? null;
}

// ---- the remembered choice, per clock ----

/** The slice of `localStorage` the choice needs. */
export interface SlotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SlotChoiceChange {
  entryId: string;
  slot: SlotId;
}

export interface SlotChoiceStore {
  /** The remembered screen for this clock; screen A until a choice is made. */
  get(entryId: string): SlotId;
  /** Remember `slot` and tell every subscriber when it differs from what was remembered. */
  set(entryId: string, slot: SlotId): void;
  subscribe(listener: (change: SlotChoiceChange) => void): () => void;
}

export function slotChoiceKey(entryId: string): string {
  return `iledclock:slot-choice:v1:${encodeURIComponent(entryId)}`;
}

/** The choice survives a reload through `storage`; without usable storage (private mode, blocked) it is still
 * remembered for as long as the page lives, held in memory. */
export function createSlotChoiceStore(storage: SlotStorage | null): SlotChoiceStore {
  const memory = new Map<string, SlotId>();
  const listeners = new Set<(change: SlotChoiceChange) => void>();
  const store: SlotChoiceStore = {
    get(entryId) {
      const known = memory.get(entryId);
      if (known) return known;
      let stored: string | null = null;
      try {
        stored = storage?.getItem(slotChoiceKey(entryId)) ?? null;
      } catch {
        stored = null;
      }
      const slot = isSlotId(stored) ? stored : DEFAULT_SLOT;
      memory.set(entryId, slot);
      return slot;
    },
    set(entryId, slot) {
      if (!isSlotId(slot)) return;
      const previous = store.get(entryId);
      memory.set(entryId, slot);
      try {
        storage?.setItem(slotChoiceKey(entryId), slot);
      } catch {
        // Storage full or blocked: the choice still holds for this page.
      }
      if (previous !== slot) for (const listener of [...listeners]) listener({ entryId, slot });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return store;
}

function browserStorage(): SlotStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The one store every control in the page shares (card, panel, sheets). */
export const slotChoices: SlotChoiceStore = createSlotChoiceStore(browserStorage());

export function getSlotChoice(entryId: string): SlotId {
  return slotChoices.get(entryId);
}

export function setSlotChoice(entryId: string, slot: SlotId): void {
  slotChoices.set(entryId, slot);
}

/** The screen a Show goes to right now: the remembered choice when this content may go there, else A. Both A
 * and the reason B is off are visible in the A | B control, so this never routes silently. */
export function effectiveSlot(entryId: string, contentClass: ContentClass, capabilities?: Pick<Capabilities, "slots"> | null, store: SlotChoiceStore = slotChoices): SlotId {
  if (contentClass === "date") return "b";
  return store.get(entryId) === "b" && slotAllowance("b", contentClass, capabilities).ok ? "b" : "a";
}

// ---- what kind of content a show is ----

/** Anything `contentClassOf` can classify: a show item, a stored design, or a `now_showing` / history /
 * slot-record descriptor. A "restore" (Undo) is not content and is not accepted. */
export type ContentSource = Exclude<ShowItem, { restore: "previous" }> | StoredDesign | { kind: string; [key: string]: unknown };

/** Where a design id's clock region comes from: the loaded Library, or a lookup. */
export type DesignLookup = readonly Pick<StoredDesign, "id" | "clock_region">[] | ((designId: string) => Pick<StoredDesign, "clock_region"> | null | undefined);

function designClass(designId: unknown, designs: DesignLookup | undefined): ContentClass {
  if (typeof designId !== "string" || !designs) return "art";
  const design = typeof designs === "function" ? designs(designId) : designs.find((candidate) => candidate.id === designId);
  return design?.clock_region ? "art_clock" : "art";
}

function classOfKind(kind: string, fields: Record<string, unknown>, designs: DesignLookup | undefined): ContentClass {
  switch (kind) {
    case "clock":
    case "date":
    case "temperature":
    case "humidity":
    case "timer":
    case "scoreboard":
      return kind;
    case "design":
      return designClass(fields.design_id, designs);
    default:
      // text, image, generative and the stored design kinds ("image" / "animation"): a clock region makes it art + clock.
      return fields.clock_region ? "art_clock" : "art";
  }
}

/** The class the server uses to decide whether screen B takes a show (`const.CONTENT_CLASSES`): a design with a
 * clock region is `art_clock`; text, images, generated effects and plain designs are `art`; clock, date,
 * temperature, humidity, timer and scoreboard follow their kind. A design id alone does not say whether it has
 * a clock region, so pass the loaded `designs` (without them it counts as plain `art`, the stricter answer). */
export function contentClassOf(source: ContentSource, designs?: DesignLookup): ContentClass {
  const fields = source as Record<string, unknown>;
  const spec = fields.spec;
  if (spec && typeof spec === "object") {
    const specFields = spec as Record<string, unknown>;
    return classOfKind(String(specFields.type ?? ""), specFields, designs);
  }
  if (typeof fields.kind === "string") return classOfKind(fields.kind, fields, designs);
  if (typeof fields.design_id === "string") return designClass(fields.design_id, designs);
  return "art";
}

// ---- capabilities, fetched once per clock for surfaces that do not hold the live state ----

const capabilityCache = new Map<string, Capabilities>();
const capabilityRequests = new Map<string, Promise<Capabilities | null>>();

/** Remember the capabilities a live state push carried (surfaces that already subscribe call this on every push). */
export function primeSlotCapabilities(entryId: string, capabilities: Capabilities | null | undefined): void {
  if (capabilities?.slots) capabilityCache.set(entryId, capabilities);
}

export function cachedSlotCapabilities(entryId: string): Capabilities | null {
  return capabilityCache.get(entryId) ?? null;
}

/** The clock's capabilities: cached, else one `iledclock/state` call shared by every caller. Resolves null when they
 * cannot be read (no connection, clock unknown); failures are not cached, so the next call tries again. */
export function loadSlotCapabilities(hass: Pick<HomeAssistant, "callWS"> | undefined, entryId: string): Promise<Capabilities | null> {
  const cached = capabilityCache.get(entryId);
  if (cached) return Promise.resolve(cached);
  const pending = capabilityRequests.get(entryId);
  if (pending) return pending;
  if (!hass || typeof hass.callWS !== "function") return Promise.resolve(null);
  const request = hass
    .callWS<ClockStateEnvelope>(stateRequest(entryId))
    .then(
      (envelope) => {
        primeSlotCapabilities(entryId, envelope?.capabilities);
        return capabilityCache.get(entryId) ?? null;
      },
      () => null,
    )
    .finally(() => capabilityRequests.delete(entryId));
  capabilityRequests.set(entryId, request);
  return request;
}

/** Forget what was cached (tests, or after the integration is reloaded). */
export function clearSlotCapabilities(): void {
  capabilityCache.clear();
  capabilityRequests.clear();
}

/** What to tell the user when screen B is chosen but what it takes could not be checked. */
export const SLOT_CHECK_FAILED = "Couldn't check what screen B takes. Try again in a moment.";

/** The screen a Show button should send to, decided at click time (the A | B control shows the same answer).
 * Screen A takes everything, so a remembered A needs no check. For a remembered B it uses `known` capabilities (a
 * live state the caller holds) or the cached/fetched ones. When those cannot be read it resolves null: nothing is
 * sent rather than guessing between the screen the user picked and one they did not. */
export async function resolveSlot(hass: Pick<HomeAssistant, "callWS"> | undefined, entryId: string, contentClass: ContentClass, known?: Capabilities | null): Promise<SlotId | null> {
  if (contentClass === "date") return "b";
  if (getSlotChoice(entryId) === "a") return "a";
  const capabilities = known?.slots ? known : await loadSlotCapabilities(hass, entryId);
  if (!capabilities) return null;
  return effectiveSlot(entryId, contentClass, capabilities);
}

// ---- words for the screen tiles ----

/** "just now", "5 min ago", "2 h ago", "yesterday", then a short date such as "28 Sep". Empty when the time is unreadable. */
export function sentAgo(writtenAt: string, now: number = Date.now(), locale?: string): string {
  const then = Date.parse(writtenAt);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "yesterday";
  return new Date(then).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** The line under a screen tile's title: "Sent 5 min ago", with the program count when a whole rotation was sent. */
export function slotRecordCaption(record: SlotRecord, now: number = Date.now(), locale?: string): string {
  const sent = sentAgo(record.written_at, now, locale);
  const parts = [sent ? `Sent ${sent}` : "Sent"];
  if (record.programs > 1) parts.push(`${record.programs} programs`);
  return parts.join(" · ");
}

/** Why the Switch screen button cannot be pressed, or null when it can. It sends the clock's power key, which only works
 * while the clock is in Bluetooth range and its display is on (what it does with the display off or in night mode is not
 * known). An unknown power state counts as on. */
export function switchScreenBlockReason(clock: { connected: boolean; power: boolean | undefined }): string | null {
  if (!clock.connected) return "The clock is out of range.";
  if (clock.power === false) return "The display is off.";
  return null;
}
