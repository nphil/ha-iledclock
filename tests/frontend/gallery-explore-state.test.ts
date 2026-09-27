import { test } from "node:test";
import assert from "node:assert/strict";
import { beginLoadMore, browseFiltersEqual, initialBrowseState, mergePage, type BrowseFilters } from "../../frontend/src/lib/gallery-browse-state.ts";
import type { GalleryItem } from "../../frontend/src/lib/gallery-api.ts";

const base: BrowseFilters = { source: "iledclock", sort: "featured", query: "", size: undefined, animatedOnly: false, category: "festival" };
const item: GalleryItem = { source: "iledclock", id: "festival/fireworks.gif", title: "Fireworks", width: 32, height: 16, animated: true, media_path: "/media/fireworks" };

test("category participates in filter identity and prevents a stale page from merging", () => {
  const state = beginLoadMore(initialBrowseState(base));
  const changedCategory = { ...base, category: "creative" };
  assert.equal(browseFiltersEqual(base, changedCategory), false);
  assert.equal(mergePage(state, changedCategory, 0, { items: [item], page: 0, has_more: false }), state);
  const loaded = mergePage(state, base, 0, { items: [item], page: 0, has_more: true });
  assert.deepEqual(loaded.items.map((art) => art.id), [item.id]);
  assert.equal(loaded.page, 1);
  assert.equal(loaded.hasMore, true);
});
