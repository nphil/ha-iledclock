"""BLE write chunking (Contract B: `min(mtu_size-3, 180)`, 15ms spacing)."""

from __future__ import annotations

import unittest

from custom_components.iledclock.chunking import chunk_bytes, chunk_size_for_mtu


class ChunkSizeForMtuTests(unittest.TestCase):
    def test_small_mtu_uses_mtu_minus_3(self) -> None:
        self.assertEqual(chunk_size_for_mtu(23), 20)

    def test_large_mtu_capped_at_180(self) -> None:
        self.assertEqual(chunk_size_for_mtu(517), 180)

    def test_exact_boundary_mtu(self) -> None:
        self.assertEqual(chunk_size_for_mtu(183), 180)
        self.assertEqual(chunk_size_for_mtu(182), 179)

    def test_degenerate_mtu_never_yields_zero(self) -> None:
        self.assertEqual(chunk_size_for_mtu(1), 1)
        self.assertEqual(chunk_size_for_mtu(0), 1)


class ChunkBytesTests(unittest.TestCase):
    def test_splits_into_equal_pieces(self) -> None:
        chunks = chunk_bytes(b"0123456789", 4)

        self.assertEqual(chunks, [b"0123", b"4567", b"89"])

    def test_exact_multiple_has_no_empty_trailing_chunk(self) -> None:
        chunks = chunk_bytes(b"01234567", 4)

        self.assertEqual(chunks, [b"0123", b"4567"])

    def test_empty_input_yields_no_chunks(self) -> None:
        self.assertEqual(chunk_bytes(b"", 180), [])

    def test_chunk_smaller_than_size_returned_whole(self) -> None:
        self.assertEqual(chunk_bytes(b"ab", 180), [b"ab"])

    def test_nonpositive_size_rejected(self) -> None:
        with self.assertRaises(ValueError):
            chunk_bytes(b"data", 0)


if __name__ == "__main__":
    unittest.main()
