"""Constants for the iLedClock integration.

Ground truth for every numeric bound here is either a verified live fact (docs/ARCHITECTURE.md
"Verified live facts"), the vendor app's own decompiled UI constraints (docs/FEATURES-app.md,
cited per constant below), or -- where the decompiled sources never pin an exact ceiling -- an
honest, clearly-labelled integration-side sanity bound rather than a fabricated device limit.
"""

from __future__ import annotations

DOMAIN = "iledclock"

MANUFACTURER = "CoolLED"
MODEL = "iLedClock 32x16"

# docs/ARCHITECTURE.md: BLE name/service/characteristic, verified live against 01:00:00:67:0D:8A.
BLE_LOCAL_NAME = "iLedClock"
BLE_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"
BLE_CHAR_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"

# Matrix geometry, fixed by the hardware.
DISPLAY_WIDTH = 32
DISPLAY_HEIGHT = 16

# --- Config-entry options (Contract B) ---------------------------------------------------
CONF_IDLE_TIMEOUT = "idle_timeout"
CONF_REFRESH_INTERVAL = "refresh_interval"
CONF_PASSWORD = "password"
CONF_TIME_SYNC = "time_sync"
#: docs/GALLERY.md: optional Divoom Cloud account for the online gallery source. Only the MD5
#: of the password is ever stored (never the raw password itself) -- computed once in the
#: options flow from a write-only `divoom_password` form field.
CONF_DIVOOM_EMAIL = "divoom_email"
CONF_DIVOOM_PASSWORD_MD5 = "divoom_password_md5"

#: Seconds to hold the GATT link after the last operation before disconnecting; 0 means "keep
#: connected". Default of 60s: long enough that a burst of automations/dashboard interactions
#: does not thrash the connection, short enough that the ESPHome BLE proxy and the vendor phone
#: app are not starved indefinitely (Contract B).
DEFAULT_IDLE_TIMEOUT_S = 60
MIN_IDLE_TIMEOUT_S = 0
MAX_IDLE_TIMEOUT_S = 3600

#: Minutes between periodic full-state refreshes (Contract B: "every 15 min").
DEFAULT_REFRESH_INTERVAL_MIN = 15
MIN_REFRESH_INTERVAL_MIN = 1
MAX_REFRESH_INTERVAL_MIN = 180

#: The device ships with this password (docs/ARCHITECTURE.md verified fact: `0d` check-password
#: with default "000000" -> `0d 00` success). Always sent right after enabling notifications.
DEFAULT_PASSWORD = "000000"
DEFAULT_TIME_SYNC = True

#: `PasswordCheckDialog`/`PasswordSetDialog`/`ILedClockPasswordCheckDialog`/
#: `ILedClockPasswordSetDialog` all hard-limit the input field to
#: `InputFilter.LengthFilter(6)`, and `ILedClockUtils.getCheckPasswordData`/`getSetPasswordData`
#: parse each character with `Integer.valueOf("0"+ch, 16)` -- a single hex nibble XORed against a
#: random challenge byte. So the password is always exactly 6 characters, each 0-9/a-f.
PASSWORD_LENGTH = 6

# --- Device-side wire quirk --------------------------------------------------------------
#: `LightUtils.getHexListStringForInt(i)` (and its per-device-family siblings) emits NOTHING for
#: i > 255 -- silently dropping the field instead of raising -- so any single-byte integer field
#: we let a user set (volume, colour speed, ...) MUST be clamped to this ceiling before it ever
#: reaches protocol.commands, or the resulting frame is quietly malformed. docs/ARCHITECTURE.md
#: calls this out by name as a quirk to preserve, not fix.
WIRE_BYTE_MAX = 255

# --- Device/display controls --------------------------------------------------------------
#: docs/FEATURES-app.md #16: brightness seekbar range in the app is 5-100. HA's own brightness
#: scale is 1-255; `brightness_to_ha`/`brightness_to_app` below convert between the two.
BRIGHTNESS_APP_MIN = 5
BRIGHTNESS_APP_MAX = 100


