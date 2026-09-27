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
