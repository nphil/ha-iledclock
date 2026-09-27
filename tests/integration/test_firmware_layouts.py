"""32x16 layout regressions against the extracted CoolLED1248 screen-builder values."""
from __future__ import annotations

import unittest

from custom_components.iledclock.program_builder import (
    _date_content,
    _humidity_content,
    _scoreboard_content,
    _temperature_content,
    _timer_content,
)
from custom_components.iledclock.protocol.models import Segment
from custom_components.iledclock.protocol.programs import (
    DateContent,
    HumidityContent,
    ScoreboardContent,
    TemperatureContent,
    TimeCountContent,
)


WHITE = (255, 255, 255)
CYAN = (0, 255, 255)


def _segment(color: tuple[int, int, int], geometry: tuple[int, int, int, int]) -> Segment:
    column, row, width, height = geometry
    return Segment(color=color, start_column=column, start_row=row, width=width, height=height)


class FirmwareLayoutTest(unittest.TestCase):
    """Compare every modeled output field to the vendor's 32x16 screen initialization.

    Source paths: ILedClockClockTimeFragment.getClockCombineProgram (date 1217-1246,
    temperature/humidity 1271-1294), ILedClockCountdownActivity.getProgramData (205-235),
    ILedClockStopwatchActivity.getProgramData (183-212), and
    ILedClockScoreboardActivity.getProgramData (742-785).
    """

    def test_date_matches_vendor_fields_and_java_defaults(self):
        expected = DateContent(
            show_space_year=False,
            show_space_month=True,
            show_space_day=False,
            year=_segment(WHITE, (0, 0, 0, 0)),
            space_year=_segment(WHITE, (0, 0, 0, 0)),
            month=_segment(WHITE, (5, 2, 10, 7)),
            space_month=_segment(WHITE, (15, 2, 2, 7)),
            day=_segment(WHITE, (18, 2, 10, 7)),
            space_day=_segment(WHITE, (0, 0, 0, 0)),
            week=_segment(WHITE, (7, 11, 17, 5)),
            layer_type=1,
            month_flag=0,
            show_time=5,
            num_height=7,
            num_width=5,
            year_num_height=0,
            year_num_width=0,
        )
        self.assertEqual(_date_content({}), expected)

    def test_countdown_and_stopwatch_use_their_vendor_layouts(self):
        expected = {
            "countdown": TimeCountContent(
                mode=0,
                hour=_segment(WHITE, (2, 10, 8, 5)),
                space_hour=_segment(WHITE, (10, 10, 1, 5)),
                minute=_segment(WHITE, (12, 10, 8, 5)),
                space_minute=_segment(WHITE, (20, 10, 1, 5)),
                seconds=_segment(WHITE, (22, 10, 8, 5)),
                layer_type=1,
                num_height=5,
                num_width=4,
            ),
            "stopwatch": TimeCountContent(
                mode=1,
                hour=_segment(WHITE, (2, 11, 8, 5)),
                space_hour=_segment(WHITE, (10, 11, 1, 5)),
                minute=_segment(WHITE, (12, 11, 8, 5)),
                space_minute=_segment(WHITE, (20, 11, 1, 5)),
                seconds=_segment(WHITE, (22, 11, 8, 5)),
                layer_type=1,
                num_height=5,
                num_width=4,
            ),
        }
        for mode, vendor_content in expected.items():
            with self.subTest(mode=mode):
                self.assertEqual(_timer_content({"mode": mode}), vendor_content)

    def test_scoreboard_matches_score_total_and_time_layouts(self):
        expected = ScoreboardContent(
            host_score=_segment(WHITE, (1, 1, 15, 7)),
            visit_score=_segment(WHITE, (17, 1, 15, 7)),
            host_total=_segment(WHITE, (1, 11, 5, 5)),
            visit_total=_segment(WHITE, (27, 11, 5, 5)),
            minute=_segment(WHITE, (8, 10, 8, 5)),
            space_minute=_segment(WHITE, (16, 10, 1, 5)),
            seconds=_segment(WHITE, (18, 10, 8, 5)),
            layer_type=0,
            score_num_height=7,
            score_num_width=5,
            total_num_height=5,
            total_num_width=5,
            time_num_height=5,
            time_num_width=4,
        )
        self.assertEqual(_scoreboard_content({}), expected)

    def test_temperature_matches_vendor_fields(self):
        self.assertEqual(
            _temperature_content({}),
            TemperatureContent(
                color=WHITE,
                start_column=5,
                start_row=0,
                width=27,
                height=7,
                layer_type=0,
                num_height=7,
                num_width=5,
            ),
        )

    def test_humidity_matches_vendor_fields(self):
        self.assertEqual(
            _humidity_content({}),
            HumidityContent(
                color=CYAN,
                start_column=11,
                start_row=9,
                width=18,
                height=7,
                layer_type=0,
                num_height=7,
                num_width=6,
            ),
        )

    def test_every_content_builder_sets_all_digit_dimensions(self):
        contents = (
            ("date", _date_content({}), (("num_width", "num_height"), ("year_num_width", "year_num_height"))),
            ("countdown", _timer_content({"mode": "countdown"}), (("num_width", "num_height"),)),
            ("stopwatch", _timer_content({"mode": "stopwatch"}), (("num_width", "num_height"),)),
            ("scoreboard", _scoreboard_content({}), (
                ("score_num_width", "score_num_height"),
                ("total_num_width", "total_num_height"),
                ("time_num_width", "time_num_height"),
            )),
            ("temperature", _temperature_content({}), (("num_width", "num_height"),)),
            ("humidity", _humidity_content({}), (("num_width", "num_height"),)),
        )
        for name, content, dimensions in contents:
            for width_field, height_field in dimensions:
                with self.subTest(content=name, width=width_field, height=height_field):
                    self.assertNotEqual(getattr(content, width_field), 1)
                    self.assertNotEqual(getattr(content, height_field), 1)

    def test_custom_color_is_preserved_on_segment_builders(self):
        color = (12, 34, 56)
        self.assertEqual(_date_content({"color": color}).week.color, color)
        self.assertEqual(_timer_content({"mode": "countdown", "color": color}).hour.color, color)
        self.assertEqual(_scoreboard_content({"color": color}).host_total.color, color)


if __name__ == "__main__":
    unittest.main()
