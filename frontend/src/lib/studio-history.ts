import { descriptorPlayback } from "./playback.ts";
import { isLegacyDescriptor } from "./slots.ts";

export interface ShowHistoryDescriptor {
  kind: string;
  title?: string;
  shown_at?: string;
  unavailable?: boolean;
  design_id?: string;
  /** The screen it was written to ("a" / "b"); entries from before screens existed have none and count as "a". */
  slot?: string;
  [key: string]: unknown;
}

/** Rebuild the `item` payload from a saved descriptor. Presentation-only fields are stripped (the screen goes to
 * `iledclock/show` as its own `slot`, see `descriptorSlot`); generative descriptors store their preset as `effect`,
 * while `iledclock/show` expects `kind`. */
export function showItemFromDescriptor(descriptor: ShowHistoryDescriptor): Record<string, unknown> | null {
  const { kind, title: _title, shown_at: _shownAt, unavailable, slot: _slot, ...params } = descriptor;
  if (!kind || unavailable) return null;
  if (params.source === "playlist") delete params.source;
  if (kind === "design") {
    if (typeof params.design_id !== "string") return null;
    // A service call may have shown the design at its own speed/smooth: replay that, not the stored one.
    return { design_id: params.design_id, ...descriptorPlayback(params) };
  }
  if (kind === "generative" && typeof params.effect === "string") {
    params.kind = params.effect;
    delete params.effect;
  }
  if (kind === "text" && isLegacyDescriptor(descriptor)) {
    // Text speeds from before screens existed were 0-255, which the server now refuses; replay at Original.
    delete params.speed;
    delete params.smooth;
  }
  return { spec: { type: kind, ...params } };
}
