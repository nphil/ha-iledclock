/** Pure speed/smooth-motion maths and copy for the Speed slider. No DOM, no Lit: every number and
 * sentence the control shows comes from here so it can be unit-tested and so the browser preview
 * agrees with the Python side (`custom_components/iledclock/retime.py`; the curve is pinned for
 * both by `tests/fixtures/playback-curve.json`).
 *
 * Vocabulary: a slider *position* runs 0..100. 0 is Still (one poster frame, no pace). 1..100 map
 * onto a pace in *authored* frames a second on a log curve from 0.5 fps to the fastest the clock
 * can play. `null` is Original: the animation's authored delays, untouched. The "Original" tick sits
 * on the slider where the authored pace falls on that same curve.
 */

import type { PlaybackInfo, SmoothSetting, StoredDesign } from "../types.ts";

/** Milliseconds per device delay unit. */
export const UNIT_MS = 1.5;
/** The clock cannot hold a frame for fewer than this many units. */
export const MIN_FRAME_UNITS = 7;
/** Fastest pace in authored frames a second: 1000 / (7 * 1.5) = 95.238. Shown as "Max". */
export const PACE_MAX_FPS = 1000 / (MIN_FRAME_UNITS * UNIT_MS);
/** Slowest pace on the slider (position 1). */
export const PACE_MIN_FPS = 0.5;
/** The preview never redraws faster than this, however fast the clock plays. */
export const PREVIEW_MAX_FPS = 60;
/** Dragging within this many positions of Original snaps to Original. */
export const ORIGINAL_SNAP = 3;
/** Positions at or below this snap to Still while dragging. */
export const STILL_SNAP = 1;
/** Slider position from which the strobing caution shows. */
export const STROBE_WARNING_SPEED = 90;

const LN_RATIO = Math.log(PACE_MIN_FPS / PACE_MAX_FPS);

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Authored frames a second at slider position `speed` (1..100); 0 for Still (no pace). */
export function paceForSpeed(speed: number): number {
  if (!(speed > 0)) return 0;
  const s = Math.min(100, speed);
  return PACE_MAX_FPS * Math.exp(LN_RATIO * (1 - s / 100));
}

/** Inverse of `paceForSpeed`, clamped to 0..100. */
export function speedForPace(paceFps: number): number {
  if (!(paceFps > 0)) return 0;
  return clamp(100 * (1 - Math.log(paceFps / PACE_MAX_FPS) / LN_RATIO), 0, 100);
}

/** Authored frames a second as drawn: frames / total hold time. 0 for an empty list. */
export function nativeFps(delaysMs: readonly number[]): number {
  let total = 0;
  for (const delay of delaysMs) total += delay;
  return delaysMs.length > 0 && total > 0 ? (delaysMs.length * 1000) / total : 0;
}

/** Slider position (1..100) where the Original pace sits. */
export function originalSpeed(nativeFpsValue: number): number {
  return clamp(speedForPace(nativeFpsValue), 1, 100);
}

/** Soft snap while dragging: a raw position within 3 of Original becomes `null` (Original), one at
 * or below 1 becomes 0 (Still), anything else is rounded to a whole percent. Still wins a tie. */
export function snapSpeed(raw: number, originalPosition: number): number | null {
  if (raw <= STILL_SNAP) return 0;
  if (Math.abs(raw - originalPosition) <= ORIGINAL_SNAP) return null;
  return clamp(Math.round(raw), 0, 100);
}

export type SpeedKey = "ArrowLeft" | "ArrowDown" | "ArrowRight" | "ArrowUp" | "PageDown" | "PageUp" | "Home" | "End";

export function isSpeedKey(key: string): key is SpeedKey {
  return key === "ArrowLeft" || key === "ArrowDown" || key === "ArrowRight" || key === "ArrowUp" || key === "PageDown" || key === "PageUp" || key === "Home" || key === "End";
}

/** Keyboard rules: arrows +-1, Page keys +-10, Home = Still, End = Max. Stepping snaps like a drag
 * (so you can land on Original), but it can always LEAVE Original (a step of +-4 from it) and
 * always climb off Still. */
export function steppedSpeed(current: number | null, key: SpeedKey, originalPosition: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return 100;
  const up = key === "ArrowRight" || key === "ArrowUp" || key === "PageUp";
  const page = key === "PageUp" || key === "PageDown";
  const fromOriginal = current === null;
  const step = page ? 10 : fromOriginal ? ORIGINAL_SNAP + 1 : 1;
  const base = current ?? originalPosition;
  let next = clamp(Math.round(base + (up ? step : -step)), 0, 100);
  if (up && current === 0) next = Math.max(next, 2);
  if (fromOriginal) return next <= STILL_SNAP ? 0 : next;
  return snapSpeed(next, originalPosition);
}

/** What the value readout shows: Still, Original, Max, or a whole percent. */
export function speedLabel(speed: number | null): string {
  if (speed === null) return "Original";
  if (speed <= 0) return "Still";
  if (speed >= 100) return "Max";
  return `${Math.round(speed)}%`;
}

/** The pace this setting plays at, in authored frames a second (0 when Still). */
export function targetPace(speed: number | null, nativeFpsValue: number): number {
  return speed === null ? nativeFpsValue : paceForSpeed(speed);
}

