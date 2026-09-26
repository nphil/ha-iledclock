"""``commands.py`` verification beyond the golden-vector table: validation boundaries (the
exact edges of every ``_require_range`` call) and the documented quirk-preservation behaviour
for ``rhythm_type``/``music_data`` (no upper bound, matching the vendor's own silent-drop)."""

from __future__ import annotations

import unittest
from datetime import datetime

from protocol import commands
from protocol.models import AlarmItem, NightMode, TimerSwitchItem


class ValidationBoundaryTest(unittest.TestCase):
    def test_brightness_accepts_full_byte_range(self) -> None:
        commands.brightness(0)
        commands.brightness(255)
        with self.assertRaises(ValueError):
            commands.brightness(-1)
        with self.assertRaises(ValueError):
            commands.brightness(256)

    def test_rotate_accepts_only_0_to_3(self) -> None:
        for mode in range(4):
            commands.rotate(mode)
        with self.assertRaises(ValueError):
            commands.rotate(4)
        with self.assertRaises(ValueError):
            commands.rotate(-1)

    def test_volume_accepts_0_to_100(self) -> None:
        commands.volume(0)
        commands.volume(100)
        with self.assertRaises(ValueError):
            commands.volume(101)

    def test_color_speed_accepts_0_to_255(self) -> None:
        commands.color_speed(0)
        commands.color_speed(255)
        with self.assertRaises(ValueError):
            commands.color_speed(256)

    def test_reminder_id_accepts_0_to_255(self) -> None:
        commands.reminder_detail(0)
        commands.reminder_detail(255)
        with self.assertRaises(ValueError):
            commands.reminder_detail(256)

    def test_device_setting_kind_accepts_1_to_3(self) -> None:
        for kind in (1, 2, 3):
            commands.device_setting(kind, True)
        with self.assertRaises(ValueError):
            commands.device_setting(0, True)
        with self.assertRaises(ValueError):
            commands.device_setting(4, True)

    def test_countdown_reset_validates_time_fields(self) -> None:
        commands.countdown_reset(23, 59, 59)
        with self.assertRaises(ValueError):
            commands.countdown_reset(24, 0, 0)
        with self.assertRaises(ValueError):
            commands.countdown_reset(0, 60, 0)
        with self.assertRaises(ValueError):
            commands.countdown_reset(0, 0, 60)


class QuirkPreservationTest(unittest.TestCase):
    """rhythm_type/music_data deliberately do NOT reproduce brightness's strict-reject
    policy: the vendor's own out-of-range behaviour here is a silent, well-formed shorter
    payload (not a byte-misaligning crash), so faithfully reproducing it is both possible and
    correct -- these only guard non-negativity."""

    def test_rhythm_type_silently_drops_over_255(self) -> None:
        payload = commands.rhythm_type(300)
        self.assertEqual(payload, b"\x06")  # opcode only, value byte silently dropped

    def test_rhythm_type_negative_still_rejected(self) -> None:
        with self.assertRaises(ValueError):
            commands.rhythm_type(-1)

    def test_music_data_drops_out_of_range_values(self) -> None:
        payload = commands.music_data(1, [10, 300, 20])
        self.assertEqual(payload, b"\x01\x01\x0a\x14")  # opcode+mode+10+20, 300 dropped


class MiscCommandTest(unittest.TestCase):
    def test_sync_time_weekday_is_monday_first(self) -> None:
        monday = datetime(2026, 9, 21)
        sunday = datetime(2026, 9, 27)
        self.assertEqual(commands.sync_time(monday)[4], 1)
        self.assertEqual(commands.sync_time(sunday)[4], 7)

    def test_night_mode_set_round_trip_field_positions(self) -> None:
        cfg = NightMode(
            enabled=True, start_hour=22, start_minute=0, end_hour=6, end_minute=30,
            device_state_enabled=True, brightness=3, wake_up_duration=10,
            voice_control_enabled=True, voice_sensitivity=2,
        )
        payload = commands.night_mode_set(cfg)
        self.assertEqual(payload, bytes((0x14, 0x01, 1, 22, 0, 6, 30, 1, 3, 10, 1, 2)))

    def test_alarms_set_empty_list(self) -> None:
        self.assertEqual(commands.alarms_set([]), b"\x16\x01\x00")

    def test_alarms_set_is_never_overrides_day_flags(self) -> None:
        item = AlarmItem(hour=7, minute=0, is_never=True, is_monday_on=True, is_friday_on=True)
        payload = commands.alarms_set([item])
        # repeat byte (5th byte of the 7-byte item, after enable/hour/minute) must be 0x00
        # despite both day flags being set -- is_never wins.
        item_start = 3  # opcode, sub, count
        self.assertEqual(payload[item_start + 3], 0x00)

    def test_timer_switch_set_empty_list(self) -> None:
        self.assertEqual(commands.timer_switch_set([]), b"\x0a\x00")

    def test_password_default_changes_per_salt(self) -> None:
        a = commands.check_password("000000", salt=0x10)
        b = commands.check_password("000000", salt=0x20)
        self.assertNotEqual(a, b)

    def test_color_quantises_with_curve(self) -> None:
        from protocol.hexutil import rgb444_pixel

        payload = commands.color((255, 0, 0))
        self.assertEqual(payload, b"\x13\x01" + rgb444_pixel((255, 0, 0)))


if __name__ == "__main__":
    unittest.main()
