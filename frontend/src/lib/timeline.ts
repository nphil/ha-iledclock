/** Frame-timeline operations for the studio's animation strip. A design always retains at least
 * one frame and never grows beyond the upload-safe 64-frame editor limit. */

import { cloneFrame, createFrame, type PixelFrame } from "./grid.ts";

export const DEFAULT_FRAME_DELAY_MS = 100;
export const MIN_FRAME_DELAY_MS = 10;
export const MAX_FRAME_DELAY_MS = 60000;
export const MAX_FRAME_COUNT = 64;

export function clampFrameDelay(delayMs: number): number {
  return Math.max(MIN_FRAME_DELAY_MS, Math.min(MAX_FRAME_DELAY_MS, Math.round(delayMs)));
}

/** Inserts a blank frame (or a clone of `source`) after `afterIndex`; `-1` inserts at the front. */
export function insertFrame(frames: readonly PixelFrame[], afterIndex: number, source?: PixelFrame): PixelFrame[] {
  if (frames.length >= MAX_FRAME_COUNT) return frames.slice();
  const frame = source ? cloneFrame(source) : createFrame(frames[0]?.width, frames[0]?.height, [0, 0, 0], DEFAULT_FRAME_DELAY_MS);
  const at = Math.max(-1, Math.min(frames.length - 1, afterIndex)) + 1;
  const next = frames.slice();
  next.splice(at, 0, frame);
  return next;
}

export function duplicateFrame(frames: readonly PixelFrame[], index: number): PixelFrame[] {
  const source = frames[index];
  if (!source || frames.length >= MAX_FRAME_COUNT) return frames.slice();
  return insertFrame(frames, index, source);
}

/** Refuses to drop the timeline's last frame. */
export function deleteFrame(frames: readonly PixelFrame[], index: number): PixelFrame[] {
  if (frames.length <= 1 || index < 0 || index >= frames.length) return frames.slice();
  const next = frames.slice();
  next.splice(index, 1);
  return next;
}

export function reorderFrame(frames: readonly PixelFrame[], fromIndex: number, toIndex: number): PixelFrame[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= frames.length || toIndex < 0 || toIndex >= frames.length) return frames.slice();
  const next = frames.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}

export function setFrameDelay(frames: readonly PixelFrame[], index: number, delayMs: number): PixelFrame[] {
  const frame = frames[index];
  if (!frame) return frames.slice();
  const next = frames.slice();
  next[index] = { ...frame, durationMs: clampFrameDelay(delayMs) };
  return next;
}

export function totalDurationMs(frames: readonly PixelFrame[]): number {
  return frames.reduce((sum, frame) => sum + frame.durationMs, 0);
}
