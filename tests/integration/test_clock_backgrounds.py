"""The vendor app pairs every firmware clock style with its own 32x16 background animation and
uploads background + digits together (`ILedClockClockTimeFragment.getClockCombineProgram`,
~line 1170 for the clock's own background: `if (cLockStyleItem.clockBgImageId > 0) { ... }`,
~line 1201 for the date companion's `dateBgImageId`). Our own upload used to send bare digits
only; these tests pin the corrected [background, digits] shape and the bundled asset itself."""
from __future__ import annotations

import unittest

from custom_components.iledclock.clock_backgrounds import CLOCK_BACKGROUNDS, DATE_BACKGROUND
from custom_components.iledclock.clock_styles import CLOCK_STYLES
from custom_components.iledclock.playlist import PlaylistItem
from custom_components.iledclock.program_builder import ProgramBuildError, build_programs
from custom_components.iledclock.protocol.programs import AnimationContent, ClockContent, DateContent

FULL_PANEL = (32, 16)


class ClockBackgroundAssetTest(unittest.TestCase):
    """Bundle completeness: `tools/generate_clock_backgrounds.py`'s output."""

    def test_every_clock_style_has_a_background_including_36(self):
        # Style 36 is a real, selectable 41st style (clock_styles.py), not a gap: it has its
        # own vendor background asset (`ic_clock_style_bg36_1632_iledclock.gif`), distinct from
        # style 37's despite sharing that style's digit geometry.
        self.assertEqual(sorted(CLOCK_BACKGROUNDS), list(range(1, 42)))
        self.assertEqual(sorted(CLOCK_BACKGROUNDS), sorted(CLOCK_STYLES))

    def test_every_background_is_a_full_32x16_frame_set(self):
        for style, background in CLOCK_BACKGROUNDS.items():
            with self.subTest(style=style):
                self.assertEqual((background.width, background.height), FULL_PANEL)
                self.assertGreaterEqual(len(background.frames), 1)
                for frame in background.frames:
                    self.assertEqual(len(frame), 32 * 16 * 3)
                self.assertGreater(background.delay_ms, 0)

    def test_known_frame_counts_from_the_vendor_gifs(self):
        # Spot-check against the actual extracted vendor GIFs (ic_clock_style_bg{n}_1632_
        # iledclock.gif frame counts), not just internal self-consistency.
        expected = {1: 24, 3: 40, 12: 36, 24: 21, 28: 1, 35: 1, 36: 1, 37: 1}
        for style, frame_count in expected.items():
            with self.subTest(style=style):
                self.assertEqual(len(CLOCK_BACKGROUNDS[style].frames), frame_count)

    def test_style_36_shares_geometry_with_37_but_is_its_own_bundled_resource(self):
        # Style 36's digit geometry is identical to 37's (vendor: one shared if-branch,
        # ILedClockClockTimeFragment.java:1058), but each has its own `clockBgImageId`
        # resource -- here both happen to be solid black (measured: every pixel of both
        # `ic_clock_style_bg{36,37}_1632_iledclock.gif` is (0, 0, 0)), a real, if visually
        # unexciting, vendor asset, not a bundling bug -- so they're pixel-*equal* here, but
        # bundled as two distinct catalogue entries rather than one style aliasing the other.
        self.assertEqual(CLOCK_STYLES[36], CLOCK_STYLES[37])
        self.assertEqual(CLOCK_BACKGROUNDS[36].frames, CLOCK_BACKGROUNDS[37].frames)
        self.assertEqual(CLOCK_BACKGROUNDS[36].frames[0], bytes(32 * 16 * 3))

    def test_date_background_is_a_full_32x16_frame_set(self):
        self.assertEqual((DATE_BACKGROUND.width, DATE_BACKGROUND.height), FULL_PANEL)
        self.assertEqual(len(DATE_BACKGROUND.frames), 1)
        self.assertEqual(len(DATE_BACKGROUND.frames[0]), 32 * 16 * 3)


class ClockProgramBackgroundCompositionTest(unittest.TestCase):
    """`program_builder.py`'s [background, native-content] shape, matching the vendor's own
    `combinePrograms` order and `programType`."""

    def _clock_program(self, style: int, **extra):
        return build_programs(
            [PlaylistItem(kind="clock", params={"style": style, "color": 6, **extra}, duration_s=10)], designs={}
        )[0]

    def test_background_defaults_on_and_sits_before_the_clock_digits(self):
        for style in (1, 16, 24, 36, 41):
            with self.subTest(style=style):
                program = self._clock_program(style)
                self.assertEqual(len(program.contents), 2)
                background, clock = program.contents
                self.assertIsInstance(background, AnimationContent)
                self.assertIsInstance(clock, ClockContent)
                self.assertEqual(clock.style_index, style)
                # Full panel, start (0, 0) -- ILedClockAnimationProgramContent's own
                # DEVICE_ROW/DEVICE_COLUMN branch, not confined to a sub-region like the
                # "icon with clock" art layer is.
                self.assertEqual((background.start_column, background.start_row), (0, 0))
                self.assertEqual((background.show_width, background.show_height), FULL_PANEL)
                self.assertEqual(len(background.frames), len(CLOCK_BACKGROUNDS[style].frames))
                # ILedClockAnimationProgramContent's own Java field default is 1
                # [VENDOR ILedClockManager.java:1307], not this port's dataclass default of 0;
                # neither vendor call site overrides it, so the wire byte the real device gets
                # is 1.
                self.assertEqual(background.layer_type, 1)
                self.assertEqual(program.resolved_program_type(), 7)
                self.assertTrue(program.is_clock_in_list)

    def test_background_frame_delay_matches_the_bundled_asset(self):
        program = self._clock_program(3)  # style 3: 40 frames @ 300ms in the vendor GIF
        background = program.contents[0]
        self.assertTrue(all(frame.duration_ms == 300 for frame in background.frames))

    def test_background_false_uploads_the_plain_firmware_clock_only(self):
        program = self._clock_program(1, background=False)
        self.assertEqual(len(program.contents), 1)
        self.assertIsInstance(program.contents[0], ClockContent)
        self.assertEqual(program.resolved_program_type(), 7)

    def test_unknown_style_still_errors_before_reaching_the_background_lookup(self):
        with self.assertRaises(ProgramBuildError):
            self._clock_program(999)


class DateBackgroundCompositionTest(unittest.TestCase):
    """The date companion screen: one shared background (`dateBgImageId`) for every style,
    `programType` 6 (`getClockCombineProgram`'s `iLedClockProgram2.programType = 6`)."""

    def _date_program(self, **extra):
        return build_programs(
            [PlaylistItem(kind="date", params={"color": 6, **extra}, duration_s=10)], designs={}
        )[0]

    def test_background_defaults_on_and_sits_before_the_date_digits(self):
        program = self._date_program()
        self.assertEqual(len(program.contents), 2)
        background, date = program.contents
        self.assertIsInstance(background, AnimationContent)
        self.assertIsInstance(date, DateContent)
        self.assertEqual((background.show_width, background.show_height), FULL_PANEL)
        self.assertEqual(background.layer_type, 1)
        self.assertEqual(len(background.frames), len(DATE_BACKGROUND.frames))
        self.assertEqual(program.resolved_program_type(), 6)

    def test_background_false_uploads_the_plain_date_only(self):
        program = self._date_program(background=False)
        self.assertEqual(len(program.contents), 1)
        self.assertIsInstance(program.contents[0], DateContent)
        self.assertEqual(program.resolved_program_type(), 6)


if __name__ == "__main__":
    unittest.main()
