"""Every simple builder from ``ILedClockUtils.java`` lines 4732-5337, plus ``setColor``/
``setColorSpeed``/``setColorMode`` (5064-5217) and ``adjustPower`` (5072-5086).

Every function returns the bare, **unframed** payload (opcode first) — the caller (or
``framing.encode_frame``) frames it. See ``framing.py``'s module docstring for why this
differs from the vendor's own per-builder framing.

Validation policy: where the app itself hard-limits a value in its own UI (documented in
``docs/ARCHITECTURE.md`` / ``docs/FEATURES-app.md``) this module raises ``ValueError``
outside that range, rather than silently reproducing a vendor byte-corruption quirk — see
each function's docstring. Two vendor quirks are exceptions, kept faithfully reachable
through the public API because they stay perfectly well-formed (silently *shorter*, never
misaligned) for any input, and the vendor never guards them either:

* :func:`brightness` is the one case that is genuinely unrepresentable for large inputs: the
  vendor's own out-of-range behaviour (``LightUtils.getHexStringForInt``, singular) emits
  *unpadded* raw hex for values >= 256, corrupting byte alignment for everything after it
  in the packet — literally not expressible as a Python ``bytes`` object (an odd number of
  hex digits) once that happens. Every value the wire format can actually hold cleanly as one
  byte (0-255 — confirmed against golden vectors down to 0 and up to 255, not just the app
  UI's 5-100 slider range) is accepted; only >= 256 raises, matching exactly where the
  vendor's own encoding first breaks.
* :func:`rhythm_type` and :func:`music_data` use the *List*-returning
  ``getHexListStringForInt`` (plural) internally via :func:`hexutil.u8`, whose out-of-range
  behaviour is simply "silently emit no byte for this value" — well-formed, if short. These
  therefore only validate non-negativity, matching the vendor's own total absence of a
  ceiling check.
"""

from __future__ import annotations

from collections.abc import Sequence

from datetime import datetime

from . import color_tables
from .hexutil import rgb444_pixel, u8, u8_str, u16be
from .models import AlarmItem, NightMode, RGB, Reminder, TimerSwitchItem, weekday_mask


def _require_range(name: str, value: int, lo: int, hi: int) -> None:
    if not (lo <= value <= hi):
        raise ValueError(f"{name} must be in {lo}..{hi}, got {value}")


def _bool_byte(flag: bool) -> bytes:
    return b"\x01" if flag else b"\x00"


# --- device / display -----------------------------------------------------------------


def device_info() -> bytes:
    """``getDeviceInfo`` (opcode 0x1f): query brightness/rotate/mic/program-count/etc."""
    return b"\x1f"


def power(on: bool) -> bytes:
    """``getSwitchData`` (opcode 0x05): display on/off."""
    return b"\x05" + _bool_byte(on)


def brightness(level: int) -> bytes:
    """``getSetBrightness`` (opcode 0x04). The app's own slider only offers 5-100, but the
    wire format itself cleanly represents any single byte 0-255 (verified against golden
    vectors at 0, 1, 50, 100, 255); only 256+ hits the unrepresentable quirk (see module
    docstring), so this validates the full 0-255 the wire can actually carry, not the
    narrower UI range."""
    _require_range("brightness", level, 0, 255)
    return b"\x04" + bytes((level,))


def mirror(on: bool) -> bytes:
    """``getSetMirror`` (opcode 0x0c) — shares its opcode with :func:`rotate`; the vendor
    exposes both a plain on/off "mirror" toggle and a 4-way rotate control over the same
    wire opcode, just with a different value domain (0/1 vs. 0-3)."""
    return b"\x0c" + _bool_byte(on)


def rotate(mode: int) -> bytes:
    """``setRotate`` (opcode 0x0c). 0=none, 1=xy-flip, 2=x-flip, 3=y-flip."""
    _require_range("rotate mode", mode, 0, 3)
    return b"\x0c" + bytes((mode,))


