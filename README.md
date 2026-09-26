# iLedClock for Home Assistant

Fully local control for **iLedClock**, a 32×16 RGB BLE pixel-matrix clock (the "CoolLED1248"
family of devices). No cloud, no app required after setup — Home Assistant talks to the clock
directly over Bluetooth (including through ESPHome Bluetooth proxies).

This integration reproduces every feature of the vendor app (clock faces, scrolling text,
pixel-art/animation upload, countdown/stopwatch/scoreboard, alarms, timer switches, night mode,
pomodoro timer, reminders, temperature/humidity, device settings) and adds a few the app doesn't
have: a browser-based pixel-art/animation studio, importing arbitrary images/GIFs, generative
animations (fire, plasma, starfield, ...), and HA-driven temporary messages.

## Installation

Copy `custom_components/iledclock` into your Home Assistant `config/custom_components/`
directory (or install via HACS as a custom repository), restart Home Assistant, then add the
integration from **Settings → Devices & Services**. A clock advertising nearby is offered for
automatic discovery; otherwise the setup form lists any iLedClock a Bluetooth adapter or proxy
has recently seen.

## Options

- **Idle disconnect** — seconds to hold the Bluetooth connection after the last operation before
  disconnecting (0 = stay connected). Keeping this short is friendlier to the vendor phone app
  and other Bluetooth proxy clients sharing the same device.
- **Refresh interval** — how often (minutes) Home Assistant polls the clock's full state.
- **Device password** — must match the 6-character password stored on the clock (default
  `000000`).
- **Keep the clock's time synced** — syncs Home Assistant's time to the clock on first connect
  after startup and daily at 03:30 local.
- **Divoom account** (optional) — email + password for the online gallery's Divoom source. Only
  an MD5 hash of the password is ever stored.

## Entities

| Entity | Notes |
|---|---|
| `light.<name>_display` | Power, brightness, RGB colour, and the 31 ambient colour-cycle effects |
| `text.<name>_message` | Show a text message immediately |
| `image.<name>_display` | Preview of what the clock is currently showing |
| `sensor.<name>_temperature` / `_humidity` | Only created if the unit reports them |
| `sensor.<name>_firmware` / `_program_count` | Diagnostic |
| `binary_sensor.<name>_connected` | Diagnostic connectivity indicator |
| `button.<name>_sync_time` | Sync time on demand |
| `select.<name>_rotation` | 4-way rotate mode (disabled by default) |
| `select.<name>_clock_face` | Pick one of 41 built-in clock styles |
| `number.<name>_volume` / `_color_speed` | Disabled by default |
| `switch.<name>_night_mode` | Disabled by default |
| `switch.<name>_show_device_id` / `_remote_enable` | Disabled by default |

Config-category entities are disabled by default and unregistered from the entity registry
until enabled — the **Pixel Studio** sidebar panel is where day-to-day settings live.

## Pixel Studio panel

A full sidebar panel (**Pixel Studio**) ships with the integration: a live LED-matrix preview of
the clock, a pixel-art/animation editor, image/GIF import, generative animations, playlist
management, and a settings sheet for alarms, timer switches, night mode, and reminders. A
matching dashboard card (`iledclock-card`) is also available.

## Services

| Service | Purpose |
|---|---|
| `iledclock.show_text` | Show text now; with a duration, restores the previous playlist afterwards |
| `iledclock.show_design` | Show a saved pixel-art image or animation now |
| `iledclock.show_image` | Import and show a photo/GIF now |
| `iledclock.show_generative` | Show a procedural animation now |
| `iledclock.set_playlist` | Replace the whole program rotation |
| `iledclock.clock_face` | Show a clock style with full colour/12h-24h control |
| `iledclock.countdown_reset` / `.countdown_run` | Countdown timer |
| `iledclock.stopwatch_reset` / `.stopwatch_run` | Stopwatch |
| `iledclock.scoreboard_set_score` / `.scoreboard_set_time` / `.scoreboard_run` | Scoreboard |
| `iledclock.set_alarms` | Replace the alarm list (up to 16) |
| `iledclock.set_timer_switches` | Replace the timer-switch list (up to 4) |
| `iledclock.set_pomodoro` | Replace the pomodoro/tomato duration list |
| `iledclock.night_mode` | Configure night mode in one call |
| `iledclock.reminder_delete` | Delete a reminder created on the clock itself |
| `iledclock.sync_time` | Sync time now |
| `iledclock.release_link` | Disconnect now, freeing the Bluetooth link |
| `iledclock.send_raw` | Advanced: send a raw opcode/payload directly |

## Known limitations (honestly disclosed)

- **Reminders are read-only from Home Assistant.** The vendor's own reverse-engineered protocol
  exposes list/detail/delete for reminders but no create/set opcode — reminders can only be
  created from the clock's own on-device controls or the vendor app.
- **The 31 ambient light effects and 41 clock styles are numbered, not named.** The decompiled
  vendor app's obfuscated resources don't retain human-readable names for these, so they're
  labelled "Effect 1"–"Effect 31" and "Style 1"–"Style 41" rather than guessed descriptions.
- **The clock-face/date/timer/scoreboard/temperature/humidity preview image is an honest
  approximation**, not a pixel-perfect render — those program types are rendered by the clock's
  own firmware from a style index, which can't be reproduced client-side. `text` and saved
  `design` previews are exact.
- **The two 0x1e device-setting switches' meaning (show device ID vs. remote control) is our
  best inference** from decompiled resource IDs that couldn't be resolved with full certainty;
  both are fully functional, but may be swapped pending live-device confirmation.

## Brand

`icon.svg` (repo root) is the hand-authored source mark; `tools/render_brand.py` renders the
Home Assistant brand PNG set into `custom_components/iledclock/brand/`.

## License

MIT — see [LICENSE](LICENSE).
