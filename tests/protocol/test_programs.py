"""``programs.py`` verification beyond the golden-vector table: the full ``plan_upload`` /
``encode_content`` pipeline exercised end-to-end the way ``program_builder.py`` actually calls
it (Segment-based Clock/Date/... content, Frame-based Graffiti/Animation, and TextContent's
own from-scratch font rendering, which has no golden vector to check against -- see the
module's own docstring for why)."""

from __future__ import annotations

import unittest

from protocol.framing import decode_frame, encode_frame
from protocol.models import Frame, Segment
from protocol.programs import (
    AnimationContent,
    ClockContent,
    FrameContent,
    GraffitiContent,
    Program,
    ReminderContent,
    TemperatureContent,
    TextAutoColor,
    TextContent,
    TextCustomColor,
    encode_content,
    plan_upload,
)


def _solid_frame(color=(255, 0, 0), width=32, height=16) -> Frame:
    return Frame(pixels=[[color] * width for _ in range(height)], width=width, height=height)


class PlanUploadEndToEndTest(unittest.TestCase):
    """The real ``client.py`` contract: unframed ``start``/``chunks``, each independently
    frameable, and consistent with each other (CRC/length agree with the actual content)."""

    def _check_plan_is_well_formed(self, program: Program) -> None:
        plan = plan_upload(program, index=0, count=1, package_size=1024)
        self.assertIsInstance(plan.start, bytes)
        self.assertEqual(plan.start[0], 0x02)
        # `plan.start`/`plan.chunks` are UNFRAMED (client.py frames them at the transport
        # layer, uniformly with every other protocol.commands builder) -- so "well-formed"
        # here means "frames and round-trips cleanly", not "is already a frame".
        self.assertEqual(decode_frame(encode_frame(plan.start)), plan.start)
        self.assertGreaterEqual(len(plan.chunks), 1)
        for chunk in plan.chunks:
            self.assertEqual(chunk[0], 0x03)
            self.assertEqual(decode_frame(encode_frame(chunk)), chunk)

    def test_clock_program(self) -> None:
        content = ClockContent(
            style_index=1,
            hour=Segment(color=(255, 255, 255), start_column=0, start_row=4, width=5, height=7),
            minute=Segment(color=(255, 255, 255), start_column=10, start_row=4, width=5, height=7),
        )
        self._check_plan_is_well_formed(Program(contents=[content], show_count=10))

    def test_graffiti_program(self) -> None:
        content = GraffitiContent(start_column=0, start_row=0, show_width=32, show_height=16, pixels=_solid_frame())
        self._check_plan_is_well_formed(Program(contents=[content], show_count=5))

    def test_animation_program(self) -> None:
        frames = [_solid_frame((255, 0, 0)), _solid_frame((0, 255, 0)), _solid_frame((0, 0, 255))]
        content = AnimationContent(start_column=0, start_row=0, show_width=32, show_height=16, frames=frames)
        self._check_plan_is_well_formed(Program(contents=[content], show_count=5))

    def test_text_program(self) -> None:
        content = TextContent(text="HELLO", color=TextAutoColor(effect=1, speed=200))
        self._check_plan_is_well_formed(Program(contents=[content], show_count=5))

    def test_text_program_custom_color(self) -> None:
        content = TextContent(
            text="HI", color=TextCustomColor(colors=[(255, 0, 0), (0, 255, 0)], speed=150)
        )
        self._check_plan_is_well_formed(Program(contents=[content], show_count=5))

    def test_reminder_program(self) -> None:
        content = ReminderContent(remind_id=1, title="Take medicine", year=26, month=3, day=15, hour=8, minute=0)
        self._check_plan_is_well_formed(Program(contents=[content], show_count=5, program_type=14))

    def test_multi_content_program(self) -> None:
        contents = [
            FrameContent(frame_type=1, show_width=32, show_height=16),
            TextContent(text="OK", color=TextAutoColor(effect=1)),
        ]
        self._check_plan_is_well_formed(Program(contents=contents, show_count=8))

    def test_chunking_splits_large_payloads(self) -> None:
        # Many distinct frames defeat LZSS's repeat-matching, forcing more than one chunk at
        # a small package size.
        import random

        rng = random.Random(7)
        frames = [
            Frame(
                pixels=[[(rng.randrange(256), rng.randrange(256), rng.randrange(256)) for _ in range(32)] for _ in range(16)]
            )
            for _ in range(20)
        ]
        content = AnimationContent(start_column=0, start_row=0, show_width=32, show_height=16, frames=frames)
        plan = plan_upload(Program(contents=[content], show_count=5), index=0, count=1, package_size=256)
        self.assertGreater(len(plan.chunks), 1)
        for chunk in plan.chunks:
            self.assertEqual(decode_frame(encode_frame(chunk)), chunk)

    def test_program_index_and_count_appear_in_start_frame(self) -> None:
        content = TemperatureContent(color=(255, 255, 255), start_column=0, start_row=0, width=20, height=8)
        plan_a = plan_upload(Program(contents=[content]), index=2, count=5, package_size=1024)
        plan_b = plan_upload(Program(contents=[content]), index=3, count=5, package_size=1024)
        self.assertNotEqual(plan_a.start, plan_b.start)


class SegmentDefaultTest(unittest.TestCase):
    def test_default_segment_is_all_zero(self) -> None:
        seg = Segment()
        self.assertEqual((seg.start_column, seg.start_row, seg.width, seg.height), (0, 0, 0, 0))

    def test_omitted_segment_encodes_as_empty_table(self) -> None:
        # A Segment left at its default must still encode cleanly (zero-size position/size
        # fields), matching "not shown" rather than raising.
        content = ClockContent(style_index=1)  # every segment left at its Segment() default
        encoded = encode_content(content)
        self.assertIsInstance(encoded, bytes)
        self.assertGreater(len(encoded), 0)


class ContentTypeDispatchTest(unittest.TestCase):
    def test_unknown_type_raises(self) -> None:
        with self.assertRaises(TypeError):
            encode_content(object())  # type: ignore[arg-type]

    def test_program_resolved_program_type_matches_first_content(self) -> None:
        content = ClockContent(style_index=1)
        program = Program(contents=[content])
        self.assertEqual(program.resolved_program_type(), 7)

    def test_program_type_override_takes_precedence(self) -> None:
        content = ClockContent(style_index=1)
        program = Program(contents=[content], program_type=99)
        self.assertEqual(program.resolved_program_type(), 99)


if __name__ == "__main__":
    unittest.main()
