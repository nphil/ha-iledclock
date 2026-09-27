"""An "Icon with clock" design uploads as the art plus a live firmware clock, side by side."""
from __future__ import annotations

import base64
import unittest

from custom_components.iledclock.designs import DesignValidationError, validate_design_payload
from custom_components.iledclock.playlist import PlaylistItem
from custom_components.iledclock.program_builder import build_programs
from custom_components.iledclock.protocol.programs import ClockContent, GraffitiContent

FRAME = base64.b64encode(bytes(32 * 16 * 3)).decode()


def _design(**extra):
    return validate_design_payload({"name": "icon", "kind": "image", "frames": [FRAME], **extra})


class IconWithClockTest(unittest.TestCase):
    def test_design_with_clock_region_uploads_art_and_clock(self):
        design = _design(clock_region={"x": 16, "y": 0, "w": 16, "h": 16})
        program = build_programs([PlaylistItem(kind="design", params={"design_id": design.id}, duration_s=10)],
                                 designs={design.id: design})[0]
        art, clock = program.contents
        self.assertIsInstance(art, GraffitiContent)
        self.assertIsInstance(clock, ClockContent)
        self.assertEqual(art.show_width, 16)
        self.assertEqual(len(art.pixels.pixels[0]), 16)
        for seg in (clock.hour, clock.space_hour, clock.minute):
            self.assertGreaterEqual(seg.start_column, 16)
            self.assertLessEqual(seg.start_column + seg.width, 32)
        self.assertEqual(program.resolved_program_type(), 7)
        self.assertTrue(program.is_clock_in_list)

    def test_plain_design_is_a_single_full_screen_layer(self):
        design = _design()
        program = build_programs([PlaylistItem(kind="design", params={"design_id": design.id}, duration_s=10)],
                                 designs={design.id: design})[0]
        self.assertEqual(len(program.contents), 1)
        self.assertEqual(program.contents[0].show_width, 32)
        self.assertFalse(program.is_clock_in_list)

    def test_clock_region_must_fit_hh_mm(self):
        with self.assertRaises(DesignValidationError):
            _design(clock_region={"x": 24, "y": 0, "w": 8, "h": 16})

    def test_clock_region_survives_storage(self):
        from custom_components.iledclock.designs import Design

        design = _design(clock_region=[16, 0, 16, 16])
        self.assertEqual(Design.from_storage(design.to_storage()).clock_region, (16, 0, 16, 16))


if __name__ == "__main__":
    unittest.main()


class ClockStyleGeometryTest(unittest.TestCase):
    """Regression: clocks rendered as fragments because digit size was left at 1x1 and segment
    positions were invented instead of the vendor's per-style geometry."""

    def test_clock_face_uses_the_vendor_geometry(self):
        from custom_components.iledclock.clock_styles import CLOCK_STYLES

        program = build_programs([PlaylistItem(kind="clock", params={"style": 1}, duration_s=10)], designs={})[0]
        clock = program.contents[0]
        style = CLOCK_STYLES[1]
        self.assertEqual((clock.num_width, clock.num_height), (style.num_width, style.num_height))
        self.assertEqual((clock.hour.start_column, clock.hour.start_row, clock.hour.width, clock.hour.height), style.hour)
        self.assertEqual((clock.minute.start_column, clock.minute.width), style.minute[0:1] + style.minute[2:3])

    def test_icon_with_clock_picks_a_half_panel_vendor_style(self):
        design = _design(clock_region={"x": 16, "y": 0, "w": 16, "h": 16})
        clock = build_programs([PlaylistItem(kind="design", params={"design_id": design.id}, duration_s=10)],
                               designs={design.id: design})[0].contents[1]
        self.assertEqual(clock.style_index, 16)
        self.assertEqual((clock.num_width, clock.num_height), (6, 7))
