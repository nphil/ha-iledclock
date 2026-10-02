/** The one "Show on clock" behaviour every surface uses (spec §0.4): showing is reversible, so it is
 * a plain tap followed by a toast "Now showing X · Undo"; Undo re-shows the previous item
 * (`iledclock/show {item: {restore: "previous"}}`) instead of repeating an upload of this one.
 *
 * `options.slot` picks the clock screen the show is written to (see `lib/slots.ts`); the toast names screen B
 * so it is never a surprise where the picture went. Surfaces that do not know the screen themselves pass
 * `options.contentClass` instead (and the live `capabilities` when they hold them): the screen is then decided
 * here, from the remembered choice, exactly as the A | B control shows it. If screen B is remembered but cannot
 * be checked, nothing is sent.
 *
 * A surface whose show runs AFTER a wait (an import, a save) must not decide the screen after that wait: the
 * controls that define the content (layout, clock region) stay live meanwhile. It decides at the click with
 * `resolveShowTarget`, keeps the answer, and passes it as `options.target`; the show then goes exactly there,
 * and a screen the content cannot go to is refused by the server with its reason, never redirected. Undo needs no
 * slot: the server goes back to the previous item of the same screen as the one being undone. */
import type { Capabilities, ContentClass, HomeAssistant, ShowItem, SlotId } from "../types.ts";
import type { LuToastRequest } from "../components/lu-toast.ts";
import { SLOT_CHECK_FAILED, getSlotChoice, resolveSlot } from "./slots.ts";
import { showRequest } from "./ws-api.ts";

export const UNDO_WINDOW_MS = 5000;
const undoGenerations = new Map<string, number>();

/** Where a show goes, fixed at one moment. `fellBack` is true when screen B is remembered but this content cannot go
 * there, so it goes to A and the toast says so rather than staying silent. */
export interface ShowTarget {
  slot: SlotId;
  fellBack: boolean;
}

export interface ShowOptions {
  /** The screen to write to; left out, the server writes screen A. */
  slot?: SlotId;
  /** A screen decided earlier by `resolveShowTarget`, used exactly as it is (nothing is decided again here). Wins over
   * `slot` and `contentClass`. */
  target?: ShowTarget;
  /** What kind of content this is; the screen is picked from the remembered choice when neither `target` nor `slot` is given. */
  contentClass?: ContentClass;
  /** The clock's live capabilities, when the caller holds them (saves a lookup). */
  capabilities?: Capabilities | null;
}

/** The screen a Show of `contentClass` goes to right now (what the A | B control shows), or null when screen B is remembered but
 * what it takes cannot be checked (then nothing may be sent). Call it at the click and keep the answer for `options.target`. */
export async function resolveShowTarget(hass: Pick<HomeAssistant, "callWS"> | undefined, entryId: string, contentClass: ContentClass, capabilities?: Capabilities | null): Promise<ShowTarget | null> {
  const remembered = getSlotChoice(entryId);
  const slot = await resolveSlot(hass, entryId, contentClass, capabilities);
  return slot === null ? null : { slot, fellBack: slot === "a" && remembered === "b" };
}

function toast(host: HTMLElement, request: LuToastRequest): void {
  host.dispatchEvent(new CustomEvent<LuToastRequest>("lu-toast", { detail: request, bubbles: true, composed: true }));
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "The clock did not accept it";
}

/** A refusal because the chosen screen cannot take this content: asking again changes nothing. */
function isSlotRefusal(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: unknown }).code === "slot_unsupported");
}

/** Shows `item` on the clock, then offers Undo. Resolves true on success. Throws nothing: failures are
 * reported through a toast (with Retry) so callers only manage their own busy state. */
export async function showWithUndo(host: HTMLElement, hass: HomeAssistant, entryId: string, item: ShowItem, title: string, options: ShowOptions = {}): Promise<boolean> {
  const callWS = hass.callWS?.bind(hass);
  if (!callWS) return false;
  let target: ShowTarget | undefined = options.target ?? (options.slot ? { slot: options.slot, fellBack: false } : undefined);
  if (!target && options.contentClass) {
    const resolved = await resolveShowTarget(hass, entryId, options.contentClass, options.capabilities);
    if (!resolved) {
      toast(host, { message: `Couldn't show ${title}: ${SLOT_CHECK_FAILED}`, actionLabel: "Retry", action: () => void showWithUndo(host, hass, entryId, item, title, options), timeoutMs: 8000 });
      return false;
    }
    target = resolved;
  }
  const slot = target?.slot;
  // Where the toast says it went: B by name, and A when B was remembered but this content cannot go there.
  let where = slot === "b" ? " on screen B" : target?.fellBack ? " on screen A" : "";
  try {
    const result = await callWS<{ now_showing?: { slot?: unknown } } | undefined>(showRequest(entryId, item, slot));
    // The server says where the show really landed (a date page is filed on screen B whichever screen was asked for): trust that.
    const landed = result?.now_showing?.slot;
    if (landed === "b") where = " on screen B";
    else if (landed === "a" && where === " on screen B") where = " on screen A";
  } catch (err) {
    toast(host, {
      message: `Couldn't show ${title}${where}: ${errorMessage(err)}`,
      ...(isSlotRefusal(err) ? {} : { actionLabel: "Retry", action: () => void showWithUndo(host, hass, entryId, item, title, target ? { ...options, target } : options) }),
      timeoutMs: 8000,
    });
    return false;
  }
  const generation = (undoGenerations.get(entryId) ?? 0) + 1;
  undoGenerations.set(entryId, generation);
  toast(host, {
    message: `Now showing ${title}${where}`,
    actionLabel: "Undo",
    timeoutMs: UNDO_WINDOW_MS,
    action: async () => {
      if (undoGenerations.get(entryId) !== generation) {
        toast(host, { message: "That undo expired", timeoutMs: 3000 });
        return;
      }
      try {
        await callWS(showRequest(entryId, { restore: "previous" }));
        if (undoGenerations.get(entryId) === generation) undoGenerations.set(entryId, generation + 1);
        toast(host, { message: `Restored the previous item${where}`, timeoutMs: 3000 });
      } catch (err) {
        toast(host, { message: `Couldn't undo: ${errorMessage(err)}`, timeoutMs: 6000 });
      }
    },
  });
  return true;
}
