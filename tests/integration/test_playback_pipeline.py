"""From a saved design's Speed and Smooth motion to what is previewed and what is uploaded.

The panel previews with `design_playback` / `inline_playback` + `shape_playback_payload`; the clock gets
`build_programs` + `to_device_timing`. These tests pin that the two agree, and the choices a design (or
a service call) can make."""

from __future__ import annotations

import base64
import unittest

from custom_components.iledclock import hardware, retime
from custom_components.iledclock.designs import DesignValidationError, validate_design_payload
from custom_components.iledclock.playlist import PlaylistItem
from custom_components.iledclock.program_builder import (
    build_programs,
    design_playback,
    inline_playback,
    retimed_frames,
    to_device_timing,
)
from custom_components.iledclock.protocol.models import Frame
from custom_components.iledclock.protocol.programs import AnimationContent, ClockContent, GraffitiContent
from custom_components.iledclock.ws_shapes import shape_playback_payload
from tests.integration.test_retime import H, W, sliding

UNIT_MS = hardware.DEVICE_MS_PER_DELAY_UNIT


def b64(frame: bytes) -> str:
    return base64.b64encode(frame).decode("ascii")


def design_from(frames: list[bytes], delays: list[int], **extra):
    return validate_design_payload(
        {"name": "Slide", "kind": "animation", "frames": [b64(f) for f in frames], "delays": delays, **extra}
    )


def upload(design, **params):
    """What the clock is sent for the design, after the same conversions the upload applies."""
    item = PlaylistItem(kind="design", params={"design_id": design.id, **params}, duration_s=10)
    return to_device_timing(build_programs([item], designs={design.id: design}))[0]


def flat(frame: Frame) -> bytes:
    return bytes(channel for row in frame.pixels for pixel in row for channel in pixel)


class UploadTests(unittest.TestCase):
    def test_a_design_at_original_uploads_its_authored_frames_and_timing(self) -> None:
        frames = sliding()
        design = design_from(frames, [125, 90, 125, 125, 200, 125, 125, 125])
        animation = upload(design).contents[0]
        self.assertIsInstance(animation, AnimationContent)
        self.assertEqual([flat(f) for f in animation.frames], frames)
        self.assertEqual([f.duration_ms for f in animation.frames], [round(d / UNIT_MS) for d in (125, 90, 125, 125, 200, 125, 125, 125)])

    def test_the_stored_speed_and_smoothing_decide_what_is_uploaded(self) -> None:
        frames = sliding()
        design = design_from(frames, [125] * 8, speed=25)
        expected = retime.retime(frames, [125] * 8, 25)
        animation = upload(design).contents[0]
        self.assertGreater(len(expected.frames), 8)
        self.assertEqual([flat(f) for f in animation.frames], list(expected.frames))
        self.assertEqual([f.duration_ms for f in animation.frames], [round(d / UNIT_MS) for d in expected.delays_ms])

    def test_max_uploads_seven_units_per_frame(self) -> None:
        design = design_from(sliding(), [125] * 8, speed=100)
        self.assertEqual({f.duration_ms for f in upload(design).contents[0].frames}, {7})

    def test_still_uploads_one_picture_the_fullest_frame(self) -> None:
        frames = sliding()
        design = design_from(frames, [125] * 8, speed=0)
        content = upload(design).contents[0]
        self.assertIsInstance(content, GraffitiContent)
        self.assertEqual(flat(content.pixels), frames[retime.poster_frame_index(frames)])

    def test_a_service_call_overrides_the_stored_choice_without_changing_it(self) -> None:
        design = design_from(sliding(), [125] * 8, speed=25, smooth="on")
        frames = upload(design, speed=100, smooth="off").contents[0].frames
        self.assertEqual(len(frames), 8)
        self.assertEqual({f.duration_ms for f in frames}, {7})
        self.assertEqual((design.speed, design.smooth), (25, "on"))

    def test_a_bad_override_is_refused_not_ignored(self) -> None:
        design = design_from(sliding(), [125] * 8)
        with self.assertRaises(ValueError):
            upload(design, speed=250)

    def test_an_art_and_clock_design_retimes_only_the_columns_left_of_its_clock(self) -> None:
        frames = sliding(count=5, step=2)
        design = design_from(frames, [125] * 5, speed=20, clock_region=[16, 0, 16, 16])
        program = upload(design)
        art, clock = program.contents
        self.assertIsInstance(clock, ClockContent)
        self.assertEqual(art.show_width, 16)
        self.assertGreater(len(art.frames), 5)
        self.assertTrue(all(f.width == 16 for f in art.frames))

    def test_the_panel_previews_exactly_what_is_uploaded(self) -> None:
        design = design_from(sliding(), [125] * 8, speed=30)
        payload = shape_playback_payload(design_playback(design), 32)
        uploaded = upload(design).contents[0].frames
        self.assertEqual([base64.b64decode(f) for f in payload["frames"]], [flat(f) for f in uploaded])
        self.assertEqual([round(d / UNIT_MS) for d in payload["delays"]], [f.duration_ms for f in uploaded])
        self.assertEqual(payload["playback"]["frames"], len(uploaded))


