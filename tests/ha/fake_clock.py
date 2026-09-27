"""A scripted iLedClock on the other end of a fake GATT link (tests/ha only).

Only the device is simulated. Everything the integration itself does above the wire stays
real -- `IledClockClient`'s framing, MTU chunking, request/reply correlation, chunk retries
and idle disconnect, and above it the coordinator, the entity platforms, the websocket API,
the services and the gallery. That is the point of this package: the two bugs this layer was
built to catch (a keyword-only cache call pushed through `async_add_executor_job`, and a
custom websocket field named `id`) are exactly the ones a fake that stopped at the
coordinator boundary would have hidden.

Requests are reassembled with the same `protocol.framing.FrameAssembler` the firmware uses,
answered from the replies recorded from the live clock (`tests/live_replies_2026-09-25.json`),
and every decoded request payload is kept in `written` so a test can assert exactly what the
integration put on the wire.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from homeassistant.components.bluetooth import SOURCE_LOCAL, BluetoothServiceInfoBleak

from custom_components.iledclock.const import BLE_CHAR_UUID, BLE_LOCAL_NAME, BLE_SERVICE_UUID
from custom_components.iledclock.protocol import framing, responses

REPO_ROOT = Path(__file__).resolve().parents[2]
LIVE_REPLIES_PATH = REPO_ROOT / "tests" / "live_replies_2026-09-25.json"

#: An obviously-synthetic address: nothing in this suite may ever reach the real clock
#: (01:00:00:67:0D:8A per docs/ARCHITECTURE.md).
TEST_ADDRESS = "AA:BB:CC:11:22:33"

#: A BLE MTU that negotiates the integration's own 180-byte write cap
#: (`chunking.chunk_size_for_mtu(247) == min(247-3, 180)`).
TEST_MTU_SIZE = 247

#: Opcodes with no recorded reply, answered from the protocol's own documented shapes.
OPCODE_PROGRAM_START = 0x02
OPCODE_PROGRAM_CHUNK = 0x03
OPCODE_CHECK_PASSWORD = 0x0D

#: The live-captured password-check success ack (`0d 00`, recorded during the reverse-engineering
#: sessions; `tests/live_replies_2026-09-25.json` covers the read-only opcodes only).
PASSWORD_OK_FRAME = bytes.fromhex("010002060d0003")
PASSWORD_REJECTED_PAYLOAD = bytes((OPCODE_CHECK_PASSWORD, 0x01))


def _live_reply_table() -> dict[tuple[int, int | None], bytes]:
    """`responses.response_key(request)` -> decoded reply payload, from the live captures."""
    table: dict[tuple[int, int | None], bytes] = {}
    for entry in json.loads(LIVE_REPLIES_PATH.read_text(encoding="utf-8")).values():
        reply_frame = entry.get("reply_frame")
        if reply_frame is None:
            continue  # the live clock never answered this one (e.g. `19 00`)
        request = bytes.fromhex(entry["request_payload"])
        table[responses.response_key(request)] = framing.decode_frame(bytes.fromhex(reply_frame))
    table[responses.response_key(bytes((OPCODE_CHECK_PASSWORD,)))] = framing.decode_frame(
        PASSWORD_OK_FRAME
    )
    return table


#: Every reply the live clock was recorded giving, keyed the way `IledClockClient` correlates
#: a request with its reply.
LIVE_REPLIES = _live_reply_table()


def make_service_info(
    address: str = TEST_ADDRESS,
    *,
    name: str | None = BLE_LOCAL_NAME,
    service_uuids: tuple[str, ...] = (BLE_SERVICE_UUID,),
    rssi: int = -60,
    connectable: bool = True,
    source: str = SOURCE_LOCAL,
) -> BluetoothServiceInfoBleak:
    """A `BluetoothServiceInfoBleak` for `address`, shaped like a real advertisement.

    `source` defaults to HA's own `SOURCE_LOCAL` (a locally-attached adapter); pass a proxy's
    address to look like an ESPHome Bluetooth proxy instead.
    """

    advertisement = AdvertisementData(
        local_name=name,
        manufacturer_data={},
        service_data={},
        service_uuids=list(service_uuids),
        rssi=rssi,
        platform_data=((),),
        tx_power=-127,
    )
    device = BLEDevice(address=address, name=name, details={})
    return BluetoothServiceInfoBleak(
        name=name or address,
        address=address,
        rssi=rssi,
        manufacturer_data={},
        service_data={},
        service_uuids=list(service_uuids),
        source=source if source != "00:00:00:00:00:01" else SOURCE_LOCAL,
        device=device,
        advertisement=advertisement,
        connectable=connectable,
        time=time.monotonic(),
        tx_power=-127,
    )


class FakeClockDevice:
    """The firmware's half of the link: answers writes, records them, and can be told to
    misbehave (refuse a connection, reject the password, stop answering, nack a chunk)."""

    def __init__(
        self,
        address: str = TEST_ADDRESS,
        *,
        name: str = BLE_LOCAL_NAME,
        mtu_size: int = TEST_MTU_SIZE,
        notify_chunk_size: int = 20,
    ) -> None:
        self.address = address
        self.name = name
        self.mtu_size = mtu_size
        #: Replies are pushed to the client in pieces this small, so the integration's own
        #: `FrameAssembler` reassembly is exercised on every single reply, not just big ones.
        self.notify_chunk_size = notify_chunk_size

        # -- what the integration did ------------------------------------------------------
        #: Decoded, unframed request payloads, in wire order.
        self.written: list[bytes] = []
        #: Raw GATT write chunks, in order (one logical frame may span several).
        self.gatt_writes: list[bytes] = []
        self.connections = 0
        self.disconnections = 0
        self.notify_subscriptions: list[str] = []
        self.connected = False

        # -- how it should misbehave -------------------------------------------------------
        #: Raised instead of establishing a link (a `BleakError` in practice).
        self.connect_error: Exception | None = None
        #: `response_key`s to leave unanswered, so the client hits its own request timeout.
        self.silent_keys: set[tuple[int, int | None]] = set()
        #: `response_key` -> decoded reply payload, taking precedence over `LIVE_REPLIES`.
        self.reply_overrides: dict[tuple[int, int | None], bytes] = {}
        #: Start result 0=send chunks, 1=program already present; chunk result 0=accepted.
        self.start_ack_result = 0
        self.chunk_ack_result = 0
        self.chunk_ack_results: dict[int, int] = {}
        #: Disconnect after this many decoded requests (None == never).
        self.disconnect_after_requests: int | None = None

        self._assembler = framing.FrameAssembler()
        self._disconnected_callback: Callable[[Any], None] | None = None
        self._notify_callback: Callable[[str, bytearray], None] | None = None

    # -- advertisement / link --------------------------------------------------------------

    def service_info(self, **kwargs: Any) -> Any:
        """The advertisement HA's real bluetooth manager should be told about."""
        return make_service_info(self.address, name=self.name, **kwargs)

    def new_client(self, disconnected_callback: Callable[[Any], None] | None = None) -> "FakeGattClient":
        """Stand in for `bleak_retry_connector.establish_connection`."""
        if self.connect_error is not None:
            raise self.connect_error
        self.connected = True
        self.connections += 1
        self._disconnected_callback = disconnected_callback
        self._notify_callback = None
        return FakeGattClient(self)

    def mark_disconnected(self) -> None:
        """Drop the link the way the firmware would, notifying the client's own callback."""
        if not self.connected:
            return
        self.connected = False
        self.disconnections += 1
        self._notify_callback = None
        callback, self._disconnected_callback = self._disconnected_callback, None
        if callback is not None:
            callback(None)

    # -- the wire --------------------------------------------------------------------------

    def _on_write(self, data: bytes) -> None:
        self.gatt_writes.append(data)
        for payload in self._assembler.feed(data):
            if not payload:
                continue
            self.written.append(payload)
            reply = self._reply_for(payload)
            if reply is not None:
                self._notify(reply)
            if (
                self.disconnect_after_requests is not None
                and len(self.written) >= self.disconnect_after_requests
            ):
                self.mark_disconnected()
                return

    def _reply_for(self, payload: bytes) -> bytes | None:
        opcode = payload[0]
        if opcode == OPCODE_PROGRAM_START:
            return bytes((OPCODE_PROGRAM_START, self.start_ack_result))
        if opcode == OPCODE_PROGRAM_CHUNK:
            # `_chunk()`'s layout: [opcode, 0x00, total_len(4), index(2), chunk_len(2), data, xor]
            index = int.from_bytes(payload[6:8], "big")
            result = self.chunk_ack_results.get(index, self.chunk_ack_result)
            return (
                bytes((OPCODE_PROGRAM_CHUNK, 0x00)) + index.to_bytes(2, "big") + bytes((result,))
            )
        key = responses.response_key(payload)
        if key in self.silent_keys:
            return None
        if key in self.reply_overrides:
            return self.reply_overrides[key]
        if key in LIVE_REPLIES:
            return LIVE_REPLIES[key]
        return _generic_ack(key)

    def _notify(self, payload: bytes) -> None:
        if self._notify_callback is None:  # pragma: no cover - the client always subscribes first
            raise AssertionError("device replied before notifications were enabled")
        frame = framing.encode_frame(payload)
        size = max(1, self.notify_chunk_size)
        for offset in range(0, len(frame), size):
            self._notify_callback(BLE_CHAR_UUID, bytearray(frame[offset : offset + size]))

    def _set_notify_callback(self, callback: Callable[[str, bytearray], None] | None) -> None:
        self._notify_callback = callback

    # -- assertions ------------------------------------------------------------------------

    def requests(self, opcode: int, sub: int | None = None) -> list[bytes]:
        """Every request written for `(opcode, sub)`; `sub=None` matches the opcode alone."""
        wanted = (opcode, sub)
        return [payload for payload in self.written if responses.response_key(payload) == wanted]

    def last_request(self, opcode: int, sub: int | None = None) -> bytes | None:
        matches = self.requests(opcode, sub)
        return matches[-1] if matches else None

    @property
    def uploads(self) -> list[tuple[bytes, list[bytes]]]:
        """Each upload as `(start_payload, [chunk_payloads])`, in order."""
        uploads: list[tuple[bytes, list[bytes]]] = []
        for payload in self.written:
            opcode = payload[0]
            if opcode == OPCODE_PROGRAM_START:
                uploads.append((payload, []))
            elif opcode == OPCODE_PROGRAM_CHUNK:
                if not uploads:  # pragma: no cover - the client always sends a start first
                    raise AssertionError("chunk written before any program start")
                uploads[-1][1].append(payload)
        return uploads

    def opcodes_written(self) -> list[int]:
        return [payload[0] for payload in self.written]


