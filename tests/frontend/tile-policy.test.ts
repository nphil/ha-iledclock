import { test } from "node:test";
import assert from "node:assert/strict";
import { capAnimatingTiles, tileAutoRetryDelay, tileRetryUrl, TileAnimationBudget } from "../../frontend/src/lib/tile-policy.ts";

test("an image failure receives one automatic retry after two seconds", () => {
  assert.equal(tileAutoRetryDelay(0), 2000);
  assert.equal(tileAutoRetryDelay(1), null);
  assert.equal(tileAutoRetryDelay(2), null);
});

test("retry URLs preserve existing query and fragments while changing their cache key", () => {
  assert.equal(tileRetryUrl("/media/item?size=small#preview", 1, 42), "/media/item?size=small&iledclock_retry=1-42#preview");
  assert.notEqual(tileRetryUrl("/media/item", 1, 1), tileRetryUrl("/media/item", 2, 2));
});

test("animation candidates are unique, ordered, and capped at twelve", () => {
  const ids = Array.from({ length: 15 }, (_, index) => "tile-" + index);
  assert.deepEqual(capAnimatingTiles([...ids, "tile-0"]), ids.slice(0, 12));
  assert.deepEqual(capAnimatingTiles(ids, 3), ids.slice(0, 3));
});

test("only active tiles receive animation grants, capped at twelve", () => {
  const budget = new TileAnimationBudget();
  const ids = Array.from({ length: 13 }, (_, index) => "tile-" + index);
  const changes: Array<[string, boolean]> = [];
  let collect = false;
  for (const id of ids) budget.register(id, (granted) => { if (collect) changes.push([id, granted]); });
  collect = true;
  for (const id of ids) budget.setActive(id, true);

  assert.deepEqual(changes, ids.slice(0, 12).map((id) => [id, true]));
  budget.setActive("tile-0", false);
  assert.deepEqual(changes.slice(12), [["tile-0", false], ["tile-12", true]]);
  budget.setActive("tile-0", false);
  assert.equal(changes.length, 14);
});

test("posterFrameIndex picks the frame with the most lit LEDs, earliest on ties", async () => {
  const { posterFrameIndex } = await import("../../frontend/src/lib/tile-policy.ts");
  const frame = (lit: number) => { const p = new Uint8Array(32 * 16 * 3); for (let i = 0; i < lit; i++) p[i * 3 + 1] = 200; return { pixels: p }; };
  assert.equal(posterFrameIndex([frame(0), frame(5), frame(40), frame(12)]), 2);
  assert.equal(posterFrameIndex([frame(3), frame(3)]), 0);
  assert.equal(posterFrameIndex([]), 0);
});
