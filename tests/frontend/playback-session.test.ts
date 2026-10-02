import { test } from "node:test";
import assert from "node:assert/strict";
import { PlaybackSession, type PlaybackState } from "../../frontend/src/lib/playback-session.ts";
import { paceForSpeed } from "../../frontend/src/lib/playback.ts";
import { frameToBase64 } from "../../frontend/src/lib/design-codec.ts";
import { createFrame, setPixelMut, type PixelFrame } from "../../frontend/src/lib/grid.ts";
import { playbackPreviewRequest } from "../../frontend/src/lib/ws-api.ts";
import type { PlaybackInfo, PlaybackPreviewResult } from "../../frontend/src/types.ts";

/** Frame `index` of a scrolling dot: lit pixel count grows with `lit` so the poster is predictable. */
function frame(lit: number, durationMs = 125): PixelFrame {
  const f = createFrame(32, 16, [0, 0, 0], durationMs);
  for (let x = 0; x < lit; x++) setPixelMut(f, x, 0, [255, 255, 255]);
  return f;
}

/** 12 frames, 125 ms each = 8 authored frames a second; frame 7 is the fullest. */
const AUTHORED = Array.from({ length: 12 }, (_, i) => frame(i === 7 ? 20 : i + 1));

function info(overrides: Partial<PlaybackInfo> = {}): PlaybackInfo {
  return {
    still: false,
    frames: 12,
    authored_frames: 12,
    added_frames: 0,
    loop_ms: 1500,
    pace_fps: 8,
    native_fps: 8,
    original_speed: 52.8,
    smooth: { state: "idle", available: true, enabled: true, slides: 11, fades: 0, sharp: 0, capped: false },
    ...overrides,
  };
}

function result(count: number, paceFps: number, overrides: Partial<PlaybackInfo> = {}): PlaybackPreviewResult {
  const frames = Array.from({ length: count }, (_, i) => frameToBase64(frame(i + 1)));
  const delays = Array.from({ length: count }, () => 1000 / paceFps / (count / 12));
  return { frames, delays, playback: info({ frames: count, pace_fps: paceFps, ...overrides }) };
}

interface Pending {
  request: Record<string, unknown>;
  resolve: (value: PlaybackPreviewResult) => void;
  reject: (error: unknown) => void;
}

function rig(defaultState?: PlaybackState) {
  const pending: Pending[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let nextTimer = 1;
  let changes = 0;
  const cleared: number[] = [];
  const session = new PlaybackSession({
    callWS: (request) => {
      const { promise, resolve, reject } = Promise.withResolvers<PlaybackPreviewResult>();
      pending.push({ request, resolve, reject });
      return promise;
    },
    buildRequest: (state) => playbackPreviewRequest({ designId: "d1" }, state),
    onChange: () => {
      changes++;
    },
    setTimer: (callback, ms) => {
      const id = nextTimer++;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimer: (handle) => {
      cleared.push(handle as number);
      timers.delete(handle as number);
    },
    defaultState,
  });
  return {
    session,
    pending,
    timers,
    cleared,
    changes: () => changes,
    fire() {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, timer] of due) timer.callback();
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a new source is fetched at once, without the debounce, and its exact frames replace the authored ones", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  assert.equal(r.timers.size, 0);
  assert.equal(r.pending.length, 1);
  assert.deepEqual(r.pending[0]!.request, { type: "iledclock/playback/preview", design_id: "d1", speed: null, smooth: null });
  assert.equal(r.session.loading, true);
  assert.equal(r.session.info, null, "no info until the server answers");
  assert.equal(r.session.frames.length, 12, "authored frames show meanwhile");
  assert.equal(r.session.hasMotion, true);

  r.pending[0]!.resolve(result(12, 8));
  await tick();
  assert.equal(r.session.loading, false);
  assert.equal(r.session.info?.pace_fps, 8);
  assert.equal(r.session.rate, 1);
  assert.equal(r.session.playing, true);
  assert.equal(r.session.originalSpeed, 52.8, "the server's Original position wins once known");
});

test("a single picture has no motion and does not play", async () => {
  const r = rig();
  r.session.setSource([frame(3)]);
  assert.equal(r.session.hasMotion, false);
  assert.equal(r.session.playing, false);
});

test("dragging scales the loaded frames locally and sends nothing until commit plus the debounce", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve(result(12, 8));
  await tick();

  r.session.setState({ speed: 20 });
  r.session.setState({ speed: 30 });
  r.session.setState({ speed: 34 });
  assert.equal(r.pending.length, 1, "no request while dragging");
  assert.equal(r.timers.size, 0);
  assert.ok(Math.abs(r.session.rate - paceForSpeed(34) / 8) < 1e-12);
  assert.equal(r.session.frames.length, 12, "the last exact frames keep playing");
  assert.equal(r.session.playing, true);

  r.session.setState({ speed: 34 }, { commit: true });
  assert.equal(r.timers.size, 1);
  assert.equal([...r.timers.values()][0]!.ms, 200);
  assert.equal(r.session.loading, true);
  assert.equal(r.pending.length, 1);

  r.fire();
  assert.equal(r.pending.length, 2);
  assert.deepEqual(r.pending[1]!.request, { type: "iledclock/playback/preview", design_id: "d1", speed: 34, smooth: null });

  r.pending[1]!.resolve(result(30, paceForSpeed(34), { added_frames: 18, frames: 30, smooth: { state: "applied", available: true, enabled: true, slides: 11, fades: 0, sharp: 0, capped: false } }));
  await tick();
  assert.equal(r.session.frames.length, 30);
  assert.equal(r.session.rate, 1, "rate returns to 1 on exact frames");
  assert.equal(r.session.info?.smooth.state, "applied");
  assert.equal(r.session.loadedPace, paceForSpeed(34));
});