def brightness_to_ha(app_value: int) -> int:
    """Device brightness (`BRIGHTNESS_APP_MIN`-`BRIGHTNESS_APP_MAX`) -> HA's light brightness
    scale (1-255). Out-of-range input is clamped rather than raising: a stale/future firmware
    value should degrade to "closest valid brightness", not break the light entity."""
    clamped = max(BRIGHTNESS_APP_MIN, min(BRIGHTNESS_APP_MAX, app_value))
    span = BRIGHTNESS_APP_MAX - BRIGHTNESS_APP_MIN
    return max(1, min(255, 1 + round((clamped - BRIGHTNESS_APP_MIN) * 254 / span)))


def brightness_to_app(ha_value: int) -> int:
    """Inverse of `brightness_to_ha`."""
    clamped = max(1, min(255, ha_value))
    span = BRIGHTNESS_APP_MAX - BRIGHTNESS_APP_MIN
    return max(BRIGHTNESS_APP_MIN, min(BRIGHTNESS_APP_MAX, BRIGHTNESS_APP_MIN + round((clamped - 1) * span / 254)))


#: docs/FEATURES-app.md #17: rotate/mirror combine a 4-way rotate mode (0=none, 1=xy-flip,
#: 2=x-flip, 3=y-flip) with an independent mirror flag (Contract A exposes both as separate
#: `rotate(mode)` / `mirror(on)` builders).
ROTATE_MODES = (0, 1, 2, 3)
ROTATE_MODE_LABELS = {0: "None", 1: "Flip both axes", 2: "Flip horizontal", 3: "Flip vertical"}

#: `commands.device_setting(kind, on)` (opcode 0x1e) `kind` values with recovered UI meaning,
#: from the decompiled `ILedClockSettingsFragment`'s two checkboxes (`showDeviceIdCb` ->
#: `SetILedClockDeviceInfoEvent(1, z)`/`SetILedClockDeviceInfoEvent(2, z)` for `remoteCb` -- the
#: view-id-to-checkbox mapping in the obfuscated resource table could not be resolved with
#: certainty, so kind 1/2 below may be swapped pending live-device confirmation; both toggles
#: are otherwise fully implemented). `setDeviceInfo` also handles kind 3, but no UI control
#: referencing it survived decompilation, so no switch is exposed for it (see switch.py).
DEVICE_SETTING_SHOW_DEVICE_ID = 1
DEVICE_SETTING_REMOTE_ENABLE = 2

#: `ILedClockUtils.setColorMode` handles ambient light-effect indices 1-31 (traced through the
#: decompiled, heavily obfuscated branch table -- i==31 is the last branch with real effect
#: data; anything else falls through to an empty/no-op payload). The decompiled bytecode never
#: recovers human names per index (no string table survives obfuscation), so we label them
#: numerically rather than inventing descriptions we can't verify -- honest best effort per
#: project ground rules.
COLOR_MODE_MIN = 1
COLOR_MODE_MAX = 31

#: Ambient colour-cycle speed (`ILedClockUtils.setColorSpeed`) is encoded with
#: `getHexListStringForInt`, so WIRE_BYTE_MAX is its hard ceiling (neither decompiled activity
#: pins a tighter on-screen bound with confidence, so we expose the full wire-safe range rather
#: than guessing a narrower one that could reject values the device actually accepts). Device
#: volume, by contrast, IS confirmed: `protocol.commands.volume` enforces 0-100 directly
#: (`setDeviceVolume`'s own range check).
COLOR_SPEED_MIN = 0
COLOR_SPEED_MAX = WIRE_BYTE_MAX
VOLUME_MIN = 0
VOLUME_MAX = 100

