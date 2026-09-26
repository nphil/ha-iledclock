"""Decoders for Divoom Cloud "pixel bean" (`.dat`) artwork containers.

Ported, with modification, from two community reverse-engineering projects (full
attribution + license text in /NOTICE):
- github.com/redphx/apixoo (MIT) `pixel_bean.py`/`pixel_bean_decoder.py`: the original
  AES-CBC+LZO decoders for formats 9 ("single" 16x16 animation), 17/18 ("multiple"
  picture/animation), and the tile-reassembly (`_compact`) logic.
- github.com/fabkury/servoom (Apache-2.0) `pixel_bean_decoder.py`/`FILE_FORMATS.md`: the
  extended format registry (8, 12, 26, 31, 41, 42, 43) and the per-format documentation
  reproduced in each decoder's docstring below.

Modification: every decoder here returns a plain `bytes` RGB buffer per frame directly
(no numpy) since Pillow already covers this integration's raster needs; a `DecodedImage`
gets built by wrapping those buffers with `PIL.Image.frombytes`, never a numpy array.

Nothing here has been exercised against a real Divoom-served file (no test account was
available -- see the assignment report): the AES/LZO/zstd-based formats (8, 9, 12, 17,
18, 42, 43) are round-trip tested against synthetic fixtures this repo's own tests build
with the *same* algorithm (a legitimate correctness check: it proves the decode direction
matches the documented byte layout, since the test's "encoder" is nothing but that same
documented layout written out by hand). The hierarchical quadtree sub-decoder used by
some format-26 frames (`_Decoder0x1AFrame`, marker bytes 0x11/0x13/0x15) has no equivalent
independent encoder to build a synthetic test against -- it is ported faithfully but
UNVERIFIED; see its docstring.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

_AES_KEY = b"78hrey23y28ogs89"
_AES_IV = b"1234567890123456"

#: Uniform per-frame delay used whenever a container format has no timing field at all
#: (single-frame "picture" containers 8/17): matches the original decoders' invented
#: `speed = 40`, kept for compatibility with anything downstream that assumes a nonzero
#: delay; `adapt.py`'s own timing step clamps this into its valid range regardless.
_STILL_DELAY_MS = 40


class PixelBeanDecodeError(ValueError):
    """Raised for any corrupt, truncated, or unsupported pixel-bean container."""


@dataclass(frozen=True, slots=True)
class DecodedContainer:
    """One decoded artwork: `frames_rgb[i]` is exactly `width*height*3` bytes, row-major
    top-to-bottom / left-to-right RGB; `delay_ms` is uniform across the whole animation
    (every pixel-bean format encodes a single per-container speed, never per-frame)."""

    width: int
    height: int
    frames_rgb: list[bytes]
    delay_ms: int


def _aes_decrypt(data: bytes) -> bytes:
    from Crypto.Cipher import AES

    cipher = AES.new(_AES_KEY, AES.MODE_CBC, _AES_IV)
    return cipher.decrypt(data)


def _lzo_decompress(data: bytes, uncompressed_size: int) -> bytes:
    import lzallright

    return lzallright.LZOCompressor().decompress(data, uncompressed_size)


def _compact(frames_data: list[bytes], row_count: int = 1, column_count: int = 1) -> list[bytes]:
    """Reassemble AES/LZO-decrypted raw pixel data (stored tile-by-tile: each 16x16 tile
    written scanline-by-scanline, tiles enumerated row-major across the `column_count` x
    `row_count` grid, wrapping the tile column at `column_count`) into one row-major RGB
    buffer per frame the size of the full `column_count*16` x `row_count*16` canvas.

    (`redphx/apixoo`'s original wrapped the tile column at `row_count`, which only
    produces correct output for square tile grids; `fabkury/servoom` found real format-18
    files with non-square 1xN/Nx1 strips and fixed the wrap to `column_count`, which is
    what this port implements directly.)
    """
    width = column_count * 16
    height = row_count * 16
    frame_size = width * height * 3
    out_frames: list[bytes] = []
    for frame_data in frames_data:
        out = bytearray(frame_size)
        usable_pixels = min(len(frame_data) // 3, frame_size // 3)
        x = y = grid_x = grid_y = 0
        pos = 0
        for _ in range(usable_pixels):
            real_x = x + grid_x * 16
            real_y = y + grid_y * 16
            out_pos = (real_y * width + real_x) * 3
            out[out_pos : out_pos + 3] = frame_data[pos : pos + 3]
            x += 1
            pos += 3
            if x == 16:
                x = 0
                y += 1
                if y == 16:
                    y = 0
                    grid_x += 1
                    if grid_x == column_count:
                        grid_x = 0
                        grid_y += 1
        out_frames.append(bytes(out))
    return out_frames


# --------------------------------------------------------------------------------------
# Format 8 (0x08): single 16x16 picture.
# --------------------------------------------------------------------------------------
def _decode_format_8(fp: io.BufferedIOBase) -> DecodedContainer:
    """`[0x08]` + AES-CBC ciphertext of one raw 16x16 RGB frame (768 bytes -> 769-byte
    files). The still-image sibling of format 9, without format 9's speed prefix."""
    encrypted = fp.read()
    usable = len(encrypted) - (len(encrypted) % 16)
    if usable < 768:
        raise PixelBeanDecodeError(f"format 8: payload too short ({len(encrypted)} bytes)")
    decrypted = _aes_decrypt(encrypted[:usable])
    frames = _compact([decrypted[:768]])
    return DecodedContainer(width=16, height=16, frames_rgb=frames, delay_ms=_STILL_DELAY_MS)