class RenderedFramesTests(unittest.TestCase):
    """`show_image` / `show_generative` hand over rendered frames; a speed applies to them the same way."""

    def _frames(self) -> list[Frame]:
        out = []
        for frame in sliding(count=6, step=3):
            rows = [[tuple(frame[(y * W + x) * 3 : (y * W + x) * 3 + 3]) for x in range(W)] for y in range(H)]
            out.append(Frame(pixels=rows, duration_ms=100))
        return out

    def test_without_a_speed_the_frames_are_left_exactly_alone(self) -> None:
        frames = self._frames()
        self.assertEqual(retimed_frames(frames, {}), frames)
        self.assertEqual(retimed_frames(frames, {"smooth": "on"}), frames)

    def test_a_speed_rescales_them(self) -> None:
        result = retimed_frames(self._frames(), {"speed": 100})
        self.assertEqual({f.duration_ms for f in result}, {7 * UNIT_MS})
        self.assertEqual(len(result), 6)

    def test_a_single_frame_is_never_touched(self) -> None:
        one = self._frames()[:1]
        self.assertEqual(retimed_frames(one, {"speed": 100}), one)

    def test_a_bad_speed_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            retimed_frames(self._frames(), {"speed": -5})


class InlinePreviewTests(unittest.TestCase):
    def _message(self, **extra):
        frames = sliding(count=5, step=2)
        return {"frames": [b64(f) for f in frames], "delays": [125] * 5, "speed": 20, "smooth": None, **extra}

    def test_frames_sent_inline_are_retimed_like_a_saved_design(self) -> None:
        played, width = inline_playback(self._message())
        self.assertEqual(width, 32)
        self.assertEqual(played, retime.retime(sliding(count=5, step=2), [125] * 5, 20))

    def test_a_clock_region_narrows_the_art_and_the_payload_pads_it_back(self) -> None:
        played, width = inline_playback(self._message(clock_region={"x": 16, "y": 0, "w": 16, "h": 16}))
        self.assertEqual(width, 16)
        payload = shape_playback_payload(played, width)
        for encoded in payload["frames"]:
            frame = base64.b64decode(encoded)
            self.assertEqual(len(frame), W * H * 3)
            self.assertFalse(any(frame[(y * W + x) * 3 + c] for y in range(H) for x in range(16, W) for c in range(3)))

    def test_malformed_requests_are_refused(self) -> None:
        good = self._message()
        for bad in (
            {**good, "delays": [125] * 4},
            {**good, "frames": []},
            {**good, "frames": good["frames"] * 20, "delays": [125] * 100},
            {**good, "frames": ["not base64!!"] * 5},
            {**good, "clock_region": {"x": 30, "y": 0, "w": 16, "h": 16}},
            {**good, "speed": 500},
            {**good, "smooth": "sometimes"},
        ):
            with self.assertRaises(ValueError, msg=str(bad)[:60]):
                inline_playback(bad)

    def test_a_missing_picture_is_a_design_validation_error(self) -> None:
        with self.assertRaises(DesignValidationError):
            inline_playback({**self._message(), "frames": [b64(bytes(10))] * 5})


if __name__ == "__main__":
    unittest.main()
