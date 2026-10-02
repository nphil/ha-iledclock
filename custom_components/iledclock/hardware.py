"""iLedClock 32x16 hardware & firmware capability profile.

Pure Python, **no `homeassistant` imports** (mirrors `protocol/`'s contract — this module
must import and unit-test standalone). Nothing here talks to a real device or to Home
Assistant; it is a static, evidence-graded description of what the hardware/firmware can
do, plus small pure functions the art-adaptation pipeline (`gallery/adapt.py`) and the
program builder need to target that hardware well.

Every non-obvious constant and every function's behaviour is graded and cited exactly like
`docs/HARDWARE.md` (read that file for the full narrative writeup this module implements):

    [DEVICE]    observed directly from the real clock's BLE replies
                (tests/live_replies_2026-09-25.json, docs/ARCHITECTURE.md's live captures).
    [VENDOR]    read directly in the decompiled CoolLED1248 v2.7.7 Java, cited as
                ``file.java:line``. Root: /data/home/tmp/led1248/src/sources/com/jtkj/led1248/.
    [VECTOR]    the [VENDOR] claim is additionally confirmed byte-for-byte by golden vectors
                produced by *running* that vendor bytecode on a JVM:
                /data/home/tmp/led1248/golden/vectors.json (cited as the vector's ``fn``).
    [INFERENCE] reasoned from the above but not directly observed. Never treated as fact;
                every [INFERENCE] below states its reasoning and, where it matters for art
                quality, is repeated as an open question in docs/HARDWARE.md with the exact
                live experiment that would upgrade or overturn it.

Device identity (for context, not re-derived here — owned by protocol/config_flow):
BLE local_name "iLedClock", manufacturer id 12692, advertised data
``bcdc070000011000200421`` = 6-byte id + height(1B)=0x10=16 + width(2B)=0x0020=32 +
colour-type(1B)=0x04 + firmware(1B)=0x21. [DEVICE] docs/ARCHITECTURE.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Mapping, Sequence

__all__ = [
    "ContentPath",
    "CURVED_PATHS",
    "LINEAR_PATHS",
    "HardwareProfile",
    "ILEDCLOCK_32x16",
    "ManufacturerGeometry",
    "derive_geometry_from_manufacturer_data",
    "rgb444_transfer",
    "rgb444_transfer_table",
    "encode_channel",
    "displayed_rgb",
    "power_limited",
    "power_limited_frame",
    "quantize_delay_ms",
    "device_delay_units",
    "DEVICE_MS_PER_DELAY_UNIT",
    "ANIMATION_MIN_FRAME_UNITS",
    "PLAYBACK_MAX_FPS",
    "PLAYBACK_MIN_FPS",
    "SMOOTH_MAX_FRAMES",
    "SMOOTH_TARGET_STEP_MS",
    "SMOOTH_MIN_STEP_MS",
    "rgb444_representative",
    "frame_budget",
    "NativeLayer",
    "NATIVE_LAYERS",
    "LayerModel",
    "LAYER_MODEL",
    "ROTATE_MODES",
    "estimate_lzss_ratio",
]


# ---------------------------------------------------------------------------
# Colour content paths
# ---------------------------------------------------------------------------
#
# The vendor app uses exactly two different RGB888->RGB444 encoders, and which one a given
# content type calls is fixed by content type, not configurable:
#
#   getColorDataWithColor(argb)                         -- plain "/16" truncating division.
#     [VENDOR light/emoji/TextEmojiManagerCoolLEDUX.java:386-394]
#       iRed = Color.red(i) / 16; iGreen = Color.green(i) / 16; iBlue = Color.blue(i) / 16
#     Called by CLOCK/DATE/TIMECOUNT/SCOREBOARD/TEMPERATURE/HUMIDITY content's per-field
#     solid colours (e.g. hourColor, minuteColor, scoreHostColor, ...).
#     [VENDOR light/utils/ILedClockUtils.java:3388,3401,3417,3422,3577,3582,4188,4193,4305,4330 (representative call sites)]
#
#   getColorDataWithColorWithRGB444Transfer(argb)        -- curved via rgb444Transfer().
#     [VENDOR light/emoji/TextEmojiManagerCoolLEDUX.java:396-414]
#     Called by: the global solid-colour command (setColor, opcode 0x13 0x01)
#     [VENDOR ILedClockUtils.java:5064-5069], TEXT custom-colour content, GRAFFITI pixel data
#     (getGraffitiData/getDrawListDataFColor), and ANIMATION pixel data (getAnimationData/
#     getAnimationDataColor) [VENDOR ILedClockUtils.java:3046,3190/3196(getDataWithGraffitiCombineProgram
#     call chain),3295/3041-3050(getAnimationDataColor)].
#     Confirmed identical for the animation and graffiti paths by direct code inspection
#     (both call the same TextEmojiManagerCoolLEDUX method) -- cross-confirmed independently
#     by ProtocolLib's own port (2026-09-26 hub coordination).
#
# The vendor's own GIF/image import pipeline (glide/DptLoadImage.java) does NOT apply either
# encoder at decode time -- it stores raw 8-bit ARGB straight into DrawItem.color
# [VENDOR light/emoji/TextEmojiManagerCoolLEDUX.java:549-562 getDrawItemsFromBitmap]. The
# curved transfer above is applied later, once, by the *same* shared encoder that also
# handles hand-drawn graffiti -- so an imported GIF's colours and a finger-painted graffiti's
# colours are quantized identically, just at different pipeline stages. There is no
# dithering anywhere in the vendor's own import pipeline (grep-confirmed absent from
# DptLoadImage.java and GifUtils.java).
ContentPath = Literal[
    "solid",  # setColor global command, opcode 0x13 0x01
    "text_custom",  # TEXT content, explicit per-character/segment colour
    "text_auto",  # TEXT content, autoColorType 1-28 pattern (pre-baked nibble tables, see NATIVE_LAYERS["text"])
    "graffiti",
    "animation",
    "clock",
    "date",
    "timecount",
    "scoreboard",
    "temperature",
    "humidity",
]

#: Content paths that quantize each channel through the curved `rgb444_transfer` table.
CURVED_PATHS: frozenset[str] = frozenset({"solid", "text_custom", "graffiti", "animation"})

#: Content paths that quantize each channel by plain truncating division by 16 (`v // 16`).
LINEAR_PATHS: frozenset[str] = frozenset(
    {"clock", "date", "timecount", "scoreboard", "temperature", "humidity"}
)

#: `text_auto` uses neither at encode time for OUR channel-by-channel purposes: its 28 modes
#: are pre-baked literal nibble-pair tables in the vendor source (ProtocolLib's
#: `protocol/color_tables.py` COLOR_TYPE_1..14, with 15-28 sharing one 3-colour literal per
#: [VENDOR ILedClockUtils.java colorType15-28 constants, all `"00,FF,0F,0F,0F,F0"`]) rather
#: than a per-pixel RGB888 input being quantized live. `encode_channel`/`displayed_rgb`
#: intentionally reject "text_auto" -- there is no RGB888 to quantize, only a mode index to
#: pick.


def rgb444_transfer(v: int) -> int:
    """Exact port of `TextEmojiManagerCoolLEDUX.rgb444Transfer(int)`.

    [VENDOR light/emoji/TextEmojiManagerCoolLEDUX.java:406-414]::

        public static int rgb444Transfer(int i) {
            if (i >= 238) return 15;
            if (i <= 47) return 0;
            return ((i - 47) / 14) + 1;
        }

    16 unequal steps over 0..255 (breakpoints at 0, 48, 61, 75, 89, 103, 117, 131, 145, 159,
    173, 187, 201, 215, 229, 238) -- NOT a uniform `v // 16`. [VECTOR]-cross-checked: the
    `adjustPower` and `setColor` golden vectors round-trip colours through this exact
    function; see tests/hardware/test_hardware.py.
    """
    if v >= 238:
        return 15
    if v <= 47:
        return 0
    return (v - 47) // 14 + 1


def rgb444_transfer_table() -> tuple[int, ...]:
    """The full 256-entry `rgb444_transfer` lookup table (documentation/test convenience;
    the vendor computes this algorithmically too, never as a literal 256-entry table, so
    `rgb444_transfer` above -- not this function -- is what `encode_channel` actually calls).
    """
    return tuple(rgb444_transfer(v) for v in range(256))


def encode_channel(v: int, path: ContentPath) -> int:
    """One RGB888 channel value (0-255) -> the 4-bit nibble (0-15) the wire protocol carries
    for `path`.

    - `path` in `CURVED_PATHS` -> `rgb444_transfer(v)` [VENDOR, see module docstring table above].
    - `path` in `LINEAR_PATHS` -> `v // 16` (plain truncating division, matches
      `Color.red(i) / 16` etc. in Java int division) [VENDOR TextEmojiManagerCoolLEDUX.java:386-394].

    Raises `ValueError` for `path` not in either set (including "text_auto", which has no
    per-channel encoding -- see `NATIVE_LAYERS["text"]`) or `v` outside 0..255.
    """
    if not 0 <= v <= 255:
        raise ValueError(f"channel value {v!r} out of range 0..255")
    if path in CURVED_PATHS:
        return rgb444_transfer(v)
    if path in LINEAR_PATHS:
        return v // 16
    raise ValueError(f"{path!r} has no per-channel RGB888 encoding (see NATIVE_LAYERS)")


def displayed_rgb(rgb: tuple[int, int, int], path: ContentPath) -> tuple[int, int, int]:
    """The RGB888 colour that will actually be shown on the LEDs for `path`, i.e. `rgb`
    round-tripped through the device's real 4-bit-per-channel quantization.

    Each channel is nibble-quantized via `encode_channel(v, path)` [VENDOR/VECTOR-graded,
    see above] and then re-expanded to 0..255 by bit replication (`nibble * 17`, so
    0->0 and 15->255 exactly, matching the standard 4-bit->8-bit expansion
    `(nibble << 4) | nibble`). This re-expansion step is [INFERENCE]: no vendor code needs
    to convert a nibble back to an 8-bit preview value (the app only ever goes
    RGB888->nibble, never back), so there is no vendor ground truth for exactly how bright
    each of the 16 levels looks on real LED hardware -- the LED driver's actual PWM response
    per nibble level could be non-linear. `n * 17` is the standard, most defensible choice
    for a *preview*; docs/HARDWARE.md lists the live photometry experiment that would
    confirm or replace it.
    """
    r, g, b = rgb
    nr, ng, nb = encode_channel(r, path), encode_channel(g, path), encode_channel(b, path)
    return (nr * 17, ng * 17, nb * 17)


# ---------------------------------------------------------------------------
# Power / current-budget limiting
# ---------------------------------------------------------------------------
#
# [VENDOR ILedClockUtils.java:5072-5086] (byte-identical sibling in CoolledUXUtils.java:5683-5697):
#
#   public static int adjustPower(int i, int i2) {
#       if (i2 <= 96) return i;
#       int iRed = Color.red(i), iGreen = Color.green(i), iBlue = Color.blue(i);
#       int i3 = iRed + iGreen + iBlue;
#       if (i3 <= 612) return i;
#       float f = 612.0f / i3;
#       return Color.rgb((int) (iRed * f), (int) (iGreen * f), (int) (iBlue * f));
#   }
#
# i.e. once "brightness" (i2, the app's 0-100-ish scale) exceeds 96, any single pixel whose
# R+G+B (0-255 each) sum exceeds 612 is scaled DOWN (uniformly across channels, preserving
# hue) until its sum is exactly 612. 612 is a literal, real LED current-budget constant --
# NOT derived from 255*3=765; it is exactly 80.0% of the theoretical max sum (765*0.8=612.0),
# i.e. "don't let full-white-equivalent current draw exceed 80% of max at high brightness".
# [VECTOR]-confirmed exactly by all 12 `adjustPower` golden vectors (white @ high brightness:
# 0xffffff -> 0xcccccc = (204,204,204), and 204/255=0.8 exactly; see test_hardware.py).
#
# adjustPowerGraffiti(list)/adjustPowerGraffiti(list,i)/adjustPowerAnimation(list,i)
# [VENDOR ILedClockUtils.java:3196-3230, byte-identical sibling CoolledUXUtils.java:3533-3567]
# apply the SAME per-pixel-average-612 budget but computed as one AGGREGATE sum over an
# entire frame (or, for animation, independently per frame) and then scale EVERY pixel in
# that frame by the same uniform factor -- i.e. size*612 is the frame's total RGB-sum budget,
# not a per-pixel clamp, so relative colour/brightness ratios within one frame are preserved
# (no per-pixel banding) but an animation's frames can visibly differ in overall dimming from
# each other if their lit-pixel counts differ (each frame's budget is evaluated independently).
#
# IMPORTANT, evidence-graded finding: grepping the ENTIRE decompiled source tree (not just
# light/) for `adjustPower(`, `adjustPowerGraffiti(`, `adjustPowerAnimation(` finds call
# sites ONLY inside these same three sibling methods calling each other (e.g.
# adjustPowerAnimation calling adjustPowerGraffiti per-frame). NO UI Activity/Fragment, no
# content encoder (getDataWithGraffitiCombineProgram, getDataWithAnimationCombineProgram,
# setColor, ...) calls any of them. [VENDOR]: these power-limiting functions exist and are
# byte-exact, but are NOT demonstrably wired into any real encode/upload path in this
# decompiled snapshot -- the app does not reliably protect the user's own hardware from an
# excessive current draw. `power_limited`/`power_limited_frame` below still implement the
# exact vendor arithmetic (it is a real, sound LED-current-budget concept worth applying
# proactively in OUR pipeline), but callers should not assume the vendor app -- or
# necessarily the firmware itself -- enforces it. docs/HARDWARE.md lists the live experiment
# (send unlimited-power full-white content at brightness>96 and see whether the DEVICE
# itself dims/protects) that would tell us whether firmware-side protection exists
# independently of this apparently-unused app-side code.

#: brightness threshold (exclusive) above which the 612 RGB-sum budget applies.
#: [VENDOR ILedClockUtils.java:5073, CoolledUXUtils.java:5684] `if (i2 <= 96) return i;`
POWER_LIMIT_BRIGHTNESS_THRESHOLD: int = 96

#: Per-pixel (and, aggregated, per-frame-average) R+G+B (each 0-255) budget once brightness
#: exceeds the threshold above. [VENDOR ILedClockUtils.java:5080,5083] `612`/`612.0f`.
POWER_LIMIT_RGB_SUM_BUDGET: int = 612


def power_limited(rgb: tuple[int, int, int], brightness: int) -> tuple[int, int, int]:
    """Exact port of the vendor `adjustPower(color, brightness)` per-pixel rule (see the
    section docstring above for full grading/citations). `brightness` is the app's 0-100-ish
    scale (matches `HardwareProfile.brightness_wire_min/max` below).

    `brightness <= 96`, or `sum(rgb) <= 612`: `rgb` is returned unchanged. Otherwise every
    channel is scaled down by `612 / sum(rgb)`, truncating toward zero exactly like Java's
    `(int)` cast (Python's `int()` on a non-negative float truncates identically).
    """
    r, g, b = rgb
    if brightness <= POWER_LIMIT_BRIGHTNESS_THRESHOLD:
        return rgb
    total = r + g + b
    if total <= POWER_LIMIT_RGB_SUM_BUDGET:
        return rgb
    f = POWER_LIMIT_RGB_SUM_BUDGET / total
    return (int(r * f), int(g * f), int(b * f))


def power_limited_frame(
    pixels: Sequence[tuple[int, int, int]], brightness: int
) -> list[tuple[int, int, int]]:
    """Exact port of the vendor `adjustPowerGraffiti(list, brightness)` whole-frame rule (see
    the section docstring above). Unlike `power_limited`, this evaluates ONE aggregate
    R+G+B budget of `len(pixels) * 612` across the whole frame and, if exceeded, scales
    EVERY pixel by the same uniform factor -- preserving each pixel's relative colour/
    brightness ratio, unlike calling `power_limited` per-pixel which can shift hue-neutral
    relationships between pixels of different individual brightness. Use this for a full
    animation frame or graffiti canvas; call it once per frame for a multi-frame animation
    (matches `adjustPowerAnimation`'s per-frame-independent behaviour) -- do not call it once
    across an entire animation's pixels concatenated together.
    """
    if brightness <= POWER_LIMIT_BRIGHTNESS_THRESHOLD or not pixels:
        return list(pixels)
    total = sum(r + g + b for r, g, b in pixels)
    budget = len(pixels) * POWER_LIMIT_RGB_SUM_BUDGET
    if total <= budget:
        return list(pixels)
    f = budget / total
    return [(int(r * f), int(g * f), int(b * f)) for r, g, b in pixels]


# ---------------------------------------------------------------------------
# Animation frame delay
# ---------------------------------------------------------------------------
#
# [VENDOR ILedClockUtils.java:3163-3175 getDataWithAnimationCombineProgram]: frame count is
# encoded as a raw 2-byte field (`getHexListStringForIntWithTwoByte(mListDrawItems.size())`);
# per-frame delay is ALSO a raw 2-byte field per frame, in the SAME units as the fallback
# uniform "speed" field (both flow through the identical `getHexListStringForIntWithTwoByte`
# call) -- if `delays` is non-empty each frame gets its own 2-byte delay value from that
# list; otherwise every frame repeats the single 2-byte `speed` value. The wire format itself
# enforces NO minimum and a 2-byte-field maximum of 65535.
#
# The UNIT is milliseconds: the vendor's own GIF-import path (glide/DptLoadImage.java,
# `decodeGifFrames`) obtains each frame's delay via Glide's `StandardGifDecoder.getDelay(i)`
# (Glide normalizes GIF's native centisecond delay to milliseconds) and floors it with
# `Math.max(delay, 20)` [VENDOR DptLoadImage.java:~994] before storing it directly (no further
# scaling) into the same `delays` list that flows straight into the 2-byte wire field above --
# so wire delay units are raw milliseconds, 1ms granularity, and the ONLY floor in evidence
# (20ms) is an app-side import convention, not a firmware-enforced or wire-format minimum.
# [INFERENCE]: whether the firmware can truly honour requested delays below 20ms (vs. having
# its own coarser real refresh/timer granularity) is unverified -- see docs/HARDWARE.md's
# open questions for the live experiment.

#: Wire field width for both frame count and per-frame delay. [VENDOR ILedClockUtils.java:3164,3167,3172]
ANIMATION_DELAY_FIELD_BYTES: int = 2
ANIMATION_FRAME_COUNT_FIELD_BYTES: int = 2

#: Hard wire-format range for a single frame's delay, in milliseconds (2-byte field: 0..65535).
ANIMATION_DELAY_WIRE_MIN_MS: int = 0
ANIMATION_DELAY_WIRE_MAX_MS: int = 65535

#: Our shortest real frame time. The vendor clamps GIF imports to 20 [VENDOR DptLoadImage.java
#: `Math.max(delay, 20)`], which is ~30 ms of real time on this clock (see below). 10 ms real is
#: the next value to confirm on hardware; lower it once measured.
ANIMATION_DELAY_PRACTICAL_FLOOR_MS: int = 10

#: Real time the firmware spends per unit of the per-frame delay field. [DEVICE] 2026-09-26, timed by
#: eye on the live clock: 8 frames x 125 -> ~1.5 s per loop and 32 frames x 20 -> ~1.0 s per loop,
#: i.e. ~1.5 ms per unit in both cases (a fixed per-frame overhead fits neither). So the field is
#: NOT milliseconds on this unit despite the vendor treating it as such: its GIFs play ~1.5x slow.
DEVICE_MS_PER_DELAY_UNIT: float = 1.5


def device_delay_units(real_ms: float) -> int:
    """Wire value for a frame that should stay on screen for `real_ms` of real time."""
    return max(1, min(ANIMATION_DELAY_WIRE_MAX_MS, round(real_ms / DEVICE_MS_PER_DELAY_UNIT)))


# ---------------------------------------------------------------------------
# Playback speed and smoothing limits (the per-design Speed slider, `retime.py`)
# ---------------------------------------------------------------------------
#
# All of these are calibration points for ONE real clock, judged by eye (docs/HARDWARE.md, "Live
# session 2026-09-26"), not facts of the firmware. Change a number here and the slider, the preview
# and the upload all follow, because `retime.py` reads nothing else.

#: Fewest delay units one frame may last. [DEVICE] 7 units = 10.5 ms real (~95 frames a second) is the
#: fastest setting seen to play smoothly. [DEVICE 2026-10-02] It is also the clock's real ceiling: a
#: 32-frame sweep at 4 units and at 1 unit per frame looked no faster than at 7, and one loop of the
#: sweep at 7 units (cyan) followed by the same sweep at 1 unit (red) showed both colours for about the
#: same time. So the slider's 100% ("Max") is exactly this; going lower gains nothing.
ANIMATION_MIN_FRAME_UNITS: int = 7

#: Pace of the Speed slider's 100% position, in frames a second, derived from the two constants above.
PLAYBACK_MAX_FPS: float = 1000.0 / (ANIMATION_MIN_FRAME_UNITS * DEVICE_MS_PER_DELAY_UNIT)

#: Pace of the slider's slowest position that still moves (position 0 is "Still", one picture).
PLAYBACK_MIN_FPS: float = 0.5

#: Most frames smoothing may leave in one animation. [VENDOR] the vendor's own animation editor stops
#: at 40 (ILedClockAnimationActivity.java:46,141-142); 32 full-panel frames were also verified live.
#: Authored designs may still hold up to `const.DESIGN_MAX_FRAMES`; only in-between frames respect this.
SMOOTH_MAX_FRAMES: int = 40

#: Longest a single step may stay on screen before smoothing adds in-between frames to cut it up (ms).
#: [INFERENCE] starting value; judge it by eye on the real LEDs (a ticker at 3 px a step: cut, shifted, crossfaded).
SMOOTH_TARGET_STEP_MS: int = 45

#: Shortest an in-between step may be (ms); finer steps would only flicker. [INFERENCE] as above.
SMOOTH_MIN_STEP_MS: int = 21


def rgb444_representative(nibble: int) -> int:
    """A 0-255 value that the curved transfer (`rgb444_transfer`) maps back to exactly `nibble`: the
    middle of that nibble's bin (0 and 15 map to the extremes). Frames that carry a colour the
    clock must show at a given nibble level (smoothing's fade steps) store this value, so the
    upload quantises them to exactly the level that was meant and the preview shows a colour from
    the same bin. Re-applying the curve to `n * 17` instead would NOT round-trip (17 -> 0)."""
    if not 0 <= nibble <= 15:
        raise ValueError(f"nibble {nibble!r} out of range 0..15")
    if nibble == 0:
        return 0
    if nibble == 15:
        return 255
    low = 48 + 14 * (nibble - 1)  # first value of this bin
    high = min(47 + 14 * nibble, 237)  # last value of this bin (238 and up is nibble 15)
    return (low + high + 1) // 2



def quantize_delay_ms(
    ms: float,
    *,
    floor_ms: int = ANIMATION_DELAY_PRACTICAL_FLOOR_MS,
    ceiling_ms: int = ANIMATION_DELAY_WIRE_MAX_MS,
) -> int:
    """Round `ms` to the device's real per-frame delay granularity (1ms, an integer 2-byte
    wire field [VENDOR, see section docstring above]) and clamp it to `[floor_ms, ceiling_ms]`.

    Defaults reproduce the vendor app's own behaviour exactly: `floor_ms=20` (its GIF-import
    convention, not a proven hardware floor -- pass `floor_ms=0` to use the bare wire-format
    minimum instead) and `ceiling_ms=65535` (the hard 2-byte field maximum).
    """
    if floor_ms < ANIMATION_DELAY_WIRE_MIN_MS or ceiling_ms > ANIMATION_DELAY_WIRE_MAX_MS or floor_ms > ceiling_ms:
        raise ValueError(f"invalid clamp range [{floor_ms}, {ceiling_ms}] for a 2-byte wire field")
    return max(floor_ms, min(ceiling_ms, round(ms)))


# ---------------------------------------------------------------------------
# Memory / transfer budget
# ---------------------------------------------------------------------------
#
# Wire cost per pixel is exactly 2 bytes, always, for any RGB444-encoded content path:
# `getColorDataWithColorWithRGB444Transfer`/`getColorDataWithColor` both return a 2-element
# hex-string list per call [VENDOR TextEmojiManagerCoolLEDUX.java:386-403]. A full 32x16
# frame is therefore exactly 32*16*2 = 1024 raw (pre-LZSS) bytes, plus small fixed per-content
# header/region overhead (~19-21 bytes for animation/graffiti: see
# getDataWithAnimationCombineProgram's 8-byte header + 1(layerType) + 8(region) + 1(reserved)
# + 2(frame count) [VENDOR ILedClockUtils.java:3149-3164]).
#
# Chunking (`getDataPacket(list, tag, packageSize)` [VENDOR ILedClockUtils.java:2509-2537],
# [VECTOR]-confirmed against 4 `getDataPacket(list,tag,size)` vectors): the LZSS-COMPRESSED
# byte stream (not raw) is split into groups of `packageSize` bytes; each chunk is wrapped as
# `tag(1B) + total_compressed_len(4B BE) + chunk_index(2B BE) + chunk_len(2B BE) + chunk_bytes
# + xor_checksum(1B)` [VENDOR ILedClockUtils.java:2523-2534, `convertEnd` at 2446-2453 is a
# running XOR over every byte from the length field onward], then that whole packet is
# 01/03-framed and escaped like every other command. All multi-byte fields here are
# BIG-ENDIAN -- confirmed by direct read of `LightUtils.getHexListStringForIntWithFourByte`/
# `WithTwoByte` (most-significant substring emitted first) [VENDOR LightUtils.java:199-222,
# 291-339] -- this corrects an older project note (docs/FEATURES-app.md) that guessed
# little-endian.
#
# `packageSize` itself: [VENDOR DeviceManager.java:4594-4607] read from the 0x1f device-info
# reply bytes 19-20 (big-endian 2-byte) IF the reply has exactly 21 fields; clamped back to
# the 1024 default if the reported value is 0 or > 4096. Our live device's reply has 24
# fields (not 21), so this branch never fires for it and it silently defaults to 1024 --
# [DEVICE] tests/live_replies_2026-09-25.json `device_info`.
#
# LZSS compression ratio is highly content-dependent -- measured directly from the 5 golden
# `LzssCompress.getLzssCompressData` test corpora (not pixel-representative, but the only
# real vendor-algorithm measurements available): 100 zero bytes -> 13 compressed (~7.7x
# smaller); 5000 bytes of a 2-byte repeating pattern -> 593 compressed (~8.4x smaller); 1000
# bytes of PRNG-random data -> 1125 compressed (~1.125x *larger* -- LZSS has no fallback to
# store-uncompressed on incompressible input). Real pixel art usually has large flat-colour
# runs and repeated 2-byte RGB444 pairs, so the two repetitive-data measurements are a much
# better proxy for it than the random-data one; treat ~4-8x compression as a reasonable
# planning assumption for pixel art specifically, but see docs/HARDWARE.md for the live
# experiment that would measure it directly on real art.

#: Wire bytes per RGB444-encoded pixel (always 2, any content path). [VENDOR, see above]
BYTES_PER_PIXEL_WIRE: int = 2

#: Default/fallback compressed-data chunk size in bytes. [VENDOR ILedClockUtils.java:2539-2567,
#: DeviceManager.java:4598,4601,4604] `ILedClock_PACKAGE_SIZE = 1024`.
PACKAGE_SIZE_DEFAULT: int = 1024

#: Valid range the device may report for its own negotiated package size before the app
#: falls back to the default above. [VENDOR DeviceManager.java:4597,4600] (0 or >4096 -> default).
PACKAGE_SIZE_MIN: int = 1
PACKAGE_SIZE_MAX: int = 4096

#: [INFERENCE] No hard maximum total compressed-program-byte-count was found anywhere in the
#: decompiled app (no pre-upload size check; `getDataResult` only returns null if LZSS
#: compression itself fails on empty input) or in any live reply. This default is a
#: deliberately conservative planning number, NOT vendor-confirmed: 64 frames worth of a
#: full 32x16 raw (pre-compression) frame (64 * 1024 = 65536 bytes), chosen only because it
#: is the same order of magnitude as the JieLi AC695x's likely small-MCU RAM budget (a
#: Bluetooth-audio SoC repurposed to drive this display -- no public datasheet with an exact
#: RAM figure was found). Callers with a real measured ceiling (see docs/HARDWARE.md's live
#: experiment: binary-search the largest program the device accepts) should pass
#: `max_program_bytes` explicitly to `frame_budget` rather than relying on this default.
DEFAULT_MAX_PROGRAM_BYTES_ESTIMATE: int = 65536


def estimate_lzss_ratio(kind: Literal["repetitive", "random"] = "repetitive") -> float:
    """A rough compression-ratio multiplier (compressed_size / original_size) measured
    directly from the vendor LZSS implementation's own golden-vector test corpora
    [VECTOR LzssCompress.getLzssCompressData, 5000-byte/1000-byte corpora] -- see the
    section docstring above for the exact numbers and caveats. `"repetitive"` (the default,
    ~0.119, i.e. ~8.4x smaller) is the better proxy for real pixel art; `"random"` (~1.125,
    i.e. LZSS makes it slightly *larger*) is the pathological worst case for high-entropy
    content such as photographic dithering or noise-based generative animations.
    """
    if kind == "repetitive":
        return 593 / 5000
    if kind == "random":
        return 1125 / 1000
    raise ValueError(f"unknown kind {kind!r}")


def frame_budget(
    bytes_per_frame_estimate: int,
    *,
    max_program_bytes: int = DEFAULT_MAX_PROGRAM_BYTES_ESTIMATE,
) -> int:
    """How many frames of (uncompressed, wire-format) size `bytes_per_frame_estimate` each
    can fit under a `max_program_bytes` total budget. Always returns at least 1.

    `bytes_per_frame_estimate` should be your own per-frame byte estimate -- for a full
    32x16 RGB444 frame that is `32 * 16 * BYTES_PER_PIXEL_WIRE` (+ a small fixed per-content
    header, ~19-21 bytes, see section docstring) plus `ANIMATION_DELAY_FIELD_BYTES` for its
    delay entry; for a smaller composited region (e.g. an icon placed beside a native clock
    layer) use that region's own pixel count instead.

    `max_program_bytes` defaults to `DEFAULT_MAX_PROGRAM_BYTES_ESTIMATE`, which is
    [INFERENCE]-graded, not a vendor-confirmed hardware limit -- see that constant's
    docstring. This function does NOT itself apply LZSS compression headroom; if you want
    credit for compression, shrink `bytes_per_frame_estimate` by `estimate_lzss_ratio(...)`
    first (or pass a larger `max_program_bytes`), since the real per-program byte ceiling
    (whatever it turns out to be) is almost certainly enforced against the compressed size,
    not the raw pixel size (`getDataResult` LZSS-compresses before chunking).
    """
    if bytes_per_frame_estimate <= 0:
        raise ValueError("bytes_per_frame_estimate must be positive")
    if max_program_bytes <= 0:
        raise ValueError("max_program_bytes must be positive")
    return max(1, max_program_bytes // bytes_per_frame_estimate)


# ---------------------------------------------------------------------------
# Rotate / mirror
# ---------------------------------------------------------------------------
#
# `getSetMirror(boolean)` and `setRotate(int)` write the SAME wire opcode, "0c"
# [VENDOR ILedClockUtils.java:4756-4764, 5057-5062] -- `mirror(on)` is sugar for
# `rotate(1 if on else 0)`, not an independent physical axis. Mode meanings
# [VENDOR light/iledclock/ILedClockRotateActivity.java, 4 RadioItems: rotate_display_no=0,
# rotate_display_xy=1, rotate_display_x=2, rotate_display_y=3]:
ROTATE_MODES: Mapping[int, str] = {
    0: "none",
    1: "xy-flip (both axes, i.e. 180-degree rotation)",
    2: "x-flip (horizontal mirror)",
    3: "y-flip (vertical mirror)",
}


# ---------------------------------------------------------------------------
# Manufacturer-data geometry derivation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ManufacturerGeometry:
    """Fields the vendor app itself derives from a BLE scan record's manufacturer-specific
    data payload, in this exact byte layout. [VENDOR DeviceManager.java:9885-9899]::

        public static int getDeviceRow(byte[] bArr) {
            return Integer.parseInt(LightUtils.getHexStringForInt(bArr[17] & 255), 16);
        }
        public static int getDeviceColumn(byte[] bArr) {
            return Integer.parseInt(
                LightUtils.getHexStringForInt(bArr[18] & 255)
                + LightUtils.getHexStringForInt(bArr[19] & 255), 16);
        }

    i.e. within the full BLE scan record (not just the manufacturer-data AD structure's own
    payload), byte 17 is the row/height count and bytes 18-19 are a big-endian 2-byte
    column/width count. [DEVICE]-cross-validated: our device's manufacturer payload
    `bcdc070000011000200421` (6-byte id + height + width(2B) + colour-type + firmware) has
    height at its own byte index 6 and width at indices 7-8, which is self-consistent with
    scan-record offsets 17 and 18-19 once you account for the fixed-length AD structures
    (flags, local name) that precede the manufacturer-data AD structure in a real scan
    record. `derive_geometry_from_manufacturer_data` below operates on the manufacturer
    PAYLOAD directly (offsets 6, 7-8, 9, 10), matching the byte breakdown already documented
    in docs/ARCHITECTURE.md, not on a full raw scan record.
    """

    height: int
    width: int
    colour_type: int
    firmware_version: int


def derive_geometry_from_manufacturer_data(payload: bytes) -> ManufacturerGeometry:
    """Decode an 11-byte iLedClock manufacturer-data payload (company id 12692's own data,
    i.e. `bcdc070000011000200421` for our device -- NOT the full scan record, see
    `ManufacturerGeometry`'s docstring for the offset reconciliation) into
    `(height, width, colour_type, firmware_version)`.

    Layout, [DEVICE]-confirmed against our exact device
    (`bcdc07000001` + `10` + `0020` + `04` + `21`) and consistent with
    `DeviceManager.getDeviceRow`/`getDeviceColumn`'s big-endian, height-then-width field
    order [VENDOR DeviceManager.java:9885-9899]: 6-byte opaque id, 1-byte height, 2-byte
    big-endian width, 1-byte colour type, 1-byte firmware version = 11 bytes total.

    Note: for a device whose advertised BLE name matches "iLedClock" specifically, the app
    does NOT actually read the colour-type byte decoded here to set
    `COOL_LED_DEVICE_COLOR_TYPE` -- it hardcodes `= 4` purely from the name match
    [VENDOR DeviceManager.java ~line 1017, `else if (name.equalsIgnoreCase(ILED_CLOCK)) { ...
    COOL_LED_DEVICE_COLOR_TYPE = 4; ... }`]. The byte this function returns as
    `colour_type` is real advertised data (and happens to equal 4 for our device too), but
    treat it as corroborating evidence, not as the mechanism the app itself relies on.
    """
    if len(payload) != 11:
        raise ValueError(f"expected an 11-byte iLedClock manufacturer-data payload, got {len(payload)} bytes")
    height = payload[6]
    width = (payload[7] << 8) | payload[8]
    colour_type = payload[9]
    firmware_version = payload[10]
    return ManufacturerGeometry(height=height, width=width, colour_type=colour_type, firmware_version=firmware_version)


# ---------------------------------------------------------------------------
# The capability profile
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HardwareProfile:
    """Frozen capability profile for this exact device (32x16, colour type 4). Every field
    is graded and cited either inline below or, for the larger topics, in the module-level
    section docstrings above (colour, power, delay, transfer) which this dataclass's fields
    summarize as flat constants for convenient consumption.
    """

    # --- Geometry --- [DEVICE]+[VENDOR], see `derive_geometry_from_manufacturer_data`.
    width: int = 32
    height: int = 16
    colour_type: int = 4  # COOL_LED_COLORFUL_ILED_CLOCK [VENDOR DeviceManager.java ~1017]
    colour_bits_per_channel: int = 4  # RGB444
    bytes_per_pixel_wire: int = BYTES_PER_PIXEL_WIRE

    # --- Identity / transport --- [DEVICE] docs/ARCHITECTURE.md live captures.
    firmware_soc: str = "JieLi AC695x"
    firmware_version_observed: int = 0x21  # 33 decimal; confirmed in BOTH manufacturer data
    #   byte 10 AND the 0xfd OTA reply's bytes[2:4] (0x0021) [DEVICE]-cross-validated.
    ble_service_uuid: str = "0000fff0-0000-1000-8000-00805f9b34fb"
    ble_char_uuid: str = "0000fff1-0000-1000-8000-00805f9b34fb"  # write-without-response + notify

    # --- Programs / storage ---
    #: [DEVICE] our unit's 0x1f device-info reply byte[8] (`maxProgramNumber`) = 9.
    #: [VENDOR DeviceManager.java:4590] `ILedClockManager.maxProgramNumber = Integer.parseInt(list.get(8), 16);`
    max_programs: int = 9
    package_size_default: int = PACKAGE_SIZE_DEFAULT
    package_size_min: int = PACKAGE_SIZE_MIN
    package_size_max: int = PACKAGE_SIZE_MAX

    # --- Brightness --- [VENDOR ILedClockSettingsFragment.java + ILedClockUtils.java:4749-4754]
    #: Brightness byte range (opcode 0x04). The vendor UI seekbar only offers 5-100, but the
    #: firmware keeps getting brighter to 255: [DEVICE] compared by eye on the live clock
    #: 2026-09-26, 100 < 163 < 255 (the unit had been left at 163, which is how this surfaced).
    brightness_wire_min: int = 5
    brightness_wire_max: int = 255
    #: [DEVICE] our unit's 0x1f reply reported brightness byte = 0xa3 = 163, OUTSIDE the
    #: 5-100 SET range above -- an unresolved, evidence-flagged inconsistency (the byte is
    #: assigned unconditionally by `ILedClockManager.brightNess = list[2]`
    #: [VENDOR DeviceManager.java:4584], so the DECODE is certain; whether the *reported*
    #: value uses the same units as the *set* value is not). See docs/HARDWARE.md open
    #: questions.
    power_limit_brightness_threshold: int = POWER_LIMIT_BRIGHTNESS_THRESHOLD
    power_limit_rgb_sum_budget: int = POWER_LIMIT_RGB_SUM_BUDGET

    # --- Audio --- [DEVICE]+[VENDOR light/iledclock/ILedClockVolumeActivity.java:54-59, 6 items 0-5]
    volume_min: int = 0
    volume_max: int = 5  # [DEVICE] live volume=5 is exactly the observed max, consistent.

    # --- Rotate/mirror --- see ROTATE_MODES above.
    rotate_modes: Mapping[int, str] = field(default_factory=lambda: dict(ROTATE_MODES))

    # --- Animation ---
    animation_delay_field_bytes: int = ANIMATION_DELAY_FIELD_BYTES
    animation_frame_count_field_bytes: int = ANIMATION_FRAME_COUNT_FIELD_BYTES
    animation_delay_wire_min_ms: int = ANIMATION_DELAY_WIRE_MIN_MS
    animation_delay_wire_max_ms: int = ANIMATION_DELAY_WIRE_MAX_MS
    animation_delay_practical_floor_ms: int = ANIMATION_DELAY_PRACTICAL_FLOOR_MS
    #: [VENDOR] no maximum frame COUNT constant/check found anywhere in DptLoadImage.java's
    #: GIF decode loop (`for (i=0; i<getFrameCount(); i++)`, unconditional) or in the
    #: animation content encoder; the field width above (2 bytes) is the only hard ceiling
    #: (65535 frames), itself far beyond any practical transfer/memory budget. Use
    #: `frame_budget()` for a byte-budget-driven practical estimate instead of a frame-count
    #: constant.
    animation_frame_count_hard_field_limit: int = 65535
    #: Vendor GIF-import resize pipeline: aspect-ratio-preserving pass uses nearest-neighbor
    #: (`Bitmap.createScaledBitmap(..., false)`), then a final exact-size pass uses bilinear
    #: (`Bitmap.createScaledBitmap(..., true)`) [VENDOR glide/DptLoadImage.java:1063-1080].
    #: No dithering anywhere (grep-confirmed absent). Documented here for reference; this
    #: module does not re-implement image resizing (that is `gallery/adapt.py`'s job).
    import_resize_aspect_pass: str = "nearest-neighbor"
    import_resize_final_pass: str = "bilinear"
    import_pipeline_has_dithering: bool = False

    # --- Clock faces / text --- see NATIVE_LAYERS["clock"]/["text"] for full detail.
    clock_style_count: int = 41  # [VENDOR] exactly 41 distinct `styleNNumberData1632` constants, N=1..41 contiguous.
    clock_named_colour_count: int = 8  # red/magenta/yellow/green/cyan/blue/white/black
    text_auto_colour_mode_count: int = 28  # TEXT content's own autoColorType, NOT the global setColorMode command below.
    text_font_sizes_px: tuple[int, ...] = (12, 14, 16)
    #: The GLOBAL solid-colour effect command (opcode 0x13 0x03, `setColorMode`) is a
    #: DIFFERENT enumeration from text_auto_colour_mode_count above -- do not conflate them.
    #: [VENDOR] accepts i in 0..32; 30 distinct colorModeN tables are named in source
    #: (colorMode1-31, colorMode3 is never defined); a confirmed real vendor bug collapses
    #: every i>=11 to one of 3 shared dead-end tables (golden/README.md's `setColorMode`
    #: control-flow analysis, independently mechanically verified twice) -- so only modes
    #: 1-10 are meaningfully distinct in practice, despite 30 tables existing in source.
    global_color_mode_count_distinct_in_practice: int = 10
    global_color_mode_count_nominal: int = 30

    # --- Border/frame --- [VENDOR color_tables.py FRAME_TYPE, ported by ProtocolLib from
    #: the vendor's `frameType` 1-20 dispatch in `getDataWithFrameProgramContent`]
    border_pattern_count: int = 20

    # --- Sensors / mic / buttons ---
    #: [VENDOR light/iledclock/ILedClockTemperatureAndHumidityActivity.java is an empty
    #: stub -- no onCreate, no UI, no sensor-presence flag anywhere in decompiled code.
    #: [DEVICE] live query `19 01` -> reply `19 01 00 00 00` (temp=0, temp_frac=0,
    #: humidity=0); live query `19 00` -> NO REPLY AT ALL (device silently ignores it).
    #: Zero readings plus a silently-ignored alternate sub-command together are strong,
    #: though not 100%-conclusive, evidence this unit has no working temperature/humidity
    #: sensor.
    has_temperature_humidity_sensor: bool | None = False  # best-evidence answer; see caveat above
    #: [VENDOR] `MicManager.startRecording()` + `RECORD_AUDIO` permission requested
    #: [ILedClockMicFragment.java] -- a real onboard microphone feeds "rhythm" mode. Only a
    #: byte-array frequency-spectrum summary crosses BLE (opcode 0x01), never raw PCM audio
    #: [VENDOR `getMusicDataString`, ILedClockUtils.java:4819-4825].
    has_microphone: bool = True
    rhythm_type_count: int = 5
    #: [VENDOR] grep for KeyEvent/onKeyDown/onKeyUp/onKeyLongPress across all 98
    #: light/iledclock/*.java files finds only software-IME editor-action handling in text
    #: input dialogs, never a physical device button/key. Control is BLE-only.
    has_physical_buttons: bool = False


#: The capability profile for this exact device (32x16, colour type 4, fw 0x21 observed).
ILEDCLOCK_32x16 = HardwareProfile()


# ---------------------------------------------------------------------------
# Content / layer model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NativeLayer:
    """One firmware-native content type that can be composed with uploaded art as an
    independent layer within a single program slot (see `LayerModel` below for how
    composition itself works). Field grading: every `NativeLayer` instance below cites its
    own evidence inline in `NATIVE_LAYERS`'s construction; this class only documents what
    each field means.
    """

    content_type_id: int  # dispatch value in getDataForCombineProgram's ILedClockCombineProgram.getType()
    name: str
    default_layer_type: int  # observed default `layerType` field value (0 or 1 in every content type found)
    has_region: bool  # startColumn/startRow/showWidth/showHeight (or equivalent per-subfield geometry) present
    colour_encoding: Literal["linear", "curved", "pre-baked", "none"]
    renders_from_device_state: bool  # shows live device-tracked data (clock/timer/sensor) at zero re-upload cost
    max_instances: int | None  # vendor-documented cap on how many of these can exist (e.g. reminders); None = no cap found
    param_ranges: Mapping[str, str]
    notes: str


#: Firmware-native content types the device can render entirely on its own -- the payload
#: uploaded once describes *parameters* (a clock style index, a countdown target, a
#: temperature-display format), and the firmware itself keeps the displayed value current
#: with zero further BLE traffic. These are exactly the layers `gallery/adapt.py` should
#: prefer composing WITH art (e.g. a small icon region beside a live clock layer) instead of
#: replacing with a fully-rendered, non-live approximation.
#:
#: Content-type dispatch table (the `getType()` values below) [VENDOR
#: ILedClockUtils.java:4378-4504 `getDataForCombineProgram`]. `layerType` defaults observed
#: directly on each content dataclass in `light/device/ILedClockManager.java`: every content
#: type examined defaults to exactly 0 or 1, never anything else -- read as roughly
#: base-layer(0) vs. overlay-layer(1) by pattern (CLOCK/TEMPERATURE/SCOREBOARD/HUMIDITY
#: default 0; DATE/TIMECOUNT/TEXT/ANIMATION/GRAFFITI/GIF default 1), but the exact
#: compositing/transparency rule between a 0-layer and a 1-layer sharing overlapping regions
#: is UNCONFIRMED -- see `LAYER_MODEL.z_order_semantics` and docs/HARDWARE.md open questions.
NATIVE_LAYERS: dict[str, NativeLayer] = {
    "clock": NativeLayer(
        content_type_id=7,
        name="Clock",
        default_layer_type=0,  # [VENDOR ILedClockManager.java:110]
        has_region=True,  # per-sub-group (hour/spaceHour/minute/spaceMinute/seconds/ampm), not one box
        colour_encoding="linear",
        renders_from_device_state=True,
        max_instances=None,
        param_ranges={
            "styleIndex": "1-41 [VENDOR: exactly 41 distinct styleNNumberData1632 constants, "
            "N=1..41 contiguous, ILedClockUtils.java:112-... ; hardcoded to DEVICE_ROW==16 && "
            "DEVICE_COLUMN==32, no fallback table for any other geometry]",
            "colourIndex": "0-7 [VENDOR ILedClockClockTimeActivity.java:121-128: red(0xff0000)/"
            "magenta(0xff00ff)/yellow(0xffff00)/green(0x00ff00)/cyan(0x00ffff)/blue(0x0000ff)/"
            "white/black, in that order -- corrects a sibling scout finding of '7 colours, no "
            "black' sourced from light/coolledux/DiscoverClockActivity.java, which is the "
            "OLDER sibling CoolledUX product's generic screen, not this device's own "
            "ILedClockClockTimeActivity/Fragment]",
            "hourMode": "24h / 12h+AM-PM, plus independent date-show and seconds-show flags "
            "[VENDOR ILedClockUtils.java:3367-3369 is24HourShowMode/isDateShowMode/isSpaceShing]",
        },
        notes="Digit glyphs for style 10 (representative sample) are 6 bytes/digit x 10 "
        "digits = 60 bytes total [VENDOR style10NumberData1632]; each byte is one 8-pixel "
        "bitmap row, so each digit glyph is 8px wide -- exact glyph pixel HEIGHT (how many "
        "of the 6 bytes/digit are real rows vs. padding) was not independently confirmed "
        "pixel-by-pixel; treat as approximate. Hour/minute/second/ampm groups each carry "
        "their OWN startColumn/startRow/width/height, so the clock's digits can be confined "
        "to less than the full 32x16 panel, leaving the remaining columns free for another "
        "content layer placed via its own disjoint region (confirmed structurally: "
        "`ILedClockProgram.combinePrograms` is a List, `getDataForProgram` concatenates every "
        "member's encoding [VENDOR ILedClockManager.java:888, ILedClockUtils.java:4506-4513]) "
        "-- exact minimum practical column width per style is an open question, see "
        "docs/HARDWARE.md.",
    ),
    "date": NativeLayer(
        content_type_id=6,
        name="Date",
        default_layer_type=1,  # [VENDOR ILedClockManager.java:190]
        has_region=True,
        colour_encoding="linear",
        renders_from_device_state=True,
        max_instances=None,
        param_ranges={"monthFlag": "0/1 [VENDOR]", "showTime": "display duration, default 5 [VENDOR ILedClockManager.java:192]"},
        notes="Succeeds at both 16x32 and 32x128 geometries in the golden harness (more "
        "defensive per-geometry tables than Clock/TimeCount, which hard-throw off-geometry) "
        "[VECTOR golden/README.md 'Device-geometry-gated quirks' section].",
    ),
    "timecount": NativeLayer(
        content_type_id=8,
        name="Countdown / time-count",
        default_layer_type=1,  # [VENDOR ILedClockManager.java:409]
        has_region=True,
        colour_encoding="linear",
        renders_from_device_state=True,
        max_instances=None,
        param_ranges={
            "timeCountMode": "1=? [VENDOR default seen, exact enumeration of modes not fully traced]",
            "hours": "0-23, minutes/seconds 0-59 [VENDOR light/iledclock/ILedClockCountdownActivity.java LoopView ranges]",
        },
        notes="Like Clock, hard-coded to DEVICE_ROW==16 && DEVICE_COLUMN==32 with no "
        "fallback [VECTOR golden/README.md] -- fine for us, this IS our geometry.",
    ),
    "scoreboard": NativeLayer(
        content_type_id=11,
        name="Scoreboard",
        default_layer_type=0,  # [VENDOR ILedClockManager.java:336]
        has_region=True,
        colour_encoding="linear",
        renders_from_device_state=True,
        max_instances=None,
        param_ranges={
            "score": "no hard max found [VENDOR/INFERENCE: incremented by device-side gesture/command, no UI clamp]",
            "minutes": "0-99, seconds 0-59 [VENDOR light/iledclock/ILedClockScoreBoardTimeDialog.java LoopView ranges]",
            "timerMode": "count-up / count-down [VENDOR]",
        },
        notes="[DEVICE] live query returned an all-zero idle state (no game in progress) -- "
        "confirms the opcode round-trips cleanly on our unit.",
    ),
    "temperature": NativeLayer(
        content_type_id=17,
        name="Temperature",
        default_layer_type=0,
        has_region=True,
        colour_encoding="linear",
        renders_from_device_state=True,
        max_instances=None,
        param_ranges={},
        notes="No confirmed onboard sensor on this unit -- see "
        "HardwareProfile.has_temperature_humidity_sensor. The CONTENT TYPE and its wire "
        "encoding are real and fully specified [VENDOR ILedClockUtils.java:4297-4310] "
        "regardless of whether live sensor data ever populates it; composing it as a layer "
        "would show whatever the app itself would push into that field (likely a static/"
        "manual value on this unit, not live ambient temperature).",
    ),
    "humidity": NativeLayer(
        content_type_id=18,
        name="Humidity",
        default_layer_type=0,
        has_region=True,
        colour_encoding="linear",
        renders_from_device_state=True,
        max_instances=None,
        param_ranges={},
        notes="Same caveat as temperature -- see HardwareProfile.has_temperature_humidity_sensor.",
    ),
    "text": NativeLayer(
        content_type_id=3,
        name="Text",
        default_layer_type=1,  # [VENDOR ILedClockManager.java:1197/1232 TextContent/TextAutoColor default]
        has_region=True,
        colour_encoding="curved",  # custom-colour path; autoColorType path is "pre-baked" (see note)
        renders_from_device_state=False,  # static content, though it animates on-device (scroll/colour-cycle) once uploaded
        max_instances=None,
        param_ranges={
            "autoColorType": "1-28 pre-baked colour-cycle patterns [VENDOR/VECTOR "
            "ILedClockUtils.java colorType1-28 + ProtocolLib's protocol/color_tables.py "
            "COLOR_TYPE_1..14; 15-28 share one 3-colour literal '00,FF,0F,0F,0F,F0']; "
            "DISTINCT from the global setColorMode command's own 1-32 enumeration -- see "
            "HardwareProfile.global_color_mode_count_* , do not conflate the two",
            "fontSizePx": "12, 14, or 16 [VENDOR light/iledclock/ILedClockTextFontSizeDialog.java]",
            "speed": "0-255 raw scroll-speed byte [VENDOR, exact ms-per-step not traced]",
        },
        notes="On-device fonts: UNICODE12/UNICODE12_BOLD/UNICODE16/UNICODE16_BOLD binary "
        "glyph blobs plus device-specific 32_16_large/32_16_small blobs exist in "
        "base/assets/ [VENDOR asset survey], format not reverse-engineered (not needed: "
        "text rendering for uploaded art goes through our OWN font rasterizer in "
        "protocol/render.py, not the device's). Custom-colour text (per-character explicit "
        "RGB) uses the CURVED transfer, same as graffiti/animation "
        "[VENDOR ILedClockUtils.java:3046].",
    ),
    "frame": NativeLayer(
        content_type_id=4,
        name="Border / frame",
        default_layer_type=0,  # [VENDOR getDataWithFrameProgramContent field default pattern]
        has_region=True,
        colour_encoding="pre-baked",
        renders_from_device_state=False,
        max_instances=None,
        param_ranges={
            "frameType": "1-20 built-in patterns [VENDOR/VECTOR: ProtocolLib's "
            "protocol/color_tables.py FRAME_TYPE dict, ported from getDataWithFrameProgramContent's "
            "frameType 1-20 dispatch; golden vectors cover frameType 1/8/15/20]",
            "frameShowType": "static vs. animated border effect [VENDOR, exact enum not fully traced]",
            "speed": "0-255 raw [VENDOR]",
        },
        notes="A decorative border/frame drawn around (or independent of) other content -- "
        "genuinely composable with art as a 'frame around the icon' layer.",
    ),
    "dynamic_text": NativeLayer(
        content_type_id=16,
        name="Dynamic text",
        default_layer_type=1,
        has_region=True,
        colour_encoding="curved",  # composed of an ANIMATION sub-content internally
        renders_from_device_state=False,
        max_instances=None,
        param_ranges={},
        notes="[VENDOR ILedClockUtils.java:4464-4498] Internally builds a synthetic "
        "ILedClockAnimationProgramContent from a background-animation sub-item plus a "
        "dynamic-text-image sub-item -- i.e. this is a composite of Animation + Frame under "
        "one content-type id, not a distinct rendering path. showHeight==14 is special-cased "
        "to 16 [VENDOR line 4483-4487], a vendor quirk worth preserving if this content type "
        "is ever built by our own program encoder.",
    ),
    "reminder": NativeLayer(
        content_type_id=14,
        name="Reminder",
        default_layer_type=0,
        has_region=False,  # a notification, not a spatial content region
        colour_encoding="none",
        renders_from_device_state=True,
        max_instances=16,  # [VENDOR light/iledclock/ILedClockReminderActivity.java:198-202]
        param_ranges={
            "id": "random 1-16, unique per active reminder [VENDOR generateRandomNotInList()]",
            "repeatType": "0=never / 1=every_day / 2=every_week / 3=every_month / 4=every_year "
            "[VENDOR light/iledclock/ILedClockReminderRepeatDialog.java RepeatItem ids]",
        },
        notes="A scheduled alarm stored in the clock's own reminder slots, so it rings without "
        "Home Assistant. It IS art-composable: the vendor app uploads a reminder content "
        "(tag 13) followed by graffiti/animation contents in the same type-14 program, and "
        "the start frame carries the trailer `05 <id>`. Ids are picked from 1-16 not already "
        "in use [VENDOR light/iledclock/ILedClockReminderActivity.java:210-224]. Repeat is a "
        "type 0-4 (once / daily / weekly / monthly / yearly); the weekday-mask byte is derived "
        "from the type unless set explicitly [VENDOR ILedClockUtils.java:4344-4375]. Read with "
        "opcode 1a 01/02 and deleted with 1a 03; the integration creates and edits them too.",
    ),
}


@dataclass(frozen=True)
class LayerModel:
    """How multiple content items compose within one uploaded program. Grading: see the
    inline field comments; every claim here is repeated with full citations in
    docs/HARDWARE.md's Content/layer model section.
    """

    #: [VENDOR ILedClockManager.java:888] `ILedClockProgram.combinePrograms: List<ILedClockCombineProgram>`.
    contents_per_program_is_a_list: bool = True
    #: [VENDOR] no explicit count cap on `combinePrograms.size()` found anywhere; the only
    #: real constraint is the encoded+compressed byte size of the whole program fitting
    #: within whatever the true (currently [INFERENCE]-estimated, see
    #: DEFAULT_MAX_PROGRAM_BYTES_ESTIMATE) transfer/memory ceiling turns out to be.
    max_contents_per_program: int | None = None
    #: [DEVICE]+[VENDOR] confirmed program-SLOT count (separate from contents-per-program above).
    max_programs: int = 9
    #: [VENDOR] every content type's `layerType` field defaults to 0 or 1, never a richer
    #: value -- consistent with a simple base(0)/overlay(1) two-plane model, but the actual
    #: pixel-compositing rule when two layers' regions overlap (does a layerType-1 content's
    #: black/off pixels show through to a layerType-0 content underneath, i.e. is black
    #: treated as transparent/masked, or does whichever content is listed later in
    #: `combinePrograms` simply overwrite the region outright with no alpha at all?) has NO
    #: vendor evidence either way -- UNCONFIRMED, see docs/HARDWARE.md open questions.
    layer_type_values: Mapping[int, str] = field(
        default_factory=lambda: {0: "base/background (observed default: clock, temperature, scoreboard, humidity)",
                                  1: "overlay (observed default: date, timecount, text, animation, graffiti, gif)"}
    )
    z_order_semantics: str = (
        "UNCONFIRMED. Structurally, disjoint (non-overlapping) regions from different "
        "content items definitely coexist correctly -- each content type carries its own "
        "startColumn/startRow/showWidth/showHeight (or per-subfield equivalent) and "
        "getDataForProgram simply concatenates every combine-program's encoded bytes "
        "[VENDOR ILedClockUtils.java:4506-4513] with no shared canvas/blending step in the "
        "APP's own encoding -- so composition, if any, happens entirely on-DEVICE from "
        "independently-addressed regions. Whether overlapping regions blend, mask on "
        "black, or simply have the later-listed content win is untested. See "
        "docs/HARDWARE.md's live experiment (upload two contents with overlapping regions, "
        "photograph the result)."
    )
    #: [VENDOR ILedClockUtils.java:4527-4640, `getStartDataForProgram(int,List,int,int,int,int)`
    #: and its `isClockInProgramList` sibling overload] the per-program "start upload" header
    #: encodes a duration/showCount suffix whose SHAPE depends on `programType`:
    #: type 8 (TIMECOUNT) -> single byte 0x01; type 9 -> 0x02; type 11 (SCOREBOARD) -> 0x03;
    #: type 7 (CLOCK) -> `04,01,+4B(10)` normally, but if `isClockInProgramList` is true
    #: (this clock is one of SEVERAL programs in a playlist, not the sole program) ->
    #: `00,01,+4B(showCount*5)` instead; type 6 or 19 -> always `04,01,+4B(5)`; type 14
    #: (REMINDER) -> `05,+1B(reminderId)`; every other type -> `00,00,+4B(showCount)`. In
    #: short: showCount's UNITS and even its wire shape are content-type-specific, and
    #: `isClockInProgramList` specifically changes how a CLOCK program's on-screen duration
    #: is computed when it shares a playlist with other programs vs. being the only one.
    show_count_semantics: str = (
        "Content-type-dependent; see the LayerModel.show_count_semantics docstring/comment "
        "for the exact per-programType wire shapes."
    )


LAYER_MODEL = LayerModel()


# ---------------------------------------------------------------------------
# Live-unverified clock behaviours: capability flags (conservative defaults)
# ---------------------------------------------------------------------------
# Each constant below names something the real clock has NOT been observed doing yet. The default
# is the conservative choice (the one that cannot make the clock do anything unproven). After the
# matching live test (docs/SLOTS-AND-REMINDERS.md, "Live tests") flip the constant HERE and nothing
# else: services, the websocket API and Pixel Studio read these at call time (always as
# `hardware.NAME`, never `from .hardware import NAME`, so tests can patch them), and the studio
# learns the current values from `capabilities` in the `iledclock/state` payload.

#: [LIVE TEST: slot-B art] May plain art / animation / text / generated effects be written to screen B
#: (the clock-page store, start-frame kind byte 04) as a standalone type-7 program? The kind byte is
#: the best guess for which store an upload lands in, and the vendor only ever writes clock, date and
#: temperature pages there. False: screen B takes clock-type pages only and Pixel Studio says so.
SLOT_B_ACCEPTS_ART: bool = False

#: Art with a firmware clock beside it ("Icon with clock") has exactly the vendor Clock tab's page
#: shape (an animation layer plus a clock layer, program type 7, `04 01 <10>` trailer), so screen B
#: takes it by default. Set False if the slot-B art test shows the clock page store rejects it.
SLOT_B_ACCEPTS_ART_WITH_CLOCK: bool = True

#: Ids the clock accepts for a reminder, and how many reminders it holds in all. [DEVICE 2026-10-02, T6]
#: The clock reports back exactly the ids written (1..15 all accepted and listed), and the vendor app's
#: own reminder reads back as id 0, so 0 works too. The limit is a COUNT, not an id: with 14 reminders
#: stored (ids 0..13) id 14 was refused (start answer error 2); after deleting two, ids 14 and 15 were
#: accepted, and a 15th reminder (id 2, accepted earlier) was refused again. Allocation uses the lowest
#: free id in MIN..MAX and never lets the clock hold more than REMINDER_CAPACITY, counting reminders
#: Home Assistant did not make.
REMINDER_ID_MIN: int = 1
REMINDER_ID_MAX: int = 15
REMINDER_CAPACITY: int = 14

#: [LIVE TEST T7: weekday mask] May one reminder carry several weekdays (repeat type 1 with a partial
#: week mask, e.g. Mon-Fri = 0x1F)? The vendor never sends one. False: a Mon-Fri item uses five clock
#: slots (one weekly reminder per day); True: it uses one.
REMINDER_WEEK_MASK_SUPPORTED: bool = False

#: [LIVE TEST T3: playlist safety] Does uploading a reminder (start frame index 0 / count 1, kind
#: trailer `05 <id>`) leave screen A's program list and screen B untouched? The firmware most likely
#: routes by the trailer, but if it treated (0, 1) as "replace the program list" the rotation would be
#: wiped. False: after every reminder write Home Assistant re-sends screen A's last program list (cheap:
#: an unchanged program is answered "already present" and no data chunks go out).
REMINDER_UPLOAD_PRESERVES_SLOTS: bool = False

#: Seconds to let the clock settle after the last data chunk of a reminder before reading it back to
#: verify (the vendor app waits 1000 ms before reporting success, DeviceManager.java:4313-4316).
REMINDER_SAVE_SETTLE_S: float = 1.0
