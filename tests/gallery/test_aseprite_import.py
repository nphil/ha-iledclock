"""`importers.aseprite` tests: every sample `.aseprite` file is hand-built byte-for-byte
from the official spec (github.com/aseprite/aseprite `docs/ase-file-specs.md`) using the
small encoder helpers below -- never by round-tripping whatever `load()` itself would
produce -- so a passing test is evidence the decoder actually agrees with the written
format, not just that it's internally consistent with itself.
"""

from __future__ import annotations

import struct
import unittest
import zlib

from custom_components.iledclock.importers import DecodeError, DecodedImage
from custom_components.iledclock.importers import aseprite

_HEADER_MAGIC = 0xA5E0
_FRAME_MAGIC = 0xF1FA
_CHUNK_LAYER = 0x2004
_CHUNK_CEL = 0x2005
_CHUNK_PALETTE = 0x2019


def _header(
    *,
    frames: int,
    width: int,
    height: int,
    depth: int,
    flags: int = 0,
    speed: int = 100,
    transparent_index: int = 0,
) -> bytes:
    return struct.pack(
        "<IHHHHHIHIIB3sHBBhhHH84s",
        0,  # file size -- unused by the decoder
        _HEADER_MAGIC,
        frames,
        width,
        height,
        depth,
        flags,
        speed,
        0,
        0,
        transparent_index,
        b"\x00\x00\x00",
        0,  # number of colors
        0,  # pixel width
        0,  # pixel height
        0,  # grid x
        0,  # grid y
        0,  # grid width
        0,  # grid height
        b"\x00" * 84,
    )


def _layer_chunk(
    *, flags: int, layer_type: int, child_level: int, opacity: int = 255, blend_mode: int = 0
) -> bytes:
    name = b"layer"
    body = struct.pack(
        "<HHHHHHB3s", flags, layer_type, child_level, 0, 0, blend_mode, opacity, b"\x00\x00\x00"
    )
    body += struct.pack("<H", len(name)) + name
    return struct.pack("<IH", 6 + len(body), _CHUNK_LAYER) + body


def _cel_chunk_image(
    *, layer_index: int, x: int, y: int, opacity: int, width: int, height: int,
    pixels: bytes, z_index: int = 0, compressed: bool = True,
) -> bytes:
    cel_type = 2 if compressed else 0
    payload = zlib.compress(pixels) if compressed else pixels
    fixed = struct.pack(
        "<HhhBHh5s", layer_index, x, y, opacity, cel_type, z_index, b"\x00" * 5
    )
    body = fixed + struct.pack("<HH", width, height) + payload
    return struct.pack("<IH", 6 + len(body), _CHUNK_CEL) + body


def _cel_chunk_linked(*, layer_index: int, x: int, y: int, opacity: int, linked_frame: int) -> bytes:
    fixed = struct.pack("<HhhBHh5s", layer_index, x, y, opacity, 1, 0, b"\x00" * 5)
    body = fixed + struct.pack("<H", linked_frame)
    return struct.pack("<IH", 6 + len(body), _CHUNK_CEL) + body


def _palette_chunk(entries: dict, first_index: int, last_index: int, new_size: int) -> bytes:
    body = struct.pack("<III8s", new_size, first_index, last_index, b"\x00" * 8)
    for index in range(first_index, last_index + 1):
        r, g, b, a = entries.get(index, (0, 0, 0, 0))
        body += struct.pack("<HBBBB", 0, r, g, b, a)
    return struct.pack("<IH", 6 + len(body), _CHUNK_PALETTE) + body


def _frame(chunks: list, duration_ms: int) -> bytes:
    chunk_data = b"".join(chunks)
    header = struct.pack(
        "<IHHH2sI", 16 + len(chunk_data), _FRAME_MAGIC, len(chunks), duration_ms, b"\x00\x00", 0
    )
    return header + chunk_data


def _rgba_fill(width: int, height: int, color: tuple) -> bytes:
    return bytes(color) * (width * height)


def _rgba_grid(width: int, height: int, color_at) -> bytes:
    out = bytearray()
    for y in range(height):
        for x in range(width):
            out.extend(color_at(x, y))
    return bytes(out)


