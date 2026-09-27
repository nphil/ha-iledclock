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

Two playlist kinds have no builder here because they have nothing to build: `reminders` are
read-only from this integration's side (Contract A exposes no create/set opcode, only
list/detail/delete -- see coordinator.py), so `protocol.programs.ReminderContent` is never
constructed by us; and `FrameContent` (decorative borders) isn't wired to any playlist kind or
service -- it's a minor ancillary content type, not one of the vendor app's 25 numbered
features, so no dedicated user-facing control was added for it.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping, Sequence

from .const import CLOCK_COLOR_RGB, DISPLAY_HEIGHT, DISPLAY_WIDTH
from .clock_styles import CLOCK_STYLES
from .clock_backgrounds import CLOCK_BACKGROUNDS, DATE_BACKGROUND, ClockBackground
from .content_layouts import (
    DATE_LAYOUT,
    HUMIDITY_LAYOUT,
    SCOREBOARD_LAYOUT,
    TEMPERATURE_LAYOUT,
    TIME_COUNT_LAYOUTS,
)
from .designs import Design
from .hardware import device_delay_units, power_limited_frame
from .playlist import PlaylistItem
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
    TextAutoColor,
    TextContent,
    TextCustomColor,
    TimeCountContent,
)


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




def _text_content(params: Mapping[str, Any]) -> TextContent:
    """`text` is used from three different vocabularies: playlist items / the `show_text`
    service (`color_mode` int 1-28), a saved design has no text content at all, and a
    `RenderSpec`-originated show (`iledclock/show`'s `item.spec`, `type: "text"`) which instead
    carries a flat `color` RGB triple and an optional `effect` -- sent by the frontend as a
    *string* even though it is always a plain numeric colour-mode index (`String(mode)`).
    Priority: explicit per-character `colors` > `effect`/`color_mode` (an auto colour-cycle) >
    a flat `color` applied to every character > the default effect."""
    text = str(_require(params, "text"))
    colors_raw = params.get("colors")
    effect = params.get("effect", params.get("color_mode"))
    flat_color = params.get("color")
    speed_auto = int(params.get("speed", 230))
    speed_custom = int(params.get("speed", 255))

    if colors_raw is not None:
        color: TextAutoColor | TextCustomColor = TextCustomColor(
            colors=[tuple(c) for c in colors_raw], speed=speed_custom
        )
    elif effect is not None:
        color = TextAutoColor(effect=int(effect), speed=speed_auto)
    elif flat_color is not None:
        rgb = tuple(int(component) & 0xFF for component in flat_color)
        color = TextCustomColor(colors=[rgb] * len(text), speed=speed_custom)
    else:
        color = TextAutoColor(effect=1, speed=speed_auto)

    kwargs: dict[str, Any] = {"text": text, "color": color}
    if "font" in params:
        kwargs["font"] = str(params["font"])
    if "is_bold" in params:
        kwargs["is_bold"] = bool(params["is_bold"])
    if "move_space" in params:
        kwargs["move_space"] = int(params["move_space"])
    return TextContent(**kwargs)


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
    return Frame(pixels=pixels, duration_ms=duration_ms)


def design_to_frames(design: Design) -> list[Frame]:
    return [
        _rgb888_to_frame(frame, width=design.width, height=design.height, duration_ms=delay)
        for frame, delay in zip(design.frames, design.delays_ms)
    ]


def _crop_columns(frame: Frame, width: int) -> Frame:
    return replace(frame, pixels=[row[:width] for row in frame.pixels], width=width)


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
    frames = design_to_frames(design)
    width = design.width
    if design.clock_region is not None:
        # "Icon with clock": the art only occupies the columns left of the clock, so the two
        # layers never overlap (overlap/transparency semantics are unconfirmed on this firmware).
        width = design.clock_region[0]
        frames = [_crop_columns(f, width) for f in frames]
    if design.kind == "image":
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