# --------------------------------------------------------------------------------------
# Format 9 (0x09): 16x16 animation, 1..N frames.
# --------------------------------------------------------------------------------------
def _decode_format_9(fp: io.BufferedIOBase) -> DecodedContainer:
    """1 reserved byte, then a big-endian 16-bit speed, then AES-CBC ciphertext whose
    decrypted length is `768 * frame_count`. (The original apixoo/servoom source computes
    this via a byte-shuffle so contorted it obscures what it does; verified equivalent to
    this direct read by exhaustive random testing during the port -- see the assignment
    report.)"""
    rest = fp.read()
    if len(rest) < 3:
        raise PixelBeanDecodeError("format 9: payload too short for header")
    speed = int.from_bytes(rest[1:3], "big")
    encrypted = rest[3:]
    usable = len(encrypted) - (len(encrypted) % 16)
    decrypted = _aes_decrypt(encrypted[:usable])
    total_frames = len(decrypted) // 768
    frames_data = [decrypted[i * 768 : (i + 1) * 768] for i in range(total_frames)]
    frames = _compact(frames_data)
    return DecodedContainer(width=16, height=16, frames_rgb=frames, delay_ms=speed)


# --------------------------------------------------------------------------------------
# Format 12 (0x0C): 16x16 scrolling banner (four 16x16 tiles = a 64x16 strip).
# --------------------------------------------------------------------------------------
def _decode_format_12(fp: io.BufferedIOBase) -> DecodedContainer:
    """`[mode][speed BE16]` + AES-CBC ciphertext of exactly four raw 16x16 RGB tiles
    (3072 usable bytes). The tiles side by side form one 64x16 strip that a 16x16 device
    scrolls across its panel; decoded here as that marquee -- 64 frames of a 16x16 window
    sliding right-to-left over the strip one pixel per frame, wrapping around, each
    lasting `speed` ms. `mode`'s meaning is unknown and ignored (matches upstream)."""
    header = fp.read(3)
    if len(header) < 3:
        raise PixelBeanDecodeError("format 12: header too short")
    speed = int.from_bytes(header[1:3], "big")
    encrypted = fp.read()
    usable = len(encrypted) - (len(encrypted) % 16)
    if usable < 4 * 768:
        raise PixelBeanDecodeError(f"format 12: payload too short ({len(encrypted)} bytes)")
    decrypted = _aes_decrypt(encrypted[:usable])
    tiles = [decrypted[i * 768 : (i + 1) * 768] for i in range(4)]
    tile_frames = _compact(tiles)  # each: one 16x16 RGB buffer, row-major

    row_stride = 16 * 3
    strip_rows: list[bytes] = []
    for row in range(16):
        row_bytes = b"".join(tile[row * row_stride : (row + 1) * row_stride] for tile in tile_frames)
        strip_rows.append(row_bytes + row_bytes)  # 128px wide: wrap-around for sliding

    frames: list[bytes] = []
    for x in range(64):
        frame = bytearray()
        for row_bytes in strip_rows:
            frame += row_bytes[x * 3 : (x + 16) * 3]
        frames.append(bytes(frame))
    return DecodedContainer(width=16, height=16, frames_rgb=frames, delay_ms=speed)


