/** The text program's 28 colour modes; the firmware indexes are sent unchanged. */
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
  return { mode, label: NAMED_TEXT_EFFECTS[mode] ?? "Effect " + mode };
});

export function isTextEffectMode(mode: number): boolean {
  return Number.isInteger(mode) && mode >= 1 && mode <= TEXT_EFFECT_COUNT;
}
