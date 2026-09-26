import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampAdjustOffset,
  clampAdjustScale,
  filenameForUrl,
  galleryImportRequest,
  galleryItemUrl,
  galleryLayoutLabel,
  galleryPreviewRequest,
  gallerySearchRequest,
  gallerySourcesRequest,
  importFileExtension,
  importFileRequest,
  isAcceptedImportFile,
  isImportFileSaved,
  isRasterImportFile,
  isSignedPathFresh,
  normalizeAdjustOptions,
  validateImportFile,
  type SignedPathEntry,
} from "../../frontend/src/lib/gallery-api.ts";

test("gallerySourcesRequest carries the entry id under the exact Contract message type", () => {
  assert.deepEqual(gallerySourcesRequest("entry-1"), { type: "iledclock/gallery/sources", entry_id: "entry-1" });
});

test("gallerySearchRequest omits optional fields the caller didn't provide", () => {
  assert.deepEqual(gallerySearchRequest("entry-1", { source: "lametric", sort: "popular", page: 0 }), {
    type: "iledclock/gallery/search",
    entry_id: "entry-1",
    source: "lametric",
    sort: "popular",
    page: 0,
  });
});

test("gallerySearchRequest includes query/size/animated_only only when truthy", () => {
  const msg = gallerySearchRequest("entry-1", { source: "awtrix", sort: "newest", page: 2, query: "flame", size: "32x8", animatedOnly: true });
  assert.deepEqual(msg, { type: "iledclock/gallery/search", entry_id: "entry-1", source: "awtrix", sort: "newest", page: 2, query: "flame", size: "32x8", animated_only: true });
});

test("gallerySearchRequest drops a blank query and a false animatedOnly rather than sending empty/false fields", () => {
  const msg = gallerySearchRequest("entry-1", { source: "awtrix", sort: "newest", page: 0, query: "", animatedOnly: false });
  assert.equal("query" in msg, false);
  assert.equal("animated_only" in msg, false);
});

test("galleryPreviewRequest omits an empty options object", () => {
  assert.deepEqual(galleryPreviewRequest("entry-1", "lametric", "42"), { type: "iledclock/gallery/preview", entry_id: "entry-1", source: "lametric", id: "42" });
  assert.deepEqual(galleryPreviewRequest("entry-1", "lametric", "42", {}), { type: "iledclock/gallery/preview", entry_id: "entry-1", source: "lametric", id: "42" });
});

test("galleryPreviewRequest carries a non-empty options object through", () => {
  const msg = galleryPreviewRequest("entry-1", "lametric", "42", { layout: "fit", enhance: true });
  assert.deepEqual(msg.options, { layout: "fit", enhance: true });
});

test("galleryImportRequest includes name only when given", () => {
  assert.deepEqual(galleryImportRequest("entry-1", "lametric", "42"), { type: "iledclock/gallery/import", entry_id: "entry-1", source: "lametric", id: "42" });
  assert.deepEqual(galleryImportRequest("entry-1", "lametric", "42", undefined, "My icon"), {
    type: "iledclock/gallery/import",
    entry_id: "entry-1",
    source: "lametric",
    id: "42",
    name: "My icon",
  });
});

test("importFileRequest maps camelCase params onto the wire's snake_case fields", () => {
  const msg = importFileRequest("entry-1", { filename: "cat.gif", dataB64: "Zm9v", save: true, name: "Cat" });
  assert.deepEqual(msg, { type: "iledclock/import/file", entry_id: "entry-1", filename: "cat.gif", data_b64: "Zm9v", save: true, name: "Cat" });
});

test("importFileRequest omits save/name/options when not provided", () => {
  const msg = importFileRequest("entry-1", { filename: "cat.gif", dataB64: "Zm9v" });
  assert.deepEqual(msg, { type: "iledclock/import/file", entry_id: "entry-1", filename: "cat.gif", data_b64: "Zm9v" });
});

test("clampAdjustScale rounds and bounds into [1, 16]", () => {
  assert.equal(clampAdjustScale(0), 1);
  assert.equal(clampAdjustScale(3.6), 4);
  assert.equal(clampAdjustScale(100), 16);
});

test("clampAdjustOffset rounds and bounds into [-512, 512]", () => {
  assert.equal(clampAdjustOffset(-9999), -512);
  assert.equal(clampAdjustOffset(9999), 512);
  assert.equal(clampAdjustOffset(2.4), 2);
});

test("normalizeAdjustOptions only carries through fields the caller actually set", () => {
  assert.deepEqual(normalizeAdjustOptions({}, 32, 16), {});
  assert.deepEqual(normalizeAdjustOptions({ enhance: false }, 32, 16), { enhance: false });
});

