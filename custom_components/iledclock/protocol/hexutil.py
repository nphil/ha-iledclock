"""Faithful ports of ``LightUtils`` (and the small number of ``TextEmojiManagerCoolLEDUX``
colour helpers every content encoder depends on) from the vendor Java, quirks included.

Vendor reference: ``com/jtkj/led1248/light/utils/LightUtils.java`` and
``com/jtkj/led1248/light/emoji/TextEmojiManagerCoolLEDUX.java``.

The vendor represents a payload as ``List<String>`` of two-hex-char byte tokens built by
gluing together the return values of the helpers below. This port represents the same
payload as plain ``bytes``; every function here returns ``bytes`` (0, 1, 2, or 4 of them)
so callers can simply concatenate with ``+`` or ``b"".join(...)`` exactly where the Java
did ``list.addAll(...)``.

Preserved quirks (do NOT "fix" these — they are load-bearing for the real firmware):

* ``u8()`` (``getHexListStringForInt`` / ``getHexListStringForWithOneByte``) silently
  returns **no bytes at all** for ``i`` outside ``0..255`` — ``Integer.toHexString(i)``
  produces neither a 1- nor a 2-character string outside that range, and neither of the
  two ``if`` branches in the Java ever fires, so the value is dropped on the floor rather
  than raising. Several callers rely on this (e.g. week-day bitmasks that happen to stay
  in range) — replicate it rather than clamping or raising.
* ``u8_str()`` (``getHexStringForInt`` / ``getHexStringForIntWithOneByte``) has no such
  guard: for ``i > 255`` it returns the *raw, unpadded* hex string (3+ characters), which
  would desynchronise a byte stream if it were ever hit. In the real app this path is only
  reached with values already known to be byte-range; ``commands.py`` range-validates
  before calling in the equivalent spots so the quirk is unreachable through our API.
* ``u16be()`` (``getHexListStringForIntWithTwoByte`` / ``...WithTwo``) likewise emits
  nothing for ``i`` outside ``0..0xFFFF``.
* ``u32be()`` (``getHexListStringForIntWithFourByte``) covers the full unsigned 32-bit
  range (Java ``Integer.toHexString`` of a negative int already prints 8 hex chars, so the
  length-8 branch handles negatives as an unsigned bit pattern too); we mask to 32 bits to
  match.
"""

from __future__ import annotations


def u8(i: int) -> bytes:
    """One byte if ``0 <= i <= 255``, else no bytes (vendor quirk, see module docstring)."""
    if 0 <= i <= 255:
        return bytes((i,))
    return b""


def u8_str(i: int) -> str:
    """Raw two-hex-char (or longer, unclamped) string — mirrors ``getHexStringForInt``."""
    if i < 0:
        i &= 0xFFFFFFFF
    h = format(i, "x")
    return "0" + h if len(h) == 1 else h


def u16be(i: int) -> bytes:
    """Two big-endian bytes if ``0 <= i <= 0xFFFF``, else no bytes (vendor quirk)."""
    if 0 <= i <= 0xFFFF:
        return i.to_bytes(2, "big")
    return b""


def u32be(i: int) -> bytes:
    """Four big-endian bytes; Java prints negatives as their 32-bit unsigned pattern."""
    return (i & 0xFFFFFFFF).to_bytes(4, "big")


def length_prefix(n: int) -> bytes:
    """``getDataStringLength``: 2-byte big-endian count, ``0000`` for ``None``."""
    if n is None:
        return b"\x00\x00"
    return u16be(n)


def byte2hex(data: bytes) -> list[str]:
    """``LightUtils.byte2hex`` — list of lowercase two-char hex tokens, one per byte."""
    return [format(b, "02x") for b in data]


def from_hex_tokens(tokens: list[str]) -> bytes:
    """``LightUtils.fromListStringToByteArray`` — inverse of :func:`byte2hex`."""
    return bytes(int(t, 16) for t in tokens)


def split_data_string_by_dot(s: str) -> list[str]:
    """``getSplitDataStringByDot``: trims each comma-separated token. The vendor reuses this
    one helper for two differently-typed embedded tables — it just trims, and does not
    itself know or care whether the tokens are decimal digits or hex byte pairs.
    """
    if not s:
        return []
    return [tok.strip() for tok in s.split(",") if tok.strip() != ""]


