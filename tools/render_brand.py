"""Deterministic Pillow renderer for the iLedClock Home Assistant brand kit.

Re-implements the same visual concept as ../icon.svg directly in raster (Pillow
cannot parse SVG, so nothing here reads that file): a rounded-rectangle device
housing containing a recessed dark panel with a 32x16 grid of round LED dots.
Almost all dots are dim/unlit; a hand-designed 5x7 pixel font lights a sparse
subset of them to spell "12:34" in a vivid cyan -> violet -> magenta gradient,
with a soft blurred bloom layer behind the crisp dots.

Pure stdlib + Pillow, no network access, no randomness -- running this script
twice produces byte-identical PNGs.

Usage (from the repository root):

    python3 tools/render_brand.py

Writes the eight brand PNGs under custom_components/iledclock/brand/.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
BRAND_DIR = REPO_ROOT / "custom_components" / "iledclock" / "brand"

FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)


def load_font(size: int) -> ImageFont.FreeTypeFont:
    """Liberation Sans Bold, falling back to DejaVu, falling back to the
    Pillow default bitmap font so this script never crashes on a box that is
    missing both truetype families."""
    for path in FONT_CANDIDATES:
        if Path(path).is_file():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default(size=size)


# ---------------------------------------------------------------------------
# 32x16 LED grid + hand-designed 5x7 pixel font (digits 0-9 and ':')
# ---------------------------------------------------------------------------

GRID_COLS = 32
GRID_ROWS = 16
GLYPH_HEIGHT = 7
GLYPH_GAP = 1  # blank columns between characters
READOUT_TEXT = ("1", "2", ":", "3", "4")

# '#' = lit cell, '.' = blank cell. Every glyph is GLYPH_HEIGHT rows tall;
# digits are 5 columns wide, the colon is a narrower 3 columns.
FONT = {
    "0": [
        ".###.",
        "#...#",
        "#..##",
        "#.#.#",
        "##..#",
        "#...#",
        ".###.",
    ],
    "1": [
        "..#..",
        ".##..",
        "..#..",
        "..#..",
        "..#..",
        "..#..",
        ".###.",
    ],
    "2": [
        ".###.",
        "#...#",
        "....#",
        "...#.",
        "..#..",
        ".#...",
        "#####",
    ],
    "3": [
        ".###.",
        "#...#",
        "....#",
        "..##.",
        "....#",
        "#...#",
        ".###.",
    ],
    "4": [
        "...#.",
        "..##.",
        ".#.#.",
        "#..#.",
        "#####",
        "...#.",
        "...#.",
    ],
    "5": [
        "#####",
        "#....",
        "#....",
        "####.",
        "....#",
        "#...#",
        ".###.",
    ],
    "6": [
        "..##.",
        ".#...",
        "#....",
        "####.",
        "#...#",
        "#...#",
        ".###.",
    ],
    "7": [
        "#####",
        "....#",
        "...#.",
        "..#..",
        ".#...",
        ".#...",
        ".#...",
    ],
    "8": [
        ".###.",
        "#...#",
        "#...#",
        ".###.",
        "#...#",
        "#...#",
        ".###.",
    ],
    "9": [
        ".###.",
        "#...#",
        "#...#",
        ".####",
        "....#",
        "...#.",
        ".##..",
    ],
    ":": [
        "...",
        "...",
        ".#.",
        "...",
        ".#.",
        "...",
        "...",
    ],
}


def readout_lit_cells():
    """(col, row) grid coordinates lit by READOUT_TEXT, centered in the grid."""
    widths = [len(FONT[ch][0]) for ch in READOUT_TEXT]
    total_w = sum(widths) + GLYPH_GAP * (len(READOUT_TEXT) - 1)
    left_pad = (GRID_COLS - total_w) // 2
    top_pad = (GRID_ROWS - GLYPH_HEIGHT) // 2

    cells = set()
    cursor = left_pad
    for ch, width in zip(READOUT_TEXT, widths):
        for row, row_bits in enumerate(FONT[ch]):
            for col_in_glyph, bit in enumerate(row_bits):
                if bit == "#":
                    cells.add((cursor + col_in_glyph, top_pad + row))
        cursor += width + GLYPH_GAP
    return cells


# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------

# Saturated "glowing RGB LED" gradient swept left -> right across the readout.
GRADIENT_CYAN = (0x2D, 0xE2, 0xFF)
GRADIENT_VIOLET = (0x9B, 0x4D, 0xFF)
GRADIENT_MAGENTA = (0xFF, 0x3D, 0xAE)

PANEL_COLOR = (0x0A, 0x0B, 0x12, 255)  # always-dark recessed screen, both variants
UNLIT_DOT_RGB = (0x4E, 0x5A, 0x8A)
UNLIT_DOT_ALPHA = round(255 * 0.22)

HOUSING_DARK_TOP = (0x1E, 0x22, 0x38)
HOUSING_DARK_BOTTOM = (0x0D, 0x0E, 0x16)
HOUSING_DARK_STROKE = (0x33, 0x3A, 0x5C)

HOUSING_LIGHT_TOP = (0xFF, 0xFF, 0xFF)
HOUSING_LIGHT_BOTTOM = (0xE7, 0xEA, 0xF5)
HOUSING_LIGHT_STROKE = (0xD6, 0xDA, 0xEB)

WORDMARK_DARK = (0x14, 0x15, 0x1D)  # for logo.png (dark housing, light backgrounds)
WORDMARK_LIGHT = (0xF7, 0xF8, 0xFC)  # for dark_logo.png (light housing, dark backgrounds)


def _lerp_channel(a, b, t):
    return round(a + (b - a) * t)


def gradient_color(t):
    """Sample the cyan -> violet -> magenta gradient at t in [0, 1]."""
    t = 0.0 if t < 0.0 else 1.0 if t > 1.0 else t
    stops = (GRADIENT_CYAN, GRADIENT_VIOLET) if t <= 0.5 else (GRADIENT_VIOLET, GRADIENT_MAGENTA)
    local_t = t / 0.5 if t <= 0.5 else (t - 0.5) / 0.5
    return tuple(_lerp_channel(stops[0][i], stops[1][i], local_t) for i in range(3))


def lit_dot_colors():
    """{(col, row): (r, g, b)} for every lit readout dot."""
    return {(col, row): gradient_color(col / (GRID_COLS - 1)) for col, row in readout_lit_cells()}


# ---------------------------------------------------------------------------
# Shared device-mark geometry, expressed as fractions of the housing width so
# it can be rendered at any scale. The reference numbers below (432 wide,
# 240 tall, ...) are the same absolute units used by ../icon.svg.
# ---------------------------------------------------------------------------

REF_HOUSING_W = 432.0
REF_HOUSING_H = 240.0
REF_FRAME_MARGIN = 16.0  # housing edge -> recessed panel edge
REF_PANEL_MARGIN = 8.0  # panel edge -> dot grid edge
REF_PITCH = 12.0  # center-to-center spacing of each LED dot
REF_DOT_R = 4.3  # crisp dot radius (unlit and lit)
REF_HOUSING_RX = 36.0  # housing corner radius
REF_PANEL_RX = 20.0  # panel corner radius
REF_BLOOM_STD = 5.0  # gaussian blur std deviation for the bloom layer
REF_STROKE_W = 2.0  # housing rim stroke width

HOUSING_ASPECT = REF_HOUSING_H / REF_HOUSING_W

# Standalone square icons: housing width as a fraction of the square canvas.
SQUARE_HOUSING_W_FRAC = 0.90

# Logo lockups (icon glyph + wordmark).
LOGO_HOUSING_H_FRAC = 0.66  # housing height as a fraction of canvas height
LOGO_FONT_SIZE_FRAC = 0.40  # wordmark font size as a fraction of canvas height
LOGO_TRACKING_FRAC = 0.018  # extra letter-spacing as a fraction of canvas height
LOGO_LEFT_MARGIN_FRAC = 0.035
LOGO_GAP_FRAC = 0.06  # gap between icon glyph and wordmark
LOGO_RIGHT_MARGIN_FRAC = 0.035


def _vertical_gradient_rgba(w, h, top_rgb, bottom_rgb):
    """Fully opaque (w, h) RGBA image with a top-to-bottom linear gradient."""
    column = Image.new("RGBA", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        rgb = tuple(_lerp_channel(top_rgb[i], bottom_rgb[i], t) for i in range(3))
        column.putpixel((0, y), rgb + (255,))
    return column.resize((w, h), Image.NEAREST)


def _rounded_mask(w, h, radius):
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    return mask


def render_mark(housing_w, light_housing):
    """Render the device mark (housing + recessed panel + 512-dot grid, with
    the "12:34" readout glowing on top of a blurred bloom layer) tightly
    cropped to its own (housing_w, housing_h) bounding box, transparent
    everywhere outside the rounded housing."""
    housing_w = round(housing_w)
    housing_h = round(housing_w * HOUSING_ASPECT)
    scale = housing_w / REF_HOUSING_W

    frame_margin = REF_FRAME_MARGIN * scale
    panel_margin = REF_PANEL_MARGIN * scale
    pitch = REF_PITCH * scale
    dot_r = REF_DOT_R * scale
    housing_rx = REF_HOUSING_RX * scale
    panel_rx = REF_PANEL_RX * scale
    bloom_std = REF_BLOOM_STD * scale
    stroke_w = max(1, round(REF_STROKE_W * scale))

    if light_housing:
        top_c, bottom_c, stroke_c = HOUSING_LIGHT_TOP, HOUSING_LIGHT_BOTTOM, HOUSING_LIGHT_STROKE
    else:
        top_c, bottom_c, stroke_c = HOUSING_DARK_TOP, HOUSING_DARK_BOTTOM, HOUSING_DARK_STROKE

    base = Image.new("RGBA", (housing_w, housing_h), (0, 0, 0, 0))

    # Housing: vertical gradient fill clipped to a rounded rect, plus a thin
    # rim stroke so the shape stays legible even without a bloom to lean on.
    housing_fill = _vertical_gradient_rgba(housing_w, housing_h, top_c, bottom_c)
    housing_fill.putalpha(_rounded_mask(housing_w, housing_h, housing_rx))
    base = Image.alpha_composite(base, housing_fill)

    stroke_layer = Image.new("RGBA", (housing_w, housing_h), (0, 0, 0, 0))
    inset = stroke_w / 2
    ImageDraw.Draw(stroke_layer).rounded_rectangle(
        [inset, inset, housing_w - 1 - inset, housing_h - 1 - inset],
        radius=housing_rx,
        outline=stroke_c + (160,),
        width=stroke_w,
    )
    base = Image.alpha_composite(base, stroke_layer)

    # Recessed panel ("screen"): always dark, regardless of housing color.
    panel_x = frame_margin
    panel_y = frame_margin
    panel_w = housing_w - 2 * frame_margin
    panel_h = housing_h - 2 * frame_margin
    panel_layer = Image.new("RGBA", (housing_w, housing_h), (0, 0, 0, 0))
    ImageDraw.Draw(panel_layer).rounded_rectangle(
        [panel_x, panel_y, panel_x + panel_w, panel_y + panel_h],
        radius=panel_rx,
        fill=PANEL_COLOR,
    )
    base = Image.alpha_composite(base, panel_layer)

    grid_x = panel_x + panel_margin
    grid_y = panel_y + panel_margin

    def dot_center(col, row):
        return grid_x + pitch * (col + 0.5), grid_y + pitch * (row + 0.5)

    lit = lit_dot_colors()

    # Bloom: a blurred duplicate of the lit dots, composited underneath the
    # crisp grid so the readout looks like it is actually glowing.
    bloom_layer = Image.new("RGBA", (housing_w, housing_h), (0, 0, 0, 0))
    bloom_draw = ImageDraw.Draw(bloom_layer)
    bloom_r = dot_r * 1.5
    for (col, row), rgb in lit.items():
        cx, cy = dot_center(col, row)
        bloom_draw.ellipse([cx - bloom_r, cy - bloom_r, cx + bloom_r, cy + bloom_r], fill=rgb + (235,))
    if bloom_std > 0:
        bloom_layer = bloom_layer.filter(ImageFilter.GaussianBlur(bloom_std))
    base = Image.alpha_composite(base, bloom_layer)

    # Crisp 32x16 dot grid on top: dim unlit dots plus the vivid lit readout.
    dots_layer = Image.new("RGBA", (housing_w, housing_h), (0, 0, 0, 0))
    dots_draw = ImageDraw.Draw(dots_layer)
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            cx, cy = dot_center(col, row)
            if (col, row) in lit:
                fill = lit[(col, row)] + (255,)
            else:
                fill = UNLIT_DOT_RGB + (UNLIT_DOT_ALPHA,)
            dots_draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=fill)
    base = Image.alpha_composite(base, dots_layer)

    return base


def render_icon_square(size, light_housing):
    """A perfectly square (size, size) RGBA icon: the device mark centered
    with a transparent margin on all sides."""
    housing_w = size * SQUARE_HOUSING_W_FRAC
    mark = render_mark(housing_w, light_housing)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = round((size - mark.width) / 2)
    y = round((size - mark.height) / 2)
    canvas.alpha_composite(mark, (x, y))
    return canvas


# ---------------------------------------------------------------------------
# Wordmark lockup ("icon glyph" + tracked "iLedClock" text)
# ---------------------------------------------------------------------------


def _char_advance(measure_draw, ch, font, tracking):
    return measure_draw.textlength(ch, font=font) + tracking


def _tracked_text_width(measure_draw, text, font, tracking):
    total = sum(measure_draw.textlength(ch, font=font) for ch in text)
    return total + tracking * (len(text) - 1)


def _draw_tracked_text(draw, measure_draw, x, y, text, font, fill, tracking):
    cursor = x
    for ch in text:
        draw.text((cursor, y), ch, font=font, fill=fill)
        cursor += _char_advance(measure_draw, ch, font, tracking)


def render_logo(canvas_height, light_housing, wordmark_rgb):
    """RGBA lockup: device-mark glyph on the left, tracked 'iLedClock'
    wordmark vertically centered on the right, transparent background,
    height exactly canvas_height and width auto-sized to content."""
    housing_h = canvas_height * LOGO_HOUSING_H_FRAC
    housing_w = housing_h / HOUSING_ASPECT
    mark = render_mark(housing_w, light_housing)

    font_size = round(canvas_height * LOGO_FONT_SIZE_FRAC)
    font = load_font(font_size)
    tracking = canvas_height * LOGO_TRACKING_FRAC
    text = "iLedClock"

    measure_draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    text_w = _tracked_text_width(measure_draw, text, font, tracking)
    ink_left, ink_top, ink_right, ink_bottom = measure_draw.textbbox((0, 0), text, font=font)

    left_margin = canvas_height * LOGO_LEFT_MARGIN_FRAC
    gap = canvas_height * LOGO_GAP_FRAC
    right_margin = canvas_height * LOGO_RIGHT_MARGIN_FRAC

    total_w = round(left_margin + mark.width + gap + text_w + right_margin)
    if total_w % 2:  # keep widths even so @2x variants downscale to an exact half
        total_w += 1

    canvas = Image.new("RGBA", (total_w, canvas_height), (0, 0, 0, 0))
    mark_y = round((canvas_height - mark.height) / 2)
    canvas.alpha_composite(mark, (round(left_margin), mark_y))

    text_x = left_margin + mark.width + gap
    center_y = canvas_height / 2
    y_draw = center_y - (ink_top + ink_bottom) / 2

    draw = ImageDraw.Draw(canvas)
    _draw_tracked_text(draw, measure_draw, text_x, y_draw, text, font, wordmark_rgb + (255,), tracking)

    return canvas


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

MASTER_SIZE = 512  # every asset is rendered at 2x first, then halved for crisp 1x anti-aliasing


def _save_pair(master, stem):
    """Save master as <stem>@2x.png and an exact half-size downscale as <stem>.png."""
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    master.save(BRAND_DIR / f"{stem}@2x.png")
    half = (master.width // 2, master.height // 2)
    master.resize(half, Image.LANCZOS).save(BRAND_DIR / f"{stem}.png")


def main():
    icon_master = render_icon_square(MASTER_SIZE, light_housing=False)
    _save_pair(icon_master, "icon")

    dark_icon_master = render_icon_square(MASTER_SIZE, light_housing=True)
    _save_pair(dark_icon_master, "dark_icon")

    logo_master = render_logo(MASTER_SIZE, light_housing=False, wordmark_rgb=WORDMARK_DARK)
    _save_pair(logo_master, "logo")

    dark_logo_master = render_logo(MASTER_SIZE, light_housing=True, wordmark_rgb=WORDMARK_LIGHT)
    _save_pair(dark_logo_master, "dark_logo")


if __name__ == "__main__":
    main()
