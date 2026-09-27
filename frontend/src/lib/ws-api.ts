/** Shapes and builds every `iledclock/*` WebSocket call (Contract D). Message-envelope builders
 * are thin by design (one object literal each) -- the real logic lives in the normalisers below,
 * which turn permissive studio/card UI state into the bounded, validated payload the integration
 * expects, so a malformed slider drag or a stale capabilities read can never reach the wire as a
 * request the integration would just reject anyway.
 */

import type { PlaylistItem, PlaylistItemKind, RenderSpec, ShowItem, StoredDesign } from "../types.ts";
import { clampRgb, type RGB } from "./color.ts";

export function stateRequest(entryId: string): Record<string, unknown> {
  return { type: "iledclock/state", entry_id: entryId };
}

export function subscribeRequest(entryId: string): Record<string, unknown> {
  return { type: "iledclock/subscribe", entry_id: entryId };
}

export function designsListRequest(entryId?: string): Record<string, unknown> {
  return entryId ? { type: "iledclock/designs/list", entry_id: entryId } : { type: "iledclock/designs/list" };
}

export function designsSaveRequest(design: StoredDesign): Record<string, unknown> {
  return { type: "iledclock/designs/save", design };
}

export function designsDeleteRequest(id: string): Record<string, unknown> {
  // `id` is reserved for the WebSocket message id in HA's protocol.
  return { type: "iledclock/designs/delete", design_id: id };
}

export function renderRequest(entryId: string, spec: RenderSpec): Record<string, unknown> {
  return { type: "iledclock/render", entry_id: entryId, spec };
}

export function showRequest(entryId: string, item: ShowItem): Record<string, unknown> {
  return { type: "iledclock/show", entry_id: entryId, item };
}

export function playlistGetRequest(entryId: string): Record<string, unknown> {
  return { type: "iledclock/playlist/get", entry_id: entryId };
}

export function playlistSetRequest(entryId: string, playlist: PlaylistItem[]): Record<string, unknown> {
  return { type: "iledclock/playlist/set", entry_id: entryId, playlist };
}

export function commandRequest(entryId: string, command: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "iledclock/command", entry_id: entryId, command, params };
}

// ---- payload shaping / validation ----

export const MIN_PLAYLIST_ITEM_DURATION_S = 1;
export const MAX_PLAYLIST_ITEM_DURATION_S = 3600;
const PLAYLIST_KINDS: readonly PlaylistItemKind[] = ["clock", "date", "text", "design", "timer", "scoreboard", "temperature", "humidity"];

export function clampPlaylistDuration(seconds: number): number {
  return Math.max(MIN_PLAYLIST_ITEM_DURATION_S, Math.min(MAX_PLAYLIST_ITEM_DURATION_S, Math.round(seconds)));
}

/** Bounds a playlist before it goes out over `iledclock/playlist/set`: unknown `kind`s are
 * dropped (a stale editor row for a kind the device no longer reports), every duration is
 * clamped into range, and the list is truncated to the device's own `max_playlist_items` -- the
 * device has no way to reject "one too many" gracefully, so the truncation happens here instead
 * of round-tripping a rejected upload back to the editor. */
export function normalizePlaylist(items: readonly PlaylistItem[], maxItems: number): PlaylistItem[] {
  return items
    .filter((item) => PLAYLIST_KINDS.includes(item.kind))
    .slice(0, Math.max(0, maxItems))
    .map((item) => ({ ...item, duration_s: clampPlaylistDuration(item.duration_s) }));
}

export function reorderPlaylist(items: readonly PlaylistItem[], fromIndex: number, toIndex: number): PlaylistItem[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return items.slice();
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}

const MAX_TEXT_SPEED = 255;
const MAX_GENERATIVE_SECONDS = 3600;

/** `text`/`clock` renders send full-precision colour (clamped to valid bytes, not quantised) --
 * `render.py` owns RGB444 quantisation as part of rendering (Contract A), so the server's
 * returned frames are the authority on what the LEDs will show, not this request. Pixel-editor
 * tools that write canvas data directly (`rasterize.ts`, `flood-fill.ts`) quantise immediately
 * instead, since that data IS the design, with no server render step in between. Blank text is
 * rejected (`null`) instead of sent -- there is nothing for the device to show, and the
 * alternative is an upload that round-trips to an empty program. */
export function buildTextRenderSpec(text: string, color: RGB, options: { font?: string; effect?: string; speed?: number } = {}): RenderSpec | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const spec: RenderSpec = { type: "text", text: trimmed, color: clampRgb(color) };
  if (options.font) spec.font = options.font;
  if (options.effect) spec.effect = options.effect;
  if (options.speed !== undefined) spec.speed = Math.max(0, Math.min(MAX_TEXT_SPEED, Math.round(options.speed)));
  return spec;
}

export function buildGenerativeRenderSpec(kind: string, seconds: number, seed?: number): RenderSpec {
  const spec: RenderSpec = { type: "generative", kind, seconds: Math.max(1, Math.min(MAX_GENERATIVE_SECONDS, Math.round(seconds))) };
  if (seed !== undefined) spec.seed = Math.trunc(seed);
  return spec;
}

export function buildClockRenderSpec(style: number, color: RGB, h24: boolean, styleCount: number, background = true): RenderSpec {
  return { type: "clock", style: Math.max(1, Math.min(styleCount, Math.round(style))), color: clampRgb(color), h24, background };
}
