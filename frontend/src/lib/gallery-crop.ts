/** Pure crop-box geometry for the import sheet's draggable crop rectangle over a raw source
 * image, always expressed in SOURCE-IMAGE pixel space -- exactly the `{x,y,w,h}` shape
 * `adapt.py`'s power-user `crop` override takes (GALLERY.md: "explicit crop {x,y,w,h} in source
 * pixels"), so the value a drag produces is exactly the value sent over the wire with no separate
 * "screen box" to reconcile before saving. `screenDeltaToImageDelta` is the one function that
 * crosses from CSS pixels (two `getBoundingClientRect()` reads, or a pointer's movement) into
 * that space; everything else operates purely on source-pixel rectangles.
 */

export interface CropBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The 8 standard crop-handle positions, corners first (a component iterates this to render drag
 * handles without hand-listing all 8 itself). */
export const ALL_CROP_HANDLES = ["nw", "ne", "se", "sw", "n", "e", "s", "w"] as const;
export type CropHandle = (typeof ALL_CROP_HANDLES)[number];

const MIN_CROP_SIZE = 1;

/** Clamps a box to fully lie within a `width`x`height` image, rounding to integer source pixels
 * (crop coordinates are pixel indices, never fractional) and never shrinking below
 * `MIN_CROP_SIZE` even given a degenerate input box. Used for MOVING an existing box (and for
 * seeding the initial centred box) -- it preserves `w`/`h` as given (only shrinking them if
 * larger than the image itself) and repositions `x`/`y` to fit; `resizeCropBox` below handles the
 * different "one edge moved, the opposite edge is anchored" case a resize handle needs. */
export function clampCropBox(box: CropBox, imageWidth: number, imageHeight: number): CropBox {
  const boundW = Math.max(MIN_CROP_SIZE, Math.round(imageWidth));
  const boundH = Math.max(MIN_CROP_SIZE, Math.round(imageHeight));
  const w = Math.max(MIN_CROP_SIZE, Math.min(Math.round(box.w), boundW));
  const h = Math.max(MIN_CROP_SIZE, Math.min(Math.round(box.h), boundH));
  const x = Math.max(0, Math.min(Math.round(box.x), boundW - w));
  const y = Math.max(0, Math.min(Math.round(box.y), boundH - h));
  return { x, y, w, h };
}

/** The largest box of `aspectW:aspectH` (the clock's own 32:16 by default) centred in the image
 * -- the crop box's starting position before the user drags anything. */
export function centeredCropBox(imageWidth: number, imageHeight: number, aspectW = 2, aspectH = 1): CropBox {
  const targetRatio = aspectW / aspectH;
  const imageRatio = imageWidth / Math.max(1, imageHeight);
  let w: number;
  let h: number;
  if (imageRatio > targetRatio) {
    h = imageHeight;
    w = h * targetRatio;
  } else {
    w = imageWidth;
    h = w / targetRatio;
  }
  return clampCropBox({ x: (imageWidth - w) / 2, y: (imageHeight - h) / 2, w, h }, imageWidth, imageHeight);
}

/** Converts a pointer movement in on-screen CSS pixels (over an `<img>` rendered at
 * `renderedWidth`x`renderedHeight`) into the same movement in source-image pixels, accounting for
 * the image being scaled up or down from its natural size for display. A zero-size rendered box
 * (not yet laid out) is treated as scale 1 rather than dividing by zero. */
export function screenDeltaToImageDelta(
  dxCss: number,
  dyCss: number,
  renderedWidth: number,
  renderedHeight: number,
  imageWidth: number,
  imageHeight: number,
): { dx: number; dy: number } {
  const scaleX = renderedWidth > 0 ? imageWidth / renderedWidth : 1;
  const scaleY = renderedHeight > 0 ? imageHeight / renderedHeight : 1;
  return { dx: dxCss * scaleX, dy: dyCss * scaleY };
}

/** Translates the box by an image-space delta, clamped so it never leaves the image -- dragging
 * from inside the box (as opposed to a resize handle) moves it without changing its size. */
export function moveCropBox(box: CropBox, dx: number, dy: number, imageWidth: number, imageHeight: number): CropBox {
  return clampCropBox({ ...box, x: box.x + dx, y: box.y + dy }, imageWidth, imageHeight);
}

/** Drags one handle of the box by an image-space delta. Each edge the handle touches moves that
 * edge only, clamped to the image bounds and to never cross the opposite edge (which stays fixed)
 * below `MIN_CROP_SIZE` -- the corner/edge-handle behaviour of every standard crop tool. Because a
 * `CropHandle` never names both `n`/`s` or both `e`/`w`, the four edges below are each touched by
 * at most one of the `if`s, so they can be computed independently in any order. */
export function resizeCropBox(box: CropBox, handle: CropHandle, dx: number, dy: number, imageWidth: number, imageHeight: number): CropBox {
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  const boundW = Math.max(MIN_CROP_SIZE, imageWidth);
  const boundH = Math.max(MIN_CROP_SIZE, imageHeight);
  if (handle.includes("w")) left = clampNumber(left + dx, 0, right - MIN_CROP_SIZE);
  if (handle.includes("e")) right = clampNumber(right + dx, left + MIN_CROP_SIZE, boundW);
  if (handle.includes("n")) top = clampNumber(top + dy, 0, bottom - MIN_CROP_SIZE);
  if (handle.includes("s")) bottom = clampNumber(bottom + dy, top + MIN_CROP_SIZE, boundH);
  return { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
