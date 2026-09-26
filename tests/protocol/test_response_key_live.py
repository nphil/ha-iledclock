"""Every request we send must be matched by the reply the real clock gave to it.

Regression: device info (1f) and firmware version (fd) replies carry a status byte where other
commands carry a sub-operation, so a sub-op-by-default correlation key never matched them and
every such request timed out on the real clock.
"""
import json
import unittest
from pathlib import Path

from protocol import framing, responses

LIVE = Path(__file__).resolve().parents[1] / "live_replies_2026-09-25.json"
EXTRA = {  # captured live the same day, outside the fixture file
    "ota_version": ("fd", "010022fd020500211d4143363935585f30315f313678363535333555585f303030303034303003"),
    "check_password": ("0d55555555555555" "00", "010002060d0003"),
}


class LiveReplyKeyTest(unittest.TestCase):
    def test_every_live_reply_matches_its_request(self):
        cases = {
            name: (c["request_payload"], c["reply_frame"])
            for name, c in json.loads(LIVE.read_text()).items()
            if c.get("reply_frame")
        }
        cases.update(EXTRA)
        self.assertGreaterEqual(len(cases), 12)
        for name, (request_hex, reply_frame) in cases.items():
            with self.subTest(name):
                reply = framing.decode_frame(bytes.fromhex(reply_frame))
                self.assertEqual(
                    responses.response_key(bytes.fromhex(request_hex)),
                    responses.response_key(reply),
                )


if __name__ == "__main__":
    unittest.main()