test("rate keeps being relative to the pace of the frames that are actually loaded", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve(result(12, 8));
  await tick();
  r.session.setState({ speed: 34 }, { commit: true });
  r.fire();
  r.pending[1]!.resolve(result(30, paceForSpeed(34)));
  await tick();

  r.session.setState({ speed: 50 });
  assert.ok(Math.abs(r.session.rate - paceForSpeed(50) / paceForSpeed(34)) < 1e-12);
  r.session.setState({ speed: null });
  assert.ok(Math.abs(r.session.rate - 8 / paceForSpeed(34)) < 1e-12, "Original is the authored 8 fps");
});

test("Still shows the fullest authored frame at once, then the server's still frame, and leaving Still plays again", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve(result(12, 8));
  await tick();

  r.session.setState({ speed: 0 });
  assert.equal(r.session.playing, false);
  assert.equal(r.session.frames.length, 1);
  assert.strictEqual(r.session.frames[0], AUTHORED[7], "the poster is the frame with the most lit pixels");

  r.session.setState({ speed: 0 }, { commit: true });
  r.fire();
  r.pending[1]!.resolve({ frames: [frameToBase64(frame(20))], delays: [1500], playback: info({ still: true, frames: 1, pace_fps: 0, loop_ms: 0 }) });
  await tick();
  assert.equal(r.session.frames.length, 1);
  assert.equal(r.session.playing, false);
  assert.equal(r.session.info?.still, true);

  r.session.setState({ speed: 60 });
  assert.equal(r.session.frames.length, 12, "the last playable frames come back, not the single still frame");
  assert.equal(r.session.playing, true);
  assert.ok(Math.abs(r.session.rate - paceForSpeed(60) / 8) < 1e-12);
});

test("an answer to an older request is dropped", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve(result(12, 8));
  await tick();

  r.session.setState({ speed: 20 }, { commit: true });
  r.fire();
  r.session.setState({ speed: 70 }, { commit: true });
  r.fire();
  assert.equal(r.pending.length, 3);
  r.pending[2]!.resolve(result(12, paceForSpeed(70)));
  await tick();
  r.pending[1]!.resolve(result(30, paceForSpeed(20)));
  await tick();
  assert.equal(r.session.frames.length, 12, "the speed-20 answer must not replace the speed-70 frames");
  assert.equal(r.session.loadedPace, paceForSpeed(70));
});

test("starting a drag throws away an answer that was still on its way", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve(result(12, 8));
  await tick();
  r.session.setState({ speed: 20 }, { commit: true });
  r.fire();
  r.session.setState({ speed: 25 });
  r.pending[1]!.resolve(result(30, paceForSpeed(20)));
  await tick();
  assert.equal(r.session.frames.length, 12);
  assert.equal(r.session.loading, false);
});

