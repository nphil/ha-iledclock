"""Byte-identical port of the vendor program-content encoders and upload pipeline: every
``ILedClockUtils.getDataWith*CombineProgram``/``getDataWith*ProgramContent`` content encoder,
``getDataForCombineProgram``'s type dispatch, ``getDataWithProgram``, ``getDataResult`` (the
4-arg overload -- the only one ``DeviceManager`` actually calls for our device), the two
``getStartDataForProgram`` overloads that overload resolves to, and ``getDataPacket`` (3-arg,
package-size-parameterised) chunking.

Every content dataclass mirrors the vendor's own ``ILedClock*ProgramContent`` field set, with
one deliberate simplification everywhere a colour+position+size cluster repeats: those four
fields collapse into one :class:`~.models.Segment`. A ``Segment`` left at its default
(``width=height=0``) means "omitted" -- this package never invents a non-zero position for
one; that is ``program_builder.py``'s job (see its own module docstring).

Two RGB444 quantisations are used, and mixing them up is a real protocol bug, not a style
choice: single solid-colour header fields (every ``*Color`` field on Clock/Date/TimeCount/
ScoreBoard/Temperature/Humidity) use the *linear* mapping (``hexutil.rgb444_linear`,
``TextEmojiManagerCoolLEDUX.getColorDataWithColor``); actual pixel data (Graffiti/Animation
frames, and this package's own from-scratch Text glyph rendering) uses the *curved* mapping
(``hexutil.rgb444_pixel``, ``getColorDataWithColorWithRGB444Transfer``).

TEXT CONTENT (`TextContent`) IS NOT USED BY THE INTEGRATION ANY MORE, AND ITS GLYPH LAYER IS
KNOWN NOT TO MATCH THE VENDOR WIRE FORMAT. The encoders stay (the tag-05/06 colour layers are
vendor-verified against golden vectors), but the tag-01 glyph layer written here -- raw RGB444
pixel columns -- is not what the vendor app sends: the app ships its own 1-bit glyph bitmaps
with a header, taken from proprietary font binaries (``UNICODE12``, ``UNICODE16``, ...) that
this project does not have and would not ship (Contract A: only our own bundled open-licensed
fonts, see ``fonts/``). A clock given this layer drew nothing (BlankText report). The
integration therefore draws text to pixel frames and uploads those as graffiti/animation
(``program_builder.frames_to_content``); `TextContent` is kept only for byte-level completeness.

GIF-FILE / RESOURCE-ID / ENCRYPTED-FILE ANIMATION OVERLOADS: ``getDataWithAnimationCombineProgram``
has three more overloads beyond the pixel-frame one (`AnimationContent`/tag ``03 01``) that read
their payload from a GIF file, a bundled Android drawable resource, or an encrypted GIF file --
all three, plus the always-reachable ``ILedClockGifAnimationProgramContent`` wrapper (tag ``0c``,
GIF_FILE_ANIMATION combine-program type 15) share one wire structure (`_encode_animation_raw_bytes`).
``DeviceManager.CoolleduxDeviceVersion`` -- an unrelated product line's version gate -- is never
set for iLedClock, so the resource-id/gif-file/encrypted-file *dispatch paths inside ANIMATION's
own combine-program type* are unreachable from the live app; GIF_FILE_ANIMATION's own dispatch
(type 15) does not gate on that version at all and is reachable. All four are implemented here
regardless of reachability, taking the payload bytes as a plain parameter -- real file/Android-
resource I/O is not this module's concern (see ``encode_gif_file_animation`` etc. below).
"""

from __future__ import annotations

import datetime
import unicodedata
from dataclasses import dataclass, field
from typing import Union

from . import clock_faces, color_tables, hexutil
from .crc import crc_code
from .fonts import get_font, glyph_height
from .hexutil import rgb444_linear, rgb444_pixel, u16be, u32be
from .lzss import compress
from .models import RGB, Frame, Segment

# --- content dataclasses -------------------------------------------------------------------


@dataclass(frozen=True)
class TextAutoColor:
    """``ILedClockTextAutoColorProgramContent`` (autoColorType only; position/size come from
    the enclosing :class:`TextContent`, matching the vendor's own header sharing)."""

    effect: int  # 1..28 -> COLOR_TYPE_1..14 (linear reuse for 15..28), see `commands.color_mode`
    speed: int = 230


@dataclass(frozen=True)
class TextCustomColor:
    """``ILedClockTextCustomColorProgramContent``. ``colors`` is cycled one entry per
    character (our own choice for a per-character custom-colour text -- there is no vendor
    font available to golden-vector-verify a *specific* algorithm against, see module
    docstring; wire header layout is verified)."""

    colors: list[RGB]
    speed: int = 255
    mode: int = 1
    stay_time: int = 3


@dataclass(frozen=True)
class TextContent:
    """``ILedClockTextItem``: one ``Content`` tag=06/05 colour layer plus the always-present
    tag=01 glyph layer. ``show_width``/``show_height`` of 0 mean "size to the rendered text /
    panel height", resolved at encode time."""

    text: str
    color: Union[TextAutoColor, TextCustomColor]
    font: str = "5x7"
    is_bold: bool = False
    move_space: int = 1
    layer_type: int = 0
    start_column: int = 0
    start_row: int = 0
    show_width: int = 0
    show_height: int = 0
    mode: int = 1
    speed: int = 60
    stay_time: int = 3
    frame: "FrameContent | None" = None


@dataclass(frozen=True)
class ClockContent:
    """``ILedClockClockProgramContent`` (tag 07). Verified byte-for-byte against all 3 golden
    ``getDataWithClockCombineProgram`` vectors (2 real + 1 documented off-geometry throw)."""

    style_index: int
    is_24_hour: bool = True
    hour: Segment = field(default_factory=Segment)
    space_hour: Segment = field(default_factory=Segment)
    minute: Segment = field(default_factory=Segment)
    space_minute: Segment = field(default_factory=Segment)
    seconds: Segment = field(default_factory=Segment)
    ampm: Segment = field(default_factory=Segment)
    is_blink_colon: bool = False  # vendor `isSpaceShing`
    show_date: bool = False  # vendor `isDateShowMode` -- read by the vendor encoder but
    # never actually used by it (dead field, ported for API/golden-vector-input parity only)
    reuse_space_after_minute: bool = True  # vendor `showSpaceMinuteColor`: resend the colon
    # glyph table before `seconds` too, for a second (HH:MM:SS) colon
    layer_type: int = 0
    show_time: int = 10
    num_height: int = 1
    num_width: int = 1


