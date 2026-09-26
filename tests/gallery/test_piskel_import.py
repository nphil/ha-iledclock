"""`importers.piskel` tests: synthetic `.piskel` JSON documents built by hand from the
verified real-world spec (double-JSON-encoded layers, `layout[col][row]` axis order,
opacity-scaled "over" compositing, `hiddenFrames`), not by round-tripping whatever
`piskel.load()` itself would produce.
"""

from __future__ import annotations

import base64
import io
import json
import unittest

from custom_components.iledclock.importers import DecodeError, DecodedImage
from custom_components.iledclock.importers import piskel


def _sheet_b64(width: int, height: int, tiles: dict[tuple[int, int], tuple[int, int, int, int]]) -> str:
    """Build a spritesheet PNG sized to fit every `(col, row)` key in `tiles`, paste a
    solid-color tile of `width`x`height` at each, and return a `data:` URI for it."""
    from PIL import Image

    max_col = max((c for c, _ in tiles), default=0)
    max_row = max((r for _, r in tiles), default=0)
    sheet = Image.new("RGBA", ((max_col + 1) * width, (max_row + 1) * height), (0, 0, 0, 0))
    for (col, row), color in tiles.items():
        sheet.paste(Image.new("RGBA", (width, height), color), (col * width, row * height))
    buf = io.BytesIO()
    sheet.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _layer(*, name: str, opacity: float, frame_count: int, chunks: list[dict]) -> str:
    return json.dumps(
        {"name": name, "opacity": opacity, "frameCount": frame_count, "chunks": chunks}
    )


def _piskel_bytes(*, width, height, fps, layers, hidden_frames=None) -> bytes:
    piskel_obj = {
        "name": "test",
        "description": "",
        "fps": fps,
        "width": width,
        "height": height,
        "layers": layers,
    }
    if hidden_frames is not None:
        piskel_obj["hiddenFrames"] = hidden_frames
    return json.dumps({"modelVersion": 1, "piskel": piskel_obj}).encode("utf-8")


