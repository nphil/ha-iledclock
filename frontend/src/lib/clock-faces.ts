/** The clock's 41 built-in face styles and 8 base colours (`ILedClockClockTimeActivity`,
 * `getDataWithClockCombineProgram`, styles 1-41, colours 0-7 -- ARCHITECTURE.md's feature
 * catalogue). The decompiled sources have no recovered per-style names (they're firmware-side
 * rendered, not app strings), so the face picker labels each by number -- an honest label, not a
 * placeholder: every style is genuinely selectable and sends the exact firmware index.
 */

export const CLOCK_FACE_COUNT = 41;
export const CLOCK_FACES: ReadonlyArray<{ style: number; label: string }> = Array.from({ length: CLOCK_FACE_COUNT }, (_, i) => ({
  style: i + 1,
  label: `Face ${i + 1}`,
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
