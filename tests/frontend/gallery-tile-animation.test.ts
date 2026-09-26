import { test } from "node:test";
import assert from "node:assert/strict";
import { TILE_SCHEDULE_IDLE, tileScheduleTick, tileShouldAnimate, tileVisibilityChanged } from "../../frontend/src/lib/gallery-tile-animation.ts";

test("tileVisibilityChanged starts a pending transition when visibility flips away from settled", () => {
  const next = tileVisibilityChanged(TILE_SCHEDULE_IDLE, true, 1000);
  assert.deepEqual(next, { visible: false, pending: { toVisible: true, sinceMs: 1000 } });
});

test("tileVisibilityChanged is a no-op when the reported value already matches the settled value", () => {
  const settled = { visible: true, pending: null };
  assert.equal(tileVisibilityChanged(settled, true, 2000), settled);
});

test("tileVisibilityChanged reporting the settled value again clears a stale opposite-direction pending transition", () => {
  const pendingHidden = { visible: true, pending: { toVisible: false, sinceMs: 500 } };
  assert.deepEqual(tileVisibilityChanged(pendingHidden, true, 900), { visible: true, pending: null });
});

test("tileVisibilityChanged reporting the same pending value again keeps the original sinceMs (no restart on scroll jitter)", () => {
  const pending = tileVisibilityChanged(TILE_SCHEDULE_IDLE, true, 1000);
  const again = tileVisibilityChanged(pending, true, 1050);
  assert.equal(again, pending);
  assert.equal(again.pending?.sinceMs, 1000);
});


test("tileScheduleTick does nothing before the pending transition has settled", () => {
  const pending = tileVisibilityChanged(TILE_SCHEDULE_IDLE, true, 1000);
  assert.equal(tileScheduleTick(pending, 1100, 200), pending);
});

test("tileScheduleTick commits the pending transition once it has held for settleMs", () => {
  const pending = tileVisibilityChanged(TILE_SCHEDULE_IDLE, true, 1000);
  assert.deepEqual(tileScheduleTick(pending, 1200, 200), { visible: true, pending: null });
});

test("tileScheduleTick is a no-op once nothing is pending", () => {
  const settled = { visible: true, pending: null };
  assert.equal(tileScheduleTick(settled, 5000, 200), settled);
});

test("tileShouldAnimate requires visible, an animated source, and no reduced motion all at once", () => {
  const visible = { visible: true, pending: null };
  const hidden = { visible: false, pending: null };
  assert.equal(tileShouldAnimate(visible, true, false), true);
  assert.equal(tileShouldAnimate(hidden, true, false), false);
  assert.equal(tileShouldAnimate(visible, false, false), false);
  assert.equal(tileShouldAnimate(visible, true, true), false);
});
