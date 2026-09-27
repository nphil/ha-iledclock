"""Exact per-style clock geometry for the 32x16 iLedClock, from the vendor app
(`ILedClockClockTimeActivity.getClockCombineProgram`, 32x16 branch). Each firmware clock style
draws its digits from a fixed glyph table, so the digit size and every segment position must be
these values: anything else renders garbled fragments (observed on the live clock 2026-09-26).
Style 36 shares this geometry with style 37 (vendor: `styleIndex == 36 || styleIndex == 37` is
one branch, ILedClockClockTimeFragment.java:1058) but has its own distinct digit glyph font
(`protocol/clock_faces.py`'s `STYLE_36_NUMBER` differs from `STYLE_37_NUMBER`) and its own
distinct background asset (`ic_clock_style_bg36_1632_iledclock.gif`, clock_backgrounds.py) --
it is a real, selectable 41st style, not a gap.

Segment tuples are (start_column, start_row, width, height); missing = not shown.
Generated from the decompiled vendor source; do not hand-edit.
"""
from __future__ import annotations

from typing import NamedTuple


class ClockStyle(NamedTuple):
    num_width: int
    num_height: int
    blink_colon: bool
    show_ampm: bool
    show_space_minute: bool
    hour: tuple[int, int, int, int]
    space_hour: tuple[int, int, int, int]
    minute: tuple[int, int, int, int]
    space_minute: tuple[int, int, int, int] | None
    seconds: tuple[int, int, int, int] | None