def check_password(password: str, salt: int | None = None) -> bytes:
    """``getCheckPasswordData`` (opcode 0x0d). ``password`` is a string of hex digit
    characters (default device password is ``"000000"``). Each hex nibble is XORed with a
    random salt byte (freshly generated if ``salt`` is omitted); the last byte is the XOR
    checksum of every salted nibble.
    """
    return _password_payload(0x0D, password, salt)


def set_password(password: str, salt: int | None = None) -> bytes:
    """``getSetPasswordData`` (opcode 0x0e): same salted-nibble scheme as
    :func:`check_password`, sets a new device password.
    """
    return _password_payload(0x0E, password, salt)


def _password_payload(opcode: int, password: str, salt: int | None) -> bytes:
    if salt is None:
        import random

        salt = random.randrange(256)
    _require_range("salt", salt, 0, 255)
    body = bytearray((opcode, salt))
    for ch in password:
        nibble = int(ch, 16)
        body.append(nibble ^ salt)
    checksum = 0
    for b in body[2:]:
        checksum ^= b
    body.append(checksum)
    return bytes(body)


def sync_time(dt: datetime) -> bytes:
    """``getSynchronizeTime`` (opcode 0x09). Weekday is Monday=1..Sunday=7
    (``dt.isoweekday()``), matching the vendor's own remap of
    ``Calendar.DAY_OF_WEEK`` (Sunday=1..Saturday=7) to that same Monday-first scheme.
    """
    year_offset = dt.year - 2000
    _require_range("sync_time year", year_offset, 0, 255)
    return b"\x09" + bytes(
        (year_offset, dt.month, dt.day, dt.isoweekday(), dt.hour, dt.minute, dt.second)
    )


def music_data(kind: int, values: list[int]) -> bytes:
    """``getMusicDataString`` (opcode 0x01): rhythm-visualisation kind + a frequency-band
    byte array. Values outside 0-255 are silently dropped by the vendor's own
    ``getHexListStringForInt`` (well-formed, just shorter) — not re-validated here beyond
    non-negativity, matching that behaviour exactly rather than second-guessing it.
    """
    if kind < 0 or any(v < 0 for v in values):
        raise ValueError("music_data kind/values must be non-negative")
    return b"\x01" + u8(kind) + b"".join(u8(v) for v in values)


def rhythm_type(kind: int) -> bytes:
    """``getSetRyhthmType`` (opcode 0x06). The app UI offers 5 types (1-5); values
    >= 256 are silently dropped by the vendor (see module docstring) rather than
    rejected, so this only guards non-negativity to stay faithful to that.
    """
    if kind < 0:
        raise ValueError("rhythm_type kind must be non-negative")
    return b"\x06" + u8(kind)


# --- stopwatch / countdown / scoreboard -------------------------------------------------


def stopwatch_status() -> bytes:
    return b"\x10\x01"


def stopwatch_reset() -> bytes:
    return b"\x10\x02"


def stopwatch_run(start: bool) -> bytes:
    return b"\x10\x03" + _bool_byte(start)


def countdown_status() -> bytes:
    return b"\x0f\x01"


def countdown_reset(hour: int, minute: int, second: int) -> bytes:
    _require_range("hour", hour, 0, 23)
    _require_range("minute", minute, 0, 59)
    _require_range("second", second, 0, 59)
    return b"\x0f\x02" + bytes((hour, minute, second))


def countdown_run(start: bool) -> bytes:
    return b"\x0f\x03" + _bool_byte(start)


def scoreboard_status() -> bytes:
    return b"\x11\x01"


def scoreboard_set_score(home: int, away: int, home_total: int, away_total: int) -> bytes:
    """``getScoreBoardSetCore``. ``home``/``away`` are the live 2-byte scores;
    ``home_total``/``away_total`` are the 1-byte running totals shown alongside them.
    """
    _require_range("home", home, 0, 0xFFFF)
    _require_range("away", away, 0, 0xFFFF)
    _require_range("home_total", home_total, 0, 255)
    _require_range("away_total", away_total, 0, 255)
    return b"\x11\x02" + u16be(home) + u16be(away) + bytes((home_total, away_total))


