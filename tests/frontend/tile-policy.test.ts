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

test("animation budget grants newly visible tiles only within the global cap", () => {
  const budget = new TileAnimationBudget();
  const granted: boolean[] = [];
  for (let index = 0; index < 13; index++) {
    const id = "tile-" + index;
    budget.register(id, (value) => { if (value) granted.push(value); });
    budget.setVisible(id, true);
  }
  assert.equal(granted.length, 12);
  budget.setVisible("tile-0", false);
  assert.equal(granted.length, 13);
});
