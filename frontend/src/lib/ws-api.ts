/** Shapes and builds every `iledclock/*` WebSocket call (Contract D). Message-envelope builders
 * are thin by design (one object literal each) -- the real logic lives in the normalisers below,
 * which turn permissive studio/card UI state into the bounded, validated payload the integration
 * expects, so a malformed slider drag or a stale capabilities read can never reach the wire as a
 * request the integration would just reject anyway.
 */

import type { PlaylistItem, PlaylistItemKind, ReminderInput, RenderSpec, ShowItem, SlotId, SmoothSetting, StoredDesign } from "../types.ts";
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

/** Only the keys present change on the server; `speed: null` means Original and `smooth: null` means auto. */
export interface PlaybackPatch {
  speed?: number | null;
  smooth?: SmoothSetting;
}

/** `iledclock/designs/set_playback` (admin): persist a design's speed and/or smooth setting. */
export function designsSetPlaybackRequest(designId: string, patch: PlaybackPatch): Record<string, unknown> {
  const request: Record<string, unknown> = { type: "iledclock/designs/set_playback", design_id: designId };
  if (patch.speed !== undefined) request.speed = patch.speed;
  if (patch.smooth !== undefined) request.smooth = patch.smooth;
  return request;
}

/** What `iledclock/playback/preview` retimes: a stored design, or inline frames (base64 RGB888, parallel ms delays). */
export type PlaybackSource =
  | { designId: string; entryId?: string }
  | { frames: readonly string[]; delays: readonly number[]; clockRegion?: StoredDesign["clock_region"]; entryId?: string };

/** `iledclock/playback/preview` (read-only): the exact frames the clock will play at this speed/smooth.
 * `speed` and `smooth` are always sent, including null (Original / auto), so they override any stored value. */
export function playbackPreviewRequest(source: PlaybackSource, state: { speed: number | null; smooth: SmoothSetting }): Record<string, unknown> {
  const request: Record<string, unknown> = { type: "iledclock/playback/preview" };
  if (source.entryId) request.entry_id = source.entryId;
  if ("designId" in source) request.design_id = source.designId;
  else {
    request.frames = [...source.frames];
    request.delays = [...source.delays];
    if (source.clockRegion !== undefined) request.clock_region = source.clockRegion;
  }
  request.speed = state.speed;
  request.smooth = state.smooth;
  return request;
}

export function renderRequest(entryId: string, spec: RenderSpec): Record<string, unknown> {
  return { type: "iledclock/render", entry_id: entryId, spec };
}

/** `slot` picks the screen the show is written to ("a" = the program list, "b" = the clock-page store);
 * left out, the server writes screen A. Undo (`{restore: "previous"}`) needs no slot: it goes back to the
 * screen that was just written. */
export function showRequest(entryId: string, item: ShowItem, slot?: SlotId): Record<string, unknown> {
  return slot ? { type: "iledclock/show", entry_id: entryId, item, slot } : { type: "iledclock/show", entry_id: entryId, item };
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

/** Press the clock's power key once, which toggles between screen A and screen B (stock key event, sent
 * as `iledclock/command` `switch_screen`). The clock never answers and never reports which screen is
 * showing, so this is a toggle, not "go to B"; do not infer the visible screen from it. */
export function switchScreenRequest(entryId: string): Record<string, unknown> {
  return commandRequest(entryId, "switch_screen");
}

// ---- Alarms & reminders (`iledclock/command`, admin) ----

/** Create (no `key`) or edit (`key`) an alarm / reminder. The server persists the definition, writes the
 * clock, reads it back, and answers `{item: ManagedReminder}`; the new list also arrives on the state push. */
export function reminderSetRequest(entryId: string, input: ReminderInput): Record<string, unknown> {
  return commandRequest(entryId, "reminder_set", { ...input });
}

/** Disabled = removed from the clock, definition kept; enabled = written to the clock again. */
export function reminderSetEnabledRequest(entryId: string, key: string, enabled: boolean): Record<string, unknown> {
  return commandRequest(entryId, "reminder_set_enabled", { key, enabled });
}

/** Delete a managed item (by `key`: its clock slots and its definition) or a reminder that is only on the
 * clock (by `id`: the clock's own reminder id). */
export function reminderDeleteRequest(entryId: string, target: { key: string } | { id: number }): Record<string, unknown> {
  return commandRequest(entryId, "reminder_delete", { ...target });
}

/** Write a managed item to the clock again (status "missing", "changed" or "error"). */
export function reminderResendRequest(entryId: string, key: string): Record<string, unknown> {
  return commandRequest(entryId, "reminder_resend", { key });
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

const MAX_TEXT_SPEED = 100;
const MAX_GENERATIVE_SECONDS = 3600;

/** What a text render or show can be asked for. Colour is a separate argument. */
export interface TextRenderOptions {
  font?: string;
  /** The clock's colour mode as a numeric string: "1" solid, "2" rainbow, "4" per-letter rainbow. */
  effect?: string;
  bold?: boolean;
  /** Playback speed, the same scale as every other show: 0 = Still .. 100 = Max, null or absent = Original. */
  speed?: number | null;
  /** "on" / "off"; null or absent = auto. */
  smooth?: SmoothSetting;
}

/** `text`/`clock` renders send full-precision colour (clamped to valid bytes, not quantised) --
 * `render.py` owns RGB444 quantisation as part of rendering (Contract A), so the server's
 * returned frames are the authority on what the LEDs will show, not this request. Pixel-editor
 * tools that write canvas data directly (`rasterize.ts`, `flood-fill.ts`) quantise immediately
 * instead, since that data IS the design, with no server render step in between. Blank text is
 * rejected (`null`) instead of sent -- there is nothing for the device to show, and the
 * alternative is an upload that round-trips to an empty program.
 *
 * Text is drawn to pixel frames on the server and played like any animation, so `speed` is the
 * playback speed (0-100, whole numbers) and Original is "no speed key". The server refuses anything
 * above 100 (the old 0-255 text speed is gone), so out-of-range values are clamped here. */
export function buildTextRenderSpec(text: string, color: RGB, options: TextRenderOptions = {}): RenderSpec | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const spec: RenderSpec = { type: "text", text: trimmed, color: clampRgb(color) };
  if (options.font) spec.font = options.font;
  if (options.effect) spec.effect = options.effect;
  if (options.bold !== undefined) spec.bold = options.bold;
  if (typeof options.speed === "number" && Number.isFinite(options.speed)) spec.speed = Math.max(0, Math.min(MAX_TEXT_SPEED, Math.round(options.speed)));
  if (options.smooth === "on" || options.smooth === "off") spec.smooth = options.smooth;
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