class AsepriteSingleLayerTests(unittest.TestCase):
    def test_single_32bpp_compressed_cel_round_trips_exact_pixels(self) -> None:
        colors = {
            (0, 0): (10, 20, 30, 255), (1, 0): (40, 50, 60, 255),
            (2, 0): (70, 80, 90, 255), (3, 0): (100, 110, 120, 255),
            (0, 1): (11, 21, 31, 200), (1, 1): (41, 51, 61, 150),
            (2, 1): (71, 81, 91, 100), (3, 1): (101, 111, 121, 50),
            (0, 2): (12, 22, 32, 255), (1, 2): (42, 52, 62, 255),
            (2, 2): (72, 82, 92, 255), (3, 2): (102, 112, 122, 255),
            (0, 3): (13, 23, 33, 60), (1, 3): (43, 53, 63, 90),
            (2, 3): (73, 83, 93, 120), (3, 3): (103, 113, 123, 150),
        }
        pixels = _rgba_grid(4, 4, lambda x, y: colors[(x, y)])
        data = _header(frames=1, width=4, height=4, depth=32) + _frame(
            [
                _layer_chunk(flags=1, layer_type=0, child_level=0, opacity=255),
                _cel_chunk_image(layer_index=0, x=0, y=0, opacity=255, width=4, height=4, pixels=pixels),
            ],
            duration_ms=50,
        )

        decoded = aseprite.load(data)

        self.assertIsInstance(decoded, DecodedImage)
        self.assertEqual(len(decoded.frames), 1)
        self.assertEqual(decoded.delays_ms, [50])
        frame = decoded.frames[0]
        self.assertEqual(frame.size, (4, 4))
        self.assertEqual(frame.mode, "RGBA")
        for (x, y), expected in colors.items():
            self.assertEqual(frame.getpixel((x, y)), expected, f"pixel ({x},{y})")


class AsepriteCompositingTests(unittest.TestCase):
    def test_two_layers_alpha_blend_with_layer_opacity(self) -> None:
        bottom_color = (10, 20, 30, 255)
        top_color = (0, 255, 0, 255)
        top_layer_opacity = 128

        bottom_pixels = _rgba_fill(4, 4, bottom_color)
        top_pixels = _rgba_fill(2, 2, top_color)

        data = _header(frames=1, width=4, height=4, depth=32, flags=1) + _frame(
            [
                _layer_chunk(flags=1, layer_type=0, child_level=0, opacity=255),
                _layer_chunk(flags=1, layer_type=0, child_level=0, opacity=top_layer_opacity),
                _cel_chunk_image(
                    layer_index=0, x=0, y=0, opacity=255, width=4, height=4, pixels=bottom_pixels
                ),
                _cel_chunk_image(
                    layer_index=1, x=1, y=1, opacity=255, width=2, height=2, pixels=top_pixels
                ),
            ],
            duration_ms=75,
        )

        decoded = aseprite.load(data)
        frame = decoded.frames[0]

        # Untouched corner: only the opaque bottom layer covers it.
        self.assertEqual(frame.getpixel((0, 0)), bottom_color)
        self.assertEqual(frame.getpixel((3, 3)), bottom_color)

        # Patch area: bottom is fully opaque, so the blended result must stay fully
        # opaque, with RGB pulled toward top_color by top_layer_opacity/255.
        frac = top_layer_opacity / 255.0
        expected_r = top_color[0] * frac + bottom_color[0] * (1 - frac)
        expected_g = top_color[1] * frac + bottom_color[1] * (1 - frac)
        expected_b = top_color[2] * frac + bottom_color[2] * (1 - frac)
        for px in ((1, 1), (2, 1), (1, 2), (2, 2)):
            r, g, b, a = frame.getpixel(px)
            self.assertEqual(a, 255, f"pixel {px} alpha")
            self.assertAlmostEqual(r, expected_r, delta=2, msg=f"pixel {px} red")
            self.assertAlmostEqual(g, expected_g, delta=2, msg=f"pixel {px} green")
            self.assertAlmostEqual(b, expected_b, delta=2, msg=f"pixel {px} blue")

    def test_invisible_group_hides_child_layer_cel(self) -> None:
        control_color = (255, 0, 0, 255)
        hidden_color = (0, 255, 0, 255)

        control_pixels = _rgba_fill(4, 4, control_color)
        hidden_pixels = _rgba_fill(2, 2, hidden_color)

        data = _header(frames=1, width=4, height=4, depth=32) + _frame(
            [
                _layer_chunk(flags=1, layer_type=0, child_level=0, opacity=255),  # index 0: control
                _layer_chunk(flags=0, layer_type=1, child_level=0, opacity=255),  # index 1: invisible group
                _layer_chunk(flags=1, layer_type=0, child_level=1, opacity=255),  # index 2: child of group
                _cel_chunk_image(
                    layer_index=0, x=0, y=0, opacity=255, width=4, height=4, pixels=control_pixels
                ),
                _cel_chunk_image(
                    layer_index=2, x=1, y=1, opacity=255, width=2, height=2, pixels=hidden_pixels
                ),
            ],
            duration_ms=40,
        )

        decoded = aseprite.load(data)
        frame = decoded.frames[0]

        # The child layer's cel must contribute nothing: the control layer beneath it
        # remains fully visible everywhere, including under the hidden patch.
        for x in range(4):
            for y in range(4):
                self.assertEqual(frame.getpixel((x, y)), control_color, f"pixel ({x},{y})")