# --------------------------------------------------------------------------------------
# Format 17 (0x11): multi-tile picture, always exactly one frame.
# --------------------------------------------------------------------------------------
def _decode_format_17(fp: io.BufferedIOBase) -> DecodedContainer:
    """`[row_count][column_count][length BE32]` + AES-CBC ciphertext of one LZO-compressed
    frame. No frame count field -- always a still (32x32 observed live; also seen at
    64x64)."""
    header = fp.read(6)
    if len(header) < 6:
        raise PixelBeanDecodeError("format 17: header too short")
    row_count, column_count = header[0], header[1]
    length = int.from_bytes(header[2:6], "big")
    if row_count <= 0 or column_count <= 0:
        raise PixelBeanDecodeError(f"format 17: invalid grid {row_count}x{column_count}")
    width, height = column_count * 16, row_count * 16
    encrypted = fp.read()
    usable = len(encrypted) - (len(encrypted) % 16)
    decrypted = _aes_decrypt(encrypted[:usable])
    if length > len(decrypted):
        raise PixelBeanDecodeError("format 17: declared length exceeds decrypted payload")
    frame_data = _lzo_decompress(decrypted[:length], width * height * 3)
    frames = _compact([frame_data], row_count, column_count)
    return DecodedContainer(width=width, height=height, frames_rgb=frames, delay_ms=_STILL_DELAY_MS)


# --------------------------------------------------------------------------------------
# Format 18 (0x12): multi-tile animation, 1..N frames.
# --------------------------------------------------------------------------------------
def _decode_format_18(fp: io.BufferedIOBase) -> DecodedContainer:
    """`[total_frames][speed BE16][row_count][column_count]` + AES-CBC ciphertext of N
    frames, each `[frame_size BE32][LZO-compressed raw pixel data]`. 32x32 observed most
    often; also non-square 1xN/Nx1 16x16-tile strips (see `_compact`'s docstring)."""
    header = fp.read(5)
    if len(header) < 5:
        raise PixelBeanDecodeError("format 18: header too short")
    total_frames = header[0]
    speed = int.from_bytes(header[1:3], "big")
    row_count, column_count = header[3], header[4]
    if row_count <= 0 or column_count <= 0:
        raise PixelBeanDecodeError(f"format 18: invalid grid {row_count}x{column_count}")
    width, height = column_count * 16, row_count * 16
    frame_bytes = width * height * 3
    encrypted = fp.read()
    usable = len(encrypted) - (len(encrypted) % 16)
    data = _aes_decrypt(encrypted[:usable])

    frames_data: list[bytes] = []
    pos = 0
    for _ in range(total_frames):
        if pos + 4 > len(data):
            break
        frame_size = int.from_bytes(data[pos : pos + 4], "big")
        pos += 4
        if pos + frame_size > len(data):
            raise PixelBeanDecodeError("format 18: frame payload runs past end of data")
        frames_data.append(_lzo_decompress(data[pos : pos + frame_size], frame_bytes))
        pos += frame_size
    if not frames_data:
        raise PixelBeanDecodeError("format 18: no frames decoded")
    frames = _compact(frames_data, row_count, column_count)
    return DecodedContainer(width=width, height=height, frames_rgb=frames, delay_ms=speed)


# --------------------------------------------------------------------------------------
# Format 26 (0x1A): 64x64 or 128x128 animation -- routes to one of two sub-decoders by
# canvas size, matching servoom's own dispatch (`_decode_format_26`).
# --------------------------------------------------------------------------------------
def _get_dot_info(data: bytes, pos: int, pixel_idx: int, bits: int) -> int:
    """Extract one palette index from the 0x0C bit-packed pixel stream. `-1` (bounds-
    checked, never raises) means "transparent -> black"."""
    if pos >= len(data):
        return -1
    shift = bits * pixel_idx & 7
    byte_off = bits * pixel_idx * 65536 >> 0x13
    if bits >= 9:
        raise PixelBeanDecodeError("format 26 (0x0C): unsupported bits-per-pixel >= 9")
    width_bits = bits + shift
    if width_bits < 9:
        idx = pos + byte_off
        if idx >= len(data):
            return -1
        value = data[idx] << (8 - width_bits) & 0xFF
        value >>= shift + (8 - width_bits)
    else:
        idx1, idx0 = pos + byte_off + 1, pos + byte_off
        if idx1 >= len(data) or idx0 >= len(data):
            return -1
        value = data[idx1] << (0x10 - width_bits) & 0xFF
        value >>= 0x10 - width_bits
        value &= 0xFFFF
        value <<= 8 - shift
        value |= data[idx0] >> shift
    return value