def scoreboard_set_time(minute: int, second: int, count_down: bool) -> bytes:
    _require_range("minute", minute, 0, 255)
    _require_range("second", second, 0, 255)
    return b"\x11\x03" + bytes((minute, second)) + _bool_byte(count_down)


def scoreboard_run(start: bool) -> bytes:
    return b"\x11\x04" + _bool_byte(start)


# --- timer switch / device settings / colour --------------------------------------------


def timer_switch_get() -> bytes:
    return b"\x0b"


def timer_switch_set(items: list[TimerSwitchItem]) -> bytes:
    """``setTimerSwitch`` (opcode 0x0a, max 4 items)."""
    if not items:
        return b"\x0a" + u8(0)
    body = bytearray(b"\x0a")
    body += u8(len(items))
    for item in items:
        body.append(1 if item.enable else 0)
        body.append(item.hour)
        body.append(item.minute)
        body.append(0 if item.is_never else weekday_mask(item))
        body.append(1 if item.is_set_device_on else 0)
        body.append(0)
    return bytes(body)


def device_setting(kind: int, on: bool) -> bytes:
    """``setDeviceInfo`` (opcode 0x1e). ``kind`` selects which boolean device setting;
    only 1/2/3 are meaningful to the vendor (any other value omits the selector byte
    entirely, producing a malformed frame), so this validates strictly.
    """
    _require_range("device_setting kind", kind, 1, 3)
    return b"\x1e" + bytes((kind,)) + _bool_byte(on)


def volume(level: int) -> bytes:
    """``setDeviceVolume`` (opcode 0x1e 0x06)."""
    _require_range("volume", level, 0, 100)
    return b"\x1e\x06" + u8(level)


def color(rgb: RGB) -> bytes:
    """``setColor`` (opcode 0x13 0x01): solid display colour, RGB444-quantised with the
    curved mapping (:func:`hexutil.rgb444_pixel`), matching what the LEDs can show.
    """
    return b"\x13\x01" + rgb444_pixel(rgb)


def color_speed(value: int) -> bytes:
    """``setColorSpeed`` (opcode 0x13 0x02)."""
    _require_range("color_speed", value, 0, 255)
    return b"\x13\x02" + u8(value)


