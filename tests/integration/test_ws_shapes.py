"""Websocket payload shaping (Contract D), against the wire contract agreed with the frontend
agent: `iledclock/state` / `subscribe` push shape, `designs/list`, `render`, and upload-progress
events.
"""

from __future__ import annotations

import base64
import unittest

from custom_components.iledclock.designs import Design
from custom_components.iledclock.playlist import validate_playlist
from custom_components.iledclock.state import (
    AlarmState,
    ClockState,
    NightModeState,
    TimerSwitchState,
    TomatoState,
)
from custom_components.iledclock.ws_shapes import (
    shape_capabilities,
    shape_designs_list,
    shape_frames_payload,
    shape_state_event,
    shape_upload_progress,
)


class ShapeStateEventTests(unittest.TestCase):
    def test_minimal_state_shapes_nulls_not_missing_keys(self) -> None:
        state = ClockState(address="AA:BB:CC:DD:EE:FF")

        event = shape_state_event(connected=False, busy=False, state=state, playlist=[])

        self.assertEqual(event["connected"], False)
        self.assertEqual(event["busy"], False)
        self.assertEqual(event["playlist"], [])
        # Every ClockState field must be present -- as null, not simply absent -- so the
        # frontend never has to distinguish "not sent" from "unknown".
        for key in (
            "power", "brightness", "night_mode", "countdown", "stopwatch", "scoreboard",
            "tomato",
        ):
            self.assertIn(key, event["state"])
            self.assertIsNone(event["state"][key])

    def test_populated_state_shapes_nested_objects(self) -> None:
        state = ClockState(
            address="AA:BB:CC:DD:EE:FF",
            power=True,
            brightness=80,
            temperature=21.5,
            humidity=None,
            night_mode=NightModeState(
                enabled=True, start_h=21, start_m=0, end_h=8, end_m=0, device_off=True,
                brightness=10, wake_minutes=5, voice=False, voice_sensitivity=1,
            ),
            alarms=(AlarmState(id=1, hour=7, minute=30, enabled=True, repeat=0x7F),),
            timer_switches=(
                TimerSwitchState(index=0, hour=6, minute=0, on=True, enabled=True, repeat=0x1F),
            ),
            tomato=TomatoState(minutes=(25, 5)),
        )

        event = shape_state_event(connected=True, busy=False, state=state, playlist=[])

        self.assertEqual(event["state"]["night_mode"]["start_h"], 21)
        self.assertEqual(event["state"]["alarms"], [
            {"id": 1, "hour": 7, "minute": 30, "enabled": True, "repeat": 0x7F}
        ])
        self.assertEqual(event["state"]["timer_switches"], [
            {"index": 0, "hour": 6, "minute": 0, "on": True, "enabled": True, "repeat": 0x1F}
        ])
        self.assertEqual(event["state"]["tomato"], {"minutes": [25, 5]})

    def test_capabilities_reflect_whether_sensors_were_ever_seen(self) -> None:
        with_temp = ClockState(address="AA:BB:CC:DD:EE:FF", temperature=20.0)
        without_temp = ClockState(address="AA:BB:CC:DD:EE:FF")

        self.assertTrue(shape_capabilities(with_temp)["has_temperature"])
        self.assertFalse(shape_capabilities(without_temp)["has_temperature"])
        # Static limits come from const.py regardless of live state.
        self.assertEqual(shape_capabilities(without_temp)["max_playlist_items"], 9)
        self.assertEqual(shape_capabilities(without_temp)["max_alarms"], 16)

    def test_playlist_items_round_trip_through_validation(self) -> None:
        items = validate_playlist([{"kind": "text", "params": {"text": "hi"}, "duration_s": 5}])
        state = ClockState(address="AA:BB:CC:DD:EE:FF")

        event = shape_state_event(connected=True, busy=True, state=state, playlist=items)

        self.assertEqual(
            event["playlist"], [{"kind": "text", "params": {"text": "hi"}, "duration_s": 5}]
        )


class ShapeDesignsListTests(unittest.TestCase):
    def test_frames_shaped_as_base64(self) -> None:
        raw_frame = bytes(range(16)) * 96  # arbitrary FRAME_BYTES-shaped content
        design = Design(
            id="abc", name="Test", kind="image", width=32, height=16,
            frames=(raw_frame,), delays_ms=(0,), created=1.0, updated=2.0,
        )

        [shaped] = shape_designs_list([design])

        self.assertEqual(shaped["id"], "abc")
        self.assertEqual(base64.b64decode(shaped["frames"][0]), raw_frame)
        self.assertEqual(shaped["delays"], [0])


class ShapeFramesPayloadTests(unittest.TestCase):
    def test_encodes_frames_and_carries_delays(self) -> None:
        payload = shape_frames_payload([b"\x01\x02", b"\x03\x04"], [100, 200])

        self.assertEqual(payload["delays"], [100, 200])
        self.assertEqual(base64.b64decode(payload["frames"][0]), b"\x01\x02")
        self.assertEqual(base64.b64decode(payload["frames"][1]), b"\x03\x04")


class ShapeUploadProgressTests(unittest.TestCase):
    def test_omits_error_key_when_not_erroring(self) -> None:
        payload = shape_upload_progress(state="chunk", program=1, programs=3, chunk=2, chunks=10)

        self.assertNotIn("error", payload)
        self.assertEqual(payload["type"], "upload")

    def test_includes_error_message_on_error_state(self) -> None:
        payload = shape_upload_progress(
            state="error", program=1, programs=3, chunk=2, chunks=10, error="timeout"
        )

        self.assertEqual(payload["error"], "timeout")


if __name__ == "__main__":
    unittest.main()
