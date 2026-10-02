"""Per-design playback: the Speed slider and Smooth motion, as one pure function.

A design stores its frames and per-frame delays exactly as authored. `retime()` turns those into
the frames and delays the clock should actually play for a chosen speed and smoothing setting.
The preview (`iledclock/render`, `iledclock/playback/preview`) and the upload
(`program_builder`) both call it, so what the panel shows is what the clock plays.

Pure Python, no `homeassistant` imports (like `adapt.py` and `hardware.py`). Every number that
describes the hardware comes from `hardware.py`; the thresholds that decide "this step slides" or
"this step fades" are tuning values defined here, marked [INFERENCE] until judged by eye on the real
LEDs (a 3 px a step ticker, a blink and a glow, each with and without in-betweens).

Speed (`speed`: None, or 0..100)
    * None = **Original**: the authored delays untouched.
    * 0 = **Still**: one picture, the fullest frame (`poster_frame_index`, the same rule the tiles
      use), uploaded as a single graffiti frame.
    * 1..100: the pace follows `pace_for_speed`, a log curve from 0.5 to ~95 *authored* frames a
      second (7 device delay units per frame, the fastest setting seen to play smoothly). The
      authored rhythm is kept: one factor scales every delay until the mean pace matches, each
      delay clamped to [7 units, 65535 units]. A blink [1500, 100, 100, 100 ms] stays a blink.

Smoothing (`smooth`: None = auto, "on", "off"; None behaves like "on")
    Only when the animation is slowed below its authored pace (speed below the Original position)
    do long holds appear, and only then are in-between frames added, per step from frame A to B
    (including the wrap from the last frame to the first):
    * identical frames are merged (one longer hold);
    * **slide** - the step is an exact integer shift (whole frame, or the box around what changed,
      which covers a half-panel ticker or a sprite on a plain background): in-betweens are copies
      of real pixels shifted part of the way. No new colours, no ghosts;
    * **fade** - every changed pixel gets brighter (or every one dimmer) in the same hue, by a
      moderate amount: in-betweens are interpolated in the clock's own 4-bit levels;
    * anything else (blinks, sprite swaps, palette cycling) stays a hard **cut**, and so does a slide
      that runs against the slides around it (a sprite flying back to where the loop restarts).
    Loop length never changes: an in-between splits the hold of the frame before it. In-betweens are
    limited so no step lasts longer than `SMOOTH_TARGET_STEP_MS` or shorter than
    `SMOOTH_MIN_STEP_MS`, and the whole animation never exceeds `SMOOTH_MAX_FRAMES`.

All classification looks at the 12-bit RGB444 value each pixel has on the panel (through the
curved transfer), not at raw RGB888, so two raw colours the clock shows identically count as
equal. Frames are packed one 16-bit lane per pixel into a Python int, so testing a candidate shift
is a handful of big-int operations instead of a loop over 512 pixels.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Sequence

from . import hardware
from .const import DESIGN_MAX_FRAMES, DISPLAY_HEIGHT, DISPLAY_WIDTH

__all__ = [
    "PlaybackInfo",
    "Retimed",
    "SMOOTH_SETTINGS",
    "pace_for_speed",
    "poster_frame_index",
    "retime",
    "speed_for_pace",
    "validate_smooth",
    "validate_speed",
]

#: Values a design's `smooth` may hold besides None (auto). Auto behaves like "on".
SMOOTH_SETTINGS = ("on", "off")

# -- Tuning values for what counts as sliding / fading [INFERENCE: tune by eye on the real clock] ---------------------

#: Search range for a slide, in pixels. A bigger jump is more likely a different picture than motion.
SHIFT_MAX_X = 8
SHIFT_MAX_Y = 4
#: Fewest changed pixels in a step for it to be called motion at all.
SHIFT_MIN_CHANGED = 2
#: Share of the changed pixels a slide may leave unexplained.
SHIFT_UNEXPLAINED_MAX = 0.25
#: Share of the lit content that may be brand new at the edge the picture slides in from.
SHIFT_ENTERING_MAX = 0.35
#: A fade needs this share of changed pixels moving the same way (brighter, or dimmer) ...
FADE_SAME_DIRECTION_MIN = 0.9
#: ... and this share keeping their hue (or going to / from black) ...
FADE_HUE_MATCH_MIN = 0.8
#: ... by at least this many of the clock's 16 levels (fewer cannot be cut up) ...
FADE_MIN_STEP = 3
#: ... and at most this many. A bigger jump is a blink (on / off), which must stay sharp.
FADE_MAX_STEP = 7

_UNIT_MS = hardware.DEVICE_MS_PER_DELAY_UNIT
_MIN_UNITS = hardware.ANIMATION_MIN_FRAME_UNITS
_MAX_UNITS = hardware.ANIMATION_DELAY_WIRE_MAX_MS  # the wire field is 16 bits; the name says ms, the value is the limit

_TRANSFER = hardware.rgb444_transfer_table()
_REPRESENTATIVE = tuple(hardware.rgb444_representative(n) for n in range(16))


# -- Settings --------------------------------------------------------------------------------------------------------


def validate_speed(value: object) -> float | int | None:
    """None (Original) or a number from 0 (Still) to 100 (Max)."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("speed must be a number from 0 to 100, or null for Original")
    if not 0 <= value <= 100:
        raise ValueError("speed must be a number from 0 to 100, or null for Original")
    return value