def color_mode(mode: int) -> bytes:
    """``setColorMode`` (opcode 0x13 0x03).

    This is a line-for-line port of the vendor dispatch, including a real, confirmed
    vendor bug: for every ``mode`` not in ``{1,2,5,6}`` the method's *own* final
    statement unconditionally overwrites the speed byte with a `fallback_speed` local
    (12 for modes 7-16, 30 for modes >=17) — every intermediate ``speed = ...`` write
    for modes 8/9/10/13/14/29/30 that the vendor's dispatch appears to set is dead code,
    and separately, for every mode not in ``{1,2,5,6,7,8,9,10}`` the colour-table
    variable is *also* unconditionally overwritten three more times before returning, so
    the seemingly-per-mode ``colorMode14``/``colorMode19``-``colorMode31`` tables
    referenced along the way never reach the output either — modes 11 and up all emit
    the exact same colour table (only the effect/variant bytes differ). Golden-vector-
    verified for every ``mode`` in ``0..32`` (33 vectors) — do NOT "clean this up" into
    what the tables suggest was intended; that is provably not what the shipped app
    emits.
    """
    effect = 2
    variant = 0
    speed = 90
    table = color_tables.COLOR_MODE_1
    if mode != 1:
        if mode == 2:
            variant = 1
        elif mode == 5:
            variant = 4
        elif mode == 6:
            variant = 5
        else:
            fallback_speed = 12
            if mode == 7:
                table = _MODE_7_8_TABLE
            else:
                speed = 8
                if mode == 8:
                    table = _MODE_7_8_TABLE
                    variant = 1
                elif mode == 9:
                    table = color_tables.COLOR_MODE_9
                    speed = 18
                elif mode != 10:
                    if mode == 11:
                        variant = 2
                    elif mode == 12:
                        variant = 3
                    else:
                        if mode == 13:
                            effect = 1
                        else:
                            if mode == 14:
                                table = color_tables.COLOR_MODE_14
                                speed = 2
                                effect = 1
                            elif mode == 15:
                                effect = 3
                                variant = 4
                            elif mode == 16:
                                effect = 3
                                variant = 5
                            else:
                                fallback_speed = 30
                                if mode != 17:
                                    if mode == 18:
                                        variant = 1
                                    else:
                                        table_19_31 = None
                                        if mode == 19:
                                            table_19_31 = color_tables.COLOR_MODE_19
                                        else:
                                            if mode == 20:
                                                table_19_31 = color_tables.COLOR_MODE_20
                                            elif mode == 21:
                                                table_19_31 = color_tables.COLOR_MODE_21
                                            elif mode == 22:
                                                table_19_31 = color_tables.COLOR_MODE_22
                                            elif mode == 23:
                                                table_19_31 = color_tables.COLOR_MODE_23
                                            elif mode == 24:
                                                table_19_31 = color_tables.COLOR_MODE_24
                                            elif mode == 25:
                                                table_19_31 = color_tables.COLOR_MODE_25
                                            elif mode == 26:
                                                table_19_31 = color_tables.COLOR_MODE_26
                                            elif mode == 27:
                                                table_19_31 = color_tables.COLOR_MODE_27
                                            elif mode == 28:
                                                table_19_31 = color_tables.COLOR_MODE_28
                                            else:
                                                speed = 48
                                                if mode == 29:
                                                    table = color_tables.COLOR_MODE_29
                                                elif mode == 30:
                                                    table = color_tables.COLOR_MODE_30
                                                    variant = 1
                                                elif mode == 31:
                                                    effect = 4
                                                else:
                                                    table = b""
                                                    speed = 0
                                                    effect = 0
                                            variant = 1
                                            table = table_19_31
                                        table = table_19_31
                                table = _MODE_17_TABLE
                            variant = -1
                        speed = 6
                        table = _MODE_13_TABLE
                        variant = -1
                    table = color_tables.COLOR_MODE_9
                    speed = 18
                else:
                    table = color_tables.COLOR_MODE_10
                    variant = 1
                    speed = 18
            speed = fallback_speed
    body = bytearray(b"\x13\x03")
    body += u8(effect)
    if variant >= 0:
        body += u8(variant)
    body += u8(speed)
    body += table
    return bytes(body)


# colorMode7 == colorMode8 (identical vendor literal); colorMode11/12/15/16 == colorMode9/10;
# colorMode13/14/17/18's own tables are dead code (see color_mode docstring) — the literal
# 12- and 60-token fallback tables the vendor's control flow actually lands on:
_MODE_7_8_TABLE = color_tables.hex_csv_to_bytes(
    "0F,00,0F,00,0F,00,0F,00,00,F0,00,F0,00,F0,00,F0,00,0F,00,0F,00,0F,00,0F"
)
_MODE_13_TABLE = color_tables.hex_csv_to_bytes("0F,00,00,F0,00,0F,0F,F0,00,FF,0F,0F")
_MODE_17_TABLE = color_tables.hex_csv_to_bytes(
    "0F,00,0F,00,0F,00,00,00,00,00,"
    "0F,F0,0F,F0,0F,F0,00,00,00,00,"
    "00,F0,00,F0,00,F0,00,00,00,00,"
    "00,FF,00,FF,00,FF,00,00,00,00,"
    "00,0F,00,0F,00,0F,00,00,00,00,"
    "0F,0F,0F,0F,0F,0F,00,00,00,00"
)


