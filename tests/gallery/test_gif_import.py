"""`importers.gif` tests: a synthetic animated GIF built with Pillow itself, so the
round trip proves Pillow's own disposal-method compositing surfaces correctly through
`load()` -- not just that we can re-read what we just wrote verbatim."""

from __future__ import annotations

import io
import unittest

from custom_components.iledclock.importers import DecodeError, DecodedImage
from custom_components.iledclock.importers import gif

_SIZE = (4, 4)


def _frame(fill, dot=None, dot_color=None):
    from PIL import Image

    img = Image.new("RGBA", _SIZE, (*fill, 255))
    if dot is not None:
        img.putpixel(dot, (*dot_color, 255))
    return img


def _build_gif(*, disposal, durations) -> bytes:
    disp0 = _frame((255, 0, 0))
    disp1 = _frame((255, 0, 0), dot=(0, 0), dot_color=(0, 255, 0))
    disp2 = _frame((255, 0, 0), dot=(3, 3), dot_color=(0, 0, 255))
    buf = io.BytesIO()
    disp0.save(
        buf, format="GIF", save_all=True, append_images=[disp1, disp2],
        disposal=disposal, duration=durations, loop=0, optimize=False,
    )
    return buf.getvalue()


def _build_still_png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (3, 5), (10, 20, 30, 255)).save(buf, format="PNG")
    return buf.getvalue()


class GifImportTests(unittest.TestCase):
    def test_animated_gif_frames_are_composited_not_raw_diffs(self) -> None:
        # disposal=2 (restore to background) on every frame is the case most likely to
        # leak an undisposed diff if compositing were done wrong.
        data = _build_gif(disposal=[2, 2, 2], durations=[80, 90, 100])

        decoded = gif.load(data)

        self.assertIsInstance(decoded, DecodedImage)
        self.assertEqual(len(decoded.frames), 3)
        self.assertEqual(decoded.delays_ms, [80, 90, 100])
        # Frame 2 must show red + the blue dot -- NOT the green dot from frame 1, which
        # a naive "just paste each frame over the last" reader would leak through.
        frame2 = decoded.frames[2]
        self.assertEqual(frame2.getpixel((0, 0)), (255, 0, 0, 255))
        self.assertEqual(frame2.getpixel((3, 3)), (0, 0, 255, 255))
        self.assertEqual(frame2.getpixel((1, 1)), (255, 0, 0, 255))
        # Frame 1 must show the green dot (not yet disposed).
        frame1 = decoded.frames[1]
        self.assertEqual(frame1.getpixel((0, 0)), (0, 255, 0, 255))

    def test_all_frames_same_size_and_rgba(self) -> None:
        data = _build_gif(disposal=[0, 0, 0], durations=[50, 50, 50])
        decoded = gif.load(data)
        for frame in decoded.frames:
            self.assertEqual(frame.size, _SIZE)
            self.assertEqual(frame.mode, "RGBA")

    def test_still_image_is_one_frame_zero_delay(self) -> None:
        decoded = gif.load(_build_still_png())
        self.assertEqual(len(decoded.frames), 1)
        self.assertEqual(decoded.delays_ms, [0])
        self.assertEqual(decoded.frames[0].size, (3, 5))

    def test_garbage_bytes_raise_decode_error(self) -> None:
        with self.assertRaises(DecodeError):
            gif.load(b"not an image at all, just some random bytes 0123456789")


if __name__ == "__main__":
    unittest.main()
