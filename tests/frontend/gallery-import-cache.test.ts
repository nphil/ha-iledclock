import { test } from "node:test";
import assert from "node:assert/strict";
import { GalleryImportCache, galleryImportCacheKey } from "../../frontend/src/lib/gallery-import-cache.ts";
import type { GalleryAdjustOptions } from "../../frontend/src/lib/gallery-api.ts";

const defaultOptions: GalleryAdjustOptions = { layout: "fit", offset: { x: 2, y: -1 }, enhance: true };

test("the same source item and options share one import result", async () => {
  const cache = new GalleryImportCache();
  let calls = 0;
  const importDesign = async () => {
    calls++;
    await Promise.resolve();
    return "design-1";
  };
  const [first, second] = await Promise.all([
    cache.getOrImport("iledclock", "festival/fireworks.gif", defaultOptions, importDesign),
    cache.getOrImport("iledclock", "festival/fireworks.gif", { enhance: true, offset: { y: -1, x: 2 }, layout: "fit" }, importDesign),
  ]);
  assert.deepEqual([first, second], ["design-1", "design-1"]);
  assert.equal(calls, 1);
});

test("different adjustment options do not reuse a saved design", async () => {
  const cache = new GalleryImportCache();
  let calls = 0;
  const importDesign = async () => `design-${++calls}`;
  const first = await cache.getOrImport("iledclock", "heart.gif", defaultOptions, importDesign);
  const second = await cache.getOrImport("iledclock", "heart.gif", { ...defaultOptions, scale: 2 }, importDesign);
  assert.deepEqual([first, second], ["design-1", "design-2"]);
  assert.notEqual(galleryImportCacheKey("iledclock", "heart.gif", defaultOptions), galleryImportCacheKey("iledclock", "heart.gif", { ...defaultOptions, scale: 2 }));
});

test("a failed import is removed so the next attempt can retry", async () => {
  const cache = new GalleryImportCache();
  let calls = 0;
  await assert.rejects(cache.getOrImport("awtrix", "icon-7", {}, async () => {
    calls++;
    throw new Error("temporary failure");
  }), /temporary failure/);
  const recovered = await cache.getOrImport("awtrix", "icon-7", {}, async () => {
    calls++;
    return "recovered";
  });
  assert.equal(recovered, "recovered");
  assert.equal(calls, 2);
});

test("deleted designs invalidate cached imports across gallery instances", async () => {
  const first = new GalleryImportCache();
  const second = new GalleryImportCache();
  let calls = 0;
  const importDesign = async () => `design-${++calls}`;
  assert.equal(await first.getOrImport("awtrix", "deleted-icon", {}, importDesign), "design-1");
  GalleryImportCache.clearAll();
  assert.equal(await second.getOrImport("awtrix", "deleted-icon", {}, importDesign), "design-2");
  assert.equal(calls, 2);
});
