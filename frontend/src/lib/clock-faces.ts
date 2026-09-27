import { createFrame, setPixelMut, type PixelFrame } from "./grid.ts";

/** Built-in 32×16 firmware faces. Style 36 is absent from the vendor geometry table. */
const CLOCK_STYLE_IDS = [...Array.from({ length: 35 }, (_, i) => i + 1), 37, 38, 39, 40, 41];

export const CLOCK_FACE_COUNT = 41;
export const CLOCK_FACE_STYLE_IDS: ReadonlyArray<number> = CLOCK_STYLE_IDS;
export const CLOCK_FACES: ReadonlyArray<{ style: number; label: string }> = CLOCK_STYLE_IDS.map((style) => ({
  style,
  label: clockFaceLabel(style),
}));

export function isClockFaceStyle(style: number): boolean {
  return Number.isInteger(style) && CLOCK_STYLE_IDS.includes(style);
}

export function clockFaceLabel(style: number): string {
  return "Style " + style;
}
// Generated from custom_components/iledclock/clock_styles.py, the vendor's per-style 32x16 geometry.
type ClockRect = readonly [number, number, number, number];
interface ClockFaceGeometry {
  digitWidth: number;
  digitHeight: number;
  blinkColon: boolean;
  showAmpm: boolean;
  showSpaceMinute: boolean;
  hour: ClockRect;
  spaceHour: ClockRect;
  minute: ClockRect;
  spaceMinute: ClockRect | null;
  seconds: ClockRect | null;
}