def validate_smooth(value: object) -> str | None:
    """None (auto), "on" or "off"."""
    if value is None or value in SMOOTH_SETTINGS:
        return value  # type: ignore[return-value]
    raise ValueError('smooth must be "on", "off" or null (auto)')


# -- The speed curve -------------------------------------------------------------------------------------------------


def pace_for_speed(speed: float) -> float:
    """Authored frames a second at slider position `speed` (1..100). Each ~13% of travel doubles
    the pace, so the 3-15 frames a second gallery art lives at is not squeezed into the first
    sliver of a linear slider. Position 0 is Still and has no pace."""
    low, high = hardware.PLAYBACK_MIN_FPS, hardware.PLAYBACK_MAX_FPS
    return high * (low / high) ** (1.0 - speed / 100.0)


def speed_for_pace(fps: float) -> float:
    """Inverse of `pace_for_speed`, clamped to 0..100."""
    low, high = hardware.PLAYBACK_MIN_FPS, hardware.PLAYBACK_MAX_FPS
    if fps <= 0:
        return 0.0
    position = 100.0 * (1.0 - math.log(fps / high) / math.log(low / high))
    return max(0.0, min(100.0, position))


# -- Results ---------------------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PlaybackInfo:
    """What a `retime()` call did, in the shape the Speed control shows (`to_json`)."""

    still: bool
    frames: int
    authored_frames: int
    added_frames: int
    loop_ms: float
    pace_fps: float
    native_fps: float
    original_speed: float
    #: "unavailable" nothing slides or fades; "off" available but switched off; "idle" on, but the speed is
    #: Original or faster so nothing is added; "applied" in-betweens were added; "none" on and slowed, but
    #: nothing needed adding (holds already short, or the frame budget is full).
    smooth_state: str
    smooth_available: bool
    smooth_enabled: bool
    slides: int
    fades: int
    sharp: int
    capped: bool

    def to_json(self) -> dict[str, Any]:
        return {
            "still": self.still,
            "frames": self.frames,
            "authored_frames": self.authored_frames,
            "added_frames": self.added_frames,
            "loop_ms": round(self.loop_ms, 1),
            "pace_fps": round(self.pace_fps, 3),
            "native_fps": round(self.native_fps, 3),
            "original_speed": round(self.original_speed, 2),
            "smooth": {
                "state": self.smooth_state,
                "available": self.smooth_available,
                "enabled": self.smooth_enabled,
                "slides": self.slides,
                "fades": self.fades,
                "sharp": self.sharp,
                "capped": self.capped,
            },
        }


@dataclass(frozen=True, slots=True)
class Retimed:
    """The frames the clock plays (RGB888 bytes, row-major) with their delays in real milliseconds
    (a whole number of device units * 1.5 when a speed is set, the authored value at Original)."""

    frames: tuple[bytes, ...]
    delays_ms: tuple[float, ...]
    info: PlaybackInfo


def poster_frame_index(frames: Sequence[bytes]) -> int:
    """The frame a still picture should show: the one with the most lit LEDs, so animations that
    start dark or build up are recognisable. Ties keep the earliest. Same rule as
    `frontend/src/lib/tile-policy.ts` `posterFrameIndex`, so the clock matches the tile."""
    best, best_lit = 0, -1
    for index, frame in enumerate(frames):
        lit = sum(1 for r, g, b in zip(frame[0::3], frame[1::3], frame[2::3]) if r or g or b)
        if lit > best_lit:
            best, best_lit = index, lit
    return best


