/** The 32x16 RGB888 pixel frame: the one shared data shape every studio tool, the timeline, the
 * design codec and the card's hero canvas all read and write. Every mutator below returns a NEW
 * frame (clones then edits the clone) rather than mutating in place -- the studio's undo stack
 * (`undo-stack.ts`) just keeps frame references, and a component re-render is a plain identity
 * check, not a deep comparison.
 */

import type { RGB } from "./color.ts";

export const GRID_WIDTH = 32;
export const GRID_HEIGHT = 16;
/** Bytes per frame on the wire and in `StoredDesign.frames` -- 32*16*3, confirmed with the
 * Integration agent as Contract D's design/render payload shape. */
export const FRAME_BYTES = GRID_WIDTH * GRID_HEIGHT * 3;

export interface PixelFrame {
  readonly width: number;
  readonly height: number;
  /** Row-major RGB888, top-to-bottom then left-to-right within a row: pixel (x, y) starts at
   * byte `(y * width + x) * 3`, matching `ILedClockUtils`'s own row-major pixel order. */
  readonly pixels: Uint8Array;
  readonly durationMs: number;
}

export function createFrame(width = GRID_WIDTH, height = GRID_HEIGHT, fill: RGB = [0, 0, 0], durationMs = 100): PixelFrame {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = fill[0];
    pixels[i + 1] = fill[1];
    pixels[i + 2] = fill[2];
  }
  return { width, height, pixels, durationMs };
}

export function cloneFrame(frame: PixelFrame, durationMs = frame.durationMs): PixelFrame {
  return { width: frame.width, height: frame.height, pixels: frame.pixels.slice(), durationMs };
}

export function inBounds(frame: PixelFrame, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < frame.width && y < frame.height;
}

export function getPixel(frame: PixelFrame, x: number, y: number): RGB {
  if (!inBounds(frame, x, y)) return [0, 0, 0];
  const i = (y * frame.width + x) * 3;
  return [frame.pixels[i]!, frame.pixels[i + 1]!, frame.pixels[i + 2]!];
}

/** Sets one pixel on a clone of `frame` and returns it, leaving `frame` untouched -- the base
 * every other tool (fill, line, rect, ellipse) composes by clone-once-then-plot-many, since
 * cloning per pixel would be quadratic on a multi-hundred-pixel stroke. Callers that plot many
 * pixels should clone once and mutate that clone's `pixels` array directly instead of calling
 * this per pixel; `setPixelMut` below is that primitive. */
export function setPixel(frame: PixelFrame, x: number, y: number, color: RGB): PixelFrame {
  const next = cloneFrame(frame);
  setPixelMut(next, x, y, color);
  return next;
}

/** In-place write, out-of-bounds a no-op -- used internally by every multi-pixel tool
 * (`flood-fill.ts`, `rasterize.ts`) against a clone it already owns. Never exported for callers
 * to mutate a frame someone else might be holding a reference to (e.g. mid-render, or on the
 * undo stack); those call sites go through `setPixel` or a tool function that clones first. */
export function setPixelMut(frame: PixelFrame, x: number, y: number, color: RGB): void {
  if (!inBounds(frame, x, y)) return;
  const i = (y * frame.width + x) * 3;
  frame.pixels[i] = color[0];
  frame.pixels[i + 1] = color[1];
  frame.pixels[i + 2] = color[2];
}

export function framesEqual(a: PixelFrame, b: PixelFrame): boolean {
  if (a.width !== b.width || a.height !== b.height || a.durationMs !== b.durationMs) return false;
  if (a.pixels.length !== b.pixels.length) return false;
  for (let i = 0; i < a.pixels.length; i++) {
    if (a.pixels[i] !== b.pixels[i]) return false;
  }
  return true;
}

/** Shifts every pixel by `(dx, dy)`; `wrap` carries pixels around to the opposite edge (the
 * studio's "wrap" mode for a scrolling marquee), otherwise vacated cells fill with `fillColor`
 * (default transparent-as-black) and pixels pushed off an edge are dropped. */
export function shiftFrame(frame: PixelFrame, dx: number, dy: number, wrap: boolean, fillColor: RGB = [0, 0, 0]): PixelFrame {
  const next = createFrame(frame.width, frame.height, fillColor, frame.durationMs);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      let sx = x - dx;
      let sy = y - dy;
      if (wrap) {
        sx = ((sx % frame.width) + frame.width) % frame.width;
        sy = ((sy % frame.height) + frame.height) % frame.height;
      } else if (!inBounds(frame, sx, sy)) {
        continue;
      }
      setPixelMut(next, x, y, getPixel(frame, sx, sy));
    }
  }
  return next;
}

export function mirrorFrame(frame: PixelFrame, axis: "horizontal" | "vertical"): PixelFrame {
  const next = cloneFrame(frame);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const source = axis === "horizontal" ? getPixel(frame, frame.width - 1 - x, y) : getPixel(frame, x, frame.height - 1 - y);
      setPixelMut(next, x, y, source);
    }
  }
  return next;
}
