/** The server-side generative animation kinds (`render.py`'s `generative(kind, seconds, seed,
 * palette)`, Contract A) the studio's "generative presets" picker offers. Purely a menu -- the
 * actual pixels come back from `iledclock/render {type:"generative", kind, seconds, seed}`, this
 * project never reimplements fire/plasma/life in the browser.
 */

export interface GenerativePreset {
  kind: string;
  label: string;
  hint: string;
}

export const GENERATIVE_PRESETS: readonly GenerativePreset[] = [
  { kind: "life", label: "Life", hint: "Conway's game of life, seeded randomly" },
  { kind: "fire", label: "Fire", hint: "A rising flame simulation" },
  { kind: "plasma", label: "Plasma", hint: "Smooth shifting colour fields" },
  { kind: "matrix", label: "Matrix rain", hint: "Falling green code" },
  { kind: "starfield", label: "Starfield", hint: "Stars drifting past" },
  { kind: "rainbow", label: "Rainbow", hint: "A cycling rainbow sweep" },
  { kind: "sparkle", label: "Sparkle", hint: "Random twinkling pixels" },
];
