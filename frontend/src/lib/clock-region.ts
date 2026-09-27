import type { StoredDesign } from "../types.ts";
import { GRID_HEIGHT, GRID_WIDTH, cloneFrame, getPixel, mirrorFrame, setPixelMut, type PixelFrame } from "./grid.ts";

export const CLOCK_REGION_TAG = "with_clock";

export function clockRegionForDesign(enabled: boolean): StoredDesign["clock_region"] {
  return enabled ? { x: GRID_WIDTH / 2, y: 0, w: GRID_WIDTH / 2, h: GRID_HEIGHT } : null;
}

export function designHasClockRegion(design: Pick<StoredDesign, "clock_region" | "tags">): boolean {
  return design.clock_region != null || (design.tags?.some((tag) => tag === CLOCK_REGION_TAG || tag === "with-clock" || tag === "clock_region") ?? false);
}

export function editableWidth(frameWidth: number, reserveRightHalf: boolean): number {
  return reserveRightHalf ? Math.floor(frameWidth / 2) : frameWidth;
}

export function isEditablePixel(x: number, frameWidth: number, reserveRightHalf: boolean): boolean {
  return x >= 0 && x < editableWidth(frameWidth, reserveRightHalf);
}
export function moveEditableCell(cell: { x: number; y: number }, delta: { x: number; y: number }, frameWidth: number, frameHeight: number, reserveRightHalf: boolean): { x: number; y: number } {
  const width = Math.max(1, editableWidth(frameWidth, reserveRightHalf));
  return {
    x: Math.max(0, Math.min(width - 1, cell.x + delta.x)),
    y: Math.max(0, Math.min(frameHeight - 1, cell.y + delta.y)),
  };
}
export function mirrorEditableFrame(frame: PixelFrame, axis: "horizontal" | "vertical", reserveRightHalf: boolean): PixelFrame {
  if (!reserveRightHalf) return mirrorFrame(frame, axis);
  const width = editableWidth(frame.width, true);
  const next = cloneFrame(frame);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < width; x++) {
    const sourceX = axis === "horizontal" ? width - 1 - x : x;
    const sourceY = axis === "vertical" ? frame.height - 1 - y : y;
    setPixelMut(next, x, y, getPixel(frame, sourceX, sourceY));
  }
  return next;
}

export function preserveClockRegionPixels(original: PixelFrame, candidate: PixelFrame, reserveRightHalf: boolean): PixelFrame {
  if (!reserveRightHalf || candidate === original) return candidate;
  const width = editableWidth(original.width, true);
  for (let y = 0; y < original.height; y++) for (let x = width; x < original.width; x++) {
    setPixelMut(candidate, x, y, getPixel(original, x, y));
  }
  return candidate;
}