@dataclass(frozen=True)
class DateContent:
    """``ILedClockDateProgramContent`` (tag 09). Verified against both golden vectors.
    ``month_flag != 0`` faithfully reproduces a genuine vendor encoder bug: the vendor emits
    *nothing at all* (not even a zero-length marker) at that point, byte-misaligning
    everything after it -- confirmed against source, not a guess. Leave it at 0."""

    show_space_year: bool = False
    show_space_month: bool = True
    show_space_day: bool = False
    year: Segment = field(default_factory=Segment)  # this device's font tables carry no
    # year digit glyphs at all -- confirmed by re-simulating the vendor's geometry branching,
    # not a guess -- so `year` always renders empty regardless of colour/position/size.
    space_year: Segment = field(default_factory=Segment)
    month: Segment = field(default_factory=Segment)
    space_month: Segment = field(default_factory=Segment)
    day: Segment = field(default_factory=Segment)
    space_day: Segment = field(default_factory=Segment)
    week: Segment = field(default_factory=Segment)
    layer_type: int = 0
    month_flag: int = 0
    show_time: int = 5
    num_height: int = 1
    num_width: int = 1
    year_num_height: int = 1
    year_num_width: int = 1


@dataclass(frozen=True)
class TimeCountContent:
    """``ILedClockTimeCountProgramContent`` (tag 0a). ``mode``: 0=countdown, 1=stopwatch --
    confirmed (via re-simulation) to select the identical digit font either way at this
    device's geometry, so it only affects device-side counting direction, not glyph shapes."""

    mode: int
    hour: Segment = field(default_factory=Segment)
    space_hour: Segment = field(default_factory=Segment)
    minute: Segment = field(default_factory=Segment)
    space_minute: Segment = field(default_factory=Segment)
    seconds: Segment = field(default_factory=Segment)
    layer_type: int = 0
    num_height: int = 1
    num_width: int = 1


@dataclass(frozen=True)
class ScoreboardContent:
    """``ILedClockScoreBoardProgramContent`` (tag 0b)."""

    host_score: Segment = field(default_factory=Segment)
    visit_score: Segment = field(default_factory=Segment)
    host_total: Segment = field(default_factory=Segment)
    visit_total: Segment = field(default_factory=Segment)
    minute: Segment = field(default_factory=Segment)
    space_minute: Segment = field(default_factory=Segment)
    seconds: Segment = field(default_factory=Segment)
    layer_type: int = 0
    score_num_height: int = 1
    score_num_width: int = 1
    total_num_height: int = 1
    total_num_width: int = 1
    time_num_height: int = 1
    time_num_width: int = 1


@dataclass(frozen=True)
class TemperatureContent:
    """``ILedClockTemperatureProgramContent`` (tag 10)."""

    color: RGB
    start_column: int = 0
    start_row: int = 0
    width: int = 0
    height: int = 0
    layer_type: int = 0
    num_height: int = 1
    num_width: int = 1


@dataclass(frozen=True)
class HumidityContent:
    """``ILedClockHumidityProgramContent`` (tag 11)."""

    color: RGB
    start_column: int = 0
    start_row: int = 0
    width: int = 0
    height: int = 0
    layer_type: int = 0
    num_height: int = 1
    num_width: int = 1


@dataclass(frozen=True)
class GraffitiContent:
    """``ILedClockGraffitiProgramContent`` (tag 02): one still frame.

    Defaults are the vendor's still-picture values (``mode=1, speed=0, stayTime=2``, every iLedClock
    material/word-game/import path, e.g. ILedClockMaterialDetailFragment.java:270-272). ``mode=0`` is
    a scroll-in / pause / scroll-out effect [DEVICE 2026-10-02: a still "A1" scrolled across, paused
    mid-panel, scrolled out] and, in a three-program rotation, an animation next to it stopped being
    shown."""

    start_column: int
    start_row: int
    show_width: int
    show_height: int
    pixels: Frame
    layer_type: int = 0
    mode: int = 1
    speed: int = 0
    stay_time: int = 2


@dataclass(frozen=True)
class AnimationContent:
    """``ILedClockAnimationProgramContent`` (tag ``03 01``, the only reachable Animation
    encoder for this device -- see module docstring). Each :class:`~.models.Frame`'s own
    ``duration_ms`` becomes that frame's per-frame delay (vendor: ``delays``); ``speed`` is
    the fallback used only for a frame left at ``duration_ms=0``."""

    start_column: int
    start_row: int
    show_width: int
    show_height: int
    frames: list[Frame]
    layer_type: int = 0
    speed: int = 100


@dataclass(frozen=True)
class FrameContent:
    """``ILedClockFrameProgramContent`` (tag 04): a decorative animated border.
    ``frame_type`` indexes :data:`color_tables.FRAME_TYPE` (1-20)."""

    frame_type: int
    start_column: int = 0
    start_row: int = 0
    show_width: int = 0
    show_height: int = 0
    frame_show_type: int = 1
    speed: int = 5
    layer_type: int = 0


