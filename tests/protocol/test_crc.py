"""``CrcCode`` port verification: the bit-by-bit MSB-first CRC-32 construction against golden
vectors directly (``CrcCode.getCrc32CheckCode2``/``getCrcCode``), plus its round-trip
properties (determinism, sensitivity to every byte)."""

from __future__ import annotations

import unittest

from protocol.crc import crc32_check_code, crc_code

from . import _golden_helpers as gh


class CrcVectorTest(unittest.TestCase):
    def test_against_golden_vectors(self) -> None:
        vectors = gh.load_vectors()

        matched = 0
        for vector in vectors:
            if vector["fn"] not in ("CrcCode.getCrc32CheckCode2", "CrcCode.getCrcCode"):
                continue
            payload = gh.crc_lzss_test_buffer(vector["args"]["label"])
            if vector["fn"] == "CrcCode.getCrc32CheckCode2":
                # The harness renders the raw unsigned 32-bit value as an 8-hex-char string.
                expected = int(vector["out"], 16)
                self.assertEqual(crc32_check_code(payload), expected, vector["args"])
            else:
                self.assertEqual(crc_code(payload), bytes.fromhex(vector["out"]), vector["args"])
            matched += 1
        self.assertEqual(matched, 10, "expected 5 getCrc32CheckCode2 + 5 getCrcCode golden vectors")

    def test_deterministic(self) -> None:
        data = b"the quick brown fox"
        self.assertEqual(crc32_check_code(data), crc32_check_code(data))
        self.assertEqual(crc_code(data), crc_code(data))

    def test_sensitive_to_every_byte(self) -> None:
        base = bytes(range(32))
        base_crc = crc_code(base)
        for index in range(len(base)):
            mutated = bytearray(base)
            mutated[index] ^= 0xFF
            self.assertNotEqual(crc_code(bytes(mutated)), base_crc, f"byte {index} did not affect the checksum")

    def test_four_bytes(self) -> None:
        self.assertEqual(len(crc_code(b"")), 4)
        self.assertEqual(len(crc_code(b"x" * 1000)), 4)


if __name__ == "__main__":
    unittest.main()
