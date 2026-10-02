import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PACE_MAX_FPS,
  PACE_MIN_FPS,
  describeSmooth,
  designLoopCaption,
  formatLoop,
  nativeFps,
  originalSpeed,
  paceCaption,
  paceForSpeed,
  previewRate,
  snapSpeed,
  speedForPace,
  speedLabel,
  speedValueText,
  steppedSpeed,
} from "../../frontend/src/lib/playback.ts";
import type { PlaybackInfo } from "../../frontend/src/types.ts";

const curve = JSON.parse(readFileSync(new URL("../fixtures/playback-curve.json", import.meta.url), "utf8")) as {
  max_fps: number;
  min_fps: number;
  pace_for_speed: { speed: number; pace_fps: number }[];
  speed_for_pace: { pace_fps: number; speed: number }[];
};

test("the speed curve matches the Python fixture", () => {
  assert.ok(Math.abs(PACE_MAX_FPS - curve.max_fps) < 1e-6);
  assert.equal(PACE_MIN_FPS, curve.min_fps);
  for (const { speed, pace_fps } of curve.pace_for_speed) {
    assert.ok(Math.abs(paceForSpeed(speed) - pace_fps) < 1e-5, `pace at ${speed}`);
  }
  for (const { pace_fps, speed } of curve.speed_for_pace) {
    assert.ok(Math.abs(speedForPace(pace_fps) - speed) < 1e-5, `speed at ${pace_fps} fps`);
  }
});

test("pace and speed are inverses, and out-of-range paces clamp to the slider ends", () => {
  for (const speed of [1, 17, 50, 83, 100]) assert.ok(Math.abs(speedForPace(paceForSpeed(speed)) - speed) < 1e-9);
  assert.equal(paceForSpeed(0), 0, "Still has no pace");
  assert.equal(speedForPace(1000), 100);
  assert.equal(speedForPace(0.01), 0);
});

test("the Original marker follows the authored pace and never leaves the track", () => {
  assert.equal(nativeFps([125, 125, 125, 125]), 8);
  assert.ok(Math.abs(originalSpeed(8) - 52.81597) < 1e-4);
  assert.equal(originalSpeed(500), 100, "faster than Max sits at the end");
  assert.equal(originalSpeed(0.1), 1, "slower than the slowest sits at 1, not on Still");
  assert.equal(nativeFps([]), 0);
});

test("dragging snaps to Original within 3, to Still at 1 or less, else to whole percents", () => {
  assert.equal(snapSpeed(52.8, 50), null);
  assert.equal(snapSpeed(47, 50), null);
  assert.equal(snapSpeed(46.9, 50), 47);
  assert.equal(snapSpeed(53.1, 50), 53);
  assert.equal(snapSpeed(1, 50), 0);
  assert.equal(snapSpeed(0, 50), 0);
  assert.equal(snapSpeed(1.4, 50), 1, "1.4 rounds to 1, a real slow speed");
});

test("keyboard steps by 1, pages by 10, Home is Still and End is Max", () => {
  assert.equal(steppedSpeed(30, "ArrowRight", 60), 31);
  assert.equal(steppedSpeed(30, "ArrowUp", 60), 31);
  assert.equal(steppedSpeed(30, "ArrowLeft", 60), 29);
  assert.equal(steppedSpeed(30, "ArrowDown", 60), 29);
  assert.equal(steppedSpeed(30, "PageUp", 60), 40);
  assert.equal(steppedSpeed(30, "PageDown", 60), 20);
  assert.equal(steppedSpeed(30, "Home", 60), 0);
  assert.equal(steppedSpeed(30, "End", 60), 100);
  assert.equal(steppedSpeed(95, "PageUp", 60), 100);
});

test("keyboard can land on Original and then leave it again in either direction", () => {
  assert.equal(steppedSpeed(57, "ArrowRight", 60), null, "stepping into the snap window lands on Original");
  assert.equal(steppedSpeed(null, "ArrowRight", 60), 64);
  assert.equal(steppedSpeed(null, "ArrowLeft", 60), 56);
  assert.equal(steppedSpeed(null, "PageUp", 60), 70);
  assert.equal(steppedSpeed(null, "PageDown", 60), 50);
  assert.equal(steppedSpeed(null, "ArrowRight", 99), 100, "leaving Original at the top end reaches Max");
  assert.equal(steppedSpeed(null, "ArrowLeft", 2), 0, "leaving Original at the bottom end reaches Still");
});

test("keyboard climbs off Still and drops into Still from the slowest steps", () => {
  assert.equal(steppedSpeed(0, "ArrowRight", 60), 2);
  assert.equal(steppedSpeed(0, "PageUp", 60), 10);
  assert.equal(steppedSpeed(2, "ArrowLeft", 60), 0);
  assert.equal(steppedSpeed(0, "ArrowLeft", 60), 0);
});

test("the value readout names Still, Original and Max and otherwise shows a percent", () => {
  assert.equal(speedLabel(0), "Still");
  assert.equal(speedLabel(null), "Original");
  assert.equal(speedLabel(100), "Max");
  assert.equal(speedLabel(34), "34%");
  assert.equal(speedLabel(33.6), "34%");
});

test("the caption gives the pace and loop length in plain words", () => {
  // speed 50 -> 6.9 fps; 12 authored frames loop in 1.74 s
  assert.equal(paceCaption(50, 12, 8), "About 7 frames a second \u00b7 loops every 1.7\u00a0s");
  assert.equal(paceCaption(null, 12, 8), "About 8 frames a second \u00b7 loops every 1.5\u00a0s");
  assert.equal(paceCaption(0, 12, 8), "One still picture - the fullest frame");
  assert.equal(paceCaption(5, 2, 8), "About 1 frame every 2\u00a0s \u00b7 loops every 3.1\u00a0s");
});

