"""BLE transport for one iLedClock (Contract B).

Owns the whole GATT connection lifecycle: connect-on-demand, one `asyncio.Lock` serialising
every request -- a whole multi-chunk upload included -- so nothing ever interleaves two logical
operations on the wire, idle-disconnect a configurable number of seconds after the last
operation (or never, for `idle_timeout == 0`), and errors that say what actually went wrong
instead of the caller getting back something that merely looks like success.

Deliberately generic: this module knows nothing about *which* command it is sending. Every
caller (coordinator.py, services.py) builds an unframed payload with `protocol.commands.*` and
hands it to `async_request`; this module owns framing, chunked writes, notification
reassembly/correlation, retries and the connection state machine only.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from bleak import BleakClient
from bleak.exc import BleakError
from bleak_retry_connector import BleakClientWithServiceCache, establish_connection
from homeassistant.components import bluetooth
from homeassistant.core import HomeAssistant, callback as ha_callback
from homeassistant.helpers.event import async_call_later

from .chunking import chunk_bytes, chunk_size_for_mtu
from .const import (
    BLE_CHAR_UUID,
    CONNECT_STEP_TIMEOUT_S,
    NOTIFY_BACKEND_TIMEOUT_S,
    REQUEST_TIMEOUT_S,
    UPLOAD_CHUNK_RETRIES,
    UPLOAD_PACKAGE_SIZE,
    WRITE_CHUNK_SPACING_S,
)
from . import shutdown
from .protocol import commands, framing, responses
from .protocol.framing import FrameAssembler
from .protocol.programs import Program, UploadPlan, plan_upload
from .protocol.responses import PasswordResult, ProgramChunkAck, ProgramStartAck, Response

_LOGGER = logging.getLogger(__name__)

#: `(state, program_index, program_count, chunk_index, chunk_count) -> None`. `state` is one of
#: "start"/"chunk"/"done"/"error" (ws_shapes.shape_upload_progress's vocabulary).
UploadProgressCallback = Callable[[str, int, int, int, int], None]


class IledClockError(Exception):
    """Base error for anything this client could not honestly complete."""


class IledClockConnectionError(IledClockError):
    """Could not establish, or lost, the BLE link."""


class IledClockShuttingDownError(IledClockConnectionError):
    """Home Assistant is shutting down: no new link is opened. Not a fault of the clock."""


class IledClockTimeoutError(IledClockError):
    """A request was sent but no matching reply arrived in time."""


class IledClockAuthError(IledClockError):
    """The stored password did not check out against the device."""


class IledClockProtocolError(IledClockError):
    """The device replied, but reported a non-zero error result for the operation (a chunk it
    rejected, a start frame it refused, ...) -- not silence, an actual negative acknowledgement."""


class IledClockClient:
    """One instance per config entry / per physical clock."""

    def __init__(self, hass: HomeAssistant, address: str, password: str) -> None:
        self._hass = hass
        self._address = address
        self._password = password
        self._lock = asyncio.Lock()
        self._client: BleakClient | None = None
        self._assembler = FrameAssembler()
        self._pending: dict[tuple[int, int | None], asyncio.Future[Response]] = {}
        self._pending_chunks: dict[int, asyncio.Future[ProgramChunkAck]] = {}
        self._cancel_idle_disconnect: Callable[[], None] | None = None
        self._idle_timeout: float = 60.0
        #: Set once, by `async_release_for_shutdown`, and never cleared: from then on this
        #: process must not open another GATT link (Home Assistant is going down).
        self._closing = False

    @property
    def address(self) -> str:
        return self._address

    @property
    def is_connected(self) -> bool:
        return self._client is not None and self._client.is_connected

    def set_idle_timeout(self, seconds: float) -> None:
        """0 means "keep connected"; see `_schedule_idle_disconnect`."""
        self._idle_timeout = seconds

    def set_password(self, password: str) -> None:
        self._password = password

    # -- Public API ---------------------------------------------------------------------

    async def async_connect(self) -> None:
        """Ensure a connected, authenticated link. Safe to call when already connected; a
        no-op reconnect otherwise resets the idle-disconnect timer."""
        async with self._lock:
            await self._async_ensure_connected_locked()
            self._schedule_idle_disconnect()

    async def async_request(self, payload: bytes, *, timeout: float = REQUEST_TIMEOUT_S) -> Response:
        """Send one unframed command payload (as built by `protocol.commands`) and return its
        parsed response. Connects first if needed."""
        async with self._lock:
            await self._async_ensure_connected_locked()
            try:
                return await self._async_request_locked(payload, timeout=timeout)
            finally:
                self._schedule_idle_disconnect()

    async def async_upload(
        self,
        programs: list[Program],
        *,
        on_progress: UploadProgressCallback | None = None,
    ) -> None:
        """Upload `programs` as the device's whole active program list, one at a time.
        Start result 0 sends acknowledged chunks; result 1 completes from the device's cached
        program without chunks. Individual requests are retried up to `UPLOAD_CHUNK_RETRIES` times."""
        async with self._lock:
            await self._async_ensure_connected_locked()
            total = len(programs)
            try:
                for index, program in enumerate(programs):
                    # LZSS in pure Python: a smoothed animation can take a second or more, so not on the loop.
                    plan = await self._hass.async_add_executor_job(
                        plan_upload, program, index, total, UPLOAD_PACKAGE_SIZE
                    )
                    await self._async_upload_program_locked(plan, index, total, on_progress)
            except IledClockError:
                if on_progress is not None:
                    on_progress("error", 0, total, 0, 0)
                raise
            finally:
                self._schedule_idle_disconnect()

    async def async_upload_reminder(
        self,
        program: Program,
        *,
        on_progress: UploadProgressCallback | None = None,
    ) -> bool:
        """Upload ONE reminder program (type 14) into the clock's own reminder store: exactly one
        start frame (index 0, count 1; its trailer `05 <id>` comes from `plan_upload`), then the
        acknowledged chunks. Returns True when chunks were sent and False when the start ack was
        1 ("the clock already has exactly this"). Same retry policy as `async_upload`."""
        async with self._lock:
            await self._async_ensure_connected_locked()
            try:
                plan = await self._hass.async_add_executor_job(
                    plan_upload, program, 0, 1, UPLOAD_PACKAGE_SIZE
                )
                return await self._async_upload_program_locked(plan, 0, 1, on_progress)
            except IledClockError:
                if on_progress is not None:
                    on_progress("error", 0, 1, 0, 0)
                raise
            finally:
                self._schedule_idle_disconnect()

    async def async_send_oneway(self, payload: bytes) -> None:
        """Send one unframed command payload that the clock never answers (`commands.screen_toggle`).
        Connects first if needed, writes the framed payload once and returns: no reply is awaited,
        nothing is left pending, and there is NO retry, because the commands this is for are
        toggles and a repeat would undo the first. Failures raise an `IledClockError`."""
        async with self._lock:
            await self._async_ensure_connected_locked()
            try:
                await self._async_write_payload_locked(payload)
            finally:
                self._schedule_idle_disconnect()

    async def async_release(self) -> None:
        """`iledclock.release_link`: disconnect now. Safe to call when already disconnected."""
        async with self._lock:
            await self._async_disconnect_locked()

    async def async_release_for_shutdown(self) -> None:
        """Home Assistant is stopping: latch the client closed, then drop any open link.

        The latch comes first, so nothing (a refresh, a command, the daily time sync) can open a
        new link afterwards -- `_async_ensure_connected_locked` refuses. The open link is then
        dropped WITHOUT waiting for the request lock, so a half-finished upload cannot hold the
        release hostage; the lock is taken afterwards only to let an in-flight connect notice
        the latch and undo itself. Unlike `async_release`, this is one-way. Callers bound it."""
        self._closing = True
        self._cancel_scheduled_idle_disconnect()
        client, self._client = self._client, None
        self._fail_all_pending(self._link_error("shutting down"))
        if client is not None and client.is_connected:
            await self._async_disconnect_client(client, CONNECT_STEP_TIMEOUT_S)
        async with self._lock:
            await self._async_disconnect_locked()

    # -- Connection lifecycle -------------------------------------------------------------

    @property
    def _is_closing(self) -> bool:
        return self._closing or shutdown.in_progress(self._hass)

    @property
    def is_closing(self) -> bool:
        """True once Home Assistant's shutdown has latched this client (or the whole integration)."""
        return self._is_closing

    def _link_error(self, message: str) -> IledClockConnectionError:
        """The error for a link that is gone. Once shutdown has latched, the link was dropped on
        purpose by the release, so it is `IledClockShuttingDownError` (never counted as a fault)."""
        if self._is_closing:
            return IledClockShuttingDownError(f"iLedClock {self._address}: {message} (Home Assistant is shutting down)")
        return IledClockConnectionError(message)

    async def _async_ensure_connected_locked(self) -> None:
        if self._is_closing:
            raise IledClockShuttingDownError(
                f"iLedClock {self._address}: Home Assistant is shutting down; not connecting"
            )
        if self.is_connected:
            return

        ble_device = bluetooth.async_ble_device_from_address(
            self._hass, self._address, connectable=True
        )
        if ble_device is None:
            raise IledClockConnectionError(
                f"iLedClock {self._address} is not currently visible to any Bluetooth "
                "adapter or proxy"
            )

        try:
            async with asyncio.timeout(CONNECT_STEP_TIMEOUT_S):
                client = await establish_connection(
                    BleakClientWithServiceCache,
                    ble_device,
                    ble_device.name or self._address,
                    disconnected_callback=self._on_disconnected,
                )
        except (BleakError, TimeoutError, asyncio.TimeoutError) as err:
            raise IledClockConnectionError(
                f"could not connect to {self._address}: {err or 'timed out'}"
            ) from err

        if self._is_closing:
            # Shutdown began while the connect was in flight: hand the link straight back.
            try:
                await self._async_disconnect_client(client, CONNECT_STEP_TIMEOUT_S)
            except Exception as err:  # noqa: BLE001 - best effort, we are shutting down
                _LOGGER.debug("iLedClock %s: disconnect raised %s", self._address, err)
            raise IledClockShuttingDownError(
                f"iLedClock {self._address}: Home Assistant is shutting down; not connecting"
            )

        self._client = client
        self._assembler = FrameAssembler()

        try:
            async with asyncio.timeout(CONNECT_STEP_TIMEOUT_S):
                # The backend's own `timeout` bounds each proxy round-trip and runs its error path, which
                # unregisters the notification handler; cancelling the call from outside would leave it
                # registered on the proxy connection. The outer guard is only a safety net.
                await client.start_notify(BLE_CHAR_UUID, self._on_notify, timeout=NOTIFY_BACKEND_TIMEOUT_S)
        except (BleakError, TimeoutError) as err:
            await self._async_disconnect_locked()
            raise self._link_error(f"could not enable notifications: {err or 'timed out'}") from err

        try:
            result = await self._async_request_locked(commands.check_password(self._password))
        except IledClockError:
            await self._async_disconnect_locked()
            raise

        if isinstance(result, PasswordResult) and not result.ok:
            await self._async_disconnect_locked()
            raise IledClockAuthError(f"iLedClock {self._address} rejected the stored password")

    def _on_disconnected(self, _client: BleakClient) -> None:
        _LOGGER.debug("iLedClock %s disconnected", self._address)
        self._client = None
        self._fail_all_pending(self._link_error("disconnected"))

    def _fail_all_pending(self, error: Exception) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(error)
        self._pending.clear()
        for future in self._pending_chunks.values():
            if not future.done():
                future.set_exception(error)
        self._pending_chunks.clear()

    async def _async_disconnect_locked(self) -> None:
        self._cancel_scheduled_idle_disconnect()
        client, self._client = self._client, None
        self._fail_all_pending(self._link_error("disconnected"))
        if client is not None and client.is_connected:
            try:
                await self._async_disconnect_client(client, CONNECT_STEP_TIMEOUT_S)
            except (BleakError, TimeoutError) as err:
                _LOGGER.debug("iLedClock %s: disconnect raised %s", self._address, err)

    async def _async_disconnect_client(self, client: BleakClient, wait_s: float) -> None:
        """Drop `client`'s link, waiting at most `wait_s` for the proxy to confirm. The disconnect itself runs
        as a task of its own, so neither the step limit nor a cancelled caller (the shutdown job's 8 s bound,
        an unloading entry) abandons it half-way: it finishes in the background and its outcome is only
        logged. A confirmed failure still raises."""
        task = self._hass.async_create_background_task(client.disconnect(), f"iledclock disconnect {self._address}")
        done, _pending = await asyncio.wait({task}, timeout=wait_s)
        if not done:
            task.add_done_callback(lambda t: t.cancelled() or t.exception())  # keep the outcome from being logged unretrieved
            raise TimeoutError(f"disconnect did not finish within {wait_s:.0f} s")
        task.result()

    # -- Notifications --------------------------------------------------------------------

    def _on_notify(self, _characteristic: Any, data: bytearray) -> None:
        for payload in self._assembler.feed(bytes(data)):
            self._dispatch(payload)

    def _dispatch(self, payload: bytes) -> None:
        try:
            response = responses.parse(payload)
        except Exception:  # noqa: BLE001 - a malformed frame must never crash the notify path
            _LOGGER.debug(
                "iLedClock %s: unparseable notification %s", self._address, payload.hex()
            )
            return

        if isinstance(response, ProgramChunkAck):
            future = self._pending_chunks.get(response.index)
            if future is not None and not future.done():
                future.set_result(response)
            else:
                _LOGGER.debug(
                    "iLedClock %s: unsolicited chunk ack index=%s", self._address, response.index
                )
            return

        key = responses.response_key(payload)
        future = self._pending.get(key)
        if future is None and isinstance(response, ProgramStartAck) and payload[0] == 0x1A:
            # The vendor accepts opcode 02 or 1a for a program start ack
            # (DeviceManager.java:4425-4476); a reminder start can be answered with `1a xx`.
            future = self._pending.get((0x02, None))
        if future is not None and not future.done():
            future.set_result(response)
            return
        _LOGGER.debug("iLedClock %s: unsolicited notification %s", self._address, response)

    # -- Wire I/O -----------------------------------------------------------------------

    async def _async_write_payload_locked(self, payload: bytes) -> None:
        """Frame `payload` once, then split the framed bytes into GATT-write-sized pieces
        (Contract B: `min(mtu_size-3, 180)`, 15ms apart) -- the firmware reassembles the frame
        from the raw byte stream the same way `FrameAssembler` does for notifications, so it
        does not matter that one logical frame spans several separate writes.

        A link that is gone (dropped between two writes of an upload, say) or a failed GATT
        write raises `IledClockConnectionError`, never a bare assertion or Bleak error."""
        if self._client is None or not self._client.is_connected:
            raise self._link_error(f"iLedClock {self._address} disconnected")
        frame = framing.encode_frame(payload)
        size = chunk_size_for_mtu(self._client.mtu_size)
        for chunk in chunk_bytes(frame, size):
            client = self._client
            if client is None or not client.is_connected:
                raise self._link_error(f"iLedClock {self._address} disconnected")
            try:
                await client.write_gatt_char(BLE_CHAR_UUID, chunk, response=False)
            except (BleakError, OSError) as err:
                raise self._link_error(f"could not write to {self._address}: {err}") from err
            await asyncio.sleep(WRITE_CHUNK_SPACING_S)

    async def _async_request_locked(
        self, payload: bytes, *, timeout: float = REQUEST_TIMEOUT_S
    ) -> Response:
        key = responses.response_key(payload)
        future: asyncio.Future[Response] = asyncio.get_running_loop().create_future()
        self._pending[key] = future
        try:
            await self._async_write_payload_locked(payload)
            try:
                return await asyncio.wait_for(future, timeout)
            except asyncio.TimeoutError as err:
                raise IledClockTimeoutError(
                    f"iLedClock {self._address} did not answer opcode {key} within {timeout}s"
                ) from err
        finally:
            self._pending.pop(key, None)

    async def _async_send_chunk_locked(
        self, payload: bytes, chunk_index: int, *, timeout: float = REQUEST_TIMEOUT_S
    ) -> ProgramChunkAck:
        future: asyncio.Future[ProgramChunkAck] = asyncio.get_running_loop().create_future()
        self._pending_chunks[chunk_index] = future
        try:
            await self._async_write_payload_locked(payload)
            try:
                ack = await asyncio.wait_for(future, timeout)
            except asyncio.TimeoutError as err:
                raise IledClockTimeoutError(
                    f"iLedClock {self._address} did not ack upload chunk {chunk_index} "
                    f"within {timeout}s"
                ) from err
        finally:
            self._pending_chunks.pop(chunk_index, None)
        # result: 0=success, 1=send error (retry), 2=device error, 3=data error, other=unknown.
        # Any non-zero is a negative acknowledgement, not silence -- the whole point of
        # `_async_retry_locked` wrapping this call is to retry exactly this case too.
        if ack.result != 0:
            raise IledClockProtocolError(
                f"iLedClock {self._address} reported error {ack.result} for upload chunk {chunk_index}"
            )
        return ack

    async def _async_send_start_locked(self, payload: bytes) -> ProgramStartAck:
        response = await self._async_request_locked(payload)
        # The vendor uses start result 1 as a cache hit: the device already has this
        # program, so the transfer is complete without any data chunks.
        if isinstance(response, ProgramStartAck) and response.result not in (0, 1):
            raise IledClockProtocolError(
                f"iLedClock {self._address} reported error {response.result} for program start"
            )
        return response

    # -- Upload -------------------------------------------------------------------------

    async def _async_upload_program_locked(
        self,
        plan: UploadPlan,
        program_index: int,
        program_count: int,
        on_progress: UploadProgressCallback | None,
    ) -> bool:
        """Upload one planned program. Returns True when chunks were sent, False when the
        start ack said the clock already has it (result 1)."""
        chunk_count = len(plan.chunks)
        if on_progress is not None:
            on_progress("start", program_index, program_count, 0, chunk_count)

        start_ack = await self._async_retry_locked(
            lambda: self._async_send_start_locked(plan.start),
            description=f"program {program_index} start",
        )
        if isinstance(start_ack, ProgramStartAck) and start_ack.result == 1:
            _LOGGER.debug(
                "iLedClock upload: program %s is already present; skipping %s chunks",
                program_index,
                chunk_count,
            )
            if on_progress is not None:
                on_progress("done", program_index, program_count, chunk_count, chunk_count)
            return False

        for chunk_index, chunk_payload in enumerate(plan.chunks):
            await self._async_retry_locked(
                lambda payload=chunk_payload, idx=chunk_index: self._async_send_chunk_locked(
                    payload, idx
                ),
                description=f"program {program_index} chunk {chunk_index}",
            )
            if on_progress is not None:
                on_progress("chunk", program_index, program_count, chunk_index + 1, chunk_count)

        if on_progress is not None:
            on_progress("done", program_index, program_count, chunk_count, chunk_count)
        return True

    @staticmethod
    async def _async_retry_locked(
        attempt: Callable[[], Any], *, description: str, retries: int = UPLOAD_CHUNK_RETRIES
    ) -> Any:
        last_error: Exception | None = None
        for attempt_number in range(1, retries + 1):
            try:
                return await attempt()
            except IledClockConnectionError:
                # The link is gone: retrying on it can only fail again, and reporting that as
                # "not acknowledged" would hide the real cause.
                raise
            except IledClockError as err:
                last_error = err
                _LOGGER.debug(
                    "iLedClock upload: %s failed (attempt %s/%s): %s",
                    description, attempt_number, retries, err,
                )
        raise IledClockTimeoutError(
            f"{description} was not acknowledged after {retries} attempts"
        ) from last_error

    # -- Idle disconnect ------------------------------------------------------------------

    def _schedule_idle_disconnect(self) -> None:
        self._cancel_scheduled_idle_disconnect()
        if self._idle_timeout <= 0 or self._is_closing:
            return  # 0 == keep connected indefinitely (Contract B); closing == already released
        self._cancel_idle_disconnect = async_call_later(
            self._hass, self._idle_timeout, self._async_on_idle_timeout
        )

    def _cancel_scheduled_idle_disconnect(self) -> None:
        if self._cancel_idle_disconnect is not None:
            self._cancel_idle_disconnect()
            self._cancel_idle_disconnect = None

    @ha_callback
    def _async_on_idle_timeout(self, _now: Any) -> None:
        self._cancel_idle_disconnect = None
        self._hass.async_create_task(self._async_idle_disconnect())

    async def _async_idle_disconnect(self) -> None:
        async with self._lock:
            await self._async_disconnect_locked()
