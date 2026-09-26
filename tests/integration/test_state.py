"""State merging (Contract B: partial refreshes folded onto the previous ClockState)."""

from __future__ import annotations

import unittest

from custom_components.iledclock.state import AlarmState, ClockState, NightModeState, merge_state


class MergeStateTests(unittest.TestCase):
    def test_merge_keeps_untouched_fields(self) -> None:
        base = ClockState(address="AA:BB:CC:DD:EE:FF", connected=True, power=True, brightness=80)
        merged = merge_state(base, {"brightness": 42})

        self.assertEqual(merged.brightness, 42)
        # Everything else -- including fields from before this refresh cycle -- survives.
        self.assertEqual(merged.address, base.address)
        self.assertTrue(merged.connected)
        self.assertTrue(merged.power)

    def test_merge_returns_new_instance_base_unchanged(self) -> None:
        base = ClockState(address="AA:BB:CC:DD:EE:FF", brightness=10)
        merged = merge_state(base, {"brightness": 99})

        self.assertEqual(base.brightness, 10)
        self.assertIsNot(merged, base)

    def test_merge_replaces_nested_dataclass_wholesale(self) -> None:
        night_mode = NightModeState(
            enabled=True, start_h=21, start_m=0, end_h=8, end_m=0, device_off=True,
            brightness=10, wake_minutes=5, voice=False, voice_sensitivity=1,
        )
        base = ClockState(address="AA:BB:CC:DD:EE:FF", night_mode=night_mode)
        new_night_mode = NightModeState(
            enabled=False, start_h=22, start_m=30, end_h=7, end_m=0, device_off=False,
            brightness=50, wake_minutes=10, voice=True, voice_sensitivity=5,
        )
        merged = merge_state(base, {"night_mode": new_night_mode})

        self.assertEqual(merged.night_mode, new_night_mode)
        self.assertNotEqual(merged.night_mode, night_mode)

    def test_merge_alarms_tuple_replaced_not_appended(self) -> None:
        base = ClockState(
            address="AA:BB:CC:DD:EE:FF",
            alarms=(AlarmState(id=1, hour=7, minute=0, enabled=True, repeat=0x7F),),
        )
        new_alarms = (
            AlarmState(id=1, hour=7, minute=0, enabled=True, repeat=0x7F),
            AlarmState(id=2, hour=8, minute=30, enabled=False, repeat=0),
        )
        merged = merge_state(base, {"alarms": new_alarms})

        self.assertEqual(merged.alarms, new_alarms)
        self.assertEqual(len(merged.alarms), 2)

    def test_merge_rejects_unknown_field(self) -> None:
        base = ClockState(address="AA:BB:CC:DD:EE:FF")

        with self.assertRaises(ValueError):
            merge_state(base, {"not_a_real_field": 1})

    def test_consecutive_failures_increment_without_disturbing_last_good_state(self) -> None:
        """Contract B: unavailable only after 3 consecutive failed refreshes, last good state
        kept meanwhile -- i.e. a failed poll only ever touches `consecutive_failures`."""
        base = ClockState(
            address="AA:BB:CC:DD:EE:FF", connected=True, power=True, brightness=77,
            consecutive_failures=1,
        )
        merged = merge_state(base, {"consecutive_failures": base.consecutive_failures + 1})

        self.assertEqual(merged.consecutive_failures, 2)
        self.assertEqual(merged.brightness, 77)
        self.assertTrue(merged.power)


if __name__ == "__main__":
    unittest.main()
