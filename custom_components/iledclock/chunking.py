"""BLE write chunking (Contract B), split out of `client.py` so it is unit-testable without
`bleak`/`homeassistant` installed.
"""

from __future__ import annotations

from .const import MAX_WRITE_CHUNK


def chunk_size_for_mtu(mtu_size: int) -> int:
    """Contract B: `min(client.mtu_size-3, 180)` (app: SplitWriter 180/20). Never returns less
    than 1, however small `mtu_size` reports, so a degenerate MTU can't produce a zero-size
    chunk and loop forever."""
    return max(1, min(mtu_size - 3, MAX_WRITE_CHUNK))


def chunk_bytes(data: bytes, size: int) -> list[bytes]:
    """Split `data` into `size`-byte pieces (the last one possibly shorter). Empty input yields
    no chunks -- there is never a reason to write a zero-length chunk over GATT."""
    if size <= 0:
        raise ValueError("chunk size must be positive")
    return [data[i : i + size] for i in range(0, len(data), size)]
