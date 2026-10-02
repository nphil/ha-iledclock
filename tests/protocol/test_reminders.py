"""Reminder wire layer: ``ReminderContent`` encoding/validation, the content-count rule,
``program_fingerprint``, the reminder start frame and the reply parsers.

There is no JVM in this repo to regenerate golden vectors, so anything the three recorded
``getDataWithReminderCombineProgram`` vectors do not cover (repeat types 3/4, explicit week
masks, two-byte durations, long/non-ASCII titles) is hand-traced from the vendor source
``ILedClockUtils.getDataWithReminderCombineProgram`` (ILedClockUtils.java:4344-4375) and is
pinned as literal bytes below."""

from __future__ import annotations

import unittest

from protocol import responses
from protocol.crc import crc_code
from protocol.framing import decode_frame, encode_frame
from protocol.models import Frame
from protocol.programs import (
    FrameContent,
    GraffitiContent,
    Program,
    ReminderContent,
    TextAutoColor,
    TextContent,
    _content_number,
    _data_with_program,
    encode_content,
    plan_upload,
    program_fingerprint,
)

from . import _golden_helpers as gh


def _reminder(**overrides) -> ReminderContent:
    fields = dict(remind_id=5, title="Rent", year=26, month=11, day=15, hour=9, minute=0)
    fields.update(overrides)
    return ReminderContent(**fields)


def _program(content: ReminderContent, *extra) -> Program:
    return Program(contents=[content, *extra], show_count=1, is_clock_in_list=False, program_type=14)


def _fields(content: ReminderContent) -> dict:
    """Decode the content bytes back into named fields (layout: u32 length, tag 13, 8 zeros,
    sound, year, month, day, hour, minute, repeat, mask, duration u16, title length, title)."""
    data = encode_content(content)
    assert int.from_bytes(data[:4], "big") == len(data)
    assert data[4] == 0x13 and data[5:13] == bytes(8)
    title_len = data[23]
    return {
        "sound": data[13], "year": data[14], "month": data[15], "day": data[16], "hour": data[17],
        "minute": data[18], "repeat": data[19], "mask": data[20],
        "duration": int.from_bytes(data[21:23], "big"), "title_len": title_len,
        "title": data[24 : 24 + title_len], "end": len(data) == 24 + title_len,
    }


def _reminder_vectors() -> list[dict]:
    return [v for v in gh.load_vectors() if v["fn"] == "getDataWithReminderCombineProgram"]


class GoldenBackedHeaderTest(unittest.TestCase):
    def test_the_three_recorded_vectors_are_present(self) -> None:
        self.assertEqual(len(_reminder_vectors()), 3)

    def test_content_bytes_equal_the_recorded_vendor_output(self) -> None:
        for vector in _reminder_vectors():
            content = gh.reminder_content_from_json(vector["args"]["content"]["item"]["content"])
            with self.subTest(note=vector["args"]["note"]):
                self.assertEqual(encode_content(content).hex(), vector["out"])

    def test_full_program_blob_and_start_frame_carry_the_vendor_header_and_id_trailer(self) -> None:
        for vector in _reminder_vectors():
            raw = vector["args"]["content"]["item"]["content"]
            content = gh.reminder_content_from_json(raw)
            program = _program(content)
            blob = _data_with_program(program)
            plan = plan_upload(program, 0, 1, 1024)
            with self.subTest(note=vector["args"]["note"]):
                # 8 reserved zeros, one content, one reserved zero, then exactly the vendor bytes.
                self.assertEqual(blob, bytes(8) + b"\x01\x00" + bytes.fromhex(vector["out"]))
                # start: 02, crc, length, index 0, count 1, 00, 8 zeros, then the reminder trailer.
                self.assertEqual(plan.start[0], 0x02)
                self.assertEqual(plan.start[1:5], crc_code(blob))
                self.assertEqual(int.from_bytes(plan.start[5:9], "big"), len(blob))
                self.assertEqual(plan.start[9:11], b"\x00\x01")
                self.assertEqual(plan.start[-2:], bytes((0x05, raw["remindId"])))


