/** Built-in 32×16 firmware faces. Style 36 is absent in the vendor's 32×16 table. */
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
  return "Face " + style;
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
