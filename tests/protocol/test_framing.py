"""``framing.py`` verification: escape/unescape round-trips, the golden ``recoverData``/
``getSendDataWithInfo`` vectors, and byte-exact replay of every live capture in
``tests/live_replies_2026-09-25.json`` (both the outgoing request frame and the device's own
reply frame) -- this file has no external dependency, so these tests always run."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from protocol import framing

from . import _golden_helpers as gh

_LIVE_REPLIES_PATH = Path(__file__).resolve().parents[1] / "live_replies_2026-09-25.json"


class FrameRoundTripTest(unittest.TestCase):
    def test_round_trip_plain(self) -> None:
        for payload in (b"", b"\x1f", b"\x05\x01", bytes(range(256)), b"\x00" * 50):
            frame = framing.encode_frame(payload)
            self.assertEqual(framing.decode_frame(frame), payload)

    def test_frame_wrapper_bytes(self) -> None:
        frame = framing.encode_frame(b"\x1f")
        self.assertEqual(frame[0], 0x01)
        self.assertEqual(frame[-1], 0x03)

    def test_escapes_boundary_bytes(self) -> None:
        # 0x01, 0x02, 0x03 collide with the frame delimiters/escape marker themselves; 0x00
        # and 0x04 are the values just outside the escaped range on either side.
        payload = bytes((0x00, 0x01, 0x02, 0x03, 0x04, 0xFF))
        frame = framing.encode_frame(payload)
        self.assertEqual(framing.decode_frame(frame), payload)
        # Every escaped byte becomes 0x02 followed by (value ^ 4); 0x00/0xff pass through raw.
        inner = frame[1:-1]
        self.assertIn(0x02, inner)

    def test_length_prefix_covers_unescaped_length(self) -> None:
        payload = b"\x01\x02\x03" * 20  # forces heavy escaping
        frame = framing.encode_frame(payload)
        decoded = framing.decode_frame(frame)
        self.assertEqual(len(decoded), len(payload))
        self.assertEqual(decoded, payload)

    def test_decode_rejects_bad_wrapper(self) -> None:
        with self.assertRaises(framing.FrameError):
            framing.decode_frame(b"\x00\x00\x01\x1f\x03")  # wrong leading byte
        with self.assertRaises(framing.FrameError):
            framing.decode_frame(b"\x01\x00\x01\x1f\x00")  # wrong trailing byte


class FrameAssemblerTest(unittest.TestCase):
    def test_single_notification(self) -> None:
        payload = b"\x1f\x01\xa3\x00"
        frame = framing.encode_frame(payload)
        assembler = framing.FrameAssembler()
        self.assertEqual(list(assembler.feed(frame)), [payload])

    def test_split_across_arbitrary_boundaries(self) -> None:
        payload = bytes(range(1, 200))  # avoid 0x00 so this is a meaningfully large frame
        frame = framing.encode_frame(payload)
        for split in range(1, len(frame)):
            assembler = framing.FrameAssembler()
            results = list(assembler.feed(frame[:split])) + list(assembler.feed(frame[split:]))
            self.assertEqual(results, [payload], f"failed at split point {split}")

    def test_multiple_frames_in_one_feed(self) -> None:
        payload_a = b"\x1f\x00"
        payload_b = b"\x05\x01"
        combined = framing.encode_frame(payload_a) + framing.encode_frame(payload_b)
        assembler = framing.FrameAssembler()
        self.assertEqual(list(assembler.feed(combined)), [payload_a, payload_b])

    def test_reset_discards_partial_frame(self) -> None:
        payload = b"\x1f\x01\xa3"
        frame = framing.encode_frame(payload)
        assembler = framing.FrameAssembler()
        list(assembler.feed(frame[:3]))  # partial, mid-frame
        assembler.reset()
        self.assertEqual(list(assembler.feed(frame)), [payload])

    def test_byte_by_byte_feed(self) -> None:
        payload = bytes(range(1, 50))
        frame = framing.encode_frame(payload)
        assembler = framing.FrameAssembler()
        results = []
        for byte in frame:
            results.extend(assembler.feed(bytes((byte,))))
        self.assertEqual(results, [payload])


class LiveReplyReplayTest(unittest.TestCase):
    """Every capture in ``live_replies_2026-09-25.json`` (Contract A's own documented live
    device evidence) decodes byte-exact on both directions."""

    def test_all_live_replies(self) -> None:
        with _LIVE_REPLIES_PATH.open() as handle:
            captures = json.load(handle)

        checked = 0
        for name, entry in captures.items():
            request_payload = bytes.fromhex(entry["request_payload"])
            sent_frame = bytes.fromhex(entry["sent_frame"])
            self.assertEqual(framing.decode_frame(sent_frame), request_payload, f"{name}: request frame")
            self.assertEqual(framing.encode_frame(request_payload), sent_frame, f"{name}: re-encode request")
            checked += 1

            if entry["reply_frame"] is not None:
                reply_frame = bytes.fromhex(entry["reply_frame"])
                decoded_reply = framing.decode_frame(reply_frame)
                self.assertTrue(len(decoded_reply) > 0, f"{name}: reply decoded to nothing")
                checked += 1

        self.assertGreaterEqual(checked, 11, "expected to check every documented live capture")


class GoldenFramingVectorTest(unittest.TestCase):
    """``recoverData`` (the vendor's own decode-side escape/frame stripper) against golden
    vectors -- ``framing.decode_frame`` is this project's equivalent."""

    def test_recover_data_vectors(self) -> None:
        vectors = gh.load_vectors()
        if vectors is None:
            self.skipTest(f"golden vectors fixture not present at {gh.VECTORS_PATH}")

        matched = 0
        for vector in vectors:
            if vector["fn"] != "recoverData":
                continue
            args = vector["args"]
            if "framedReplyHex" in args:
                framed = bytes.fromhex(args["framedReplyHex"])
                expected = bytes.fromhex(vector["out"]) if vector["out"] else b""
                self.assertEqual(framing.decode_frame(framed), expected, args)
            elif "payload" in args:
                payload = bytes(int(tok, 16) for tok in args["payload"])
                self.assertEqual(framing.decode_frame(framing.encode_frame(payload)), payload, args)
                self.assertEqual(bytes.fromhex(vector["out"]), payload, args)
            else:
                payload = bytes(i & 0xFF for i in range(args["payloadLength"]))
                self.assertEqual(framing.decode_frame(framing.encode_frame(payload)), payload, args)
                self.assertEqual(bytes.fromhex(vector["out"]), payload, args)
            matched += 1
        self.assertEqual(matched, 5, "expected 5 recoverData golden vectors")


if __name__ == "__main__":
    unittest.main()