test("normalizeAdjustOptions clamps crop into the source's own bounds", () => {
  const out = normalizeAdjustOptions({ crop: { x: -5, y: 0, w: 999, h: 8 } }, 32, 16);
  assert.deepEqual(out.crop, { x: 0, y: 0, w: 32, h: 8 });
});

test("normalizeAdjustOptions clamps scale, offset, and the background colour", () => {
  const out = normalizeAdjustOptions({ scale: 99, offset: { x: -9999, y: 9999 }, background: [-10, 300, 128.6] }, 32, 16);
  assert.deepEqual(out.scale, 16);
  assert.deepEqual(out.offset, { x: -512, y: 512 });
  assert.deepEqual(out.background, [0, 255, 129]);
});

test("galleryLayoutLabel returns the known display label", () => {
  assert.equal(galleryLayoutLabel("auto"), "Auto");
  assert.equal(galleryLayoutLabel("fit"), "Fit");
});

test("galleryLayoutLabel title-cases an unrecognised layout instead of crashing", () => {
  assert.equal(galleryLayoutLabel("smear"), "Smear");
  assert.equal(galleryLayoutLabel(""), "");
});

test("galleryLayoutLabel turns an unrecognised snake_case composed layout id into title-cased words", () => {
  assert.equal(galleryLayoutLabel("icon_with_clock"), "Icon With Clock");
  assert.equal(galleryLayoutLabel("icon-beside-date"), "Icon Beside Date");
});

test("galleryItemUrl prefers the item's own url, falling back to the source homepage", () => {
  assert.equal(galleryItemUrl({ url: "https://awtrix.de/icons/flame" }, { homepage: "https://awtrix.de/icons" }), "https://awtrix.de/icons/flame");
  assert.equal(galleryItemUrl({ url: null }, { homepage: "https://developer.lametric.com/icons" }), "https://developer.lametric.com/icons");
  assert.equal(galleryItemUrl({ url: null }, undefined), undefined);
});

test("importFileExtension lowercases and handles no-extension names", () => {
  assert.equal(importFileExtension("Cat.GIF"), "gif");
  assert.equal(importFileExtension("noext"), "");
});

test("isRasterImportFile is true only for browser-decodable formats", () => {
  for (const name of ["a.gif", "a.png", "a.jpg", "a.jpeg", "a.webp"]) assert.equal(isRasterImportFile(name), true, name);
  for (const name of ["a.aseprite", "a.ase", "a.piskel"]) assert.equal(isRasterImportFile(name), false, name);
});

test("isAcceptedImportFile covers raster and opaque formats, rejects anything else", () => {
  for (const name of ["a.gif", "a.aseprite", "a.piskel"]) assert.equal(isAcceptedImportFile(name), true, name);
  assert.equal(isAcceptedImportFile("a.bmp"), false);
  assert.equal(isAcceptedImportFile("a.txt"), false);
});

test("validateImportFile rejects an unsupported extension before checking size", () => {
  assert.match(validateImportFile("a.bmp", 10)!, /supported type/);
});

test("validateImportFile rejects a file over the 8 MB cap", () => {
  assert.match(validateImportFile("a.gif", 9 * 1024 * 1024)!, /too large/);
});

test("validateImportFile accepts a supported, small-enough file", () => {
  assert.equal(validateImportFile("a.gif", 1024), null);
});

test("filenameForUrl keeps the URL's own extension when it has one", () => {
  assert.equal(filenameForUrl("https://awtrix.de/icons/flame.gif", "image/gif"), "flame.gif");
});

test("filenameForUrl guesses an extension from the MIME type when the URL path has no extension of its own", () => {
  assert.equal(filenameForUrl("https://example.com/render?id=42", "image/png"), "render.png");
});

test("filenameForUrl falls back to a generic name for an unparsable URL", () => {
  assert.equal(filenameForUrl("not a url", "image/webp"), "image.webp");
});

test("isImportFileSaved distinguishes a preview payload from a saved design_id", () => {
  assert.equal(isImportFileSaved({ design_id: "design-1" }), true);
  assert.equal(isImportFileSaved({ frames: [], delays_ms: [], layout: "auto", layouts_available: ["auto"], report: {} as never }), false);
});

test("isSignedPathFresh is true only with enough validity left past the refresh margin", () => {
  const now = 1_000_000;
  const fresh: SignedPathEntry = { signedPath: "/x?authSig=1", expiresAtMs: now + 60_000 };
  const almostExpired: SignedPathEntry = { signedPath: "/x?authSig=1", expiresAtMs: now + 5_000 };
  assert.equal(isSignedPathFresh(fresh, now), true);
  assert.equal(isSignedPathFresh(almostExpired, now), false);
  assert.equal(isSignedPathFresh(undefined, now), false);
});