#: docs/FEATURES-app.md #1: 41 clock styles, colours 0-7 (red/magenta/yellow/green/cyan/blue/
#: white/black).
CLOCK_STYLE_MIN = 1
CLOCK_STYLE_MAX = 41
CLOCK_COLOR_MIN = 0
CLOCK_COLOR_MAX = 7
CLOCK_COLOR_NAMES = (
    "Red", "Magenta", "Yellow", "Green", "Cyan", "Blue", "White", "Black",
)
#: RGB888 for each named clock colour (`TextEmojiManagerCoolLEDUX`'s colour constants use the
#: obvious primaries/secondaries for this enum; "Black" is a real, if unusual, option in the
#: app -- picking it does make the digits invisible against an unlit background, faithfully
#: reproduced rather than special-cased away).
CLOCK_COLOR_RGB: dict[int, tuple[int, int, int]] = {
    0: (255, 0, 0),
    1: (255, 0, 255),
    2: (255, 255, 0),
    3: (0, 255, 0),
    4: (0, 255, 255),
    5: (0, 0, 255),
    6: (255, 255, 255),
    7: (0, 0, 0),
}

#: docs/FEATURES-app.md #2: 28 colour modes for TEXT programs specifically -- a different axis
#: from the ambient COLOR_MODE_* above (that one is opcode 0x13, this one is baked into the text
#: program content itself). Also numbered only, for the same reason as COLOR_MODE_*.
TEXT_COLOR_MODE_MIN = 1
TEXT_COLOR_MODE_MAX = 28
TEXT_MODE_MAX_LENGTH = 120  # integration-side sanity cap, not a device-confirmed limit.
TEXT_SPEED_MIN = 0
TEXT_SPEED_MAX = WIRE_BYTE_MAX

# --- Timers / scoreboard / pomodoro --------------------------------------------------------
#: docs/FEATURES-app.md #10: 1-6 durations per pomodoro/tomato list.
MIN_TOMATO_ENTRIES = 1
MAX_TOMATO_ENTRIES = 6
TOMATO_MINUTES_MIN = 1
TOMATO_MINUTES_MAX = 999

SCOREBOARD_SCORE_MIN = 0
SCOREBOARD_SCORE_MAX = 999  # sane UI cap; the live 2-byte score field is wire-safe to 65535
#: `commands.scoreboard_set_time` packs minute/second as single wire bytes (0-255 each) --
#: unlike the live score, this one is a real device ceiling, not just our own UI cap.
SCOREBOARD_MINUTES_MIN = 0
SCOREBOARD_MINUTES_MAX = 255
SCOREBOARD_SECONDS_MIN = 0
SCOREBOARD_SECONDS_MAX = 59

# --- Alarms / timer switches / reminders ---------------------------------------------------
#: docs/FEATURES-app.md #11: max 16 alarms.
MAX_ALARMS = 16
#: docs/FEATURES-app.md #13: max 4 timer-switch entries.
MAX_TIMER_SWITCHES = 4
#: docs/FEATURES-app.md #21: max 16 reminders.
MAX_REMINDERS = 16
REMINDER_CONTENT_MAX_LENGTH = 60  # UTF-8 content; integration-side sanity cap.

#: docs/FEATURES-app.md #12 ("10 Parameters"): fields (1) enabled (2) start hour (3) start
#: minute (4) end hour (5) end minute (6) device state enabled (7) brightness 0-100 (8) wake
#: duration 5-? minutes (9) voice control enabled (10) voice sensitivity 1-?. The two "?" upper
#: bounds were never pinned down in the decompiled sources; these are generous, clearly-labelled
#: integration-side caps, not device-confirmed ceilings.
NIGHT_MODE_BRIGHTNESS_MIN = 0
NIGHT_MODE_BRIGHTNESS_MAX = 100
NIGHT_MODE_WAKE_MINUTES_MIN = 5
NIGHT_MODE_WAKE_MINUTES_MAX = 120
NIGHT_MODE_VOICE_SENSITIVITY_MIN = 1
NIGHT_MODE_VOICE_SENSITIVITY_MAX = 10

# --- Playlist (Contract D) ------------------------------------------------------------------
#: Contract D: "up to device max (9) items" -- the live device's own 1f dump observed 9 program
#: slots (docs/ARCHITECTURE.md verified fact).
MAX_PLAYLIST_ITEMS = 9
PLAYLIST_KINDS = (
    "clock", "date", "text", "design", "timer", "scoreboard", "temperature", "humidity",
)
PLAYLIST_DURATION_MIN_S = 1
PLAYLIST_DURATION_MAX_S = 3600
DEFAULT_PLAYLIST_DURATION_S = 10