@dataclass(frozen=True)
class ReminderContent:
    """``ILedClockReminderProgramContent`` (tag 13): one reminder / named alarm that the clock
    stores in its OWN reminder slots (so it rings without Home Assistant). Uploaded with
    program type 14; ``remind_id`` is not part of this content's own wire bytes -- the *upload
    start frame*'s ``05 <id>`` trailer carries it (see :func:`plan_upload`). A reminder may be
    uploaded together with art contents (graffiti/animation) after it in the same program.

    ``year`` is the wire value: the full year minus 2000 (use :attr:`full_year` /
    :meth:`from_full_year` for 2026-style years). ``repeat_type`` is 0 once, 1 every day,
    2 weekly on the weekday of the date, 3 monthly on the day of the date, 4 yearly on the
    date. The weekday-mask byte is derived exactly like the vendor app does (type 1 -> 0x7F,
    type 2 -> the bit of the date's weekday (Mon = bit 0 .. Sun = bit 6), anything else ->
    0) unless ``week_mask`` is given, which is then written verbatim (whether the clock
    honours a custom mask is the open question behind ``hardware.REMINDER_WEEK_MASK_SUPPORTED``).

    Only WIRE ranges are validated here (what fits in the byte fields); the 16-slot id range,
    the allowed durations and the 20-character name limit are policy of the domain layer."""

    remind_id: int
    title: str
    year: int  # two-digit wire value, i.e. actual year - 2000
    month: int
    day: int
    hour: int
    minute: int
    sound: int = 1
    repeat_type: int = 0
    duration: int = 30  # seconds the alarm rings (two bytes on the wire)
    week_mask: int | None = None

    def __post_init__(self) -> None:
        def check(name: str, value: int, low: int, high: int) -> None:
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"reminder {name} must be a whole number, got {value!r}")
            if not low <= value <= high:
                raise ValueError(f"reminder {name} must be {low}-{high}, got {value}")

        check("remind_id", self.remind_id, 0, 255)
        check("year", self.year, 0, 255)
        check("month", self.month, 1, 12)
        check("day", self.day, 1, 31)
        try:
            datetime.date(2000 + self.year, self.month, self.day)
        except ValueError:
            raise ValueError(
                f"reminder date {2000 + self.year}-{self.month:02d}-{self.day:02d} does not exist"
            ) from None
        check("hour", self.hour, 0, 23)
        check("minute", self.minute, 0, 59)
        check("sound", self.sound, 0, 255)
        check("repeat_type", self.repeat_type, 0, 4)
        check("duration", self.duration, 0, 65535)
        if self.week_mask is not None:
            check("week_mask", self.week_mask, 0, 127)
        if not isinstance(self.title, str) or not self.title:
            raise ValueError("reminder title must not be empty")
        if any(unicodedata.category(ch) == "Cc" for ch in self.title):
            raise ValueError("reminder title must not contain control characters")
        try:
            size = len(self.title.encode("utf-8"))
        except UnicodeEncodeError:
            raise ValueError("reminder title is not valid text") from None
        if size > 255:
            raise ValueError(f"reminder title is {size} bytes in UTF-8, the limit is 255")

    @property
    def full_year(self) -> int:
        """The real calendar year (``2000 + year``)."""
        return 2000 + self.year

    @classmethod
    def from_full_year(
        cls,
        remind_id: int,
        title: str,
        full_year: int,
        month: int,
        day: int,
        hour: int,
        minute: int,
        sound: int = 1,
        repeat_type: int = 0,
        duration: int = 30,
        week_mask: int | None = None,
    ) -> "ReminderContent":
        """Build from a 2000+ year; the wire field only holds ``full_year - 2000`` (0-255)."""
        return cls(
            remind_id=remind_id,
            title=title,
            year=full_year - 2000,
            month=month,
            day=day,
            hour=hour,
            minute=minute,
            sound=sound,
            repeat_type=repeat_type,
            duration=duration,
            week_mask=week_mask,
        )

    def resolved_week_mask(self) -> int:
        """The weekday-mask byte that goes on the wire (see the class docstring)."""
        if self.week_mask is not None:
            return self.week_mask
        if self.repeat_type == 1:
            return 127
        if self.repeat_type == 2:
            return 1 << (datetime.date(self.full_year, self.month, self.day).isoweekday() - 1)
        return 0


Content = Union[
    TextContent,
    ClockContent,
    DateContent,
    TimeCountContent,
    ScoreboardContent,
    TemperatureContent,
    HumidityContent,
    GraffitiContent,
    AnimationContent,
    FrameContent,
    ReminderContent,
]

#: vendor `ILedClockCombineProgram.getType()` values, keyed by content class -- drives both
#: `Program`'s auto-derived `program_type` and the upload start frame's trailer selection.
_PROGRAM_TYPE = {
    GraffitiContent: 1,
    AnimationContent: 2,
    TextContent: 3,
    FrameContent: 4,
    DateContent: 6,
    ClockContent: 7,
    TimeCountContent: 8,
    ScoreboardContent: 11,
    ReminderContent: 14,
    TemperatureContent: 17,
    HumidityContent: 18,
}


@dataclass(frozen=True)
class Program:
    """``ILedClockProgram``: one playlist slot. ``show_count`` is the rotation duration in
    *seconds* (confirmed with the integration agent: it is genuinely just "how many seconds",
    the vendor field name's `_count` notwithstanding) -- it feeds the upload start frame's
    timing trailer. ``program_type`` defaults to the first content's own type; a `Program`
    only ever has one content in practice (`program_builder.py`), but the vendor format
    supports several combine-programs sharing one upload (e.g. Text + a decorative Frame), so
    this accepts a list."""

    contents: list[Content]
    show_count: int = 10
    is_clock_in_list: bool = False
    program_type: int | None = None

    def resolved_program_type(self) -> int:
        if self.program_type is not None:
            return self.program_type
        if not self.contents:
            return 3
        return _PROGRAM_TYPE[type(self.contents[0])]


@dataclass(frozen=True)
class UploadPlan:
    """Unframed payloads ready for `client.py`'s `_async_request_locked`/
    `_async_send_chunk_locked` -- `framing.encode_frame` still needs to be applied by the
    transport layer, exactly like every other `protocol.commands` builder's output."""

    start: bytes
    chunks: list[bytes]


# --- shared encoding helpers ---------------------------------------------------------------


def _wrap(body: bytes) -> bytes:
    """Every content encoder's outer envelope: a 4-byte length prefix whose *value* is
    ``len(body) + 4`` (self-inclusive), then `body` verbatim (`body[0]` is always the content's
    own tag byte). Verified against every `getDataWith*CombineProgram`/`*ProgramContent`
    golden vector's trailing `arrayList.addAll(getHexListStringForIntWithFourByte(
    arrayList2.size() + 4)); arrayList.addAll(arrayList2);` pattern."""
    return u32be(len(body) + 4) + body


