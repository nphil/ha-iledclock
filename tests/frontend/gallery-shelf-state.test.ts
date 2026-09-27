import { test } from "node:test";
import assert from "node:assert/strict";
import { beginShelfLoad, initialShelfLoadStates, rejectShelfLoad, resolveShelfLoad } from "../../frontend/src/lib/gallery-shelf-state.ts";
import type { GalleryItem } from "../../frontend/src/lib/gallery-api.ts";

function item(id: string): GalleryItem {
  return { source: "iledclock", id, title: id, width: 32, height: 16, animated: false, media_path: `/media/${id}` };
}

const shelves = [
  { id: "trending", title: "Trending", source: "iledclock" },
  { id: "new", title: "New", source: "awtrix" },
];

test("shelves enter and settle independently", () => {
  const initial = initialShelfLoadStates(shelves);
  const trend = beginShelfLoad(initial, "trending")!;
  const newer = beginShelfLoad(trend.states, "new")!;
  const loadedTrend = resolveShelfLoad(newer.states, "trending", trend.requestId, [item("heart")]);
  assert.equal(loadedTrend.trending?.status, "ready");
  assert.deepEqual(loadedTrend.trending?.items.map((art) => art.id), ["heart"]);
  assert.equal(loadedTrend.new?.status, "loading");
  const failedNew = rejectShelfLoad(loadedTrend, "new", newer.requestId, "AWTRIX unavailable");
  assert.equal(failedNew.trending?.status, "ready");
  assert.equal(failedNew.new?.status, "error");
  assert.equal(failedNew.new?.error, "AWTRIX unavailable");
});

test("a retried shelf ignores its late earlier response", () => {
  const first = beginShelfLoad(initialShelfLoadStates(shelves), "trending")!;
  const retried = beginShelfLoad(first.states, "trending")!;
  const stale = resolveShelfLoad(retried.states, "trending", first.requestId, [item("stale")]);
  assert.equal(stale, retried.states);
  const current = resolveShelfLoad(retried.states, "trending", retried.requestId, [item("fresh")]);
  assert.deepEqual(current.trending?.items.map((art) => art.id), ["fresh"]);
});