class EncodingTest(unittest.TestCase):
    def test_monthly_repeat_writes_type_3_and_mask_00(self) -> None:
        # Hand-traced: len 0x1c, tag 13, 8 zeros, sound 01, yy 1a, mm 0b, dd 0f, 09:00, repeat 03,
        # mask 00, duration 003c, title "Rent".
        content = _reminder(repeat_type=3, duration=60)
        self.assertEqual(
            encode_content(content).hex(),
            "0000001c" "13" "0000000000000000" "01" "1a" "0b" "0f" "09" "00" "03" "00" "003c" "04" "52656e74",
        )

    def test_yearly_repeat_writes_type_4_and_mask_00(self) -> None:
        content = ReminderContent(remind_id=2, title="Bday", year=27, month=6, day=1, hour=8, minute=5,
                                  sound=2, repeat_type=4, duration=180)
        self.assertEqual(
            encode_content(content).hex(),
            "0000001c" "13" "0000000000000000" "02" "1b" "06" "01" "08" "05" "04" "00" "00b4" "04" "42646179",
        )

    def test_durations_are_two_bytes(self) -> None:
        for seconds, expected in ((0, 0), (30, 30), (180, 180), (300, 300), (65535, 65535)):
            with self.subTest(seconds=seconds):
                self.assertEqual(_fields(_reminder(duration=seconds))["duration"], expected)
        self.assertEqual(encode_content(_reminder(duration=300))[21:23], b"\x01\x2c")

    def test_default_duration_is_30_seconds(self) -> None:
        self.assertEqual(_fields(_reminder())["duration"], 30)

    def test_twenty_character_ascii_title_has_length_byte_20(self) -> None:
        fields = _fields(_reminder(title="A" * 20))
        self.assertEqual(fields["title_len"], 20)
        self.assertEqual(fields["title"], b"A" * 20)
        self.assertTrue(fields["end"])

    def test_non_ascii_title_length_byte_counts_utf8_bytes_not_characters(self) -> None:
        title = "Äpfel ☕🍎"  # 8 characters, 2 + 4 + 1 + 3 + 4 = 14 bytes
        self.assertEqual((len(title), len(title.encode())), (8, 14))
        fields = _fields(_reminder(title=title))
        self.assertEqual(fields["title_len"], 14)
        self.assertEqual(fields["title"].decode(), title)
        self.assertTrue(fields["end"])

    def test_week_mask_none_keeps_the_vendor_derived_mask(self) -> None:
        # 2026-10-02 is a Friday -> bit 4.
        self.assertEqual(_fields(_reminder(year=26, month=10, day=2, repeat_type=0))["mask"], 0x00)
        self.assertEqual(_fields(_reminder(year=26, month=10, day=2, repeat_type=1))["mask"], 0x7F)
        self.assertEqual(_fields(_reminder(year=26, month=10, day=2, repeat_type=2))["mask"], 0x10)
        self.assertEqual(_fields(_reminder(year=26, month=10, day=4, repeat_type=2))["mask"], 0x40)  # Sunday
        self.assertEqual(_fields(_reminder(repeat_type=3))["mask"], 0x00)
        self.assertEqual(_fields(_reminder(repeat_type=4))["mask"], 0x00)

    def test_explicit_week_mask_is_written_verbatim_for_every_repeat_type(self) -> None:
        for repeat_type in range(5):
            with self.subTest(repeat_type=repeat_type):
                self.assertEqual(_fields(_reminder(repeat_type=repeat_type, week_mask=0b0011111))["mask"], 0x1F)
        self.assertEqual(_fields(_reminder(repeat_type=1, week_mask=0))["mask"], 0x00)
        self.assertEqual(_fields(_reminder(repeat_type=1, week_mask=127))["mask"], 0x7F)

    def test_full_year_and_from_full_year(self) -> None:
        content = ReminderContent.from_full_year(3, "Wake", 2026, 10, 2, 7, 30, duration=60, week_mask=0x1F)
        self.assertEqual((content.year, content.full_year), (26, 2026))
        self.assertEqual((content.remind_id, content.duration, content.week_mask), (3, 60, 0x1F))
        self.assertEqual(_reminder(year=0).full_year, 2000)


