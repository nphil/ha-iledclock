/** RGB444 quantisation, byte-identical to the vendor app's TWO distinct per-channel encoders
 * (see `custom_components/iledclock/hardware.py`, the byte-graded port from decompiled vendor
 * source, confirmed against `render.py`'s `quantize()`/`Canvas.to_rgb444()`): a CURVED table
 * (`TextEmojiManagerCoolLEDUX.rgb444Transfer`) for `solid`/`text_custom`/`graffiti`/`animation`
 * content, and a plain LINEAR `v // 16` truncating division for native `clock`/`date`/
 * `timecount`/`scoreboard`/`temperature`/`humidity` content -- which curve a given colour goes
 * through is fixed by content type, not configurable (`hardware.py`'s `ContentPath`). Every
 * preview in this app must pick the curve matching what it's actually previewing: the pixel
 * editor's own drawing tools (flood-fill, rasterize) are always CURVED (graffiti), while a
 * clock-face colour swatch is always LINEAR (clock) -- see each call site's own comment for its
 * path. The clock's wire format is 4 bits per channel (0-15); `expandChannel` maps a nibble
 * back to 0-255 for on-screen preview only (`nibble * 17`, i.e. `n | (n << 4)`), evenly spanning
 * the full 8-bit range -- this expansion never crosses the wire, it only exists so a browser
 * canvas can paint the colour the LED will actually emit. IMPORTANT: quantise-then-expand is
 * NOT idempotent under re-application (re-running an already-expanded value back through either
 * curve does not generally reproduce it -- e.g. curved nibble 1 expands to 17, which curve-
 * quantises straight back to 0) -- callers must quantise raw/full-precision colour exactly
 * once per pixel and never re-quantise already-expanded preview data (see
 * `iledclock-matrix-canvas.ts`, which trusts its input and does not re-quantise at all).
 */

export type RGB = readonly [number, number, number];

/** One channel (0-255) -> one 4-bit nibble (0-15), CURVED path. Thresholds and the floor
 * division are exactly `rgb444Transfer`: >=238 saturates to 15, <=47 floors to 0, the 190-wide
 * middle band splits into 14-wide steps. Used for `solid`/`text_custom`/`graffiti`/`animation`
 * content -- i.e. anything the pixel editor draws or a colour picker sets on uploaded/hand-
 * drawn art -- per `hardware.py`'s `CURVED_PATHS`. */
export function quantizeChannel(value: number): number {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  if (v >= 238) return 15;
  if (v <= 47) return 0;
  return Math.floor((v - 47) / 14) + 1;
}

/** One channel (0-255) -> one 4-bit nibble (0-15), LINEAR path: plain truncating division by
 * 16, matching Java's `Color.red(i) / 16` integer division exactly. Used for native
 * `clock`/`date`/`timecount`/`scoreboard`/`temperature`/`humidity` content's own solid-colour
 * fields (hourColor, minuteColor, scoreHostColor, ...) per `hardware.py`'s `LINEAR_PATHS` --
 * NOT the same curve as `quantizeChannel`, and re-using the wrong one distorts the preview
 * (see `hardware.py`'s `encode_channel`/`displayed_rgb`). */
export function quantizeChannelLinear(value: number): number {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  return Math.min(15, Math.floor(v / 16));
}

/** Content paths a colour can be quantised for, mirroring `hardware.py`'s `ContentPath`
 * exactly (minus `"text_auto"`, which has no per-pixel RGB888 to quantise -- its 28 modes are
 * pre-baked nibble tables, see `text-effects.ts`). */
export type ContentPath = "solid" | "text_custom" | "graffiti" | "animation" | "clock" | "date" | "timecount" | "scoreboard" | "temperature" | "humidity";

/** Content paths that quantise each channel through the curved `rgb444Transfer` table. */
export const CURVED_PATHS: ReadonlySet<ContentPath> = new Set(["solid", "text_custom", "graffiti", "animation"]);

/** Content paths that quantise each channel by plain truncating division by 16. */
export const LINEAR_PATHS: ReadonlySet<ContentPath> = new Set(["clock", "date", "timecount", "scoreboard", "temperature", "humidity"]);

