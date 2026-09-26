import { test } from "node:test";
import assert from "node:assert/strict";
import { base64ToFrame, designToFrames, frameToBase64, framesToDesign } from "../../frontend/src/lib/design-codec.ts";
import { createFrame, FRAME_BYTES, framesEqual, getPixel, setPixel } from "../../frontend/src/lib/grid.ts";
import type { StoredDesign } from "../../frontend/src/types.ts";

test("frameToBase64 produces exactly width*height*3 raw bytes (1536 for 32x16)", () => {
  const frame = createFrame();
  const b64 = frameToBase64(frame);
  const bytes = Buffer.from(b64, "base64");
  assert.equal(bytes.length, FRAME_BYTES);
  assert.equal(FRAME_BYTES, 1536);
});

test("frameToBase64 / base64ToFrame round-trip every pixel exactly", () => {
  let frame = createFrame(32, 16, [0, 0, 0], 250);
  frame = setPixel(frame, 0, 0, [255, 0, 128]);
  frame = setPixel(frame, 31, 15, [12, 34, 56]);
  frame = setPixel(frame, 15, 7, [1, 2, 3]);

  const b64 = frameToBase64(frame);
  const back = base64ToFrame(b64, 32, 16, 250);
  assert.ok(framesEqual(frame, back));
});

test("base64ToFrame tolerates a short payload by leaving the tail black", () => {
  const short = Buffer.from(new Uint8Array([255, 0, 0])).toString("base64"); // one pixel only
  const frame = base64ToFrame(short, 2, 1, 100);
  assert.deepEqual(getPixel(frame, 0, 0), [255, 0, 0]);
  assert.deepEqual(getPixel(frame, 1, 0), [0, 0, 0]);
});

test("framesToDesign / designToFrames round-trip a multi-frame animation with per-frame delay", () => {
  const frames = [createFrame(4, 4, [255, 0, 0], 80), createFrame(4, 4, [0, 255, 0], 160)];
  const design = framesToDesign(frames, { id: "d1", name: "Test", kind: "animation", created: 1, updated: 2 });
  assert.equal(design.frames.length, 2);
  assert.deepEqual(design.delays, [80, 160]);
  assert.equal(design.width, 4);
  assert.equal(design.height, 4);

  const restored = designToFrames(design);
  assert.equal(restored.length, 2);
  assert.ok(framesEqual(restored[0]!, frames[0]!));
  assert.ok(framesEqual(restored[1]!, frames[1]!));
});

test("designToFrames falls back to one blank frame for a design with no frames", () => {
  const design: StoredDesign = { id: "empty", name: "Empty", kind: "image", width: 32, height: 16, frames: [], delays: [], created: 0, updated: 0 };
  const frames = designToFrames(design);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.width, 32);
});

test("designToFrames defaults a missing per-frame delay to 100ms", () => {
  const frame = createFrame(2, 2, [1, 1, 1], 999);
  const design = framesToDesign([frame], { id: "d", name: "n", kind: "image", created: 0, updated: 0 });
  const design2: StoredDesign = { ...design, delays: [] };
  const restored = designToFrames(design2);
  assert.equal(restored[0]!.durationMs, 100);
});