def _pos(seg: Segment) -> bytes:
    return u16be(seg.start_column) + u16be(seg.start_row) + u16be(seg.width) + u16be(seg.height)


def _table(data: bytes) -> bytes:
    """A vendor pre-baked digit/icon table field: 2-byte length + the table verbatim (0 bytes
    if `data` is empty, e.g. this device's always-empty year-digit or AM/PM tables)."""
    return u16be(len(data)) + data


def _pixels_column_major(frame: Frame) -> bytes:
    """``getAnimationDataColor``/``getDrawListDataFColor``: outer loop over columns, inner
    over rows top-to-bottom, source pixels indexed row-major -- verified against source."""
    out = bytearray()
    for col in range(frame.width):
        for row in range(frame.height):
            out += rgb444_pixel(frame.pixels[row][col])
    return bytes(out)


# --- per-content-type encoders -------------------------------------------------------------


def _encode_clock(c: ClockContent) -> bytes:
    if c.is_24_hour:
        mode_byte = 0x03 if c.is_blink_colon else 0x01
    else:
        mode_byte = 0x02 if c.is_blink_colon else 0x00
    number_table = clock_faces.STYLE_NUMBER[c.style_index]
    space_table = clock_faces.STYLE_SPACE[c.style_index]
    ampm_table = clock_faces.STYLE_AMPM[c.style_index]

    body = bytearray()
    body += b"\x07" + b"\x00" * 7
    body += bytes((c.layer_type & 0xFF, mode_byte))
    body += u16be(c.show_time) + u16be(c.num_height) + u16be(c.num_width)
    body += _table(number_table)
    body += rgb444_linear(c.hour.color) + _pos(c.hour)
    body += rgb444_linear(c.space_hour.color) + _pos(c.space_hour)
    body += _table(space_table)
    body += rgb444_linear(c.minute.color) + _pos(c.minute)
    body += rgb444_linear(c.space_minute.color) + _pos(c.space_minute)
    body += _table(space_table) if c.reuse_space_after_minute else u16be(0)
    body += rgb444_linear(c.seconds.color) + _pos(c.seconds)
    body += rgb444_linear(c.ampm.color) + _pos(c.ampm)
    body += _table(ampm_table) if ampm_table else u16be(0)
    return _wrap(bytes(body))


def _encode_date(c: DateContent) -> bytes:
    body = bytearray()
    body += b"\x09" + b"\x00" * 7
    body += bytes((c.layer_type & 0xFF,))
    body += hexutil.u8(c.month_flag)
    body += u16be(c.show_time) + u16be(c.num_height) + u16be(c.num_width)
    body += _table(clock_faces.DATE_NUMBER)
    body += u16be(c.year_num_height) + u16be(c.year_num_width)
    body += _table(clock_faces.YEAR)
    body += rgb444_linear(c.year.color) + _pos(c.year)
    body += rgb444_linear(c.space_year.color) + _pos(c.space_year)
    body += _table(clock_faces.DATE_SPACE_MONTH) if c.show_space_year else u16be(0)
    body += rgb444_linear(c.month.color) + _pos(c.month)
    if c.month_flag == 0:
        body += u16be(0)
    # else: faithful vendor bug -- nothing emitted at all here (see class docstring).
    body += rgb444_linear(c.space_month.color) + _pos(c.space_month)
    body += _table(clock_faces.DATE_SPACE_MONTH) if c.show_space_month else u16be(0)
    body += rgb444_linear(c.day.color) + _pos(c.day)
    body += rgb444_linear(c.space_day.color) + _pos(c.space_day)
    body += _table(clock_faces.DATE_SPACE_MONTH) if c.show_space_day else u16be(0)
    body += rgb444_linear(c.week.color) + _pos(c.week)
    body += _table(clock_faces.WEEK)
    return _wrap(bytes(body))


def _encode_timecount(c: TimeCountContent) -> bytes:
    body = bytearray()
    body += b"\x0a" + b"\x00" * 7
    body += bytes((c.layer_type & 0xFF, c.mode & 0xFF))
    body += u16be(c.num_height) + u16be(c.num_width)
    body += _table(clock_faces.STOPWATCH_NUMBER)
    body += rgb444_linear(c.hour.color) + _pos(c.hour)
    body += rgb444_linear(c.space_hour.color) + _pos(c.space_hour)
    body += _table(clock_faces.STOPWATCH_SPACE)
    body += rgb444_linear(c.minute.color) + _pos(c.minute)
    body += rgb444_linear(c.space_minute.color) + _pos(c.space_minute)
    body += _table(clock_faces.STOPWATCH_SPACE)
    body += rgb444_linear(c.seconds.color) + _pos(c.seconds)
    return _wrap(bytes(body))


def _encode_scoreboard(c: ScoreboardContent) -> bytes:
    body = bytearray()
    body += b"\x0b" + b"\x00" * 7
    body += bytes((c.layer_type & 0xFF, 0x00))
    body += u16be(c.score_num_height) + u16be(c.score_num_width)
    body += _table(clock_faces.SCOREBOARD_SCORE_NUMBER)
    body += rgb444_linear(c.host_score.color) + _pos(c.host_score)
    body += rgb444_linear(c.visit_score.color) + _pos(c.visit_score)
    body += u16be(c.total_num_height) + u16be(c.total_num_width)
    body += _table(clock_faces.SCOREBOARD_TOTAL_SCORE_NUMBER)
    body += rgb444_linear(c.host_total.color) + _pos(c.host_total)
    body += rgb444_linear(c.visit_total.color) + _pos(c.visit_total)
    body += u16be(c.time_num_height) + u16be(c.time_num_width)
    # "time" (minute/seconds) digits reuse the small "time-number" font -- traced through
    # str4->str5->str6 in the vendor's tangled geometry branching (str4's 16x32 assignment IS
    # `SCOREBOARD_TIME_NUMBER`; `str5 = str4` since ROW!=24; `str6 = str5` since ROW!=32).
    body += _table(clock_faces.SCOREBOARD_TIME_NUMBER)
    body += rgb444_linear(c.minute.color) + _pos(c.minute)
    body += rgb444_linear(c.space_minute.color) + _pos(c.space_minute)
    body += _table(clock_faces.SCOREBOARD_SPACE)
    body += rgb444_linear(c.seconds.color) + _pos(c.seconds)
    return _wrap(bytes(body))


