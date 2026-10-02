# Online gallery + smart import — contract (2026-09-26)

Nitin's request: browse popular online pixel-art galleries from HA, sort by popularity / downloads / new, download other
people's creations, and have them **automatically adapted to fit and work properly on the 32×16 clock**. The browsing UI must
be clean and nice. Also: a proper crop/position step for his own GIFs/photos, and import of `.aseprite/.ase` and `.piskel`
files for power users. Beginner-first, power-user-capable.

## Sources (verified 2026-09-26)

| id | Source | Access | Sorts (source-native) | Sizes | Notes |
|---|---|---|---|---|---|
| `lametric` | LaMetric icon gallery | Official public API, no auth: `GET https://developer.lametric.com/api/v2/icons?page=&page_size=&order=popular\|newest\|title&fields=` (max 2000). Media uses each catalog row’s URL (8×8 GIF/PNG). | popular, newest, title | 8×8 | The API honors all three requested orders; cache the catalog for 24 h per order, then filter and paginate locally. |
| `awtrix` | AWTRIX Hub `https://awtrix.de/icons` | Public Laravel Livewire page (no documented JSON API); URL parameters drive `query`, `sort`, `size`, `animated`, and `page`. Media: `/<slug>/preview.webp` (animated/upscaled WebP). | newest, popular (Most downloaded), picked (Hand-picked), name (A–Z) | 8×8, 32×8 | 24 items/page; exact filter/page responses are cached for 1 h. Listing, detail and media requests share a ≤1 request/second limit. |
| `divoom` | Divoom Cloud gallery (700k+ designs, the biggest) | **Unofficial**, community-reverse-engineered (`app.divoom-gz.com`). Needs a free Divoom account (email + MD5 password). Request shapes are based on apixoo (MIT) and servoom (Apache-2.0); see /NOTICE. | recommended, new, popular/most-liked | 16×16, 32×32, 64×64 | Enabled only when account details are set. Auth tokens stay in memory for up to 15 min and refresh on rejection; failed upstream requests have bounded retries. Media is decoded to GIF; decoder captures cover formats 3 and 4. |
| `iledclock` | iLedClock originals | CoolLEDX config → localized categories for the hardware profile’s `16x32` panel → per-category `list_{lang}.json` (English fallback) → GIF media. Bytes 0–31 are XORed with `0xDA`. | featured | 32×16 | Item ids are `<category>/<filename>`; page locally at 48 items. Catalog refreshes every 12 h; original media is cached by the authenticated HA proxy. |
| `iledclock_anim` | iLedClock animations | CoolLEDX static/dynamic `data1632` JSON feeds decode the vendor’s packed RGB planes into standard GIFs. | featured | 32×16 | Static and Dynamic categories; ids include the feed version so catalog refreshes do not change identity within a version. GIF frames and delays are decoded from the payload. |

## Backend (owner: GalleryEngine) — `custom_components/iledclock/gallery/**`, `custom_components/iledclock/adapt.py`, `custom_components/iledclock/importers/**`, `tests/gallery/**`

Pure-Python modules (no homeassistant imports) for sources' parsing, decoding and adaptation; a thin HA layer for HTTP + WS.

### Adaptation pipeline (`adapt.py`, pure, fully tested) — the heart of "fits and works properly"
Input: decoded frames (RGBA, any size) + per-frame delays (ms). Output: `Adapted{frames: list[32×16 RGB888], delays_ms, layout,
layouts_available, report}` where `report` = `{native_size, detected_scale, trimmed_box, frames_in, frames_out, duration_in_ms,
duration_out_ms, notes[]}`.
1. **Recover true pixels**: detect the integer upscale factor of pixel art (largest k where every k×k block is uniform, tolerant to
   ≤2% noisy blocks from GIF/JPEG artefacts) and downsample by it. A 45 px LaMetric thumb becomes its real 8×8.