def _bits_for_count(num_colors: int) -> int:
    """Bits needed to index `num_colors` distinct values (`ceil(log2(num_colors))`,
    `0` for `<=1`). Shared by the 0x0C bit-packed decoder and the hierarchical quadtree
    one below -- both need "how many bits per pixel index does this palette need".

    (The original apixoo/servoom 0x0C decoder computes this via a bit-scanning loop
    translated from the vendor's compiled logic; ported and unit-tested here, it turned
    out to be exactly this formula for every count 1..256 -- verified by brute force
    during the port, see the assignment report -- so this port uses the plain formula
    directly instead of replicating the original's more error-prone bit-scan.)
    """
    if num_colors <= 1:
        return 0
    bits = 1
    while (1 << bits) < num_colors:
        bits += 1
    return bits


def _decode_0x0c_frame(data: bytes, num_pixels: int) -> bytes:
    """Decode one 0x0C (bit-packed indexed-palette) frame to raw row-major RGB bytes.
    Used both for 64x64 format-26 frames directly and, embedded, for some 128x128 ones.
    """
    # Solid-color fast path observed live: `AA 0B 00 F4 01 0C 01 00 R G B`.
    if (
        len(data) == 11
        and data[0:2] == b"\xaa\x0b"
        and data[2] == 0x00
        and data[3:5] == b"\xf4\x01"
        and data[5] == 0x0C
        and data[6] == 0x01
        and data[7] == 0x00
    ):
        return bytes(data[8:11]) * num_pixels

    if len(data) < 8:
        raise PixelBeanDecodeError(f"format 26 (0x0C): frame too short ({len(data)} bytes)")
    encrypt_type = data[5]
    if encrypt_type != 0x0C:
        raise PixelBeanDecodeError(f"format 26 (0x0C): expected type 0x0C, got 0x{encrypt_type:02X}")

    palette_count = data[6]
    if palette_count == 0:
        bits, header_len = 8, 768
    else:
        bits = _bits_for_count(palette_count)
        header_len = palette_count * 3

    out = bytearray(num_pixels * 3)
    pos = (header_len + 8) & 0xFFFF
    for pixel_idx in range(num_pixels):
        color_index = _get_dot_info(data, pos, pixel_idx, bits)
        target = pixel_idx * 3
        if color_index == -1:
            continue  # already zeroed (transparent -> black)
        color_pos = 8 + color_index * 3
        if color_pos + 2 < len(data):
            out[target : target + 3] = data[color_pos : color_pos + 3]
    return bytes(out)


def _decode_format_26_64(fp: io.BufferedIOBase, total_frames: int, speed: int) -> DecodedContainer:
    """64x64 sub-case: every frame uses the 0x0C bit-packed palette scheme directly."""
    frames: list[bytes] = []
    for _ in range(total_frames):
        size_bytes = fp.read(4)
        if len(size_bytes) < 4:
            break
        size = int.from_bytes(size_bytes, "big")
        frame_data = fp.read(size)
        if len(frame_data) < size:
            break
        frames.append(_decode_0x0c_frame(frame_data, 64 * 64))
    if not frames:
        raise PixelBeanDecodeError("format 26 (64x64): no frames decoded")
    return DecodedContainer(width=64, height=64, frames_rgb=frames, delay_ms=speed)


