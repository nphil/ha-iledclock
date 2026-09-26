"""Original tall 8x16 pixel font, generated once at import time by proportionally upscaling
this project's own 5x7 glyphs (:mod:`.font_5x7`) onto an 8-wide by 16-tall grid -- a genuine
algorithmic derivation of our own original artwork, not a trace of any existing font file (and
certainly not the vendor's proprietary ``UNICODE16``). Blockier than a hand-drawn 16px font
would be, which is an honest trade-off for a bundled "large" size rather than a hidden one:
every character the 5x7 font defines (digits, A-Z/a-z, core punctuation) is covered
automatically, with no risk of a missing glyph. See the ``fonts`` package docstring."""

from __future__ import annotations

from .font_5x7 import FONT_5X7

_SRC_WIDTH = 5
_SRC_HEIGHT = 7
_DST_WIDTH = 8
_DST_HEIGHT = 16


def _upscale(glyph: tuple[tuple[bool, ...], ...]) -> tuple[tuple[bool, ...], ...]:
    src_width = len(glyph)
    columns = []
    for dst_col in range(_DST_WIDTH):
        src_col = min(src_width - 1, (dst_col * src_width) // _DST_WIDTH)
        src_column = glyph[src_col]
        column = tuple(
            src_column[min(_SRC_HEIGHT - 1, (dst_row * _SRC_HEIGHT) // _DST_HEIGHT)]
            for dst_row in range(_DST_HEIGHT)
        )
        columns.append(column)
    return tuple(columns)


FONT_8X16 = {char: _upscale(glyph) for char, glyph in FONT_5X7.items()}
