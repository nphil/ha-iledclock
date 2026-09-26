/** Pure animation-clock logic: given a frame list (each with its own `durationMs`) and how long
 * playback has been running, which frame is showing right now? Kept separate from the canvas
 * component that actually draws a frame -- the hero mirror, the studio's loop preview and a
 * library thumbnail all drive the same single-frame renderer from this one clock, looping
 * automatically once the last frame's own hold time elapses.
 */

import type { PixelFrame } from "./grid.ts";

/** Index into `frames` showing at `elapsedMs` into a looping playback, using each frame's own
 * `durationMs` as its hold time. A single-frame (still image) design always returns 0 without
 * bothering to compute a cycle. Zero or negative durations are floored to 1ms so a malformed
 * frame can never stall the cycle at a divide-by-zero. */
export function frameIndexAtTime(frames: readonly PixelFrame[], elapsedMs: number): number {
  if (frames.length <= 1) return 0;
  const total = frames.reduce((sum, frame) => sum + Math.max(1, frame.durationMs), 0);
  let remainder = ((elapsedMs % total) + total) % total;
  for (let i = 0; i < frames.length; i++) {
    const duration = Math.max(1, frames[i]!.durationMs);
    if (remainder < duration) return i;
    remainder -= duration;
  }
  return frames.length - 1;
}
