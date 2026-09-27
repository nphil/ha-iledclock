"""Tests for the iLedClock hardware capability profile (`custom_components/iledclock/hardware.py`).

Two evidence tiers, matching hardware.py's own grading:

- Golden-vector tests load the committed `tests/fixtures/golden/vectors.json` fixture
  (produced by running the *real* vendor bytecode on a JVM -- see
  `tools/golden-harness/README.md` to regenerate it) and assert our pure Python reproduces
  its exact byte-for-byte output. These are `[VECTOR]`-grade and always run.
- Formula tests assert our port matches the vendor formula as directly read from the
  decompiled source (cited in hardware.py's own docstrings/comments) -- these always run and
  do not depend on the external oracle.

One real gap, documented honestly rather than glossed over: the golden vector corpus only
ever exercises primary colours (every channel is 0 or 255), where the linear (`v // 16`) and
curved (`rgb444_transfer`) formulas coincidentally agree (0->0, 255->15 either way). No
golden vector anywhere in the corpus can distinguish which formula a given content path
uses at a *mid-range* value -- that distinction rests on direct source citation (see
hardware.py's module docstring), not vector cross-validation. `EncodeChannelPathTests`
below tests the mid-range divergence directly against the transcribed formulas instead.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import hardware

GOLDEN_VECTORS_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "golden" / "vectors.json"


def _load_golden() -> dict[str, list[dict]]:
    data = json.loads(GOLDEN_VECTORS_PATH.read_text())
    by_fn: dict[str, list[dict]] = {}
    for item in data:
        by_fn.setdefault(item["fn"], []).append(item)
    return by_fn


def _frame_to_byte_tokens(frame_hex: str) -> list[str]:
    return [frame_hex[i : i + 2] for i in range(0, len(frame_hex), 2)]


def _recover_data(byte_tokens: list[str]) -> list[str]:
    """Port of `LightUtils.recoverData(List<String>)` [VENDOR LightUtils.java:341-365] --
    strips the 01/03 frame, un-escapes (0x02,b -> b^0x04), and drops the 2-byte length
    prefix, leaving the raw opcode-first payload. Used only to independently decode golden
    *frame* vectors (which are pre-escaped/framed) down to plain payload bytes for
    inspection; this is test-only decoding logic, not something hardware.py itself needs to
    provide (framing/escaping is protocol/framing.py's contract)."""
    tokens = byte_tokens
    if len(tokens) > 2 and int(tokens[0], 16) == 0x01 and int(tokens[-1], 16) == 0x03:
        tokens = tokens[1:-1]
    out: list[str] = []
    i = 0
    while i < len(tokens):
        if int(tokens[i], 16) != 0x02:
            out.append(tokens[i])
        else:
            j = i + 1
            if j < len(tokens):
                out.append("%02x" % (int(tokens[j], 16) ^ 0x04))
                i = j
        i += 1
    return out[2:]


def _argb_hex_to_rgb(argb_hex: str) -> tuple[int, int, int]:
    raw = bytes.fromhex(argb_hex)
    return (raw[1], raw[2], raw[3])

def _argb_int_to_rgb(argb_signed: int) -> tuple[int, int, int]:
    """Golden vectors store Java `int` ARGB colours, which round-trip through Java's signed
    32-bit representation (e.g. red 0xFFFF0000 is serialized as -65536). Mask back to
    unsigned before extracting channels."""
    u = argb_signed & 0xFFFFFFFF
    return ((u >> 16) & 0xFF, (u >> 8) & 0xFF, u & 0xFF)


def _reindex_column_major(flat_row_major: list, width: int, height: int) -> list:
    """Reproduces the exact vendor wire order for GRAFFITI/ANIMATION pixel data
    [VENDOR ILedClockUtils.java:3041-3050 getAnimationDataColor, confirmed identical for
    getDrawListDataFColor/graffiti]: the source list is row-major-indexed
    (`flat_row_major[row*width+col]`) but EMITTED column-major (outer loop = column, inner
    loop = row) -- see docs/HARDWARE.md section 5's "Pixel wire order" note."""
    return [flat_row_major[row * width + col] for col in range(width) for row in range(height)]


def _expected_pixel_hex(colors: list[tuple[int, int, int]], path: str) -> str:
    """The exact lowercase-hex byte sequence `hardware.encode_channel` predicts for an
    already-wire-ordered list of RGB888 colours: byte0 = "0" + R-nibble, byte1 =
    G-nibble<<4 | B-nibble [VENDOR TextEmojiManagerCoolLEDUX.java:386-403]."""
    out = []
    for r, g, b in colors:
        r_n = hardware.encode_channel(r, path)
        g_n = hardware.encode_channel(g, path)
        b_n = hardware.encode_channel(b, path)
        out.append("%02x%02x" % (r_n, (g_n << 4) | b_n))
    return "".join(out)


class GoldenVectorTests(unittest.TestCase):
    """[VECTOR]-grade cross-checks against the real vendor bytecode's own recorded output."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.by_fn = _load_golden()

    def test_power_limited_matches_every_adjust_power_vector(self) -> None:
        vectors = self.by_fn["adjustPower"]
        self.assertEqual(len(vectors), 12, "expected all 12 adjustPower golden vectors")
        for item in vectors:
            rgb_in = _argb_hex_to_rgb(item["args"]["colorArgb"])
            # The golden harness's own arg name ("pixelCount") is misleading -- the vendor
            # source (ILedClockUtils.java:5072-5075) unambiguously compares this parameter
            # against 96 as a brightness-like gate, never uses it as a pixel count in the
            # scaling arithmetic. See hardware.py's power-limiting section docstring.
            brightness = item["args"]["pixelCount"]
            expected = _argb_hex_to_rgb(item["out"])
            with self.subTest(rgb_in=rgb_in, brightness=brightness):
                self.assertEqual(hardware.power_limited(rgb_in, brightness), expected)

    def test_encode_channel_solid_matches_every_setcolor_vector(self) -> None:
        vectors = self.by_fn["setColor"]
        self.assertTrue(vectors)
        for item in vectors:
            r, g, b = _argb_hex_to_rgb(item["args"]["colorArgb"])
            payload = _recover_data(_frame_to_byte_tokens(item["out"]))
            self.assertEqual(payload[0:2], ["13", "01"], "opcode 0x13 0x01 = global solid colour")
            byte0, byte1 = int(payload[2], 16), int(payload[3], 16)
            expected_nibbles = (byte0 & 0x0F, (byte1 >> 4) & 0x0F, byte1 & 0x0F)
            got_nibbles = (
                hardware.encode_channel(r, "solid"),
                hardware.encode_channel(g, "solid"),
                hardware.encode_channel(b, "solid"),
            )
            with self.subTest(rgb=(r, g, b)):
                self.assertEqual(got_nibbles, expected_nibbles)

    def test_encode_channel_graffiti_matches_every_graffiti_vector_pixel_for_pixel(self) -> None:
        vectors = self.by_fn["getDataWithGraffitiCombineProgram"]
        self.assertTrue(vectors)
        checked_dimensioned = 0
        for item in vectors:
            content = item.get("content", item.get("args", {}).get("content"))
            draw_items = content["mDrawItems"]
            width, height = content["showWidth"], content["showHeight"]
            if width * height != len(draw_items):
                continue  # a handful of vectors document off-geometry vendor throws; nothing to decode
            checked_dimensioned += 1
            colors = _reindex_column_major([_argb_int_to_rgb(d["color"]) for d in draw_items], width, height)
            expected_hex = _expected_pixel_hex(colors, "graffiti")
            with self.subTest(width=width, height=height, n_pixels=len(draw_items)):
                self.assertIn(expected_hex, item["out"])
        self.assertGreater(checked_dimensioned, 0, "expected at least one well-dimensioned graffiti vector")

    def test_encode_channel_animation_matches_every_animation_vector_pixel_for_pixel(self) -> None:
        vectors = self.by_fn["getDataWithAnimationCombineProgram(content)"]
        self.assertTrue(vectors)
        for item in vectors:
            content = item.get("content", item.get("args", {}).get("content"))
            width, height = content["showWidth"], content["showHeight"]
            all_colors: list[tuple[int, int, int]] = []
            for frame in content["mListDrawItems"]:
                self.assertEqual(width * height, len(frame))
                all_colors.extend(_reindex_column_major([_argb_int_to_rgb(d["color"]) for d in frame], width, height))
            expected_hex = _expected_pixel_hex(all_colors, "animation")
            with self.subTest(width=width, height=height, n_frames=len(content["mListDrawItems"])):
                self.assertIn(expected_hex, item["out"])

    def test_estimate_lzss_ratio_repetitive_matches_5000_byte_corpus(self) -> None:
        vectors = self.by_fn["LzssCompress.getLzssCompressData"]
        corpus = next(v for v in vectors if v["args"].get("label") == "5000repetitive")
        compressed_bytes = len(corpus["out"]) / 2  # out is a lowercase-hex string
        self.assertAlmostEqual(compressed_bytes / 5000, hardware.estimate_lzss_ratio("repetitive"), places=6)

    def test_estimate_lzss_ratio_random_matches_1000_byte_corpus(self) -> None:
        vectors = self.by_fn["LzssCompress.getLzssCompressData"]
        corpus = next(v for v in vectors if v["args"].get("label") == "1000randomSeed7")
        compressed_bytes = len(corpus["out"]) / 2
        self.assertAlmostEqual(compressed_bytes / 1000, hardware.estimate_lzss_ratio("random"), places=6)


class Rgb444TransferTests(unittest.TestCase):
    """[VENDOR]-formula tests for the curved transfer -- always run, no external oracle."""

    def test_matches_vendor_formula_at_every_value(self) -> None:
        # Deliberately re-derives the vendor formula independently (not by calling
        # hardware.rgb444_transfer) so a bug in the ported function can't hide from this
        # test by being wrong in a way that's self-consistent with itself.
        for v in range(256):
            if v >= 238:
                expected = 15
            elif v <= 47:
                expected = 0
            else:
                expected = (v - 47) // 14 + 1
            self.assertEqual(hardware.rgb444_transfer(v), expected, f"v={v}")

    def test_boundary_values(self) -> None:
        self.assertEqual(hardware.rgb444_transfer(0), 0)
        self.assertEqual(hardware.rgb444_transfer(47), 0)
        self.assertEqual(hardware.rgb444_transfer(48), 1)
        self.assertEqual(hardware.rgb444_transfer(237), 14)
        self.assertEqual(hardware.rgb444_transfer(238), 15)
        self.assertEqual(hardware.rgb444_transfer(255), 15)

    def test_table_has_sixteen_distinct_steps(self) -> None:
        table = hardware.rgb444_transfer_table()
        self.assertEqual(len(table), 256)
        self.assertEqual(len(set(table)), 16)
        self.assertEqual(table, tuple(hardware.rgb444_transfer(v) for v in range(256)))

    def test_table_is_monotonically_nondecreasing(self) -> None:
        table = hardware.rgb444_transfer_table()
        self.assertEqual(table, tuple(sorted(table)))

    def test_not_a_uniform_divide_by_sixteen(self) -> None:
        # The defining, easy-to-regress property: this is NOT `v // 16`. Pick a value where
        # the two formulas disagree (52 -> curved 1, linear 3) and pin it.
        self.assertEqual(hardware.rgb444_transfer(52), 1)
        self.assertNotEqual(hardware.rgb444_transfer(52), 52 // 16)


class EncodeChannelPathTests(unittest.TestCase):
    """Per-content-path dispatch -- the mid-range-divergence test golden vectors can't provide
    (see module docstring): every value in the golden corpus is a channel of 0 or 255, where
    linear and curved formulas coincidentally agree."""

    def test_curved_paths_use_rgb444_transfer(self) -> None:
        for path in hardware.CURVED_PATHS:
            with self.subTest(path=path):
                self.assertEqual(hardware.encode_channel(52, path), 1)
                self.assertEqual(hardware.encode_channel(200, path), 11)

    def test_linear_paths_use_plain_divide_by_sixteen(self) -> None:
        for path in hardware.LINEAR_PATHS:
            with self.subTest(path=path):
                self.assertEqual(hardware.encode_channel(52, path), 3)
                self.assertEqual(hardware.encode_channel(200, path), 12)

    def test_curved_and_linear_genuinely_diverge_at_midrange(self) -> None:
        self.assertNotEqual(hardware.encode_channel(52, "solid"), hardware.encode_channel(52, "clock"))

    def test_extremes_agree_across_every_defined_path(self) -> None:
        # Exactly why the golden corpus (primary colours only) can't discriminate paths.
        for path in hardware.CURVED_PATHS | hardware.LINEAR_PATHS:
            with self.subTest(path=path):
                self.assertEqual(hardware.encode_channel(0, path), 0)
                self.assertEqual(hardware.encode_channel(255, path), 15)

    def test_unknown_path_rejected(self) -> None:
        with self.assertRaises(ValueError):
            hardware.encode_channel(100, "text_auto")  # no per-channel encoding, see NATIVE_LAYERS["text"]
        with self.assertRaises(ValueError):
            hardware.encode_channel(100, "not_a_real_path")  # type: ignore[arg-type]

    def test_channel_value_out_of_range_rejected(self) -> None:
        with self.assertRaises(ValueError):
            hardware.encode_channel(-1, "solid")
        with self.assertRaises(ValueError):
            hardware.encode_channel(256, "solid")

    def test_content_path_sets_are_disjoint_and_cover_all_declared_paths(self) -> None:
        overlap = hardware.CURVED_PATHS & hardware.LINEAR_PATHS
        self.assertEqual(overlap, frozenset())
        declared = set(hardware.CURVED_PATHS | hardware.LINEAR_PATHS)
        self.assertEqual(declared, {"solid", "text_custom", "graffiti", "animation", "clock", "date", "timecount", "scoreboard", "temperature", "humidity"})


class DisplayedRgbTests(unittest.TestCase):
    def test_bit_replication_expansion(self) -> None:
        self.assertEqual(hardware.displayed_rgb((0, 0, 0), "solid"), (0, 0, 0))
        self.assertEqual(hardware.displayed_rgb((255, 255, 255), "solid"), (255, 255, 255))
        # nibble 1 (curved(52)==1) expands to 1*17 = 17, not 16 or 1.
        self.assertEqual(hardware.displayed_rgb((52, 52, 52), "solid"), (17, 17, 17))

    def test_every_possible_nibble_expands_onto_an_exact_0_255_ladder(self) -> None:
        seen = {hardware.displayed_rgb((v, 0, 0), "solid")[0] for v in range(256)}
        self.assertEqual(seen, {n * 17 for n in range(16)})

    def test_differs_by_path_at_midrange(self) -> None:
        self.assertNotEqual(
            hardware.displayed_rgb((52, 52, 52), "solid"),
            hardware.displayed_rgb((52, 52, 52), "clock"),
        )


class PowerLimitedTests(unittest.TestCase):
    def test_low_brightness_passthrough(self) -> None:
        self.assertEqual(hardware.power_limited((255, 255, 255), 96), (255, 255, 255))
        self.assertEqual(hardware.power_limited((255, 255, 255), 0), (255, 255, 255))

    def test_high_brightness_under_budget_passthrough(self) -> None:
        self.assertEqual(hardware.power_limited((100, 100, 100), 100), (100, 100, 100))  # sum=300 <= 612

    def test_high_brightness_over_budget_scales_down_to_exact_budget(self) -> None:
        got = hardware.power_limited((255, 255, 255), 100)
        self.assertEqual(got, (204, 204, 204))
        self.assertEqual(sum(got), hardware.POWER_LIMIT_RGB_SUM_BUDGET)

    def test_threshold_is_strictly_greater_than_96(self) -> None:
        self.assertEqual(hardware.power_limited((255, 255, 255), 97)[0], 204)

    def test_preserves_hue_ratio(self) -> None:
        r, g, b = hardware.power_limited((255, 0, 0), 100)
        self.assertEqual((g, b), (0, 0))
        self.assertEqual(r, 255)  # sum=255 <= 612, untouched


class PowerLimitedFrameTests(unittest.TestCase):
    """No golden vectors exist for adjustPowerGraffiti/adjustPowerAnimation (the golden
    harness only captured the base per-pixel `adjustPower`, 12 vectors) -- these assert
    against the formula transcribed directly from ILedClockUtils.java:3196-3230 instead."""

    def test_empty_frame(self) -> None:
        self.assertEqual(hardware.power_limited_frame([], 100), [])

    def test_low_brightness_passthrough(self) -> None:
        pixels = [(255, 255, 255)] * 4
        self.assertEqual(hardware.power_limited_frame(pixels, 96), pixels)

    def test_aggregate_budget_not_per_pixel(self) -> None:
        # 4 white pixels: aggregate sum = 4*765 = 3060; budget = 4*612 = 2448. Every pixel
        # scaled by 2448/3060 = 0.8 uniformly -- same 0.8 factor as the single-pixel case,
        # because these are already at the same per-pixel average as the budget.
        pixels = [(255, 255, 255)] * 4
        got = hardware.power_limited_frame(pixels, 100)
        self.assertEqual(got, [(204, 204, 204)] * 4)

    def test_uneven_frame_scales_every_pixel_by_the_same_factor(self) -> None:
        # One bright pixel + one dark pixel: aggregate sum = 765 + 0 = 765; budget = 2*612 =
        # 1224 >= 765, so no scaling at all despite the bright pixel individually exceeding
        # `power_limited`'s own per-pixel 612 threshold -- proving this is a genuinely
        # different, aggregate rule from `power_limited`.
        pixels = [(255, 255, 255), (0, 0, 0)]
        got = hardware.power_limited_frame(pixels, 100)
        self.assertEqual(got, pixels)

    def test_frame_budget_scaling_can_still_trigger_on_average(self) -> None:
        pixels = [(255, 255, 255), (255, 255, 255), (0, 0, 0), (0, 0, 0)]  # avg sum = 382.5 <= 612: no scale
        self.assertEqual(hardware.power_limited_frame(pixels, 100), pixels)
        bright = [(255, 255, 255)] * 3 + [(0, 0, 0)]  # avg sum = 573.75 <= 612: still no scale
        self.assertEqual(hardware.power_limited_frame(bright, 100), bright)
        brighter = [(255, 255, 255)] * 4  # avg sum = 765 > 612: scales
        self.assertNotEqual(hardware.power_limited_frame(brighter, 100), brighter)


class QuantizeDelayMsTests(unittest.TestCase):
    def test_within_range_rounds_to_nearest_ms(self) -> None:
        self.assertEqual(hardware.quantize_delay_ms(100.4), 100)
        self.assertEqual(hardware.quantize_delay_ms(100.6), 101)

    def test_default_floor_is_the_practical_floor(self) -> None:
        self.assertEqual(hardware.quantize_delay_ms(0), hardware.ANIMATION_DELAY_PRACTICAL_FLOOR_MS)
        self.assertEqual(hardware.quantize_delay_ms(1), hardware.ANIMATION_DELAY_PRACTICAL_FLOOR_MS)

    def test_device_delay_units_follow_the_measured_1_5_ms_unit(self) -> None:
        # [DEVICE] 20 units looked like ~30 ms per frame, 125 units like ~190 ms.
        self.assertEqual(hardware.device_delay_units(30), 20)
        self.assertEqual(hardware.device_delay_units(187.5), 125)
        self.assertEqual(hardware.device_delay_units(0), 1)
        self.assertEqual(hardware.device_delay_units(10**9), 65535)

    def test_ceiling_is_two_byte_field_max(self) -> None:
        self.assertEqual(hardware.quantize_delay_ms(1_000_000), 65535)

    def test_floor_can_be_lowered_to_bare_wire_minimum(self) -> None:
        self.assertEqual(hardware.quantize_delay_ms(0, floor_ms=0), 0)

    def test_invalid_clamp_range_rejected(self) -> None:
        with self.assertRaises(ValueError):
            hardware.quantize_delay_ms(100, floor_ms=-1)
        with self.assertRaises(ValueError):
            hardware.quantize_delay_ms(100, ceiling_ms=70000)
        with self.assertRaises(ValueError):
            hardware.quantize_delay_ms(100, floor_ms=100, ceiling_ms=50)


class FrameBudgetTests(unittest.TestCase):
    def test_basic_division(self) -> None:
        self.assertEqual(hardware.frame_budget(1024, max_program_bytes=65536), 64)

    def test_always_at_least_one(self) -> None:
        self.assertEqual(hardware.frame_budget(1_000_000, max_program_bytes=65536), 1)

    def test_full_frame_uses_geometry_constants(self) -> None:
        full_frame_bytes = hardware.ILEDCLOCK_32x16.width * hardware.ILEDCLOCK_32x16.height * hardware.BYTES_PER_PIXEL_WIRE
        self.assertEqual(full_frame_bytes, 1024)
        self.assertEqual(hardware.frame_budget(full_frame_bytes), 64)  # uses DEFAULT_MAX_PROGRAM_BYTES_ESTIMATE

    def test_rejects_nonpositive_inputs(self) -> None:
        with self.assertRaises(ValueError):
            hardware.frame_budget(0)
        with self.assertRaises(ValueError):
            hardware.frame_budget(100, max_program_bytes=0)


class ManufacturerGeometryTests(unittest.TestCase):
    """[DEVICE]-grade: the real advertised payload from our exact clock."""

    def test_real_device_payload(self) -> None:
        payload = bytes.fromhex("bcdc070000011000200421")
        geometry = hardware.derive_geometry_from_manufacturer_data(payload)
        self.assertEqual(geometry.height, 16)
        self.assertEqual(geometry.width, 32)
        self.assertEqual(geometry.colour_type, 4)
        self.assertEqual(geometry.firmware_version, 0x21)

    def test_matches_hardware_profile(self) -> None:
        payload = bytes.fromhex("bcdc070000011000200421")
        geometry = hardware.derive_geometry_from_manufacturer_data(payload)
        self.assertEqual(geometry.height, hardware.ILEDCLOCK_32x16.height)
        self.assertEqual(geometry.width, hardware.ILEDCLOCK_32x16.width)
        self.assertEqual(geometry.colour_type, hardware.ILEDCLOCK_32x16.colour_type)
        self.assertEqual(geometry.firmware_version, hardware.ILEDCLOCK_32x16.firmware_version_observed)

    def test_wrong_length_rejected(self) -> None:
        with self.assertRaises(ValueError):
            hardware.derive_geometry_from_manufacturer_data(b"\x00" * 10)
        with self.assertRaises(ValueError):
            hardware.derive_geometry_from_manufacturer_data(b"\x00" * 12)


class HardwareProfileTests(unittest.TestCase):
    def test_geometry(self) -> None:
        self.assertEqual((hardware.ILEDCLOCK_32x16.width, hardware.ILEDCLOCK_32x16.height), (32, 16))

    def test_is_frozen(self) -> None:
        with self.assertRaises(Exception):
            hardware.ILEDCLOCK_32x16.width = 999  # type: ignore[misc]

    def test_max_programs_matches_live_device_reply(self) -> None:
        # [DEVICE] tests/live_replies_2026-09-25.json device_info -> byte[8] = 0x09.
        self.assertEqual(hardware.ILEDCLOCK_32x16.max_programs, 9)

    def test_brightness_range_reaches_the_full_byte(self) -> None:
        # [DEVICE] 255 is visibly brighter than 163, which is brighter than 100.
        self.assertEqual(hardware.ILEDCLOCK_32x16.brightness_wire_min, 5)
        self.assertEqual(hardware.ILEDCLOCK_32x16.brightness_wire_max, 255)

    def test_rotate_modes_has_all_four_documented_values(self) -> None:
        self.assertEqual(set(hardware.ILEDCLOCK_32x16.rotate_modes.keys()), {0, 1, 2, 3})
        for mode_name in hardware.ILEDCLOCK_32x16.rotate_modes.values():
            self.assertIsInstance(mode_name, str)
            self.assertTrue(mode_name)

    def test_clock_style_count_matches_vendor_constant_count(self) -> None:
        self.assertEqual(hardware.ILEDCLOCK_32x16.clock_style_count, 41)

    def test_no_confirmed_temperature_humidity_sensor(self) -> None:
        self.assertIs(hardware.ILEDCLOCK_32x16.has_temperature_humidity_sensor, False)

    def test_no_physical_buttons(self) -> None:
        self.assertIs(hardware.ILEDCLOCK_32x16.has_physical_buttons, False)

    def test_has_microphone(self) -> None:
        self.assertIs(hardware.ILEDCLOCK_32x16.has_microphone, True)


class NativeLayersTests(unittest.TestCase):
    def test_every_assignment_named_feature_is_present(self) -> None:
        # docs/HARDWARE.md item 6's explicit list: clock faces, date, temp/humidity,
        # countdown/timecount, scoreboard, text, border/frame, dynamic text, reminder.
        expected_names = {"clock", "date", "temperature", "humidity", "timecount", "scoreboard", "text", "frame", "dynamic_text", "reminder"}
        self.assertEqual(set(hardware.NATIVE_LAYERS.keys()), expected_names)

    def test_content_type_ids_are_unique_and_match_vendor_dispatch(self) -> None:
        ids = [layer.content_type_id for layer in hardware.NATIVE_LAYERS.values()]
        self.assertEqual(len(ids), len(set(ids)), "content_type_id values must be unique")
        # [VENDOR ILedClockUtils.java:4378-4504 getDataForCombineProgram dispatch]
        expected = {
            "clock": 7, "date": 6, "temperature": 17, "humidity": 18, "timecount": 8,
            "scoreboard": 11, "text": 3, "frame": 4, "dynamic_text": 16, "reminder": 14,
        }
        for name, layer in hardware.NATIVE_LAYERS.items():
            self.assertEqual(layer.content_type_id, expected[name], name)

    def test_every_layer_type_default_is_zero_or_one(self) -> None:
        for name, layer in hardware.NATIVE_LAYERS.items():
            with self.subTest(name=name):
                self.assertIn(layer.default_layer_type, (0, 1))

    def test_reminder_is_the_only_layer_without_a_spatial_region(self) -> None:
        self.assertFalse(hardware.NATIVE_LAYERS["reminder"].has_region)
        for name, layer in hardware.NATIVE_LAYERS.items():
            if name != "reminder":
                with self.subTest(name=name):
                    self.assertTrue(layer.has_region)

    def test_reminder_max_instances_is_sixteen(self) -> None:
        self.assertEqual(hardware.NATIVE_LAYERS["reminder"].max_instances, 16)

    def test_device_state_layers_match_assignment_intent(self) -> None:
        # These are exactly the layers that update live from device-tracked state at zero
        # re-upload cost -- the ones `gallery/adapt.py` should prefer composing WITH art.
        live_state_layers = {name for name, layer in hardware.NATIVE_LAYERS.items() if layer.renders_from_device_state}
        self.assertEqual(live_state_layers, {"clock", "date", "temperature", "humidity", "timecount", "scoreboard", "reminder"})

    def test_clock_colour_encoding_is_linear_not_curved(self) -> None:
        self.assertEqual(hardware.NATIVE_LAYERS["clock"].colour_encoding, "linear")

    def test_text_colour_encoding_is_curved(self) -> None:
        self.assertEqual(hardware.NATIVE_LAYERS["text"].colour_encoding, "curved")


class LayerModelTests(unittest.TestCase):
    def test_contents_per_program_is_a_list(self) -> None:
        self.assertTrue(hardware.LAYER_MODEL.contents_per_program_is_a_list)

    def test_no_hard_cap_on_contents_per_program(self) -> None:
        self.assertIsNone(hardware.LAYER_MODEL.max_contents_per_program)

    def test_max_programs_matches_hardware_profile(self) -> None:
        self.assertEqual(hardware.LAYER_MODEL.max_programs, hardware.ILEDCLOCK_32x16.max_programs)

    def test_layer_type_values_cover_zero_and_one(self) -> None:
        self.assertEqual(set(hardware.LAYER_MODEL.layer_type_values.keys()), {0, 1})


class RotateModesTests(unittest.TestCase):
    def test_xy_flip_is_both_axes_not_diagonal(self) -> None:
        self.assertIn("both axes", hardware.ROTATE_MODES[1])

    def test_matches_hardware_profile_copy(self) -> None:
        self.assertEqual(dict(hardware.ILEDCLOCK_32x16.rotate_modes), dict(hardware.ROTATE_MODES))


if __name__ == "__main__":
    unittest.main()