class PiskelImportTests(unittest.TestCase):
    def test_reference_shape_two_frames_single_chunk(self) -> None:
        # Matches the verified real fixture exactly: layout=[[0],[1]] on a 16x16 canvas
        # -- outer list = 2 columns (X axis), inner list = 1 row each (Y axis), giving a
        # 32x16 spritesheet with frame 0 at (0,0)-(16,16) and frame 1 at (16,0)-(32,16).
        color0 = (255, 0, 0, 255)
        color1 = (0, 255, 0, 255)
        sheet = _sheet_b64(16, 16, {(0, 0): color0, (1, 0): color1})
        chunk = {"layout": [[0], [1]], "base64PNG": sheet}
        layer = _layer(name="L", opacity=1.0, frame_count=2, chunks=[chunk])
        data = _piskel_bytes(width=16, height=16, fps=3, layers=[layer])

        decoded = piskel.load(data)

        self.assertIsInstance(decoded, DecodedImage)
        self.assertEqual(len(decoded.frames), 2)
        self.assertEqual(decoded.delays_ms, [333, 333])
        for frame in decoded.frames:
            self.assertEqual(frame.size, (16, 16))
            self.assertEqual(frame.mode, "RGBA")
        self.assertEqual(decoded.frames[0].getpixel((0, 0)), color0)
        self.assertEqual(decoded.frames[0].getpixel((15, 15)), color0)
        self.assertEqual(decoded.frames[1].getpixel((0, 0)), color1)
        self.assertEqual(decoded.frames[1].getpixel((15, 15)), color1)

    def test_two_layers_alpha_blended_by_opacity(self) -> None:
        from PIL import Image

        bottom_color = (200, 50, 50, 255)
        top_color = (10, 10, 250, 255)
        bottom_sheet = _sheet_b64(4, 4, {(0, 0): bottom_color})
        top_sheet = _sheet_b64(4, 4, {(0, 0): top_color})
        bottom_layer = _layer(
            name="bottom",
            opacity=1.0,
            frame_count=1,
            chunks=[{"layout": [[0]], "base64PNG": bottom_sheet}],
        )
        top_layer = _layer(
            name="top",
            opacity=0.5,
            frame_count=1,
            chunks=[{"layout": [[0]], "base64PNG": top_sheet}],
        )
        data = _piskel_bytes(
            width=4, height=4, fps=10, layers=[bottom_layer, top_layer]
        )

        decoded = piskel.load(data)

        self.assertEqual(len(decoded.frames), 1)
        # Independently computed expected pixel: standard Porter-Duff "over" of the top
        # tile (alpha scaled by its layer opacity) onto the fully-opaque bottom tile --
        # not just the top layer's raw, unblended color.
        bottom_img = Image.new("RGBA", (4, 4), bottom_color)
        scaled_top = Image.new("RGBA", (4, 4), (*top_color[:3], round(top_color[3] * 0.5)))
        expected = Image.alpha_composite(bottom_img, scaled_top)
        self.assertEqual(decoded.frames[0].getpixel((0, 0)), expected.getpixel((0, 0)))
        self.assertNotEqual(decoded.frames[0].getpixel((0, 0)), top_color)
        self.assertNotEqual(decoded.frames[0].getpixel((0, 0)), bottom_color)

    def test_four_frames_split_across_two_chunks(self) -> None:
        colors = [
            (255, 0, 0, 255),
            (0, 255, 0, 255),
            (0, 0, 255, 255),
            (255, 255, 0, 255),
        ]
        chunk_a = {
            "layout": [[0], [1]],
            "base64PNG": _sheet_b64(4, 4, {(0, 0): colors[0], (1, 0): colors[1]}),
        }
        chunk_b = {
            "layout": [[2], [3]],
            "base64PNG": _sheet_b64(4, 4, {(0, 0): colors[2], (1, 0): colors[3]}),
        }
        layer = _layer(name="L", opacity=1.0, frame_count=4, chunks=[chunk_a, chunk_b])
        data = _piskel_bytes(width=4, height=4, fps=5, layers=[layer])

        decoded = piskel.load(data)

        self.assertEqual(len(decoded.frames), 4)
        for index, color in enumerate(colors):
            self.assertEqual(decoded.frames[index].getpixel((0, 0)), color)

    def test_hidden_frames_excluded_and_renumbered(self) -> None:
        colors = [
            (255, 0, 0, 255),
            (0, 255, 0, 255),
            (0, 0, 255, 255),
        ]
        sheet = _sheet_b64(
            4, 4, {(0, 0): colors[0], (1, 0): colors[1], (2, 0): colors[2]}
        )
        chunk = {"layout": [[0], [1], [2]], "base64PNG": sheet}
        layer = _layer(name="L", opacity=1.0, frame_count=3, chunks=[chunk])
        data = _piskel_bytes(
            width=4, height=4, fps=10, layers=[layer], hidden_frames=[1]
        )

        decoded = piskel.load(data)

        self.assertEqual(len(decoded.frames), 2)
        self.assertEqual(decoded.frames[0].getpixel((0, 0)), colors[0])
        self.assertEqual(decoded.frames[1].getpixel((0, 0)), colors[2])

    def test_null_layout_cell_is_skipped_not_a_crash(self) -> None:
        # col 0 has 2 rows: row 0 is frame 0, row 1 is an unused/null grid cell.
        color0 = (128, 64, 32, 255)
        sheet = _sheet_b64(4, 4, {(0, 0): color0})
        chunk = {"layout": [[0, None]], "base64PNG": sheet}
        layer = _layer(name="L", opacity=1.0, frame_count=1, chunks=[chunk])
        data = _piskel_bytes(width=4, height=4, fps=10, layers=[layer])

        decoded = piskel.load(data)

        self.assertEqual(len(decoded.frames), 1)
        self.assertEqual(decoded.frames[0].getpixel((0, 0)), color0)

    def test_no_layers_yields_single_transparent_frame(self) -> None:
        data = _piskel_bytes(width=8, height=6, fps=10, layers=[])

        decoded = piskel.load(data)

        self.assertEqual(len(decoded.frames), 1)
        self.assertEqual(decoded.frames[0].size, (8, 6))
        self.assertEqual(decoded.frames[0].getpixel((0, 0)), (0, 0, 0, 0))
        self.assertEqual(decoded.delays_ms, [100])

    def test_zero_fps_raises_decode_error(self) -> None:
        data = _piskel_bytes(width=4, height=4, fps=0, layers=[])
        with self.assertRaises(DecodeError):
            piskel.load(data)

    def test_garbage_bytes_raise_decode_error(self) -> None:
        with self.assertRaises(DecodeError):
            piskel.load(b"not json at all")

    def test_missing_piskel_key_raises_decode_error(self) -> None:
        with self.assertRaises(DecodeError):
            piskel.load(json.dumps({"modelVersion": 1}).encode("utf-8"))


if __name__ == "__main__":
    unittest.main()
