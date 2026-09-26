# Online gallery + smart import — contract (2026-09-26)

Nitin's request: browse popular online pixel-art galleries from HA, sort by popularity / downloads / new, download other
people's creations, and have them **automatically adapted to fit and work properly on the 32×16 clock**. The browsing UI must
be clean and nice. Also: a proper crop/position step for his own GIFs/photos, and import of `.aseprite/.ase` and `.piskel`
files for power users. Beginner-first, power-user-capable.

## Sources (verified 2026-09-26)

| id | Source | Access | Sorts (source-native) | Sizes | Notes |
|---|---|---|---|---|---|
| `lametric` | LaMetric icon gallery | Official public API, no auth: `GET https://developer.lametric.com/api/v2/icons?page=&page_size=&order=popular\|newest\|title&fields=` (returns max 2000 total). Media: `item.url` (8×8 gif/png). | popular, newest, title | 8×8 | No server-side search: cache the full list (≤2000, refresh daily) and filter titles locally. |
| `awtrix` | AWTRIX Hub `https://awtrix.de/icons` | Public website (Laravel Livewire, no documented JSON API). Server-rendered listing honours `?sort=` (`popular` verified to reorder; find the exact values for newest / most downloaded / hand-picked / A–Z) and `?size=32x8`. Media: `https://awtrix.de/icons/<slug>.gif`. | newest, most downloaded, hand-picked, A–Z | 8×8, 32×8 | Find a stable way to search (Livewire payload or query param). If parsing HTML, keep the parser tiny and fixture-tested. Be polite: cache, ≤1 req/s. |
| `divoom` | Divoom Cloud gallery (700k+ designs, the biggest) | **Unofficial**, community-reverse-engineered (`app.divoom-gz.com`). Needs a free Divoom account (email + MD5 password). References: github.com/redphx/apixoo (MIT, login + category listing + PixelBean decoder), github.com/fabkury/servoom (Apache-2.0, FILE_FORMATS.md + FORUM_API.md, decoders for all formats incl. AES/LZO/zstd variants), divoom.2a03.party/api/app.html. | recommended, new, popular/most-liked (whatever categories the API exposes) | 16×16, 32×32, 64×64 | Enabled only when the account is set in the integration options. Isolate failures: if Divoom changes its API, only this source shows "Divoom is unavailable right now", nothing else breaks. Credit authors. Port decoders with attribution (NOTICE file). |

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
     content's bounding box), `stretch`, `tile` (repeat small icons across the width), `mirror` (icon + mirrored icon).
   - Power-user overrides: explicit `crop {x,y,w,h}` in source pixels, `scale` (integer), `offset {x,y}`, `background`.
5. **Make it readable on LEDs**: the clock shows RGB444; near-black non-background pixels would vanish, so lift any content
   pixel whose max channel <`0x20` to the minimum visible level; optional saturation/contrast boost (`enhance: true` default for
   photos, false for pixel art). Previews quantise exactly like the device (frontend `lib/color.ts`, same mapping as
   `protocol.render.quantize`).
6. **Timing**: merge identical consecutive frames (sum their delays); clamp each delay to [20 ms, 10 000 ms]; if frames >
   `const.DESIGN_MAX_FRAMES` (64) decimate evenly while preserving total loop duration; report what changed in `notes`.

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
  per-source TTLs. All network I/O via HA's shared aiohttp session, timeouts 10 s, never on the event loop for decoding
  (executor).
- Divoom credentials: read `entry.options["divoom_email"]` and `entry.options["divoom_password_md5"]` (HaIntegration adds these
  optional fields to the options flow and stores only the MD5 of the password). Source is "not configured" otherwise.

### WebSocket API (GalleryUI consumes; any `entry_id` of the integration is accepted for account lookup)
- `iledclock/gallery/sources {entry_id}` → `[{id, name, configured, requires_account, sorts:[{id,label}], default_sort,
  sizes:[...], supports_search, homepage}]`
- `iledclock/gallery/search {entry_id, source, sort, page, query?, size?, animated_only?}` →
  `{items:[{source, id, title, author?, width, height, animated, likes?, downloads?, created?, media_path}], page, has_more}`
  (`media_path` = unsigned path of the HTTP view)
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