const CLOCK_FACE_GEOMETRY: Readonly<Record<number, ClockFaceGeometry>> = {
  1: { digitWidth: 7, digitHeight: 12, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 0, 14, 12], spaceHour: [15, 0, 2, 12], minute: [18, 0, 14, 12], spaceMinute: null, seconds: null },
  2: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 3, 14, 10], spaceHour: [15, 3, 2, 10], minute: [18, 3, 14, 10], spaceMinute: null, seconds: null },
  3: { digitWidth: 6, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [3, 3, 12, 10], spaceHour: [15, 3, 1, 10], minute: [17, 3, 12, 10], spaceMinute: null, seconds: null },
  4: { digitWidth: 8, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 4, 16, 10], spaceHour: [15, 4, 2, 10], minute: [18, 4, 16, 10], spaceMinute: null, seconds: null },
  5: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 6, 14, 10], spaceHour: [15, 6, 2, 10], minute: [18, 6, 14, 10], spaceMinute: null, seconds: null },
  6: { digitWidth: 6, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [0, 0, 12, 10], spaceHour: [12, 0, 1, 10], minute: [14, 0, 12, 10], spaceMinute: null, seconds: null },
  7: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: false, showSpaceMinute: true, hour: [1, 0, 14, 10], spaceHour: [15, 0, 2, 10], minute: [18, 0, 14, 10], spaceMinute: null, seconds: null },
  8: { digitWidth: 7, digitHeight: 12, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 2, 14, 12], spaceHour: [15, 2, 2, 12], minute: [18, 2, 14, 12], spaceMinute: null, seconds: null },
  9: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [0, 0, 14, 10], spaceHour: [15, 0, 2, 10], minute: [19, 0, 14, 10], spaceMinute: null, seconds: null },
  10: { digitWidth: 6, digitHeight: 5, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 9, 12, 5], spaceHour: [15, 9, 2, 5], minute: [20, 9, 12, 5], spaceMinute: null, seconds: null },
  11: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 0, 14, 10], spaceHour: [15, 0, 2, 10], minute: [18, 0, 14, 10], spaceMinute: null, seconds: null },
  12: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 5, 14, 10], spaceHour: [15, 5, 2, 10], minute: [18, 5, 14, 10], spaceMinute: null, seconds: null },
  13: { digitWidth: 7, digitHeight: 11, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 2, 14, 11], spaceHour: [15, 2, 1, 11], minute: [17, 2, 14, 11], spaceMinute: null, seconds: null },
  14: { digitWidth: 6, digitHeight: 7, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 0, 12, 7], spaceHour: [13, 4, 1, 7], minute: [1, 9, 12, 7], spaceMinute: null, seconds: null },
  15: { digitWidth: 6, digitHeight: 7, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [4, 0, 12, 7], spaceHour: [2, 9, 1, 7], minute: [4, 9, 12, 7], spaceMinute: null, seconds: null },
  16: { digitWidth: 6, digitHeight: 7, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [19, 0, 12, 7], spaceHour: [17, 9, 1, 7], minute: [19, 9, 12, 7], spaceMinute: null, seconds: null },
  17: { digitWidth: 6, digitHeight: 7, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [20, 0, 12, 7], spaceHour: [18, 4, 1, 7], minute: [20, 9, 12, 7], spaceMinute: null, seconds: null },
  18: { digitWidth: 6, digitHeight: 7, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [21, 0, 12, 7], spaceHour: [19, 4, 1, 7], minute: [21, 9, 12, 7], spaceMinute: null, seconds: null },
  19: { digitWidth: 6, digitHeight: 7, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [20, 1, 12, 7], spaceHour: [18, 9, 1, 7], minute: [20, 9, 12, 7], spaceMinute: null, seconds: null },
  20: { digitWidth: 5, digitHeight: 7, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [10, 1, 10, 7], spaceHour: [20, 1, 1, 7], minute: [22, 1, 10, 7], spaceMinute: null, seconds: null },
  21: { digitWidth: 5, digitHeight: 7, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [0, 0, 10, 7], spaceHour: [10, 0, 1, 7], minute: [12, 0, 10, 7], spaceMinute: null, seconds: null },
  22: { digitWidth: 4, digitHeight: 5, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [14, 1, 8, 5], spaceHour: [22, 1, 1, 5], minute: [24, 1, 8, 5], spaceMinute: null, seconds: null },
  23: { digitWidth: 4, digitHeight: 5, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [2, 9, 8, 5], spaceHour: [10, 9, 1, 5], minute: [12, 9, 8, 5], spaceMinute: null, seconds: null },
  24: { digitWidth: 4, digitHeight: 5, blinkColon: false, showAmpm: true, showSpaceMinute: true, hour: [2, 5, 8, 5], spaceHour: [10, 5, 1, 5], minute: [12, 5, 8, 5], spaceMinute: [20, 5, 1, 5], seconds: [22, 5, 8, 5] },
  25: { digitWidth: 4, digitHeight: 5, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [14, 1, 8, 5], spaceHour: [22, 1, 1, 5], minute: [24, 1, 8, 5], spaceMinute: null, seconds: null },
  26: { digitWidth: 4, digitHeight: 5, blinkColon: false, showAmpm: true, showSpaceMinute: true, hour: [3, 1, 8, 5], spaceHour: [11, 1, 1, 5], minute: [13, 1, 8, 5], spaceMinute: [21, 1, 1, 5], seconds: [23, 1, 8, 5] },
  27: { digitWidth: 4, digitHeight: 5, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [2, 2, 8, 5], spaceHour: [10, 2, 1, 5], minute: [12, 2, 8, 5], spaceMinute: null, seconds: null },
  28: { digitWidth: 7, digitHeight: 14, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 1, 14, 14], spaceHour: [15, 1, 2, 14], minute: [18, 1, 14, 14], spaceMinute: null, seconds: null },
  29: { digitWidth: 7, digitHeight: 12, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 4, 14, 12], spaceHour: [15, 4, 2, 12], minute: [18, 4, 14, 12], spaceMinute: null, seconds: null },
  30: { digitWidth: 6, digitHeight: 9, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [3, 5, 12, 9], spaceHour: [15, 5, 1, 9], minute: [17, 5, 12, 9], spaceMinute: null, seconds: null },
  31: { digitWidth: 7, digitHeight: 12, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 2, 14, 12], spaceHour: [15, 2, 2, 12], minute: [18, 2, 14, 12], spaceMinute: null, seconds: null },
  32: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 0, 14, 10], spaceHour: [15, 0, 2, 10], minute: [18, 0, 14, 10], spaceMinute: null, seconds: null },
  33: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 3, 14, 10], spaceHour: [15, 3, 2, 10], minute: [18, 3, 14, 10], spaceMinute: null, seconds: null },
  34: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 6, 14, 10], spaceHour: [15, 6, 2, 10], minute: [18, 6, 14, 10], spaceMinute: null, seconds: null },
  35: { digitWidth: 7, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [1, 3, 14, 10], spaceHour: [15, 3, 2, 10], minute: [18, 3, 14, 10], spaceMinute: null, seconds: null },
  37: { digitWidth: 7, digitHeight: 12, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [0, 2, 14, 12], spaceHour: [15, 2, 2, 12], minute: [19, 2, 14, 12], spaceMinute: null, seconds: null },
  38: { digitWidth: 7, digitHeight: 13, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [0, 2, 14, 13], spaceHour: [15, 2, 2, 13], minute: [19, 2, 14, 13], spaceMinute: null, seconds: null },
  39: { digitWidth: 7, digitHeight: 14, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [0, 1, 14, 14], spaceHour: [15, 1, 2, 14], minute: [19, 1, 14, 14], spaceMinute: null, seconds: null },
  40: { digitWidth: 6, digitHeight: 7, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [21, 0, 12, 7], spaceHour: [19, 9, 1, 7], minute: [21, 9, 12, 7], spaceMinute: null, seconds: null },
  41: { digitWidth: 6, digitHeight: 10, blinkColon: true, showAmpm: true, showSpaceMinute: false, hour: [3, 6, 12, 10], spaceHour: [15, 6, 2, 10], minute: [18, 6, 12, 10], spaceMinute: null, seconds: null },
};

