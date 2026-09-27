# Pixel Studio 2 — UX/UI redesign spec (2026-09-27)

Owner: orchestrator. Every build agent reads this whole file plus
`/data/agent/managed-skills/design-language/languages/lucent/LANGUAGE.md` and `ha.css` before coding.
Evidence behind it: UX audit (current defects), RF Dashboard + Kibble + BlueShark patterns, vendor gallery
reverse-engineering (`docs/GALLERY.md` §Vendor), Divoom diagnosis.

## 0. Principles (in priority order)

1. **The clock is the hero.** Every destination shows the LED matrix first, at a *sane* size (§3), with chrome
   receding around it. The matrix plate/LED colours are content (never themed); everything else is HA-theme Lucent.
2. **One family with RF Dashboard / Feeder / BlueShark**, not a copy: HA app bar; a *status sheet* at the top
   (icon/hero + one-line headline + ink2 subline, like "RF hardware is healthy"); large pill navigation; section
   sheets with `icon + title` header and trailing status chip/action; status = 8px dot + word; explicit empty /
   loading / error / unavailable copy with an action; settings behind a gear in a sheet.
3. **One primary action per surface**, accent-filled pill. Everything else secondary/glass or icon buttons.
4. **Reversible = tap + Undo; destructive/overwriting data = hold.** Showing something on the clock is reversible:
   tap "Show on clock", then a toast "Now showing *X* · Undo" (5 s) — Undo re-shows the previous item. Deleting a
   design, clearing a canvas with unsaved work, replacing the rotation = hold-to-confirm 1500 ms (neutral colour for
   overwrite, `danger` label/edge only for delete). Never red for a save.
5. **Never lose work.** The editor autosaves a draft (localStorage, per entry) on every change; replacing the canvas
   (new/generate/open) when the draft is dirty asks via a small sheet "Keep editing / Save first / Discard (hold)".
6. **Honest states everywhere.** Loading = calm skeletons shaped like the result; error = what failed + Retry; empty
   = what to do next; unavailable = disabled with reason ("Clock is out of range"). `role=status`/`alert` live regions.
7. **Every width from 320 px** (container queries, not viewport). Touch targets ≥ 48 px. Keyboard reachable, visible
   focus ring, `aria-*` on custom controls. Reduced motion honoured. Dark + light. Flat (Neumorphism) + glass themes.

## 1. Information architecture

Panel `/iledclock` ("Pixel Studio"). Four destinations, each deep-linkable via the panel route
(`/iledclock/now`, `/create`, `/explore`, `/library`; sheets use `?item=` / `?design=` query so Back closes them):

| Destination | Icon (mdi) | Job | Primary action |
|---|---|---|---|
| **Now** | `mdi:television-play` | What the clock shows + quick control (clock face, text, timer, score, brightness, rotation on/off) | contextual: "Show clock" / "Show text" / "Start timer" |
| **Create** | `mdi:draw` | Pixel/animation editor, text, effects, clock+art compositions | "Show on clock" |
| **Explore** | `mdi:compass-outline` | Online store: iLedClock originals (vendor), vendor animations, LaMetric, AWTRIX, Divoom | per item: "Show on clock" |
| **Library** | `mdi:view-grid-outline` | My designs, imports, the rotation (playlist) | per item: "Show on clock"; rotation: "Apply rotation" |

App bar (HA style: `--app-header-background-color`, `--app-header-text-color`, `--header-height`): sidebar toggle
(only when `narrow`, fires `hass-toggle-menu`), title "Pixel Studio", then right side: **clock chip**
(dot + "Connected" / "Sending 42%" / "Out of range"; tap = status sheet of the Now tab), device picker when more than
one entry, **gear** → Settings sheet. Title truncates with ellipsis; never overflows at 320 px.

Navigation:
- Container ≥ 720 px: a pill tab bar under the app bar (RF style, accessible `tablist`, arrow/Home/End keys),
  labels + icons, centred-left, sticky.
- Container < 720 px: **bottom navigation bar** (4 items, icon + label, 64 px + `env(safe-area-inset-bottom)`),
  glass, the only `backdrop-filter` layer on the screen. Thumb reach on phones beats consistency with a dashboard
  card; the vocabulary (pills, icons, labels) stays identical.

Content column: max-width 1200 px, centred, inset 16 px (phone) / 24 px (wide). Sheets float with 16–24 px gaps.

## 2. Destinations