def _encode_temperature(c: TemperatureContent) -> bytes:
    body = bytearray()
    body += b"\x10" + b"\x00" * 7
    body += bytes((c.layer_type & 0xFF, 0x00))
    body += u16be(c.num_height) + u16be(c.num_width)
    body += _table(clock_faces.TEMPERATURE_ICON)
    body += rgb444_linear(c.color)
    body += u16be(c.start_column) + u16be(c.start_row) + u16be(c.width) + u16be(c.height)
    return _wrap(bytes(body))


def _encode_humidity(c: HumidityContent) -> bytes:
    body = bytearray()
    body += b"\x11" + b"\x00" * 7
    body += bytes((c.layer_type & 0xFF, 0x00))
    body += u16be(c.num_height) + u16be(c.num_width)
    body += _table(clock_faces.HUMIDITY_ICON)
    body += rgb444_linear(c.color)
    body += u16be(c.start_column) + u16be(c.start_row) + u16be(c.width) + u16be(c.height)
    return _wrap(bytes(body))


def _encode_graffiti(c: GraffitiContent) -> bytes:
    body = bytearray()
    body += b"\x02" + b"\x00" * 7
    body += bytes((c.layer_type & 0xFF,))
    body += u16be(c.start_column) + u16be(c.start_row) + u16be(c.show_width) + u16be(c.show_height)
    body += bytes((c.mode & 0xFF, c.speed & 0xFF, c.stay_time & 0xFF))
    pixels = _pixels_column_major(c.pixels)
    body += u32be(len(pixels)) + pixels
    return _wrap(bytes(body))


def _encode_animation(c: AnimationContent) -> bytes:
    body = bytearray()
    body += b"\x03\x01" + b"\x00" * 6
    body += bytes((c.layer_type & 0xFF,))
    body += u16be(c.start_column) + u16be(c.start_row) + u16be(c.show_width) + u16be(c.show_height)
    body += b"\x00"
    body += u16be(len(c.frames))
    for frame in c.frames:
        body += u16be(frame.duration_ms or c.speed)
    for frame in c.frames:
        body += _pixels_column_major(frame)
    return _wrap(bytes(body))


def _encode_animation_raw_bytes(
    layer_type: int, start_column: int, start_row: int, show_width: int, show_height: int, payload: bytes
) -> bytes:
    """Shared tag-``0c`` wire structure behind three vendor overloads that all wrap a raw byte
    blob obtained from somewhere other than pixel data (a GIF file on disk, a bundled Android
    drawable resource, or an ``ILedClockGifAnimationProgramContent``/``ILedClockGifAnimationItem``
    wrapper): 7 reserved zero bytes, layerType, one more reserved zero, position/size, a 4-byte
    payload length, then the payload itself. Real file/resource I/O is deliberately out of scope
    for a protocol module -- callers supply `payload` directly."""
    body = bytearray()
    body += b"\x0c"
    body += b"\x00" * 7
    body += bytes((layer_type & 0xFF,))
    body += b"\x00"
    body += u16be(start_column) + u16be(start_row) + u16be(show_width) + u16be(show_height)
    body += u32be(len(payload))
    body += payload
    return _wrap(bytes(body))


def encode_gif_file_animation(
    payload: bytes,
    *,
    layer_type: int = 0,
    start_column: int = 0,
    start_row: int = 0,
    show_width: int = 32,
    show_height: int = 16,
) -> bytes:
    """``getDataWithAnimationCombineProgram(ILedClockGifAnimationProgramContent)`` and its plain
    ``(layerType, startColumn, startRow, showWidth, showHeight, path)`` sibling produce
    byte-identical output (both just read `path`'s bytes and wrap them) -- one Python function
    covers both, plus the GIF_FILE_ANIMATION combine-program (type 15, always reachable -- its
    own dispatch does not gate on ``CoolleduxDeviceVersion``). ANIMATION's own gifFile-set-and-
    not-encrypted dispatch path additionally routes here, but only for a device version in
    [30,255), which iLedClock never sets."""
    return _encode_animation_raw_bytes(layer_type, start_column, start_row, show_width, show_height, payload)


def encode_animation_from_resource(
    payload: bytes,
    *,
    layer_type: int = 0,
    start_column: int = 0,
    start_row: int = 0,
    show_width: int = 32,
    show_height: int = 16,
) -> bytes:
    """``getDataWithAnimationCombineProgram(layerType, startColumn, startRow, showWidth,
    showHeight, resId)``: identical tag-``0c`` structure to `encode_gif_file_animation`, fed from
    a bundled Android drawable resource instead of a file path. Reachable from ANIMATION's own
    dispatch only for a device version in [30,255), which iLedClock never sets; `payload` is
    whatever bytes that resource contains."""
    return _encode_animation_raw_bytes(layer_type, start_column, start_row, show_width, show_height, payload)


def encode_animation_from_encrypted_file(
    payload: bytes,
    *,
    layer_type: int = 0,
    start_column: int = 0,
    start_row: int = 0,
    show_width: int = 32,
    show_height: int = 16,
) -> bytes:
    """``getDataWithAnimationCombineProgramEncryped(...)``: identical structure, but XORs only
    the first 32 bytes of `payload` with ``0xDA`` before wrapping (the vendor's own
    "decryption", applied in place; bytes beyond 32 pass through unchanged -- not a bug to paper
    over, this is exactly what the vendor code does). Raises `IndexError` for a `payload` shorter
    than 32 bytes, mirroring the vendor's own ``ArrayIndexOutOfBoundsException`` for the same
    input -- no less a real vendor defect than the brightness/night-mode quirks documented
    elsewhere in this port."""
    decrypted = bytearray(payload)
    for i in range(32):
        decrypted[i] ^= 0xDA
    return _encode_animation_raw_bytes(layer_type, start_column, start_row, show_width, show_height, bytes(decrypted))