def decimal_tokens_to_bytes(tokens: list[str]) -> bytes:
    """``getHexDataStringByDot``: each token is a *decimal* byte value (0-255) -> one byte.

    Used for the embedded clock/date/scoreboard digit bitmap tables in ``fonts/clock_faces.py``,
    which the vendor source stores as comma-separated decimal values (e.g. ``"254, 130, ..."``).
    """
    return bytes(int(tok) for tok in tokens)


def hex_tokens_to_bytes(tokens: list[str]) -> bytes:
    """The vendor's ``colorModeN``/``colorTypeN``/frame-border tables are comma-separated
    *hex* byte pairs (e.g. ``"0F,00,0F,10,..."``) that ``getSplitDataStringByDot`` (or the
    double-brace ``add("0F")`` list literals) already leaves as ready-to-use two-hex-char
    tokens — no decimal parsing step, unlike :func:`decimal_tokens_to_bytes`.
    """
    return bytes(int(tok, 16) for tok in tokens)


def decimal_csv_to_bytes(s: str) -> bytes:
    """``getHexDataStringByDot(getSplitDataStringByDot(s))`` composed — the exact pipeline
    every clock/date/scoreboard/temperature/humidity encoder runs its embedded digit table
    string through before appending it to the payload.
    """
    return decimal_tokens_to_bytes(split_data_string_by_dot(s))


def hex_csv_to_bytes(s: str) -> bytes:
    """``getSplitDataStringByDot(s)`` used directly as hex tokens — the pipeline
    ``setColorMode`` and the frame/border content encoder run their embedded colour tables
    through (see module docstring on the two table flavours).
    """
    return hex_tokens_to_bytes(split_data_string_by_dot(s))


# --- colour quantisation -----------------------------------------------------------------
# Two DIFFERENT RGB->RGB444 mappings exist in the vendor app; which one an encoder uses is a
# real protocol detail, not an implementation nicety, and mixing them up changes the bytes
# sent to the device. Preserve both.


def rgb444_component(v: int) -> int:
    """``TextEmojiManagerCoolLEDUX.rgb444Transfer`` — the *curved* per-channel mapping used
    for actual LED pixel colours (graffiti/animation frames and text glyph "content" pixel
    data): saturates to 0 below 48, to 15 above 237, otherwise ``((v-47)//14)+1``.

    This is what the LEDs can actually show, so ``render.py``'s preview quantisation reuses
    exactly this curve (not the linear one below).
    """
    if v >= 238:
        return 15
    if v <= 47:
        return 0
    return ((v - 47) // 14) + 1


def rgb444_pixel(rgb: tuple[int, int, int]) -> bytes:
    """``getColorDataWithColorWithRGB444Transfer``: 2 bytes, ``0R`` then ``GB`` nibbles,
    each channel through :func:`rgb444_component`. This is the per-pixel colour format
    used for graffiti cells, animation-frame cells, and rasterised text glyph columns.
    """
    r, g, b = rgb
    rn, gn, bn = rgb444_component(r), rgb444_component(g), rgb444_component(b)
    return bytes(((rn & 0x0F), ((gn & 0x0F) << 4) | (bn & 0x0F)))


def rgb444_linear(rgb: tuple[int, int, int]) -> bytes:
    """``getColorDataWithColor``: 2 bytes, plain ``v // 16`` per channel (NOT the curve
    above). Used for the single solid colour fields on clock/date/time-count/scoreboard/
    temperature/humidity content (hour colour, minute colour, score colour, ...) — a
    genuinely different quantisation from pixel data, preserved as a distinct function so
    the two are never accidentally interchanged.
    """
    r, g, b = rgb
    rn, gn, bn = (r // 16) & 0x0F, (g // 16) & 0x0F, (b // 16) & 0x0F
    return bytes((rn, (gn << 4) | bn))


def rgb444_expand(nibble: int) -> int:
    """Inverse of a single RGB444 nibble for 0..255 previews: ``n | (n<<4)`` (``n*17``)
    spreads 0..15 evenly across 0..255. Preview-only — never sent over the wire.
    """
    n = nibble & 0x0F
    return n | (n << 4)