class _HierarchicalQuadtreeFrame:
    """Decoder for one 128x128 (or 64x64) frame using the 0x11/0x13/0x15 hierarchical
    palette scheme (marker byte 0xAA; distinct from, and more complex than, the 0x0C
    scheme above): a per-frame palette (0x13 extends the previous frame's palette, 0x15
    supplies a full one) followed by a recursive quadtree over 64x64 quadrants -> 32x32 ->
    16x16 -> 8x8 blocks, where each node is either a flat run (all pixels share the parent
    palette), a masked subset (a bitmask selects which of the parent's colors are used
    here, followed by bit-packed indices into that subset), or a further 4-way split.

    UNVERIFIED: ported faithfully from `fabkury/servoom`'s `_Decoder0x1AFrame` (itself
    reverse-engineered without a from-scratch encoder to test against), translated from
    numpy-array output to a flat RGB byte buffer. There is no way to build an independent
    synthetic test for the recursive-split path without re-deriving Divoom's own private
    encoder; only the top-level dispatch (this class is reached at all for 0x11/0x13/0x15
    frames, as opposed to 0x0C ones) is exercised by this repo's tests. Treat any real
    file that lands here as unverified against ground truth.
    """

    def __init__(self, frame_data: bytes, width: int, height: int, previous_palette: list[tuple[int, int, int]] | None):
        if len(frame_data) < 8 or frame_data[0] != 0xAA:
            raise PixelBeanDecodeError("format 26 (0x1A): frame does not start with 0xAA marker")
        self.encrypt_type = frame_data[5] & 0x7F
        palette_size = int.from_bytes(frame_data[6:8], "little")
        palette_start = 8
        base_palette = previous_palette or []
        palette: list[tuple[int, int, int]] = list(base_palette) if self.encrypt_type == 0x13 else []
        for i in range(palette_size):
            off = palette_start + i * 3
            if off + 2 >= len(frame_data):
                raise PixelBeanDecodeError("format 26 (0x1A): palette runs past end of frame")
            palette.append((frame_data[off], frame_data[off + 1], frame_data[off + 2]))
        self.palette = palette
        pixel_data_offset = palette_start + palette_size * 3
        self.pixel = frame_data[pixel_data_offset:]
        self.width = width
        self.height = height
        self.out = bytearray(width * height * 3)
        self.base_bpp = self._bits_for(len(self.palette))

    @staticmethod
    def _bits_for(num_colors: int) -> int:
        return _bits_for_count(num_colors)

    def _palette_at(self, index: int) -> tuple[int, int, int]:
        if not (0 <= index < len(self.palette)):
            index = 0
        return self.palette[index] if self.palette else (0, 0, 0)

    def _read_indices(self, start: int, count: int, bits: int) -> tuple[list[int], int]:
        if bits == 0:
            return [0] * count, start
        pos, bit = start, 0
        values: list[int] = []
        for _ in range(count):
            value = 0
            for i in range(bits):
                b = (self.pixel[pos] >> bit) & 1 if pos < len(self.pixel) else 0
                value |= b << i
                bit += 1
                if bit == 8:
                    bit, pos = 0, pos + 1
            values.append(value)
        if bit:
            pos += 1
        return values, pos

    def _paint_block(self, x0: int, y0: int, size: int, indices: list[int], palette_map: list[int]) -> None:
        it = 0
        w = self.width
        for row in range(size):
            base = ((y0 + row) * w + x0) * 3
            for col in range(size):
                idx = indices[it]
                it += 1
                mapped = palette_map[idx] if 0 <= idx < len(palette_map) else 0
                r, g, b = self._palette_at(mapped)
                pos = base + col * 3
                self.out[pos : pos + 3] = bytes((r, g, b))

    def _decode_block(self, offset: int, x0: int, y0: int, size: int, parent_map: list[int]) -> int:
        if offset >= len(self.pixel):
            raise PixelBeanDecodeError("format 26 (0x1A): block header past end of data")
        ctrl = self.pixel[offset]
        if size == 8:
            # 8x8 leaf: `ctrl` byte doubles as a mask-present flag (high bit) + count.
            first = self.pixel[offset]
            if first & 0x80:
                n = first & 0x7F
                ptr = offset + 1
                mask_bytes = (n + 7) // 8
                selected = [
                    parent_map[i]
                    for i in range(n)
                    if i < len(parent_map) and ((self.pixel[ptr + (i >> 3)] >> (i & 7)) & 1)
                ] or [0]
                ptr += mask_bytes
                bpp = self._bits_for(len(selected))
                indices, ptr2 = self._read_indices(ptr, 64, bpp)
                self._paint_block(x0, y0, 8, indices, selected)
                return ptr2 - offset
            bpp = self._bits_for(len(parent_map))
            ptr = offset + 1
            indices, ptr2 = self._read_indices(ptr, 64, bpp)
            self._paint_block(x0, y0, 8, indices, parent_map)
            return ptr2 - offset

        # 64/32/16 non-leaf node.
        if ctrl == 0:
            ptr = offset + 1
        else:
            if offset + 1 >= len(self.pixel):
                raise PixelBeanDecodeError("format 26 (0x1A): block header past end of data")
            n = self.pixel[offset + 1] or 0x100
            ptr = offset + 2

        if ctrl == 0:
            bpp = self.base_bpp if size == 64 else self._bits_for(len(parent_map) or 1)
            active_map = parent_map if size != 64 else list(range(len(self.palette)))
            indices, ptr2 = self._read_indices(ptr, size * size, bpp)
            self._paint_block(x0, y0, size, indices, active_map)
            return ptr2 - offset
        if ctrl == 2:
            mask_bytes = (n + 7) // 8
            source_map = parent_map if size != 64 else list(range(len(self.palette)))
            selected = [
                (source_map[i] if size != 64 else i)
                for i in range(n)
                if i < len(source_map) or size == 64
                if ((self.pixel[ptr + (i >> 3)] >> (i & 7)) & 1)
            ] or [0]
            ptr += mask_bytes
            bpp = self._bits_for(len(selected))
            indices, ptr2 = self._read_indices(ptr, size * size, bpp)
            self._paint_block(x0, y0, size, indices, selected)
            return ptr2 - offset

        # Recursive 4-way split into quadrants of half the size.
        mask_bytes = (n + 7) // 8
        source_map = parent_map if size != 64 else list(range(len(self.palette)))
        mapping = [
            source_map[i]
            for i in range(n)
            if i < len(source_map) and ((self.pixel[ptr + (i >> 3)] >> (i & 7)) & 1)
        ] or [0]
        ptr += mask_bytes
        half = size // 2
        consumed = 0
        for dy in (0, 1):
            for dx in (0, 1):
                consumed += self._decode_block(ptr + consumed, x0 + dx * half, y0 + dy * half, half, mapping)
        return (2 if ctrl else 1) + mask_bytes + consumed

    def decode(self) -> bytes:
        offset = 0
        offset += self._decode_block(offset, 0, 0, 64, list(range(len(self.palette))))
        if self.width == 128 and self.height == 128:
            for qx, qy in ((1, 0), (0, 1), (1, 1)):
                offset += self._decode_block(offset, qx * 64, qy * 64, 64, list(range(len(self.palette))))
        return bytes(self.out)


