"""Wire framing: ``getSendDataWithInfo`` / ``convertData`` / ``recoverData`` (vendor Java,
``ILedClockUtils`` and identically in ``LightUtils``) plus notification reassembly.

Frame shape (verified against a live device, see ``docs/ARCHITECTURE.md``):
``01`` + escape(len_hi, len_lo, payload...) + ``03``, where ``len`` is the *unescaped*
payload size as a 2-byte big-endian integer, and escaping applies to the length bytes
too (not just the payload) — the vendor builds ``[len_hi, len_lo] + payload`` as one list
and escapes the whole thing before wrapping it in ``01``/``03``.

Escape rule (``convertData``): any byte ``b`` with ``0 < b < 4`` (i.e. 0x01, 0x02, 0x03)
becomes the two bytes ``0x02, b ^ 0x04``. ``0x00`` and any byte ``>= 4`` pass through
unescaped. Because every occurrence of 0x01/0x02/0x03 in properly-encoded data is always
escaped, a raw (unescaped) 0x01 or 0x03 byte can only ever be a frame delimiter — which is
exactly what makes naive delimiter scanning safe for :class:`FrameAssembler` even when a
frame is split across an arbitrary number of BLE notifications.

Divergence from the vendor's own function boundaries (deliberate, see Contract A): the
Java's per-command builders (``getDeviceInfo()`` etc.) call ``getSendDataWithInfo``
*themselves*, i.e. they return fully-framed bytes. This port instead has every builder in
``commands.py``/``programs.py`` return the bare, unframed payload, and centralises all
framing here — the wire bytes produced end-to-end are identical either way, but only one
place ever escapes or wraps anything.
"""

from __future__ import annotations

from .hexutil import length_prefix


class FrameError(ValueError):
    """Raised by :func:`decode_frame` for a malformed or incomplete frame."""


def _escape(data: bytes) -> bytes:
    """``convertData``: 0x01/0x02/0x03 -> ``0x02, byte ^ 0x04``; everything else verbatim."""
    out = bytearray()
    for b in data:
        if 0 < b < 4:
            out.append(0x02)
            out.append(b ^ 0x04)
        else:
            out.append(b)
    return bytes(out)


def _unescape(data: bytes) -> bytes:
    """Inverse of :func:`_escape` (the escaping half of ``recoverData``)."""
    out = bytearray()
    i = 0
    n = len(data)
    while i < n:
        b = data[i]
        if b == 0x02 and i + 1 < n:
            out.append(data[i + 1] ^ 0x04)
            i += 2
        else:
            out.append(b)
            i += 1
    return bytes(out)


def encode_frame(payload: bytes) -> bytes:
    """``getSendDataWithInfo``: frame an unescaped, unframed payload for the wire."""
    body = length_prefix(len(payload)) + payload
    return b"\x01" + _escape(body) + b"\x03"


def decode_frame(frame: bytes) -> bytes:
    """``recoverData`` (with the ``01``/``03`` well-formedness check made explicit, per
    Contract A, rather than silently returning an empty payload as the Java does).

    Returns the payload (opcode first), with the leading 2-byte length field stripped —
    the length is not re-validated against the actual remaining size, matching the vendor
    (which also never checks it).
    """
    if len(frame) < 4 or frame[0] != 0x01 or frame[-1] != 0x03:
        raise FrameError(f"not a well-formed frame: {frame.hex()}")
    unescaped = _unescape(frame[1:-1])
    if len(unescaped) < 2:
        raise FrameError(f"frame too short after unescaping: {frame.hex()}")
    return unescaped[2:]


class FrameAssembler:
    """Reassembles ``encode_frame`` output split across an arbitrary number of BLE
    notifications. Safe because, as noted above, a raw (unescaped) 0x01/0x03 in the byte
    stream can only be a delimiter — never payload data — so scanning for the next 0x01
    then the next 0x03 is unambiguous even mid-escape-sequence.
    """

    def __init__(self) -> None:
        self._buf = bytearray()

    def feed(self, data: bytes) -> list[bytes]:
        """Feed newly-received bytes; returns zero or more complete, decoded payloads."""
        self._buf.extend(data)
        payloads: list[bytes] = []
        while True:
            start = self._buf.find(0x01)
            if start < 0:
                self._buf.clear()
                break
            if start > 0:
                del self._buf[:start]
            end = self._buf.find(0x03, 1)
            if end < 0:
                break  # frame incomplete; wait for more data
            frame = bytes(self._buf[: end + 1])
            del self._buf[: end + 1]
            try:
                payloads.append(decode_frame(frame))
            except FrameError:
                pass  # malformed span between two delimiters; drop and keep scanning
        return payloads

    def reset(self) -> None:
        self._buf.clear()
