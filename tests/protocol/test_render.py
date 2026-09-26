"""``render.py`` verification: text rendering, Canvas drawing/PNG export, image import (static
and animated), and every generative effect -- all pure local rendering with no device
involvement, so these tests always run (no external fixture needed)."""

from __future__ import annotations

import io
import unittest

from protocol import render
from protocol.models import Frame

try:
    from PIL import Image

    _HAS_PIL = True
except ImportError:  # pragma: no cover - Pillow ships with HA core; this only guards a
    # from-scratch checkout of this repository that hasn't installed it yet.
    _HAS_PIL = False


@unittest.skipUnless(_HAS_PIL, "Pillow not installed")
class TextFramesTest(unittest.TestCase):
    def test_short_text_is_one_static_frame(self) -> None:
        frames = render.text_frames("HI", "5x7", (255, 0, 0))
        self.assertEqual(len(frames), 1)
        self.assertEqual((frames[0].width, frames[0].height), (32, 16))

    def test_long_text_scrolls_into_multiple_frames(self) -> None:
        frames = render.text_frames("THIS IS DEFINITELY WIDER THAN THE PANEL", "5x7", (0, 255, 0))
        self.assertGreater(len(frames), 1)
        self.assertTrue(all((f.width, f.height) == (32, 16) for f in frames))

    def test_unknown_character_falls_back_to_space(self) -> None:
        # Must not raise for a glyph this bundled font doesn't define.
        frames = render.text_frames("A\u2603B", "5x7", (255, 255, 255))
        self.assertEqual(len(frames), 1)

    def test_every_font_renders(self) -> None:
        for font in ("3x5", "5x7", "8x16"):
            frames = render.text_frames("12:30", font, (255, 255, 0))
            self.assertGreaterEqual(len(frames), 1)

    def test_lit_pixels_use_requested_colour_quantised(self) -> None:
        frames = render.text_frames("1", "5x7", (255, 0, 0))
        frame = frames[0]
        lit_pixels = {frame.pixels[row][col] for row in range(16) for col in range(32)} - {(0, 0, 0)}
        self.assertTrue(lit_pixels, "expected at least one lit pixel for a rendered digit")
        for color in lit_pixels:
            self.assertEqual(color, render.quantize((255, 0, 0)))


class CanvasTest(unittest.TestCase):
    def test_set_get_and_clear(self) -> None:
        canvas = render.Canvas(4, 3)
        canvas.set(1, 1, (10, 20, 30))
        self.assertEqual(canvas.get(1, 1), (10, 20, 30))
        canvas.clear((5, 5, 5))
        self.assertEqual(canvas.get(1, 1), (5, 5, 5))

    def test_set_out_of_bounds_is_a_no_op(self) -> None:
        canvas = render.Canvas(4, 3)
        canvas.set(-1, 0, (1, 2, 3))
        canvas.set(100, 0, (1, 2, 3))
        canvas.set(0, 100, (1, 2, 3))  # must not raise

    def test_blit_crops_to_canvas(self) -> None:
        canvas = render.Canvas(4, 4)
        big = [[(9, 9, 9)] * 4 for _ in range(4)]
        canvas.blit(big, 2, 2)  # half falls off the edge
        self.assertEqual(canvas.get(3, 3), render.quantize((9, 9, 9)) if False else (9, 9, 9))
        self.assertEqual(canvas.get(0, 0), (0, 0, 0))

    def test_to_frame_quantises(self) -> None:
        canvas = render.Canvas(2, 2)
        canvas.clear((100, 150, 200))
        frame = canvas.to_frame()
        self.assertIsInstance(frame, Frame)
        self.assertEqual(frame.pixels[0][0], render.quantize((100, 150, 200)))

    @unittest.skipUnless(_HAS_PIL, "Pillow not installed")
    def test_to_png_produces_valid_png(self) -> None:
        canvas = render.Canvas(4, 4)
        canvas.clear((255, 0, 0))
        png_bytes = canvas.to_png(scale=3)
        self.assertTrue(png_bytes.startswith(b"\x89PNG\r\n\x1a\n"))
        image = Image.open(io.BytesIO(png_bytes))
        self.assertEqual(image.size, (12, 12))


class QuantizeTest(unittest.TestCase):
    def test_black_and_white_survive(self) -> None:
        self.assertEqual(render.quantize((0, 0, 0)), (0, 0, 0))
        self.assertEqual(render.quantize((255, 255, 255)), (255, 255, 255))

    def test_reduces_to_16_levels_per_channel(self) -> None:
        seen = {render.quantize((v, 0, 0))[0] for v in range(256)}
        self.assertLessEqual(len(seen), 16)


