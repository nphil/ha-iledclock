"""Shared helpers for turning the golden harness's JSON vectors (Android-model-shaped args)
into this package's Python dataclasses, and for locating the vectors file itself. Not a test
module (leading underscore keeps ``unittest discover`` from collecting it as one).

The golden vectors live OUTSIDE this repository, at a path derived from decompiling the
vendor's proprietary APK -- appropriate for verifying this port during development, not for
shipping alongside an open-source Home Assistant integration. Every test module that uses
this file calls :func:`load_vectors`, which returns ``None`` (not a list) when the fixture
directory is absent, so `python3 -m unittest discover` still passes cleanly on a checkout that
does not have it (e.g. any environment other than the one this port was built in) -- the
golden-vector tests skip themselves in that case rather than failing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from protocol import framing
from protocol.models import AlarmItem, Frame, Segment, TimerSwitchItem
from protocol.programs import (
    AnimationContent,
    ClockContent,
    Content,
    DateContent,
    FrameContent,
    GraffitiContent,
    HumidityContent,
    Program,
    ReminderContent,
    ScoreboardContent,
    TemperatureContent,
    TimeCountContent,
)

VECTORS_PATH = Path("/data/home/tmp/led1248/golden/vectors.json")

_DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def load_vectors() -> list[dict[str, Any]] | None:
    if not VECTORS_PATH.exists():
        return None
    with VECTORS_PATH.open() as handle:
        return json.load(handle)


def java_random_bytes(seed: int, n: int) -> bytes:
    """Reproduces ``new java.util.Random(seed).nextBytes(new byte[n])`` exactly: the standard
    48-bit linear congruential generator (JLS-specified, so this is a stable algorithm to
    port, not an implementation detail that could change) plus ``nextBytes``'s own
    4-bytes-per-``nextInt()`` packing order. Used to reconstruct the
    ``CrcCode``/``LzssCompress`` golden vectors' ``"<n>randomSeed<seed>"`` labelled buffers,
    which the harness generates from a seed rather than inlining as JSON.
    """
    mask48 = (1 << 48) - 1
    state = (seed ^ 0x5DEECE66D) & mask48

    def next_bits(bits: int) -> int:
        nonlocal state
        state = (state * 0x5DEECE66D + 0xB) & mask48
        return state >> (48 - bits)

    def next_int() -> int:
        value = next_bits(32)
        if value >= 1 << 31:
            value -= 1 << 32
        return value

    out = bytearray()
    while len(out) < n:
        rnd = next_int()
        for _ in range(min(n - len(out), 4)):
            out.append(rnd & 0xFF)
            rnd >>= 8
    return bytes(out)


def _java_int(value: int) -> int:
    """Wraps `value` to a signed 32-bit Java ``int`` (two's complement)."""
    value &= 0xFFFFFFFF
    return value - 0x100000000 if value >= 0x80000000 else value


def java_string_hashcode(s: str) -> int:
    """``String.hashCode()``: ``s[0]*31^(n-1) + s[1]*31^(n-2) + ... + s[n-1]``, 32-bit signed
    wraparound throughout. Verified against the well-known reference values
    ``"".hashCode()==0``, ``"a".hashCode()==97``, ``"hello".hashCode()==99162322``."""
    h = 0
    for ch in s:
        h = _java_int(h * 31 + ord(ch))
    return h


def synthetic_bytes(seed: str, length: int) -> bytes:
    """Reproduces the golden harness's ``FileUtils`` stub (``golden/stubs/.../FileUtils.java``):
    real GIF/raw-image file and Android-resource bytes don't exist in the harness, so it
    substitutes a deterministic LCG byte stream seeded by ``seed.hashCode()`` --
    ``state = state*1103515245 + 12345`` (32-bit signed wraparound), taking
    ``(byte)(state >>> 16)`` (the byte at bits 16-23 of the unsigned state) each round. Used for
    every ``getDataWithAnimationCombineProgram``/``getDataForCombineProgram(ANIMATION|
    GIF_FILE_ANIMATION)`` vector that references a GIF file path (seed ``"file:" + path``) or a
    drawable resource id (seed ``"raw:" + resId``) -- verified byte-for-byte reproduction of the
    stub's own output, not a guess. This is a golden-harness testing artifact, not vendor
    protocol behaviour; real file/resource bytes are a `client.py`/integration-layer concern."""
    state = java_string_hashcode(seed)
    out = bytearray(length)
    for i in range(length):
        state = _java_int(state * 1103515245 + 12345)
        out[i] = (state & 0xFFFFFFFF) >> 16 & 0xFF
    return bytes(out)


def crc_lzss_test_buffer(label: str) -> bytes:
    """Reconstructs the fixed byte buffer the golden harness's ``CrcCode``/``LzssCompress``
    sweep generates for `label`, matching ``Golden.java``'s ``zeros``/``seededRandomBytes``/
    ``repeatingBuffer`` helpers exactly (see ``golden/harness/Golden.java:386-390``)."""
    if label == "empty":
        return b""
    if label == "1byte":
        return bytes((0xAB,))
    if label == "100zeros":
        return bytes(100)
    if label == "1000randomSeed7":
        return java_random_bytes(7, 1000)
    if label == "5000repetitive":
        pattern = bytes((0xCA, 0xFE))
        return bytes(pattern[i % len(pattern)] for i in range(5000))
    raise ValueError(f"unknown golden CRC/LZSS test buffer label {label!r}")


def unframe(hex_str: str) -> bytes:
    """Every top-level vendor builder (``getDeviceInfo``, ``getStartDataForProgram``,
    ``getDataPacket``'s per-chunk output, ...) calls ``getSendDataWithInfo`` internally and
    so its captured ``out`` is a full ``01``/``03`` frame -- this project's own builders
    return the bare payload instead (framing is `framing.py`'s job, applied uniformly by the
    transport layer). Content encoders (`getDataWithXCombineProgram` etc.) do NOT frame their
    own output; callers of this helper know which shape they have."""
    return framing.decode_frame(bytes.fromhex(hex_str))


def argb_to_rgb(value) -> tuple[int, int, int]:
    """Android packs colours as a signed 32-bit ARGB int (`Color.argb`/`Color.rgb`); the
    golden vectors preserve that representation verbatim (as either a JSON int or an
    ``AARRGGBB`` hex string) since it is what the vendor's own model classes store."""
    if isinstance(value, str):
        n = int(value, 16)
    else:
        n = value & 0xFFFFFFFF
    return ((n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF)


def segment_from(args: dict, prefix: str) -> Segment:
    return Segment(
        color=argb_to_rgb(args[f"{prefix}Color"]),
        start_column=args[f"{prefix}StartColumn"],
        start_row=args[f"{prefix}StartRow"],
        width=args[f"{prefix}Width"],
        height=args[f"{prefix}Height"],
    )


def frame_from_draw_items(items: list[dict], width: int, height: int, duration_ms: int = 100) -> Frame:
    pixels = [
        [argb_to_rgb(items[row * width + col]["color"]) for col in range(width)] for row in range(height)
    ]
    return Frame(pixels=pixels, duration_ms=duration_ms, width=width, height=height)


def animation_content_from_json(ac: dict) -> AnimationContent:
    """Builds an `AnimationContent` from an ``ILedClockAnimationProgramContent`` JSON blob whose
    ``mListDrawItems`` is real per-frame pixel data (as opposed to a ``gifFile``/``imageId``
    reference, which routes through `synthetic_bytes` + the raw-bytes encoders instead -- see
    ``test_golden_vectors.py``'s combine-program dispatch handler)."""
    width, height = ac["showWidth"], ac["showHeight"]
    delays = ac.get("delays")
    frames = [
        frame_from_draw_items(frame_items, width, height, duration_ms=(delays[i] if delays else 0))
        for i, frame_items in enumerate(ac["mListDrawItems"])
    ]
    return AnimationContent(
        start_column=ac["startColumn"],
        start_row=ac["startRow"],
        show_width=width,
        show_height=height,
        frames=frames,
        layer_type=ac["layerType"],
        speed=ac["speed"],
    )


def weekday_kwargs(args: dict) -> dict:
    return {f"is_{day}_on": args[f"is{day.capitalize()}On"] for day in _DAYS}


def alarm_item_from_json(args: dict) -> AlarmItem:
    return AlarmItem(
        hour=args["hour"],
        minute=args["minute"],
        enable=args["enable"],
        duration=args["duration"],
        reminder_duration=args["reminderDuration"],
        is_never=args.get("isNever", False),
        **weekday_kwargs(args),
    )


def timer_item_from_json(args: dict) -> TimerSwitchItem:
    return TimerSwitchItem(
        hour=args["hour"],
        minute=args["minute"],
        enable=args["enable"],
        is_set_device_on=args["isSetDeviceOn"],
        is_never=args.get("isNever", False),
        **weekday_kwargs(args),
    )


def clock_content_from_json(cc: dict) -> ClockContent:
    return ClockContent(
        style_index=cc["styleIndex"],
        is_24_hour=cc["is24HourShowMode"],
        hour=segment_from(cc, "hour"),
        space_hour=segment_from(cc, "spaceHour"),
        minute=segment_from(cc, "minute"),
        space_minute=segment_from(cc, "spaceMinute"),
        seconds=segment_from(cc, "seconds"),
        ampm=segment_from(cc, "ampm"),
        is_blink_colon=cc["isSpaceShing"],
        show_date=cc["isDateShowMode"],
        reuse_space_after_minute=cc["showSpaceMinuteColor"],
        layer_type=cc["layerType"],
        show_time=cc["showTime"],
        num_height=cc["numHeight"],
        num_width=cc["numWidth"],
    )


def date_content_from_json(dc: dict) -> DateContent:
    return DateContent(
        show_space_year=dc["showSpaceYear"],
        show_space_month=dc["showSpaceMonth"],
        show_space_day=dc["showSpaceDay"],
        year=segment_from(dc, "year"),
        space_year=segment_from(dc, "spaceYear"),
        month=segment_from(dc, "month"),
        space_month=segment_from(dc, "spaceMonth"),
        day=segment_from(dc, "day"),
        space_day=segment_from(dc, "spaceDay"),
        week=segment_from(dc, "week"),
        layer_type=dc["layerType"],
        month_flag=dc["monthFlag"],
        show_time=dc["showTime"],
        num_height=dc["numHeight"],
        num_width=dc["numWidth"],
        year_num_height=dc["yearNumHeight"],
        year_num_width=dc["yearNumWidth"],
    )


def timecount_content_from_json(tc: dict) -> TimeCountContent:
    return TimeCountContent(
        mode=tc["timeCountMode"],
        hour=segment_from(tc, "hour"),
        space_hour=segment_from(tc, "spaceHour"),
        minute=segment_from(tc, "minute"),
        space_minute=segment_from(tc, "spaceMinute"),
        seconds=segment_from(tc, "seconds"),
        layer_type=tc["layerType"],
        num_height=tc["numHeight"],
        num_width=tc["numWidth"],
    )


def scoreboard_content_from_json(sc: dict) -> ScoreboardContent:
    return ScoreboardContent(
        host_score=segment_from(sc, "scoreHost"),
        visit_score=segment_from(sc, "scoreVisit"),
        host_total=segment_from(sc, "scoreTotalHost"),
        visit_total=segment_from(sc, "scoreTotalVisit"),
        minute=segment_from(sc, "minute"),
        space_minute=segment_from(sc, "spaceMinute"),
        seconds=segment_from(sc, "seconds"),
        layer_type=sc["layerType"],
        score_num_height=sc["scoreNumHeight"],
        score_num_width=sc["scoreNumWidth"],
        total_num_height=sc["scoreTotalNumHeight"],
        total_num_width=sc["scoreTotalNumWidth"],
        time_num_height=sc.get("timeNumHeight", 1),
        time_num_width=sc.get("timeNumWidth", 1),
    )


def temperature_content_from_json(tc: dict) -> TemperatureContent:
    return TemperatureContent(
        color=argb_to_rgb(tc["color"]),
        start_column=tc["startColumn"],
        start_row=tc["startRow"],
        width=tc["width"],
        height=tc["height"],
        layer_type=tc["layerType"],
        num_height=tc["numHeight"],
        num_width=tc["numWidth"],
    )


def humidity_content_from_json(hc: dict) -> HumidityContent:
    return HumidityContent(
        color=argb_to_rgb(hc["color"]),
        start_column=hc["startColumn"],
        start_row=hc["startRow"],
        width=hc["width"],
        height=hc["height"],
        layer_type=hc["layerType"],
        num_height=hc["numHeight"],
        num_width=hc["numWidth"],
    )


def frame_content_from_json(fc: dict) -> FrameContent:
    return FrameContent(
        frame_type=fc["frameType"],
        start_column=fc["startColumn"],
        start_row=fc["startRow"],
        show_width=fc["showWidth"],
        show_height=fc["showHeight"],
        frame_show_type=fc["frameShowType"],
        speed=fc["speed"],
        layer_type=fc["layerType"],
    )


def graffiti_content_from_json(gc: dict) -> GraffitiContent:
    width, height = gc["showWidth"], gc["showHeight"]
    return GraffitiContent(
        start_column=gc["startColumn"],
        start_row=gc["startRow"],
        show_width=width,
        show_height=height,
        pixels=frame_from_draw_items(gc["mDrawItems"], width, height),
        layer_type=gc["layerType"],
        mode=gc["mode"],
        speed=gc["speed"],
        stay_time=gc["stayTime"],
    )


def reminder_content_from_json(rc: dict) -> ReminderContent:
    return ReminderContent(
        remind_id=rc["remindId"],
        title=rc["title"],
        year=rc["year"],
        month=rc["month"],
        day=rc["day"],
        hour=rc["hour"],
        minute=rc["minute"],
        sound=rc["sound"],
        repeat_type=rc["repeatType"],
        duration=rc["duration"],
    )


def content_from_combine_program(cp: dict) -> Content:
    kind = cp["$type"]
    if kind == "ILedClockClockCombineProgram":
        return clock_content_from_json(cp["clockItem"]["clockProgramContent"])
    if kind == "ILedClockDateCombineProgram":
        return date_content_from_json(cp["dateItem"]["dateProgramContent"])
    if kind == "ILedClockScoreBoardCombineProgram":
        return scoreboard_content_from_json(cp["scoreBoardItem"]["scorBoardProgramContent"])
    if kind == "ILedClockTimeCountCombineProgram":
        return timecount_content_from_json(cp["timeCountItem"]["timeCountProgramContent"])
    if kind == "ILedClockFrameCombineProgram":
        return frame_content_from_json(cp["frameProgramContent"])
    if kind == "ILedClockReminderCombineProgram":
        return reminder_content_from_json(cp["item"]["content"])
    if kind == "ILedClockGraffitiCombineProgram":
        return graffiti_content_from_json(cp["graffitiItem"]["graffitiProgramContent"])
    if kind == "ILedClockAnimationCombineProgram":
        return animation_content_from_json(cp["animationItem"]["animationProgramContent"])
    raise ValueError(f"no test fixture builder for combine-program type {kind!r}")


def program_from_json(prog_json: dict) -> Program:
    contents = [content_from_combine_program(cp) for cp in prog_json["combinePrograms"]]
    return Program(
        contents=contents,
        show_count=prog_json["showCount"],
        is_clock_in_list=prog_json.get("isClockInProgramList", False),
        program_type=prog_json["programType"],
    )


def combined_program_from_vectors(vectors: list[dict]) -> Program:
    """The ``combined`` (FRAME+GRAFFITI+CLOCK) program shared by ``getDataForProgram``,
    ``getDataWithProgram``, and both direct ``getStartDataForProgram`` overload vectors
    (``ProgramEncoders.java:739-756``, ``fullProgramsAndResults``) -- their own ``bodyLength``
    args are informational only (``body.size()``, captured for debugging), NOT a synthetic
    hex-range buffer: the real CRC/length depend on this exact multi-content program's real
    bytes. Looked up from ``getDataForProgram``'s own vector rather than reconstructed by hand,
    so it can never silently drift from the real fixture."""
    for vector in vectors:
        if vector["fn"] == "getDataForProgram":
            return program_from_json(vector["args"]["program"])
    raise ValueError("no getDataForProgram vector found to source the shared 'combined' program")