# -- Frames as 12-bit pixels packed into ints ------------------------------------------------------------------------


def _levels(frame: bytes) -> list[int]:
    """One 12-bit value per pixel: the clock's red, green and blue levels (0-15 each)."""
    t = _TRANSFER
    return [(t[r] << 8) | (t[g] << 4) | t[b] for r, g, b in zip(frame[0::3], frame[1::3], frame[2::3])]


def _pack(values: Sequence[int]) -> int:
    """Sixteen bits per value, first value in the lowest bits."""
    buffer = bytearray(2 * len(values))
    buffer[0::2] = bytes([v & 0xFF for v in values])
    buffer[1::2] = bytes([v >> 8 for v in values])
    return int.from_bytes(buffer, "little")


@lru_cache(maxsize=None)
def _ones(lanes: int) -> int:
    """Bit 0 of every 16-bit lane set."""
    return int.from_bytes(b"\x01\x00" * lanes, "little")


def _any_bit(x: int) -> int:
    """Fold each 16-bit lane into its lowest bit (set if any bit of the lane was set). Callers mask
    with `_ones` afterwards; the upper bits of a lane hold junk."""
    x |= x >> 8
    x |= x >> 4
    x |= x >> 2
    x |= x >> 1
    return x


@lru_cache(maxsize=4096)
def _valid_masks(width: int, height: int, dx: int, dy: int) -> tuple[int, int]:
    """For a picture shifted by (dx, dy): the lanes whose source pixel lies inside the picture, as a
    full 16-bit-lane mask and as a bit-0-per-lane mask."""
    x0, x1 = max(0, dx), min(width, width + dx)
    mask = 0
    for y in range(max(0, dy), min(height, height + dy)):
        mask |= ((1 << (16 * (x1 - x0))) - 1) << (16 * (y * width + x0))
    return mask, mask & _ones(width * height)


class _Prepared:
    """One frame, ready to compare."""

    __slots__ = ("rgb", "levels", "packed")

    def __init__(self, rgb: bytes) -> None:
        self.rgb = rgb
        self.levels = _levels(rgb)
        self.packed = _pack(self.levels)


# -- Classifying one step from frame A to frame B --------------------------------------------------------------------

_Box = tuple[int, int, int, int]  # x0, y0, x1, y1 (exclusive)


@dataclass(frozen=True, slots=True)
class _Step:
    #: "same" identical; "slide" an integer shift; "fade" a brightness ramp; "cut" anything else.
    kind: str
    dx: int = 0
    dy: int = 0
    box: _Box | None = None
    #: Biggest shift in pixels (slide) or biggest level change (fade): at most span - 1 in-betweens fit.
    span: int = 0

    @property
    def most_in_betweens(self) -> int:
        if self.kind == "slide":
            return max(0, self.span - 1)
        if self.kind == "fade":
            return max(0, self.span - 1)
        return 0


def _region_values(levels: Sequence[int], width: int, box: _Box) -> list[int]:
    x0, y0, x1, y1 = box
    out: list[int] = []
    for y in range(y0, y1):
        out.extend(levels[y * width + x0 : y * width + x1])
    return out


def _changed_box(a: _Prepared, b: _Prepared, width: int, height: int) -> _Box | None:
    left, top, right, bottom = width, height, -1, -1
    for y in range(height):
        row_a = a.levels[y * width : (y + 1) * width]
        row_b = b.levels[y * width : (y + 1) * width]
        if row_a == row_b:
            continue
        top = min(top, y)
        bottom = y
        for x in range(width):
            if row_a[x] != row_b[x]:
                left = min(left, x)
                break
        for x in range(width - 1, -1, -1):
            if row_a[x] != row_b[x]:
                right = max(right, x)
                break
    if right < 0:
        return None
    return left, top, right + 1, bottom + 1