@unittest.skipUnless(_HAS_PIL, "Pillow not installed")
class ImageToFramesTest(unittest.TestCase):
    @staticmethod
    def _png_bytes(width: int, height: int, color) -> bytes:
        image = Image.new("RGB", (width, height), color)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    def test_static_image_one_frame(self) -> None:
        data = self._png_bytes(64, 32, (0, 128, 255))
        frames = render.image_to_frames(data, fit="contain", dither=False, max_frames=8)
        self.assertEqual(len(frames), 1)
        self.assertEqual((frames[0].width, frames[0].height), (32, 16))

    def test_contain_letterboxes_without_cropping_content(self) -> None:
        # A very wide image "contain"-fit must not fill the whole 32x16 (it would be cropped
        # top/bottom under "cover" instead) -- some rows should remain the letterbox colour.
        data = self._png_bytes(320, 16, (200, 0, 0))
        frames = render.image_to_frames(data, fit="contain", dither=False, max_frames=1)
        pixels = frames[0].pixels
        self.assertEqual(pixels[0][0], (0, 0, 0), "expected a letterboxed (black) edge row")

    def test_cover_fills_entire_frame(self) -> None:
        data = self._png_bytes(320, 16, (200, 0, 0))
        frames = render.image_to_frames(data, fit="cover", dither=False, max_frames=1)
        pixels = frames[0].pixels
        # Every pixel should be some shade of red (the quantised source colour), not black.
        self.assertTrue(all(pixels[row][col] != (0, 0, 0) for row in range(16) for col in range(32)))

    def test_animated_gif_multiple_frames_with_durations(self) -> None:
        frames_src = [Image.new("RGB", (32, 16), (i * 40 % 255, 0, 0)) for i in range(3)]
        buffer = io.BytesIO()
        frames_src[0].save(buffer, format="GIF", save_all=True, append_images=frames_src[1:], duration=120, loop=0)
        frames = render.image_to_frames(buffer.getvalue(), fit="stretch", dither=False, max_frames=8)
        self.assertEqual(len(frames), 3)
        self.assertTrue(all(f.duration_ms == 120 for f in frames))

    def test_max_frames_caps_animated_gif(self) -> None:
        frames_src = [Image.new("RGB", (32, 16), (i * 20 % 255, 0, 0)) for i in range(10)]
        buffer = io.BytesIO()
        frames_src[0].save(buffer, format="GIF", save_all=True, append_images=frames_src[1:], duration=50, loop=0)
        frames = render.image_to_frames(buffer.getvalue(), fit="stretch", dither=False, max_frames=4)
        self.assertEqual(len(frames), 4)

    def test_dither_does_not_crash_and_stays_in_bounds(self) -> None:
        data = self._png_bytes(64, 32, (127, 64, 200))
        frames = render.image_to_frames(data, fit="contain", dither=True, max_frames=1)
        for row in frames[0].pixels:
            for pixel in row:
                self.assertTrue(all(0 <= c <= 255 for c in pixel))


class GenerativeTest(unittest.TestCase):
    def test_every_kind_produces_frames(self) -> None:
        for kind in render._GENERATORS:
            frames = render.generative(kind, seconds=1, seed=1)
            self.assertGreater(len(frames), 0)
            self.assertTrue(all((f.width, f.height) == (32, 16) for f in frames))

    def test_seed_reproducible(self) -> None:
        a = render.generative("fire", seconds=1, seed=99)
        b = render.generative("fire", seconds=1, seed=99)
        self.assertEqual([f.pixels for f in a], [f.pixels for f in b])

    def test_stateful_kinds_seed_reproducible(self) -> None:
        """"life"/"matrix"/"starfield" thread mutable state across frames (grid contents, drop
        positions) instead of computing each frame as a pure function of its own index -- a
        distinct code path from the other four kinds, worth its own reproducibility check
        (e.g. a mutable-default-argument or missed state-reassignment bug would only show up
        here, not in the stateless kinds' own test above)."""
        for kind in ("life", "matrix", "starfield"):
            a = render.generative(kind, seconds=2, seed=7)
            b = render.generative(kind, seconds=2, seed=7)
            self.assertEqual([f.pixels for f in a], [f.pixels for f in b], kind)

    def test_life_grid_evolves_across_frames(self) -> None:
        """Distinct consecutive frames (not a static image) is the one property that actually
        distinguishes a working cellular-automaton step from a no-op that just re-renders the
        same initial random fill every time."""
        frames = render.generative("life", seconds=2, seed=3)
        distinct = {tuple(tuple(row) for row in f.pixels) for f in frames}
        self.assertGreater(len(distinct), 1)

    def test_different_seed_differs(self) -> None:
        a = render.generative("sparkle", seconds=1, seed=1)
        b = render.generative("sparkle", seconds=1, seed=2)
        self.assertNotEqual([f.pixels for f in a], [f.pixels for f in b])

    def test_unknown_kind_raises(self) -> None:
        with self.assertRaises(ValueError):
            render.generative("not-a-real-effect", seconds=1)

    def test_palette_restricts_colours(self) -> None:
        palette = [(255, 0, 0), (0, 255, 0)]
        frames = render.generative("rainbow", seconds=1, seed=1, palette=palette)
        expected = {render.quantize(c) for c in palette} | {(0, 0, 0)}
        seen = {pixel for f in frames for row in f.pixels for pixel in row}
        self.assertTrue(seen.issubset(expected), seen - expected)

    def test_seconds_controls_frame_count(self) -> None:
        short = render.generative("plasma", seconds=1, seed=1)
        long = render.generative("plasma", seconds=2, seed=1)
        self.assertGreater(len(long), len(short))


if __name__ == "__main__":
    unittest.main()
