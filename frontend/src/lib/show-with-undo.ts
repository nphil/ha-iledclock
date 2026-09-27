/** The one "Show on clock" behaviour every surface uses (spec §0.4): showing is reversible, so it is
 * a plain tap followed by a toast "Now showing X · Undo"; Undo re-shows the previous item
 * (`iledclock/show {item: {restore: "previous"}}`) instead of repeating an upload of this one. */
import type { HomeAssistant, ShowItem } from "../types.ts";
import type { LuToastRequest } from "../components/lu-toast.ts";
import { showRequest } from "./ws-api.ts";

export const UNDO_WINDOW_MS = 5000;
const undoGenerations = new Map<string, number>();

function toast(host: HTMLElement, request: LuToastRequest): void {
  host.dispatchEvent(new CustomEvent<LuToastRequest>("lu-toast", { detail: request, bubbles: true, composed: true }));
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "The clock did not accept it";
}

/** Shows `item` on the clock, then offers Undo. Resolves true on success. Throws nothing: failures are
 * reported through a toast (with Retry) so callers only manage their own busy state. */
export async function showWithUndo(host: HTMLElement, hass: HomeAssistant, entryId: string, item: ShowItem, title: string): Promise<boolean> {
  const callWS = hass.callWS?.bind(hass);
  if (!callWS) return false;
  try {
    await callWS(showRequest(entryId, item));
  } catch (err) {
    toast(host, {
      message: `Couldn't show ${title}: ${errorMessage(err)}`,
      actionLabel: "Retry",
      action: () => void showWithUndo(host, hass, entryId, item, title),
      timeoutMs: 8000,
    });
    return false;
  }
  const generation = (undoGenerations.get(entryId) ?? 0) + 1;
  undoGenerations.set(entryId, generation);
  toast(host, {
    message: `Now showing ${title}`,
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
        toast(host, { message: "Restored the previous item", timeoutMs: 3000 });
      } catch (err) {
        toast(host, { message: `Couldn't undo: ${errorMessage(err)}`, timeoutMs: 6000 });
      }
    },
  });
  return true;
}
