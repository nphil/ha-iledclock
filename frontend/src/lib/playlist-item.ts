/** Pure helpers for one playlist row in the studio's playlist editor: what a `{kind, params,
 * duration_s}` item MEANS to a person (a short sentence-case description), which MDI glyph names
 * it, and the sensible default `params` an "Add" control appends for a freshly chosen kind.
 * Kept out of the component so the descriptions are unit-testable without a DOM, and so the
 * required-`params`-per-kind contract stays in one place -- it mirrors the integration's own
 * `playlist.py` `_REQUIRED_PARAMS` (clock needs `style`+`color`, date `color`, text `text`,
 * design `design_id`, timer `mode`; scoreboard/temperature/humidity render the clock's own live
 * values and need nothing).
 */

import type { PlaylistItem, PlaylistItemKind, StoredDesign } from "../types.ts";
import { CLOCK_COLORS, CLOCK_FACES } from "./clock-faces.ts";
import { rgbToHex, type RGB } from "./color.ts";
import type { MdiIconName } from "./mdi-icons.ts";

/** What a freshly added item starts at. The integration's `const.py` ships the same default
 * (`DEFAULT_PLAYLIST_DURATION_S = 10`); ws-api.ts exports only the min/max bounds, so the default
 * lives here, next to the other per-kind defaults it is appended alongside. */
export const DEFAULT_PLAYLIST_ITEM_DURATION_S = 10;

function assertNeverKind(kind: never): never {
  throw new Error(`unknown playlist kind: ${String(kind)}`);
}

/** Sentence-case label for a kind -- every kind string is already a single plain word, so this
 * is just a capital first letter, never an ALL-CAPS chip. */
export function playlistKindLabel(kind: PlaylistItemKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** The glyph each row leads with. `date` reuses `clock`: the bundled MDI set has no calendar
 * glyph and a date program is the clock's own chronological cousin; a design row upgrades to
 * `gif` when its resolved `StoredDesign` is an animation, since the library already knows. */
export function playlistItemIcon(item: PlaylistItem, designs: readonly StoredDesign[] = []): MdiIconName {
  switch (item.kind) {
    case "clock":
    case "date":
      return "clock";
    case "text":
      return "text";
    case "design": {
      const design = designs.find((candidate) => candidate.id === item.params.design_id);
      return design?.kind === "animation" ? "gif" : "image";
    }
    case "timer":
      return item.params.mode === "stopwatch" ? "stopwatch" : "countdown";
    case "scoreboard":
      return "scoreboard";
    case "temperature":
      return "thermometer";
    case "humidity":
      return "humidity";
    default:
      return assertNeverKind(item.kind);
  }
}

/** Reads a `params.color` that is a 3-number RGB tuple (how `buildClockRenderSpec` sends colours)
 * and names it from the device's own 8 base colours when it matches one exactly, else shows the
 * hex so a custom colour is still legible rather than silently mislabelled. */
function describeColorParam(params: Record<string, unknown>): string | null {
  const color = params.color;
  if (!Array.isArray(color) || color.length !== 3 || color.some((channel) => typeof channel !== "number")) return null;
  const rgb: RGB = [color[0] as number, color[1] as number, color[2] as number];
  const hex = rgbToHex(rgb);
  const named = CLOCK_COLORS.find((entry) => rgbToHex(entry.rgb) === hex);
  return named ? named.label.toLowerCase() : hex;
}

/** One short sentence-case description of an item's `params`, per kind -- the second line of a
 * playlist row. Missing or malformed params degrade to a shorter honest phrase ("Custom colour",
 * the raw text, "No design chosen") rather than throwing: a row must always render something,
 * even for a stale item the device no longer fully understands. */
export function describePlaylistItem(item: PlaylistItem, designs: readonly StoredDesign[] = []): string {
  switch (item.kind) {
    case "clock": {
      const style = typeof item.params.style === "number" ? item.params.style : null;
      const face = style === null ? null : CLOCK_FACES.find((entry) => entry.style === style);
      const color = describeColorParam(item.params);
      const parts = [face ? face.label : "Custom face", color ?? "custom colour"];
      if (item.params.h24 === false) parts.push("12-hour");
      return parts.join(", ");
    }
    case "date":
      return describeColorParam(item.params) ?? "Custom colour";
    case "text": {
      const text = typeof item.params.text === "string" ? item.params.text.trim() : "";
      if (text.length === 0) return "No text yet";
      const effect = typeof item.params.effect === "string" && item.params.effect.trim() !== "" ? item.params.effect : null;
      return effect ? `“${text}”, ${effect.toLowerCase()}` : `“${text}”`;
    }
    case "design": {
      const design = designs.find((candidate) => candidate.id === item.params.design_id);
      return design ? design.name : "No design chosen";
    }
    case "timer":
      return item.params.mode === "stopwatch" ? "Stopwatch" : "Countdown";
    case "scoreboard":
      return "Live scores";
    case "temperature":
      return "Live reading";
    case "humidity":
      return "Live reading";
    default:
      return assertNeverKind(item.kind);
  }
}

/** The `params` a freshly added item of `kind` starts with: exactly the keys the integration's
 * `playlist.py` requires for that kind, at the friendliest default value (first face, white, the
 * first design in the library when there is one). */
export function defaultPlaylistItemParams(kind: PlaylistItemKind, designs: readonly StoredDesign[] = []): Record<string, unknown> {
  switch (kind) {
    case "clock":
      return { style: CLOCK_FACES[0]!.style, color: [...CLOCK_COLORS[6]!.rgb] };
    case "date":
      return { color: [...CLOCK_COLORS[6]!.rgb] };
    case "text":
      return { text: "Hello" };
    case "design":
      return { design_id: designs[0]?.id ?? "" };
    case "timer":
      return { mode: "countdown" };
    case "scoreboard":
    case "temperature":
    case "humidity":
      return {};
    default:
      return assertNeverKind(kind);
  }
}

/** Builds the whole default item an "Add" control appends for a chosen kind. */
export function createPlaylistItem(kind: PlaylistItemKind, designs: readonly StoredDesign[] = []): PlaylistItem {
  return { kind, params: defaultPlaylistItemParams(kind, designs), duration_s: DEFAULT_PLAYLIST_ITEM_DURATION_S };
}
