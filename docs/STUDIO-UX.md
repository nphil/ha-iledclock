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

Panel `/iledclock` ("Pixel Studio"). Five destinations, each deep-linkable via the panel route
(`/iledclock/now`, `/create`, `/explore`, `/library`, `/alarms`; sheets use `?item=` / `?design=` / `?alarm=` query so Back closes them):

| Destination | Icon (mdi) | Job | Primary action |
|---|---|---|---|
| **Now** | `mdi:television-play` | What the clock shows + quick control (clock face, text, timer, score, brightness, rotation on/off) | contextual: "Show clock" / "Show text" / "Start timer" |
| **Create** | `mdi:draw` | Pixel/animation editor, text, effects, clock+art compositions | "Show on clock" |
| **Explore** | `mdi:compass-outline` | Online store: iLedClock originals (vendor), vendor animations, LaMetric, AWTRIX, Divoom | per item: "Show on clock" |
| **Library** | `mdi:view-grid-outline` | My designs, imports, the rotation (playlist) | per item: "Show on clock"; rotation: "Apply rotation" |
| **Alarms** | `mdi:alarm` | Named alarms and reminders that live on the clock's own reminder slots (so they ring without Home Assistant) | "Add alarm" |

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
  "Clock region" toggle (reserve right half for live clock — makes an Icon-with-clock design), and a **Playback** section
  (speed + smooth motion, §2.6; only for designs with more than one frame).
- **Narrow**: canvas first (fits width, §3), then a **tool dock**: one scrollable row of 48 px tool buttons +
  a colour swatch button that opens the colour sheet; secondary tools in a "More tools" sheet. Inspector content
  moves into sheets (Playback sits in its own section directly under Frames, so phone users reach it). No horizontal page
  scroll ever; zoom = pinch or +/− buttons with pan (two-finger/drag with Move).
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
  size, animated, RGB444) with original beside it (small, pixelated); the **Playback control** (§2.6) directly under the
  preview (animated items only); layout pills (Auto · Fit · Fill · Tile · With clock — only those available); "Adjust" disclosure (scale, offset, background, enhance) for power users;
  credit line + link to original; actions: primary **Show on clock** (tap + undo), secondary **Save**, tertiary
  **Edit** (import then open in Create). Next/previous item arrows (and swipe) inside the sheet.

### 2.4 Library
- Toolbar: search, filter chips (All · Animated · Still · With clock · From Explore), sort (Recent · Name), and
  **Import file** secondary button (opens the Import sheet — same adapted-preview UI as the item sheet plus crop).
- Grid of design tiles (same tile component as Explore, 2:1 LED plate for 32×16 designs). Tap → **design sheet**:
  preview, name (rename inline), the **Playback control** (§2.6, animated designs only, saved as soon as you let go),
  actions: primary Show on clock; Edit; Duplicate; Add to rotation; Delete (hold, danger). Multi-select mode (long-press or "Select") for bulk delete / add to rotation.
- **Rotation sheet section** ("Rotation" = playlist): ordered list rows (thumbnail, name/kind, duration stepper,
  drag handle + move up/down buttons, remove; an animated design's row says how long one loop takes, e.g.
  `Design · loop 6.5 s`, or `Design · still`), "Add" (from library / clock / date / text / timer / temperature /
  humidity), enabled switch, primary **Apply rotation** (tap + undo? No: it replaces the device program list, so
  hold-to-confirm, neutral colour). Load errors show an error state, never "Nothing queued".

### 2.5 Settings sheet (gear)
Sections as rows with disclosures: Display (brightness, 12/24 h, auto-brightness if supported), Night mode (enabled,
start/end, dim level, display off, sound wake, wake minutes, sensitivity), Time (sync now), Sound/voice, Alarms
& reminders (if backend supports), Accounts (Divoom sign-in status → options flow link), About (firmware, BLE
address, integration version). Reuse the existing card settings sheet logic; one component for card + panel.

### 2.6 Playback control (Speed + Smooth motion)

