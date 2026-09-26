"""Shared dataclasses used by both ``commands.py`` (requests) and ``responses.py`` (replies),
plus the pixel ``Frame`` shared by ``programs.py`` and ``render.py``.

Weekday convention: every ``is_..._on`` bitmask in the vendor protocol packs Monday in bit
0 through Sunday in bit 6 (``getBit(mask, 0)==Monday`` ... ``getBit(mask, 6)==Sunday``,
``DeviceManager.checkILedClockMessages``); the dataclasses below spell that out as seven
named booleans instead of a raw mask so callers never have to remember the bit order.
"""

from __future__ import annotations

from dataclasses import dataclass, field

RGB = tuple[int, int, int]

_WEEKDAY_FIELDS = (
    "is_monday_on",
    "is_tuesday_on",
    "is_wednesday_on",
    "is_thursday_on",
    "is_friday_on",
    "is_saturday_on",
    "is_sunday_on",
)


def weekday_mask(item) -> int:
    """Packs the seven ``is_..._on`` booleans of ``item`` into one bitmask, Monday=bit0 --
    UNLESS ``item.is_never`` is set, which short-circuits to ``0`` regardless of the day
    flags. Verified against source (``ILedClockUtils`` alarm/timer-switch encoders both
    check ``isNever`` first and emit a literal ``00`` byte, never even reading the day
    flags): a golden vector deliberately sets every day flag *and* ``isNever=True``
    together to prove ``isNever`` wins, not merely mirrors an all-false mask.
    """
    if getattr(item, "is_never", False):
        return 0
    mask = 0
    for i, name in enumerate(_WEEKDAY_FIELDS):
        if getattr(item, name):
            mask |= 1 << i
    return mask


def weekday_flags(mask: int) -> dict:
    """Inverse of :func:`weekday_mask`: ``{"is_monday_on": bool, ...}``."""
    return {name: bool(mask & (1 << i)) for i, name in enumerate(_WEEKDAY_FIELDS)}


@dataclass(frozen=True)
class TimerSwitchItem:
    """One entry of ``timer_switch_set`` / ``TimerSwitches`` (opcode 0x0a / 0x0b)."""

    enable: bool
    hour: int
    minute: int
    is_set_device_on: bool  # the scheduled action: True = turn device on, False = off
    is_monday_on: bool = False
    is_tuesday_on: bool = False
    is_wednesday_on: bool = False
    is_thursday_on: bool = False
    is_friday_on: bool = False
    is_saturday_on: bool = False
    is_sunday_on: bool = False
    is_never: bool = False  # wins over the day flags above -- see `weekday_mask`


@dataclass(frozen=True)
class AlarmItem:
    """One entry of ``alarms_set`` / ``Alarms`` (opcode 0x16)."""

    hour: int
    minute: int
    enable: bool = True
    duration: int = 30
    reminder_duration: int = 9
    is_monday_on: bool = False
    is_tuesday_on: bool = False
    is_wednesday_on: bool = False
    is_thursday_on: bool = False
    is_friday_on: bool = False
    is_saturday_on: bool = False
    is_sunday_on: bool = False
    is_never: bool = False  # wins over the day flags above -- see `weekday_mask`


@dataclass(frozen=True)
class NightMode:
    """``night_mode_set`` / ``NightMode`` response (opcode 0x14)."""

    enabled: bool = False
    start_hour: int = 0
    start_minute: int = 0
    end_hour: int = 0
    end_minute: int = 0
    device_state_enabled: bool = False
    brightness: int = 0
    voice_control_enabled: bool = False
    wake_up_duration: int = 0
    voice_sensitivity: int = 0


@dataclass(frozen=True)
class Reminder:
    """``reminders_set``-adjacent per-item content (opcode 0x1a); also the shape of
    ``ReminderDetail`` (opcode 0x1a 0x02) minus ``remind_id``, which the detail reply
    carries separately."""

    year: int  # two-digit, i.e. YY not YYYY (vendor: actual year - 2000)
    month: int
    day: int
    hour: int
    minute: int
    title: str
    sound: int = 1
    repeat_type: int = 0  # 0=never, 1=every day, 2=weekly on this reminder's weekday
    duration: int = 10  # seconds the on-screen popup stays up


@dataclass(frozen=True)
class Segment:
    """One coloured glyph box on the 32x16 panel: colour + position + size, in device
    pixels. Used for every "one field of a clock/date/time-count/scoreboard content"
    slot (hour, minute, seconds, ampm, week, ...) in ``programs.py``. ``width=0`` (the
    default, matching every vendor ``...ProgramContent`` field's own Java default of 0)
    means "omitted" — the vendor's own Activities let a user drag each segment to an
    arbitrary position; this package deliberately does not invent non-zero positions,
    that is the integration/frontend layer's job (see ``program_builder.py``).
    """

    color: RGB = (255, 255, 255)
    start_column: int = 0
    start_row: int = 0
    width: int = 0
    height: int = 0


@dataclass(frozen=True)
class Frame:
    """One 32x16 RGB888 canvas frame — the shared pixel currency of ``render.py`` and every
    pixel-based program content (Graffiti, Animation, and rasterised Text).

    ``pixels`` is row-major: ``pixels[row][col]`` for ``row in 0..height-1``,
    ``col in 0..width-1``, each an ``(r, g, b)`` 0-255 triple — the same orientation as
    ``getAnimationDataColor``/``getDrawListDataFColor`` index into their source
    ``DrawItem`` lists (``list.get(row * width + col)``).
    """

    pixels: list[list[RGB]]
    duration_ms: int = 100
    width: int = 32
    height: int = 16

    def __post_init__(self) -> None:
        if len(self.pixels) != self.height or any(len(row) != self.width for row in self.pixels):
            raise ValueError(
                f"Frame.pixels must be {self.height}x{self.width}, "
                f"got {len(self.pixels)} rows"
            )

    @staticmethod
    def blank(width: int = 32, height: int = 16, color: RGB = (0, 0, 0)) -> "Frame":
        return Frame(pixels=[[color] * width for _ in range(height)], width=width, height=height)
