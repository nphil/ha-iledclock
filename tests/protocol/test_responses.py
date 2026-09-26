"""``responses.py`` verification: every live device capture in
``tests/live_replies_2026-09-25.json`` parses to the documented values (Contract A's own
live-hardware evidence), plus targeted tests of ``response_key``'s request/reply correlation
for opcodes with no real sub-op byte, and every synthetic reply-shape branch not covered by a
live capture (reminder detail/list, alarms/timer-switches with items, countdown/stopwatch/
scoreboard's reset/start-stop/finished shapes, OTA version)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from protocol import framing, responses
from protocol.models import AlarmItem, NightMode, TimerSwitchItem

_LIVE_REPLIES_PATH = Path(__file__).resolve().parents[1] / "live_replies_2026-09-25.json"


def _load_replies() -> dict:
    with _LIVE_REPLIES_PATH.open() as handle:
        return json.load(handle)


class LiveReplyParseTest(unittest.TestCase):
    def setUp(self) -> None:
        self.replies = _load_replies()

    def _decoded(self, name: str):
        entry = self.replies[name]
        return responses.parse(framing.decode_frame(bytes.fromhex(entry["reply_frame"])))

    def test_device_info(self) -> None:
        info = self._decoded("device_info")
        self.assertIsInstance(info, responses.DeviceInfo)
        self.assertTrue(info.is_switch_on_off)
        self.assertEqual(info.brightness, 0xA3)
        self.assertEqual(info.max_program_number, 9)
        self.assertEqual(info.volume, 5)

    def test_ota_version(self) -> None:
        ota = self._decoded("ota_version")
        self.assertIsInstance(ota, responses.OtaVersion)
        self.assertTrue(ota.supported)
        self.assertEqual(ota.filename, "AC695X_01_16x65535UX_00000400")

    def test_night_mode(self) -> None:
        nm = self._decoded("night_mode_get")
        self.assertIsInstance(nm, NightMode)
        self.assertTrue(nm.enabled)
        self.assertEqual((nm.start_hour, nm.start_minute), (21, 0))
        self.assertEqual((nm.end_hour, nm.end_minute), (8, 0))

    def test_timer_switch_empty(self) -> None:
        items = self._decoded("timer_switch_get")
        self.assertEqual(items, [])

    def test_countdown_status(self) -> None:
        status = self._decoded("countdown_status")
        self.assertIsInstance(status, responses.CountdownStatus)
        self.assertFalse(status.running)
        self.assertEqual((status.set_minute, status.left_minute), (5, 5))

    def test_stopwatch_status(self) -> None:
        status = self._decoded("stopwatch_status")
        self.assertIsInstance(status, responses.StopwatchStatus)
        self.assertFalse(status.running)
        self.assertEqual((status.hour, status.minute, status.seconds), (0, 0, 0))

    def test_scoreboard_status(self) -> None:
        status = self._decoded("scoreboard_status")
        self.assertIsInstance(status, responses.ScoreboardStatus)
        self.assertEqual((status.host_score, status.visit_score), (0, 0))

    def test_tomato(self) -> None:
        minutes = self._decoded("tomato_get")
        self.assertEqual(minutes, [5, 10, 25, 45])

    def test_alarms_empty(self) -> None:
        self.assertEqual(self._decoded("alarms_get"), [])

    def test_reminders_empty(self) -> None:
        self.assertEqual(self._decoded("reminders_get"), [])

    def test_temp_humidity(self) -> None:
        th = self._decoded("temp_humidity_1")
        self.assertIsInstance(th, responses.TempHumidity)
        self.assertEqual(th.humidity, 0)


class ResponseKeyTest(unittest.TestCase):
    """Opcodes whose second byte is request-specific data (a salt, a count, a CRC byte, ...)
    rather than an echoed selector must key on opcode alone, or a client's request/reply
    correlation silently desyncs."""

    def test_no_subop_opcodes_ignore_second_byte(self) -> None:
        for opcode, req, reply in (
            (0x02, bytes((0x02, 0x11, 0x22)), bytes((0x02, 0x00))),
            (0x0A, bytes((0x0A, 0x03, 0xFF)), bytes((0x0A, 0x00))),
            (0x0B, bytes((0x0B,)), bytes((0x0B, 0x02, 0xFF, 0xFF))),
            (0x0D, bytes((0x0D, 0x47, 0x00)), bytes((0x0D, 0x00))),
            (0x0E, bytes((0x0E, 0xCA, 0x00)), bytes((0x0E, 0x00))),
            (0x09, bytes((0x09, 0x1A, 0x09)), bytes((0x09, 0x01))),
        ):
            self.assertEqual(
                responses.response_key(req), responses.response_key(reply), f"opcode {opcode:#x} desynced"
            )

    def test_subop_opcodes_use_second_byte(self) -> None:
        self.assertEqual(responses.response_key(b"\x14\x01\x00"), (0x14, 0x01))
        self.assertEqual(responses.response_key(b"\x14\x02"), (0x14, 0x02))
        self.assertNotEqual(responses.response_key(b"\x14\x01\x00"), responses.response_key(b"\x14\x02"))

    def test_empty_payload_raises(self) -> None:
        with self.assertRaises(ValueError):
            responses.response_key(b"")


class SyntheticReplyShapeTest(unittest.TestCase):
    """Reply shapes real hardware didn't happen to be captured in, but that
    ``checkILedClockMessages`` (and this port) still must parse: populated lists, detail
    records, and every countdown/stopwatch/scoreboard action beyond a plain status query."""

    def test_reminder_list_with_ids(self) -> None:
        payload = bytes((0x1A, 0x01, 0x02, 0x03, 0x07))
        self.assertEqual(responses.parse(payload), [3, 7])

    def test_reminder_detail(self) -> None:
        content = "Take medicine".encode("utf-8")
        payload = (
            bytes((0x1A, 0x02, 4, 1, 26, 3, 15, 8, 0, 1))
            + bytes((0, 0, 10))  # padding byte + duration (2B BE) = 10
            + bytes((len(content),))
            + content
        )
        detail = responses.parse(payload)
        self.assertIsInstance(detail, responses.ReminderDetail)
        self.assertEqual(detail.id, 4)
        self.assertEqual(detail.content, "Take medicine")
        self.assertEqual(detail.duration, 10)

    def test_reminder_delete_ack(self) -> None:
        ack = responses.parse(bytes((0x1A, 0x03, 0x00)))
        self.assertIsInstance(ack, responses.Ack)
        self.assertTrue(ack.ok)

    def test_alarms_with_items(self) -> None:
        # enable, hour, minute, repeat_mask(monday+friday), duration(2B), reminder_duration
        item_bytes = bytes((1, 7, 30, 0b0010001, 0, 30, 9))
        payload = bytes((0x16, 0x02, 1)) + item_bytes
        items = responses.parse(payload)
        self.assertEqual(len(items), 1)
        self.assertIsInstance(items[0], AlarmItem)
        self.assertEqual((items[0].hour, items[0].minute), (7, 30))
        self.assertTrue(items[0].is_monday_on)
        self.assertTrue(items[0].is_friday_on)
        self.assertFalse(items[0].is_tuesday_on)

    def test_timer_switches_with_items(self) -> None:
        item_bytes = bytes((1, 22, 0, 0b1111111, 1, 0))
        payload = bytes((0x0B, 1)) + item_bytes
        items = responses.parse(payload)
        self.assertEqual(len(items), 1)
        self.assertIsInstance(items[0], TimerSwitchItem)
        self.assertTrue(items[0].is_set_device_on)

    def test_countdown_reset_and_finished(self) -> None:
        reset = responses.parse(bytes((0x0F, 0x02, 0x00)))
        self.assertEqual(reset, responses.CountdownStatus(action=2, success=True))
        finished = responses.parse(bytes((0x0F, 0x04, 0, 0, 0, 0, 0, 0, 0)))
        self.assertEqual(finished.action, 4)

    def test_stopwatch_start_stop(self) -> None:
        status = responses.parse(bytes((0x10, 0x03, 1, 0, 1, 30)))
        self.assertEqual(status, responses.StopwatchStatus(action=3, running=True, hour=0, minute=1, seconds=30))

    def test_scoreboard_set_score_ack(self) -> None:
        ack = responses.parse(bytes((0x11, 0x02, 0x00)))
        self.assertEqual(ack, responses.ScoreboardStatus(action=2, success=True))

    def test_unknown_opcode(self) -> None:
        unknown = responses.parse(bytes((0xEE, 0x01, 0x02)))
        self.assertIsInstance(unknown, responses.Unknown)
        self.assertEqual(unknown.opcode, 0xEE)

    def test_password_result(self) -> None:
        self.assertEqual(responses.parse(bytes((0x0D, 0x00))), responses.PasswordResult(ok=True))
        self.assertEqual(responses.parse(bytes((0x0D, 0x01))), responses.PasswordResult(ok=False))

    def test_program_chunk_ack(self) -> None:
        ack = responses.parse(bytes((0x03, 0x00, 0x00, 0x05, 0x00)))
        self.assertEqual(ack, responses.ProgramChunkAck(index=5, result=0))

    def test_program_start_ack(self) -> None:
        self.assertEqual(responses.parse(bytes((0x02, 0x00))), responses.ProgramStartAck(result=0))


if __name__ == "__main__":
    unittest.main()