def _encode_frame(c: FrameContent) -> bytes:
    body = bytearray()
    body += b"\x04" + b"\x00" * 7
    body += bytes((c.layer_type & 0xFF,))
    body += u16be(c.start_column) + u16be(c.start_row) + u16be(c.show_width) + u16be(c.show_height)
    body += bytes((c.frame_show_type & 0xFF, c.speed & 0xFF))
    table = color_tables.FRAME_TYPE[c.frame_type]
    body += bytes((0x01,)) + _table(table)
    return _wrap(bytes(body))


def _encode_reminder(c: ReminderContent) -> bytes:
    body = bytearray()
    body += b"\x13" + b"\x00" * 8
    body += hexutil.u8(c.sound) + hexutil.u8(c.year) + hexutil.u8(c.month) + hexutil.u8(c.day)
    body += hexutil.u8(c.hour) + hexutil.u8(c.minute) + hexutil.u8(c.repeat_type)
    body += hexutil.u8(c.resolved_week_mask())
    body += u16be(c.duration)
    title_bytes = c.title.encode("utf-8")
    body += hexutil.u8(len(title_bytes)) + title_bytes
    return _wrap(bytes(body))


def _render_text_columns(content: TextContent) -> tuple[bytes, int]:
    """Renders `content.text` with our own bundled font into a white-on-transparent,
    column-major RGB444 pixel stream -- the same wire shape the vendor's own (proprietary,
    unavailable) font-derived glyph data has, just from our own glyphs. Returns
    ``(pixel_bytes, total_width)``."""
    font = get_font(content.font)
    height = glyph_height(content.font)
    space = (False,) * height
    columns: list[tuple[bool, ...]] = []
    for index, char in enumerate(content.text):
        if index:
            for _ in range(content.move_space):
                columns.append(space)
        glyph = font.get(char, font.get(char.upper(), font[" "]))
        columns.extend(glyph)
    white = (255, 255, 255)
    black = (0, 0, 0)
    out = bytearray()
    for column in columns:
        for lit in column:
            out += rgb444_pixel(white if lit else black)
    return bytes(out), len(columns)


# autoColorType (1-28) -> (effectByte, directionByte, colour table). Traced mechanically from
# every ``if (autoColorType == N)`` branch in ``getDataWithTextAutoColorProgramContent``
# (ILedClockUtils.java:2758-2982): NOT a simple identity mapping (e.g. autoColorType 2 emits
# effectByte 1, not 2) -- verified against all 5 golden `getDataWithTextAutoColorProgramContent`
# vectors (1, 14, 28, and two out-of-range throws). Types 15-28 mirror 1-14's own
# (effectByte, directionByte) pairs exactly but always use the shared inline 3-colour literal
# instead of a named `colorTypeN` table.
_AUTO_COLOR_LITERAL = hexutil.hex_csv_to_bytes("00,FF,0F,0F,0F,F0")
_AUTO_COLOR_DISPATCH: dict[int, tuple[int, int, bytes]] = {
    1: (1, 0, color_tables.COLOR_TYPE[1]),
    2: (1, 1, color_tables.COLOR_TYPE[2]),
    3: (2, 0, color_tables.COLOR_TYPE[3]),
    4: (3, 2, color_tables.COLOR_TYPE[4]),
    5: (3, 3, color_tables.COLOR_TYPE[5]),
    6: (4, 4, color_tables.COLOR_TYPE[6]),
    7: (4, 5, color_tables.COLOR_TYPE[7]),
    8: (5, 0, color_tables.COLOR_TYPE[8]),
    9: (6, 0, color_tables.COLOR_TYPE[9]),
    10: (6, 1, color_tables.COLOR_TYPE[10]),
    11: (7, 0, color_tables.COLOR_TYPE[11]),
    12: (7, 1, color_tables.COLOR_TYPE[12]),
    13: (8, 0, color_tables.COLOR_TYPE[13]),
    14: (8, 1, color_tables.COLOR_TYPE[14]),
    15: (1, 0, _AUTO_COLOR_LITERAL),
    16: (1, 1, _AUTO_COLOR_LITERAL),
    17: (2, 0, _AUTO_COLOR_LITERAL),
    18: (3, 2, _AUTO_COLOR_LITERAL),
    19: (3, 3, _AUTO_COLOR_LITERAL),
    20: (4, 4, _AUTO_COLOR_LITERAL),
    21: (4, 5, _AUTO_COLOR_LITERAL),
    22: (5, 0, _AUTO_COLOR_LITERAL),
    23: (6, 0, _AUTO_COLOR_LITERAL),
    24: (6, 1, _AUTO_COLOR_LITERAL),
    25: (7, 0, _AUTO_COLOR_LITERAL),
    26: (7, 1, _AUTO_COLOR_LITERAL),
    27: (8, 0, _AUTO_COLOR_LITERAL),
    28: (8, 1, _AUTO_COLOR_LITERAL),
}


def _encode_text_auto_color(
    color: TextAutoColor, start_column: int, start_row: int, show_width: int, show_height: int
) -> bytes:
    body = bytearray()
    body += b"\x05" + b"\x00" * 7
    body += u16be(start_column) + u16be(start_row) + u16be(show_width) + u16be(show_height)
    dispatch = _AUTO_COLOR_DISPATCH.get(color.effect)
    if dispatch is not None:
        effect_byte, direction_byte, table = dispatch
        body += bytes((effect_byte & 0xFF, color.speed & 0xFF, direction_byte & 0xFF, 0x00))
        body += _table(table)
    # else: the vendor's if/else-if chain has no trailing else -- an effect outside 1-28
    # silently omits the whole colour-type sub-block entirely (confirmed real
    # device-observed quirk via golden vector, not a guess).
    return _wrap(bytes(body))


