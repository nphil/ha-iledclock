"""Decode `.ase`/`.aseprite` files per the official Aseprite file format specification
(github.com/aseprite/aseprite `docs/ase-file-specs.md`), using only `struct` (binary
layout) and `zlib` (compressed cels) from the stdlib; Pillow is used solely to build the
final `Image` objects.

Design notes, matched to the spec's own section numbers:

* The header is a fixed 128 bytes regardless of content, so frame data always starts at
  byte 128 -- we only unpack the leading fields we actually need (up to and including the
  transparent-color index) and never touch the trailing pixel-ratio/grid/reserved bytes,
  since nothing downstream depends on them.
* Every chunk's own leading `DWORD` size lets us self-skip any chunk type we don't handle
  (Cel Extra, Color Profile, External Files, Mask, Path, Tags + their User Data, User Data
  in general, Slice, Tileset) without special-casing each one: `_parse_frames` records
  each chunk's exact `[payload_start, payload_end)` slice up front from that size field, so
  the outer loop advances correctly no matter what we do or don't interpret inside.
* Blend modes: only `Normal` (0) is implemented; every other blend mode value is treated
  as Normal (flat "over" alpha compositing). This is a deliberate, documented
  simplification -- the gallery only requires blend-normal semantics.
* Layer opacity is only meaningful when header flag bit 0 ("layer opacity has valid
  value") is set; otherwise every layer composites at full (255) opacity, per spec.
* Group visibility cascades to descendants (NOTE.1's child-level nesting) via a small
  stack of `(child_level, effective_visible)`; group *opacity* does not cascade into cel
  compositing here -- only the cel's own layer's opacity and the cel's own opacity byte
  are multiplied together, per the gallery's compositing contract.
* Cel stacking order within one frame follows NOTE.5's `layerIndex + zIndex` algorithm
  exactly (ties broken by raw `zIndex`), before alpha-compositing back-to-front.
* Palette handling follows the spec's own precedence rule: the old palette chunks
  (0x0004/0x0011) are ignored entirely whenever a new palette chunk (0x2019) exists
  anywhere in the file, decided by a structural pre-pass before any pixel decoding.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass

from . import DecodeError, DecodedImage

#: Sanity ceiling on frame count, mirroring `gif.py`'s guard against a corrupt/fuzzed
#: header claiming an absurd frame count.
_MAX_FRAMES = 4096

_HEADER_SIZE = 128
_HEADER_MAGIC = 0xA5E0
# Only the fields this module actually needs, in file order, from the start of the
# 128-byte header: file size (DWORD, ignored), magic (WORD), frame count (WORD), width
# (WORD), height (WORD), color depth (WORD), flags (DWORD), speed (WORD), two reserved
# DWORDs (ignored), transparent color index (BYTE). Everything after that (ignore bytes,
# color count, pixel ratio, grid) is unused, so we never unpack past it -- frame data
# always starts at byte 128 regardless of what those trailing bytes contain.
_HEADER_PREFIX_FMT = "<IHHHHHIHIIB"

_FRAME_HEADER_FMT = "<IHHH2sI"  # bytes-in-frame, magic, old chunks, duration, pad, new chunks
_FRAME_MAGIC = 0xF1FA

_CEL_FIXED_FMT = "<HhhBHh5s"  # layer index, x, y, opacity, cel type, z-index, pad

_CHUNK_OLD_PALETTE_04 = 0x0004
_CHUNK_OLD_PALETTE_11 = 0x0011
_CHUNK_LAYER = 0x2004
_CHUNK_CEL = 0x2005
_CHUNK_PALETTE = 0x2019

_HEADER_FLAG_LAYER_OPACITY_VALID = 0x01

_LAYER_FLAG_VISIBLE = 1 << 0
_LAYER_FLAG_BACKGROUND = 1 << 3

_LAYER_TYPE_NORMAL = 0
_LAYER_TYPE_GROUP = 1
_LAYER_TYPE_TILEMAP = 2

_CEL_TYPE_RAW = 0
_CEL_TYPE_LINKED = 1
_CEL_TYPE_COMPRESSED = 2
_CEL_TYPE_COMPRESSED_TILEMAP = 3


@dataclass
class _Layer:
    flags: int
    type: int
    opacity: int  # already resolved: 255 when the header's opacity-valid flag is unset
    effective_visible: bool  # own visibility AND every open ancestor group's visibility

    @property
    def is_background(self) -> bool:
        return bool(self.flags & _LAYER_FLAG_BACKGROUND)


@dataclass
class _PendingCel:
    layer_index: int
    x: int
    y: int
    opacity: int
    z_index: int
    image: "Image.Image"  # noqa: F821 - Pillow imported lazily by load(), see module docstring


def load(data: bytes) -> DecodedImage:
    """Decode `data` (the raw bytes of an `.ase`/`.aseprite` file) into a `DecodedImage`."""
    from PIL import Image

    if len(data) < _HEADER_SIZE:
        raise DecodeError(f"file too short for an ASE header: {len(data)} bytes")

    try:
        (
            _file_size,
            magic,
            frame_count,
            width,
            height,
            depth,
            header_flags,
            speed,
            _reserved1,
            _reserved2,
            transparent_index,
        ) = struct.unpack_from(_HEADER_PREFIX_FMT, data, 0)
    except struct.error as err:
        raise DecodeError(f"malformed ASE header: {err}") from err

    if magic != _HEADER_MAGIC:
        raise DecodeError(f"bad ASE magic number: 0x{magic:04x}")
    if frame_count < 1:
        raise DecodeError(f"ASE file declares {frame_count} frames")
    if width < 1 or height < 1:
        raise DecodeError(f"invalid ASE canvas size {width}x{height}")
    if depth not in (8, 16, 32):
        raise DecodeError(f"unsupported ASE color depth: {depth} bpp")
    frame_count = min(frame_count, _MAX_FRAMES)

    try:
        frames_raw = _parse_frames(data, frame_count, _HEADER_SIZE)
    except struct.error as err:
        raise DecodeError(f"malformed ASE frame/chunk structure: {err}") from err

    has_new_palette = any(
        chunk_type == _CHUNK_PALETTE
        for _duration, chunks in frames_raw
        for chunk_type, _start, _end in chunks
    )

    layers: list[_Layer] = []
    group_stack: list[tuple[int, bool]] = []
    palette: list[tuple[int, int, int, int]] = []
    cel_cache: dict[tuple[int, int], "Image.Image"] = {}
    output_frames: list = []
    delays_ms: list[int] = []

    try:
        for frame_index, (duration_ms, chunks) in enumerate(frames_raw):
            pending_cels: list[_PendingCel] = []
            for chunk_type, payload_start, payload_end in chunks:
                if chunk_type == _CHUNK_LAYER:
                    _handle_layer_chunk(
                        data, payload_start, payload_end, header_flags, layers, group_stack
                    )
                elif chunk_type == _CHUNK_PALETTE:
                    _handle_new_palette_chunk(data, payload_start, payload_end, palette)
                elif (
                    chunk_type in (_CHUNK_OLD_PALETTE_04, _CHUNK_OLD_PALETTE_11)
                    and not has_new_palette
                ):
                    _handle_old_palette_chunk(
                        data,
                        payload_start,
                        payload_end,
                        palette,
                        scale_6bit=chunk_type == _CHUNK_OLD_PALETTE_11,
                    )
                elif chunk_type == _CHUNK_CEL:
                    cel = _handle_cel_chunk(
                        Image,
                        data,
                        payload_start,
                        payload_end,
                        frame_index,
                        layers,
                        palette,
                        transparent_index,
                        depth,
                        cel_cache,
                    )
                    if cel is not None:
                        pending_cels.append(cel)
                # Every other chunk type (Cel Extra, Color Profile, External Files,
                # Mask, Path, Tags + their per-tag User Data, general User Data, Slice,
                # Tileset) is out of scope and already skipped: `_parse_frames` recorded
                # this chunk's boundaries from its own declared size, independent of type.

            output_frames.append(
                _composite_frame(Image, pending_cels, layers, width, height)
            )
            delays_ms.append(duration_ms if duration_ms > 0 else speed)
    except struct.error as err:
        raise DecodeError(f"malformed ASE chunk payload: {err}") from err

    return DecodedImage(frames=output_frames, delays_ms=delays_ms)


def _parse_frames(
    data: bytes, frame_count: int, start: int
) -> list[tuple[int, list[tuple[int, int, int]]]]:
    """Walk frame/chunk headers only (no payload interpretation). Returns, per frame in
    file order, `(duration_ms, chunks)` where `chunks` is `(chunk_type, payload_start,
    payload_end)` for every chunk in that frame, in file order."""
    pos = start
    frames: list[tuple[int, list[tuple[int, int, int]]]] = []
    for frame_index in range(frame_count):
        if pos + 16 > len(data):
            raise DecodeError(f"truncated frame header at frame {frame_index}")
        frame_start = pos
        bytes_in_frame, magic, old_chunks, duration_ms, _pad, new_chunks = (
            struct.unpack_from(_FRAME_HEADER_FMT, data, pos)
        )
        if magic != _FRAME_MAGIC:
            raise DecodeError(f"bad frame magic 0x{magic:04x} at frame {frame_index}")
        pos += 16

        chunk_count = new_chunks if (old_chunks == 0xFFFF or new_chunks != 0) else old_chunks
        chunks: list[tuple[int, int, int]] = []
        for _ in range(chunk_count):
            if pos + 6 > len(data):
                raise DecodeError(f"truncated chunk header in frame {frame_index}")
            chunk_size, chunk_type = struct.unpack_from("<IH", data, pos)
            if chunk_size < 6 or pos + chunk_size > len(data):
                raise DecodeError(
                    f"invalid chunk size {chunk_size} for chunk 0x{chunk_type:04x} "
                    f"in frame {frame_index}"
                )
            chunks.append((chunk_type, pos + 6, pos + chunk_size))
            pos += chunk_size

        frames.append((duration_ms, chunks))
        # Trust the frame's own declared total size for where the next frame starts,
        # in case its chunk list doesn't exactly fill it (padding, rounding, etc).
        if bytes_in_frame >= 16:
            pos = frame_start + bytes_in_frame

    return frames


def _handle_layer_chunk(
    data: bytes,
    payload_start: int,
    payload_end: int,
    header_flags: int,
    layers: list[_Layer],
    group_stack: list[tuple[int, bool]],
) -> None:
    if payload_start + 13 > payload_end:
        raise DecodeError("truncated layer chunk")
    # blend_mode is read (to stay at the right offset) and intentionally never branched
    # on -- see module docstring: every blend mode is treated as Normal.
    flags, layer_type, child_level, _def_w, _def_h, _blend_mode, opacity = (
        struct.unpack_from("<HHHHHHB", data, payload_start)
    )
    resolved_opacity = opacity if (header_flags & _HEADER_FLAG_LAYER_OPACITY_VALID) else 255

    while group_stack and group_stack[-1][0] >= child_level:
        group_stack.pop()
    ancestor_visible = group_stack[-1][1] if group_stack else True
    own_visible = bool(flags & _LAYER_FLAG_VISIBLE)
    effective_visible = own_visible and ancestor_visible

    if layer_type == _LAYER_TYPE_GROUP:
        group_stack.append((child_level, effective_visible))

    layers.append(
        _Layer(
            flags=flags,
            type=layer_type,
            opacity=resolved_opacity,
            effective_visible=effective_visible,
        )
    )


def _handle_new_palette_chunk(
    data: bytes,
    payload_start: int,
    payload_end: int,
    palette: list[tuple[int, int, int, int]],
) -> None:
    if payload_start + 20 > payload_end:
        raise DecodeError("truncated palette chunk header")
    new_size, first_index, last_index = struct.unpack_from("<III", data, payload_start)
    if len(palette) < new_size:
        palette.extend([(0, 0, 0, 0)] * (new_size - len(palette)))

    cursor = payload_start + 20
    for index in range(first_index, last_index + 1):
        if cursor + 6 > payload_end:
            raise DecodeError("truncated palette chunk entry")
        entry_flags, r, g, b, a = struct.unpack_from("<HBBBB", data, cursor)
        cursor += 6
        if entry_flags & 0x1:
            if cursor + 2 > payload_end:
                raise DecodeError("truncated palette chunk entry name length")
            (name_len,) = struct.unpack_from("<H", data, cursor)
            cursor += 2 + name_len
        if index >= len(palette):
            palette.extend([(0, 0, 0, 0)] * (index - len(palette) + 1))
        palette[index] = (r, g, b, a)


def _handle_old_palette_chunk(
    data: bytes,
    payload_start: int,
    payload_end: int,
    palette: list[tuple[int, int, int, int]],
    *,
    scale_6bit: bool,
) -> None:
    if payload_start + 2 > payload_end:
        raise DecodeError("truncated old palette chunk header")
    (num_packets,) = struct.unpack_from("<H", data, payload_start)
    cursor = payload_start + 2
    index = 0
    for _ in range(num_packets):
        if cursor + 2 > payload_end:
            raise DecodeError("truncated old palette packet header")
        skip, num_colors = struct.unpack_from("<BB", data, cursor)
        cursor += 2
        index += skip
        count = 256 if num_colors == 0 else num_colors
        for _ in range(count):
            if cursor + 3 > payload_end:
                raise DecodeError("truncated old palette color entry")
            r, g, b = struct.unpack_from("<BBB", data, cursor)
            cursor += 3
            if scale_6bit:
                r = r * 255 // 63
                g = g * 255 // 63
                b = b * 255 // 63
            if index >= len(palette):
                palette.extend([(0, 0, 0, 0)] * (index - len(palette) + 1))
            palette[index] = (r, g, b, 255)
            index += 1


def _handle_cel_chunk(
    Image,
    data: bytes,
    payload_start: int,
    payload_end: int,
    frame_index: int,
    layers: list[_Layer],
    palette: list[tuple[int, int, int, int]],
    transparent_index: int,
    depth: int,
    cel_cache: dict[tuple[int, int], "Image.Image"],
) -> _PendingCel | None:
    if payload_start + 16 > payload_end:
        raise DecodeError(f"truncated cel chunk in frame {frame_index}")
    layer_index, x, y, opacity, cel_type, z_index, _pad = struct.unpack_from(
        _CEL_FIXED_FMT, data, payload_start
    )
    if layer_index >= len(layers):
        raise DecodeError(f"cel in frame {frame_index} references unknown layer {layer_index}")
    layer = layers[layer_index]
    body_start = payload_start + 16

    if cel_type == _CEL_TYPE_LINKED:
        if body_start + 2 > payload_end:
            raise DecodeError(f"truncated linked cel in frame {frame_index}")
        (linked_frame,) = struct.unpack_from("<H", data, body_start)
        key = (layer_index, linked_frame)
        if key not in cel_cache:
            raise DecodeError(
                f"linked cel in frame {frame_index} layer {layer_index} points to "
                f"frame {linked_frame}, which has no stored cel on that layer"
            )
        image = cel_cache[key]
    elif cel_type in (_CEL_TYPE_RAW, _CEL_TYPE_COMPRESSED):
        if body_start + 4 > payload_end:
            raise DecodeError(f"truncated image cel in frame {frame_index}")
        cel_width, cel_height = struct.unpack_from("<HH", data, body_start)
        raw_payload = data[body_start + 4 : payload_end]
        if cel_type == _CEL_TYPE_COMPRESSED:
            try:
                raw = zlib.decompress(raw_payload)
            except zlib.error as err:
                raise DecodeError(
                    f"corrupt zlib-compressed cel data in frame {frame_index}: {err}"
                ) from err
        else:
            raw = raw_payload
        rgba = _pixels_to_rgba(
            raw, cel_width, cel_height, depth, palette, transparent_index, layer.is_background
        )
        image = Image.frombytes("RGBA", (cel_width, cel_height), rgba)
        cel_cache[(layer_index, frame_index)] = image
    elif cel_type == _CEL_TYPE_COMPRESSED_TILEMAP:
        return None  # tilemap cels carry no raster output -- out of scope, must not crash
    else:
        raise DecodeError(f"unsupported cel type {cel_type} in frame {frame_index}")

    if layer.type == _LAYER_TYPE_TILEMAP:
        return None  # tilemap layers contribute no raster content

    return _PendingCel(
        layer_index=layer_index, x=x, y=y, opacity=opacity, z_index=z_index, image=image
    )


def _pixels_to_rgba(
    raw: bytes,
    width: int,
    height: int,
    depth: int,
    palette: list[tuple[int, int, int, int]],
    transparent_index: int,
    is_background: bool,
) -> bytes:
    """Expand a decompressed/raw ASE pixel buffer (indexed/grayscale/RGBA, per `depth`)
    into straight RGBA bytes, per the spec's PIXEL definition."""
    count = width * height

    if depth == 32:
        expected = count * 4
        if len(raw) < expected:
            raise DecodeError("truncated 32bpp (RGBA) cel pixel data")
        return raw[:expected]

    if depth == 16:
        expected = count * 2
        if len(raw) < expected:
            raise DecodeError("truncated 16bpp (grayscale) cel pixel data")
        out = bytearray(count * 4)
        for i in range(count):
            value = raw[i * 2]
            alpha = raw[i * 2 + 1]
            out[i * 4 : i * 4 + 4] = (value, value, value, alpha)
        return bytes(out)

    # depth == 8: indexed
    expected = count
    if len(raw) < expected:
        raise DecodeError("truncated 8bpp (indexed) cel pixel data")
    out = bytearray(count * 4)
    for i in range(count):
        index = raw[i]
        if (not is_background) and index == transparent_index:
            out[i * 4 : i * 4 + 4] = (0, 0, 0, 0)
        elif index < len(palette):
            out[i * 4 : i * 4 + 4] = palette[index]
        else:
            out[i * 4 : i * 4 + 4] = (0, 0, 0, 0)
    return bytes(out)


