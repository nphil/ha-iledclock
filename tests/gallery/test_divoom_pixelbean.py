"""`gallery.divoom_pixelbean` decoder tests.

No live Divoom account was available for this port (see the assignment report), so every
test here builds its own synthetic container byte-for-byte from the *documented* format
(AES-CBC with the known fixed key/IV, LZO, zstd, embedded JPEG/GIF) using a from-scratch
encoder helper below -- never by calling the decoder and re-feeding its own output. That
is a real correctness check: it proves the decode direction agrees with the documented
byte layout, because the "encoder" here is nothing but that same documented layout
written out independently. The one exception is the hierarchical quadtree sub-decoder
used by some format-26 frames (marker bytes 0x11/0x13/0x15): there is no independent way
to construct a valid file for it without re-deriving Divoom's own private encoder, so it
is untested here -- see its docstring in `divoom_pixelbean.py`.
"""

from __future__ import annotations

import struct
import unittest

from custom_components.iledclock.gallery import divoom_pixelbean as dpb

_AES_KEY = b"78hrey23y28ogs89"
_AES_IV = b"1234567890123456"


def _aes_encrypt(data: bytes) -> bytes:
    from Crypto.Cipher import AES

    cipher = AES.new(_AES_KEY, AES.MODE_CBC, _AES_IV)
    pad = (-len(data)) % 16
    return cipher.encrypt(data + b"\x00" * pad)


def _lzo_compress(data: bytes) -> bytes:
    import lzallright

    return lzallright.LZOCompressor().compress(data)


def _solid_tile(rgb: tuple[int, int, int], width: int = 16, height: int = 16) -> bytes:
    return bytes(rgb) * (width * height)


def _tile_major(colors: list[tuple[int, int, int]]) -> bytes:
    """Raw pixel stream in the tile-major order `_compact` expects: each 16x16 tile
    written scanline-by-scanline, tiles enumerated in `colors` order."""
    return b"".join(_solid_tile(c) for c in colors)


def _pixel_at(frame: bytes, x: int, y: int, width: int) -> tuple[int, int, int]:
    off = (y * width + x) * 3
    return tuple(frame[off : off + 3])


def _bits_needed(n: int) -> int:
    if n <= 1:
        return 0
    bits = 1
    while (1 << bits) < n:
        bits += 1
    return bits


def _pack_indices_lsb(indices: list[int], bits: int) -> bytes:
    if bits == 0:
        return b""
    out = bytearray()
    acc = nbits = 0
    for value in indices:
        acc |= (value & ((1 << bits) - 1)) << nbits
        nbits += bits
        while nbits >= 8:
            out.append(acc & 0xFF)
            acc >>= 8
            nbits -= 8
    if nbits:
        out.append(acc & 0xFF)
    return bytes(out)


def _encode_0x0c_frame(palette: list[tuple[int, int, int]], indices: list[int]) -> bytes:
    """Build one 0x0C bit-packed frame per `FILE_FORMATS.md`/`divoom_pixelbean.py`'s
    documented layout: an 8-byte header (byte 5 = 0x0C, byte 6 = palette count, byte 7 =
    0), the palette (RGB triples), then LSB-first bit-packed palette indices."""
    n = len(palette)
    bits = _bits_needed(n)
    header_len = n * 3
    head = bytearray(8)
    head[5] = 0x0C
    head[6] = n if n < 256 else 0
    palette_bytes = b"".join(bytes(c) for c in palette)
    body = _pack_indices_lsb(indices, bits)
    return bytes(head) + palette_bytes + body


class Format8Tests(unittest.TestCase):
    def test_single_16x16_picture_round_trips(self) -> None:
        frame = _solid_tile((10, 20, 30))
        data = b"\x08" + _aes_encrypt(frame)

        result = dpb.decode(data)

        self.assertEqual((result.width, result.height), (16, 16))
        self.assertEqual(len(result.frames_rgb), 1)
        self.assertEqual(result.frames_rgb[0], frame)


class Format9Tests(unittest.TestCase):
    def test_two_frame_animation_round_trips_with_speed(self) -> None:
        frame_a = _solid_tile((100, 0, 0))
        frame_b = _solid_tile((0, 100, 0))
        speed = 250
        plain = frame_a + frame_b
        data = b"\x09" + bytes([0xAB]) + struct.pack(">H", speed) + _aes_encrypt(plain)

        result = dpb.decode(data)

        self.assertEqual((result.width, result.height), (16, 16))
        self.assertEqual(result.delay_ms, speed)
        self.assertEqual(result.frames_rgb, [frame_a, frame_b])


