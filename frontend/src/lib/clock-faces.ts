/** Built-in 32x16 firmware faces, styles 1-41 -- all 41 are real, selectable styles (style 36
 * shares its digit geometry with 37 but has its own glyph font and background asset; it is
 * not a gap in the vendor's own style range). Pure metadata only: rendering a style's preview
 * (real vendor digit glyphs + real background) is server-side (`iledclock/render`,
 * `protocol.render.clock_face_frames`) -- this module used to also carry a client-side
 * approximate-font renderer, which overlapped/garbled on tight styles (24-27's 4x5 digits). */
const CLOCK_STYLE_IDS = Array.from({ length: 41 }, (_, i) => i + 1);

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