def _encode_text_custom_color(
    color: TextCustomColor,
    text_length: int,
    move_space: int,
    start_column: int,
    start_row: int,
    show_width: int,
    show_height: int,
) -> bytes:
    widths = [1] * text_length  # our renderer packs one colour slot per character; the
    # actual glyph pixel widths live in the tag=01 content that follows, matching the
    # vendor's own split between "per-character colour plan" and "glyph pixel data".
    body = bytearray()
    body += b"\x06" + b"\x00" * 5
    body += u16be(move_space)
    body += u16be(start_column) + u16be(start_row) + u16be(show_width) + u16be(show_height)
    body += bytes((color.mode & 0xFF, color.speed & 0xFF, color.stay_time & 0xFF, 0x00))
    body += u16be(text_length)
    body += u16be(sum(widths))
    for w in widths:
        body += u16be(w)
    for index in range(text_length):
        rgb = color.colors[index % len(color.colors)] if color.colors else (255, 255, 255)
        body += rgb444_pixel(rgb)
    return _wrap(bytes(body))


def _encode_text(c: TextContent) -> bytes:
    pixels, rendered_width = _render_text_columns(c)
    height = glyph_height(c.font)
    show_width = c.show_width or rendered_width
    show_height = c.show_height or height

    parts = bytearray()
    if isinstance(c.color, TextCustomColor):
        parts += _encode_text_custom_color(
            c.color, len(c.text), c.move_space, c.start_column, c.start_row, show_width, show_height
        )
    if isinstance(c.color, TextAutoColor):
        parts += _encode_text_auto_color(c.color, c.start_column, c.start_row, show_width, show_height)

    body = bytearray()
    body += b"\x01" + b"\x00" * 7
    body += bytes((c.layer_type & 0xFF,))
    body += u16be(c.start_column) + u16be(c.start_row) + u16be(show_width) + u16be(show_height)
    body += bytes((c.mode & 0xFF, c.speed & 0xFF, c.stay_time & 0xFF))
    body += u16be(c.move_space)
    body += pixels
    parts += _wrap(bytes(body))

    if c.frame is not None:
        parts += _encode_frame(c.frame)
    return bytes(parts)


_ENCODERS = {
    ClockContent: _encode_clock,
    DateContent: _encode_date,
    TimeCountContent: _encode_timecount,
    ScoreboardContent: _encode_scoreboard,
    TemperatureContent: _encode_temperature,
    HumidityContent: _encode_humidity,
    GraffitiContent: _encode_graffiti,
    AnimationContent: _encode_animation,
    FrameContent: _encode_frame,
    ReminderContent: _encode_reminder,
    TextContent: _encode_text,
}


def encode_content(content: Content) -> bytes:
    """``getDataForCombineProgram``: dispatch one `Content` to its tagged byte encoding."""
    try:
        encoder = _ENCODERS[type(content)]
    except KeyError as err:
        raise TypeError(f"no encoder for content type {type(content).__name__}") from err
    return encoder(content)


def _data_for_program(program: Program) -> bytes:
    """``getDataForProgram``: concatenated tagged content chunks, one per combine-program."""
    return b"".join(encode_content(c) for c in program.contents)


def _content_number(content: Content) -> int:
    """How many vendor combine-programs one `Content` stands for in the content-count byte of
    ``getDataWithProgram``: a `TextContent` is a text item plus its glyph layer (2), plus one
    more when it carries a decorative `frame`; every other content is 1."""
    if isinstance(content, TextContent):
        return 2 + (1 if content.frame is not None else 0)
    return 1


def _data_with_program(program: Program) -> bytes:
    """``getDataWithProgram``: 8 reserved zero bytes, the content count (the SUM of
    :func:`_content_number`, not the number of `Content` objects), one more reserved zero
    byte, then the concatenated content data. This whole blob (uncompressed) is what gets
    CRC'd and LZSS-compressed for upload."""
    count = sum(_content_number(c) for c in program.contents)
    return b"\x00" * 8 + hexutil.u8(count) + b"\x00" + _data_for_program(program)


def program_fingerprint(program: Program) -> tuple[str, int]:
    """``(crc, length)`` of the program's uncompressed blob: the CRC-32 as 8 lowercase hex
    characters and the blob length in bytes -- exactly what the upload start frame carries, so
    it identifies one program's content for the per-screen record."""
    blob = _data_with_program(program)
    return crc_code(blob).hex(), len(blob)


def _start_frame(
    program: Program, index: int, count: int, package_size: int, remind_id: int | None
) -> bytes:
    """``getStartDataForProgram``, unframed (no ``01``/``03`` wrapper -- that is
    ``framing.encode_frame``'s job at the transport layer, applied uniformly to every command
    including this one). Two vendor overloads collapse into one function here, selected by
    whether `remind_id` is given -- exactly the same real-code-path split
    ``DeviceManager``/``getDataResult`` itself makes on ``programType == 14``."""
    uncompressed = _data_with_program(program)
    program_type = program.resolved_program_type()
    show_count = program.show_count

    header = bytearray()
    header += b"\x02"
    header += crc_code(uncompressed)
    header += u32be(len(uncompressed))
    header += bytes((index & 0xFF, count & 0xFF, 0x00))
    header += b"\x00" * 8

    if remind_id is not None:
        if program_type == 8:
            header += b"\x01"
        elif program_type == 9:
            header += b"\x02"
        elif program_type == 11:
            header += b"\x03"
        elif program_type == 7:
            header += b"\x04\x01" + u32be(10)
        elif program_type in (6, 19):
            header += b"\x04\x01" + u32be(5)
        elif program_type == 14:
            header += bytes((0x05,)) + hexutil.u8(remind_id)
        else:
            header += b"\x00\x00" + u32be(show_count)
    else:
        if program_type == 8:
            header += b"\x01"
        elif program_type == 9:
            header += b"\x02"
        elif program_type == 11:
            header += b"\x03"
        elif program_type == 7:
            if program.is_clock_in_list:
                header += b"\x00\x01" + u32be(show_count * 5)
            else:
                header += b"\x04\x01" + u32be(10)
        elif program_type in (6, 19):
            header += b"\x04\x01" + u32be(5)
        elif program_type == 14:
            header += b"\x05"
        else:
            header += b"\x00\x00" + u32be(show_count)

    return bytes(header)


def _reminder_id_of(program: Program) -> int | None:
    if program.contents and isinstance(program.contents[0], ReminderContent):
        return program.contents[0].remind_id
    return None


