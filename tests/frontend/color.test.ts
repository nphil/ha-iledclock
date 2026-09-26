import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CURVED_PATHS,
  displayedRgb,
  encodeChannel,
  expandChannel,
  hexToRgb,
  LINEAR_PATHS,
  luminance,
  quantizeChannel,
  quantizeChannelLinear,
  quantizePreviewRgb,
  quantizePreviewRgbLinear,
  quantizeRgb444,
  quantizeRgb444Linear,
  readableInk,
  rgbToHex,
  type ContentPath,
} from "../../frontend/src/lib/color.ts";

test("quantizeChannel matches the vendor rgb444Transfer thresholds exactly", () => {
  // TextEmojiManagerCoolLEDUX.rgb444Transfer(i): i>=238 -> 15; i<=47 -> 0; else (i-47)/14 + 1
  // (confirmed with the Protocol agent against render.py's quantize()).
  assert.equal(quantizeChannel(0), 0);
  assert.equal(quantizeChannel(47), 0);
  assert.equal(quantizeChannel(48), 1);
  assert.equal(quantizeChannel(60), 1);
  assert.equal(quantizeChannel(61), 2);
  assert.equal(quantizeChannel(237), 14);
  assert.equal(quantizeChannel(238), 15);
  assert.equal(quantizeChannel(255), 15);
});

test("quantizeChannel is monotonic non-decreasing across the full byte range", () => {
  let previous = quantizeChannel(0);
  for (let v = 1; v <= 255; v++) {
    const current = quantizeChannel(v);
    assert.ok(current >= previous, `value ${v} produced a lower nibble than ${v - 1}`);
    assert.ok(current >= 0 && current <= 15);
    previous = current;
  }
});

test("quantizeChannel clamps out-of-range and rounds fractional input", () => {
  assert.equal(quantizeChannel(-10), 0);
  assert.equal(quantizeChannel(300), 15);
  assert.equal(quantizeChannel(47.6), 1); // rounds to 48 first
});

test("quantizeChannelLinear is a plain truncating divide by 16, not the curved table", () => {
  assert.equal(quantizeChannelLinear(0), 0);
  assert.equal(quantizeChannelLinear(15), 0);
  assert.equal(quantizeChannelLinear(16), 1);
  assert.equal(quantizeChannelLinear(127), 7);
  assert.equal(quantizeChannelLinear(128), 8);
  assert.equal(quantizeChannelLinear(255), 15);
  // At v=60 the two curves diverge (curved=1, linear=3) -- the whole reason a path matters.
  assert.equal(quantizeChannel(60), 1);
  assert.equal(quantizeChannelLinear(60), 3);
});

test("quantizeChannelLinear clamps out-of-range and rounds fractional input", () => {
  assert.equal(quantizeChannelLinear(-10), 0);
  assert.equal(quantizeChannelLinear(300), 15);
  assert.equal(quantizeChannelLinear(31.6), 2); // rounds to 32 first
});

test("expandChannel spans 0..255 evenly (nibble * 17)", () => {
  assert.equal(expandChannel(0), 0);
  assert.equal(expandChannel(15), 255);
  assert.equal(expandChannel(8), 136);
});

test("quantizeRgb444 quantises each channel independently (curved)", () => {
  assert.deepEqual(quantizeRgb444([0, 128, 255]), [0, 6, 15]);
});

test("quantizeRgb444Linear quantises each channel independently (linear)", () => {
  assert.deepEqual(quantizeRgb444Linear([0, 128, 255]), [0, 8, 15]);
});

test("quantizePreviewRgb round-trips through the wire nibble and back (curved)", () => {
  assert.deepEqual(quantizePreviewRgb([10, 130, 250]), [0, 102, 255]);
});

test("quantizePreviewRgbLinear round-trips through the wire nibble and back (linear)", () => {
  assert.deepEqual(quantizePreviewRgbLinear([10, 130, 250]), [0, 136, 255]);
});

test("CURVED_PATHS and LINEAR_PATHS partition hardware.py's ContentPath (minus text_auto) with no overlap", () => {
  const allPaths: ContentPath[] = ["solid", "text_custom", "graffiti", "animation", "clock", "date", "timecount", "scoreboard", "temperature", "humidity"];
  for (const path of allPaths) assert.equal(CURVED_PATHS.has(path) !== LINEAR_PATHS.has(path), true, path);
  assert.equal(CURVED_PATHS.size + LINEAR_PATHS.size, allPaths.length);
});