def _decode_format_26_1a(fp: io.BufferedIOBase, total_frames: int, speed: int, width: int, height: int) -> DecodedContainer:
    """128x128 (or non-64x64) sub-case: each frame is either the raw-RGB marker
    (`encrypt_type 0x11`), or the hierarchical-quadtree scheme (0x13/0x15, see
    `_HierarchicalQuadtreeFrame`)."""
    payload = fp.read()
    frames: list[bytes] = []
    pos = 0
    palette: list[tuple[int, int, int]] = []
    for _ in range(total_frames):
        idx = pos + 4
        if idx >= len(payload) or payload[idx] != 0xAA:
            break
        payload_len = payload[idx + 1] | (payload[idx + 2] << 8)
        frame_data = payload[idx : idx + payload_len]
        if len(frame_data) < 8:
            break
        encrypt_type = frame_data[5] & 0x7F
        if encrypt_type == 0x11:
            expected = width * height * 3
            if len(frame_data) < 8 + expected:
                raise PixelBeanDecodeError("format 26 (0x1A raw): truncated frame")
            frames.append(bytes(frame_data[8 : 8 + expected]))
            palette = []
        else:
            frame = _HierarchicalQuadtreeFrame(frame_data, width, height, palette)
            frames.append(frame.decode())
            palette = frame.palette
        pos = idx + payload_len
    if not frames:
        raise PixelBeanDecodeError("format 26 (0x1A): no frames decoded")
    return DecodedContainer(width=width, height=height, frames_rgb=frames, delay_ms=speed)


