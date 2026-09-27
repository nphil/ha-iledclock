# Pixel Studio component APIs

Studio components are Lit custom elements. Import a component module once (the studio entry point already imports them), then set object-valued properties with Lit property bindings such as `.hass=${hass}`. All visual chrome uses `TOKENS_CSS`; LED plate and pixel colours are content.

## Shell and routing

- `<iledclock-studio-panel>` accepts `.hass`, `narrow`, and optional `device-id`. It resolves the selected clock and renders the app shell, four destinations, and settings sheet.
- `<iledclock-app-shell>` accepts `.hass`, `.entryId`, `.deviceId`, `.route`, and `narrow`. It reads/writes `/iledclock/{now|create|explore|library}` and sheet query values (`item`, `design`), listens to browser Back/Forward, and passes state events through.
- `<lu-nav>` accepts `.options` (`{value,label,icon}[]`), `value`, and `label`; emits `destination-selected` with `{value}`.
- Destination elements accept `.hass`, `.entryId`, `.route`, and `narrow`. Explore consumes `.route` for item-sheet deep links; Create consumes `.route.design`.

Shell events: `route-changed` (`{route}`), `device-selected` (`{deviceId}`), `settings-requested` (optional `{section}`; without one, settings opens at Display; quick rows may request `night-mode`), `clock-status` (state envelope), and `hass-toggle-menu`. The shell handles bubbled `iledclock-open-design` (`{design_id}`) and `lu-toast` events. A toast request has `{message, actionLabel?, action?, timeoutMs?}`; Undo actions should restore the previous shown item rather than repeat an upload.

`lib/route.ts` exports `parseStudioRoute`, `serializeStudioRoute`, and `navigateStudioRoute`. Routes are represented by `StudioRoute`: `{destination, item?, design?}`.

## Shared UI primitives

| Element | Properties | Slots / events |
| --- | --- | --- |
| `<lu-section>` | `title`, `icon`, `description` | Default content; `icon` and `trailing` slots |
| `<lu-status-sheet>` | `icon`, `headline`, `subline`, `status`, `status-kind` | `hero`, default details, `actions` |
| `<lu-chip>` | `label`, `kind`, `dot` | Status chip; kinds: `positive`, `warning`, `danger`, `info`, `live`, `neutral` |
| `<lu-pill-button>` | `label`, `aria-label`, `variant`, `loading`, `disabled`, `icon` | Emits `lu-press`; variants: `primary`, `secondary`, `danger`, `quiet` |
| `<lu-icon-button>` | `icon`, `tooltip`, `aria-label`, `disabled` | Emits `lu-press`; 48 px target |
| `<lu-sheet>` | `open`, `label`, `close-on-scrim` | `header`, default body, `footer`; emits `closed`; traps focus and closes with Escape |
| `<lu-toast>` | none | Call `.enqueue({message, actionLabel?, action?, timeoutMs?})`; queued requests announce through a polite live region |
| `<lu-empty>` | `title`, `message`, `action-label`, `icon` | Emits `empty-action` |
| `<lu-error>` | `title`, `message`, `retry-label`, `busy` | Emits `retry` |
| `<lu-skeleton>` | `variant` (`line`, `card`, `circle`), `width`, `height`, `label` | Loading placeholder; respects reduced motion |

## LED and artwork

- `<iledclock-led-preview>` accepts `.frames` (`PixelFrame[]`), `.delays` (`number[]`), `context` (`hero`, `editor`, `tile`, `thumb`), optional `max-pitch`, `zoom`, `playing`, and `label`. It owns integer-pitch sizing and stops animation when hidden or reduced motion is enabled.
- `<iledclock-art-tile>` accepts `item-id`, `image-url`, optional `media-path` (the unsigned HA media path), `.frames`/`.delays`, `animated`, `aspect` (`square` or `design`), `title`, and `subtitle`. It emits `tile-selected` with `{itemId}`. With `media-path`, manual and automatic retries emit bubbling/composed `media-retry-request` with `{itemId, mediaPath}` so the parent can fetch a fresh signed URL and update `image-url`; without it, retries retain the cache-busting URL fallback. The tile uses the shared 12-tile animation budget.
- `lib/led-size.ts` exports `ledSizeFor(context, availableWidth, availableHeight, options?)`. Returned `pitch`, `width`, and `height` are whole-pixel dimensions. `lib/tile-policy.ts` exports retry, visibility-budget, and animation-cap policies for tests and consumers.

The existing `<iledclock-hold-button>` accepts `label`, `complete-label`, `danger`, `disabled`, and a `.config` object (`{durationMs, drainMs}`; the default hold lasts 1500 ms). It emits `confirmed` only after a complete press-and-hold; keyboard Space/Enter follows the same hold/release lifecycle. The segmented picker and stepper remain shared editor controls and inherit the Lucent token layer.