class StartFrameTest(unittest.TestCase):
    def test_start_frame_trailer_is_05_then_the_id_for_boundary_ids(self) -> None:
        for remind_id in (0, 1, 2, 3, 4, 16, 255):
            with self.subTest(remind_id=remind_id):
                start = plan_upload(_program(_reminder(remind_id=remind_id)), 0, 1, 1024).start
                self.assertEqual(start[-2:], bytes((0x05, remind_id)))

    def test_ids_1_to_3_are_escaped_on_the_wire_and_survive_the_round_trip(self) -> None:
        for remind_id in (1, 2, 3):
            with self.subTest(remind_id=remind_id):
                start = plan_upload(_program(_reminder(remind_id=remind_id)), 0, 1, 1024).start
                frame = encode_frame(start)
                # 05, then the id escaped as 02 (id ^ 04), then the end marker 03.
                self.assertEqual(frame[-4:], bytes((0x05, 0x02, remind_id ^ 0x04, 0x03)))
                self.assertEqual(decode_frame(frame), start)

    def test_art_contents_after_the_reminder_are_counted_and_the_trailer_is_unchanged(self) -> None:
        art = GraffitiContent(0, 0, 32, 16, pixels=Frame(pixels=[[(255, 0, 0)] * 32 for _ in range(16)]))
        program = _program(_reminder(remind_id=7), art)
        blob = _data_with_program(program)
        self.assertEqual(blob[8], 2)
        self.assertEqual(plan_upload(program, 0, 1, 1024).start[-2:], b"\x05\x07")


class ValidationTest(unittest.TestCase):
    def test_each_wire_rule_rejects_its_first_out_of_range_value(self) -> None:
        bad = {
            "remind_id -1": dict(remind_id=-1),
            "remind_id 256": dict(remind_id=256),
            "year -1": dict(year=-1),
            "year 256": dict(year=256),
            "month 0": dict(month=0),
            "month 13": dict(month=13),
            "day 0": dict(day=0),
            "day 32": dict(day=32),
            "30 February": dict(month=2, day=30),
            "31 April": dict(month=4, day=31),
            "29 February 2027": dict(year=27, month=2, day=29),
            "hour 24": dict(hour=24),
            "hour -1": dict(hour=-1),
            "minute 60": dict(minute=60),
            "sound 256": dict(sound=256),
            "sound -1": dict(sound=-1),
            "repeat_type 5": dict(repeat_type=5),
            "repeat_type -1": dict(repeat_type=-1),
            "duration 65536": dict(duration=65536),
            "duration -1": dict(duration=-1),
            "week_mask 128": dict(week_mask=128),
            "week_mask -1": dict(week_mask=-1),
            "empty title": dict(title=""),
            "title 256 bytes": dict(title="a" * 256),
            "title 86 emoji-ish chars (258 bytes)": dict(title="\u20ac" * 86),
            "control character": dict(title="Wake\nup"),
            "NUL": dict(title="a\x00b"),
            "lone surrogate": dict(title="a\ud800"),
            "non-integer hour": dict(hour=7.5),
            "bool as number": dict(minute=True),
        }
        for label, overrides in bad.items():
            with self.subTest(label), self.assertRaises(ValueError):
                _reminder(**overrides)

    def test_wire_extremes_are_accepted(self) -> None:
        for overrides in (
            dict(remind_id=0), dict(remind_id=255), dict(year=0), dict(year=255),
            dict(year=28, month=2, day=29), dict(month=12, day=31, hour=23, minute=59),
            dict(sound=0), dict(sound=255), dict(repeat_type=4), dict(duration=0), dict(duration=65535),
            dict(week_mask=0), dict(week_mask=127), dict(title="a" * 255), dict(title="\u20ac" * 85),
        ):
            with self.subTest(**overrides):
                _reminder(**overrides)

    def test_policy_ranges_belong_to_the_domain_layer_not_the_wire(self) -> None:
        # ids above 16 and odd durations are legal on the wire; reminders.py enforces 1-16 / 30,60,120,180.
        _reminder(remind_id=17, duration=45)

    def test_error_message_names_the_field_and_value(self) -> None:
        with self.assertRaisesRegex(ValueError, r"minute must be 0-59, got 60"):
            _reminder(minute=60)
        with self.assertRaisesRegex(ValueError, r"2027-02-29 does not exist"):
            _reminder(year=27, month=2, day=29)


