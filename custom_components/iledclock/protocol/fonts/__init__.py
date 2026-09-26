"""Bundled, original, open-licensed (MIT, matching the rest of this integration) bitmap
fonts used to render text for the device's native scrolling-text feature (``programs.py``'s
``TextContent``) and for local preview/animation rendering (``render.py``).

The vendor ships its own proprietary font glyph binaries (``UNICODE12``, ``UNICODE16``,
``32_16_large``, ``32_16_small``, ...) baked into the CoolLED1248 app's assets. Those are not
reproduced here in any form -- not their bytes, not glyph-for-glyph tracings of their shapes.
Every glyph below was authored from scratch for this project. What *is* reused from the
vendor's protocol (and is a wire-format fact, not a font design choice) is the *layout* the
device expects glyph pixel data in: full RGB888 (quantized to RGB444 on the wire, see
``hexutil.rgb444_pixel``) column-major pixel columns, one glyph column at a time, monochrome
white-on-transparent so an accompanying Auto/Custom-colour layer can recolour it -- see
``programs.py``'s module docstring for the reasoning.

Each font is a mapping of a single character to a tuple of *columns*, each column a tuple of
booleans (top-to-bottom, lit/unlit) exactly ``height`` long. Proportional: a glyph's own
tuple length is its advance width in pixels (before the caller's own inter-glyph gap).
"""

from __future__ import annotations

from typing import Mapping

Glyph = tuple[tuple[bool, ...], ...]
Font = Mapping[str, Glyph]

from .font_5x7 import FONT_5X7  # noqa: E402
from .font_3x5 import FONT_3X5  # noqa: E402
from .font_8x16 import FONT_8X16  # noqa: E402

FONTS: dict[str, Font] = {
    "3x5": FONT_3X5,
    "5x7": FONT_5X7,
    "8x16": FONT_8X16,
}

DEFAULT_FONT = "5x7"


def get_font(name: str) -> Font:
    try:
        return FONTS[name]
    except KeyError as err:
        raise ValueError(f"unknown font {name!r}; choose one of {sorted(FONTS)}") from err


def glyph_height(name: str) -> int:
    """Every glyph in a font shares the same height; the space character always exists."""
    font = get_font(name)
    return len(next(iter(font[" "])))
