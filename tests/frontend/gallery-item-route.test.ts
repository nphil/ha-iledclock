import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStudioRoute, serializeStudioRoute } from "../../frontend/src/lib/route.ts";
import { parseGalleryItemRoute, serializeGalleryItemRoute } from "../../frontend/src/lib/gallery-item-route.ts";

test("item route codec preserves source-local paths and colons", () => {
  const item = { source: "iledclock", id: "festival:night/fireworks.gif" };
  const routeValue = serializeGalleryItemRoute(item.source, item.id);
  assert.deepEqual(parseGalleryItemRoute(routeValue), item);
  const route = parseStudioRoute(serializeStudioRoute({ destination: "explore", item: routeValue }));
  assert.deepEqual(parseGalleryItemRoute(route.item), item);
});

test("malformed item route values do not open a sheet", () => {
  assert.equal(parseGalleryItemRoute(undefined), null);
  assert.equal(parseGalleryItemRoute("iledclock:"), null);
  assert.equal(parseGalleryItemRoute(":art"), null);
});