def _decode_format_26(fp: io.BufferedIOBase) -> DecodedContainer:
    header = fp.read(5)
    if len(header) < 5:
        raise PixelBeanDecodeError("format 26: header too short")
    total_frames = header[0]
    speed = int.from_bytes(header[1:3], "big")
    row_count, column_count = header[3], header[4]
    width, height = column_count * 16, row_count * 16
    if width == 64 and height == 64:
        return _decode_format_26_64(fp, total_frames, speed)
    return _decode_format_26_1a(fp, total_frames, speed, width, height)


# --------------------------------------------------------------------------------------
# Formats 31/41 (0x1F/0x29): embedded still-image sequences (JPEG frames concatenated).
# --------------------------------------------------------------------------------------
def _extract_jpeg_frames(data: bytes, expected_frames: int) -> list[bytes]:
    frames: list[bytes] = []
    cursor = 0
    soi, eoi = b"\xff\xd8", b"\xff\xd9"
    while cursor < len(data) and (not expected_frames or len(frames) < expected_frames):
        start = data.find(soi, cursor)
        if start == -1:
            break
        end = data.find(eoi, start)
        if end == -1:
            break
        end += 2
        frames.append(data[start:end])
        cursor = end
    return frames


def _decode_jpeg_frames_to_rgb(jpeg_frames: list[bytes], width: int, height: int) -> list[bytes]:
    from PIL import Image

    out: list[bytes] = []
    for jpeg_bytes in jpeg_frames:
        with Image.open(io.BytesIO(jpeg_bytes)) as img:
            rgb = img.convert("RGB")
            if width and height and rgb.size != (width, height):
                rgb = rgb.resize((width, height), Image.NEAREST)
            out.append(rgb.tobytes())
    return out


def _decode_format_31(fp: io.BufferedIOBase) -> DecodedContainer:
    """`[total_frames][speed BE16][row_count][column_count]` + a stream of concatenated
    JPEG images (SOI..EOI), one per frame -- 128x128, animation-only in the wild."""
    header = fp.read(5)
    if len(header) < 5:
        raise PixelBeanDecodeError("format 31: header too short")
    total_frames = header[0]
    speed = int.from_bytes(header[1:3], "big")
    row_count, column_count = header[3], header[4]
    width, height = column_count * 16, row_count * 16
    payload = fp.read()
    jpeg_frames = _extract_jpeg_frames(payload, total_frames)
    if not jpeg_frames:
        raise PixelBeanDecodeError("format 31: no JPEG frames found")
    frames = _decode_jpeg_frames_to_rgb(jpeg_frames, width, height)
    return DecodedContainer(width=width, height=height, frames_rgb=frames, delay_ms=speed)


def _decode_format_41(fp: io.BufferedIOBase) -> DecodedContainer:
    """`[total_frames][speed BE16][row_count][column_count]` + 9 reserved bytes (meaning
    unknown) + a stream of JPEG frames, each optionally followed by a 5-byte gap
    (`02 00 00 <2 bytes>`) -- 256x256, seen only as an alternate encoding of the same
    "multi-animation" class formats 26/42/43 also carry."""
    header = fp.read(5)
    if len(header) < 5:
        raise PixelBeanDecodeError("format 41: header too short")
    total_frames = header[0]
    speed = int.from_bytes(header[1:3], "big") or 50
    row_count, column_count = header[3] or 1, header[4] or 1
    fp.read(9)  # reserved, meaning unknown (see FILE_FORMATS.md)
    width, height = column_count * 16, row_count * 16
    payload = fp.read()

    frames_jpeg: list[bytes] = []
    cursor = 0
    soi, eoi, gap = b"\xff\xd8", b"\xff\xd9", b"\x02\x00\x00"
    while cursor < len(payload):
        start = payload.find(soi, cursor)
        if start == -1:
            break
        end = payload.find(eoi, start)
        if end == -1:
            break
        end += 2
        frames_jpeg.append(payload[start:end])
        cursor = end
        if cursor + 5 <= len(payload) and payload[cursor : cursor + 3] == gap:
            cursor += 5
        if total_frames and len(frames_jpeg) >= total_frames:
            break
    if not frames_jpeg:
        raise PixelBeanDecodeError("format 41: no JPEG frames found")
    frames = _decode_jpeg_frames_to_rgb(frames_jpeg, width, height)
    return DecodedContainer(width=width, height=height, frames_rgb=frames, delay_ms=speed)


