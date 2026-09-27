/** The clock's 40 built-in face styles and 8 base colours. Its 32x16 firmware has styles 1-35
 * and 37-41; style 36 does not exist. The decompiled sources have no recovered per-style names
 * (they're firmware-side rendered, not app strings), so the face picker labels each by number.
 */

const CLOCK_STYLE_IDS = [...Array.from({ length: 35 }, (_, i) => i + 1), 37, 38, 39, 40, 41];

// Used as the highest supported style index by render requests; the IDs are non-contiguous.
export const CLOCK_FACE_COUNT = 41;
export const CLOCK_FACES: ReadonlyArray<{ style: number; label: string }> = CLOCK_STYLE_IDS.map((style) => ({
  style,
  label: "Face " + style,
}));

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