class AsepriteAnimationTests(unittest.TestCase):
    def test_frame_durations_and_linked_cel(self) -> None:
        frame0_pixels = _rgba_fill(2, 2, (5, 6, 7, 255))
        frame2_pixels = _rgba_fill(2, 2, (200, 201, 202, 255))

        data = _header(frames=3, width=2, height=2, depth=32, speed=999) + b"".join(
            [
                _frame(
                    [
                        _layer_chunk(flags=1, layer_type=0, child_level=0, opacity=255),
                        _cel_chunk_image(
                            layer_index=0, x=0, y=0, opacity=255, width=2, height=2,
                            pixels=frame0_pixels,
                        ),
                    ],
                    duration_ms=30,
                ),
                _frame(
                    [_cel_chunk_linked(layer_index=0, x=0, y=0, opacity=255, linked_frame=0)],
                    duration_ms=45,
                ),
                _frame(
                    [
                        _cel_chunk_image(
                            layer_index=0, x=0, y=0, opacity=255, width=2, height=2,
                            pixels=frame2_pixels,
                        ),
                    ],
                    duration_ms=60,
                ),
            ]
        )

        decoded = aseprite.load(data)

        self.assertEqual(len(decoded.frames), 3)
        self.assertEqual(decoded.delays_ms, [30, 45, 60])
        for x in range(2):
            for y in range(2):
                self.assertEqual(
                    decoded.frames[1].getpixel((x, y)), decoded.frames[0].getpixel((x, y))
                )
        self.assertEqual(decoded.frames[2].getpixel((0, 0)), (200, 201, 202, 255))

    def test_zero_duration_frame_falls_back_to_header_speed(self) -> None:
        pixels = _rgba_fill(2, 2, (1, 2, 3, 255))
        data = _header(frames=1, width=2, height=2, depth=32, speed=123) + _frame(
            [
                _layer_chunk(flags=1, layer_type=0, child_level=0, opacity=255),
                _cel_chunk_image(layer_index=0, x=0, y=0, opacity=255, width=2, height=2, pixels=pixels),
            ],
            duration_ms=0,
        )

        decoded = aseprite.load(data)

        self.assertEqual(decoded.delays_ms, [123])


class AsepriteIndexedTests(unittest.TestCase):
    def test_indexed_8bpp_transparent_index_and_palette(self) -> None:
        transparent_index = 5
        palette_entries = {
            1: (200, 150, 50, 255),
            2: (10, 20, 30, 255),
            5: (99, 99, 99, 200),  # deliberately non-transparent-looking; must be ignored
        }
        # 2x2 indexed pixel grid: (0,0)=1 (0,1)=1 (1,0)=5(transparent) (1,1)=2
        index_pixels = bytes([1, 5, 1, 2])

        data = _header(
            frames=1, width=2, height=2, depth=8, transparent_index=transparent_index
        ) + _frame(
            [
                _layer_chunk(flags=1, layer_type=0, child_level=0, opacity=255),
                _palette_chunk(palette_entries, first_index=0, last_index=5, new_size=6),
                _cel_chunk_image(
                    layer_index=0, x=0, y=0, opacity=255, width=2, height=2, pixels=index_pixels
                ),
            ],
            duration_ms=10,
        )

        decoded = aseprite.load(data)
        frame = decoded.frames[0]

        self.assertEqual(frame.getpixel((0, 0)), (200, 150, 50, 255))
        self.assertEqual(frame.getpixel((1, 0)), (0, 0, 0, 0))
        self.assertEqual(frame.getpixel((0, 1)), (200, 150, 50, 255))
        self.assertEqual(frame.getpixel((1, 1)), (10, 20, 30, 255))


class AsepriteErrorTests(unittest.TestCase):
    def test_garbage_bytes_raise_decode_error(self) -> None:
        with self.assertRaises(DecodeError):
            aseprite.load(b"not an aseprite file, just random bytes 0123456789")

    def test_truncated_header_raises_decode_error(self) -> None:
        with self.assertRaises(DecodeError):
            aseprite.load(b"\x00" * 40)


if __name__ == "__main__":
    unittest.main()