test("a failed request becomes session.error and leaves the preview working", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve(result(12, 8));
  await tick();
  r.session.setState({ speed: 34 }, { commit: true });
  r.fire();
  r.pending[1]!.reject({ code: "unknown_error", message: "clock is out of range" });
  await tick();
  assert.equal(r.session.error, "Couldn't update the preview: clock is out of range");
  assert.equal(r.session.loading, false);
  assert.equal(r.session.frames.length, 12);
  assert.equal(r.session.playing, true);
  assert.ok(Math.abs(r.session.rate - paceForSpeed(34) / 8) < 1e-12, "the local approximation stays in place");

  r.session.setState({ speed: 40 }, { commit: true });
  r.fire();
  assert.equal(r.session.error, null, "a new attempt clears the old error");
});

test("a malformed server answer is an error, not an exception", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve({ frames: [], delays: [], playback: info() });
  await tick();
  assert.match(r.session.error ?? "", /^Couldn't update the preview/);
  assert.equal(r.session.frames.length, 12);
});

test("committing the setting that is already on screen does not ask again", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve(result(12, 8));
  await tick();
  r.session.setState({ speed: 60 });
  r.session.setState({ speed: null }, { commit: true });
  assert.equal(r.timers.size, 0);
  assert.equal(r.pending.length, 1);
  assert.equal(r.session.rate, 1);
  assert.equal(r.session.loading, false);
});

test("a source change refetches at once and drops the old source's answer", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  const other = [frame(2, 100), frame(4, 100)];
  r.session.setSource(other, { state: { speed: 40, smooth: "off" } });
  assert.equal(r.pending.length, 2);
  assert.deepEqual(r.pending[1]!.request, { type: "iledclock/playback/preview", design_id: "d1", speed: 40, smooth: "off" });
  r.pending[0]!.resolve(result(12, 8));
  await tick();
  assert.equal(r.session.info, null, "the first source's answer is stale");
  assert.equal(r.session.frames.length, 2);
  assert.ok(Math.abs(r.session.rate - paceForSpeed(40) / 10) < 1e-12, "before an answer, pace is scaled from the authored 10 fps");
});

test("setting the very same frames again changes nothing", () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.session.setSource(AUTHORED);
  assert.equal(r.pending.length, 1);
});

test("reset restores the default state and refreshes the exact frames", async () => {
  const r = rig({ speed: 25, smooth: "off" });
  r.session.setSource(AUTHORED);
  assert.deepEqual(r.session.state, { speed: 25, smooth: "off" });
  r.pending[0]!.resolve(result(12, paceForSpeed(25)));
  await tick();
  r.session.setState({ speed: 80, smooth: "on" }, { commit: true });
  r.fire();
  r.pending[1]!.resolve(result(12, paceForSpeed(80)));
  await tick();

  r.session.reset();
  assert.deepEqual(r.session.state, { speed: 25, smooth: "off" });
  r.fire();
  assert.deepEqual(r.pending[2]!.request, { type: "iledclock/playback/preview", design_id: "d1", speed: 25, smooth: "off" });
});

test("flipping the Smooth switch goes through the same debounce and sends the explicit value", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve(result(12, 8));
  await tick();
  r.session.setState({ smooth: "off" }, { commit: true });
  assert.equal(r.session.speed, null);
  r.fire();
  assert.deepEqual(r.pending[1]!.request, { type: "iledclock/playback/preview", design_id: "d1", speed: null, smooth: "off" });
});

test("dispose clears the waiting timer and nothing fires afterwards", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  r.pending[0]!.resolve(result(12, 8));
  await tick();
  r.session.setState({ speed: 30 }, { commit: true });
  assert.equal(r.timers.size, 1);
  const before = r.changes();
  r.session.dispose();
  assert.equal(r.timers.size, 0);
  assert.ok(r.cleared.length >= 1);
  r.fire();
  r.session.setState({ speed: 31 }, { commit: true });
  r.session.setSource([frame(1), frame(2)]);
  assert.equal(r.pending.length, 1, "no request after dispose");
  assert.equal(r.changes(), before, "no listener call after dispose");
});

test("an answer that lands after dispose is ignored", async () => {
  const r = rig();
  r.session.setSource(AUTHORED);
  const before = r.changes();
  r.session.dispose();
  r.pending[0]!.resolve(result(12, 8));
  await tick();
  assert.equal(r.session.info, null);
  assert.equal(r.changes(), before);
});
