import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrame, setPixel } from "../../frontend/src/lib/grid.ts";
import { encodeAnimationGif } from "../../frontend/src/lib/editor-export.ts";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function gifAnimation(bytes: Uint8Array): { loopCount: number | null; delays: number[] } {
  let cursor = 13 + 256 * 3;
  let loopCount: number | null = null;
  let pendingDelay = 0;
  const delays: number[] = [];
  while (cursor < bytes.length) {
    const marker = bytes[cursor++]!;
    if (marker === 0x3b) {
      assert.equal(cursor, bytes.length);
      return { loopCount, delays };
    }
    if (marker === 0x21) {
      const label = bytes[cursor++]!;
      if (label === 0xf9) {
        assert.equal(bytes[cursor++]!, 4);
        cursor++; // packed flags
        pendingDelay = bytes[cursor]! | (bytes[cursor + 1]! << 8);
        cursor += 2;
        cursor++; // transparent index
        assert.equal(bytes[cursor++]!, 0);
      } else {
        const headerLength = bytes[cursor++]!;
        const appName = label === 0xff ? ascii(bytes, cursor, headerLength) : "";
        cursor += headerLength;
        while (true) {
          const length = bytes[cursor++]!;
          if (length === 0) break;
          if (appName === "NETSCAPE2.0" && bytes[cursor] === 1) {
            loopCount = bytes[cursor + 1]! | (bytes[cursor + 2]! << 8);
          }
          cursor += length;
        }
      }
      continue;
    }
    assert.equal(marker, 0x2c, "expected an image descriptor");
    cursor += 8; // left, top, width, and height
    const packed = bytes[cursor++]!;
    if (packed & 0x80) cursor += 3 * (1 << ((packed & 0x07) + 1));
    cursor++; // LZW minimum code size
    while (true) {
      const length = bytes[cursor++]!;
      if (length === 0) break;
      cursor += length;
    }
    delays.push(pendingDelay);
    pendingDelay = 0;
  }
  throw new Error("GIF is missing its trailer.");
}

test("GIF export encodes a looping animation with the requested frame delays", () => {
  const first = setPixel(createFrame(2, 1, [255, 0, 0], 100), 1, 0, [0, 255, 0]);
  const second = { ...createFrame(2, 1, [0, 0, 255], 250), durationMs: 250 };
  const bytes = encodeAnimationGif([first, second]);
  assert.equal(ascii(bytes, 0, 6), "GIF89a");
  assert.equal(bytes[6], 2);
  assert.equal(bytes[8], 1);
  assert.deepEqual(gifAnimation(bytes), { loopCount: 0, delays: [10, 25] });
});

test("GIF export rejects inconsistent frame sizes instead of producing a broken file", () => {
  assert.throws(() => encodeAnimationGif([createFrame(2, 1), createFrame(1, 1)]), RangeError);
  assert.throws(() => encodeAnimationGif([]), RangeError);
});