def _composite_frame(Image, pending_cels: list[_PendingCel], layers: list[_Layer], width: int, height: int):
    """Alpha-composite one frame's cels, back-to-front, per NOTE.5's `layerIndex +
    zIndex` render-order algorithm, honoring group-inherited visibility and
    `layer_opacity * cel_opacity`."""
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ordered = sorted(pending_cels, key=lambda cel: (cel.layer_index + cel.z_index, cel.z_index))
    for cel in ordered:
        layer = layers[cel.layer_index]
        if not layer.effective_visible:
            continue
        alpha_mult = (layer.opacity / 255.0) * (cel.opacity / 255.0)
        if alpha_mult <= 0:
            continue
        canvas = _blit(Image, canvas, cel.image, cel.x, cel.y, alpha_mult)
    return canvas


def _blit(Image, canvas, cel_image, x: int, y: int, alpha_mult: float):
    """Alpha-composite `cel_image` onto `canvas` at `(x, y)`, clipped to canvas bounds,
    scaling the cel's own per-pixel alpha by `alpha_mult` first."""
    cel_width, cel_height = cel_image.size
    canvas_width, canvas_height = canvas.size

    src_x0 = max(0, -x)
    src_y0 = max(0, -y)
    src_x1 = min(cel_width, canvas_width - x)
    src_y1 = min(cel_height, canvas_height - y)
    if src_x0 >= src_x1 or src_y0 >= src_y1:
        return canvas  # fully off-canvas

    region = cel_image.crop((src_x0, src_y0, src_x1, src_y1))
    if alpha_mult < 1.0:
        table = [int(round(v * alpha_mult)) for v in range(256)]
        r, g, b, a = region.split()
        a = a.point(table)
        region = Image.merge("RGBA", (r, g, b, a))

    # Place the (possibly alpha-scaled) region into a canvas-sized transparent layer via
    # a plain, mask-less paste -- this copies pixels verbatim including their alpha
    # channel, rather than corrupting alpha by re-blending it through itself as a mask --
    # then `alpha_composite` that whole layer over the accumulated canvas with the
    # standard "over" formula.
    dst_x0 = max(0, x)
    dst_y0 = max(0, y)
    layer_image = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer_image.paste(region, (dst_x0, dst_y0))
    return Image.alpha_composite(canvas, layer_image)
