"""Turns a validated `PlaylistItem` (Contract D) into `protocol.programs.Program` objects ready
for `plan_upload`/`encode_program`.

Pure module: only imports from `.protocol` (itself pure Python per Contract A), `.playlist`,
`.designs`, `.state` and `.const`. Kept separate from `coordinator.py` because this mapping is
non-trivial and worth reviewing on its own -- in particular the segment-geometry choices. The
vendor's own Activities let a user drag each text/digit segment to an arbitrary position on a
32x16 canvas; `protocol.programs`' encoder deliberately does not invent non-zero segment
defaults for us (a `Segment` with `width=height=0` just means "omitted"), so something has to
pick real numbers the way that UI would have -- this module is that "something", once, statically,
for every content kind. The device's own `style_index`/`layer_type`/colour-mode fields still
drive most of the visual character; this just gives every upload well-formed geometry to sit in.

Text is drawn, not sent as the clock's own scrolling-text content: the glyph layer built for that did not
match the vendor's wire format and the clock drew nothing (BlankText report). `text_playback_frames` draws the
text to pixel frames (`protocol.render.text_frames`), applies the show's Speed and Smooth motion, and the frames
go out as picture content like any other art; `TextContent` stays in `protocol` but is not used here.
Reminders are built by `reminders.py`, and `FrameContent` (decorative borders) isn't wired to any playlist kind or
service -- it's a minor ancillary content type, not one of the vendor app's 25 numbered features, so no
dedicated user-facing control was added for it.

`build_slot_b_program` builds what goes to the clock's second screen (the clock-page store, start-frame kind 04):
one standalone page that is never part of the program list.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Mapping, Sequence

from .const import (
    CLOCK_COLOR_RGB,
    DEFAULT_PLAYLIST_DURATION_S,
    DESIGN_MAX_FRAMES,
    DISPLAY_HEIGHT,
    DISPLAY_WIDTH,
    SLOT_A,
    SLOT_B,
    TEXT_COLOR_MODE_MAX,
    TEXT_COLOR_MODE_MIN,
    TEXT_MAX_FRAMES,
    TEXT_MODE_MAX_LENGTH,
)
from .clock_styles import CLOCK_STYLES
from .clock_backgrounds import CLOCK_BACKGROUNDS, DATE_BACKGROUND, ClockBackground
from .content_layouts import (
    DATE_LAYOUT,
    HUMIDITY_LAYOUT,
    SCOREBOARD_LAYOUT,
    TEMPERATURE_LAYOUT,
    TIME_COUNT_LAYOUTS,
)
from . import retime
from .designs import Design, decode_frame, validate_clock_region
from .hardware import device_delay_units, power_limited_frame
from .playlist import PlaylistItem
from .protocol import render as protocol_render
from .protocol.fonts import DEFAULT_FONT, get_font
from .protocol.models import Frame, Segment
from .protocol.programs import (
    AnimationContent,
    ClockContent,
    Content,
    DateContent,
    GraffitiContent,
    HumidityContent,
    Program,
    ScoreboardContent,
    TemperatureContent,
    TimeCountContent,
)
from .slots import content_class_of, require_slot_accepts


class ProgramBuildError(ValueError):
    """Raised when a playlist item cannot be turned into device content -- e.g. a `design` item
    naming a design id that no longer exists in the store."""


def _layout_segment(color: tuple[int, int, int], geometry: tuple[int, int, int, int]) -> Segment:
    column, row, width, height = geometry
    return Segment(
        color=color,
        start_column=column,
        start_row=row,
        width=width,
        height=height,
    )

def _require(params: Mapping[str, Any], key: str) -> Any:
    if key not in params:
        raise ProgramBuildError(f"missing required param {key!r}")
    return params[key]


def _resolve_color(value: Any, *, default_index: int = 6) -> tuple[int, int, int]:
    """Accepts either the FEATURES-app.md 0-7 clock-colour enum (playlist items, the
    `clock_face` service) or an already-resolved RGB triple (a `RenderSpec`-originated show,
    e.g. `iledclock/show`'s `item.spec` -- `Segment.color` is a raw RGB on the wire regardless
    of which vocabulary picked it)."""
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return tuple(int(component) & 0xFF for component in value)
    index = int(value) if value is not None else default_index
    try:
        return CLOCK_COLOR_RGB[index]
    except KeyError as err:
        raise ProgramBuildError(f"color must be one of {sorted(CLOCK_COLOR_RGB)}, got {index}") from err


def _style_clock(style_index: int, params: Mapping[str, Any]) -> ClockContent:
    """A firmware clock face with the vendor's exact geometry for `style_index` (clock_styles.py).
    Its digits come from a per-style glyph table, so digit size and segment positions are fixed
    per style; only colour and 12/24 h are ours to choose."""
    style = CLOCK_STYLES.get(style_index)
    if style is None:
        raise ProgramBuildError(f"unknown clock style {style_index}; choose one of {sorted(CLOCK_STYLES)}")
    color = _resolve_color(params.get("color", params.get("clock_color")))
    # `hours24` is this integration's playlist/service vocabulary; `h24` is RenderSpec's.
    hours24 = bool(params.get("hours24", params.get("h24", True)))

    def seg(geometry: tuple[int, int, int, int] | None) -> Segment:
        if geometry is None:
            return Segment()
        x, y, w, h = geometry
        return Segment(color=color, start_column=x, start_row=y, width=w, height=h)

    return ClockContent(
        style_index=style_index,
        is_24_hour=hours24,
        hour=seg(style.hour),
        space_hour=seg(style.space_hour),
        minute=seg(style.minute),
        space_minute=seg(style.space_minute),
        seconds=seg(style.seconds),
        is_blink_colon=style.blink_colon,
        reuse_space_after_minute=style.show_space_minute,
        show_time=0,
        num_width=style.num_width,
        num_height=style.num_height,
    )


def _background_content(background: ClockBackground) -> AnimationContent:
    """The vendor's full-panel background animation, layered *underneath* a clock/date digit
    layer in the same combine-program -- `ILedClockClockTimeFragment.getClockCombineProgram`
    builds this exact shape for both the clock's own background (~line 1170:
    `if (cLockStyleItem.clockBgImageId > 0) { ... }`) and the date companion's (~line 1201),
    each an `ILedClockAnimationProgramContent` covering the full panel
    (`startRow=0, startColumn=0, showWidth=DEVICE_COLUMN, showHeight=DEVICE_ROW`), added to
    `combinePrograms` *before* the clock/date item so it renders behind the digits.

    Neither vendor call site sets `.layerType` explicitly, so the wire byte comes from
    `ILedClockAnimationProgramContent`'s own Java field default, `layerType = 1`
    [VENDOR ILedClockManager.java:1307] -- NOT this dataclass's own default of 0 (an existing,
    unrelated mismatch between this port's `AnimationContent.layer_type` default and the
    vendor's true default for that content type, out of scope here; passed explicitly instead
    of relied upon)."""
    frames = [
        _rgb888_to_frame(frame, width=background.width, height=background.height, duration_ms=background.delay_ms)
        for frame in background.frames
    ]
    return AnimationContent(
        start_column=0, start_row=0, show_width=background.width, show_height=background.height,
        frames=frames, layer_type=1,
    )


def _clock_content(params: Mapping[str, Any]) -> ClockContent | list[Content]:
    """The `clock` playlist kind / `RenderSpec` -- the vendor always pairs a clock style with
    its own 32x16 background art (`CLockStyleItem.clockBgImageId`, always > 0 for every style);
    `background` (default `True`) mirrors that, but stays optional so a plain firmware-only
    clock (this integration's original behaviour) is still reachable."""
    style_index = int(_require(params, "style"))
    clock = _style_clock(style_index, params)
    if not bool(params.get("background", True)):
        return clock
    background = CLOCK_BACKGROUNDS.get(style_index)
    if background is None:
        return clock
    return [_background_content(background), clock]


def _date_content(params: Mapping[str, Any]) -> DateContent:
    color = _resolve_color(params.get("color"))
    return DateContent(
        show_space_year=DATE_LAYOUT.show_space_year,
        show_space_month=DATE_LAYOUT.show_space_month,
        show_space_day=DATE_LAYOUT.show_space_day,
        year=_layout_segment(color, DATE_LAYOUT.year),
        space_year=_layout_segment(color, DATE_LAYOUT.space_year),
        month=_layout_segment(color, DATE_LAYOUT.month),
        space_month=_layout_segment(color, DATE_LAYOUT.space_month),
        day=_layout_segment(color, DATE_LAYOUT.day),
        space_day=_layout_segment(color, DATE_LAYOUT.space_day),
        week=_layout_segment(color, DATE_LAYOUT.week),
        layer_type=DATE_LAYOUT.layer_type,
        month_flag=DATE_LAYOUT.month_flag,
        show_time=DATE_LAYOUT.show_time,
        num_height=DATE_LAYOUT.num_height,
        num_width=DATE_LAYOUT.num_width,
        year_num_height=DATE_LAYOUT.year_num_height,
        year_num_width=DATE_LAYOUT.year_num_width,
    )


def _date_content_with_background(params: Mapping[str, Any]) -> DateContent | list[Content]:
    """The `date` playlist kind: the vendor's date companion screen always pairs the date
    digits with `CLockStyleItem.dateBgImageId` (one shared background for every style --
    `getClockCombineProgram` ~line 1201). `_date_content` itself stays a pure digit-only
    builder (its own direct unit tests -- test_firmware_layouts.py -- pin that shape); this
    wrapper is `date`'s actual `_BUILDERS` entry, matching `_clock_content`'s `background`
    default-`True` opt-out."""
    date = _date_content(params)
    if not bool(params.get("background", True)):
        return date
    return [_background_content(DATE_BACKGROUND), date]


_TIMER_MODE_TO_WIRE = {"countdown": 0, "stopwatch": 1}


def _timer_content(params: Mapping[str, Any]) -> TimeCountContent:
    mode_name = _require(params, "mode")
    try:
        mode = _TIMER_MODE_TO_WIRE[mode_name]
    except KeyError as err:
        raise ProgramBuildError(
            f"mode must be one of {sorted(_TIMER_MODE_TO_WIRE)}, got {mode_name!r}"
        ) from err
    color = _resolve_color(params.get("color"))
    layout = TIME_COUNT_LAYOUTS[mode]
    return TimeCountContent(
        mode=mode,
        hour=_layout_segment(color, layout.hour),
        space_hour=_layout_segment(color, layout.space_hour),
        minute=_layout_segment(color, layout.minute),
        space_minute=_layout_segment(color, layout.space_minute),
        seconds=_layout_segment(color, layout.seconds),
        layer_type=layout.layer_type,
        num_height=layout.num_height,
        num_width=layout.num_width,
    )


def _scoreboard_content(params: Mapping[str, Any]) -> ScoreboardContent:
    color = _resolve_color(params.get("color"))
    return ScoreboardContent(
        host_score=_layout_segment(color, SCOREBOARD_LAYOUT.host_score),
        visit_score=_layout_segment(color, SCOREBOARD_LAYOUT.visit_score),
        host_total=_layout_segment(color, SCOREBOARD_LAYOUT.host_total),
        visit_total=_layout_segment(color, SCOREBOARD_LAYOUT.visit_total),
        minute=_layout_segment(color, SCOREBOARD_LAYOUT.minute),
        space_minute=_layout_segment(color, SCOREBOARD_LAYOUT.space_minute),
        seconds=_layout_segment(color, SCOREBOARD_LAYOUT.seconds),
        layer_type=SCOREBOARD_LAYOUT.layer_type,
        score_num_height=SCOREBOARD_LAYOUT.score_num_height,
        score_num_width=SCOREBOARD_LAYOUT.score_num_width,
        total_num_height=SCOREBOARD_LAYOUT.total_num_height,
        total_num_width=SCOREBOARD_LAYOUT.total_num_width,
        time_num_height=SCOREBOARD_LAYOUT.time_num_height,
        time_num_width=SCOREBOARD_LAYOUT.time_num_width,
    )


def _temperature_content(params: Mapping[str, Any]) -> TemperatureContent:
    color = _resolve_color(params.get("color"))
    column, row, width, height = TEMPERATURE_LAYOUT.segment
    return TemperatureContent(
        color=color,
        start_column=column,
        start_row=row,
        width=width,
        height=height,
        layer_type=TEMPERATURE_LAYOUT.layer_type,
        num_height=TEMPERATURE_LAYOUT.num_height,
        num_width=TEMPERATURE_LAYOUT.num_width,
    )


def _humidity_content(params: Mapping[str, Any]) -> HumidityContent:
    color = _resolve_color(params.get("color"), default_index=4)  # default cyan
    column, row, width, height = HUMIDITY_LAYOUT.segment
    return HumidityContent(
        color=color,
        start_column=column,
        start_row=row,
        width=width,
        height=height,
        layer_type=HUMIDITY_LAYOUT.layer_type,
        num_height=HUMIDITY_LAYOUT.num_height,
        num_width=HUMIDITY_LAYOUT.num_width,
    )




@dataclass(frozen=True)
class TextSpec:
    """A text show, playlist item or studio preview, checked and in one shape (`parse_text_spec`)."""

    text: str
    font: str
    color: tuple[int, int, int]
    effect: int
    bold: bool
    speed: float | int | None
    smooth: str | None


def parse_text_spec(params: Mapping[str, Any]) -> TextSpec:
    """Read the text keys of a show, a playlist item or an `iledclock/render` spec. Two vocabularies meet here and
    both work: `effect` or `color_mode` (the vendor's colour modes 1-28; only 1, 2 and 4 look different, see
    `protocol.render.text_frames`) and `is_bold` or `bold`. `color` is an RGB list (or a 0-7 clock colour number),
    default white. `speed` is the playback speed every show has (0 = still ... 100 = fastest, absent = Original)
    and `smooth` likewise; the clock's old 0-255 text speed no longer exists. Raises `ProgramBuildError` (a
    ValueError) with a message meant for the user."""
    text = str(_require(params, "text"))
    if len(text) > TEXT_MODE_MAX_LENGTH:
        raise ProgramBuildError(f"That text is too long: {TEXT_MODE_MAX_LENGTH} characters at most.")
    font = str(params["font"]) if params.get("font") else DEFAULT_FONT
    try:
        get_font(font)
    except ValueError as err:
        raise ProgramBuildError(str(err)) from err
    try:
        color = _resolve_color(params.get("color"))
    except (TypeError, ValueError) as err:
        raise ProgramBuildError("The text colour must be three numbers (red, green, blue) from 0 to 255.") from err
    raw_effect = params.get("effect", params.get("color_mode"))
    effect = protocol_render.TEXT_EFFECT_SOLID
    if raw_effect is not None:
        try:
            effect = int(raw_effect)
        except (TypeError, ValueError):
            effect = 0
        if isinstance(raw_effect, bool) or not TEXT_COLOR_MODE_MIN <= effect <= TEXT_COLOR_MODE_MAX:
            raise ProgramBuildError(
                f"The text effect must be a number from {TEXT_COLOR_MODE_MIN} to {TEXT_COLOR_MODE_MAX}."
            )
    return TextSpec(
        text=text,
        font=font,
        color=color,
        effect=effect,
        bold=bool(params.get("is_bold", params.get("bold", False))),
        speed=retime.validate_speed(params.get("speed")),
        smooth=retime.validate_smooth(params.get("smooth")),
    )


def text_playback_frames(params: Mapping[str, Any]) -> list[Frame]:
    """The frames the clock plays for a text show: the text drawn with at most `TEXT_MAX_FRAMES` frames, then given
    the show's Speed and Smooth motion like every other picture (`retimed_frames`; no speed leaves it at its own
    pace). A show, a playlist item and the studio's preview (`iledclock/render`) all come through here, so what is
    previewed is exactly what is uploaded."""
    spec = parse_text_spec(params)
    frames = protocol_render.text_frames(
        spec.text, spec.font, spec.color, effect=spec.effect, bold=spec.bold, max_frames=TEXT_MAX_FRAMES
    )
    return retimed_frames(frames, {"speed": spec.speed, "smooth": spec.smooth})


def _text_content(params: Mapping[str, Any]) -> Content:
    """A text playlist item: one picture when the text fits the panel (or is shown still), else an animation."""
    frames = text_playback_frames(params)
    return frames_to_content(frames, still=len(frames) == 1)


def _rgb888_to_frame(data: bytes, *, width: int, height: int, duration_ms: int) -> Frame:
    pixels: list[list[tuple[int, int, int]]] = []
    for row in range(height):
        offset = row * width * 3
        pixels.append(
            [
                (data[offset + col * 3], data[offset + col * 3 + 1], data[offset + col * 3 + 2])
                for col in range(width)
            ]
        )
    return Frame(pixels=pixels, duration_ms=duration_ms, width=width, height=height)


def art_width(design: Design) -> int:
    """Columns of the panel a design's art occupies: all of them, or only those left of the clock
    region ("Icon with clock": the art and the firmware's live clock never overlap, because
    overlap/transparency semantics are unconfirmed on this firmware)."""
    return design.clock_region[0] if design.clock_region is not None else design.width


def _crop_rgb888(frame: bytes, full_width: int, width: int) -> bytes:
    if width >= full_width:
        return frame
    stride, keep = full_width * 3, width * 3
    return b"".join(frame[at : at + keep] for at in range(0, len(frame), stride))


def retime_art(
    frames: Sequence[bytes],
    delays_ms: Sequence[float],
    speed: float | int | None,
    smooth: str | None,
    clock_region: tuple[int, int, int, int] | None = None,
) -> retime.Retimed:
    """`retime.retime` for full-panel RGB888 frames, working on the art columns only: with a clock
    region (x, y, w, h) just the columns left of it are uploaded, so only those are judged and
    returned (`x` columns wide). Frames that are not a saved design yet (the editor's work in
    progress) come through here too."""
    width = clock_region[0] if clock_region is not None else DISPLAY_WIDTH
    cropped = [_crop_rgb888(frame, DISPLAY_WIDTH, width) for frame in frames]
    return retime.retime(cropped, delays_ms, speed, smooth, width=width, height=DISPLAY_HEIGHT)


def inline_playback(msg: Mapping[str, Any]) -> tuple[retime.Retimed, int]:
    """`iledclock/playback/preview` for frames sent inline (the panel previewing a Speed and Smooth
    motion setting for a picture that is not a saved design yet): `frames` (base64 RGB888), `delays`
    (ms), optional `clock_region`, `speed`, `smooth`. Returns the result and the art width. Raises
    ValueError (DesignValidationError is one) for anything malformed."""
    raw_frames, delays = msg.get("frames"), msg.get("delays")
    if not raw_frames or delays is None or len(raw_frames) != len(delays) or len(raw_frames) > DESIGN_MAX_FRAMES:
        raise ValueError(f"send 1 to {DESIGN_MAX_FRAMES} frames with one delay each, or a design_id")
    frames = [decode_frame(raw, index) for index, raw in enumerate(raw_frames)]
    region = validate_clock_region(msg.get("clock_region"))
    played = retime_art(frames, delays, msg.get("speed"), msg.get("smooth"), region)
    return played, region[0] if region is not None else DISPLAY_WIDTH


def design_playback(design: Design, overrides: Mapping[str, Any] | None = None) -> retime.Retimed:
    """The frames and delays (art columns only, see `art_width`) the clock plays for `design`: its
    stored Speed and Smooth motion, unless `overrides` carries a `speed` and/or `smooth` key (a
    service call, or the panel previewing a slider position that is not saved yet). The preview, the
    Now hero and the upload all come through here, so they cannot disagree."""
    speed, smooth = design.speed, design.smooth
    if overrides:
        speed = overrides.get("speed", speed)
        smooth = overrides.get("smooth", smooth)
    return retime_art(design.frames, design.delays_ms, speed, smooth, design.clock_region)


def design_play_frames(design: Design, overrides: Mapping[str, Any] | None = None) -> tuple[list[Frame], retime.Retimed]:
    """`design_playback` as pixel `Frame`s with their delays in real milliseconds."""
    played = design_playback(design, overrides)
    width = art_width(design)
    frames = [
        _rgb888_to_frame(frame, width=width, height=design.height, duration_ms=delay)
        for frame, delay in zip(played.frames, played.delays_ms)
    ]
    return frames, played


def retimed_frames(frames: Sequence[Frame], overrides: Mapping[str, Any]) -> list[Frame]:
    """Apply a `speed` / `smooth` given alongside rendered frames (`show_image`, `show_generative`) the
    same way a design's are applied. Without a speed the frames are left exactly as they are."""
    speed = retime.validate_speed(overrides.get("speed"))
    smooth = retime.validate_smooth(overrides.get("smooth"))
    if speed is None or len(frames) < 2:
        return list(frames)
    flat = [bytes(channel for row in frame.pixels for pixel in row for channel in pixel) for frame in frames]
    played = retime.retime(flat, [frame.duration_ms for frame in frames], speed, smooth)
    return [
        _rgb888_to_frame(data, width=DISPLAY_WIDTH, height=DISPLAY_HEIGHT, duration_ms=delay)
        for data, delay in zip(played.frames, played.delays_ms)
    ]


def poster_frame(frames: Sequence[Frame]) -> Frame:
    """The frame that stands for an animation as a single picture: the one with the most lit LEDs (the same rule
    `retime.poster_frame_index` gives a speed-0 "still" show)."""
    flat = [bytes(channel for row in frame.pixels for pixel in row for channel in pixel) for frame in frames]
    return frames[retime.poster_frame_index(flat)]


#: Clock styles the vendor draws inside part of the panel (it pairs them with background art),
#: most preferred first: 16/17/19/40 are a stacked HH-over-MM clock in the right half, 14/15 in
#: the left half, 20-27 small corner/strip clocks.
_REGION_STYLE_PREFERENCE = (16, 17, 19, 40, 15, 14, 21, 20, 23, 27, 22, 25, 24, 26)


def _style_fits(style_index: int, region: tuple[int, int, int, int]) -> bool:
    x, y, w, h = region
    style = CLOCK_STYLES[style_index]
    for geometry in (style.hour, style.space_hour, style.minute, style.space_minute, style.seconds):
        if geometry is None:
            continue
        sx, sy, sw, sh = geometry
        if sx < x or sy < y or sx + sw > x + w or sy + sh > y + h:
            return False
    return True


def region_clock_style(region: tuple[int, int, int, int], params: Mapping[str, Any]) -> int:
    """The clock style an "Icon with clock" design uses for `region` (x, y, w, h): the user's
    chosen style when it fits, else the first vendor style designed to sit beside art that does.
    Shared by the upload path and the server-side preview so both draw the same face."""
    requested = params.get("clock_style")
    candidates = ([int(requested)] if requested is not None else []) + list(_REGION_STYLE_PREFERENCE)
    for style_index in candidates:
        if style_index in CLOCK_STYLES and _style_fits(style_index, region):
            return style_index
    raise ProgramBuildError(f"no clock style fits in region {region}")


def region_clock_color(params: Mapping[str, Any]) -> tuple[int, int, int]:
    """The clock colour `_style_clock` will upload for these params."""
    return _resolve_color(params.get("color", params.get("clock_color")))


def _clock_in_region(region: tuple[int, int, int, int], params: Mapping[str, Any]) -> ClockContent:
    return _style_clock(region_clock_style(region, params), params)


def _design_content(params: Mapping[str, Any], designs: Mapping[str, Design]) -> Content | list[Content]:
    design_id = _require(params, "design_id")
    design = designs.get(design_id)
    if design is None:
        raise ProgramBuildError(f"no saved design with id {design_id!r}")
    frames, _played = design_play_frames(design, params)
    width = art_width(design)
    if design.kind == "image" or len(frames) == 1:
        art: Content = GraffitiContent(
            start_column=0, start_row=0, show_width=width, show_height=design.height,
            pixels=frames[0],
        )
    else:
        art = AnimationContent(
            start_column=0, start_row=0, show_width=width, show_height=design.height,
            frames=frames,
        )
    if design.clock_region is None:
        return art
    return [art, _clock_in_region(design.clock_region, params)]


def frames_to_content(frames: Sequence[Frame], *, still: bool) -> Content:
    """Wrap already-rendered frames (from `render.text_frames`/`image_to_frames`/`generative`,
    called by services.py/websocket_api.py before this) as device content -- a single still
    frame becomes a `GraffitiContent`, several become an `AnimationContent`, matching
    `_design_content`'s own choice for the same distinction."""
    if still or len(frames) == 1:
        return GraffitiContent(
            start_column=0, start_row=0, show_width=DISPLAY_WIDTH, show_height=DISPLAY_HEIGHT,
            pixels=frames[0],
        )
    return AnimationContent(
        start_column=0, start_row=0, show_width=DISPLAY_WIDTH, show_height=DISPLAY_HEIGHT,
        frames=list(frames),
    )


#: `program_type` for a combine-program with more than one content, keyed by its LAST
#: content's type. The vendor always orders a combine-program [background/art, ...,
#: native-content] and reports the native content's own `programType` for the whole thing:
#: `ILedClockClockTimeFragment.getClockCombineProgram` uses 7 for [animation, clock] and 6 for
#: [animation, date]; the "icon with clock" template (`_design_content`) is the same 7 for
#: [art, clock]. `Program.resolved_program_type()`'s own default (keyed by `contents[0]`) is
#: wrong for any of these -- the first content is always the background/art, never the
#: type-defining one.
_TERMINAL_PROGRAM_TYPE: dict[type, int] = {ClockContent: 7, DateContent: 6}


_BUILDERS = {
    "clock": lambda params, designs: _clock_content(params),
    "date": lambda params, designs: _date_content_with_background(params),
    "text": lambda params, designs: _text_content(params),
    "design": _design_content,
    "timer": lambda params, designs: _timer_content(params),
    "scoreboard": lambda params, designs: _scoreboard_content(params),
    "temperature": lambda params, designs: _temperature_content(params),
    "humidity": lambda params, designs: _humidity_content(params),
}


def build_contents(item: PlaylistItem, *, designs: Mapping[str, Design]) -> list[Content]:
    """Every content layer one playlist item uploads as (usually one; an "Icon with clock"
    design is two: its art and a live firmware clock beside it)."""
    try:
        builder = _BUILDERS[item.kind]
    except KeyError as err:
        raise ProgramBuildError(f"unsupported playlist kind: {item.kind!r}") from err
    built = builder(item.params, designs)
    return list(built) if isinstance(built, list) else [built]


def build_programs(
    items: Sequence[PlaylistItem], *, designs: Mapping[str, Design]
) -> list[Program]:
    """One `Program` per playlist item, in order. `duration_s` passes straight through as
    `Program.show_count` -- confirmed with the protocol agent to be the field that actually
    reaches the upload start frame's rotation-timing trailer; `Program.show_count` is genuinely
    just "how many seconds", the `_count` in its name notwithstanding. `is_clock_in_list` is set
    on every program when any item in the whole playlist is a clock, matching the vendor's own
    per-list (not per-program) flag."""
    built = [build_contents(item, designs=designs) for item in items]
    has_clock = any(isinstance(c, ClockContent) for contents in built for c in contents)
    return [
        Program(
            contents=contents,
            show_count=item.duration_s,
            is_clock_in_list=has_clock,
            # A combine-program with more than one content is background/art + a native layer;
            # the vendor reports that native layer's own programType for the whole thing (see
            # `_TERMINAL_PROGRAM_TYPE`).
            program_type=_TERMINAL_PROGRAM_TYPE.get(type(contents[-1])) if len(contents) > 1 else None,
        )
        for item, contents in zip(items, built)
    ]


def build_single_program(content: Content, *, duration_s: int, is_clock: bool = False) -> Program:
    """For `show_*` (a one-item playlist override, Contract D's `iledclock/show`)."""
    return Program(contents=[content], show_count=duration_s, is_clock_in_list=is_clock)


def program_screen(program: Program) -> str:
    """The screen the clock files `program` in. The start frame's kind byte decides, and the program's type
    decides the kind (`protocol.programs._start_frame`): a date (type 6), a temperature-and-humidity page (19) and a
    clock that is not part of a program list (7) carry kind 04, the clock-page store = screen B, whichever screen was
    asked for (proven live: a date sent as a one-item playlist replaced B and left A alone). Everything else lands
    on screen A's side. Tests pin this against the real start frame."""
    program_type = program.resolved_program_type()
    if program_type in (6, 19) or (program_type == 7 and not program.is_clock_in_list):
        return SLOT_B
    return SLOT_A


def show_content_class(kind: str, params: Mapping[str, Any], designs: Mapping[str, Design]) -> str:
    """The content class (`const.CONTENT_CLASSES`) of a show, which decides what screen B takes. A saved design is
    `art_clock` when it has a firmware clock beside its art. Raises `ProgramBuildError` for an unknown type or a
    design that is not in `designs`."""
    has_clock_region = False
    if kind == "design":
        design = designs.get(str(params.get("design_id", "")))
        if design is None:
            raise ProgramBuildError(f"no saved design with id {params.get('design_id')!r}")
        has_clock_region = design.clock_region is not None
    try:
        return content_class_of(kind, has_clock_region=has_clock_region)
    except ValueError as err:
        raise ProgramBuildError(str(err)) from err


def _content_list(built: Content | list[Content]) -> list[Content]:
    return list(built) if isinstance(built, list) else [built]


def build_slot_b_program(
    kind: str, params: Mapping[str, Any], *, designs: Mapping[str, Design], art: Content | None = None
) -> Program:
    """One standalone page for the clock's second screen (the clock-page store; start-frame kind byte 04, index 0
    of 1): never part of the program list, so a page written here leaves screen A alone. What each kind becomes:

    * `clock`: `[background, clock]`, program type 7 (trailer `04 01 10`), as the vendor's Clock tab writes it;
    * `date`: `[background, date]`, type 6 (trailer `04 01 5`);
    * `temperature` and `humidity`: ONE temperature-and-humidity page, type 19 (trailer `04 01 5`);
    * a design with a firmware clock beside its art: `[art, clock]`, type 7;
    * plain art (text, image, generated effect, design without a clock; `art` carries content that was already
      rendered): the art as a type-7 page -- the live-unverified experiment behind `hardware.SLOT_B_ACCEPTS_ART`.

    Raises `slots.SlotUnsupportedError` before anything is built when screen B does not take the content (timers
    and scoreboards never; plain art while the flag is off) and `ProgramBuildError` for an unknown design."""
    require_slot_accepts(SLOT_B, show_content_class(kind, params, designs))
    if kind == "clock":
        contents, program_type = _content_list(_clock_content(params)), 7
    elif kind == "date":
        contents, program_type = _content_list(_date_content_with_background(params)), 6
    elif kind in ("temperature", "humidity"):
        contents, program_type = [_temperature_content(params), _humidity_content(params)], 19
    else:
        contents = [art] if art is not None else _content_list(_BUILDERS[kind](params, designs))
        program_type = 7
    return Program(
        contents=contents, show_count=DEFAULT_PLAYLIST_DURATION_S, is_clock_in_list=False, program_type=program_type
    )


def _power_limit_frame(frame: Frame, brightness: int) -> Frame:
    flat = [px for row in frame.pixels for px in row]
    limited = power_limited_frame(flat, brightness)
    if limited == flat:
        return frame
    w = len(frame.pixels[0]) if frame.pixels else 0
    return replace(frame, pixels=[limited[i * w:(i + 1) * w] for i in range(len(frame.pixels))])


def power_limit_programs(programs: Sequence[Program], brightness: int | None) -> list[Program]:
    """Apply the vendor's own LED current budget (`adjustPowerGraffiti`/`adjustPowerAnimation`,
    `hardware.power_limited_frame`) to every pixel frame about to be uploaded.

    The vendor app never calls it because its slider stops at 100, but the firmware accepts
    brightness up to 255 and is much brighter there (confirmed on the live clock 2026-09-26).
    The rule only engages above brightness 96 and only for frames whose average pixel is near
    white, so normal art is untouched while a full-white frame at high brightness is scaled back
    to the vendor's budget. Applied at upload time with the brightness in effect then."""
    if brightness is None:
        return list(programs)
    out: list[Program] = []
    for program in programs:
        contents = []
        for content in program.contents:
            if isinstance(content, GraffitiContent):
                content = replace(content, pixels=_power_limit_frame(content.pixels, brightness))
            elif isinstance(content, AnimationContent):
                content = replace(content, frames=[_power_limit_frame(f, brightness) for f in content.frames])
            contents.append(content)
        out.append(replace(program, contents=contents))
    return out


def to_device_timing(programs: Sequence[Program]) -> list[Program]:
    """Convert every animation frame's real-time `duration_ms` into the clock's own delay units
    (`hardware.device_delay_units`, ~1.5 ms per unit), so designs, GIFs and previews keep real
    milliseconds everywhere and only the upload speaks the device's unit. Applied once, at the
    upload chokepoint."""
    out: list[Program] = []
    for program in programs:
        contents = []
        for content in program.contents:
            if isinstance(content, AnimationContent):
                content = replace(
                    content,
                    frames=[replace(f, duration_ms=device_delay_units(f.duration_ms)) for f in content.frames],
                )
            contents.append(content)
        out.append(replace(program, contents=contents))
    return out