class Format12BannerTests(unittest.TestCase):
    def test_banner_slides_across_four_tiles_with_wraparound(self) -> None:
        tiles = [(i * 40, 0, 0) for i in range(4)]
        plain = _tile_major(tiles)
        speed = 80
        data = b"\x0c" + bytes([1]) + struct.pack(">H", speed) + _aes_encrypt(plain)

        result = dpb.decode(data)

        self.assertEqual((result.width, result.height), (16, 16))
        self.assertEqual(result.delay_ms, speed)
        self.assertEqual(len(result.frames_rgb), 64)
        # Frame 0: window at the strip's start shows tile 0's color.
        self.assertEqual(_pixel_at(result.frames_rgb[0], 0, 0, 16), tiles[0])
        # Frame 16: window shifted a full tile right shows tile 1's color at its left edge.
        self.assertEqual(_pixel_at(result.frames_rgb[16], 0, 0, 16), tiles[1])
        # Frame 56 (64-8): window straddles the wrap point back to tile 0.
        self.assertEqual(_pixel_at(result.frames_rgb[56], 8, 0, 16), tiles[0])


class Format17Tests(unittest.TestCase):
    def test_multi_tile_picture_2x2_grid(self) -> None:
        row_count, column_count = 2, 2
        colors = [(10, 10, 10), (20, 20, 20), (30, 30, 30), (40, 40, 40)]
        plain = _tile_major(colors)
        compressed = _lzo_compress(plain)
        data = (
            b"\x11"
            + bytes([row_count, column_count])
            + struct.pack(">I", len(compressed))
            + _aes_encrypt(compressed)
        )

        result = dpb.decode(data)

        self.assertEqual((result.width, result.height), (32, 32))
        self.assertEqual(len(result.frames_rgb), 1)
        frame = result.frames_rgb[0]
        # tile (col=0,row=0) at pixel (0,0); tile (col=1,row=0) at pixel (16,0).
        self.assertEqual(_pixel_at(frame, 0, 0, 32), colors[0])
        self.assertEqual(_pixel_at(frame, 20, 0, 32), colors[1])
        self.assertEqual(_pixel_at(frame, 0, 20, 32), colors[2])
        self.assertEqual(_pixel_at(frame, 20, 20, 32), colors[3])


class Format18Tests(unittest.TestCase):
    def test_non_square_strip_wraps_at_column_count(self) -> None:
        """1 row x 4 columns (a 64x16 strip) -- the case that would decode wrong if the
        tile grid wrapped at `row_count` instead of `column_count` (docstring note)."""
        row_count, column_count = 1, 4
        colors_f0 = [(i * 10, 0, 0) for i in range(4)]
        colors_f1 = [(0, i * 10, 0) for i in range(4)]
        comp0 = _lzo_compress(_tile_major(colors_f0))
        comp1 = _lzo_compress(_tile_major(colors_f1))
        speed = 120
        body = struct.pack(">I", len(comp0)) + comp0 + struct.pack(">I", len(comp1)) + comp1
        data = (
            b"\x12" + bytes([2]) + struct.pack(">H", speed) + bytes([row_count, column_count])
            + _aes_encrypt(body)
        )

        result = dpb.decode(data)

        self.assertEqual((result.width, result.height), (64, 16))
        self.assertEqual(result.delay_ms, speed)
        self.assertEqual(len(result.frames_rgb), 2)
        for tile_index, color in enumerate(colors_f0):
            self.assertEqual(_pixel_at(result.frames_rgb[0], tile_index * 16, 0, 64), color)
        for tile_index, color in enumerate(colors_f1):
            self.assertEqual(_pixel_at(result.frames_rgb[1], tile_index * 16, 0, 64), color)


class Format26ZeroCTests(unittest.TestCase):
    """64x64 sub-case: the 0x0C bit-packed palette scheme, decoded directly (no LZO/AES)."""

    def test_solid_color_fast_path(self) -> None:
        solid = bytes([0xAA, 0x0B, 0x00, 0xF4, 0x01, 0x0C, 0x01, 0x00, 111, 222, 33])
        data = b"\x1a" + bytes([1]) + struct.pack(">H", 77) + bytes([4, 4]) + struct.pack(">I", len(solid)) + solid

        result = dpb.decode(data)

        self.assertEqual((result.width, result.height), (64, 64))
        self.assertEqual(_pixel_at(result.frames_rgb[0], 5, 5, 64), (111, 222, 33))

    def test_multi_color_checkerboard_bit_packing(self) -> None:
        """Regression test for a real bug found and fixed during this port: the
        bits-per-pixel-index calculation (`_bits_for_count`) must give 1 bit for a
        2-color palette, not 2 -- getting it wrong desyncs every pixel index after the
        first. A checkerboard is the smallest pattern that would show that corruption."""
        palette = [(200, 0, 0), (0, 200, 0)]
        indices = [(x + y) % 2 for y in range(64) for x in range(64)]
        frame = _encode_0x0c_frame(palette, indices)
        data = b"\x1a" + bytes([1]) + struct.pack(">H", 60) + bytes([4, 4]) + struct.pack(">I", len(frame)) + frame

        result = dpb.decode(data)

        out = result.frames_rgb[0]
        for y in range(0, 64, 7):  # sparse spot-check across the whole frame
            for x in range(0, 64, 7):
                expected = palette[(x + y) % 2]
                self.assertEqual(_pixel_at(out, x, y, 64), expected, f"({x},{y})")

    def test_larger_palette_needs_more_bits(self) -> None:
        """5 colors need 3 bits/index (not 2) -- another point the buggy original
        bit-count loop got wrong before the fix."""
        palette = [(i * 40, i * 20, i * 10) for i in range(5)]
        indices = [i % 5 for i in range(64 * 64)]
        frame = _encode_0x0c_frame(palette, indices)
        data = b"\x1a" + bytes([1]) + struct.pack(">H", 50) + bytes([4, 4]) + struct.pack(">I", len(frame)) + frame

        result = dpb.decode(data)

        out = result.frames_rgb[0]
        for i in range(0, 64 * 64, 37):
            x, y = i % 64, i // 64
            self.assertEqual(_pixel_at(out, x, y, 64), palette[i % 5])