/** One RGB888 channel value -> the 4-bit nibble the wire protocol carries for `path`, dispatching
 * to whichever curve `path` uses. Mirrors `hardware.py`'s `encode_channel` exactly. */
export function encodeChannel(value: number, path: ContentPath): number {
  return CURVED_PATHS.has(path) ? quantizeChannel(value) : quantizeChannelLinear(value);
}

/** Nibble (0-15) -> 0-255 preview value, evenly spaced (0, 17, 34, ..., 255). Shared by both
 * curves: the wire nibble is the same 4-bit range either way, only how a raw channel maps down
 * to that nibble differs (curved vs. linear). */
export function expandChannel(nibble: number): number {
  const n = Math.max(0, Math.min(15, Math.round(nibble)));
  return n * 17;
}

/** Per-channel quantise to the device's 4-bit nibbles, CURVED path -- what actually goes over
 * the wire for `solid`/`text_custom`/`graffiti`/`animation` content. */
export function quantizeRgb444(rgb: RGB): readonly [number, number, number] {
  return [quantizeChannel(rgb[0]), quantizeChannel(rgb[1]), quantizeChannel(rgb[2])];
}

/** Per-channel quantise to the device's 4-bit nibbles, LINEAR path -- what actually goes over
 * the wire for native `clock`/`date`/`timecount`/`scoreboard`/`temperature`/`humidity` content. */
export function quantizeRgb444Linear(rgb: RGB): readonly [number, number, number] {
  return [quantizeChannelLinear(rgb[0]), quantizeChannelLinear(rgb[1]), quantizeChannelLinear(rgb[2])];
}

/** Full round-trip: quantise (CURVED) then re-expand, so a canvas can paint exactly what the
 * LED matrix would show for this colour on `solid`/`text_custom`/`graffiti`/`animation`
 * content -- the pixel editor's own drawing tools (flood-fill, rasterize) use this. */
export function quantizePreviewRgb(rgb: RGB): RGB {
  const [r, g, b] = quantizeRgb444(rgb);
  return [expandChannel(r), expandChannel(g), expandChannel(b)];
}

/** Full round-trip: quantise (LINEAR) then re-expand, for native `clock`/`date`/`timecount`/
 * `scoreboard`/`temperature`/`humidity` content -- e.g. a clock-face colour swatch previewing
 * what that field's colour will actually look like on the device. */
export function quantizePreviewRgbLinear(rgb: RGB): RGB {
  const [r, g, b] = quantizeRgb444Linear(rgb);
  return [expandChannel(r), expandChannel(g), expandChannel(b)];
}

/** The RGB888 colour that will actually be shown on the LEDs for `path`, i.e. `rgb` round-
 * tripped through the device's real 4-bit-per-channel quantisation, dispatching to whichever
 * curve `path` uses. Mirrors `hardware.py`'s `displayed_rgb` exactly -- prefer this over the
 * fixed-curve `quantizePreviewRgb`/`quantizePreviewRgbLinear` when the content path is only
 * known dynamically (e.g. a generic preview helper fed a path string). */
export function displayedRgb(rgb: RGB, path: ContentPath): RGB {
  return CURVED_PATHS.has(path) ? quantizePreviewRgb(rgb) : quantizePreviewRgbLinear(rgb);
}

/** Clamps and rounds a colour to valid 0-255 bytes without quantising -- for a value handed to
 * the server as full-precision intent (a `RenderSpec`'s `color`), where `render.py` owns
 * quantisation as part of rendering (Contract A); pixel-editor tools that write canvas data
 * directly use `quantizePreviewRgb` instead, since that data IS the achievable-colour design. */
export function clampRgb(rgb: RGB): RGB {
  const clampChannel = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return [clampChannel(rgb[0]), clampChannel(rgb[1]), clampChannel(rgb[2])];
}

export function rgbToCss(rgb: RGB): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export function rgbToHex(rgb: RGB): string {
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`;
}

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return [0, 0, 0];
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

/** Relative luminance (sRGB, ITU-R BT.601 weights) -- used to decide ink colour on a swatch and
 * to pick a readable label colour over an arbitrary pixel colour. */
export function luminance(rgb: RGB): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

export function readableInk(rgb: RGB): "#000000" | "#ffffff" {
  return luminance(rgb) > 140 ? "#000000" : "#ffffff";
}
