"""Exact 32x16 digit layouts from CoolLED1248 2.7.7 vendor screen builders.

Values come from ILedClockClockTimeFragment.getClockCombineProgram (date: lines 1217-1246;
temperature/humidity: 1271-1294), ILedClockCountdownActivity.getProgramData (205-235),
ILedClockStopwatchActivity.getProgramData (183-212), and
ILedClockScoreboardActivity.getProgramData (742-785). The corresponding vendor encoders are
ILedClockUtils.getDataWithDateCombineProgram (3445), getDataWithTimeCountCombineProgram (3694),
getDataWithScoreBoardCombineProgram (4083), getDataWithTemperatureCombineProgram (4290), and
getDataWithHumidityCombineProgram (4315). Unassigned Java int/boolean fields retain their
class defaults from ILedClockManager.java (lines 153-200, 299-343, and 382-414).

Segments are (start_column, start_row, width, height); all-zero geometry means the vendor left
that segment unset. Generated from the decompiled vendor source; do not hand-edit.
"""
from __future__ import annotations

from typing import NamedTuple


SegmentGeometry = tuple[int, int, int, int]


class DateLayout(NamedTuple):
    layer_type: int
    month_flag: int
    show_time: int
    num_width: int
    num_height: int
    year_num_width: int
    year_num_height: int
    show_space_year: bool
    show_space_month: bool
    show_space_day: bool
    year: SegmentGeometry
    space_year: SegmentGeometry
    month: SegmentGeometry
    space_month: SegmentGeometry
    day: SegmentGeometry
    space_day: SegmentGeometry
    week: SegmentGeometry


class TimeCountLayout(NamedTuple):
    layer_type: int
    num_width: int
    num_height: int
    hour: SegmentGeometry
    space_hour: SegmentGeometry
    minute: SegmentGeometry
    space_minute: SegmentGeometry
    seconds: SegmentGeometry


class ScoreboardLayout(NamedTuple):
    layer_type: int
    score_num_width: int
    score_num_height: int
    total_num_width: int
    total_num_height: int
    time_num_width: int
    time_num_height: int
    host_score: SegmentGeometry
    visit_score: SegmentGeometry
    host_total: SegmentGeometry
    visit_total: SegmentGeometry
    minute: SegmentGeometry
    space_minute: SegmentGeometry
    seconds: SegmentGeometry


class NumericLayout(NamedTuple):
    layer_type: int
    num_width: int
    num_height: int
    segment: SegmentGeometry


DATE_LAYOUT = DateLayout(
    1, 0, 5, 5, 7, 0, 0, False, True, False,
    (0, 0, 0, 0), (0, 0, 0, 0), (5, 2, 10, 7), (15, 2, 2, 7),
    (18, 2, 10, 7), (0, 0, 0, 0), (7, 11, 17, 5),
)

TIME_COUNT_LAYOUTS = {
    0: TimeCountLayout(
        1, 4, 5,
        (2, 10, 8, 5), (10, 10, 1, 5), (12, 10, 8, 5),
        (20, 10, 1, 5), (22, 10, 8, 5),
    ),
    1: TimeCountLayout(
        1, 4, 5,
        (2, 11, 8, 5), (10, 11, 1, 5), (12, 11, 8, 5),
        (20, 11, 1, 5), (22, 11, 8, 5),
    ),
}

SCOREBOARD_LAYOUT = ScoreboardLayout(
    0, 5, 7, 5, 5, 4, 5,
    (1, 1, 15, 7), (17, 1, 15, 7),
    (1, 11, 5, 5), (27, 11, 5, 5),
    (8, 10, 8, 5), (16, 10, 1, 5), (18, 10, 8, 5),
)

TEMPERATURE_LAYOUT = NumericLayout(0, 5, 7, (5, 0, 27, 7))
HUMIDITY_LAYOUT = NumericLayout(0, 6, 7, (11, 9, 18, 7))