/** Seconds one loop of `authoredFrames` takes on the clock; Infinity when it never advances. */
export function loopSeconds(speed: number | null, authoredFrames: number, nativeFpsValue: number): number {
  const pace = targetPace(speed, nativeFpsValue);
  return pace > 0 ? authoredFrames / pace : Infinity;
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** "0.13 s", "1.7 s", "12 s": two decimals under a second, one under ten, whole seconds beyond. The space
 * before "s" is a no-break space so a narrow caption never leaves a lone "s" on the next line. */
export function formatLoop(seconds: number): string {
  if (!Number.isFinite(seconds)) return "never";
  if (seconds < 1) return `${trimZeros(seconds.toFixed(2))}\u00a0s`;
  if (seconds < 10) return `${trimZeros(seconds.toFixed(1))}\u00a0s`;
  return `${Math.round(seconds)}\u00a0s`;
}

/** "7 frames a second", "1 frame a second", "1 frame every 2 s" (no leading "about"). */
export function paceWords(paceFps: number): string {
  if (paceFps < 1) return `1 frame every ${Math.max(2, Math.round(1 / paceFps))}\u00a0s`;
  const rounded = Math.round(paceFps);
  return rounded === 1 ? "1 frame a second" : `${rounded} frames a second`;
}

/** The line under the slider. `authoredFrames`/`nativeFpsValue` describe the animation itself. */
export function paceCaption(speed: number | null, authoredFrames: number, nativeFpsValue: number): string {
  if (speed !== null && speed <= 0) return "One still picture - the fullest frame";
  const pace = targetPace(speed, nativeFpsValue);
  if (!(pace > 0)) return "";
  const text = `About ${paceWords(pace)} \u00b7 loops every ${formatLoop(loopSeconds(speed, authoredFrames, nativeFpsValue))}`;
  return pace > PREVIEW_MAX_FPS ? `${text} (the preview shows up to ${PREVIEW_MAX_FPS})` : text;
}

/** True when the strobing caution should show. Still is never fast. */
export function showStrobeCaution(speed: number | null): boolean {
  return speed !== null && speed >= STROBE_WARNING_SPEED;
}

/** `aria-valuetext` for the range input: "34 percent, about 3 frames a second". */
export function speedValueText(speed: number | null, authoredFrames: number, nativeFpsValue: number): string {
  if (speed !== null && speed <= 0) return "Still, one picture";
  const pace = targetPace(speed, nativeFpsValue);
  const name = speed === null ? "Original" : speed >= 100 ? "Max" : `${Math.round(speed)} percent`;
  return pace > 0 ? `${name}, about ${paceWords(pace)}` : name;
}

/** `loop 6.5 s` for a rotation row, computed locally from the stored delays and speed. Empty for a
 * single picture; `still` when the design is set to Still. */
export function designLoopCaption(design: Pick<StoredDesign, "delays" | "frames" | "speed">): string {
  const frameCount = design.frames.length;
  if (frameCount <= 1) return "";
  const speed = design.speed ?? null;
  if (speed !== null && speed <= 0) return "still";
  const seconds = loopSeconds(speed, frameCount, nativeFps(design.delays));
  return Number.isFinite(seconds) ? `loop ${formatLoop(seconds)}` : "";
}

/** The `speed`/`smooth` keys a "now showing" descriptor carries when a service call overrode the
 * stored choice. Only keys that are present are returned, so an absent key keeps the design's own. */
export function descriptorPlayback(descriptor: Record<string, unknown>): { speed?: number | null; smooth?: SmoothSetting } {
  const out: { speed?: number | null; smooth?: SmoothSetting } = {};
  if ("speed" in descriptor && (descriptor.speed === null || typeof descriptor.speed === "number")) out.speed = descriptor.speed;
  if ("smooth" in descriptor && (descriptor.smooth === null || descriptor.smooth === "on" || descriptor.smooth === "off")) out.smooth = descriptor.smooth;
  return out;
}

export interface SmoothDescription {
  /** The status line under the Smooth motion switch. */
  text: string;
  /** Nothing slides or fades, so the switch cannot do anything. */
  disabled: boolean;
  /** The switch position: on unless the setting is "off". */
  checked: boolean;
}

/** Status line for the Smooth motion row. The `smooth` setting decides on/off; `info` supplies what
 * the server found and did. No info yet means the first check is still running. */
export function describeSmooth(info: PlaybackInfo | null | undefined, smooth: SmoothSetting): SmoothDescription {
  const checked = smooth !== "off";
  if (!info) return { text: "Checking the animation...", disabled: false, checked };
  const detail = info.smooth;
  if (!detail.available || detail.state === "unavailable") {
    const text = detail.slides > 0 ? "Already moving one pixel at a time, so there's nothing to smooth." : "Nothing slides or fades here, so there's nothing to smooth.";
    return { text, disabled: true, checked };
  }
  if (!checked) return { text: "Off. The clock steps straight from picture to picture.", disabled: false, checked };
  if (detail.state === "applied") {
    const count = info.added_frames;
    const noun = count === 1 ? "in-between frame" : "in-between frames";
    const text = `Added ${count} ${noun} (${info.frames} total)` + (detail.sharp > 0 ? "; blinks stay sharp" : "") + (detail.capped ? " - limited to 40 frames" : "");
    return { text, disabled: false, checked };
  }
  if (detail.state === "none") return { text: "On, but this speed doesn't need in-between frames.", disabled: false, checked };
  return { text: "On. In-between frames are added when you slow it down.", disabled: false, checked };
}

/** How fast the preview should run the frames it already has to look like `speed`:
 * target pace / the pace of the loaded frames. 0 for Still (the host shows the poster instead). */
export function previewRate(speed: number | null, loadedPaceFps: number, nativeFpsValue: number): number {
  if (speed !== null && speed <= 0) return 0;
  const target = targetPace(speed, nativeFpsValue);
  if (!(target > 0) || !(loadedPaceFps > 0)) return 1;
  return target / loadedPaceFps;
}
