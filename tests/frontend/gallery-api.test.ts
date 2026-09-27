import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampAdjustOffset,
  clampAdjustScale,
  filenameForUrl,
  galleryImportRequest,
  galleryItemUrl,
  GALLERY_LAYOUTS,
  galleryLayoutLabel,
  galleryPreviewRequest,
  gallerySearchRequest,
  describeAutoFit,
  gallerySourcesRequest,
  importFileExtension,
  importFileRequest,
  isAcceptedImportFile,
  isImportFileSaved,
  isRasterImportFile,
  isSignedPathFresh,
  normalizeAdjustOptions,
  SignedMediaCache,
  SIGNED_PATH_TTL_S,
  validateImportFile,
  type SignedPathEntry,
} from "../../frontend/src/lib/gallery-api.ts";

test("gallerySourcesRequest carries the entry id under the exact Contract message type", () => {
  assert.deepEqual(gallerySourcesRequest("entry-1"), { type: "iledclock/gallery/sources", entry_id: "entry-1" });
});

test("gallerySearchRequest omits optional fields the caller didn't provide, and sends 1-based pages", () => {
  // Regression: the first page went out as page 0 and the server (1-based) rejected it.
  assert.deepEqual(gallerySearchRequest("entry-1", { source: "lametric", sort: "popular", page: 0 }), {
    type: "iledclock/gallery/search",
    entry_id: "entry-1",
    source: "lametric",
    sort: "popular",
    page: 1,
  });
});

test("gallerySearchRequest includes query/size/animated_only only when truthy", () => {
  const msg = gallerySearchRequest("entry-1", { source: "awtrix", sort: "newest", page: 2, query: "flame", size: "32x8", animatedOnly: true });
  assert.deepEqual(msg, { type: "iledclock/gallery/search", entry_id: "entry-1", source: "awtrix", sort: "newest", page: 3, query: "flame", size: "32x8", animated_only: true });
});

test("gallerySearchRequest drops a blank query and a false animatedOnly rather than sending empty/false fields", () => {
  const msg = gallerySearchRequest("entry-1", { source: "awtrix", sort: "newest", page: 0, query: "", animatedOnly: false });
  assert.equal("query" in msg, false);
  assert.equal("animated_only" in msg, false);
});

test("galleryPreviewRequest omits an empty options object", () => {
  assert.deepEqual(galleryPreviewRequest("entry-1", "lametric", "42"), { type: "iledclock/gallery/preview", entry_id: "entry-1", source: "lametric", item_id: "42" });
  assert.deepEqual(galleryPreviewRequest("entry-1", "lametric", "42", {}), { type: "iledclock/gallery/preview", entry_id: "entry-1", source: "lametric", item_id: "42" });
});

test("galleryPreviewRequest carries a non-empty options object through", () => {
  const msg = galleryPreviewRequest("entry-1", "lametric", "42", { layout: "fit", enhance: true });
  assert.deepEqual(msg.options, { layout: "fit", enhance: true });
});

test("galleryImportRequest includes name only when given", () => {
  assert.deepEqual(galleryImportRequest("entry-1", "lametric", "42"), { type: "iledclock/gallery/import", entry_id: "entry-1", source: "lametric", item_id: "42" });
  assert.deepEqual(galleryImportRequest("entry-1", "lametric", "42", undefined, "My icon"), {
    type: "iledclock/gallery/import",
    entry_id: "entry-1",
    source: "lametric",
    item_id: "42",
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
  assert.equal(galleryLayoutLabel("icon_with_clock"), "With clock");
  assert.ok(GALLERY_LAYOUTS.includes("icon_with_clock"));
});

test("galleryLayoutLabel title-cases an unrecognised layout instead of crashing", () => {
  assert.equal(galleryLayoutLabel("smear"), "Smear");
  assert.equal(galleryLayoutLabel(""), "");
});

test("galleryLayoutLabel turns an unrecognised snake_case composed layout id into title-cased words", () => {
  assert.equal(galleryLayoutLabel("icon_beside_date"), "Icon Beside Date");
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
  for (const name of ["a.gif", "a.aseprite", "a.ase", "a.piskel"]) assert.equal(isAcceptedImportFile(name), true, name);
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

test("isSignedPathFresh requires at least 60 seconds remaining", () => {
  const now = 1_000_000;
  const fresh: SignedPathEntry = { signedPath: "/x?authSig=1", expiresAtMs: now + 60_001 };
  const atMargin: SignedPathEntry = { signedPath: "/x?authSig=1", expiresAtMs: now + 60_000 };
  const almostExpired: SignedPathEntry = { signedPath: "/x?authSig=1", expiresAtMs: now + 59_999 };
  assert.equal(isSignedPathFresh(fresh, now), true);
  assert.equal(isSignedPathFresh(atMargin, now), true);
  assert.equal(isSignedPathFresh(almostExpired, now), false);
  assert.equal(isSignedPathFresh(undefined, now), false);
});

test("SignedMediaCache refreshes near-expiry paths and can force a retry signature", async () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  const requests: Record<string, unknown>[] = [];
  const signedPaths = ["/x?authSig=1", "/x?authSig=2", "/x?authSig=3"];
  const hass = {
    callWS: async (request: Record<string, unknown>) => {
      requests.push(request);
      return { path: signedPaths.shift()! };
    },
  } as never;
  const cache = new SignedMediaCache();

  try {
    assert.equal(await cache.sign(hass, "/x"), "/x?authSig=1");
    now += SIGNED_PATH_TTL_S * 1000 - 60_000;
    assert.equal(await cache.sign(hass, "/x"), "/x?authSig=1");
    assert.equal(requests.length, 1);

    now += 1;
    assert.equal(await cache.sign(hass, "/x"), "/x?authSig=2");
    assert.equal(requests.length, 2);

    assert.equal(await cache.signFresh(hass, "/x"), "/x?authSig=3");
    assert.equal(await cache.sign(hass, "/x"), "/x?authSig=3");
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[0], { type: "auth/sign_path", path: "/x", expires: SIGNED_PATH_TTL_S });
  } finally {
    Date.now = realNow;
  }
});

test("no request builder sends a top-level `id` (HA reserves it for the WebSocket message id)", () => {
  // Regression: `hass.callWS` overwrites `id` with its own message counter, so a field named `id`
  // silently never reached the server, and HA rejected the command as invalid.
  const requests = [
    galleryPreviewRequest("e", "lametric", "42"),
    galleryImportRequest("e", "lametric", "42", undefined, "n"),
  ];
  for (const r of requests) assert.equal("id" in r, false, JSON.stringify(r));
});

test("describeAutoFit explains the server's auto decision in plain words", () => {
  assert.equal(describeAutoFit(["trimmed shared border to (0, 1, 32, 8)", "auto layout chose center-like (small)"]), "Auto: shown pixel for pixel, centred on the clock.");
  assert.equal(describeAutoFit(["auto layout chose majority-pool-x4"]), "Auto: scaled down 4x, keeping every pixel edge sharp.");
  assert.equal(describeAutoFit(["auto layout chose fit-like (photo)"]), "Auto: fitted as a photo, colours boosted for the LEDs.");
  assert.equal(describeAutoFit(["no auto here"]), null);
});