2. **Trim**: crop fully transparent (or uniform-background) borders across ALL frames (one shared box so animation doesn't jitter).
3. **Transparency**: composite on black (black = LED off), option for a background colour.
4. **Fit to 32×16 by layout** (all crisp, never blurry, for pixel art):
   - `auto` (default): chooses by aspect/size — ≤16 px tall art at 1:1 centered; 32×8 art 1:1 vertically centered; square
     art >16 px downscaled by an integer factor to ≤16 px using **majority (mode) pooling** (keeps 1-px lines and outlines), then
     centered; photos/non-pixel-art use area-average + optional ordered dither.
   - `center` (1:1, crop if larger), `fit` (contain), `fill` (cover, crop around a focus point — default centre of the
     content's bounding box), `stretch`, `tile` (repeat small icons across the width), `mirror` (icon + mirrored icon), and
     `icon_with_clock` (art on the left, with a native clock region reserved to its right).
   - Power-user overrides: explicit `crop {x,y,w,h}` in source pixels, `scale` (integer), `offset {x,y}`, `background`.
5. **Make it readable on LEDs**: the clock shows RGB444; near-black non-background pixels would vanish, so lift any content
   pixel whose max channel <`0x20` to the minimum visible level; optional saturation/contrast boost (`enhance: true` default for
   photos, false for pixel art). Previews quantise exactly like the device (frontend `lib/color.ts`, same mapping as
   `protocol.render.quantize`).
6. **Timing**: merge identical consecutive frames (sum their delays); clamp each delay to [20 ms, 10 000 ms]; if frames >
   `const.DESIGN_MAX_FRAMES` (64) decimate evenly while preserving total loop duration; report what changed in `notes`.
7. **Playback is not part of adaptation.** `adapt()` always returns the animation at its authored timing. How fast it plays and whether
   in-between frames are added (`retime.py`: the design's Speed slider and Smooth motion) are applied on top, at preview and at upload,
   from the design's `speed` / `smooth`. They are NOT in `options`, so the import cache key (`lib/gallery-import-cache.ts`) is unchanged:
   the Explore and Import sheets preview a setting with `iledclock/playback/preview` (inline adapted frames) and, when the user shows or
   saves the item, store it on the imported design with `iledclock/designs/set_playback`.

### Importers (`importers/`, pure)
- `gif.py`/Pillow: GIF (animated), PNG (incl. APNG if Pillow supports it), JPEG, WebP (animated).
- `aseprite.py`: `.ase/.aseprite` per the official spec (github.com/aseprite/aseprite docs/ase-file-specs.md): RGBA/indexed/
  grayscale, visible layers composited with opacity & blend normal, frames with durations, zlib cels, linked cels; tags ignored.
- `piskel.py`: `.piskel` JSON (layers with base64 PNG spritesheets per layer, fps).

### HA layer
- `gallery/__init__.py`: `async_setup_gallery(hass)` (called ONCE from the integration's `async_setup`), registers the WS
  commands below and an authenticated HTTP view `/api/iledclock/gallery/media/{source}/{item_id}` that proxies + caches original
  media (and Divoom-decoded GIFs) so the browser never talks to third parties (works in the iOS app; no CORS). The frontend
  signs URLs with WS `auth/sign_path`. Disk cache under `<config>/.storage/iledclock_gallery/` with an LRU byte cap (64 MB) and
  per-source TTLs and stale-while-revalidate catalog refresh; CoolLEDX catalogs refresh every 12 h.
  Successful media is cached in the 64 MB LRU; Divoom decode failures are cached for 5 min. Media requests are limited to four per source, return 404/502/504, and have a 12 s proxy deadline; image and animation decoding runs in an executor.
- Divoom credentials: read `entry.options["divoom_email"]` and `entry.options["divoom_password_md5"]` (HaIntegration adds these
  optional fields to the options flow and stores only the MD5 of the password). Source is "not configured" otherwise.

### WebSocket API (GalleryUI consumes; any `entry_id` of the integration is accepted for account lookup)
- `iledclock/gallery/sources {entry_id}` → `[{id, name, configured, requires_account, sorts:[{id,label}], default_sort,
  sizes:[...], supports_search, homepage, categories:[{id,label}], kind:"native"|"adapted"}]`
- `iledclock/gallery/search {entry_id, source, sort, page, query?, size?, category?, animated_only?}` →
  `{items:[{source, id, title, author?, width, height, animated, category?, frames?, native_fit?, likes?, downloads?, created?, media_path}], page, has_more}`.
  (`media_path` is unsigned; iLedClock material ids include `<category>/<filename>`.)
- `iledclock/gallery/shelves {entry_id}` → `[{id, title, source, category?, sort?}]`; the client fills each shelf using `search`.
- `iledclock/gallery/preview {entry_id, source, item_id, options?}` → `{frames:[b64 RGB888 1536 B], delays_ms:[...], layout,
  layouts_available:[...], report}`; `options` = `{layout?, crop?, scale?, offset?, background?, enhance?}`
- `iledclock/gallery/import {entry_id, source, item_id, options?, name?}` (admin) → `{design_id}` — saves to the design library
  with `origin: {source, id, title, author, url}` for credit.
- `iledclock/import/file {entry_id, filename, data_b64, options?, save?: bool, name?}` (admin when save) → preview payload, or
  `{design_id}` when `save`. Max upload 8 MB.

## Frontend (owner: GalleryUI) — `frontend/src/components/iledclock-gallery-browser.ts`, `iledclock-gallery-item-sheet.ts`,
`iledclock-import-sheet.ts`, `frontend/src/lib/gallery-*.ts`, `tests/frontend/gallery-*.test.ts`

Design: Lucent via `languages/lucent/ha.css` (HA theme supplies colours; `<ha-card>`/HA controls; container queries; 48 px
targets; reduced motion). Read `/data/agent/managed-skills/design-language/SKILL.md` + `languages/lucent/LANGUAGE.md` first.
- **Browser**: search field; source pills (All installed sources that are configured; unconfigured Divoom shows a quiet "Add a
  free Divoom account to browse 700k+ designs" row linking to the integration options); sort chips from the source's `sorts`
  (only what it supports: Popular · Most downloaded · New · Hand-picked · A–Z); filters (Animated only, size); responsive grid
  of square tiles showing the art crisp (`image-rendering: pixelated`) on a dark LED plate, animating only while visible
  (IntersectionObserver) and never under reduced motion; title + author + likes/downloads on the tile; infinite scroll with a
  calm skeleton; honest empty/error states per source.
- **Item sheet**: large LED-look preview of the ADAPTED 32×16 result (what the clock will really show, RGB444-quantised,
  animated), layout pills (Auto default + available layouts), "Adjust" disclosure for power users (crop, scale, offset,
  background, enhance), credit line + link to the original, actions: "Save to library" (secondary) and "Show on clock"
  (primary, hold-to-confirm, since it replaces what's showing; uses existing `iledclock/show` with the new design id).
- **Import sheet** (for the user's own files and URLs): drop/pick file or paste URL → same preview + layout + adjust UI with a
  draggable crop box over the source image → Save / Show. Accepts GIF/PNG/JPEG/WebP/.aseprite/.ase/.piskel.
- Events to the host panel: `iledclock-open-design {design_id}` (open in editor), `iledclock-designs-changed`.

## Integration points (other owners)
- HaIntegration: call `await async_setup_gallery(hass)` once in `async_setup`; add optional options-flow fields `divoom_email`,
  `divoom_password` (store `divoom_password_md5` only; strings in strings.json/translations).
- StudioFrontend: add a "Gallery" destination to the studio panel nav mounting `<iledclock-gallery-browser .hass .entryId>`;
  the studio's Import action opens `<iledclock-import-sheet>`; handle `iledclock-open-design`. Do not build a second importer.
