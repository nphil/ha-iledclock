/** The text program's 28 colour modes (`getDataWithTextAutoColorProgramContent`, modes 1-28:
 * rainbow, fade, per-character and transition variants -- ARCHITECTURE.md's feature catalogue).
 * Like the clock faces, the decompiled sources have no recovered per-mode names beyond the
 * broad categories FEATURES-app.md lists, so modes outside those named few are labelled by
 * number -- every mode is genuinely selectable and sends the exact firmware index.
 */

const NAMED_TEXT_EFFECTS: Readonly<Record<number, string>> = {
  1: "Solid",
  2: "Rainbow",
  3: "Fade",
  4: "Per-letter rainbow",
  5: "Per-letter fade",
};

export const TEXT_EFFECT_COUNT = 28;
export const TEXT_EFFECTS: ReadonlyArray<{ mode: number; label: string }> = Array.from({ length: TEXT_EFFECT_COUNT }, (_, i) => {
  const mode = i + 1;
  return { mode, label: NAMED_TEXT_EFFECTS[mode] ?? `Effect ${mode}` };
});