# --------------------------------------------------------------------------------------
# Format 42 (0x2A): 256x256, zstd-compressed raw RGB frames.
# --------------------------------------------------------------------------------------
def _decode_format_42(fp: io.BufferedIOBase) -> DecodedContainer:
    header = fp.read(5)
    if len(header) < 5:
        raise PixelBeanDecodeError("format 42: header too short")
    total_frames = header[0]
    speed = int.from_bytes(header[1:3], "big")
    row_count, column_count = header[3], header[4]
    width, height = column_count * 16, row_count * 16
    remainder = fp.read()
    magic = b"\x28\xb5\x2f\xfd"
    idx = remainder.find(magic)
    if idx == -1:
        raise PixelBeanDecodeError("format 42: zstd magic not found")

    import zstandard

    decompressed = zstandard.ZstdDecompressor().decompress(remainder[idx:], max_output_size=64 * 1024 * 1024)
    frame_bytes = width * height * 3
    if frame_bytes == 0:
        raise PixelBeanDecodeError(f"format 42: invalid dimensions {width}x{height}")
    available = len(decompressed) // frame_bytes
    frame_count = min(total_frames, available) if total_frames else available
    frames = [decompressed[i * frame_bytes : (i + 1) * frame_bytes] for i in range(frame_count)]
    if not frames:
        raise PixelBeanDecodeError("format 42: no complete frames in decompressed payload")
    return DecodedContainer(width=width, height=height, frames_rgb=frames, delay_ms=speed)


# --------------------------------------------------------------------------------------
# Format 43 (0x2B): 256x256, an embedded GIF or WebP container.
# --------------------------------------------------------------------------------------
def _decode_format_43(fp: io.BufferedIOBase) -> DecodedContainer:
    header = fp.read(5)
    if len(header) < 5:
        raise PixelBeanDecodeError("format 43: header too short")
    total_frames_hint = header[0]
    speed = int.from_bytes(header[1:3], "big")
    row_count, column_count = header[3], header[4]
    width, height = column_count * 16, row_count * 16
    data = fp.read()

    gif_off = data.find(b"GIF8")
    if gif_off != -1:
        payload = data[gif_off:]
    else:
        webp_off = data.find(b"RIFF")
        if webp_off != -1 and data[webp_off + 8 : webp_off + 12] == b"WEBP":
            payload = data[webp_off:]
        else:
            payload = data  # let Pillow sniff it as a last resort

    from PIL import Image

    frames: list[bytes] = []
    with Image.open(io.BytesIO(payload)) as im:
        frame_count = min(getattr(im, "n_frames", 1), max(total_frames_hint, 1) if total_frames_hint else getattr(im, "n_frames", 1))
        for index in range(frame_count):
            im.seek(index)
            rgb = im.convert("RGB")
            if width and height and rgb.size != (width, height):
                rgb = rgb.resize((width, height), Image.NEAREST)
            frames.append(rgb.tobytes())
    if not frames:
        raise PixelBeanDecodeError("format 43: embedded image had no frames")
    if not width or not height:
        width, height = Image.open(io.BytesIO(payload)).size
    return DecodedContainer(width=width, height=height, frames_rgb=frames, delay_ms=speed)


_DECODERS = {
    8: _decode_format_8,
    9: _decode_format_9,
    12: _decode_format_12,
    17: _decode_format_17,
    18: _decode_format_18,
    26: _decode_format_26,
    31: _decode_format_31,
    41: _decode_format_41,
    42: _decode_format_42,
    43: _decode_format_43,
}


def decode(data: bytes) -> DecodedContainer:
    """Decode one Divoom `.dat` artwork: dispatch on its first byte (the container
    format id) to the matching decoder above."""
    if not data:
        raise PixelBeanDecodeError("empty file")
    fmt = data[0]
    decoder = _DECODERS.get(fmt)
    if decoder is None:
        raise PixelBeanDecodeError(f"unsupported pixel-bean format byte {fmt} (0x{fmt:02X})")
    return decoder(io.BytesIO(data[1:]))