One component, `iledclock-playback-control`, shown in four places: Explore item sheet, Import sheet, Library design sheet
(above the actions) and the editor (inspector section on wide screens; a `Playback` section under Frames on narrow ones). It is
bound to a `PlaybackSession` (`lib/playback-session.ts`) which also feeds the screen's LED preview, so the preview is always
what the control describes. Single-frame designs never show it.

- **Speed** slider, 0-100. `Still` (0) is one picture, the fullest frame. `Max` (100) is the fastest the clock plays (7 delay
  units a frame, about 95 frames a second; the readout never says "100 fps"). A tick labelled **Original** sits where the
  animation's authored pace falls; the slider snaps softly to it (within 3%) and then means "untouched timing" (stored as
  `null`). The scale is logarithmic, each ~13% of travel doubles the speed, and the authored rhythm is kept (a long hold then quick
  frames stays that way). Readout: `Still` / `Original` / `34%` / `Max`; caption: `About 7 frames a second · loops every 1.7 s`.
  Keyboard: arrows ±1%, PageUp/PageDown ±10%, Home = Still, End = Max (from Original, an arrow steps off it).
  `aria-valuetext` carries the words and the pace. A one-line caution appears from 90%: very fast playback can look like strobing.
- **Smooth motion** switch row with a status line: `Added 24 in-between frames (36 total); blinks stay sharp`, `On. In-between
  frames are added when you slow it down.` (at Original or faster nothing is added), `Off. The clock steps straight from picture to
  picture.`, or, disabled, `Nothing slides or fades here, so there's nothing to smooth.` / `Already moving one pixel at a time, so
  there's nothing to smooth.` The server decides (`iledclock/playback/preview`): exact integer-shift copies for sliding steps, 4-bit
  level fades for moderate brightness steps, hard cuts for blinks and sprite swaps, never more than 40 frames, never a longer loop.
- **Reset to Original** (quiet pill, only when a speed is set) returns to the screen's default: Original + auto smoothing in Explore,
  Import and Library; Original + smoothing off in the editor (hand-drawn pixel art is meant to step).
- **Instant, then exact.** Dragging rescales the frames already on screen (`iledclock-led-preview` `rate`, position kept, Still
  swaps in the poster frame at once). On release (and for key presses, the switch and Reset) the session waits ~200 ms and asks the
  server for the exact frames and delays, then swaps them in. "Show on clock" uploads those same frames: preview and upload run the
  same code. Under reduced motion the preview holds still and the text readout carries the information. The browser preview tops out
  at 60 fps; the caption says so above that.
- **Where it is saved.** Speed and smooth motion belong to the design (`speed`, `smooth` fields). Library and the editor save them
  with the design; Explore and Import apply them to the design they create when the item is shown, saved or edited
  (`iledclock/designs/set_playback`). They are never part of the import options, so one gallery item stays one library design.
- Built only from existing Lucent pieces (native range input restyled with tokens, the Explore toggle-row pattern, `lu-pill-button`
  quiet variant, `lu-section` for the narrow editor placement).

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
  (recorded fixtures from `/data/home/PixelClock/research/gallery-checks/vendor-gallery/`, XOR decode, categories, locale fallback, paging),
  animations feed decode, media view error mapping/timeouts, Divoom fixes, now_showing/undo.
- Frontend: `npx tsc --noEmit`, `bun test ../tests/frontend`, `npm run build`. New pure-lib tests: led-size policy,
  route parsing, shelf loading state machine, tile retry/backoff, draft autosave.
- Live (orchestrator): screenshots at 360 / 768 / 1280 px in Neumorphism (flat, light) and a glass theme (dark),
  every destination + sheets; live gallery browsing across all sources; show a vendor item, a Divoom item and an
  editor design on the real clock, Undo, then restore the Heart + clock design.

## 7. Screens A and B (the power-button screens)

The clock has two screens behind its power button. Bluetooth cannot choose one and nothing can be read back, so a screen only changes when something is **sent** to it. Screen A is the program list (every show goes there by default). Screen B is the clock-page store: clock, date, temperature and humidity pages, and designs with a clock while the server says so (`capabilities.slots.b_accepts`; plain art is off until the live art test passes). Timers and scoreboards are screen A only.

