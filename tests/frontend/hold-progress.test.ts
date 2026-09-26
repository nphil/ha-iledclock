import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HOLD_CONFIG, HOLD_IDLE, holdPress, holdProgress, holdRelease, holdTick } from "../../frontend/src/lib/hold-progress.ts";

const config = { durationMs: 1000, drainMs: 300 };

test("a full-duration hold completes and locks progress at 1", () => {
  let state = holdPress();
  state = holdTick(state, 1000, config);
  assert.equal(state.phase, "completed");
  assert.equal(holdProgress(state, config), 1);
  // Ticking a completed hold further is a no-op -- it stays completed until the caller resets it.
  const after = holdTick(state, 500, config);
  assert.equal(after.phase, "completed");
});

test("progress rises linearly with elapsed time while charging", () => {
  let state = holdPress();
  state = holdTick(state, 250, config);
  assert.equal(state.phase, "charging");
  assert.equal(holdProgress(state, config), 0.25);
});

test("releasing before completion begins a drain from the reached progress", () => {
  let state = holdPress();
  state = holdTick(state, 400, config); // 40% charged
  state = holdRelease(state);
  assert.equal(state.phase, "draining");
  assert.equal(holdProgress(state, config), 0.4); // still shows the reached fill immediately after release
});

test("draining reaches idle and progress returns to 0, never going negative", () => {
  let state = holdRelease(holdTick(holdPress(), 200, config)); // draining from 200ms
  state = holdTick(state, 500, config); // overshoots past zero
  assert.equal(state.phase, "idle");
  assert.equal(holdProgress(state, config), 0);
});

test("releasing a hold that never started (idle) is a no-op", () => {
  assert.equal(holdRelease(HOLD_IDLE), HOLD_IDLE);
});

test("re-pressing after a completed hold starts a fresh charge from zero", () => {
  const completed = holdTick(holdPress(), 1000, config);
  const pressed = holdPress();
  assert.notEqual(completed.phase, pressed.phase);
  assert.equal(pressed.elapsedMs, 0);
});

test("DEFAULT_HOLD_CONFIG describes a deliberate, not instantaneous, hold", () => {
  assert.ok(DEFAULT_HOLD_CONFIG.durationMs >= 500);
  assert.ok(DEFAULT_HOLD_CONFIG.drainMs > 0);
});
