/** Integer-pitch sizing for every LED preview surface. A pitch is one CSS pixel per LED. */
export type LedPreviewContext = "hero" | "editor" | "tile" | "thumb";

export interface LedSizeOptions {
  maxPitch?: number;
  zoom?: number;
  artWidth?: number;
  artHeight?: number;
}

export interface LedSize {
  pitch: number;
  width: number;
  height: number;
}

const MATRIX_WIDTH = 32;
const MATRIX_HEIGHT = 16;

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampPitch(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/** Return exact integer dimensions for a preview. availableHeight is the height left after
 * surrounding controls/chrome, not the full screen height. */
export function ledSizeFor(context: LedPreviewContext, availableWidth: number, availableHeight: number, options: LedSizeOptions = {}): LedSize {
  const width = positive(availableWidth, 32);
  const height = positive(availableHeight, width / 2);
  const maxOverride = options.maxPitch === undefined ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(options.maxPitch));
  let pitch: number;
  let outputWidth = MATRIX_WIDTH;
  let outputHeight = MATRIX_HEIGHT;

  switch (context) {
    case "hero": {
      const fitted = Math.floor(Math.min(width / MATRIX_WIDTH, height / MATRIX_HEIGHT));
      pitch = clampPitch(fitted, 6, Math.min(12, maxOverride));
      break;
    }
    case "editor": {
      const fitted = Math.floor(Math.min(width / MATRIX_WIDTH, height / MATRIX_HEIGHT));
      const zoom = Number.isFinite(options.zoom) && options.zoom! > 0 ? options.zoom! : 1;
      const maximum = Math.min(zoom > 1 ? 40 : 22, maxOverride);
      const base = clampPitch(fitted, 8, Math.min(22, maxOverride));
      pitch = zoom > 1 ? clampPitch(base * zoom, 8, maximum) : base;
      break;
    }
    case "tile": {
      outputWidth = positive(options.artWidth ?? MATRIX_WIDTH, MATRIX_WIDTH);
      outputHeight = positive(options.artHeight ?? MATRIX_HEIGHT, MATRIX_HEIGHT);
      pitch = Math.max(1, Math.floor(Math.min(width / outputWidth, height / outputHeight)));
      if (Number.isFinite(maxOverride)) pitch = Math.min(pitch, maxOverride);
      break;
    }
    case "thumb": {
      const fitted = Math.floor(Math.min(width / MATRIX_WIDTH, height / MATRIX_HEIGHT));
      pitch = clampPitch(fitted, 2, Math.min(3, maxOverride));
      break;
    }
  }

  return { pitch, width: outputWidth * pitch, height: outputHeight * pitch };
}
