# iLedClock for Home Assistant

Fully local control for **iLedClock**, a 32×16 RGB BLE pixel-matrix clock (the "CoolLED1248"
family of devices). No cloud, no app required after setup — Home Assistant talks to the clock
directly over Bluetooth (including through ESPHome Bluetooth proxies).

This integration reproduces every feature of the vendor app (clock faces, scrolling text,
pixel-art/animation upload, countdown/stopwatch/scoreboard, alarms, timer switches, night mode,
pomodoro timer, reminders, temperature/humidity, device settings) and adds a few the app doesn't
have: a browser-based pixel-art/animation studio, importing arbitrary images/GIFs, generative
animations (fire, plasma, starfield, ...), HA-driven temporary messages, **named alarms and
reminders you create and edit from Home Assistant** (they live on the clock and keep ringing when
Home Assistant is off), and a choice of which of the clock's **two screens** a show goes to.

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
| `sensor.<name>_firmware` / `_program_count` | Diagnostic; the program-count sensor (named "Screen A programs"; a fresh install's entity id is `_screen_a_programs`) = programs in the last upload to screen A, with screen A/B details as attributes |
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
management, the **Alarms & reminders** screen, and a settings sheet for night mode, timer switches,
the clock's basic alarms and device options. A matching dashboard card (`iledclock-card`) is also
available.

### Speed and smooth motion

Every animated design has one **Speed** slider (Explore, Import, Library and the editor all show the
same control under the preview). **0%** is a still picture (the fullest frame), **100%** is the
fastest the clock can play (about 95 frames a second), and a tick marks **Original**, the pace the
animation was drawn at; leaving the slider there plays the design exactly as authored. The slider is
logarithmic, so the 3-15 frames a second most art lives at is not squeezed into a sliver, and it keeps
the animation's own rhythm: a long hold followed by quick frames stays that way at any speed.

**Smooth motion** is a switch beside it. When you slow an animation down, steps that slide (a ticker,
a sprite crossing the panel) get exact shifted in-between frames, and steps that fade in moderate
steps get in-between brightness levels; blinks, sprite swaps and other hard changes stay sharp. It
never changes the loop length and never grows an animation past 40 frames. The preview you see is the
exact frames the clock plays, because the integration computes both with the same code. The clock has
no live speed command for uploaded animations, so changing a speed re-sends the program (a few
seconds); programs the clock already holds are not sent again.

Speed and smooth motion are saved with the design (`iledclock/designs/set_playback`), so the
rotation, `iledclock.show_design` and Undo all play the design the same way.

### Screens A and B

The clock has two screens behind its power button, and a short press on the clock flips between
them. Bluetooth has no "show screen N" command and nothing can be read back, so Home Assistant
changes a screen only by sending to it. **Screen A** is the program list (every show goes there by
default and `iledclock.set_playlist` fills it); **screen B** is the clock-page screen, which takes
clock, date and temperature pages. Every "Show on clock" action in Pixel Studio has a small
**A | B** choice (remembered per clock) and every show service takes `slot: a | b`. Home Assistant
keeps a record of what it sent to each screen and shows both in the **Screen A / Screen B** tiles on
Now and in the card.

Whether screen B takes pictures and animations is not proven on the real clock, so until the live
test says so it only accepts clock-type pages (`SLOT_B_ACCEPTS_ART` in `hardware.py`). A date page
always goes to screen B, whichever screen was asked for, because that is how the clock files it. The
tiles say "Sent last", never "Showing now": pressing the clock's button is invisible to Home
Assistant. `iledclock.switch_screen` presses that power key once (it only toggles).

### Alarms and reminders

The **Alarms** screen of Pixel Studio is one iOS-style list of named alarms and reminders: a big time, a
name, how often it repeats, a small picture and an on/off switch. Tap a row to edit it: name, time,
repeat (never, every day, weekdays, weekends, custom days, weekly, monthly, yearly), how long it rings
(30, 60, 120 or 180 seconds) and what it shows while it rings (a Library design of up to 40 frames, or
the name as scrolling text). Each one is stored in the clock's own reminder slots (it holds 14 in all), so it
rings **without Home Assistant**. Switching one off removes it from the clock and keeps it here. Reminders
that the vendor app put on the clock are listed too, read-only, with delete, and an item that is no
longer on the clock says "Re-send". Weekdays, weekends and custom days fit in one slot (the clock takes a
weekday mask). A finished one-time alarm stays on the clock and keeps its slot until deleted. Services:
`iledclock.reminder_set`, `reminder_set_enabled` and `reminder_delete`.

### Text

`iledclock.show_text` draws the text with the integration's own pixel fonts and sends it as a picture or
an animation (the earlier native-text upload showed a blank screen on the clock). Text that fits the 32
columns is one still picture; longer text scrolls and never uses more than 40 frames. `speed` is the same
0-100 playback speed as every other show.

## Services

| Service | Purpose |
|---|---|
| `iledclock.show_text` | Show text now (drawn as pixels, long text scrolls): `color`, `color_mode` (1 one colour, 2 rainbow, 4 per-letter), `font`, `is_bold`, `speed` (0-100), `smooth`, `slot`; with `duration_s` screen A is put back afterwards |
| `iledclock.show_design` | Show a saved pixel-art image or animation now; optional `speed` (0-100), `smooth` and `slot` |
| `iledclock.show_image` | Import and show a photo/GIF now; optional `speed` (0-100), `smooth` and `slot` |
| `iledclock.show_generative` | Show a procedural animation now; optional `speed` (0-100), `smooth` and `slot` |
| `iledclock.set_playlist` | Replace the whole program rotation (screen A) |
| `iledclock.clock_face` | Show a clock style with full colour/12h-24h control; optional `slot` |
| `iledclock.countdown_reset` / `.countdown_run` | Countdown timer |
| `iledclock.stopwatch_reset` / `.stopwatch_run` | Stopwatch |
| `iledclock.scoreboard_set_score` / `.scoreboard_set_time` / `.scoreboard_run` | Scoreboard |
| `iledclock.set_alarms` | Replace the clock's basic alarm list (up to 16; sound only, no name or picture) |
| `iledclock.set_timer_switches` | Replace the timer-switch list (up to 4) |
| `iledclock.set_pomodoro` | Replace the pomodoro/tomato duration list |
| `iledclock.night_mode` | Configure night mode in one call |
| `iledclock.reminder_set` | Create or change a named alarm or reminder (stored on the clock; answers with its `key`) |
| `iledclock.reminder_set_enabled` | Switch one on (written to the clock) or off (removed from the clock, kept here) |
| `iledclock.reminder_delete` | Delete an alarm or reminder by `key`, or one that exists only on the clock by `id` |
| `iledclock.switch_screen` | Press the clock's power key once: flips between screen A and B (a toggle, the clock gives no feedback) |
| `iledclock.sync_time` | Sync time now |
| `iledclock.release_link` | Disconnect now, freeing the Bluetooth link (this also happens by itself when Home Assistant shuts down or restarts, so the proxy is not left holding a stale link) |
| `iledclock.send_raw` | Advanced: send a raw opcode/payload directly |

## Known limitations (honestly disclosed)

- **Alarms and reminders, screen B and the screen switch were verified on the real clock on
  2026-10-02.** Each capability sits behind a named flag in `hardware.py`; the reminder limits (14 in
  all, ids 1-15), weekday masks and plain art on screen B were confirmed live. Screen A is still
  re-sent after every reminder write (cheap: nothing changed means no data is sent).
  `docs/SLOTS-AND-REMINDERS.md` has the test plan and results.
- **Home Assistant cannot see which screen is showing** or react to the clock's buttons (they send
  nothing over Bluetooth), so the screen tiles show what was sent last, not what is on display.
- **The clock's built-in pomodoro is not replaced.** It runs inside the firmware and is started and
  paused only by the clock's buttons; Home Assistant can change its list of durations
  (`iledclock.set_pomodoro`) and nothing else. Reminders are alerts at fixed clock minutes: no pause,
  no start button on the clock.
- **The 31 ambient light effects and 41 clock styles are numbered, not named.** The decompiled
  vendor app's obfuscated resources don't retain human-readable names for these, so they're
  labelled "Effect 1"–"Effect 31" and "Style 1"–"Style 41" rather than guessed descriptions.
- **Speed 100% is a calibration point, not a measured ceiling.** "Max" is 7 delay units a frame
  (10.5 ms, about 95 frames a second), the fastest setting seen to play smoothly by eye; whether the
  panel shows every frame at that rate is unmeasured. Very fast playback can look like strobing on
  high-contrast art.
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
