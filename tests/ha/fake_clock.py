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

It also keeps the clock's own reminder slots: a type-14 program upload (start frame trailer `05 <id>`) is
collected chunk by chunk, checked (LZSS, CRC, length) and parsed into a stored reminder like the firmware
would keep it, `1a 01` / `1a 02 <id>` answer from what is stored and `1a 03 <id>` deletes. Seed one with
`add_reminder` (a reminder made in the vendor app), and script failures with `reminder_delete_results`,
`reminder_start_ack_opcode`, `start_ack_result` and `chunk_ack_result(s)`.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from homeassistant.components.bluetooth import SOURCE_LOCAL, BluetoothServiceInfoBleak

from custom_components.iledclock.const import BLE_CHAR_UUID, BLE_LOCAL_NAME, BLE_SERVICE_UUID
from custom_components.iledclock.protocol import framing, responses
from custom_components.iledclock.protocol.crc import crc_code

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

#: Reminder list / detail / delete (`1a 01` / `1a 02 <id>` / `1a 03 <id>`).
OPCODE_REMINDER = 0x1A
#: Offset of the start frame's trailer (unframed payload: 02, crc 4, length 4, index, count, 00, 8 zeros).
_START_TRAILER = 20
_REMINDER_TRAILER_KIND = 0x05


def lzss_decompress(data: bytes) -> bytes:
    """Undo `protocol.lzss.compress` (the vendor's Okumura LZSS: 512-byte ring primed with zeros, 18-byte
    matches, threshold 2, flag byte LSB first with 1 = literal). The integration never decodes -- the firmware
    does -- so the fake clock brings its own."""
    ring_size, ring_start, threshold = 512, 512 - 18, 2
    ring = bytearray(ring_size)
    position, out, index, flags = ring_start, bytearray(), 0, 0
    while index < len(data):
        flags >>= 1
        if not flags & 0x100:
            flags = data[index] | 0xFF00
            index += 1
            if index >= len(data):
                break
        if flags & 1:
            byte = data[index]
            index += 1
            out.append(byte)
            ring[position] = byte
            position = (position + 1) & (ring_size - 1)
        else:
            if index + 1 >= len(data):
                break
            low, high = data[index], data[index + 1]
            index += 2
            source = low | ((high & 0xF0) << 4)
            for step in range((high & 0x0F) + threshold + 1):
                byte = ring[(source + step) & (ring_size - 1)]
                out.append(byte)
                ring[position] = byte
                position = (position + 1) & (ring_size - 1)
    return bytes(out)


@dataclass
class StoredReminder:
    """One reminder as the clock keeps it, in the fields `1a 02` reports (`year` is the clock's own year - 2000)."""

    id: int
    title: str
    year: int
    month: int
    day: int
    hour: int
    minute: int
    repeat_type: int = 0
    week_mask: int = 0
    duration: int = 30
    sound: int = 1
    #: Tag byte of every content that followed the reminder header in the uploaded program (art), in order.
    attachment_tags: list[int] = field(default_factory=list)

    def detail_payload(self) -> bytes:
        """The `1a 02` reply: id, sound, YY, MM, DD, hh, mm, repeat type, week mask, duration (2), title length, title."""
        title = self.title.encode("utf-8")
        return (
            bytes((OPCODE_REMINDER, 0x02, self.id, self.sound, self.year, self.month, self.day, self.hour,
                   self.minute, self.repeat_type, self.week_mask))
            + self.duration.to_bytes(2, "big") + bytes((len(title),)) + title
        )


def parse_reminder_blob(reminder_id: int, blob: bytes) -> StoredReminder:
    """Read an uploaded type-14 program blob (`00 x8, content count, 00, contents...`): the first content is the
    reminder header (`u32 length, 13, 8 zeros, sound, YY, MM, DD, hh, mm, repeat, mask, duration u16, title
    length, title`), the rest is art whose tags are kept."""
    contents: list[tuple[int, bytes]] = []
    offset = 10
    while offset + 4 <= len(blob):
        length = int.from_bytes(blob[offset : offset + 4], "big")
        if length < 5:
            raise ValueError(f"bad content length {length} at {offset}")
        contents.append((blob[offset + 4], blob[offset + 4 : offset + length]))
        offset += length
    if not contents or contents[0][0] != 0x13:
        raise ValueError("a reminder program must start with the reminder header (tag 13)")
    body = contents[0][1]
    title_length = body[19]
    return StoredReminder(
        id=reminder_id,
        title=body[20 : 20 + title_length].decode("utf-8", errors="replace"),
        year=body[10], month=body[11], day=body[12], hour=body[13], minute=body[14],
        repeat_type=body[15], week_mask=body[16], duration=int.from_bytes(body[17:19], "big"), sound=body[9],
        attachment_tags=[tag for tag, _ in contents[1:]],
    )


@dataclass
class _ReminderUpload:
    """A reminder program being uploaded: what its start frame promised and the compressed pieces so far."""

    id: int
    crc: bytes
    length: int
    pieces: dict[int, bytes] = field(default_factory=dict)


