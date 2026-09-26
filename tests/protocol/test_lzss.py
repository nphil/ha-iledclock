"""``LzssCompress`` port verification: golden vectors for the compressed byte stream itself,
plus round-trip correctness against a reference Okumura LZSS decoder (independent of this
project's encoder, so a bug shared between compress/decompress can't hide)."""

from __future__ import annotations

import unittest

from protocol.lzss import compress

from . import _golden_helpers as gh

# Reference decoder: a direct, from-scratch implementation of Okumura's classic LZSS
# (N=4096 window in the original; this vendor's port uses N=512/F=18/THRESHOLD=2 -- see
# lzss.py's own docstring) used ONLY to prove compress() round-trips, entirely independent of
# lzss.py's own encoder implementation.
_N = 512
_F = 18
_THRESHOLD = 2


def _reference_decompress(data: bytes) -> bytes:
    text_buf = bytearray(_N - _F)
    out = bytearray()
    r = _N - _F
    flags = 0
    i = 0
    while i < len(data):
        flags >>= 1
        if not (flags & 0x100):
            flags = data[i] | 0xFF00
            i += 1
            continue
        if flags & 1:
            c = data[i]
            i += 1
            out.append(c)
            text_buf.append(c)
            text_buf.pop(0) if False else None
            text_buf_ext = text_buf
            text_buf_ext_pos = r
            text_buf[r % len(text_buf)] if False else None
            text_buf.append(c)
            r = (r + 1) % _N if len(text_buf) > _N else r + 1
        else:
            j = data[i]
            k = data[i + 1]
            i += 2
            j |= (k & 0xF0) << 4
            k = (k & 0x0F) + _THRESHOLD
            for n in range(k + 1):
                c = text_buf[(j + n) % len(text_buf)] if (j + n) < len(text_buf) else 0
                out.append(c)
                text_buf.append(c)
    return bytes(out)


def _okumura_decompress(compressed: bytes) -> bytes:
    """A clean, direct Okumura-style decoder matching this project's own N/F/THRESHOLD
    constants, written independently of ``lzss.py``'s encoder for a genuine round-trip check."""
    ring = bytearray(_N)
    r = _N - _F
    out = bytearray()
    i = 0
    flag_bits = 0
    flag_byte = 0
    while i < len(compressed):
        flag_bits >>= 1
        if (flag_bits & 0x100) == 0:
            flag_byte = compressed[i]
            i += 1
            flag_bits = flag_byte | 0xFF00
        if flag_bits & 1:
            c = compressed[i]
            i += 1
            out.append(c)
            ring[r] = c
            r = (r + 1) % _N
        else:
            j = compressed[i]
            k = compressed[i + 1]
            i += 2
            j |= (k & 0xF0) << 4
            length = (k & 0x0F) + _THRESHOLD
            for n in range(length + 1):
                c = ring[(j + n) % _N]
                out.append(c)
                ring[r] = c
                r = (r + 1) % _N
    return bytes(out)


class LzssRoundTripTest(unittest.TestCase):
    def _check_round_trip(self, data: bytes) -> None:
        compressed = compress(data)
        self.assertEqual(_okumura_decompress(compressed), data, f"round-trip failed for {len(data)}-byte input")

    def test_empty(self) -> None:
        self._check_round_trip(b"")

    def test_short_inputs(self) -> None:
        for length in range(1, 20):
            self._check_round_trip(bytes(range(length)))

    def test_repetitive(self) -> None:
        self._check_round_trip(b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        self._check_round_trip(b"ABABABABABABABABABABABABABABABABABAB")

    def test_boundary_match_lengths(self) -> None:
        # F-1, F, F+1 repeated-run lengths exercise the encoder's longest-match boundary.
        for run_len in (17, 18, 19):
            self._check_round_trip(b"X" + b"Y" * run_len + b"X" * 40)

    def test_random_like(self) -> None:
        import random

        rng = random.Random(12345)
        self._check_round_trip(bytes(rng.randrange(256) for _ in range(2000)))

    def test_realistic_program_payload(self) -> None:
        # A payload shaped like a real (small, structured, lots of repeated zero runs)
        # uncompressed program body -- the actual traffic this function compresses.
        self._check_round_trip(b"\x00" * 8 + b"\x01\x00" + bytes(range(256)) * 3 + b"\x00" * 50)


class LzssGoldenVectorTest(unittest.TestCase):
    def test_against_golden_vectors(self) -> None:
        vectors = gh.load_vectors()

        matched = 0
        skipped = 0
        for vector in vectors:
            if vector["fn"] not in ("LzssCompress.getLzssCompressData", "LzssCompress.lazssCompress"):
                continue
            if vector["out"] is None:
                # "empty" label: the vendor's own lazssCompress(byte[]) returns null for
                # zero-length input (a textsize==0 short-circuit), and getLzssCompressData
                # then NPEs unconditionally dereferencing that null -- see the vector's own
                # "note". This project's compress(b"") deliberately returns b"" instead of
                # raising, a safe, honest divergence rather than reproducing a crash.
                self.assertEqual(compress(b""), b"")
                skipped += 1
                continue
            payload = gh.crc_lzss_test_buffer(vector["args"]["label"])
            expected = bytes.fromhex(vector["out"])
            got = compress(payload)
            self.assertEqual(got, expected, f"{vector['fn']}: payload length {len(payload)}")
            matched += 1
        self.assertEqual(matched, 8, "expected 4 getLzssCompressData + 4 lazssCompress non-empty golden vectors")
        self.assertEqual(skipped, 2, "expected exactly the 2 empty-input (null-output) vectors")


if __name__ == "__main__":
    unittest.main()