class Format31Tests(unittest.TestCase):
    def test_jpeg_sequence_frame_count_and_size(self) -> None:
        from PIL import Image
        import io

        colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
        jpeg_blobs = []
        for color in colors:
            buf = io.BytesIO()
            Image.new("RGB", (128, 128), color).save(buf, format="JPEG", quality=95)
            jpeg_blobs.append(buf.getvalue())
        speed = 45
        data = (
            b"\x1f" + bytes([len(jpeg_blobs)]) + struct.pack(">H", speed) + bytes([8, 8])
            + b"".join(jpeg_blobs)
        )

        result = dpb.decode(data)

        self.assertEqual((result.width, result.height), (128, 128))
        self.assertEqual(result.delay_ms, speed)
        self.assertEqual(len(result.frames_rgb), 3)
        # JPEG is lossy; check each frame's dominant channel matches its intended color.
        for frame, color in zip(result.frames_rgb, colors):
            avg = [sum(frame[c::3]) / (len(frame) // 3) for c in range(3)]
            dominant = max(range(3), key=lambda c: avg[c])
            expected_dominant = max(range(3), key=lambda c: color[c])
            if any(color):  # skip the all-zero (black) case, which has no "dominant"
                self.assertEqual(dominant, expected_dominant)


class Format42ZstdTests(unittest.TestCase):
    def test_zstd_raw_rgb_frames_round_trip(self) -> None:
        import zstandard

        row_count, column_count = 2, 2
        frame0 = _solid_tile((5, 6, 7), column_count * 16, row_count * 16)
        frame1 = _solid_tile((8, 9, 10), column_count * 16, row_count * 16)
        compressed = zstandard.ZstdCompressor().compress(frame0 + frame1)
        speed = 33
        data = (
            b"\x2a" + bytes([2]) + struct.pack(">H", speed) + bytes([row_count, column_count])
            + compressed
        )

        result = dpb.decode(data)

        self.assertEqual((result.width, result.height), (32, 32))
        self.assertEqual(result.delay_ms, speed)
        self.assertEqual(result.frames_rgb, [frame0, frame1])


class Format43EmbeddedGifTests(unittest.TestCase):
    def test_embedded_gif_decodes_matching_header_canvas(self) -> None:
        from PIL import Image
        import io

        im0 = Image.new("RGB", (16, 16), (255, 0, 0))
        im1 = Image.new("RGB", (16, 16), (0, 255, 0))
        buf = io.BytesIO()
        im0.save(buf, format="GIF", save_all=True, append_images=[im1], duration=[90, 90], loop=0)
        speed = 90
        data = b"\x2b" + bytes([2]) + struct.pack(">H", speed) + bytes([1, 1]) + buf.getvalue()

        result = dpb.decode(data)

        self.assertEqual((result.width, result.height), (16, 16))
        self.assertEqual(result.delay_ms, speed)
        self.assertEqual(len(result.frames_rgb), 2)
        self.assertEqual(_pixel_at(result.frames_rgb[0], 0, 0, 16), (255, 0, 0))
        self.assertEqual(_pixel_at(result.frames_rgb[1], 0, 0, 16), (0, 255, 0))


class UnsupportedAndErrorTests(unittest.TestCase):
    def test_unknown_format_byte_raises(self) -> None:
        with self.assertRaises(dpb.PixelBeanDecodeError):
            dpb.decode(b"\x99some garbage")

    def test_empty_data_raises(self) -> None:
        with self.assertRaises(dpb.PixelBeanDecodeError):
            dpb.decode(b"")

    def test_truncated_format_8_raises(self) -> None:
        with self.assertRaises(dpb.PixelBeanDecodeError):
            dpb.decode(b"\x08\x01\x02\x03")


if __name__ == "__main__":
    unittest.main()
