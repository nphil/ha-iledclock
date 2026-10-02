/** The harness's stand-in for the server's `iledclock/render {type:"text"}`: real 5x7 letters, the same rules as
 * `protocol.render.text_frames` (text that fits 32 columns is one centred frame; longer text is a marquee that enters
 * from the right and leaves on the left in whole-pixel steps, never more than 40 frames, at about 24 pixels a second),
 * `bold` thickens every letter by a column, effect 2 is a rainbow across the text and 4 a rainbow colour per letter,
 * every other effect is solid. Speed and smooth go through the same `retime` the playback preview uses.
 *
 * The font is a plain upper-case ASCII table (lower case draws as capitals), enough to read what was typed. It is a
 * harness approximation, not the clock's own font: the real server draws the real glyphs. */

import { createFrame, GRID_HEIGHT, GRID_WIDTH, setPixelMut, type PixelFrame } from "../src/lib/grid.ts";
import { quantizePreviewRgb, type RGB } from "../src/lib/color.ts";
import { frameToBase64 } from "../src/lib/design-codec.ts";
import type { RenderResult, SmoothSetting } from "../src/types.ts";
import { retime } from "./retime.ts";

export const MOCK_TEXT_MAX_FRAMES = 40;
const SCROLL_PX_PER_S = 24;
const GAP_PX = 6;
const TOP = 4;

/** Five column bitmasks per glyph, bit 0 = top row. */
const FONT: Readonly<Record<string, readonly number[]>> = {
  " ": [0x00, 0x00, 0x00, 0x00, 0x00],
  "!": [0x00, 0x00, 0x5f, 0x00, 0x00],
  '"': [0x00, 0x07, 0x00, 0x07, 0x00],
  "#": [0x14, 0x7f, 0x14, 0x7f, 0x14],
  "%": [0x23, 0x13, 0x08, 0x64, 0x62],
  "&": [0x36, 0x49, 0x55, 0x22, 0x50],
  "'": [0x00, 0x05, 0x03, 0x00, 0x00],
  "(": [0x00, 0x1c, 0x22, 0x41, 0x00],
  ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
  "*": [0x14, 0x08, 0x3e, 0x08, 0x14],
  "+": [0x08, 0x08, 0x3e, 0x08, 0x08],
  ",": [0x00, 0x50, 0x30, 0x00, 0x00],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08],
  ".": [0x00, 0x60, 0x60, 0x00, 0x00],
  "/": [0x20, 0x10, 0x08, 0x04, 0x02],
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
  "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46],
  "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10],
  "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30],
  "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36],
  "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  ":": [0x00, 0x36, 0x36, 0x00, 0x00],
  "?": [0x02, 0x01, 0x51, 0x09, 0x06],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
};
const UNKNOWN = [0x7f, 0x41, 0x41, 0x41, 0x7f];

/** One column of the text strip: which of the 7 rows are lit and which letter it belongs to. */
interface Column {
  mask: number;
  letter: number;
}

function glyphColumns(char: string, bold: boolean): number[] {
  const glyph = FONT[char.toUpperCase()] ?? UNKNOWN;
  if (!bold) return [...glyph];
  // Bold: every lit column also lights the column to its right.
  const wide: number[] = [];
  glyph.forEach((mask, index) => {
    wide[index] = (wide[index] ?? 0) | mask;
    wide[index + 1] = (wide[index + 1] ?? 0) | mask;
  });
  return wide;
}

function strip(text: string, bold: boolean): Column[] {
  const columns: Column[] = [];
  let letter = 0;
  for (const char of text) {
    for (const mask of glyphColumns(char, bold)) columns.push({ mask, letter });
    columns.push({ mask: 0, letter });
    letter += 1;
  }
  columns.pop();
  return columns;
}

function hue(fraction: number): RGB {
  const h = (((fraction % 1) + 1) % 1) * 6;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function columnColor(column: Column, index: number, count: number, letters: number, color: RGB, effect: string): RGB {
  if (effect === "2") return hue(index / Math.max(1, count));
  if (effect === "4") return hue(column.letter / Math.max(1, letters));
  return color;
}

export interface MockTextSpec {
  text: string;
  color: readonly number[];
  effect?: string;
  bold?: boolean;
  speed?: number | null;
  smooth?: SmoothSetting;
}

/** The frames at Original pace: one centred frame, or a marquee. */
export function renderTextFrames(spec: MockTextSpec): PixelFrame[] {
  const columns = strip(spec.text, Boolean(spec.bold));
  const effect = String(spec.effect ?? "1");
  const color: RGB = [Number(spec.color[0] ?? 255), Number(spec.color[1] ?? 255), Number(spec.color[2] ?? 255)];
  const letters = [...spec.text].length;
  const draw = (offset: number, durationMs: number): PixelFrame => {
    const frame = createFrame(GRID_WIDTH, GRID_HEIGHT, [0, 0, 0], durationMs);
    columns.forEach((column, index) => {
      const x = offset + index;
      if (x < 0 || x >= GRID_WIDTH || column.mask === 0) return;
      const rgb = quantizePreviewRgb(columnColor(column, index, columns.length, letters, color, effect));
      for (let row = 0; row < 7; row++) if (column.mask & (1 << row)) setPixelMut(frame, x, TOP + row, rgb);
    });
    return frame;
  };
  if (columns.length <= GRID_WIDTH) return [draw(Math.floor((GRID_WIDTH - columns.length) / 2), 1000)];
  const travel = GRID_WIDTH + columns.length + GAP_PX;
  const step = Math.ceil(travel / MOCK_TEXT_MAX_FRAMES);
  const durationMs = Math.round((step * 1000) / SCROLL_PX_PER_S);
  const frames: PixelFrame[] = [];
  for (let moved = 0; moved < travel; moved += step) frames.push(draw(GRID_WIDTH - moved, durationMs));
  return frames;
}

/** `iledclock/render {type:"text"}`: the frames above, retimed when a speed or smooth setting came with the request. */
export async function renderTextSpec(spec: MockTextSpec): Promise<RenderResult> {
  const frames = renderTextFrames(spec);
  const encoded = frames.map(frameToBase64);
  const delays = frames.map((frame) => frame.durationMs);
  const hasPlayback = (spec.speed !== undefined && spec.speed !== null) || (spec.smooth !== undefined && spec.smooth !== null);
  if (!hasPlayback) return { frames: encoded, delays };
  const retimed = await retime({ type: "iledclock/playback/preview", frames: encoded, delays, clock_region: null, speed: spec.speed ?? null, smooth: spec.smooth ?? null });
  return { frames: retimed.frames, delays: retimed.delays };
}
