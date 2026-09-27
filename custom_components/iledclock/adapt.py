"""The adaptation pipeline: decoded source frames (RGBA, any size) -> 32x16 RGB888 frames
that look right on the LED matrix (docs/GALLERY.md "Adaptation pipeline" is the spec this
implements step by step). Pure Python, no `homeassistant` imports; Pillow is the only
dependency and is imported lazily inside functions. Colour/power/delay/budget rules come
from `hardware.py` (the evidence-graded device capability profile) instead of invented
constants, per Main's steer (2026-09-26) -- see each step below for exactly which
`hardware` helper backs it.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from . import hardware
from .const import DESIGN_MAX_FRAMES, DESIGN_MIN_DELAY_MS, DISPLAY_HEIGHT, DISPLAY_WIDTH

#: `hardware.ContentPath` our own uploaded art (animation/graffiti frames) always uses --
#: the curved RGB444 transfer, per docs/HARDWARE.md 2.2 (never the linear one, which is
#: only for firmware-native content like the clock/date/temperature layers).
_COLOUR_PATH = "animation"

FRAME_BYTES = DISPLAY_WIDTH * DISPLAY_HEIGHT * 3
CANVAS_SIZE = (DISPLAY_WIDTH, DISPLAY_HEIGHT)
DEFAULT_BACKGROUND: tuple[int, int, int] = (0, 0, 0)

#: docs/GALLERY.md step 4: every layout this pipeline offers.
LAYOUTS: tuple[str, ...] = (
    "auto", "center", "fit", "fill", "stretch", "tile", "mirror", "icon_with_clock",
)

#: docs/GALLERY.md step 6: "clamp each delay to [20 ms, 10 000 ms]". This is a pipeline
#: QUALITY POLICY for auto-adapted content, deliberately narrower than `hardware.py`'s own
#: generic wire-level range (0-65535ms, `ANIMATION_DELAY_WIRE_MAX_MS`) or the design
#: library's broader hand-authored-content allowance (`const.DESIGN_MAX_DELAY_MS` =
#: 60_000ms) -- still implemented via `hardware.quantize_delay_ms`, just parameterised
#: with this step's own bounds rather than that function's defaults.
_TIMING_FLOOR_MS = DESIGN_MIN_DELAY_MS
_TIMING_CEILING_MS = 10_000

#: docs/GALLERY.md step 6: "if frames > const.DESIGN_MAX_FRAMES (64) decimate evenly"
#: (imported above alongside the other geometry/design constants).


class AdaptError(ValueError):
    """Raised for a structurally invalid input (no frames, mismatched frame/delay count,
    an unknown layout name, an out-of-range power-user override)."""


@dataclass(frozen=True, slots=True)
class AdaptOptions:
    """Power-user overrides (docs/GALLERY.md step 4's "Power-user overrides" bullet).
    Every field left `None`/default lets the pipeline choose automatically."""

    layout: str | None = None
    #: Explicit crop in SOURCE pixels (x, y, w, h); overrides steps 1+2 (scale recovery
    #: and auto-trim) entirely -- the user has already told us exactly what to keep.
    crop: tuple[int, int, int, int] | None = None
    #: Explicit integer downscale/upscale factor; overrides step 1's auto-detected scale.
    scale: int | None = None
    #: Extra placement offset (in output/canvas pixels) applied after layout placement.
    offset: tuple[int, int] = (0, 0)
    #: RGB background fill; `None` -> black (`DEFAULT_BACKGROUND`).
    background: tuple[int, int, int] | None = None
    #: `None` -> layout-dependent default (docs/GALLERY.md: true for photos, false for
    #: pixel art).
    enhance: bool | None = None
    #: `icon_with_clock` only: the icon's square side length in output pixels (8 or 16
    #: per docs/GALLERY.md's "8x8/16x16 art"; clamped into a sane range regardless).
    icon_size: int = 16

    @classmethod
    def from_mapping(cls, options: "AdaptOptions | Mapping[str, Any] | None") -> "AdaptOptions":
        if options is None:
            return cls()
        if isinstance(options, AdaptOptions):
            return options
        if not isinstance(options, Mapping):
            raise AdaptError(f"options must be a mapping or AdaptOptions, got {type(options)!r}")
        kwargs: dict[str, Any] = {}
        if "layout" in options and options["layout"] is not None:
            kwargs["layout"] = str(options["layout"])
        if "crop" in options and options["crop"] is not None:
            crop = options["crop"]
            if isinstance(crop, Mapping):
                crop = (crop["x"], crop["y"], crop["w"], crop["h"])
            kwargs["crop"] = tuple(int(v) for v in crop)
            if len(kwargs["crop"]) != 4:
                raise AdaptError("crop must have exactly 4 values (x, y, w, h)")
        if "scale" in options and options["scale"] is not None:
            kwargs["scale"] = int(options["scale"])
            if kwargs["scale"] < 1:
                raise AdaptError(f"scale must be >= 1, got {kwargs['scale']}")
        if "offset" in options and options["offset"] is not None:
            offset = options["offset"]
            if isinstance(offset, Mapping):
                offset = (offset["x"], offset["y"])
            kwargs["offset"] = (int(offset[0]), int(offset[1]))
        if "background" in options and options["background"] is not None:
            bg = options["background"]
            if isinstance(bg, str):
                bg = _hex_to_rgb(bg)
            kwargs["background"] = tuple(int(v) for v in bg)
            if len(kwargs["background"]) != 3:
                raise AdaptError("background must have exactly 3 values (r, g, b)")
        if "enhance" in options and options["enhance"] is not None:
            kwargs["enhance"] = bool(options["enhance"])
        if "icon_size" in options and options["icon_size"] is not None:
            kwargs["icon_size"] = int(options["icon_size"])
        return cls(**kwargs)


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    text = value.lstrip("#")
    if len(text) != 6:
        raise AdaptError(f"invalid hex colour {value!r}")
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError as err:
        raise AdaptError(f"invalid hex colour {value!r}") from err


@dataclass(frozen=True, slots=True)
class Adapted:
    """docs/GALLERY.md step 0: the pipeline's output shape."""

    frames: list[bytes]  # each exactly FRAME_BYTES (32*16*3), RGB888
    delays_ms: list[int]
    layout: str
    layouts_available: tuple[str, ...]
    report: dict[str, Any]


# ============================================================================
# Step 1: recover true pixels
# ============================================================================
def _detect_block_size(
    img: Any, *, max_block: int = 32, noise_tolerance: float = 0.02, channel_tolerance: int = 24
) -> int:
    """Largest k in [1, max_block] such that partitioning `img` into k*k blocks (the
    region `(w//k)*k` x `(h//k)*k`; any remainder strip at the right/bottom is ignored)
    leaves at most `noise_tolerance` fraction of blocks non-uniform -- "non-uniform"
    meaning at least one pixel in that block differs from the block's own mean colour by
    more than `channel_tolerance` in any channel (tolerates GIF/JPEG compression
    artefacts without accepting genuinely detailed/noisy content as pixel art). A
    candidate `k` that collapses the whole image to a single flat colour is rejected
    (falling through to a smaller `k`, ultimately `1`): a single-colour icon has no
    structure to "recover" at any scale, so treating it as if it had a 1x1 native size
    would discard information rather than recover it.

    Implemented with Pillow's own C-level `resize`/`ImageChops` rather than per-pixel
    Python loops: a BOX-filter downsample-then-NEAREST-upsample reconstructs "what a
    uniform block would look like"; the pixel-wise difference from the original, reduced
    a second time with BOX filtering, gives an exact per-block "was any pixel bad" signal
    (a 0-average block has zero bad pixels; any positive average means at least one).
    """
    from PIL import Image, ImageChops

    w, h = img.size
    max_k = max(1, min(max_block, w, h))
    if max_k <= 1:
        return 1
    rgba = img.convert("RGBA")
    for k in range(max_k, 1, -1):
        cols, rows = w // k, h // k
        if cols < 1 or rows < 1:
            continue
        crop_w, crop_h = cols * k, rows * k
        region = rgba.crop((0, 0, crop_w, crop_h))
        down = region.resize((cols, rows), Image.BOX)
        if len(down.convert("RGB").getcolors(maxcolors=cols * rows) or []) <= 1:
            continue
        up = down.resize((crop_w, crop_h), Image.NEAREST)
        diff = ImageChops.difference(region, up)
        bands = diff.split()
        worst = bands[0]
        for band in bands[1:]:
            worst = ImageChops.lighter(worst, band)
        bad_mask = worst.point(lambda v: 255 if v > channel_tolerance else 0)
        block_bad_avg = bad_mask.resize((cols, rows), Image.BOX)
        good_blocks = block_bad_avg.histogram()[0]
        total_blocks = cols * rows
        noisy_blocks = total_blocks - good_blocks
        if noisy_blocks / total_blocks <= noise_tolerance:
            return k
    return 1


def _recover_native_size(img: Any, *, forced_scale: int | None) -> tuple[Any, int]:
    """Detect (or accept a power-user-forced) integer upscale factor and downsample by
    it. Returns `(recovered_image, detected_scale)`; `detected_scale` is always exactly
    what was applied (1 means "no upscale detected/forced -- used as-is")."""
    from PIL import Image

    if forced_scale is not None:
        scale = forced_scale
    else:
        scale = _detect_block_size(img)
    if scale <= 1:
        return img.convert("RGBA"), 1
    w, h = img.size
    cols, rows = w // scale, h // scale
    if cols < 1 or rows < 1:
        return img.convert("RGBA"), 1
    cropped = img.convert("RGBA").crop((0, 0, cols * scale, rows * scale))
    recovered = cropped.resize((cols, rows), Image.BOX)
    return recovered, scale


# ============================================================================
# Step 2: trim shared borders
# ============================================================================
def _detect_border_background(img: Any) -> tuple[int, int, int, int]:
    """Guess a solid border colour from the four corners (majority vote) -- used to trim
    a uniform (but fully opaque, i.e. non-transparent) background border."""
    w, h = img.size
    corners = [img.getpixel((0, 0)), img.getpixel((w - 1, 0)), img.getpixel((0, h - 1)), img.getpixel((w - 1, h - 1))]
    return Counter(corners).most_common(1)[0][0]


def _content_bbox(img: Any, *, tolerance: int = 4) -> tuple[int, int, int, int] | None:
    """Bounding box (PIL convention: `(x0, y0, x1, y1)`, `x1`/`y1` exclusive) of pixels
    that are neither fully transparent NOR within `tolerance` of the guessed border
    background colour. `None` if every pixel is background/transparent."""
    from PIL import Image, ImageChops

    w, h = img.size
    bg = _detect_border_background(img)
    bg_img = Image.new("RGBA", (w, h), bg)
    diff = ImageChops.difference(img, bg_img)
    r, g, b, a_diff = diff.split()
    worst_rgb = ImageChops.lighter(ImageChops.lighter(r, g), b)
    rgb_differs = worst_rgb.point(lambda v: 255 if v > tolerance else 0)
    alpha_differs = a_diff.point(lambda v: 255 if v > tolerance else 0)
    differs = ImageChops.lighter(rgb_differs, alpha_differs)
    not_transparent = img.split()[3].point(lambda v: 255 if v > 0 else 0)
    content_mask = ImageChops.darker(differs, not_transparent)
    return content_mask.getbbox()


def _shared_trim_box(frames: Sequence[Any]) -> tuple[int, int, int, int] | None:
    """One bounding box covering every frame's own content bbox (the union), so the same
    rectangle crops every frame identically -- no per-frame jitter."""
    boxes = [_content_bbox(f) for f in frames]
    real_boxes = [b for b in boxes if b is not None]
    if not real_boxes:
        return None
    return (
        min(b[0] for b in real_boxes),
        min(b[1] for b in real_boxes),
        max(b[2] for b in real_boxes),
        max(b[3] for b in real_boxes),
    )


# ============================================================================
# Step 4 helper: majority (mode) pooling -- crisp integer downscale for pixel art.
# ============================================================================
def _majority_pool(img: Any, factor: int) -> Any:
    """Downsample `img` by integer `factor` using per-block majority (mode) colour.
    Preserves 1px lines/outlines that area-average pooling would blur into grey."""
    from PIL import Image

    if factor <= 1:
        return img.convert("RGBA")
    w, h = img.size
    out_w, out_h = max(1, w // factor), max(1, h // factor)
    src = img.convert("RGBA")
    pixels = src.load()
    out = Image.new("RGBA", (out_w, out_h))
    out_pixels = out.load()
    for oy in range(out_h):
        for ox in range(out_w):
            counts: dict[tuple[int, int, int, int], int] = {}
            order: list[tuple[int, int, int, int]] = []
            for dy in range(factor):
                y = oy * factor + dy
                if y >= h:
                    continue
                for dx in range(factor):
                    x = ox * factor + dx
                    if x >= w:
                        continue
                    p = pixels[x, y]
                    if p not in counts:
                        counts[p] = 0
                        order.append(p)
                    counts[p] += 1
            out_pixels[ox, oy] = max(order, key=lambda p: counts[p])
    return out


# ============================================================================
# Step 4: layouts
# ============================================================================
def _paste_rgba(canvas: Any, src: Any, xy: tuple[int, int]) -> None:
    canvas.paste(src, xy, src)


def _layout_center(img: Any, *, canvas_size: tuple[int, int], background: tuple[int, int, int, int]) -> Any:
    from PIL import Image

    cw, ch = canvas_size
    w, h = img.size
    src = img
    if w > cw or h > ch:
        x0 = max(0, (w - cw) // 2)
        y0 = max(0, (h - ch) // 2)
        src = img.crop((x0, y0, x0 + min(w, cw), y0 + min(h, ch)))
        w, h = src.size
    canvas = Image.new("RGBA", canvas_size, background)
    _paste_rgba(canvas, src, ((cw - w) // 2, (ch - h) // 2))
    return canvas


def _layout_stretch(img: Any, *, canvas_size: tuple[int, int]) -> Any:
    from PIL import Image

    return img.resize(canvas_size, Image.NEAREST).convert("RGBA")


def _layout_fit(img: Any, *, canvas_size: tuple[int, int], background: tuple[int, int, int, int]) -> Any:
    from PIL import Image

    cw, ch = canvas_size
    w, h = img.size
    scale = min(cw / w, ch / h) if w and h else 1.0
    new_w = max(1, round(w * scale))
    new_h = max(1, round(h * scale))
    resized = img.resize((new_w, new_h), Image.NEAREST)
    canvas = Image.new("RGBA", canvas_size, background)
    _paste_rgba(canvas, resized, ((cw - new_w) // 2, (ch - new_h) // 2))
    return canvas


def _layout_fill(img: Any, *, canvas_size: tuple[int, int], focus: tuple[float, float] | None) -> Any:
    cw, ch = canvas_size
    w, h = img.size
    scale = max(cw / w, ch / h) if w and h else 1.0
    new_w = max(cw, round(w * scale))
    new_h = max(ch, round(h * scale))
    from PIL import Image

    resized = img.resize((new_w, new_h), Image.NEAREST)
    if focus is None:
        fx, fy = new_w / 2, new_h / 2
    else:
        fx, fy = focus[0] * scale, focus[1] * scale
    x0 = int(round(fx - cw / 2))
    y0 = int(round(fy - ch / 2))
    x0 = max(0, min(new_w - cw, x0))
    y0 = max(0, min(new_h - ch, y0))
    return resized.crop((x0, y0, x0 + cw, y0 + ch))


def _layout_tile(img: Any, *, canvas_size: tuple[int, int], background: tuple[int, int, int, int]) -> Any:
    from PIL import Image

    cw, ch = canvas_size
    w, h = img.size
    canvas = Image.new("RGBA", canvas_size, background)
    if w <= 0:
        return canvas
    oy = max(0, (ch - h) // 2)
    x = 0
    while x < cw:
        _paste_rgba(canvas, img, (x, oy))
        x += w
    return canvas


def _layout_mirror(img: Any, *, canvas_size: tuple[int, int], background: tuple[int, int, int, int]) -> Any:
    from PIL import Image

    cw, ch = canvas_size
    half_w = cw // 2
    half_canvas = _layout_fit(img, canvas_size=(half_w, ch), background=background)
    mirrored = half_canvas.transpose(Image.FLIP_LEFT_RIGHT)
    canvas = Image.new("RGBA", canvas_size, background)
    _paste_rgba(canvas, half_canvas, (0, 0))
    _paste_rgba(canvas, mirrored, (cw - half_w, 0))
    return canvas


#: docs/HARDWARE.md open question #8: exact minimum practical clock-digit column width is
#: unconfirmed. Placeholder default until that lands (see `_icon_with_clock_icon_size`).
_ICON_WITH_CLOCK_DEFAULT_ICON_SIZE = 16


def _layout_icon_with_clock(
    img: Any, *, canvas_size: tuple[int, int], background: tuple[int, int, int, int], icon_size: int
) -> tuple[Any, tuple[int, int, int, int]]:
    """docs/GALLERY.md/Main's steer: small art in a region beside a LIVE native clock
    layer (`hardware.NATIVE_LAYERS["clock"]`), never replacing it. Places the art in an
    `icon_size` x `icon_size` square on the left, vertically centred; the remaining
    columns are reported as `native_region` for a caller to compose a real CLOCK
    combine-program into (out of scope for this pure pixel pipeline -- see
    `hardware.NATIVE_LAYERS["clock"]`/`LAYER_MODEL` for the wire-level side of this).
    Disjoint regions only (never overlapping the clock's own columns): structurally safe
    regardless of docs/HARDWARE.md open question #5 (overlap-transparency semantics are
    still unconfirmed; disjoint placement never needs that answer).
    """
    from PIL import Image

    cw, ch = canvas_size
    icon_size = max(8, min(icon_size, ch, cw - 1))
    icon_canvas = _layout_fit(img, canvas_size=(icon_size, icon_size), background=background)
    canvas = Image.new("RGBA", canvas_size, background)
    oy = (ch - icon_size) // 2
    _paste_rgba(canvas, icon_canvas, (0, oy))
    region = (icon_size, 0, cw - icon_size, ch)  # (x, y, w, h) reserved for the clock
    return canvas, region


def _apply_layout(
    img: Any,
    layout: str,
    *,
    canvas_size: tuple[int, int],
    background: tuple[int, int, int, int],
    icon_size: int,
) -> tuple[Any, tuple[int, int, int, int] | None]:
    if layout == "center":
        return _layout_center(img, canvas_size=canvas_size, background=background), None
    if layout == "fit":
        return _layout_fit(img, canvas_size=canvas_size, background=background), None
    if layout == "fill":
        return _layout_fill(img, canvas_size=canvas_size, focus=None), None
    if layout == "stretch":
        return _layout_stretch(img, canvas_size=canvas_size), None
    if layout == "tile":
        return _layout_tile(img, canvas_size=canvas_size, background=background), None
    if layout == "mirror":
        return _layout_mirror(img, canvas_size=canvas_size, background=background), None
    if layout == "icon_with_clock":
        return _layout_icon_with_clock(img, canvas_size=canvas_size, background=background, icon_size=icon_size)
    raise AdaptError(f"unknown layout {layout!r}; choose one of {LAYOUTS}")


#: Pixel art is drawn from a small palette; photos and video frames have thousands of colours.
_PIXEL_ART_MAX_COLOURS = 256


def _looks_like_photo(size: tuple[int, int], *, detected_scale: int, sample: Any) -> bool:
    """Whether auto layout should treat the content as a photo (smooth fit + enhance) rather
    than pixel art (crisp 1:1 or majority pooling, colours untouched).

    Pixel art when ANY of: it already fits the panel (32x16 or smaller - e.g. a 32x8 AWTRIX strip,
    which a shape-only rule misread as a photo); step 1 recovered an integer upscale (only pixel
    art is drawn in exact k x k blocks); or it uses a small palette. A photo otherwise.
    """
    w, h = size
    if w <= DISPLAY_WIDTH and h <= DISPLAY_HEIGHT:
        return False
    if detected_scale > 1:
        return False
    colours = sample.convert("RGB").getcolors(_PIXEL_ART_MAX_COLOURS)
    return colours is None  # getcolors returns None when there are more than the limit


def _auto_layout(
    img: Any, *, canvas_size: tuple[int, int], background: tuple[int, int, int, int], is_photo: bool
) -> tuple[Any, str]:
    """docs/GALLERY.md step 4 "auto" bullet."""
    cw, ch = canvas_size
    w, h = img.size
    if is_photo:
        return _layout_fit(img, canvas_size=canvas_size, background=background), "fit-like (photo)"
    if w <= cw and h <= ch:
        # "<=16px tall art at 1:1 centered; 32x8 art 1:1 vertically centered" -- both are
        # the same rule (1:1, centre, crop only if wider than the panel).
        return _layout_center(img, canvas_size=canvas_size, background=background), "center-like (small)"
    # "square art >16px downscaled by an integer factor to <=16px using majority pooling"
    # -- generalised to any pixel-art content bigger than the panel in either axis, not
    # only exactly-square content, using one shared factor so aspect ratio is preserved.
    import math

    factor = max(1, math.ceil(max(w, h) / ch))
    pooled = _majority_pool(img, factor)
    return _layout_center(pooled, canvas_size=canvas_size, background=background), f"majority-pool-x{factor}"


# ============================================================================
# Step 5: readability
# ============================================================================
def _minimum_visible_level(path: str = _COLOUR_PATH) -> int:
    """Smallest RGB888 channel value that survives `hardware.encode_channel` as a nonzero
    (visible) nibble on `path` -- the device-accurate "vanishes when quantized" floor,
    superseding docs/GALLERY.md's illustrative `0x20` with the real curve from
    `hardware.py` (per Main's steer: use hardware.py's helpers instead of guessed
    constants)."""
    for v in range(256):
        if hardware.encode_channel(v, path) > 0:
            return v
    return 255


def _lift_near_black(img: Any, background: tuple[int, int, int, int], *, path: str = _COLOUR_PATH) -> Any:
    """Lift any non-background pixel whose max RGB channel is below the real
    quantization floor to exactly that floor, preserving hue/ratio (or, for a pixel that
    is pure black yet still distinct from `background`, lifting to a neutral grey at the
    floor -- there is no hue to preserve)."""
    threshold = _minimum_visible_level(path)
    w, h = img.size
    src = img.convert("RGBA")
    pixels = src.load()
    out = src.copy()
    out_pixels = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if (r, g, b, a) == background:
                continue
            m = max(r, g, b)
            if m >= threshold:
                continue
            if m == 0:
                out_pixels[x, y] = (threshold, threshold, threshold, a)
            else:
                factor = threshold / m
                out_pixels[x, y] = (
                    min(255, round(r * factor)),
                    min(255, round(g * factor)),
                    min(255, round(b * factor)),
                    a,
                )
    return out


def _enhance(img: Any) -> Any:
    """Modest saturation + contrast boost for photographic content, so the device's
    coarse 4-bit-per-channel colour depth doesn't wash everything out to grey/muddy
    tones. Never applied to pixel art (its colours are already deliberately chosen)."""
    from PIL import ImageEnhance

    boosted = ImageEnhance.Color(img.convert("RGB")).enhance(1.35)
    boosted = ImageEnhance.Contrast(boosted).enhance(1.15)
    return boosted.convert("RGBA")


# ============================================================================
# Step 6: timing
# ============================================================================
def _merge_identical_frames(frames: list[bytes], delays_ms: list[int]) -> tuple[list[bytes], list[int]]:
    if not frames:
        return frames, delays_ms
    out_frames = [frames[0]]
    out_delays = [delays_ms[0]]
    for frame, delay in zip(frames[1:], delays_ms[1:]):
        if frame == out_frames[-1]:
            out_delays[-1] += delay
        else:
            out_frames.append(frame)
            out_delays.append(delay)
    return out_frames, out_delays


def _clamp_delays(delays_ms: list[int]) -> list[int]:
    return [
        hardware.quantize_delay_ms(d, floor_ms=_TIMING_FLOOR_MS, ceiling_ms=_TIMING_CEILING_MS)
        for d in delays_ms
    ]


def _decimate_preserving_duration(
    frames: list[bytes], delays_ms: list[int], max_frames: int
) -> tuple[list[bytes], list[int]]:
    n = len(frames)
    if n <= max_frames:
        return frames, delays_ms
    total = sum(delays_ms)
    starts: list[int] = []
    acc = 0
    for d in delays_ms:
        starts.append(acc)
        acc += d
    ends = starts[1:] + [total]

    m = max_frames
    base_delay = total // m
    remainder = total - base_delay * m
    out_delays = [base_delay + (1 if i < remainder else 0) for i in range(m)]
    out_frames: list[bytes] = []
    slot_start = 0
    for j in range(m):
        slot_len = out_delays[j]
        sample_t = slot_start + slot_len / 2
        slot_start += slot_len
        idx = n - 1
        for i in range(n):
            if starts[i] <= sample_t < ends[i]:
                idx = i
                break
        out_frames.append(frames[idx])
    return out_frames, out_delays


# ============================================================================
# Orchestration
# ============================================================================
def _pil_to_rgb888(img: Any, background_rgb: tuple[int, int, int]) -> bytes:
    """Flatten an RGBA canvas-sized image to raw RGB888 bytes, compositing any remaining
    alpha onto `background_rgb` (defensive -- by this point in the pipeline every pixel
    should already be fully opaque, but this guarantees a valid RGB888 buffer either
    way)."""
    from PIL import Image

    if img.mode != "RGBA":
        img = img.convert("RGBA")
    flat = Image.new("RGB", img.size, background_rgb)
    flat.paste(img, (0, 0), img)
    return flat.tobytes()


def adapt(
    frames: Sequence[Any], delays_ms: Sequence[int], options: "AdaptOptions | Mapping[str, Any] | None" = None
) -> Adapted:
    """Run the full pipeline. `frames`: Pillow `Image` objects, mode "RGBA" (matches
    `importers.DecodedImage.frames`); `delays_ms`: same length, milliseconds per frame."""
    from PIL import Image

    frames = list(frames)
    delays_ms = list(delays_ms)
    if not frames:
        raise AdaptError("adapt() requires at least one frame")
    if len(frames) != len(delays_ms):
        raise AdaptError(f"frames/delays_ms length mismatch: {len(frames)} vs {len(delays_ms)}")

    opts = AdaptOptions.from_mapping(options)
    background_rgb = opts.background if opts.background is not None else DEFAULT_BACKGROUND
    background_rgba = (*background_rgb, 255)
    notes: list[str] = []

    native_size = frames[0].size
    frames_in = len(frames)
    duration_in_ms = sum(delays_ms)

    # --- Step 1: recover true pixels (or honour an explicit crop/scale override) ---
    if opts.crop is not None:
        x, y, cw, ch = opts.crop
        if cw <= 0 or ch <= 0:
            raise AdaptError(f"crop width/height must be positive, got {opts.crop}")
        recovered_frames = [f.convert("RGBA").crop((x, y, x + cw, y + ch)) for f in frames]
        detected_scale = opts.scale or 1
        notes.append(f"explicit crop {opts.crop} applied; scale recovery skipped")
    else:
        recovered_frames = []
        detected_scale = 1
        for index, f in enumerate(frames):
            recovered, scale = _recover_native_size(f, forced_scale=opts.scale)
            recovered_frames.append(recovered)
            if index == 0:
                detected_scale = scale
        if opts.scale is not None:
            notes.append(f"explicit scale {opts.scale} applied")
        elif detected_scale > 1:
            notes.append(f"recovered native pixel size (detected {detected_scale}x upscale)")

    # --- Step 2: shared trim ---
    trimmed_box = _shared_trim_box(recovered_frames)
    if trimmed_box is not None:
        x0, y0, x1, y1 = trimmed_box
        if (x1 - x0, y1 - y0) != recovered_frames[0].size:
            recovered_frames = [f.crop(trimmed_box) for f in recovered_frames]
            notes.append(f"trimmed shared border to {trimmed_box}")
    else:
        notes.append("every frame was fully transparent/background; nothing to trim")

    working_size = recovered_frames[0].size
    is_photo = _looks_like_photo(working_size, detected_scale=detected_scale, sample=recovered_frames[0])

    # --- Step 3: transparency composite ---
    composited_frames = []
    for f in recovered_frames:
        canvas = Image.new("RGBA", f.size, background_rgba)
        canvas.paste(f, (0, 0), f)
        composited_frames.append(canvas)

    # --- Step 4: fit to 32x16 by layout ---
    layout = opts.layout or "auto"
    if layout not in LAYOUTS:
        raise AdaptError(f"unknown layout {layout!r}; choose one of {LAYOUTS}")
    native_region: tuple[int, int, int, int] | None = None
    if layout == "auto":
        placed_frames = []
        auto_strategy = None
        for f in composited_frames:
            placed, auto_strategy = _auto_layout(
                f, canvas_size=CANVAS_SIZE, background=background_rgba, is_photo=is_photo
            )
            placed_frames.append(placed)
        if auto_strategy:
            notes.append(f"auto layout chose {auto_strategy}")
    else:
        placed_frames = []
        for f in composited_frames:
            placed, native_region = _apply_layout(
                f, layout, canvas_size=CANVAS_SIZE, background=background_rgba, icon_size=opts.icon_size
            )
            placed_frames.append(placed)

    # Power-user offset: shift the placed content by (dx, dy), wrapping nothing -- pixels
    # pushed off-canvas are simply cropped away, matching a manual nudge.
    if opts.offset != (0, 0):
        dx, dy = opts.offset
        shifted = []
        for f in placed_frames:
            canvas = Image.new("RGBA", CANVAS_SIZE, background_rgba)
            canvas.paste(f, (dx, dy))
            shifted.append(canvas)
        placed_frames = shifted
        notes.append(f"offset {opts.offset} applied")

    # --- Step 5: readability ---
    enhance = opts.enhance if opts.enhance is not None else is_photo
    readable_frames = []
    for f in placed_frames:
        lifted = _lift_near_black(f, background_rgba)
        if enhance:
            lifted = _enhance(lifted)
        readable_frames.append(lifted)
    if enhance:
        notes.append("saturation/contrast enhance applied")

    # --- Pack to RGB888 bytes ---
    rgb_frames = [_pil_to_rgb888(f, background_rgb) for f in readable_frames]

    # --- Step 6: timing ---
    merged_frames, merged_delays = _merge_identical_frames(rgb_frames, delays_ms)
    if len(merged_frames) != len(rgb_frames):
        notes.append(f"merged {len(rgb_frames) - len(merged_frames)} identical consecutive frame(s)")
    clamped_delays = _clamp_delays(merged_delays)
    if clamped_delays != merged_delays:
        notes.append(f"clamped delays to [{_TIMING_FLOOR_MS}, {_TIMING_CEILING_MS}] ms")
    final_frames, final_delays = merged_frames, clamped_delays
    if len(final_frames) > DESIGN_MAX_FRAMES:
        pre_decimate_count = len(final_frames)
        final_frames, final_delays = _decimate_preserving_duration(final_frames, final_delays, DESIGN_MAX_FRAMES)
        notes.append(
            f"decimated {pre_decimate_count} frames to {DESIGN_MAX_FRAMES}, preserving total loop duration"
        )

    report: dict[str, Any] = {
        "native_size": {"width": native_size[0], "height": native_size[1]},
        "detected_scale": detected_scale,
        "trimmed_box": (
            {"x": trimmed_box[0], "y": trimmed_box[1], "w": trimmed_box[2] - trimmed_box[0], "h": trimmed_box[3] - trimmed_box[1]}
            if trimmed_box is not None
            else None
        ),
        "frames_in": frames_in,
        "frames_out": len(final_frames),
        "duration_in_ms": duration_in_ms,
        "duration_out_ms": sum(final_delays),
        "notes": notes,
    }
    if native_region is not None:
        report["native_region"] = {
            "x": native_region[0], "y": native_region[1], "w": native_region[2], "h": native_region[3],
        }

    return Adapted(
        frames=final_frames,
        delays_ms=final_delays,
        layout=layout,
        layouts_available=LAYOUTS,
        report=report,
    )