- **Pixel Studio never claims to know which screen the clock is showing.** It shows what it last SENT to each screen. "Last sent" marks the screen written most recently (writing a screen also shows it).
- **Where the next show goes** is one remembered choice per clock, shared by every control and kept across reloads. The tiles and every "Screen A | B" control read and write it.
- **Screen tiles** (Now, below the hero; the Lovelace card, below its picture): two tiles with the server-rendered picture of what was sent, its title, "Sent 5 min ago", the "Last sent" marker, a check on the target, "Nothing sent from Home Assistant yet" when empty, and "Press the clock's power button to switch". Tiles are a radio group (arrow keys); pictures stay still until hovered or keyboard-focused (one ambient animation, never under reduced motion). Dates, temperature and humidity pages are drawn by the clock itself, so their tile says so instead of showing a made-up picture.
- **A | B on every Show action** (mode deck clock/text/art, Explore item sheet, Import sheet, Library design sheet, editor header). It shows where this Show goes right now. When screen B cannot take the content it shows A, greys B and says why in one line ("Screen B only takes clock, date and temperature pages for now; pictures go on screen A."); the remembered B comes back for the next clock face. A date page is always filed on screen B by the clock, so for dates the control shows B selected and A greyed ("The clock always keeps its date page on screen B."), and the remembered choice is not rewritten. If B is remembered but cannot be checked, nothing is sent. The screen is decided at the click, together with the artwork and the kind of content, so changing the layout or clock-region switch while an import or save is running cannot move the show to another screen; a screen the content cannot take is refused with the server's reason, never redirected. While B is remembered and the clock's reply about what B takes is still out, the control selects neither A nor B. The toast names screen B ("Now showing X on screen B") and, when B was remembered but the content went to A, says "on screen A"; Undo goes back on the same screen.
- **History**: "Recently shown" rows and the headline subline name their screen once screen B has been used; showing an entry again writes it to the screen it came from.
- **Text mode** draws the text on the server and previews those exact frames (animated); effects are Solid, Rainbow and Per-letter rainbow; Bold is a switch; Speed is the shared playback Speed control (0-100, Original), shown only while the text scrolls.
- **Library design sheet**: the actions live in the sheet's footer (screen choice, Show on clock, Edit, Duplicate, Add to rotation, hold to delete) so they are always visible; only the body scrolls, with a soft fade at its bottom edge while there is more below. Checked at 1100x900, 1100x700 and 375x667, light and dark.
- Touch targets stay 48 px; B is `aria-disabled` rather than removed so its reason is reachable by keyboard and screen readers.

## 8. Alarms & reminders (the `alarms` destination)

One list for alarms and reminders, managed from Home Assistant but stored on the clock (it holds 14 reminders in all, so everything keeps ringing with Home Assistant off). Built from `iledclock-dest-alarms`, `iledclock-alarm-sheet`, `iledclock-alarm-art-picker` and the pure rules in `lib/reminders.ts`; the server rules are in `docs/SLOTS-AND-REMINDERS.md`.

