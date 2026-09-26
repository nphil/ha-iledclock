import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFilters,
  beginLoadMore,
  browseFiltersEqual,
  failLoadMore,
  filterItemsByTitle,
  formatCount,
  initialBrowseState,
  itemKey,
  mergePage,
  resolveSort,
  tileMetaLine,
  type BrowseFilters,
} from "../../frontend/src/lib/gallery-browse-state.ts";
import type { GalleryItem } from "../../frontend/src/lib/gallery-api.ts";

function filters(patch: Partial<BrowseFilters> = {}): BrowseFilters {
  return { source: "lametric", sort: "popular", query: "", size: undefined, animatedOnly: false, ...patch };
}

function item(patch: Partial<GalleryItem> = {}): GalleryItem {
  return { source: "lametric", id: "1", title: "Sunny cloud", width: 8, height: 8, animated: false, media_path: "/media/1", ...patch };
}

test("browseFiltersEqual compares every field", () => {
  assert.equal(browseFiltersEqual(filters(), filters()), true);
  assert.equal(browseFiltersEqual(filters(), filters({ sort: "newest" })), false);
  assert.equal(browseFiltersEqual(filters({ size: "8x8" }), filters({ size: "32x8" })), false);
});

test("applyFilters is a no-op (same reference) when the patch changes nothing", () => {
  const state = initialBrowseState(filters());
  assert.equal(applyFilters(state, { sort: "popular" }), state);
});

test("applyFilters on an actual change resets the grid to page 0 under the new filters", () => {
  const state = { ...initialBrowseState(filters()), items: [item()], page: 3, hasMore: false, error: "boom" };
  const next = applyFilters(state, { sort: "newest" });
  assert.deepEqual(next, initialBrowseState(filters({ sort: "newest" })));
});

test("beginLoadMore sets loading and clears any previous error", () => {
  const state = { ...initialBrowseState(filters()), error: "previous failure" };
  assert.deepEqual(beginLoadMore(state), { ...state, loading: true, error: null });
});

test("beginLoadMore is a no-op while already loading", () => {
  const state = { ...initialBrowseState(filters()), loading: true };
  assert.equal(beginLoadMore(state), state);
});

test("beginLoadMore is a no-op once the source reports no more pages", () => {
  const state = { ...initialBrowseState(filters()), hasMore: false };
  assert.equal(beginLoadMore(state), state);
});

test("mergePage appends items, advances the page, and adopts has_more", () => {
  const state = beginLoadMore(initialBrowseState(filters()));
  const response = { items: [item({ id: "1" }), item({ id: "2" })], page: 0, has_more: true };
  const next = mergePage(state, filters(), 0, response);
  assert.equal(next.items.length, 2);
  assert.equal(next.page, 1);
  assert.equal(next.hasMore, true);
  assert.equal(next.loading, false);
});

test("mergePage drops items already present instead of duplicating them", () => {
  const state = { ...beginLoadMore(initialBrowseState(filters())), items: [item({ id: "1" })] };
  const next = mergePage(state, filters(), 0, { items: [item({ id: "1" }), item({ id: "2" })], page: 0, has_more: false });
  assert.deepEqual(next.items.map((i) => i.id), ["1", "2"]);
});

test("mergePage ignores a response for filters the caller has since changed away from", () => {
  const state = beginLoadMore(initialBrowseState(filters()));
  const stale = mergePage(state, filters({ sort: "newest" }), 0, { items: [item()], page: 0, has_more: false });
  assert.equal(stale, state);
});

test("mergePage ignores a response for a page the state is no longer waiting on", () => {
  const state = beginLoadMore(initialBrowseState(filters()));
  const stale = mergePage(state, filters(), 5, { items: [item()], page: 5, has_more: false });
  assert.equal(stale, state);
});

test("failLoadMore records the error message and stops loading, subject to the same staleness guard", () => {
  const state = beginLoadMore(initialBrowseState(filters()));
  const failed = failLoadMore(state, filters(), 0, "Divoom is unavailable right now.");
  assert.deepEqual(failed, { ...state, loading: false, error: "Divoom is unavailable right now." });
  assert.equal(failLoadMore(state, filters({ source: "awtrix" }), 0, "ignored"), state);
});

test("filterItemsByTitle matches case-insensitively and passes everything through for a blank query", () => {
  const items = [item({ id: "1", title: "Sunny Cloud" }), item({ id: "2", title: "Coffee cup" })];
  assert.deepEqual(filterItemsByTitle(items, "cloud").map((i) => i.id), ["1"]);
  assert.deepEqual(filterItemsByTitle(items, "  ").map((i) => i.id), ["1", "2"]);
});

test("resolveSort keeps a requested sort the source actually offers", () => {
  assert.equal(resolveSort([{ id: "popular" }, { id: "newest" }], "popular", "newest"), "newest");
});

test("resolveSort falls back to the default when the requested sort isn't offered", () => {
  assert.equal(resolveSort([{ id: "recommended" }, { id: "new" }], "recommended", "popular"), "recommended");
});

test("itemKey combines source and id so the same id from two sources never collides", () => {
  assert.notEqual(itemKey({ source: "lametric", id: "1" }), itemKey({ source: "awtrix", id: "1" }));
});

test("formatCount compacts thousands and millions and trims a trailing .0", () => {
  assert.equal(formatCount(4), "4");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1k");
  assert.equal(formatCount(1500), "1.5k");
  assert.equal(formatCount(999_999), "1000k");
  assert.equal(formatCount(1_000_000), "1M");
  assert.equal(formatCount(2_500_000), "2.5M");
});

test("formatCount floors a negative input at 0", () => {
  assert.equal(formatCount(-5), "0");
});

test("tileMetaLine composes author and counts as one capitalised sentence", () => {
  assert.equal(tileMetaLine({ author: "Marcus", likes: 1200, downloads: null }), "By Marcus, 1.2k likes");
  assert.equal(tileMetaLine({ author: "Marcus", likes: null, downloads: null }), "By Marcus");
  assert.equal(tileMetaLine({ author: null, likes: 88, downloads: null }), "88 likes");
  assert.equal(tileMetaLine({ author: null, likes: 10, downloads: 20 }), "10 likes and 20 downloads");
});

test("tileMetaLine is null when the item has no author, likes, or downloads", () => {
  assert.equal(tileMetaLine({ author: null, likes: null, downloads: null }), null);
  assert.equal(tileMetaLine({}), null);
});
