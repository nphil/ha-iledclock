/** The colour effects Pixel Studio offers for text. Text is drawn to pixel frames on the server and
 * played like any animation, so only three colour modes exist: 1 solid, 2 rainbow across the text,
 * 4 a different rainbow colour per letter. Every other mode number (the old firmware list went to 28)
 * draws solid, so they are not offered. `usesColor` is false for the rainbow modes: they ignore the
 * colour picker, and the panel says so instead of leaving a dead control. */
export const TEXT_EFFECTS: ReadonlyArray<{ mode: number; label: string; usesColor: boolean }> = [
  { mode: 1, label: "Solid", usesColor: true },
  { mode: 2, label: "Rainbow", usesColor: false },
  { mode: 4, label: "Per-letter rainbow", usesColor: false },
];

export const DEFAULT_TEXT_EFFECT = 1;

/** Whether the picked colour matters for this effect mode (anything unknown draws solid, so it does). */
export function textEffectUsesColor(mode: number): boolean {
  return TEXT_EFFECTS.find((effect) => effect.mode === mode)?.usesColor ?? true;
}