def _generic_ack(key: tuple[int, int | None]) -> bytes:
    """A well-formed success ack for a write-only opcode: `[opcode, (sub,) status=0]`.

    `protocol.responses.parse` turns this into an `Ack`/`Unknown` with status 0, which is all
    the coordinator's fire-and-forget setters ask of it -- they re-read state separately.
    """
    opcode, sub = key
    return bytes((opcode,)) + (bytes((sub,)) if sub is not None else b"") + b"\x00"


class FakeGattClient:
    """The subset of `BleakClient` that `IledClockClient` touches, nothing more."""

    def __init__(self, device: FakeClockDevice) -> None:
        self._device = device

    @property
    def is_connected(self) -> bool:
        return self._device.connected

    @property
    def mtu_size(self) -> int:
        return self._device.mtu_size

    async def start_notify(
        self, char_specifier: str, callback: Callable[[str, bytearray], None], **kwargs: Any
    ) -> None:
        self._device.notify_subscriptions.append(char_specifier)
        self._device._set_notify_callback(callback)

    async def stop_notify(self, char_specifier: str, **kwargs: Any) -> None:
        self._device._set_notify_callback(None)

    async def write_gatt_char(
        self, char_specifier: str, data: bytes, response: bool = False, **kwargs: Any
    ) -> None:
        self._device._on_write(bytes(data))

    async def disconnect(self, **kwargs: Any) -> None:
        self._device.mark_disconnected()
