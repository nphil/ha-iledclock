"""Animated/still raster import via Pillow: GIF (animated), PNG (incl. APNG), JPEG, and
WebP (incl. animated).

Pillow's `GifImagePlugin`/`WebPImagePlugin`/`PngImagePlugin` already fully resolve each
format's own inter-frame disposal semantics (GIF disposal method 0-3, APNG
`fcTL`/`blend_op`, WebP's frame-diff encoding) *internally* across a `seek()` -- calling
`.convert("RGBA")` right after each `seek(n)` returns that frame already composited
exactly as the format's own player would show it, for every format Pillow supports here.
So this module never re-implements disposal/blend bookkeeping itself; it just walks
frames and converts each one, which is the documented and verified-safe way to read them
(confirmed against Pillow 12.3: GIF/WebP/APNG round-trips with restore-to-background
disposal all decode to the intended per-frame display, not to the raw undisposed diff).
"""

from __future__ import annotations

import io

from . import DecodeError, DecodedImage

#: Sanity ceiling on frame count for a single import -- guards against a pathological or
#: corrupt file with a huge declared frame count; `adapt.py`'s own decimation handles the
#: normal "too many frames for the device" case (`const.DESIGN_MAX_FRAMES`), this is only
#: a hard stop against something absurd (e.g. a fuzzed header claiming 10**9 frames).
_MAX_FRAMES = 4096


def load(data: bytes) -> DecodedImage:
    """Decode `data` (the raw bytes of a GIF/PNG/JPEG/WebP file) into a `DecodedImage`."""
    from PIL import Image, UnidentifiedImageError

    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except (UnidentifiedImageError, OSError, ValueError) as err:
        raise DecodeError(f"not a supported image file: {err}") from err

    frame_count = min(getattr(im, "n_frames", 1), _MAX_FRAMES)
    frames: list = []
    delays_ms: list[int] = []
    for index in range(frame_count):
        im.seek(index)
        frames.append(im.convert("RGBA"))
        delays_ms.append(round(float(im.info.get("duration", 0) or 0)))

    return DecodedImage(frames=frames, delays_ms=delays_ms)