def adjust_power(rgb: RGB, pixel_count: int) -> RGB:
    """``adjustPower``: scales a colour down (preserving hue) if displaying it across more
    than 96 pixels would exceed a fixed "RGB power budget" of 612 (0xFF*3 - 153) per pixel
    summed — used by the app before sending a single-colour fill over a large pixel count.
    Not used by any Contract A builder directly, ported for completeness/golden coverage.
    """
    if pixel_count <= 96:
        return rgb
    r, g, b = rgb
    total = r + g + b
    if total <= 612:
        return rgb
    scale = 612.0 / total
    return (int(r * scale), int(g * scale), int(b * scale))


# --- OTA / tomato / alarms / temperature / night mode / reminders -----------------------


def ota_version() -> bytes:
    """``getDeviceOTAVersion`` (opcode 0xfd)."""
    return b"\xfd"


def tomato_set(minutes: list[int]) -> bytes:
    """``getSetTomatoClockTime`` (opcode 0x15 0x01, max 6 durations)."""
    body = bytearray(b"\x15\x01")
    body += u8(len(minutes))
    for m in minutes:
        _require_range("tomato minutes", m, 0, 255)
        body.append(m)
    return bytes(body)


def tomato_get() -> bytes:
    return b"\x15\x02"


def alarms_set(items: list[AlarmItem]) -> bytes:
    """``getSetAlarmClockTime`` (opcode 0x16 0x01, max 16)."""
    if not items:
        return b"\x16\x01" + u8(0)
    body = bytearray(b"\x16\x01")
    body += u8(len(items))
    for item in items:
        body.append(1 if item.enable else 0)
        body.append(item.hour)
        body.append(item.minute)
        body.append(0 if item.is_never else weekday_mask(item))
        body += u16be(item.duration)
        body.append(item.reminder_duration)
    return bytes(body)


def alarms_get() -> bytes:
    return b"\x16\x02"


def temperature_humidity(kind: int) -> bytes:
    """``getTemperatureAndHumidity`` (opcode 0x19). ``kind``: 1=current, 2=all-day
    history (the on-device sensor's history buffer)."""
    return b"\x19" + u8(kind)


def night_mode_get() -> bytes:
    return b"\x14\x02"


def night_mode_bytes(values: Sequence[int]) -> bytes:
    """``getSetNightMode``'s ten positional bytes (opcode 0x14 0x01), emitted in argument order."""
    if len(values) != 10:
        raise ValueError("night mode takes exactly 10 values")
    return b"\x14\x01" + bytes(values)


def night_mode_set(cfg: NightMode) -> bytes:
    """``getSetNightMode`` (opcode 0x14 0x01). Argument order is the vendor's real call site,
    ``DeviceManager.java:6983``: ..., brightness, voiceControlEnabled, wakeUpDuration,
    voiceSensitivity - the same order the device reports back in ``14 02`` and
    ``_parse_night_mode`` reads. [DEVICE] 2026-09-26: sending wake before voice made the clock
    store "wake 1 min" and ignore a clap; the golden vector only fixes byte positions (its harness
    mislabelled arguments 8 and 9), so it cannot decide this."""
    return night_mode_bytes(
        (
            1 if cfg.enabled else 0,
            cfg.start_hour,
            cfg.start_minute,
            cfg.end_hour,
            cfg.end_minute,
            1 if cfg.device_state_enabled else 0,
            cfg.brightness,
            1 if cfg.voice_control_enabled else 0,
            cfg.wake_up_duration,
            cfg.voice_sensitivity,
        )
    )


def reminders_get() -> bytes:
    """``getReminder`` (opcode 0x1a 0x01): list summary (ids only)."""
    return b"\x1a\x01"


def reminder_detail(reminder_id: int) -> bytes:
    """``getReminderDetail`` (opcode 0x1a 0x02)."""
    _require_range("reminder_id", reminder_id, 0, 255)
    return b"\x1a\x02" + u8(reminder_id)


def reminder_delete(reminder_id: int) -> bytes:
    """``getDeleteReminder`` (opcode 0x1a 0x03)."""
    _require_range("reminder_id", reminder_id, 0, 255)
    return b"\x1a\x03" + u8(reminder_id)