# --- Designs (custom pixel art / animation library, store.py) ------------------------------
DESIGN_KINDS = ("image", "animation")
DESIGN_MAX_FRAMES = 64
DESIGN_MIN_DELAY_MS = 20
DESIGN_MAX_DELAY_MS = 60_000
DESIGN_NAME_MAX_LENGTH = 64

# --- Generative animations (render.py `generative(kind, ...)`) ------------------------------
GENERATIVE_KINDS = ("life", "fire", "plasma", "matrix", "starfield", "rainbow", "sparkle")
GENERATIVE_SECONDS_MIN = 1
GENERATIVE_SECONDS_MAX = 300

# --- Ambient light effects exposed on light.<name>_display (Contract C) --------------------
LIGHT_EFFECT_PREFIX = "Effect "


def light_effect_name(mode: int) -> str:
    """Human label for an ambient colour-mode index. See `COLOR_MODE_MIN`/`MAX`'s docstring for
    why these are numbered rather than named."""
    return f"{LIGHT_EFFECT_PREFIX}{mode}"


def light_effect_mode(name: str) -> int | None:
    """Inverse of `light_effect_name`; `None` if `name` isn't one of ours."""
    if not name.startswith(LIGHT_EFFECT_PREFIX):
        return None
    try:
        mode = int(name[len(LIGHT_EFFECT_PREFIX):])
    except ValueError:
        return None
    return mode if COLOR_MODE_MIN <= mode <= COLOR_MODE_MAX else None


CLOCK_FACE_PREFIX = "Style "


def clock_face_name(style: int) -> str:
    """Human label for a clock style index (docs/FEATURES-app.md #1: 41 styles, unnamed)."""
    return f"{CLOCK_FACE_PREFIX}{style}"


def clock_face_style(name: str) -> int | None:
    """Inverse of `clock_face_name`; `None` if `name` isn't one of ours."""
    if not name.startswith(CLOCK_FACE_PREFIX):
        return None
    try:
        style = int(name[len(CLOCK_FACE_PREFIX):])
    except ValueError:
        return None
    return style if CLOCK_STYLE_MIN <= style <= CLOCK_STYLE_MAX else None


# --- Diagnostics / availability -------------------------------------------------------------
#: Contract B: "Unavailable only after 3 consecutive failed refreshes; last good state is kept
#: meanwhile."
CONSECUTIVE_FAILURES_FOR_UNAVAILABLE = 3
#: Contract B: request/reply timeout and per-chunk upload retry count (app: MAX_RETRY 3, 5000ms).
REQUEST_TIMEOUT_S = 5.0
UPLOAD_CHUNK_RETRIES = 3
#: Contract B: SplitWriter 180-byte chunks, 15ms inter-chunk spacing.
MAX_WRITE_CHUNK = 180
#: `protocol.programs.plan_upload(program, index, count, package_size)`'s content-bytes-per-
#: ACKed-chunk parameter. Confirmed with the protocol agent from `DeviceManager`:
#: `ILedClock_PACKAGE_SIZE` is only ever read from the device-info reply when that reply is
#: exactly 21 tokens long; our real device's `1f` reply is 24 tokens (ARCHITECTURE.md verified
#: fact), so that branch never fires and the app's own hardcoded fallback of 1024 always wins.
#: Always pass this literal; there is nothing to negotiate per-device.
UPLOAD_PACKAGE_SIZE = 1024
WRITE_CHUNK_SPACING_S = 0.015
#: Contract B: "Time sync on first connect after HA start and daily at 03:30 local."
TIME_SYNC_HOUR = 3
TIME_SYNC_MINUTE = 30

