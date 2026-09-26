"""Byte-identical port of ``ILedClockUtils.CrcCode`` (vendor Java).

The vendor ships two CRC-32 implementations in the same nested class — a fast table-driven
``getCrc32CheckCode`` and a bit-by-bit ``getCrc32CheckCode2`` — but ``getCrcCode`` (the only
one any builder calls) uses **only** the bit-by-bit one. We therefore port only that one.

It is a deliberately unusual construction: per input byte it runs the standard "shift the
32-bit register, XOR in the polynomial when the top bit is set" step **32 times**, not 8,
and only XORs the byte's own bits into the register during the *last* 8 of those 32 shifts
(so the first 24 shifts of every byte are pure register churn with no data). This is exactly
what the byte-by-byte MSB-first CRC math below reproduces — do not "simplify" to a standard
8-shift-per-byte CRC-32, the wire checksum would stop matching the firmware's.
"""

from __future__ import annotations

_POLY = 79764919  # 0x04C11DB7 — CRC32_POLYNOMIAL in the vendor source
_MASK = 0xFFFFFFFF


def crc32_check_code(data: bytes) -> int:
    """``CrcCode.getCrc32CheckCode2`` — returns the raw 32-bit (unsigned) checksum value."""
    reg = _MASK  # int i = -1;
    for byte in data:
        bit_mask = 0x80000000
        for _ in range(32):
            reg = ((reg << 1) ^ _POLY) & _MASK if (reg & 0x80000000) else (reg << 1) & _MASK
            if byte & bit_mask:
                reg ^= _POLY
                reg &= _MASK
            bit_mask = (bit_mask >> 1) & _MASK
    return reg & _MASK


def crc_code(data: bytes) -> bytes:
    """``CrcCode.getCrcCode``: the checksum as 4 big-endian bytes (what every builder
    that calls ``CrcCode.getCrcCode(list)`` actually appends to the payload).
    """
    return crc32_check_code(data).to_bytes(4, "big")