### 2.1 Now
- **Status sheet (hero)**: LED mirror of what the clock shows (animated, hero size §3) + headline "Showing *Heart +
  clock*" (or "Clock · style 16", "Text · Hello", "Countdown 04:59") + ink2 subline "Connected · Brightness 64% ·
  Night mode 21:00–08:00". While uploading: progress bar in the sheet + "Sending to clock… 42%". Wide: matrix left,
  text + quick actions right; narrow: stacked.
- **Mode pills**: Clock · Text · Art · Timer · Score (segmented; < 360 px collapses to a select). Each mode's control
  panel = the SAME component the Lovelace card uses (`iledclock-mode-deck`), so card and panel stay identical:
  - Clock: face picker as a horizontal row of real mini-previews of the vendor faces (render via
    `iledclock/render`), 12/24 h, colour, date on/off. Primary "Show clock".
  - Text: text field, colour, effect, speed; live preview. Primary "Show text".
  - Art: recent + favourite designs row (tap tile = show with undo), "Open Library" link.
  - Timer: countdown presets (1/5/10/25 min chips + custom stepper) / stopwatch; Start/Pause/Reset.
  - Score: two big +/− steppers, names; Reset (hold).
- **Quick controls sheet**: brightness slider (`ha-slider`), display on/off switch, rotation on/off + "Edit
  rotation" link, night mode summary row (tap → Settings sheet at that section).
- **Recently shown** row (last 8 items shown via any path; tap = show again with undo).

### 2.2 Create (editor)
- Header row: editable design name, save state chip ("Draft saved" / "Saved to library" / "Unsaved"), Undo/Redo
  icon buttons, overflow (⋯) menu: New…, Duplicate, Import file…, Text stamp…, Effects…, Clear (hold), Export PNG/GIF.
  Primary pill **"Show on clock"** (saves to library if needed, shows, toast with Undo). Secondary "Save".
- **Wide (≥ 900 px container)**: left vertical tool rail (grouped: Draw [pen, eraser, fill, picker], Shape [line,
  rect, ellipse, filled toggle], Transform [move/shift, mirror H/V]) with text labels in tooltips AND an accessible
  name; centre canvas (editor size §3), right **inspector** column (280 px): colour (current swatch, palette of
  RGB444-safe swatches, recent colours, HA colour picker), brush size 1/2/3, onion skin toggle, frame delay,
  "Clock region" toggle (reserve right half for live clock — makes an Icon-with-clock design).
- **Narrow**: canvas first (fits width, §3), then a **tool dock**: one scrollable row of 48 px tool buttons +
  a colour swatch button that opens the colour sheet; secondary tools in a "More tools" sheet. Inspector content
  moves into sheets. No horizontal page scroll ever; zoom = pinch or +/− buttons with pan (two-finger/drag with Move).
- **Frames timeline** below canvas: 2:1 thumbnails (pitch 3), add / duplicate / delete (hold if > 1 frame and
  non-empty) / drag-reorder + keyboard reorder, per-frame delay chip (ms, min 10, tabular numerals), Play/Pause with
  fps readout, frame counter "3 / 12 · max 64".
- **New… sheet** (starting points, big tiles): Blank · Text · Effect (Life, Fire, Plasma, Matrix rain, Starfield,
  Rainbow, Sparkle — each tile shows its live mini preview + hint; duration stepper 2–16 s) · Import file · From
  Explore · Art + clock (blank art with the clock region reserved).
- Autosaved draft restored on open ("Restored your unsaved drawing · Discard").

### 2.3 Explore (store)
- Search field (debounced 350 ms, clear button) + **source pills**: *For you* (default) · iLedClock (vendor
  originals) · Animations (vendor preset feed) · LaMetric · AWTRIX · Divoom. Unconfigured Divoom shows a quiet row
  "Add a free Divoom account to browse 700k+ designs" linking to options.
- **For you**: stacked shelves (horizontal scroll rows, snap, arrow buttons on wide): "iLedClock originals ·
  Trending", one shelf per other vendor category worth showing (Creative, Emoji, Festival…), "Animations",
  "LaMetric popular", "AWTRIX new", "Divoom trending". Each shelf loads independently (its own skeleton/error/retry)
  — one slow source never blocks the page. "See all" → that source's grid.