# --- Services (services.yaml / services.py) --------------------------------------------------
SERVICE_SHOW_TEXT = "show_text"
SERVICE_SHOW_DESIGN = "show_design"
SERVICE_SHOW_IMAGE = "show_image"
SERVICE_SHOW_GENERATIVE = "show_generative"
SERVICE_SET_PLAYLIST = "set_playlist"
SERVICE_CLOCK_FACE = "clock_face"
SERVICE_COUNTDOWN_RESET = "countdown_reset"
SERVICE_COUNTDOWN_RUN = "countdown_run"
SERVICE_STOPWATCH_RESET = "stopwatch_reset"
SERVICE_STOPWATCH_RUN = "stopwatch_run"
SERVICE_SCOREBOARD_SET_SCORE = "scoreboard_set_score"
SERVICE_SCOREBOARD_SET_TIME = "scoreboard_set_time"
SERVICE_SCOREBOARD_RUN = "scoreboard_run"
SERVICE_SET_ALARMS = "set_alarms"
SERVICE_SET_TIMER_SWITCHES = "set_timer_switches"
SERVICE_SET_POMODORO = "set_pomodoro"
SERVICE_NIGHT_MODE = "night_mode"
SERVICE_REMINDER_DELETE = "reminder_delete"
SERVICE_SYNC_TIME = "sync_time"
SERVICE_RELEASE_LINK = "release_link"
SERVICE_SEND_RAW = "send_raw"

ATTR_TEXT = "text"
ATTR_COLOR = "color"
ATTR_COLOR_MODE = "color_mode"
ATTR_SPEED = "speed"
ATTR_FONT = "font"
ATTR_IS_BOLD = "is_bold"
ATTR_MOVE_SPACE = "move_space"
ATTR_DURATION_S = "duration_s"
ATTR_DESIGN_ID = "design_id"
ATTR_URL = "url"
ATTR_DATA_B64 = "data_b64"
ATTR_FIT = "fit"
ATTR_DITHER = "dither"
ATTR_KIND = "kind"
ATTR_SEED = "seed"
ATTR_SECONDS = "seconds"
ATTR_PLAYLIST = "playlist"
ATTR_STYLE = "style"
ATTR_HOURS24 = "hours24"
ATTR_SHOW_SECONDS = "show_seconds"
ATTR_HOUR = "hour"
ATTR_MINUTE = "minute"
ATTR_SECOND = "second"
ATTR_START_HOUR = "start_hour"
ATTR_START_MINUTE = "start_minute"
ATTR_END_HOUR = "end_hour"
ATTR_END_MINUTE = "end_minute"
ATTR_START = "start"
ATTR_HOME = "home"
ATTR_AWAY = "away"
ATTR_COUNT_DOWN = "count_down"
ATTR_ALARMS = "alarms"
ATTR_TIMER_SWITCHES = "timer_switches"
ATTR_MINUTES = "minutes"
ATTR_ENABLED = "enabled"
ATTR_REPEAT = "repeat"
ATTR_ON = "on"
ATTR_ID = "id"
ATTR_DEVICE_OFF = "device_off"
ATTR_BRIGHTNESS = "brightness"
ATTR_WAKE_MINUTES = "wake_minutes"
ATTR_VOICE = "voice"
ATTR_VOICE_SENSITIVITY = "voice_sensitivity"
ATTR_OPCODE = "opcode"
ATTR_PAYLOAD_HEX = "payload_hex"
ATTR_TIMEOUT_S = "timeout_s"

# --- Dispatcher signals ----------------------------------------------------------------------


def upload_progress_signal(entry_id: str) -> str:
    """Contract B: `iledclock_upload_progress_<entry_id>`."""
    return f"iledclock_upload_progress_{entry_id}"


# --- Frontend / panel (Contract E) ------------------------------------------------------------
FRONTEND_JS_MODULE = "iledclock-studio-panel"
PANEL_URL_PATH = "iledclock"
PANEL_TITLE = "Pixel Studio"
PANEL_ICON = "mdi:dots-grid"
STATIC_PATH = f"/{DOMAIN}_static"
FRONTEND_JS_FILENAME = "iledclock.js"

# --- Storage (store.py) ------------------------------------------------------------------------
STORAGE_VERSION = 1
STORAGE_KEY_PREFIX = f"{DOMAIN}_store"
