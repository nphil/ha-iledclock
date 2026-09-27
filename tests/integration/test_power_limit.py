"""The vendor LED current budget is applied to uploads when brightness exceeds 96."""
from __future__ import annotations

import unittest

from custom_components.iledclock.program_builder import power_limit_programs
from custom_components.iledclock.protocol.models import Frame
from custom_components.iledclock.protocol.programs import AnimationContent, GraffitiContent, Program


def _frame(rgb):
    return Frame(pixels=[[rgb] * 32 for _ in range(16)], duration_ms=100)


def _graffiti(rgb):
    return Program(contents=[GraffitiContent(start_column=0, start_row=0, show_width=32, show_height=16, pixels=_frame(rgb))], show_count=10)


class PowerLimitTest(unittest.TestCase):
    def test_full_white_is_scaled_to_the_budget_above_96(self):
        out = power_limit_programs([_graffiti((255, 255, 255))], 255)
        px = out[0].contents[0].pixels.pixels[0][0]
        self.assertLessEqual(sum(px), 612)
        self.assertEqual(px[0], px[1])  # colour ratio kept

    def test_white_untouched_at_or_below_96(self):
        out = power_limit_programs([_graffiti((255, 255, 255))], 96)
        self.assertEqual(out[0].contents[0].pixels.pixels[0][0], (255, 255, 255))

    def test_ordinary_art_untouched_at_full_brightness(self):
        out = power_limit_programs([_graffiti((255, 0, 0))], 255)
        self.assertEqual(out[0].contents[0].pixels.pixels[0][0], (255, 0, 0))

    def test_animation_frames_are_each_limited(self):
        prog = Program(contents=[AnimationContent(start_column=0, start_row=0, show_width=32, show_height=16,
                                                  frames=[_frame((255, 255, 255)), _frame((10, 10, 10))])], show_count=10)
        frames = power_limit_programs([prog], 200)[0].contents[0].frames
        self.assertLessEqual(sum(frames[0].pixels[3][3]), 612)
        self.assertEqual(frames[1].pixels[3][3], (10, 10, 10))

    def test_unknown_brightness_leaves_everything(self):
        out = power_limit_programs([_graffiti((255, 255, 255))], None)
        self.assertEqual(out[0].contents[0].pixels.pixels[0][0], (255, 255, 255))


if __name__ == "__main__":
    unittest.main()


class DeviceTimingTest(unittest.TestCase):
    """The clock spends ~1.5 ms per delay unit (timed on the live clock), so uploads convert."""

    def test_animation_frames_convert_to_device_units(self):
        from custom_components.iledclock.program_builder import to_device_timing

        prog = Program(contents=[AnimationContent(start_column=0, start_row=0, show_width=32, show_height=16,
                                                  frames=[_frame((1, 2, 3)), _frame((1, 2, 3))])], show_count=10)
        prog.contents[0].frames[0] = Frame(pixels=prog.contents[0].frames[0].pixels, duration_ms=30)
        prog.contents[0].frames[1] = Frame(pixels=prog.contents[0].frames[1].pixels, duration_ms=150)
        frames = to_device_timing([prog])[0].contents[0].frames
        self.assertEqual([f.duration_ms for f in frames], [20, 100])

    def test_still_images_are_untouched(self):
        from custom_components.iledclock.program_builder import to_device_timing

        out = to_device_timing([_graffiti((9, 9, 9))])
        self.assertEqual(out[0].contents[0].pixels.duration_ms, 100)