def _find_shift(a: _Prepared, b: _Prepared, width: int, box: _Box) -> tuple[int, int, int] | None:
    """The whole box content moved by an exact integer (dx, dy), or None. Returns (dx, dy, span).

    The box is treated as a rigid picture sliding over a plain background (its commonest colour).
    A shift is accepted when, apart from the strip that slides in from outside, it reproduces the
    next frame almost exactly: few overlap pixels disagree (`SHIFT_UNEXPLAINED_MAX` of the changed
    count), the new content at the entering edge is a small share of the lit pixels
    (`SHIFT_ENTERING_MAX`), and at least one changed pixel really is a moved, non-background pixel."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if w < 2 and h < 2:
        return None
    lanes = w * h
    ones = _ones(lanes)
    full = (1 << (16 * lanes)) - 1
    pa = _pack(_region_values(a.levels, width, box))
    pb = _pack(_region_values(b.levels, width, box))

    counts = Counter(_region_values(a.levels, width, box))
    background = min(counts, key=lambda value: (-counts[value], value))
    fill = background * ones
    a_lit = _any_bit(pa ^ fill) & ones
    b_lit = _any_bit(pb ^ fill) & ones
    changed_mask = _any_bit(pa ^ pb) & ones
    changed = changed_mask.bit_count()
    if changed < SHIFT_MIN_CHANGED:
        return None
    content = max(1, b_lit.bit_count())

    best: tuple[tuple[int, int, int, int], int, int] | None = None
    for dy in range(-min(SHIFT_MAX_Y, h - 1), min(SHIFT_MAX_Y, h - 1) + 1):
        for dx in range(-min(SHIFT_MAX_X, w - 1), min(SHIFT_MAX_X, w - 1) + 1):
            if not dx and not dy:
                continue
            valid, valid_ones = _valid_masks(w, h, dx, dy)
            offset = dy * w + dx
            if offset >= 0:
                moved = (pa << (16 * offset)) & full
            else:
                moved = pa >> (16 * -offset)
            mismatch = _any_bit((moved ^ pb) & valid) & ones
            unexplained = mismatch.bit_count()
            if unexplained > SHIFT_UNEXPLAINED_MAX * changed:
                continue
            entering = (b_lit & ~valid_ones).bit_count()
            if entering > SHIFT_ENTERING_MAX * content:
                continue
            if offset >= 0:
                moved_lit = (a_lit << (16 * offset)) & full
            else:
                moved_lit = a_lit >> (16 * -offset)
            if not (moved_lit & valid_ones & ~mismatch & changed_mask):
                continue  # nothing that changed was really carried across
            span = max(abs(dx), abs(dy))
            key = (unexplained, entering, span, abs(dx) + abs(dy))
            if best is None or key < best[0]:
                best = (key, dx, dy)
    if best is None:
        return None
    _key, dx, dy = best
    return dx, dy, max(abs(dx), abs(dy))


def _fade_span(a: _Prepared, b: _Prepared) -> int | None:
    """The biggest change in any one of the clock's 16 levels when every changed pixel moves the same
    way (all brighter, or all dimmer) and keeps its hue or goes to / from black; None otherwise."""
    changed = [(x, y) for x, y in zip(a.levels, b.levels) if x != y]
    if not changed:
        return None
    up = down = hue_ok = 0
    span = 0
    for x, y in changed:
        ar, ag, ab = (x >> 8) & 15, (x >> 4) & 15, x & 15
        br, bg, bb = (y >> 8) & 15, (y >> 4) & 15, y & 15
        brightness = (br + bg + bb) - (ar + ag + ab)
        if brightness > 0:
            up += 1
        elif brightness < 0:
            down += 1
        span = max(span, abs(br - ar), abs(bg - ag), abs(bb - ab))
        ma, mb = max(ar, ag, ab), max(br, bg, bb)
        if ma == 0 or mb == 0:
            hue_ok += 1
        elif all(abs(ca * mb - cb * ma) * 4 <= ma * mb for ca, cb in ((ar, br), (ag, bg), (ab, bb))):
            hue_ok += 1
    total = len(changed)
    if max(up, down) < FADE_SAME_DIRECTION_MIN * total or hue_ok < FADE_HUE_MATCH_MIN * total:
        return None
    return span if FADE_MIN_STEP <= span <= FADE_MAX_STEP else None


def _classify(a: _Prepared, b: _Prepared, width: int, height: int) -> _Step:
    if a.packed == b.packed:
        return _Step("same")
    full: _Box = (0, 0, width, height)
    found = _find_shift(a, b, width, full)
    box = full
    if found is None:
        changed = _changed_box(a, b, width, height)
        if changed is not None and changed != full:
            found = _find_shift(a, b, width, changed)
            box = changed
    if found is not None:
        return _Step("slide", dx=found[0], dy=found[1], box=box, span=found[2])
    span = _fade_span(a, b)
    if span is not None:
        return _Step("fade", span=span)
    return _Step("cut")


# -- Analysing a whole animation (independent of speed and smoothing) ------------------------------------------------


def _without_restarts(steps: list[_Step]) -> list[_Step]:
    """A slide against the direction of the slides on both sides of it, by more than they go together,
    is the animation starting over (a sprite that crossed the panel jumping back to where it began).
    Smoothing it would fly the sprite backwards, so it stays a cut."""
    count = len(steps)
    if count < 3:
        return steps
    kept = list(steps)
    for j, step in enumerate(steps):
        before, after = steps[j - 1], steps[(j + 1) % count]
        if step.kind != "slide" or before.kind != "slide" or after.kind != "slide":
            continue
        against_both = all(step.dx * other.dx + step.dy * other.dy < 0 for other in (before, after))
        if against_both and step.span >= before.span + after.span:
            kept[j] = _Step("cut")
    return kept


@dataclass(frozen=True, slots=True)
class _Analysis:
    #: Authored frame indexes grouped into runs of identical consecutive frames.
    runs: tuple[tuple[int, ...], ...]
    #: steps[j] is the step from run j to run j + 1 (the last wraps to the first).
    steps: tuple[_Step, ...]

    @property
    def available(self) -> bool:
        return any(step.most_in_betweens > 0 for step in self.steps)

    def count(self, kind: str) -> int:
        return sum(1 for step in self.steps if step.kind == kind)


@lru_cache(maxsize=32)
def _analyse(frames: tuple[bytes, ...], width: int, height: int) -> _Analysis:
    prepared = [_Prepared(frame) for frame in frames]
    runs: list[list[int]] = [[0]]
    for index in range(1, len(prepared)):
        if prepared[index].packed == prepared[runs[-1][0]].packed:
            runs[-1].append(index)
        else:
            runs.append([index])
    leaders = [prepared[run[0]] for run in runs]
    if len(runs) == 1:
        return _Analysis(tuple(tuple(run) for run in runs), ())
    steps = [_classify(leaders[j], leaders[(j + 1) % len(runs)], width, height) for j in range(len(runs))]
    return _Analysis(tuple(tuple(run) for run in runs), tuple(_without_restarts(steps)))


# -- Speed: scaling the authored rhythm ------------------------------------------------------------------------------


def _scale_units(authored: Sequence[float], target_total: float) -> list[int]:
    """Whole device units per frame, in the authored rhythm, summing to about `target_total`.

    One factor `c` multiplies every delay; each result is clamped to [7, 65535] units. The clamp makes
    the total a non-decreasing, piecewise-linear function of `c`, so bisection finds the factor."""
    count = len(authored)
    if target_total <= count * _MIN_UNITS + 1e-6:
        return [_MIN_UNITS] * count
    if target_total >= count * _MAX_UNITS:
        return [_MAX_UNITS] * count

    def total(factor: float) -> float:
        return sum(min(_MAX_UNITS, max(_MIN_UNITS, factor * unit)) for unit in authored)

    low, high = 0.0, _MAX_UNITS / min(authored) + 1.0
    for _ in range(100):
        middle = (low + high) / 2.0
        if total(middle) < target_total:
            low = middle
        else:
            high = middle
    factor = (low + high) / 2.0
    return [min(_MAX_UNITS, max(_MIN_UNITS, round(factor * unit))) for unit in authored]


# -- Smoothing: how many in-betweens, and what they look like --------------------------------------------------------


def _in_betweens(step: _Step, hold_ms: float, target_ms: float) -> int:
    """In-betweens for one step: the picture can be cut into pieces no longer than `target_ms` and no
    shorter than `SMOOTH_MIN_STEP_MS`, but never more than the step itself has to give."""
    longest = math.ceil(hold_ms / target_ms) - 1
    shortest = math.floor(hold_ms / hardware.SMOOTH_MIN_STEP_MS) - 1
    return max(0, min(step.most_in_betweens, longest, shortest))


def _plan_in_betweens(steps: Sequence[_Step], holds_ms: Sequence[float]) -> tuple[list[int], bool]:
    """In-between counts per step, and whether the target step length had to be raised to keep the
    whole animation within `SMOOTH_MAX_FRAMES`. Raising the target thins out the short holds first,
    so the longest holds keep their in-betweens longest."""
    base = float(hardware.SMOOTH_TARGET_STEP_MS)

    def counts(target: float) -> list[int]:
        return [_in_betweens(step, hold, target) for step, hold in zip(steps, holds_ms)]

    budget = hardware.SMOOTH_MAX_FRAMES - len(steps)
    if budget <= 0:
        return [0] * len(steps), any(step.most_in_betweens > 0 for step in steps)
    plan = counts(base)
    if sum(plan) <= budget:
        return plan, False
    low, high = base, max(holds_ms) + 1.0
    for _ in range(60):
        middle = (low + high) / 2.0
        if sum(counts(middle)) <= budget:
            high = middle
        else:
            low = middle
    return counts(high), True


def _round_half_up(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


def _slide_frame(a: bytes, b: bytes, width: int, step: _Step, shifted: tuple[int, int]) -> bytes:
    """A with the box content moved by `shifted` (part of the way to the full shift). Pixels sliding in
    from outside the box are taken from B, moved back by the part of the shift that is still to go."""
    x0, y0, x1, y1 = step.box  # type: ignore[misc]
    sx, sy = shifted
    rest_x, rest_y = step.dx - sx, step.dy - sy
    out = bytearray(a)
    for y in range(y0, y1):
        for x in range(x0, x1):
            px, py = x - sx, y - sy
            if x0 <= px < x1 and y0 <= py < y1:
                source, at = a, (py * width + px) * 3
            else:
                px, py = x + rest_x, y + rest_y
                if not (x0 <= px < x1 and y0 <= py < y1):
                    continue
                source, at = b, (py * width + px) * 3
            to = (y * width + x) * 3
            out[to : to + 3] = source[at : at + 3]
    return bytes(out)


def _fade_frame(a: _Prepared, b: _Prepared, k: int, parts: int) -> bytes:
    """A fraction k / parts of the way from A to B, interpolated per pixel in the clock's levels and
    stored as values the upload quantises back to exactly those levels."""
    out = bytearray(a.rgb)
    representative = _REPRESENTATIVE
    for index, (x, y) in enumerate(zip(a.levels, b.levels)):
        if x == y:
            continue
        channels = []
        for shift in (8, 4, 0):
            low, high = (x >> shift) & 15, (y >> shift) & 15
            channels.append(low + _round_half_up((high - low) * k, parts))
        at = index * 3
        out[at] = representative[channels[0]]
        out[at + 1] = representative[channels[1]]
        out[at + 2] = representative[channels[2]]
    return bytes(out)


def _slide_shifts(step: _Step, count: int) -> list[tuple[int, int]]:
    """Whole-pixel shifts for `count` in-betweens, evenly spread over the full shift."""
    parts = count + 1
    return [
        (_round_half_away(step.dx * k, parts), _round_half_away(step.dy * k, parts))
        for k in range(1, count + 1)
    ]


def _round_half_away(numerator: int, denominator: int) -> int:
    quotient = (2 * abs(numerator) + denominator) // (2 * denominator)
    return quotient if numerator >= 0 else -quotient


def _split(total: int, parts: int) -> list[int]:
    base, extra = divmod(total, parts)
    return [base + (1 if index < extra else 0) for index in range(parts)]


# -- The entry point -------------------------------------------------------------------------------------------------


def retime(
    frames: Sequence[bytes],
    delays_ms: Sequence[float],
    speed: float | int | None = None,
    smooth: str | None = None,
    *,
    width: int = DISPLAY_WIDTH,
    height: int = DISPLAY_HEIGHT,
) -> Retimed:
    """The frames and delays the clock plays for `speed` and `smooth` (see the module docstring).

    `frames` are RGB888 bytes, `width * height * 3` each; `delays_ms` the authored hold of each frame in
    real milliseconds. Raises ValueError for bad input."""
    frames = tuple(frames)
    delays = tuple(float(d) for d in delays_ms)
    if not frames or len(frames) != len(delays):
        raise ValueError("frames and delays must be non-empty lists of the same length")
    expected = width * height * 3
    if any(len(frame) != expected for frame in frames):
        raise ValueError(f"every frame must be {expected} bytes ({width}x{height} RGB888)")
    return _retime(frames, delays, validate_speed(speed), validate_smooth(smooth), width, height)


@lru_cache(maxsize=48)
def _retime(
    frames: tuple[bytes, ...],
    delays_ms: tuple[float, ...],
    speed: float | int | None,
    smooth: str | None,
    width: int,
    height: int,
) -> Retimed:
    count = len(frames)
    authored_ms = [max(1.0, d) for d in delays_ms]
    native_ms = sum(authored_ms)
    native_fps = count * 1000.0 / native_ms
    original_speed = max(1.0, speed_for_pace(native_fps)) if count > 1 else 0.0
    enabled = smooth != "off"

    def info(
        out_frames: int, loop_ms: float, *, still: bool = False, added: int = 0, state: str = "unavailable",
        analysis: _Analysis | None = None, capped: bool = False,
    ) -> PlaybackInfo:
        return PlaybackInfo(
            still=still,
            frames=out_frames,
            authored_frames=count,
            added_frames=added,
            loop_ms=loop_ms,
            pace_fps=(count * 1000.0 / loop_ms) if loop_ms > 0 else 0.0,
            native_fps=native_fps if count > 1 else 0.0,
            original_speed=original_speed,
            smooth_state=state,
            smooth_available=analysis.available if analysis else False,
            smooth_enabled=enabled,
            slides=analysis.count("slide") if analysis else 0,
            fades=analysis.count("fade") if analysis else 0,
            sharp=analysis.count("cut") if analysis else 0,
            capped=capped,
        )

    if count == 1:
        return Retimed(frames, (delays_ms[0],), info(1, 0.0))

    analysis = _analyse(frames, width, height) if count <= DESIGN_MAX_FRAMES else None
    idle_state = "unavailable" if not (analysis and analysis.available) else ("off" if not enabled else "idle")

    if speed is None:
        return Retimed(frames, delays_ms, info(count, native_ms, state=idle_state, analysis=analysis))

    if speed == 0:
        poster = poster_frame_index(frames)
        return Retimed((frames[poster],), (100.0,), info(1, 0.0, still=True, state=idle_state, analysis=analysis))

    target_units = count * (1000.0 / pace_for_speed(speed)) / _UNIT_MS
    units = _scale_units([d / _UNIT_MS for d in authored_ms], target_units)
    slowed = target_units > native_ms / _UNIT_MS * (1.0 + 1e-9)

    if analysis is None:
        out_frames, out_units = list(frames), units
        added, capped, state = 0, False, idle_state
    else:
        out_frames, out_units, added, capped = _assemble(frames, units, analysis, enabled and slowed, width)
        if not analysis.available:
            state = "unavailable"
        elif not enabled:
            state = "off"
        elif not slowed:
            state = "idle"
        else:
            state = "applied" if added else "none"
    delays = tuple(u * _UNIT_MS for u in out_units)
    return Retimed(
        tuple(out_frames), delays,
        info(len(out_frames), sum(delays), added=added, state=state, analysis=analysis, capped=capped),
    )


def _assemble(
    frames: tuple[bytes, ...], units: Sequence[int], analysis: _Analysis, smoothing: bool, width: int,
) -> tuple[list[bytes], list[int], int, bool]:
    """Merge identical runs, then (when `smoothing`) cut long holds with in-betweens."""
    runs = analysis.runs
    holds = [min(_MAX_UNITS, sum(units[i] for i in run)) for run in runs]
    plan = [0] * len(runs)
    capped = False
    if smoothing and analysis.steps:
        plan, capped = _plan_in_betweens(analysis.steps, [hold * _UNIT_MS for hold in holds])
    prepared: dict[int, _Prepared] = {}

    def level_frame(run: int) -> _Prepared:
        if run not in prepared:
            prepared[run] = _Prepared(frames[runs[run][0]])
        return prepared[run]

    out_frames: list[bytes] = []
    out_units: list[int] = []
    for j, run in enumerate(runs):
        leader = frames[run[0]]
        in_between = plan[j] if analysis.steps else 0
        pieces = _split(holds[j], in_between + 1)
        out_frames.append(leader)
        out_units.append(pieces[0])
        if not in_between:
            continue
        step = analysis.steps[j]
        after = (j + 1) % len(runs)
        if step.kind == "slide":
            for shifted, piece in zip(_slide_shifts(step, in_between), pieces[1:]):
                out_frames.append(_slide_frame(leader, frames[runs[after][0]], width, step, shifted))
                out_units.append(piece)
        else:  # fade
            for k, piece in enumerate(pieces[1:], start=1):
                out_frames.append(_fade_frame(level_frame(j), level_frame(after), k, in_between + 1))
                out_units.append(piece)
    return out_frames, out_units, sum(plan), capped
