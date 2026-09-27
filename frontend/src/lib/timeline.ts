/** Frame-timeline operations for the studio's animation strip: add/duplicate/delete/reorder and
 * per-frame delay. Every op returns a new array (the list itself becomes one `historyPush`
 * snapshot) and every op that could empty the timeline refuses instead -- a design always has at
 * least one frame, the same invariant the wire format assumes (`StoredDesign.frames` is never
 * empty).
 */

import { cloneFrame, createFrame, type PixelFrame } from "./grid.ts";

export const DEFAULT_FRAME_DELAY_MS = 100;
export const MIN_FRAME_DELAY_MS = 10;
export const MAX_FRAME_DELAY_MS = 60000;

export function clampFrameDelay(delayMs: number): number {
  return Math.max(MIN_FRAME_DELAY_MS, Math.min(MAX_FRAME_DELAY_MS, Math.round(delayMs)));
}

/** Inserts a new blank frame (or `source`, cloned) after `afterIndex` (`-1` inserts at the
 * front). `afterIndex` out of range clamps to the nearest valid position rather than throwing,
 * so a stale toolbar click (the frame it pointed at was just deleted by another handler in the
 * same tick) still lands somewhere sane. */
export function insertFrame(frames: readonly PixelFrame[], afterIndex: number, source?: PixelFrame): PixelFrame[] {
  const frame = source ? cloneFrame(source) : createFrame(frames[0]?.width, frames[0]?.height, [0, 0, 0], DEFAULT_FRAME_DELAY_MS);
  const at = Math.max(-1, Math.min(frames.length - 1, afterIndex)) + 1;
  const next = frames.slice();
  next.splice(at, 0, frame);
  return next;
}

export function duplicateFrame(frames: readonly PixelFrame[], index: number): PixelFrame[] {
  const source = frames[index];
  if (!source) return frames.slice();
  return insertFrame(frames, index, source);
}

/** Refuses to drop the timeline's last frame -- `frames` stays non-empty so every consumer
 * (the codec, the preview player) never has to special-case zero frames. */
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

/** Total playback time for the loop preview / upload progress estimate. */
export function totalDurationMs(frames: readonly PixelFrame[]): number {
  return frames.reduce((sum, frame) => sum + frame.durationMs, 0);
}
