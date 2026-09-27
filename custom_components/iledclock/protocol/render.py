"""Local, non-device-facing pixel rendering: text-to-frames using our bundled fonts, image (and
animated GIF) import, procedural "generative" animations, and a PNG preview renderer for the
dashboard's ``image.<name>_display`` entity.

Nothing here talks to the vendor protocol directly -- everything funnels through
:class:`~.models.Frame` (the same RGB888 32x16 pixel currency ``programs.py``'s
``GraffitiContent``/``AnimationContent`` and ``program_builder.py`` already use), so a caller
never needs to know whether a frame came from typed text, a decoded image, or a procedural
effect before wrapping it as device content.

Pillow (``PIL``) is a real, heavy dependency of this module (image decoding, GIF frame
extraction, PNG encoding) -- imported lazily inside each function that needs it, matching this
project's "keep HA-dependent/heavy-dependency modules thin at import time" convention, even
though Pillow itself has nothing to do with Home Assistant.
"""

from __future__ import annotations

import colorsys
import math
import random
from dataclasses import dataclass
from typing import NamedTuple

from .fonts import get_font, glyph_height
from .hexutil import rgb444_expand, rgb444_pixel
from .models import RGB, Frame

DISPLAY_WIDTH = 32
DISPLAY_HEIGHT = 16


def quantize(rgb: RGB) -> RGB:
    """Rounds a full 0-255 RGB colour down to what the panel can actually show: RGB444
    (4 bits/channel, the same curve the wire format uses -- see ``hexutil.rgb444_pixel``) and
    back up to 0-255 via ``hexutil.rgb444_expand``, so a preview PNG shows exactly the banding
    the real hardware would, not an idealised full-colour render."""
    packed = rgb444_pixel(rgb)
    r = packed[0] & 0x0F
    g = (packed[1] >> 4) & 0x0F
    b = packed[1] & 0x0F
    return (rgb444_expand(r), rgb444_expand(g), rgb444_expand(b))


class Canvas:
    """A simple in-memory RGB888 pixel buffer, `width` x `height` (defaults to the panel
    size), with basic drawing primitives -- just enough for a preview renderer and this
    module's own generative effects. Not a general graphics library."""

    def __init__(self, width: int = DISPLAY_WIDTH, height: int = DISPLAY_HEIGHT) -> None:
        self.width = width
        self.height = height
        self.pixels: list[list[RGB]] = [[(0, 0, 0)] * width for _ in range(height)]

    def clear(self, color: RGB = (0, 0, 0)) -> None:
        self.pixels = [[color] * self.width for _ in range(self.height)]

    def set(self, x: int, y: int, color: RGB) -> None:
        if 0 <= x < self.width and 0 <= y < self.height:
            self.pixels[y][x] = color

    def get(self, x: int, y: int) -> RGB:
        return self.pixels[y][x]

    def blit(self, pixels: list[list[RGB]], x: int, y: int) -> None:
        """Pastes a `pixels[row][col]` grid onto this canvas at offset `(x, y)`, cropping
        anything that falls outside the canvas."""
        for row, line in enumerate(pixels):
            dest_y = y + row
            if not (0 <= dest_y < self.height):
                continue
            for col, color in enumerate(line):
                dest_x = x + col
                if 0 <= dest_x < self.width:
                    self.pixels[dest_y][dest_x] = color

    def to_frame(self, duration_ms: int = 100) -> Frame:
        return Frame(
            pixels=[[quantize(c) for c in row] for row in self.pixels],
            duration_ms=duration_ms,
            width=self.width,
            height=self.height,
        )

    def to_png(self, scale: int = 1) -> bytes:
        """Renders this canvas as a PNG, each device pixel drawn as a `scale`x`scale` block
        (the dashboard's ``image.<name>_display`` entity uses this for a legible preview of an
        otherwise tiny 32x16 image). Colours are quantised through the same RGB444 curve the
        real hardware shows (:func:`quantize`) so the preview is honest about banding."""
        from PIL import Image

        img = Image.new("RGB", (self.width * scale, self.height * scale))
        put = img.putpixel
        for row in range(self.height):
            for col in range(self.width):
                color = quantize(self.pixels[row][col])
                for dy in range(scale):
                    for dx in range(scale):
                        put((col * scale + dx, row * scale + dy), color)
        import io

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        return buffer.getvalue()


# --- text ------------------------------------------------------------------------------