- **Header**: title, one plain sentence, the slot chip ("5 of 14 clock slots used", the capacity comes from the server; amber near full, never red; "14 of 14" when full) and the one primary action "Add alarm". While the list is empty the header has no Add button: the empty state carries the single primary action. A full clock disables Add and says why under it.
- **Rows** (sorted by when each rings next, switched off ones included, so flipping a switch never moves a row): big time (12/24 h follows Home Assistant), name with an alarm or bell mark, repeat summary ("Every day", "Weekdays", "Mon, Wed", "Every month on the 15th", "Once · Fri 2 Oct"), "Uses 5 slots" when it takes several, a small LED thumbnail (the design's still, or the name drawn through `iledclock/render`; it plays only while the row is hovered or focused on a fine pointer, never under reduced motion), and an on/off switch. Tap the row to edit. One status line per row: *Rings in 7 h 20 min*, *Off*, *Not sent to the clock yet · Send now*, *Not on the clock · Re-send*, *Changed on the clock · Re-send*, *Couldn't send · reason · Re-send*, *Done*. A switch keeps its last confirmed position and shows *Switching on…* until the clock answers; it never flips ahead of the truth.
- **On the clock only**: reminders made with the vendor app are listed read-only with hold-to-delete.
- **Out of range**: the list stays (last known definitions) with a note; Add, the switches, Re-send and Delete are disabled with that reason, because a change that cannot reach the clock would only look done. Nothing here is sent while the clock is away.
- **Edit sheet** (`lu-sheet`; bottom sheet on phones, centred on wide): name (counter "12/20", UTF-16 units like the vendor app), type Alarm | Reminder (a label only), time (native control, large), repeat pills (Never, Every day, Weekdays, Weekends, Custom, Weekly, Monthly, Yearly) with day chips Mon to Sun, a date where the repeat needs one (a day-of-month list 1 to 28 for monthly, month and day for yearly: no 29th to 31st, no 29 February), ring length (30 s, 1, 2, 3 min), art, a one-line "Uses N clock slots" note that turns into a blocked state (Save disabled, reason shown) when it does not fit, the on switch, and for an existing item hold-to-delete. The footer says what happened: *Saved to clock · works without Home Assistant* only when the server's answer is `synced`, otherwise the honest status. A failed send keeps everything typed and names what to do; a new item stored by the server before the clock failed is adopted, so the next Save edits it instead of making a copy.
- **Art picker** is a second pane in the same sheet (Back arrow, Escape returns to the form): a large live LED preview of the choice, "Name as text" first (with a colour row), then the Library. Designs that cannot be used (a live-clock area, more than 40 frames) stay in the grid, dimmed, with one line saying why.
- **Art that fits** is judged by the frames the clock will actually play, not the authored count: a design set to Still in the Library plays one frame and is always fine; any other speed counts its authored frames (limit 40). For those the real number depends on the pictures (identical neighbours are merged, Smooth motion adds in-betweens up to 40), so the server's check on save has the last word and its message shows in the sheet. In the picker, "Use this art" stays off while the chosen design's own picture is still being drawn, and the large preview never shows the previous choice's picture under the new name.
- **Time zone**: "Rings in …", the default time and date of a new alarm and the "time has already passed" check all use Home Assistant's own time zone (`hass.config.time_zone`, the zone the clock is programmed in), not the browser's; without it they fall back to the browser's zone.
- **Slow answers never land in the wrong place**: a save or delete that is still running when the sheet is closed, or another alarm or clock is opened, is ignored when it answers (the list learns the result from the state push); the same holds for the switch, Re-send and delete in the list when the clock selection changes. After a first save that stored the item but failed on the clock, the sheet keeps the item's key (the next Save edits it, no copy) and counts the slots it holds, so Save is not stuck at zero free.
- **Settings sheet**: the reminders list is gone from it; a row "Alarms & reminders · open" leads here (also from the dashboard card). The clock's plain alarms and display schedule stay there as "Basic alarms & display schedule".
- **Keyboard and screen readers**: rows, switches and Re-send are separate native buttons (switch is `role="switch"` with `aria-checked`, `aria-busy` while sending, and stays focusable while it sends); the sheet is a modal dialog with focus trap, Escape and focus return to the row; pill groups are radio groups (one tab stop, arrow keys, Home/End); day chips are pressed-buttons (weekly: radios); art choices are a radio group with the reason in the accessible name.
- **Harness** (`frontend/dev`, `?alarms=` in the address): `empty`, `populated` (default: a five-slot Monday-Friday alarm, a one-time reminder, one missing, one changed, one failed, one switched off, one made in the vendor app) and `full` (16 of 16). Add `&alarms-delay=4000` to watch a save, `&alarms-offline=1` for the clock out of range, `&alarms-fail=1` for a send that fails while connected, `&alarms-mask=1` for a clock that takes a weekday mask.
- Add `&ha-tz=Pacific/Auckland` to pretend Home Assistant runs in another time zone: the mocked server and `hass.config.time_zone` both follow it, so the browser's zone and the clock's can be told apart.
