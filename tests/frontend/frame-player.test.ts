import { test } from "node:test";
import assert from "node:assert/strict";
import { frameIndexAtTime } from "../../frontend/src/lib/frame-player.ts";
import { createFrame } from "../../frontend/src/lib/grid.ts";

test("a single-frame design always shows frame 0 regardless of elapsed time", () => {
  const frames = [createFrame(2, 2, [1, 1, 1], 100)];
  assert.equal(frameIndexAtTime(frames, 0), 0);
  assert.equal(frameIndexAtTime(frames, 50000), 0);
});

test("steps through frames in order according to each frame's own duration", () => {
  const frames = [createFrame(2, 2, [1, 1, 1], 100), createFrame(2, 2, [2, 2, 2], 200), createFrame(2, 2, [3, 3, 3], 50)];
  assert.equal(frameIndexAtTime(frames, 0), 0);
  assert.equal(frameIndexAtTime(frames, 99), 0);
  assert.equal(frameIndexAtTime(frames, 100), 1);
  assert.equal(frameIndexAtTime(frames, 299), 1);
  assert.equal(frameIndexAtTime(frames, 300), 2);
  assert.equal(frameIndexAtTime(frames, 349), 2);
});

test("loops back to frame 0 once the full cycle elapses", () => {
  const frames = [createFrame(2, 2, [1, 1, 1], 100), createFrame(2, 2, [2, 2, 2], 200)];
  assert.equal(frameIndexAtTime(frames, 300), 0); // exactly one full cycle (100+200)
  assert.equal(frameIndexAtTime(frames, 350), 0);
  assert.equal(frameIndexAtTime(frames, 400), 1);
  assert.equal(frameIndexAtTime(frames, 950), 0); // 950 mod 300 = 50, within frame 0's 100ms band
});

test("handles several full cycles (large elapsed time) the same as a single cycle's remainder", () => {
  const frames = [createFrame(2, 2, [1, 1, 1], 100), createFrame(2, 2, [2, 2, 2], 200)];
  const withinFirstCycle = frameIndexAtTime(frames, 150);
  const tenCyclesLater = frameIndexAtTime(frames, 150 + 10 * 300);
  assert.equal(withinFirstCycle, tenCyclesLater);
});

test("a zero-duration frame is floored to 1ms instead of stalling the cycle forever", () => {
  const frames = [createFrame(2, 2, [1, 1, 1], 0), createFrame(2, 2, [2, 2, 2], 100)];
  assert.equal(frameIndexAtTime(frames, 0), 0);
  assert.equal(frameIndexAtTime(frames, 1), 1);
});