test("encodeChannel dispatches to the curved table for art content paths", () => {
  for (const path of ["solid", "text_custom", "graffiti", "animation"] as const) {
    assert.equal(encodeChannel(60, path), quantizeChannel(60), path);
  }
});

test("encodeChannel dispatches to the linear divide for native firmware content paths", () => {
  for (const path of ["clock", "date", "timecount", "scoreboard", "temperature", "humidity"] as const) {
    assert.equal(encodeChannel(60, path), quantizeChannelLinear(60), path);
  }
});

test("displayedRgb dispatches the same way as encodeChannel, then re-expands for preview", () => {
  assert.deepEqual(displayedRgb([10, 130, 250], "animation"), quantizePreviewRgb([10, 130, 250]));
  assert.deepEqual(displayedRgb([10, 130, 250], "clock"), quantizePreviewRgbLinear([10, 130, 250]));
});

test("rgbToHex and hexToRgb round-trip quantised colours", () => {
  const rgb = quantizePreviewRgb([12, 200, 90]);
  assert.deepEqual(hexToRgb(rgbToHex(rgb)), rgb);
});

test("hexToRgb accepts 3-digit shorthand", () => {
  assert.deepEqual(hexToRgb("#0f0"), [0, 255, 0]);
});

test("readableInk picks dark ink on light colours and light ink on dark colours", () => {
  assert.equal(readableInk([255, 255, 255]), "#000000");
  assert.equal(readableInk([0, 0, 0]), "#ffffff");
  assert.ok(luminance([255, 255, 255]) > luminance([0, 0, 0]));
});

// ---- cross-language golden fixture: TS must never drift from hardware.py's own arithmetic ----
//
// `tools/generate_quantize_table.py` writes this fixture straight from `hardware.py`'s own
// `encode_channel(v, path)` for every path and all 256 channel values -- re-run it after any
// change to hardware.py's quantisation curves and this test re-proves TS still agrees byte-for-
// byte, rather than TS merely checking its own formula against itself.

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const quantizeTable = JSON.parse(readFileSync(join(fixturesDir, "quantize-table.json"), "utf8")) as {
  curved_paths: string[];
  linear_paths: string[];
  channels: Record<string, number[]>;
};

test("golden fixture's curved/linear path sets match color.ts's own CURVED_PATHS/LINEAR_PATHS", () => {
  assert.deepEqual([...CURVED_PATHS].sort(), quantizeTable.curved_paths);
  assert.deepEqual([...LINEAR_PATHS].sort(), quantizeTable.linear_paths);
});

test("encodeChannel matches hardware.py's encode_channel for every content path and all 256 channel values", () => {
  const paths = Object.keys(quantizeTable.channels) as ContentPath[];
  assert.ok(paths.length === 10, "expected exactly 10 quantisable content paths in the fixture");
  for (const path of paths) {
    const expected = quantizeTable.channels[path]!;
    for (let v = 0; v <= 255; v++) {
      assert.equal(encodeChannel(v, path), expected[v], `path=${path} v=${v}`);
    }
  }
});

test("regression: quantise-then-expand is NOT idempotent under re-application -- callers must never re-quantise already-expanded PixelFrame data (see iledclock-matrix-canvas.ts, which now trusts its input instead)", () => {
  // Every nibble 0-15, expanded to its preview byte, then run BACK through the same CURVED
  // curve: only 5 of 16 levels (0, 11, 12, 13, 15) survive a second pass unchanged. This is the
  // exact bug that used to live in iledclock-matrix-canvas.ts's _draw() (re-quantising frame
  // pixels that pixel-editor tools had already quantised once at write time) -- this test pins
  // the underlying non-idempotency so the fix (matrix-canvas no longer re-quantises) can never
  // silently regress back to "just call quantizePreviewRgb again, it's fine".
  const survivors: number[] = [];
  for (let n = 0; n <= 15; n++) {
    const expanded = expandChannel(n);
    if (quantizeChannel(expanded) === n) survivors.push(n);
  }
  assert.deepEqual(survivors, [0, 11, 12, 13, 15]);
});
