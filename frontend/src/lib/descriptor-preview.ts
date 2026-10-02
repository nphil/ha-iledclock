/** Turns what the clock was told to show (a `now_showing` / history entry, or the descriptor of a screen's record)
 * into the frames the LED preview plays. This was written out twice, in Now and in the Lovelace card; both, and
 * the screen tiles, use it now.
 *
 * Previews are rendered by the server (`iledclock/render`), the same code the upload uses, so what is drawn here is
 * what the clock plays. Descriptors the server cannot draw (the clock draws date, temperature and humidity pages
 * itself) get an honest "no preview" instead of a guess.
 */

import type { HomeAssistant, RenderResult, RenderSpec } from "../types.ts";
import { GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "./grid.ts";
import { base64ToFrame } from "./design-codec.ts";
import { descriptorPlayback } from "./playback.ts";
import { isLegacyDescriptor } from "./slots.ts";
import { buildTextRenderSpec, renderRequest } from "./ws-api.ts";

export interface PreviewDescriptor {
  kind: string;
  [key: string]: unknown;
}

/** How a descriptor becomes frames: already in hand, rendered by the server from a spec, or not drawable at all. */
export type DescriptorPreviewPlan =
  | { type: "inline"; frames: string[]; delays: number[] }
  | { type: "render"; spec: RenderSpec }
  | { type: "none"; reason: string };

export interface DescriptorPreview {
  frames: PixelFrame[];
  /** The server marked the render as an approximation of what the clock draws. */
  approximate: boolean;
}

const NO_PREVIEW = "A live preview is not available for this item.";
/** The pages the clock draws with its own fonts; the server has nothing to render for them. */
const SELF_DRAWN: Readonly<Record<string, string>> = {
  date: "date",
  temperature: "temperature",
  humidity: "humidity",
  timer: "timer",
  scoreboard: "scoreboard",
};

const WHITE: [number, number, number] = [255, 255, 255];

/** The RGB a descriptor carries (white when it has none). */
export function descriptorColor(descriptor: PreviewDescriptor): [number, number, number] {
  const color = descriptor.color;
  return Array.isArray(color) && color.length >= 3 ? [Number(color[0]), Number(color[1]), Number(color[2])] : [...WHITE];
}

/** What changes the picture: two descriptors with the same key draw the same frames. */
export function descriptorPreviewKey(descriptor: PreviewDescriptor | null | undefined): string {
  if (!descriptor) return "empty";
  const frames = Array.isArray(descriptor.frames) ? descriptor.frames.length : 0;
  return [
    descriptor.kind,
    descriptor.shown_at ?? "",
    descriptor.design_id ?? "",
    descriptor.style ?? "",
    descriptor.text ?? "",
    "speed" in descriptor ? String(descriptor.speed) : "",
    "smooth" in descriptor ? String(descriptor.smooth) : "",
    JSON.stringify(descriptor.color ?? null),
    descriptor.h24 ?? "",
    descriptor.hours24 ?? "",
    descriptor.background ?? "",
    descriptor.effect ?? "",
    descriptor.is_bold ?? descriptor.bold ?? "",
    descriptor.font ?? "",
    descriptor.seconds ?? "",
    descriptor.seed ?? "",
    frames,
  ].join("|");
}

/** Decode a render / preview result into frames (hold times in ms, possibly fractional). */
export function decodeRenderFrames(result: Pick<RenderResult, "frames" | "delays">): PixelFrame[] {
  return result.frames.map((encoded, index) => base64ToFrame(encoded, GRID_WIDTH, GRID_HEIGHT, result.delays[index] ?? 100));
}

/** How to draw `descriptor`. Mirrors what the clock was sent: a design replays at the speed and smooth setting it was shown
 * with, text uses its font, effect, bold and playback, a clock uses its face, colour and hour format. */
export function descriptorPreviewPlan(descriptor: PreviewDescriptor): DescriptorPreviewPlan {
  switch (descriptor.kind) {
    case "design":
      if (typeof descriptor.design_id !== "string" || !descriptor.design_id) return { type: "none", reason: NO_PREVIEW };
      return { type: "render", spec: { type: "design", design_id: descriptor.design_id, ...descriptorPlayback(descriptor) } };
    case "clock":
      return {
        type: "render",
        spec: {
          type: "clock",
          style: Number(descriptor.style) || 1,
          color: descriptorColor(descriptor),
          h24: descriptor.h24 !== undefined && descriptor.h24 !== null ? Boolean(descriptor.h24) : descriptor.hours24 !== false,
          background: descriptor.background !== false,
        },
      };
    case "image": {
      if (!Array.isArray(descriptor.frames) || descriptor.frames.length === 0) return { type: "none", reason: NO_PREVIEW };
      const frames = descriptor.frames as string[];
      const delays = Array.isArray(descriptor.delays) ? (descriptor.delays as number[]) : [];
      const playback = descriptorPlayback(descriptor);
      // The clock plays server-retimed frames, so show those, not the raw ones.
      if ("speed" in playback || "smooth" in playback) return { type: "render", spec: { type: "image", frames, delays, ...playback } };
      return { type: "inline", frames, delays };
    }
    case "text": {
      if (typeof descriptor.text !== "string") return { type: "none", reason: NO_PREVIEW };
      const effect = descriptor.effect === undefined || descriptor.effect === null ? undefined : String(descriptor.effect);
      const bold = descriptor.is_bold ?? descriptor.bold;
      const playback = isLegacyDescriptor(descriptor) ? {} : descriptorPlayback(descriptor);
      const spec = buildTextRenderSpec(descriptor.text, descriptorColor(descriptor), {
        font: typeof descriptor.font === "string" ? descriptor.font : undefined,
        effect,
        bold: typeof bold === "boolean" ? bold : undefined,
        speed: playback.speed,
        smooth: playback.smooth,
      });
      return spec ? { type: "render", spec } : { type: "none", reason: "There is no text to preview." };
    }
    case "generative": {
      const kind = typeof descriptor.effect === "string" ? descriptor.effect : "plasma";
      const seconds = Number(descriptor.seconds);
      const spec: RenderSpec = { type: "generative", kind, seconds: Number.isFinite(seconds) && seconds >= 1 ? Math.round(seconds) : 10, ...descriptorPlayback(descriptor) };
      if (typeof descriptor.seed === "number") spec.seed = Math.trunc(descriptor.seed);
      return { type: "render", spec };
    }
    default: {
      const noun = SELF_DRAWN[descriptor.kind];
      return { type: "none", reason: noun ? `The clock draws the ${noun} itself, so there is no preview.` : NO_PREVIEW };
    }
  }
}

// ---- loading, shared by every surface that previews a descriptor ----

type CallWS = Pick<HomeAssistant, "callWS">;

/** A preview stays fresh this long; a design edited in the studio is picked up on the next look after that. */
export const PREVIEW_CACHE_MS = 60_000;
const PREVIEW_CACHE_LIMIT = 24;
const previewCache = new Map<string, { at: number; promise: Promise<DescriptorPreview> }>();

export function clearDescriptorPreviewCache(): void {
  previewCache.clear();
}

async function render(hass: CallWS, entryId: string, plan: DescriptorPreviewPlan): Promise<DescriptorPreview> {
  if (plan.type === "none") throw new Error(plan.reason);
  if (plan.type === "inline") return { frames: decodeRenderFrames(plan), approximate: false };
  if (typeof hass.callWS !== "function") throw new Error("Home Assistant connection is unavailable.");
  const result = await hass.callWS<RenderResult>(renderRequest(entryId, plan.spec));
  return { frames: decodeRenderFrames(result), approximate: Boolean(result.approximate) };
}

/** Frames for `descriptor`, rendered by the server. Two surfaces asking for the same picture (the hero and the tile of
 * the screen it was sent to) share one request. Rejects with a sentence the panel can show when it cannot be drawn. */
export function loadDescriptorPreview(hass: CallWS, entryId: string, descriptor: PreviewDescriptor): Promise<DescriptorPreview> {
  const plan = descriptorPreviewPlan(descriptor);
  if (plan.type === "none") return Promise.reject(new Error(plan.reason));
  const key = `${entryId}|${descriptorPreviewKey(descriptor)}`;
  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.at < PREVIEW_CACHE_MS) return cached.promise;
  const promise = render(hass, entryId, plan);
  previewCache.delete(key);
  previewCache.set(key, { at: Date.now(), promise });
  // A failed render must not be remembered, or the next look would show the old error.
  promise.catch(() => {
    if (previewCache.get(key)?.promise === promise) previewCache.delete(key);
  });
  while (previewCache.size > PREVIEW_CACHE_LIMIT) {
    const oldest = previewCache.keys().next().value;
    if (oldest === undefined) break;
    previewCache.delete(oldest);
  }
  return promise;
}