def _glyph_columns(text: str, font_name: str) -> tuple[list[tuple[bool, ...]], int]:
    font = get_font(font_name)
    height = glyph_height(font_name)
    space = (False,) * height
    columns: list[tuple[bool, ...]] = []
    for index, char in enumerate(text):
        if index:
            columns.append(space)
        glyph = font.get(char, font.get(char.upper(), font[" "]))
        columns.extend(glyph)
    return columns, height


def text_frames(
    text: str,
    font: str = "5x7",
    color: RGB = (255, 255, 255),
    *,
    background: RGB = (0, 0, 0),
    width: int = DISPLAY_WIDTH,
    height: int = DISPLAY_HEIGHT,
    scroll_step_ms: int = 100,
) -> list[Frame]:
    """Renders `text` in `font`/`color` onto `width`x`height` canvases. Text that fits within
    `width` renders as a single centred, static frame; wider text produces one frame per
    1-pixel scroll step (left to right, wrapping so the animation loops cleanly) -- the
    generic pixel-frame path (`programs.AnimationContent`) that any renderer feeding
    `program_builder.frames_to_content` can use, independent of the device's own native
    scrolling-text feature (`programs.TextContent`, which has its own bundled-font rendering).
    """
    columns, glyph_h = _glyph_columns(text, font)
    text_width = len(columns) or 1
    y_offset = max(0, (height - glyph_h) // 2)

    def frame_at(scroll: int) -> Frame:
        canvas = Canvas(width, height)
        canvas.clear(background)
        for x in range(width):
            source_col = x + scroll
            if text_width <= width:
                source_col -= (width - text_width) // 2
            if 0 <= source_col < text_width:
                for row, lit in enumerate(columns[source_col]):
                    if lit:
                        canvas.set(x, y_offset + row, color)
        return canvas.to_frame(duration_ms=scroll_step_ms)

    if text_width <= width:
        return [frame_at(0)]
    return [frame_at(scroll) for scroll in range(text_width - width + width)]


# --- image import ------------------------------------------------------------------------


def _fit_image(image, fit: str, width: int, height: int):
    from PIL import Image

    if fit == "stretch":
        return image.resize((width, height), Image.LANCZOS)
    if fit == "cover":
        src_ratio = image.width / image.height
        dst_ratio = width / height
        if src_ratio > dst_ratio:
            new_height = height
            new_width = max(1, round(height * src_ratio))
        else:
            new_width = width
            new_height = max(1, round(width / src_ratio))
        resized = image.resize((new_width, new_height), Image.LANCZOS)
        left = (new_width - width) // 2
        top = (new_height - height) // 2
        return resized.crop((left, top, left + width, top + height))
    # "contain" (default): letterbox onto a black canvas, preserving aspect ratio.
    src_ratio = image.width / image.height
    dst_ratio = width / height
    if src_ratio > dst_ratio:
        new_width = width
        new_height = max(1, round(width / src_ratio))
    else:
        new_height = height
        new_width = max(1, round(height * src_ratio))
    resized = image.resize((new_width, new_height), Image.LANCZOS)
    from PIL import Image as _Image

    canvas = _Image.new("RGB", (width, height), (0, 0, 0))
    canvas.paste(resized, ((width - new_width) // 2, (height - new_height) // 2))
    return canvas


def image_to_frames(
    data: bytes,
    fit: str = "contain",
    dither: bool = True,
    max_frames: int = 32,
    *,
    width: int = DISPLAY_WIDTH,
    height: int = DISPLAY_HEIGHT,
) -> list[Frame]:
    """Decodes `data` (any format Pillow reads: PNG/JPEG/BMP/WebP/animated GIF/...), fits it
    to `width`x`height` per `fit` ("contain" letterboxes, "cover" crops to fill, "stretch"
    ignores aspect ratio), and returns one `Frame` per source frame (animated images), capped
    at `max_frames`. `dither` applies Floyd-Steinberg dithering against the panel's real
    RGB444 palette before quantising -- an honest approximation of a photo/gradient on a
    4-bit-per-channel display, rather than flat, banded colour."""
    from PIL import Image

    image = Image.open(__import__("io").BytesIO(data))
    frame_count = getattr(image, "n_frames", 1)
    frames: list[Frame] = []
    for index in range(min(frame_count, max_frames)):
        image.seek(index)
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (0, 0, 0))
        background.paste(rgba, mask=rgba.split()[3])
        fitted = _fit_image(background, fit, width, height)
        if dither:
            fitted = _dither_to_panel(fitted)
        duration_ms = image.info.get("duration", 100) if frame_count > 1 else 100
        pixels = [[fitted.getpixel((col, row)) for col in range(width)] for row in range(height)]
        frames.append(Frame(pixels=pixels, duration_ms=int(duration_ms) or 100, width=width, height=height))
    return frames


def _dither_to_panel(image):
    """Floyd-Steinberg dithers `image` (already sized to the panel) against the panel's own
    achievable RGB444 palette, so the *shape* of the error diffusion -- not just a per-pixel
    round -- carries gradients that a flat round would band badly."""
    width, height = image.size
    pixels = [[list(image.getpixel((col, row))) for col in range(width)] for row in range(height)]
    for row in range(height):
        for col in range(width):
            old = pixels[row][col]
            new = list(quantize((int(round(old[0])), int(round(old[1])), int(round(old[2])))))
            error = [old[i] - new[i] for i in range(3)]
            pixels[row][col] = new
            for dx, dy, weight in ((1, 0, 7 / 16), (-1, 1, 3 / 16), (0, 1, 5 / 16), (1, 1, 1 / 16)):
                nx, ny = col + dx, row + dy
                if 0 <= nx < width and 0 <= ny < height:
                    pixels[ny][nx] = [
                        max(0, min(255, pixels[ny][nx][i] + error[i] * weight)) for i in range(3)
                    ]
    from PIL import Image as _Image

    out = _Image.new("RGB", (width, height))
    for row in range(height):
        for col in range(width):
            out.putpixel((col, row), tuple(int(round(v)) for v in pixels[row][col]))
    return out


# --- generative animations -----------------------------------------------------------------


@dataclass(frozen=True)
class _Generator:
    fps: int
    render: "callable"


def _palette_or_rainbow(palette, t: float) -> RGB:
    if palette:
        index = int(t * len(palette)) % len(palette)
        return tuple(palette[index])  # type: ignore[return-value]
    hue = t % 1.0
    r, g, b = colorsys.hsv_to_rgb(hue, 1.0, 1.0)
    return (int(r * 255), int(g * 255), int(b * 255))


def _plasma(width: int, height: int, frame_index: int, total_frames: int, palette) -> list[list[RGB]]:
    t = frame_index / max(1, total_frames)
    out = []
    for row in range(height):
        line = []
        for col in range(width):
            value = (
                math.sin(col / 3.0 + t * 6.28)
                + math.sin(row / 2.5 + t * 4.0)
                + math.sin((col + row) / 4.0 + t * 5.0)
                + math.sin(math.hypot(col - width / 2, row - height / 2) / 2.0 - t * 6.28)
            ) / 4.0
            line.append(_palette_or_rainbow(palette, (value + 1) / 2))
        out.append(line)
    return out


def _fire(width: int, height: int, frame_index: int, total_frames: int, palette, rng: random.Random) -> list[list[RGB]]:
    heat = [[0.0] * width for _ in range(height)]
    for col in range(width):
        heat[height - 1][col] = rng.uniform(0.6, 1.0)
    for row in range(height - 2, -1, -1):
        for col in range(width):
            below = heat[row + 1][col]
            left = heat[row + 1][max(0, col - 1)]
            right = heat[row + 1][min(width - 1, col + 1)]
            heat[row][col] = max(0.0, (below + left + right) / 3.0 - rng.uniform(0.02, 0.08))
    line_colors = []
    for row in range(height):
        line = []
        for col in range(width):
            v = heat[row][col]
            if palette:
                index = min(len(palette) - 1, int(v * len(palette)))
                base = palette[index]
                line.append((int(base[0] * v), int(base[1] * v), int(base[2] * v)))
            else:
                line.append((int(255 * min(1.0, v * 1.4)), int(120 * v), int(30 * v * v)))
        line_colors.append(line)
    return line_colors


def _sparkle(width: int, height: int, frame_index: int, total_frames: int, palette, rng: random.Random) -> list[list[RGB]]:
    out = [[(0, 0, 0)] * width for _ in range(height)]
    density = max(1, (width * height) // 12)
    for _ in range(density):
        x, y = rng.randrange(width), rng.randrange(height)
        brightness = rng.uniform(0.3, 1.0)
        color = _palette_or_rainbow(palette, rng.random())
        out[y][x] = tuple(int(c * brightness) for c in color)
    return out


def _rainbow_wave(width: int, height: int, frame_index: int, total_frames: int, palette) -> list[list[RGB]]:
    t = frame_index / max(1, total_frames)
    out = []
    for row in range(height):
        line = []
        for col in range(width):
            hue = ((col / width) + (row / height) * 0.3 + t) % 1.0
            line.append(_palette_or_rainbow(palette, hue))
        out.append(line)
    return out


def _life(width: int, height: int, state: dict | None, palette, rng: random.Random) -> tuple[list[list[RGB]], dict]:
    """Conway's Game of Life on a toroidal (wrap-around) grid. Each cell's colour fades in with
    its age (how many consecutive generations it has survived) so long-lived structures read as
    "hotter" than newly-born cells. Re-seeds with a fresh random 30% fill whenever the
    population collapses (dies out or settles into a near-empty static/oscillating remnant), so
    the effect never just goes dark for the rest of the run."""
    if state is None:
        grid = [[1 if rng.random() < 0.3 else 0 for _ in range(width)] for _ in range(height)]
        state = {"grid": grid, "age": [[0] * width for _ in range(height)]}
    grid, age = state["grid"], state["age"]

    out = []
    for row in range(height):
        line = []
        for col in range(width):
            if grid[row][col]:
                line.append(_palette_or_rainbow(palette, min(1.0, age[row][col] / 20.0)))
            else:
                line.append((0, 0, 0))
        out.append(line)

    new_grid = [[0] * width for _ in range(height)]
    new_age = [[0] * width for _ in range(height)]
    alive_count = 0
    for row in range(height):
        for col in range(width):
            neighbours = sum(
                grid[(row + dr) % height][(col + dc) % width]
                for dr in (-1, 0, 1)
                for dc in (-1, 0, 1)
                if not (dr == 0 and dc == 0)
            )
            if grid[row][col] and neighbours in (2, 3):
                new_grid[row][col] = 1
                new_age[row][col] = age[row][col] + 1
                alive_count += 1
            elif not grid[row][col] and neighbours == 3:
                new_grid[row][col] = 1
                alive_count += 1
    if alive_count < max(3, (width * height) // 20):
        new_grid = [[1 if rng.random() < 0.3 else 0 for _ in range(width)] for _ in range(height)]
        new_age = [[0] * width for _ in range(height)]
    state["grid"], state["age"] = new_grid, new_age
    return out, state


def _matrix(width: int, height: int, state: dict | None, palette, rng: random.Random) -> tuple[list[list[RGB]], dict]:
    """"Digital rain": one falling, fading-trail drop per column, each with its own speed and
    restart position so columns fall out of phase with each other. `palette`, when given, is
    cycled one colour per column; the default is the classic monochrome green."""
    trail = 6
    if state is None:
        state = {
            "drop_row": [rng.uniform(-height, 0) for _ in range(width)],
            "speed": [rng.uniform(0.3, 1.0) for _ in range(width)],
        }
    drop_row, speed = state["drop_row"], state["speed"]

    out = [[(0, 0, 0)] * width for _ in range(height)]
    for col in range(width):
        base = palette[col % len(palette)] if palette else (0, 255, 70)
        head = drop_row[col]
        for t in range(trail):
            row = int(head) - t
            if 0 <= row < height:
                fade = 1.0 - (t / trail)
                out[row][col] = tuple(int(c * fade) for c in base)
        drop_row[col] += speed[col]
        if drop_row[col] - trail > height:
            drop_row[col] = rng.uniform(-height, 0)
            speed[col] = rng.uniform(0.3, 1.0)
    state["drop_row"], state["speed"] = drop_row, speed
    return out, state


def _starfield(width: int, height: int, state: dict | None, palette, rng: random.Random, count: int = 24) -> tuple[list[list[RGB]], dict]:
    """Classic "warp speed" radial starfield: points emanate from the panel's centre,
    accelerating outward, and respawn at the centre with a fresh random heading once they fly
    past the edge."""
    cx, cy = width / 2.0, height / 2.0
    max_dist = math.hypot(cx, cy)
    if state is None:
        state = {
            "stars": [
                {"angle": rng.uniform(0, 2 * math.pi), "dist": rng.uniform(0, 1), "speed": rng.uniform(0.05, 0.15)}
                for _ in range(count)
            ]
        }
    stars = state["stars"]

    out = [[(0, 0, 0)] * width for _ in range(height)]
    for i, star in enumerate(stars):
        x = int(cx + math.cos(star["angle"]) * star["dist"] * max_dist)
        y = int(cy + math.sin(star["angle"]) * star["dist"] * max_dist)
        if 0 <= x < width and 0 <= y < height:
            brightness = min(1.0, star["dist"] + 0.2)
            color = _palette_or_rainbow(palette, i / max(1, len(stars)))
            out[y][x] = tuple(int(c * brightness) for c in color)
        star["dist"] += star["speed"] * (0.5 + star["dist"])
        if star["dist"] > 1.3:
            star["angle"] = rng.uniform(0, 2 * math.pi)
            star["dist"] = 0.0
            star["speed"] = rng.uniform(0.05, 0.15)
    state["stars"] = stars
    return out, state


_GENERATORS = {
    "plasma": 15,
    "fire": 15,
    "sparkle": 10,
    "rainbow": 15,
    "life": 8,
    "matrix": 12,
    "starfield": 15,
}


def generative(
    kind: str = "plasma",
    seconds: int = 10,
    seed: int | None = None,
    palette: list[RGB] | None = None,
    *,
    width: int = DISPLAY_WIDTH,
    height: int = DISPLAY_HEIGHT,
) -> list[Frame]:
    """Procedural animations needing no input image or text: "plasma" (smooth interference
    pattern), "fire" (a classic bottom-up heat-diffusion flame), "sparkle" (random twinkling
    points), "rainbow" (a diagonal colour-cycling wave), "life" (Conway's Game of Life),
    "matrix" (falling digital-rain columns), "starfield" (radial warp-speed stars). `seed` makes
    a run reproducible; `palette`, when given, replaces the default full-hue rainbow cycling.
    "life"/"matrix"/"starfield" carry state (grid contents, drop/star positions) across frames --
    unlike the other four, their per-frame renderer is not a pure function of `frame_index`
    alone, so frames must be (and are) generated in order, once, front to back."""
    if kind not in _GENERATORS:
        raise ValueError(f"unknown generative kind {kind!r}; choose one of {sorted(_GENERATORS)}")
    fps = _GENERATORS[kind]
    total_frames = max(1, int(seconds * fps))
    rng = random.Random(seed)
    duration_ms = max(1, round(1000 / fps))

    frames: list[Frame] = []
    state: dict | None = None
    for index in range(total_frames):
        if kind == "plasma":
            pixels = _plasma(width, height, index, total_frames, palette)
        elif kind == "fire":
            pixels = _fire(width, height, index, total_frames, palette, rng)
        elif kind == "sparkle":
            pixels = _sparkle(width, height, index, total_frames, palette, rng)
        elif kind == "rainbow":
            pixels = _rainbow_wave(width, height, index, total_frames, palette)
        elif kind == "life":
            pixels, state = _life(width, height, state, palette, rng)
        elif kind == "matrix":
            pixels, state = _matrix(width, height, state, palette, rng)
        else:
            pixels, state = _starfield(width, height, state, palette, rng)
        frames.append(
            Frame(
                pixels=[[quantize(c) for c in row] for row in pixels],
                duration_ms=duration_ms,
                width=width,
                height=height,
            )
        )
    return frames


# ---------------------------------------------------------------------------------------------
# Clock face preview: pixel-accurate, using the vendor's own bit-packed digit glyphs
# ---------------------------------------------------------------------------------------------
#
# clock_faces.py's STYLE_n_NUMBER/STYLE_n_SPACE tables are the literal bytes `programs.py`
# sends the device (`_encode_clock`'s `_table(number_table)`/`_table(space_table)`) -- opaque
# firmware payloads that module's own docstring says nothing here used to decode. Reverse
# engineered from the data itself (this module never had a spec for it): each glyph is
# COLUMN-major, MSB-first within each byte, top-aligned to the style's `num_height` -- `ceil
# (num_height/8)` bytes per column, so a byte's low bits beyond `num_height` are unused padding.
# Verified against DATE_NUMBER's "0" (bytes 254,130,130,254,0 at num_width=5,num_height=7
# decode to a clean rectangle: column0/3 fully lit (254=0b1111111_0 -> top7 all set), column1/2
# lit only at row0+row6 (130=0b1000001_0), column4 blank spacer) and STYLE_10_SPACE's colon
# (216,216 at height=5 decodes to rows 0,1,3,4 lit, row2 blank -- two stacked dots).
def _glyph_grid(table: bytes, width: int, height: int, offset: int = 0) -> list[list[bool]]:
    """One glyph's own `grid[row][col]` lit/unlit map."""
    bytes_per_col = (height + 7) // 8
    grid = [[False] * width for _ in range(height)]
    for col in range(width):
        start = offset + col * bytes_per_col
        bits = "".join(f"{byte:08b}" for byte in table[start : start + bytes_per_col])
        for row in range(height):
            if row < len(bits) and bits[row] == "1":
                grid[row][col] = True
    return grid


def _draw_glyph(canvas: "Canvas", grid: list[list[bool]], x: int, y: int, color: RGB) -> None:
    for row_index, row in enumerate(grid):
        for col_index, lit in enumerate(row):
            if lit:
                canvas.set(x + col_index, y + row_index, color)


def _draw_number(canvas: "Canvas", rect: tuple[int, int, int, int], value: str, num_width: int, num_height: int, table: bytes, color: RGB) -> None:
    x, y, _w, _h = rect
    bytes_per_col = (num_height + 7) // 8
    for index, char in enumerate(value):
        digit = int(char)
        grid = _glyph_grid(table, num_width, num_height, offset=digit * num_width * bytes_per_col)
        _draw_glyph(canvas, grid, x + index * num_width, y, color)


def _draw_space(canvas: "Canvas", rect: tuple[int, int, int, int], num_height: int, table: bytes, color: RGB) -> None:
    if not table:
        return
    x, y, width, _h = rect
    _draw_glyph(canvas, _glyph_grid(table, width, num_height), x, y, color)


def _canvas_from_rgb888(data: bytes, width: int, height: int) -> "Canvas":
    canvas = Canvas(width, height)
    for row in range(height):
        offset = row * width * 3
        canvas.pixels[row] = [
            (data[offset + col * 3], data[offset + col * 3 + 1], data[offset + col * 3 + 2]) for col in range(width)
        ]
    return canvas


class ClockFaceGeometry(NamedTuple):
    """Everything `clock_face_frames` needs about one firmware clock style -- assembled by the
    caller from `clock_styles.CLOCK_STYLES[style_index]` (geometry) and
    `clock_faces.STYLE_NUMBER`/`STYLE_SPACE[style_index]` (glyph bytes) so this module stays
    free of any import reaching outside `protocol/` (Contract A)."""

    num_width: int
    num_height: int
    hour: tuple[int, int, int, int]
    space_hour: tuple[int, int, int, int]
    minute: tuple[int, int, int, int]
    space_minute: tuple[int, int, int, int] | None
    seconds: tuple[int, int, int, int] | None
    show_space_minute: bool
    number_table: bytes
    space_table: bytes


class ClockFaceBackground(NamedTuple):
    """One style's (or the date companion's) real background animation -- assembled by the
    caller from `clock_backgrounds.CLOCK_BACKGROUNDS`/`DATE_BACKGROUND`, same reasoning as
    `ClockFaceGeometry` above."""

    width: int
    height: int
    delay_ms: int
    frames: tuple[bytes, ...]


def clock_face_frames(
    geometry: ClockFaceGeometry, color: RGB, hours24: bool, background: ClockFaceBackground | None = None
) -> list[Frame]:
    """Pixel-accurate preview of a firmware clock style: the vendor's own digit/colon glyphs
    (not our old blocky approximation -- those overlapped/garbled on tight styles like 24-27's
    4x5 digits) in `color`, at `program_builder._style_clock`'s exact geometry, optionally
    composited over that style's real background animation (one output frame per background
    frame, matching `program_builder._background_content`'s device-side layering).

    A representative demo time (13:34:56), not the live clock -- the real device ticks its own
    firmware clock; this is a static preview, like the vendor app's own style-picker thumbnails.
    """
    hour_value = "13" if hours24 else "01"

    def render_digits(canvas: Canvas) -> None:
        _draw_number(canvas, geometry.hour, hour_value, geometry.num_width, geometry.num_height, geometry.number_table, color)
        _draw_space(canvas, geometry.space_hour, geometry.num_height, geometry.space_table, color)
        _draw_number(canvas, geometry.minute, "34", geometry.num_width, geometry.num_height, geometry.number_table, color)
        if geometry.show_space_minute and geometry.space_minute:
            _draw_space(canvas, geometry.space_minute, geometry.num_height, geometry.space_table, color)
        if geometry.seconds:
            _draw_number(canvas, geometry.seconds, "56", geometry.num_width, geometry.num_height, geometry.number_table, color)

    if background is None:
        canvas = Canvas(DISPLAY_WIDTH, DISPLAY_HEIGHT)
        render_digits(canvas)
        return [canvas.to_frame(200)]
    frames: list[Frame] = []
    for raw in background.frames:
        canvas = _canvas_from_rgb888(raw, background.width, background.height)
        render_digits(canvas)
        frames.append(canvas.to_frame(background.delay_ms))
    return frames
