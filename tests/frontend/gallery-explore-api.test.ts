import { test } from "node:test";
import assert from "node:assert/strict";
import { exploreLayoutLabel, exploreLayoutOptions, exploreSearchRequest, exploreSourceLabel, exploreTileAspect, fitsClockExactly, orderedExploreSources, type ExploreSource } from "../../frontend/src/lib/gallery-explore-api.ts";

function source(id: string, configured = true): ExploreSource {
  return { id, name: id, configured, requires_account: id === "divoom", sorts: [], default_sort: "featured", sizes: [], supports_search: true, homepage: "https://example.test" };
}

test("source-grid requests carry category and one-based server paging", () => {
  assert.deepEqual(exploreSearchRequest("entry-1", {
    source: "iledclock",
    sort: "featured",
    page: 2,
    query: "  fire  ",
    category: "festival",
    size: "32x16",
    animatedOnly: true,
  }), {
    type: "iledclock/gallery/search",
    entry_id: "entry-1",
    source: "iledclock",
    sort: "featured",
    page: 3,
    query: "fire",
    category: "festival",
    size: "32x16",
    animated_only: true,
  });
});

test("configured source pills follow the requested order and labels", () => {
  const sources = [source("divoom"), source("awtrix"), source("iledclock", false), source("iledclock_anim"), source("lametric")];
  assert.deepEqual(orderedExploreSources(sources).map((item) => item.id), ["iledclock_anim", "lametric", "awtrix", "divoom"]);
  assert.deepEqual(orderedExploreSources(sources).map((item) => exploreSourceLabel(item)), ["Animations", "LaMetric", "AWTRIX", "Divoom"]);
});

test("explicit non-native metadata overrides matching dimensions", () => {
  assert.equal(fitsClockExactly({ native_fit: true, width: 1, height: 1 }), true);
  assert.equal(fitsClockExactly({ native_fit: false, width: 32, height: 16 }), false);
  assert.equal(fitsClockExactly({ width: 32, height: 16 }), true);
  assert.equal(fitsClockExactly({ width: 16, height: 16 }), false);
});
test("Explore tile aspect follows artwork dimensions", () => {
  assert.equal(exploreTileAspect({ width: 32, height: 16 }), "design");
  assert.equal(exploreTileAspect({ width: 8, height: 8 }), "square");
  assert.equal(exploreTileAspect({ width: 16, height: 16 }), "square");
  assert.equal(exploreTileAspect({ width: 32, height: 8 }), "design");
});

test("layout pills include only supported Explore choices in display order", () => {
  const options = exploreLayoutOptions(["mirror", "icon_with_clock", "fill", "center", "tile", "stretch", "fit"]);
  assert.deepEqual(options, ["auto", "fit", "fill", "tile", "icon_with_clock"]);
  assert.deepEqual(options.map((layout) => exploreLayoutLabel(layout)), ["Auto", "Fit", "Fill", "Tile", "With clock"]);
});