test("a pace above 60 says what the preview can actually show", () => {
  const text = paceCaption(90, 12, 8);
  assert.match(text, /^About 56 frames a second/, text);
  assert.ok(!text.includes("preview shows"), "56 fps is within the preview's 60");
  const fast = paceCaption(100, 12, 8);
  assert.equal(fast, "About 95 frames a second \u00b7 loops every 0.13\u00a0s (the preview shows up to 60)");
});

test("loop lengths use two decimals under a second, one under ten and whole seconds beyond", () => {
  assert.equal(formatLoop(0.126), "0.13\u00a0s");
  assert.equal(formatLoop(0.5), "0.5\u00a0s");
  assert.equal(formatLoop(1.74), "1.7\u00a0s");
  assert.equal(formatLoop(2), "2\u00a0s");
  assert.equal(formatLoop(9.96), "10\u00a0s");
  assert.equal(formatLoop(12.4), "12\u00a0s");
});

test("the range input reads out Still, Original and Max in words", () => {
  assert.equal(speedValueText(34, 12, 8), "34 percent, about 3 frames a second");
  assert.equal(speedValueText(0, 12, 8), "Still, one picture");
  assert.equal(speedValueText(null, 12, 8), "Original, about 8 frames a second");
  assert.equal(speedValueText(100, 12, 8), "Max, about 95 frames a second");
});

test("a rotation row shows how long one loop takes, or that the design is still", () => {
  const frames = ["a", "b", "c", "d"];
  assert.equal(designLoopCaption({ frames, delays: [1000, 1500, 2000, 2000] }), "loop 6.5\u00a0s");
  assert.equal(designLoopCaption({ frames, delays: [100, 100, 100, 100], speed: null }), "loop 0.4\u00a0s");
  assert.equal(designLoopCaption({ frames, delays: [100, 100, 100, 100], speed: 0 }), "still");
  assert.equal(designLoopCaption({ frames: ["a"], delays: [100] }), "", "a single picture has no loop");
  const slowed = designLoopCaption({ frames, delays: [100, 100, 100, 100], speed: 50 });
  assert.equal(slowed, `loop ${formatLoop(4 / paceForSpeed(50))}`);
});

function info(overrides: Partial<PlaybackInfo["smooth"]> & { added_frames?: number; frames?: number } = {}): PlaybackInfo {
  const { added_frames = 0, frames = 12, ...smooth } = overrides;
  return {
    still: false,
    frames,
    authored_frames: 12,
    added_frames,
    loop_ms: 1500,
    pace_fps: 8,
    native_fps: 8,
    original_speed: 52.8,
    smooth: { state: "idle", available: true, enabled: true, slides: 11, fades: 0, sharp: 0, capped: false, ...smooth },
  };
}

test("the Smooth row says what is happening in every state", () => {
  assert.deepEqual(describeSmooth(null, null), { text: "Checking the animation...", disabled: false, checked: true });
  assert.deepEqual(describeSmooth(info({ state: "unavailable", available: false, slides: 0 }), null), {
    text: "Nothing slides or fades here, so there's nothing to smooth.",
    disabled: true,
    checked: true,
  });
  assert.deepEqual(describeSmooth(info({ state: "unavailable", available: false, slides: 3 }), null), {
    text: "Already moving one pixel at a time, so there's nothing to smooth.",
    disabled: true,
    checked: true,
  });
  assert.equal(describeSmooth(info({ state: "off", enabled: false }), "off").text, "Off. The clock steps straight from picture to picture.");
  assert.equal(describeSmooth(info({ state: "off", enabled: false }), "off").checked, false);
  assert.equal(describeSmooth(info({ state: "idle" }), "on").text, "On. In-between frames are added when you slow it down.");
  assert.equal(describeSmooth(info({ state: "none" }), null).text, "On, but this speed doesn't need in-between frames.");
});

test("the applied line counts frames and mentions sharp blinks and the 40-frame limit", () => {
  assert.equal(describeSmooth(info({ state: "applied", added_frames: 24, frames: 36 }), null).text, "Added 24 in-between frames (36 total)");
  assert.equal(describeSmooth(info({ state: "applied", added_frames: 24, frames: 36, sharp: 2 }), "on").text, "Added 24 in-between frames (36 total); blinks stay sharp");
  assert.equal(
    describeSmooth(info({ state: "applied", added_frames: 28, frames: 40, sharp: 1, capped: true }), "on").text,
    "Added 28 in-between frames (40 total); blinks stay sharp - limited to 40 frames",
  );
  assert.equal(describeSmooth(info({ state: "applied", added_frames: 1, frames: 13 }), "on").text, "Added 1 in-between frame (13 total)");
});

test("the setting, not a stale server answer, decides whether smoothing reads as on or off", () => {
  const staleApplied = info({ state: "applied", added_frames: 24, frames: 36 });
  assert.equal(describeSmooth(staleApplied, "off").text, "Off. The clock steps straight from picture to picture.");
  const staleOff = info({ state: "off", enabled: false });
  assert.equal(describeSmooth(staleOff, "on").text, "On. In-between frames are added when you slow it down.");
});

test("preview rate is target pace over the pace of the loaded frames", () => {
  const native = 8;
  assert.ok(Math.abs(previewRate(50, native, native) - paceForSpeed(50) / 8) < 1e-12);
  assert.equal(previewRate(null, 4, 8), 2, "back to Original from frames already slowed to 4 fps");
  assert.equal(previewRate(0, 8, 8), 0, "Still never plays");
  assert.equal(previewRate(50, 0, 8), 1, "no loaded pace yet means leave it alone");
});