class ContentNumberTest(unittest.TestCase):
    def test_count_byte_is_the_sum_not_the_number_of_contents(self) -> None:
        text = TextContent(text="HI", color=TextAutoColor(effect=1))
        frame = FrameContent(frame_type=1, show_width=32, show_height=16)
        text_with_frame = TextContent(text="HI", color=TextAutoColor(effect=1), frame=frame)
        self.assertEqual(_content_number(text), 2)
        self.assertEqual(_content_number(text_with_frame), 3)
        self.assertEqual(_content_number(frame), 1)
        self.assertEqual(_content_number(_reminder()), 1)
        # The byte after the 8 reserved zeros of the blob.
        self.assertEqual(_data_with_program(Program(contents=[text]))[8], 2)
        self.assertEqual(_data_with_program(Program(contents=[text_with_frame]))[8], 3)
        self.assertEqual(_data_with_program(Program(contents=[frame, text]))[8], 3)
        self.assertEqual(_data_with_program(_program(_reminder()))[8], 1)

    def test_count_equals_the_number_of_length_prefixed_chunks_actually_written(self) -> None:
        text = TextContent(text="HI", color=TextAutoColor(effect=1))
        frame = FrameContent(frame_type=1, show_width=32, show_height=16)
        for content in (text, TextContent(text="HI", color=TextAutoColor(effect=1), frame=frame), frame, _reminder()):
            data = encode_content(content)
            chunks, offset = 0, 0
            while offset < len(data):
                offset += int.from_bytes(data[offset : offset + 4], "big")
                chunks += 1
            with self.subTest(type(content).__name__, frame=getattr(content, "frame", None) is not None):
                self.assertEqual(offset, len(data))
                self.assertEqual(chunks, _content_number(content))


class FingerprintTest(unittest.TestCase):
    def test_fingerprint_is_what_the_start_frame_carries(self) -> None:
        program = _program(_reminder())
        crc, length = program_fingerprint(program)
        start = plan_upload(program, 0, 1, 1024).start
        self.assertEqual(len(crc), 8)
        self.assertEqual(crc, crc.lower())
        self.assertEqual(bytes.fromhex(crc), start[1:5])
        self.assertEqual(length, int.from_bytes(start[5:9], "big"))
        self.assertEqual(length, len(_data_with_program(program)))

    def test_same_program_same_fingerprint_and_any_change_alters_it(self) -> None:
        base = program_fingerprint(_program(_reminder()))
        self.assertEqual(base, program_fingerprint(_program(_reminder())))
        self.assertNotEqual(base, program_fingerprint(_program(_reminder(minute=1))))
        self.assertNotEqual(base, program_fingerprint(_program(_reminder(title="Rents"))))


class ReplyParsingTest(unittest.TestCase):
    @staticmethod
    def _detail_payload(*, mask: int, year: int = 26, repeat: int = 3) -> bytes:
        title = "Rent".encode()
        return (
            bytes((0x1A, 0x02, 9, 1, year, 11, 15, 9, 0, repeat, mask))
            + (60).to_bytes(2, "big") + bytes((len(title),)) + title
        )

    def test_detail_exposes_week_mask_and_full_year(self) -> None:
        detail = responses.parse(self._detail_payload(mask=0x1F))
        self.assertIsInstance(detail, responses.ReminderDetail)
        self.assertEqual((detail.year, detail.full_year), (26, 2026))
        self.assertEqual(detail.week_mask, 0x1F)
        self.assertEqual((detail.repeat_type, detail.duration, detail.content), (3, 60, "Rent"))

    def test_detail_of_the_live_readback_has_year_2026(self) -> None:
        # Live capture: id 0, 'Testing testing ', 26-10-01 23:32, repeat 0.
        title = "Testing testing ".encode()
        payload = bytes((0x1A, 0x02, 0, 1, 26, 10, 1, 23, 32, 0, 0, 0, 30, len(title))) + title
        detail = responses.parse(payload)
        self.assertEqual((detail.id, detail.full_year, detail.month, detail.day), (0, 2026, 10, 1))
        self.assertEqual((detail.hour, detail.minute, detail.repeat_type), (23, 32, 0))

    def test_two_byte_1a_payload_is_a_program_start_ack(self) -> None:
        self.assertEqual(responses.parse(bytes((0x1A, 0x00))), responses.ProgramStartAck(result=0))
        self.assertEqual(responses.parse(bytes((0x1A, 0x01))), responses.ProgramStartAck(result=1))

    def test_longer_1a_replies_are_still_reminder_replies(self) -> None:
        self.assertEqual(responses.parse(bytes((0x1A, 0x01, 0x01, 0x05))), [5])
        self.assertTrue(responses.parse(bytes((0x1A, 0x03, 0x00))).ok)


if __name__ == "__main__":
    unittest.main()
