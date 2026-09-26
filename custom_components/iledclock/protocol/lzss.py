"""Byte-identical port of ``ILedClockUtils.LzssCompress`` (vendor Java).

This is Haruhiko Okumura's classic public-domain LZSS encoder (``N=512`` window,
``F=18`` max match length, ``THRESHOLD=2``) as vendored into the app. The decompiled
source at the vendor's own JADX dump has one variable (their ``i3``, the byte-flush loop
index) that reads before it is ever written on the very first flush — impossible for
real, compiling Java and confirmed to be a decompiler artefact by diffing against
GoldenHarness's independently-recompiled copy of the same class, which moves that one
assignment ahead of the loop it seeds (``golden/vendor/.../ILedClockUtils.java`` vs.
``src/sources/.../ILedClockUtils.java``, function ``lazssCompress``). This port follows
the corrected control flow, i.e. plain "reset a loop counter to 0, then run the loop".

The vendor also tracks a class-level ``textsize``/``printcount`` pair inside the main
encode loop, incremented independently of the local lookahead-window counter that
actually controls loop termination — but nothing downstream ever reads them (they only
ever fed a progress log that was stripped from this build), so they cannot affect the
output and are omitted here.

Only ``getLzssCompressData`` (bit-by-bit encode, no table) is ported — it is the only
entry point any builder in the app calls; the decoder is never used on-device (the
firmware decompresses, the app never does), so it is out of scope.
"""

from __future__ import annotations

_N = 512  # ring buffer size / NIL sentinel
_F = 18  # upper limit for match length
_THRESHOLD = 2  # encode string into position/length if match length is greater than this


class _Encoder:
    """Mirrors the vendor's static mutable arrays as instance state — one per call, so the
    port is reentrant (the Java original used ``static`` fields, i.e. was NOT reentrant;
    that is purely an implementation detail invisible in the output bytes).
    """

    __slots__ = ("enbuffer", "lson", "rson", "dad", "match_length", "match_position")

    def __init__(self) -> None:
        self.enbuffer = bytearray(_N + _F)
        self.lson = [0] * (_N + 1)
        self.rson = [0] * (_N + 257)
        self.dad = [0] * (_N + 1)
        self.match_length = 0
        self.match_position = 0

    def init_tree(self) -> None:
        for i in range(_N + 1, _N + 257):
            self.rson[i] = _N
        for i in range(_N):
            self.dad[i] = _N

    def insert_node(self, r: int) -> None:
        enbuffer, lson, rson, dad = self.enbuffer, self.lson, self.rson, self.dad
        cmp = 1
        p = _N + 1 + enbuffer[r]
        lson[r] = _N
        rson[r] = _N
        self.match_length = 0
        while True:
            if cmp >= 0:
                child = rson[p]
                if child == _N:
                    rson[p] = r
                    dad[r] = p
                    return
            else:
                child = lson[p]
                if child == _N:
                    lson[p] = r
                    dad[r] = p
                    return
            p = child
            i = 1
            while i < _F and (cmp := enbuffer[r + i] - enbuffer[p + i]) == 0:
                i += 1
            if i > self.match_length:
                self.match_position = p
                self.match_length = i
                if i >= _F:
                    dad[r] = dad[p]
                    lson[r] = lson[p]
                    rson[r] = rson[p]
                    dad[lson[p]] = r
                    dad[rson[p]] = r
                    gp = dad[p]
                    if rson[gp] == p:
                        rson[gp] = r
                    else:
                        lson[gp] = r
                    dad[p] = _N
                    return

    def delete_node(self, p: int) -> None:
        lson, rson, dad = self.lson, self.rson, self.dad
        if dad[p] == _N:
            return
        if rson[p] == _N:
            q = lson[p]
        elif lson[p] == _N:
            q = rson[p]
        else:
            q = lson[p]
            if rson[q] != _N:
                while rson[q] != _N:
                    q = rson[q]
                rson[dad[q]] = lson[q]
                dad[lson[q]] = dad[q]
                lson[q] = lson[p]
                dad[lson[p]] = q
            rson[q] = rson[p]
            dad[rson[p]] = q
        dad[q] = dad[p]
        if rson[dad[p]] == p:
            rson[dad[p]] = q
        else:
            lson[dad[p]] = q
        dad[p] = _N

    def encode(self, data: bytes) -> bytes | None:
        enbuffer = self.enbuffer
        code_buf = bytearray(_F - 1)
        out = bytearray()
        length = len(data)
        self.init_tree()
        code_buf[0] = 0
        code_buf_ptr = 1
        mask = 1
        for k in range(_N - _F):
            enbuffer[k] = 0
        r = _N - _F
        s = 0
        src = 0
        window = 0  # Java's local `i6`: remaining primed lookahead bytes; controls loop exit.
        while window < _F and src < length:
            enbuffer[r + window] = data[src]
            window += 1
            src += 1
        if window == 0:
            return None
        for i in range(1, _F + 1):
            self.insert_node(r - i)
        self.insert_node(r)
        while True:
            if self.match_length > window:
                self.match_length = window
            match_len = self.match_length
            if match_len <= _THRESHOLD:
                match_len = 1
                code_buf[0] |= mask
                code_buf[code_buf_ptr] = enbuffer[r]
                code_buf_ptr += 1
            else:
                pos = self.match_position
                code_buf[code_buf_ptr] = pos & 0xFF
                code_buf[code_buf_ptr + 1] = ((pos >> 4) & 0xF0) | (match_len - (_THRESHOLD + 1))
                code_buf_ptr += 2
            mask = (mask << 1) & 0xFF
            if mask == 0:
                out.extend(code_buf[:code_buf_ptr])
                code_buf[0] = 0
                code_buf_ptr = 1
                mask = 1
            last_match_length = match_len
            i = 0
            while i < last_match_length and src < length:
                self.delete_node(s)
                c = data[src]
                enbuffer[s] = c
                if s < _F - 1:
                    enbuffer[s + _N] = c
                s = (s + 1) & (_N - 1)
                r = (r + 1) & (_N - 1)
                self.insert_node(r)
                i += 1
                src += 1
            while i < last_match_length:
                i += 1
                self.delete_node(s)
                s = (s + 1) & (_N - 1)
                r = (r + 1) & (_N - 1)
                window -= 1
                if window > 0:
                    self.insert_node(r)
            if window <= 0:
                break
        if code_buf_ptr > 1:
            out.extend(code_buf[:code_buf_ptr])
        return bytes(out)


def compress(data: bytes) -> bytes:
    """``LzssCompress.getLzssCompressData``. Returns ``b""`` for empty input (the vendor
    returns ``null`` from ``lazssCompress`` in that case, then ``byte2hex(null)`` — this
    port simply returns empty bytes, which is the only sane analogue and is never actually
    reachable through Contract A since program/OTA payloads are always non-empty).
    """
    if not data:
        return b""
    result = _Encoder().encode(data)
    return result if result is not None else b""