def _start_frame_reminder_id(payload: bytes) -> int | None:
    """The reminder id of a start frame whose trailer is `05 <id>`; None for every other kind of upload."""
    if len(payload) == _START_TRAILER + 2 and payload[_START_TRAILER] == _REMINDER_TRAILER_KIND:
        return payload[_START_TRAILER + 1]
    return None


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
        #: Reminders: which opcode a start ack is spelled with (`02 <result>`, or the vendor's other spelling
        #: `1a <result>`, DeviceManager.java:4425-4476), and `1a 03 <id>` results per id (0 = deleted, anything
        #: else refuses and leaves the reminder in its slot). `start_ack_result` / `chunk_ack_result(s)` apply
        #: to reminder uploads too.
        self.reminder_start_ack_opcode = OPCODE_PROGRAM_START
        self.reminder_delete_results: dict[int, int] = {}
        #: The clock's reminder slots by id: what `1a 01` lists and `1a 02 <id>` reports.
        self.reminders: dict[int, StoredReminder] = {}
        self._reminder_upload: _ReminderUpload | None = None
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
            reminder_id = _start_frame_reminder_id(payload)
            self._reminder_upload = (
                _ReminderUpload(reminder_id, crc=payload[1:5], length=int.from_bytes(payload[5:9], "big"))
                if reminder_id is not None
                else None
            )
            ack_opcode = OPCODE_PROGRAM_START if reminder_id is None else self.reminder_start_ack_opcode
            return bytes((ack_opcode, self.start_ack_result))
        if opcode == OPCODE_PROGRAM_CHUNK:
            # `_chunk()`'s layout: [opcode, 0x00, total_len(4), index(2), chunk_len(2), data, xor]
            index = int.from_bytes(payload[6:8], "big")
            result = self.chunk_ack_results.get(index, self.chunk_ack_result)
            if result == 0:
                result = self._take_reminder_chunk(payload, index)
            return (
                bytes((OPCODE_PROGRAM_CHUNK, 0x00)) + index.to_bytes(2, "big") + bytes((result,))
            )
        key = responses.response_key(payload)
        if key in self.silent_keys:
            return None
        if key in self.reply_overrides:
            return self.reply_overrides[key]
        if opcode == OPCODE_REMINDER:
            reply = self._reminder_reply(payload)
            if reply is not None:
                return reply
        if key in LIVE_REPLIES:
            return LIVE_REPLIES[key]
        return _generic_ack(key)

    # -- the clock's reminder slots ----------------------------------------------------------

    def add_reminder(
        self,
        reminder_id: int,
        title: str,
        *,
        year: int = 26,
        month: int = 1,
        day: int = 1,
        hour: int = 0,
        minute: int = 0,
        repeat_type: int = 0,
        week_mask: int = 0,
        duration: int = 30,
        sound: int = 1,
    ) -> StoredReminder:
        """Put a reminder in a slot as if it had been made in the vendor app (`year` is the clock's own 2-digit year)."""
        stored = StoredReminder(
            reminder_id, title, year, month, day, hour, minute, repeat_type, week_mask, duration, sound
        )
        self.reminders[reminder_id] = stored
        return stored

    def _take_reminder_chunk(self, payload: bytes, index: int) -> int:
        """Collect one accepted data chunk of a reminder upload. Once every piece is in, the firmware's own checks
        run: the decompressed program must have the length and CRC the start frame announced (else data error 3,
        and the upload stays open for the client's retry); then it is stored in the slot."""
        upload = self._reminder_upload
        if upload is None:
            return 0
        total = int.from_bytes(payload[2:6], "big")
        size = int.from_bytes(payload[8:10], "big")
        upload.pieces[index] = payload[10 : 10 + size]
        if sum(len(piece) for piece in upload.pieces.values()) < total:
            return 0
        blob = lzss_decompress(b"".join(upload.pieces[position] for position in sorted(upload.pieces)))
        if len(blob) != upload.length or crc_code(blob) != upload.crc:
            return 3
        self.reminders[upload.id] = parse_reminder_blob(upload.id, blob)
        self._reminder_upload = None
        return 0

    def _reminder_reply(self, payload: bytes) -> bytes | None:
        sub = payload[1] if len(payload) > 1 else None
        if sub == 0x01:
            ids = sorted(self.reminders)
            return bytes((OPCODE_REMINDER, 0x01, len(ids))) + bytes(ids)
        if sub == 0x02 and len(payload) >= 3:
            stored = self.reminders.get(payload[2])
            if stored is None:  # a slot nobody uses reads back as all zeros
                return bytes((OPCODE_REMINDER, 0x02, payload[2])) + bytes(11)
            return stored.detail_payload()
        if sub == 0x03 and len(payload) >= 3:
            status = self.reminder_delete_results.get(payload[2], 0)
            if status == 0:
                self.reminders.pop(payload[2], None)
            return bytes((OPCODE_REMINDER, 0x03, status))
        return None

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