CLOCK_STYLES: dict[int, ClockStyle] = {
    1: ClockStyle(7, 12, True, True, False, (1, 0, 14, 12), (15, 0, 2, 12), (18, 0, 14, 12), None, None),
    2: ClockStyle(7, 10, True, True, False, (1, 3, 14, 10), (15, 3, 2, 10), (18, 3, 14, 10), None, None),
    3: ClockStyle(6, 10, True, True, False, (3, 3, 12, 10), (15, 3, 1, 10), (17, 3, 12, 10), None, None),
    4: ClockStyle(8, 10, True, True, False, (1, 4, 16, 10), (15, 4, 2, 10), (18, 4, 16, 10), None, None),
    5: ClockStyle(7, 10, True, True, False, (1, 6, 14, 10), (15, 6, 2, 10), (18, 6, 14, 10), None, None),
    6: ClockStyle(6, 10, True, True, False, (0, 0, 12, 10), (12, 0, 1, 10), (14, 0, 12, 10), None, None),
    7: ClockStyle(7, 10, True, False, True, (1, 0, 14, 10), (15, 0, 2, 10), (18, 0, 14, 10), None, None),
    8: ClockStyle(7, 12, True, True, False, (1, 2, 14, 12), (15, 2, 2, 12), (18, 2, 14, 12), None, None),
    9: ClockStyle(7, 10, True, True, False, (0, 0, 14, 10), (15, 0, 2, 10), (19, 0, 14, 10), None, None),
    10: ClockStyle(6, 5, True, True, False, (1, 9, 12, 5), (15, 9, 2, 5), (20, 9, 12, 5), None, None),
    11: ClockStyle(7, 10, True, True, False, (1, 0, 14, 10), (15, 0, 2, 10), (18, 0, 14, 10), None, None),
    12: ClockStyle(7, 10, True, True, False, (1, 5, 14, 10), (15, 5, 2, 10), (18, 5, 14, 10), None, None),
    13: ClockStyle(7, 11, True, True, False, (1, 2, 14, 11), (15, 2, 1, 11), (17, 2, 14, 11), None, None),
    14: ClockStyle(6, 7, True, True, False, (1, 0, 12, 7), (13, 4, 1, 7), (1, 9, 12, 7), None, None),
    15: ClockStyle(6, 7, True, True, False, (4, 0, 12, 7), (2, 9, 1, 7), (4, 9, 12, 7), None, None),
    16: ClockStyle(6, 7, True, True, False, (19, 0, 12, 7), (17, 9, 1, 7), (19, 9, 12, 7), None, None),
    17: ClockStyle(6, 7, True, True, False, (20, 0, 12, 7), (18, 4, 1, 7), (20, 9, 12, 7), None, None),
    18: ClockStyle(6, 7, True, True, False, (21, 0, 12, 7), (19, 4, 1, 7), (21, 9, 12, 7), None, None),
    19: ClockStyle(6, 7, True, True, False, (20, 1, 12, 7), (18, 9, 1, 7), (20, 9, 12, 7), None, None),
    20: ClockStyle(5, 7, True, True, False, (10, 1, 10, 7), (20, 1, 1, 7), (22, 1, 10, 7), None, None),
    21: ClockStyle(5, 7, True, True, False, (0, 0, 10, 7), (10, 0, 1, 7), (12, 0, 10, 7), None, None),
    22: ClockStyle(4, 5, True, True, False, (14, 1, 8, 5), (22, 1, 1, 5), (24, 1, 8, 5), None, None),
    23: ClockStyle(4, 5, True, True, False, (2, 9, 8, 5), (10, 9, 1, 5), (12, 9, 8, 5), None, None),
    24: ClockStyle(4, 5, False, True, True, (2, 5, 8, 5), (10, 5, 1, 5), (12, 5, 8, 5), (20, 5, 1, 5), (22, 5, 8, 5)),
    25: ClockStyle(4, 5, True, True, False, (14, 1, 8, 5), (22, 1, 1, 5), (24, 1, 8, 5), None, None),
    26: ClockStyle(4, 5, False, True, True, (3, 1, 8, 5), (11, 1, 1, 5), (13, 1, 8, 5), (21, 1, 1, 5), (23, 1, 8, 5)),
    27: ClockStyle(4, 5, True, True, False, (2, 2, 8, 5), (10, 2, 1, 5), (12, 2, 8, 5), None, None),
    28: ClockStyle(7, 14, True, True, False, (1, 1, 14, 14), (15, 1, 2, 14), (18, 1, 14, 14), None, None),
    29: ClockStyle(7, 12, True, True, False, (1, 4, 14, 12), (15, 4, 2, 12), (18, 4, 14, 12), None, None),
    30: ClockStyle(6, 9, True, True, False, (3, 5, 12, 9), (15, 5, 1, 9), (17, 5, 12, 9), None, None),
    31: ClockStyle(7, 12, True, True, False, (1, 2, 14, 12), (15, 2, 2, 12), (18, 2, 14, 12), None, None),
    32: ClockStyle(7, 10, True, True, False, (1, 0, 14, 10), (15, 0, 2, 10), (18, 0, 14, 10), None, None),
    33: ClockStyle(7, 10, True, True, False, (1, 3, 14, 10), (15, 3, 2, 10), (18, 3, 14, 10), None, None),
    34: ClockStyle(7, 10, True, True, False, (1, 6, 14, 10), (15, 6, 2, 10), (18, 6, 14, 10), None, None),
    35: ClockStyle(7, 10, True, True, False, (1, 3, 14, 10), (15, 3, 2, 10), (18, 3, 14, 10), None, None),
    36: ClockStyle(7, 12, True, True, False, (0, 2, 14, 12), (15, 2, 2, 12), (19, 2, 14, 12), None, None),
    37: ClockStyle(7, 12, True, True, False, (0, 2, 14, 12), (15, 2, 2, 12), (19, 2, 14, 12), None, None),
    38: ClockStyle(7, 13, True, True, False, (0, 2, 14, 13), (15, 2, 2, 13), (19, 2, 14, 13), None, None),
    39: ClockStyle(7, 14, True, True, False, (0, 1, 14, 14), (15, 1, 2, 14), (19, 1, 14, 14), None, None),
    40: ClockStyle(6, 7, True, True, False, (21, 0, 12, 7), (19, 9, 1, 7), (21, 9, 12, 7), None, None),
    41: ClockStyle(6, 10, True, True, False, (3, 6, 12, 10), (15, 6, 2, 10), (18, 6, 12, 10), None, None),
}