def _chunk(compressed: bytes, opcode: int, package_size: int) -> list[bytes]:
    """``getDataPacket`` (3-arg, package-size-parameterised overload): splits `compressed`
    into `package_size`-sized pieces (the last may be shorter), each wrapped as
    ``[opcode, 0x00, total_len(4B), chunk_index(2B), chunk_len(2B), chunk_data,
    xor_checksum(1B)]`` -- unframed."""
    chunks: list[bytes] = []
    total_len = len(compressed)
    pieces = [compressed[i : i + package_size] for i in range(0, total_len, package_size)]
    if not pieces:
        pieces = [b""]
    for index, piece in enumerate(pieces):
        body = bytearray()
        body += b"\x00"
        body += u32be(total_len)
        body += u16be(index)
        body += u16be(len(piece))
        body += piece
        checksum = 0
        for byte in body:
            checksum ^= byte
        body += bytes((checksum & 0xFF,))
        chunks.append(bytes((opcode,)) + bytes(body))
    return chunks


def plan_upload(program: Program, index: int, count: int, package_size: int) -> UploadPlan:
    """``getDataResult`` (4-arg overload -- the only one ``DeviceManager`` calls for our
    device, ``ILedClock_PACKAGE_SIZE`` always 1024 in practice). Returns unframed
    ``start``/``chunks`` payloads ready for ``client.py``'s wire I/O."""
    uncompressed = _data_with_program(program)
    remind_id = _reminder_id_of(program)
    start = _start_frame(program, index, count, package_size, remind_id)
    compressed = compress(uncompressed)
    chunks = _chunk(compressed, 0x03, package_size)
    return UploadPlan(start=start, chunks=chunks)


def _start_frame_simple(uncompressed: bytes, index: int, count: int, show_count: int) -> bytes:
    """``getStartDataForProgram(list, i, i2, i3)``: tag ``02`` + crc + length + plain
    index/count/showCount bytes, with NO programType-aware trailer at all -- a strict prefix
    of `_start_frame`'s own output up through the showCount byte, then nothing more. Backs the
    3-arg ``getDataResult(program, i, i2)`` overload, which always resolves `show_count` from
    ``program.showCount`` itself (never a caller-supplied value). ``DeviceManager`` never calls
    this overload -- its own real call path always supplies an explicit package size, landing
    on the 4-arg ``getDataResult`` overload above -- but it is a real, distinctly-shaped wire
    frame, ported for Contract A / golden-vector completeness."""
    header = bytearray()
    header += b"\x02"
    header += crc_code(uncompressed)
    header += u32be(len(uncompressed))
    header += bytes((index & 0xFF, count & 0xFF, show_count & 0xFF))
    return bytes(header)


def _start_frame_index_only(uncompressed: bytes, index: int) -> bytes:
    """``getStartDataForProgram(list, i)``: tag ``1a`` + crc + length + a single index byte,
    nothing else. Backs the 2-arg ``getDataResult(program, i)`` overload; also never reached
    from ``DeviceManager``'s own call path, ported for completeness."""
    header = bytearray()
    header += b"\x1a"
    header += crc_code(uncompressed)
    header += u32be(len(uncompressed))
    header += bytes((index & 0xFF,))
    return bytes(header)


def plan_upload_simple(program: Program, index: int, count: int, package_size: int = 1024) -> UploadPlan:
    """``getDataResult`` (3-arg overload, ``(program, index, count)``): unlike `plan_upload`'s
    4-arg overload, this one hardcodes ``package_size=1024`` (the vendor's own 2-arg
    ``getDataPacket`` default) and its start frame carries no programType trailer at all -- see
    `_start_frame_simple`."""
    uncompressed = _data_with_program(program)
    start = _start_frame_simple(uncompressed, index, count, program.show_count)
    compressed = compress(uncompressed)
    chunks = _chunk(compressed, 0x03, package_size)
    return UploadPlan(start=start, chunks=chunks)


def plan_upload_by_index(program: Program, index: int, package_size: int = 1024) -> UploadPlan:
    """``getDataResult`` (2-arg overload, ``(program, index)``): index-only start frame (see
    `_start_frame_index_only`); package size hardcoded to 1024 exactly like `plan_upload_simple`."""
    uncompressed = _data_with_program(program)
    start = _start_frame_index_only(uncompressed, index)
    compressed = compress(uncompressed)
    chunks = _chunk(compressed, 0x03, package_size)
    return UploadPlan(start=start, chunks=chunks)


def get_ota_data_result(firmware: bytes, package_size: int = 1024) -> UploadPlan:
    """``getOtaDataResult``: OTA firmware upload start frame (``getStartDataForOtaUpgrade``,
    tag ``fe``, first 64 bytes of `firmware` inline, uncompressed) plus the chunked *compressed*
    body (tag ``ff``) -- like every other upload pipeline here, ``getDataPacket`` chunks
    ``LzssCompress.getLzssCompressData(firmware)``, never the raw bytes."""
    start_body = bytearray()
    start_body += b"\xfe"
    start_body += crc_code(firmware)
    start_body += u32be(len(firmware))
    start_body += hexutil.u8(64)
    start_body += firmware[:64]
    chunks = _chunk(compress(firmware), 0xFF, package_size)
    return UploadPlan(start=bytes(start_body), chunks=chunks)


def _start_ota_simple(firmware: bytes) -> bytes:
    """``getStartOTAUpdate(list)``: tag ``fe`` + crc + length, with NO inline first-64-bytes
    prefix at all -- a simpler sibling of `get_ota_data_result`'s own start frame
    (``getStartDataForOtaUpgrade``, which does inline the first 64 bytes)."""
    header = bytearray()
    header += b"\xfe"
    header += crc_code(firmware)
    header += u32be(len(firmware))
    return bytes(header)


def plan_ota_simple(firmware: bytes, package_size: int = 1024) -> UploadPlan:
    """``getStartOTAUpdate``+``getOTAUpdate``: the simpler OTA overload pair -- start frame
    carries no inline first-64-bytes prefix (see `_start_ota_simple`); chunk opcode ``ff``
    same as `get_ota_data_result`, over the same LZSS-compressed firmware."""
    start = _start_ota_simple(firmware)
    chunks = _chunk(compress(firmware), 0xFF, package_size)
    return UploadPlan(start=start, chunks=chunks)