- **Source view**: category chips (vendor categories; Divoom categories if available), sort chips from the source
  contract, "Animated only" chip, then a responsive grid (tile min 120 px phone / 148 px wide). Infinite scroll +
  a visible "Load more" fallback button; end-of-list message.
- **Tile**: square plate (dark LED plate), art drawn crisp (`image-rendering: pixelated`) and centred at an integer
  scale; badges: "Fits exactly" (native 32×16), frame count / "Animated", size (e.g. 16×16) in ink3; title (1 line)
  + author/likes ink3. Animates only while ≥ 50 % visible and at most 12 at once; never under reduced motion.
  **Image failure = placeholder glyph + small Retry icon button**, auto-retry once with backoff; never a broken image.
- **Item sheet** (bottom sheet on phone, centred 560 px on wide): LED preview of the ADAPTED 32×16 result (hero
  size, animated, RGB444) with original beside it (small, pixelated); layout pills (Auto · Fit · Fill · Tile ·
  With clock — only those available); "Adjust" disclosure (scale, offset, background, enhance) for power users;
  credit line + link to original; actions: primary **Show on clock** (tap + undo), secondary **Save**, tertiary
  **Edit** (import then open in Create). Next/previous item arrows (and swipe) inside the sheet.

### 2.4 Library
- Toolbar: search, filter chips (All · Animated · Still · With clock · From Explore), sort (Recent · Name), and
  **Import file** secondary button (opens the Import sheet — same adapted-preview UI as the item sheet plus crop).
- Grid of design tiles (same tile component as Explore, 2:1 LED plate for 32×16 designs). Tap → **design sheet**:
  preview, name (rename inline), actions: primary Show on clock; Edit; Duplicate; Add to rotation; Delete (hold,
  danger). Multi-select mode (long-press or "Select") for bulk delete / add to rotation.
- **Rotation sheet section** ("Rotation" = playlist): ordered list rows (thumbnail, name/kind, duration stepper,
  drag handle + move up/down buttons, remove), "Add" (from library / clock / date / text / timer / temperature /
  humidity), enabled switch, primary **Apply rotation** (tap + undo? No: it replaces the device program list, so
  hold-to-confirm, neutral colour). Load errors show an error state, never "Nothing queued".

### 2.5 Settings sheet (gear)
Sections as rows with disclosures: Display (brightness, 12/24 h, auto-brightness if supported), Night mode (enabled,
start/end, dim level, display off, sound wake, wake minutes, sensitivity), Time (sync now), Sound/voice, Alarms
& reminders (if backend supports), Accounts (Divoom sign-in status → options flow link), About (firmware, BLE
address, integration version). Reuse the existing card settings sheet logic; one component for card + panel.

## 3. LED preview sizing policy (fixes "gigantic")

LEDs are drawn at an **integer pitch** `p` (CSS px per LED) so dots stay crisp; the matrix is `32p × 16p`.
Implemented once in `frontend/src/lib/led-size.ts` (pure, unit-tested) and consumed by `iledclock-led-preview`:

| Context | Rule | Result |
|---|---|---|
| `hero` (Now, card, item/design sheets) | `p = clamp(6, floor(avail/32), 12)` | 320 px phone → 9 (288×144); wide → 12 (**384×192 max**) |
| `editor` | `p = clamp(8, floor(min(availW/32, availH/16)), 22)` where `availH = viewport − chrome` (the whole editor fits without page scroll at ≥ 700 px tall) | laptop ≈ 22 (704×352 max); phone 390 → 11 |
| `editor` zoomed | user zoom multiplies up to p = 40, canvas pans inside a fixed viewport | |
| `tile` | fit the tile at integer scale of the *art* | |
| `thumb` (frames, rows) | `p = 2–3` | 64–96 px wide |

Card: `hero` rule with max `p = 10` on narrow cards (< 400 px). Dots: diameter 0.78 p, unlit LEDs faintly visible
(8 % white), plate radius = `--lu-radius-tile`, subtle inner shadow; optional glow only for p ≥ 10.

## 4. Components (new or rebuilt; all in `frontend/src/components`, Lit, `TOKENS_CSS` first)

