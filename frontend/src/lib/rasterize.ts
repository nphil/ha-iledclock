/** Shape rasterisers for the pixel editor's line/rect/ellipse tools. Each clones the frame once
 * and plots every touched pixel onto that clone, so a multi-hundred-pixel shape stays linear
 * instead of the quadratic cost of `setPixel`-per-point (each call cloning again).
 *
 * `quantize` defaults to `quantizePreviewRgb` (the CURVED path, correct for the pixel editor's
 * own graffiti content, these functions' only real-component caller). A caller drawing a
 * different content path's shape (e.g. the dev harness mocking a native clock-face preview)
 * passes `quantizePreviewRgbLinear` explicitly instead -- never pre-quantise `color` yourself
 * and rely on the default: quantise-then-expand is not idempotent (see `color.ts`'s module
 * doc), so pre-quantising with one curve and then letting this apply another (or the same one
 * again) silently corrupts the colour. */

import { quantizePreviewRgb, type RGB } from "./color.ts";
import { cloneFrame, type PixelFrame, setPixelMut } from "./grid.ts";

/** Bresenham's line algorithm -- the same integer-only midpoint stepping every pixel-art tool
 * uses, so a diagonal line looks like a *drawn* line (single-pixel steps) rather than a
 * `Math.round`-per-x staircase with occasional doubled pixels. */
export function plotLine(frame: PixelFrame, x0: number, y0: number, x1: number, y1: number, color: RGB, quantize: (rgb: RGB) => RGB = quantizePreviewRgb): PixelFrame {
  const next = cloneFrame(frame);
  const rgb = quantize(color);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPixelMut(next, x, y, rgb);
    if (x === x1 && y === y1) break;
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y += sy;
    }
  }
  return next;
}

export function plotRect(frame: PixelFrame, x0: number, y0: number, x1: number, y1: number, color: RGB, filled: boolean, quantize: (rgb: RGB) => RGB = quantizePreviewRgb): PixelFrame {
  const next = cloneFrame(frame);
  const rgb = quantize(color);
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (filled || y === top || y === bottom || x === left || x === right) setPixelMut(next, x, y, rgb);
    }
  }
  return next;
}

/** Midpoint ellipse, bounded by the `(x0,y0)`-`(x1,y1)` box (the drag rectangle the tool tracks
 * live) -- four-way symmetric stepping around one quadrant, same family of algorithm as
 * `plotLine`'s Bresenham stepping so both tools produce the same single-pixel-wide, no-gap
 * outline style. `filled` scans each traced row between its two symmetric x offsets. */
export function plotEllipse(frame: PixelFrame, x0: number, y0: number, x1: number, y1: number, color: RGB, filled: boolean, quantize: (rgb: RGB) => RGB = quantizePreviewRgb): PixelFrame {
  const next = cloneFrame(frame);
  const rgb = quantize(color);
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;

  if (rx < 0.5 || ry < 0.5) {
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) setPixelMut(next, x, y, rgb);
    return next;
  }

  const plotQuadrantRow = (dy: number) => {
    // x^2/rx^2 + y^2/ry^2 = 1  =>  x = rx * sqrt(1 - (y/ry)^2), evaluated once per scanline so
    // filled and outline modes share one boundary computation per row.
    const t = 1 - (dy * dy) / (ry * ry);
    return t <= 0 ? 0 : rx * Math.sqrt(t);
  };

  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    const dx = plotQuadrantRow(dy);
    const y = Math.round(cy + dy);
    const xRight = Math.round(cx + dx);
    const xLeft = Math.round(cx - dx);
    if (filled) {
      for (let x = xLeft; x <= xRight; x++) setPixelMut(next, x, y, rgb);
    } else {
      setPixelMut(next, xLeft, y, rgb);
      setPixelMut(next, xRight, y, rgb);
    }
  }
  if (!filled) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      const t = 1 - (dx * dx) / (rx * rx);
      const dy = t <= 0 ? 0 : ry * Math.sqrt(t);
      const x = Math.round(cx + dx);
      setPixelMut(next, x, Math.round(cy + dy), rgb);
      setPixelMut(next, x, Math.round(cy - dy), rgb);
    }
  }
  return next;
}
