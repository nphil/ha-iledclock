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

from typing import Any, Mapping, Sequence

from .const import CLOCK_COLOR_RGB, DISPLAY_HEIGHT, DISPLAY_WIDTH
from .designs import Design
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


# Digit glyph geometry shared by the clock-like layouts below: 5 wide (the bundled default font's
# advance width), 7 tall, vertically centred in the 16-row panel. Not device-confirmed pixel
# positions (the vendor UI computes these interactively per drag); a deliberate, sane default.
_DIGIT_W = 5
_DIGIT_H = 7
_ROW = (DISPLAY_HEIGHT - _DIGIT_H) // 2  # 4
_COLON_W = 3
_GAP = 1


def _hhmm_segments(
    color: tuple[int, int, int], *, show_seconds: bool, trailing_columns: int = 0
) -> dict[str, Segment]:
    """A centred HH:MM[:SS] layout. Column budget on the 32-wide panel: HH(5) + gap + :(3) + gap
    + MM(5) = 16 before any left margin, leaving room for optional seconds and/or
    `trailing_columns` reserved for something the caller adds afterwards (e.g. an AM/PM mark)."""
    budget = DISPLAY_WIDTH - trailing_columns
    column = max(0, (budget - 16) // 2)
    hour = Segment(color=color, start_column=column, start_row=_ROW, width=_DIGIT_W, height=_DIGIT_H)
    column += _DIGIT_W + _GAP
    space_hour = Segment(color=color, start_column=column, start_row=_ROW, width=_COLON_W, height=_DIGIT_H)
    column += _COLON_W + _GAP
    minute = Segment(color=color, start_column=column, start_row=_ROW, width=_DIGIT_W, height=_DIGIT_H)
    column += _DIGIT_W + _GAP

    seconds = Segment()
    space_minute = Segment()
    if show_seconds and column + _COLON_W + _GAP + _DIGIT_W <= budget:
        space_minute = Segment(color=color, start_column=column, start_row=_ROW, width=_COLON_W, height=_DIGIT_H)
        column += _COLON_W + _GAP
        seconds = Segment(color=color, start_column=column, start_row=_ROW, width=_DIGIT_W, height=_DIGIT_H)
        column += _DIGIT_W + _GAP

    return {
        "hour": hour, "space_hour": space_hour, "minute": minute,
        "space_minute": space_minute, "seconds": seconds, "_next_column": column,
    }


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


def _clock_content(params: Mapping[str, Any]) -> ClockContent:
    style = int(_require(params, "style"))
    # `hours24` is this integration's own playlist/service vocabulary; a `RenderSpec`-originated
    # show (`iledclock/show`'s `item.spec`, `type: "clock"`) instead carries `h24` -- accept
    # either so `async_show` doesn't need to know which vocabulary a given caller used.
    hours24 = bool(params.get("hours24", params.get("h24", True)))
    show_seconds = bool(params.get("show_seconds", False))
    color = _resolve_color(params.get("color"))

    ampm_columns = 0 if hours24 else 6
    segments = _hhmm_segments(color, show_seconds=show_seconds, trailing_columns=ampm_columns)
    ampm = Segment()
    if not hours24:
        ampm = Segment(
            color=color, start_column=segments["_next_column"], start_row=_ROW,
            width=DISPLAY_WIDTH - segments["_next_column"], height=_DIGIT_H,
        )

    return ClockContent(
        style_index=style,
        is_24_hour=hours24,
        hour=segments["hour"],
        space_hour=segments["space_hour"],
        minute=segments["minute"],
        space_minute=segments["space_minute"],
        seconds=segments["seconds"],
        ampm=ampm,
    )


def _date_content(params: Mapping[str, Any]) -> DateContent:
    color = _resolve_color(params.get("color"))
    # The device's own font tables carry no year-digit glyphs at all (protocol-agent-verified
    # control-flow fact, not a guess), so the year segment is left omitted (width=height=0)
    # rather than configured to render digits that would silently come out empty.
    column = (DISPLAY_WIDTH - (_DIGIT_W * 2 + _COLON_W + _GAP * 2)) // 2
    month = Segment(color=color, start_column=column, start_row=_ROW, width=_DIGIT_W, height=_DIGIT_H)
    column += _DIGIT_W + _GAP
    space_month = Segment(color=color, start_column=column, start_row=_ROW, width=_COLON_W, height=_DIGIT_H)
    column += _COLON_W + _GAP
    day = Segment(color=color, start_column=column, start_row=_ROW, width=_DIGIT_W, height=_DIGIT_H)

    return DateContent(
        show_space_year=False,
        show_space_month=True,
        show_space_day=False,
        year=Segment(),
        space_year=Segment(),
        month=month,
        space_month=space_month,
        day=day,
        space_day=Segment(),
        week=Segment(),
    )


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
    segments = _hhmm_segments(color, show_seconds=True)
    return TimeCountContent(
        mode=mode,
        hour=segments["hour"],
        space_hour=segments["space_hour"],
        minute=segments["minute"],
        space_minute=segments["space_minute"],
        seconds=segments["seconds"],
    )


def _scoreboard_content(params: Mapping[str, Any]) -> ScoreboardContent:
    color = _resolve_color(params.get("color"))
    score_width = 14  # up to 3 digits per side
    host_score = Segment(color=color, start_column=1, start_row=_ROW, width=score_width, height=_DIGIT_H)
    visit_score = Segment(
        color=color, start_column=DISPLAY_WIDTH - 1 - score_width, start_row=_ROW,
        width=score_width, height=_DIGIT_H,
    )
    return ScoreboardContent(
        host_score=host_score,
        visit_score=visit_score,
        host_total=Segment(),
        visit_total=Segment(),
        minute=Segment(),
        space_minute=Segment(),
        seconds=Segment(),
    )


def _temperature_content(params: Mapping[str, Any]) -> TemperatureContent:
    color = _resolve_color(params.get("color"))
    width, height = 28, 10
    return TemperatureContent(
        color=color,
        start_column=(DISPLAY_WIDTH - width) // 2,
        start_row=(DISPLAY_HEIGHT - height) // 2,
        width=width,
        height=height,
    )


def _humidity_content(params: Mapping[str, Any]) -> HumidityContent:
    color = _resolve_color(params.get("color"), default_index=4)  # default cyan
    width, height = 28, 10
    return HumidityContent(
        color=color,
        start_column=(DISPLAY_WIDTH - width) // 2,
        start_row=(DISPLAY_HEIGHT - height) // 2,
        width=width,
        height=height,
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


def _design_content(params: Mapping[str, Any], designs: Mapping[str, Design]) -> Content:
    design_id = _require(params, "design_id")
    design = designs.get(design_id)
    if design is None:
        raise ProgramBuildError(f"no saved design with id {design_id!r}")
    frames = design_to_frames(design)
    if design.kind == "image":
        return GraffitiContent(
            start_column=0, start_row=0, show_width=design.width, show_height=design.height,
            pixels=frames[0],
        )
    return AnimationContent(
        start_column=0, start_row=0, show_width=design.width, show_height=design.height,
        frames=frames,
    )


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


_BUILDERS = {
    "clock": lambda params, designs: _clock_content(params),
    "date": lambda params, designs: _date_content(params),
    "text": lambda params, designs: _text_content(params),
    "design": _design_content,
    "timer": lambda params, designs: _timer_content(params),
    "scoreboard": lambda params, designs: _scoreboard_content(params),
    "temperature": lambda params, designs: _temperature_content(params),
    "humidity": lambda params, designs: _humidity_content(params),
}


def build_content(item: PlaylistItem, *, designs: Mapping[str, Design]) -> Content:
    try:
        builder = _BUILDERS[item.kind]
    except KeyError as err:
        raise ProgramBuildError(f"unsupported playlist kind: {item.kind!r}") from err
    return builder(item.params, designs)


def build_programs(
    items: Sequence[PlaylistItem], *, designs: Mapping[str, Design]
) -> list[Program]:
    """One `Program` per playlist item, in order. `duration_s` passes straight through as
    `Program.show_count` -- confirmed with the protocol agent to be the field that actually
    reaches the upload start frame's rotation-timing trailer; `Program.show_count` is genuinely
    just "how many seconds", the `_count` in its name notwithstanding. `is_clock_in_list` is set
    on every program when any item in the whole playlist is a clock, matching the vendor's own
    per-list (not per-program) flag."""
    has_clock = any(item.kind == "clock" for item in items)
    return [
        Program(
            contents=[build_content(item, designs=designs)],
            show_count=item.duration_s,
            is_clock_in_list=has_clock,
        )
        for item in items
    ]


def build_single_program(content: Content, *, duration_s: int, is_clock: bool = False) -> Program:
    """For `show_*` (a one-item playlist override, Contract D's `iledclock/show`)."""
    return Program(contents=[content], show_count=duration_s, is_clock_in_list=is_clock)