const DIGITS = [
  ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
] as const;

const previewCache = new Map<string, PixelFrame[]>();

function drawNumber(frame: PixelFrame, rect: ClockRect, value: string, digitWidth: number, color: readonly [number, number, number]): void {
  const [left, top, , height] = rect;
  for (let digitIndex = 0; digitIndex < 2; digitIndex++) {
    const glyph = DIGITS[Number(value[digitIndex] ?? "0")]!;
    const x0 = left + digitIndex * digitWidth;
    for (let y = 0; y < height; y++) {
      const sourceY = Math.min(6, Math.floor(y * 7 / height));
      for (let x = 0; x < digitWidth; x++) {
        const sourceX = Math.min(4, Math.floor(x * 5 / digitWidth));
        if (glyph[sourceY]![sourceX] === "1") setPixelMut(frame, x0 + x, top + y, color);
      }
    }
  }
}

function drawColon(frame: PixelFrame, rect: ClockRect, color: readonly [number, number, number]): void {
  const [left, top, width, height] = rect;
  const x = left + Math.floor((width - 1) / 2);
  setPixelMut(frame, x, top + Math.floor(height / 3), color);
  setPixelMut(frame, x, top + Math.floor((2 * height) / 3), color);
}

/** Client preview of the firmware's clock layout, using its style-specific digit regions. */
export function clockFacePreviewFrames(style: number, color: readonly [number, number, number], hours24: boolean): PixelFrame[] {
  const resolvedStyle = CLOCK_FACE_GEOMETRY[style] ? style : 1;
  const key = [resolvedStyle, color.join(","), hours24 ? "24" : "12"].join("|");
  const cached = previewCache.get(key);
  if (cached) return cached;

  const geometry = CLOCK_FACE_GEOMETRY[resolvedStyle]!;
  const frame = createFrame();
  drawNumber(frame, geometry.hour, hours24 ? "13" : "01", geometry.digitWidth, color);
  drawColon(frame, geometry.spaceHour, color);
  drawNumber(frame, geometry.minute, "34", geometry.digitWidth, color);
  if (geometry.showSpaceMinute && geometry.spaceMinute) drawColon(frame, geometry.spaceMinute, color);
  if (geometry.seconds) drawNumber(frame, geometry.seconds, "56", geometry.digitWidth, color);

  const frames = [frame];
  if (previewCache.size >= 256) previewCache.delete(previewCache.keys().next().value!);
  previewCache.set(key, frames);
  return frames;
}

export const CLOCK_COLORS: ReadonlyArray<{ index: number; label: string; rgb: readonly [number, number, number] }> = [
  { index: 0, label: "Red", rgb: [255, 0, 0] },
  { index: 1, label: "Magenta", rgb: [255, 0, 255] },
  { index: 2, label: "Yellow", rgb: [255, 255, 0] },
  { index: 3, label: "Green", rgb: [0, 255, 0] },
  { index: 4, label: "Cyan", rgb: [0, 255, 255] },
  { index: 5, label: "Blue", rgb: [0, 0, 255] },
  { index: 6, label: "White", rgb: [255, 255, 255] },
  { index: 7, label: "Black", rgb: [0, 0, 0] },
];