`iledclock-app-shell` (app bar + nav + route) · `lu-nav` (pill tabs/bottom bar) · `lu-status-sheet` ·
`lu-section` (sheet with icon/title/trailing slot) · `lu-chip` · `lu-sheet` (bottom on phone / centred wide,
focus trap, Esc, scrim, Back closes via route query) · `lu-toast` (polite live region, Undo action, queue) ·
`lu-empty` / `lu-error` / `lu-skeleton` · `lu-icon-button` (48 px) · `lu-pill-button` (primary/secondary/danger)
· existing `iledclock-hold-button`, `iledclock-segmented-picker` (collapse to select < 360), `iledclock-stepper`
restyled · `iledclock-led-preview` (sizing policy; wraps the existing matrix canvas renderer) · `iledclock-art-tile`
(Explore + Library) · `iledclock-mode-deck` (Now + card) · `iledclock-settings-sheet` (Now + card).
Token layer `styles/tokens.ts` gains the full Lucent structural set: `--lu-space-1..8`, `--lu-radius-sheet`,
`--lu-shadow-rest`, `--lu-highlight-rest`, `--lu-type-*` (display/title/body/label/caption/numeral), `--lu-motion-*`
incl. `label` and `scroll`. No raw colours/radii/durations in components (the LED plate/LED colours excepted).
Chrome skeleton/badge colours come from tokens (not literal black/white).

## 5. Backend additions (contracts)

### 5.1 Vendor sources (new `gallery/coolledx.py`)
Two source ids:
- `iledclock` "iLedClock originals": GET `http://www.coolledx.com/CoolLEDX/iLedClock/config.json` → `material_url`;
  `{material_url}/fc/{rows}x{cols}/category.json` (rows×cols = `16x32` for this clock; derive from hardware profile)
  → categories (localised names; pick HA language, fallback en); per category `{url}/list_{lang}.json` (fallback
  `list_en.json`) → `{baseUrl, list:[filename]}`; media `{baseUrl}/{filename}` with **bytes 0–31 XOR 0xDA** → GIF.
  Item id = `<category_slug>/<filename>`; width 32, height 16, animated from decoded frame count (cache); title =
  category name + index (no titles upstream). No paging upstream → page locally (48/page). Catalog TTL 12 h, media
  cached forever-ish (LRU). Plain HTTP upstream; the browser only ever sees our authenticated HA media view.
- `iledclock_anim` "Animations": `http://coolledx.com/appDownload/CoolLED1248/animation_update_data/1632/
  data1632_{static|dynamic}.json` (`{versionCode, animationData}`), decoded to frames per vendor
  `light/utils/LightUtils.java` / `AnimationUpdateManager.java`; categories Static / Dynamic; rendered to a GIF
  by our side for media. Cache by versionCode.

### 5.2 Contract changes (backward compatible, all sources)
- `sources` entries gain `categories: [{id, label}]` (may be empty) and `kind: "native"|"adapted"`.
- `search` accepts optional `category`; items gain optional `category`, `frames`, `native_fit: bool`.
- New `iledclock/gallery/shelves {entry_id}` → `[{id, title, source, category?, sort?}]` (the For-you plan; client
  fills each shelf with `search`).
- Media view: every failure returns a proper HTTP status (404/502/504) quickly (never hangs > 12 s), successful
  bytes cached; concurrency-limited per source; stale-while-revalidate for catalogs.

### 5.3 Now showing + undo
- Coordinator tracks `now_showing` (descriptor of last shown item: `{kind, design_id?|clock_style?|text?|…, title,
  shown_at}`) and a small history (last 8), persisted in the store; exposed in `iledclock/state` and pushed through
  `iledclock/subscribe`. `iledclock/show` accepts `{restore: "previous"}` to re-show the previous descriptor (Undo).
- Upload progress (chunk index / total) pushed through `iledclock/subscribe` as `upload: {done, total}` when
  available.

## 6. Quality gates
- Python: `tests/{protocol,gallery,hardware,integration}` unittest, `tests/ha` pytest (real HA). New: vendor source
  (recorded fixtures from `/data/home/tmp/vendor-gallery/`, XOR decode, categories, locale fallback, paging),
  animations feed decode, media view error mapping/timeouts, Divoom fixes, now_showing/undo.
- Frontend: `npx tsc --noEmit`, `bun test ../tests/frontend`, `npm run build`. New pure-lib tests: led-size policy,
  route parsing, shelf loading state machine, tile retry/backoff, draft autosave.
- Live (orchestrator): screenshots at 360 / 768 / 1280 px in Neumorphism (flat, light) and a glass theme (dark),
  every destination + sheets; live gallery browsing across all sources; show a vendor item, a Divoom item and an
  editor design on the real clock, Undo, then restore the Heart + clock design.
