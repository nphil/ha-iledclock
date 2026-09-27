"""Coordinator for one iLedClock (Contract B).

Owns the `IledClockClient`, the shared `IledClockDesignLibrary` and this entry's own
`IledClockPlaylistStore`, runs the periodic full-state refresh with a
graceful-degradation availability policy, and is where `protocol.responses`' wire-level
dataclasses get adapted into this integration's own `ClockState` (Contract D's wire contract
with the frontend) -- and the reverse, turning playlist items and service calls into
`protocol.commands`/`protocol.programs` calls via `program_builder.py`.

Availability policy: connecting at all is the only thing that can flip a whole cycle to
"failed" (`UpdateFailed`, after `CONSECUTIVE_FAILURES_FOR_UNAVAILABLE` consecutive misses --
Contract B). Once connected, each individual read (night mode, alarms, reminders, ...) is
independently best-effort: a unit that simply doesn't have a temperature sensor, or one flaky
read in an otherwise-healthy cycle, never counts against that budget and never blocks the rest
of the cycle from updating.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any, Mapping

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import aiohttp_client
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_time_change
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .client import IledClockClient, IledClockError
from .const import (
    CONF_IDLE_TIMEOUT,
    CONF_PASSWORD,
    CONF_REFRESH_INTERVAL,
    CONF_TIME_SYNC,
    CONSECUTIVE_FAILURES_FOR_UNAVAILABLE,
    DESIGN_MAX_FRAMES,
    DISPLAY_HEIGHT,
    DISPLAY_WIDTH,
    DOMAIN,
    MAX_REMINDERS,
    PLAYLIST_KINDS,
    TIME_SYNC_HOUR,
    TIME_SYNC_MINUTE,
    upload_progress_signal,
)
from .designs import Design
from .options import normalize_options, validate_password
from .playlist import PlaylistItem
from .program_builder import (
    ProgramBuildError,
    build_programs,
    design_to_frames,
    frames_to_content,
    power_limit_programs,
    to_device_timing,
)
from .protocol import commands
from .protocol import render as protocol_render
from .protocol.models import AlarmItem, Frame, NightMode, TimerSwitchItem
from .protocol.programs import Program
from .protocol.responses import (
    CountdownStatus,
    DeviceInfo,
    ReminderDetail,
    Response,
    ScoreboardStatus,
    StopwatchStatus,
    TempHumidity,
)
from .state import (
    AlarmState,
    ClockState,
    CountdownState,
    NightModeState,
    ReminderState,
    ScoreboardState,
    StopwatchState,
    TimerSwitchState,
    TomatoState,
    merge_state,
)
from .store import IledClockDesignLibrary, IledClockPlaylistStore, IledClockShowStore, async_get_design_library
from .ws_shapes import shape_upload_progress

_LOGGER = logging.getLogger(__name__)

# Forward reference as a string: this alias is used in type hints throughout the integration
# before `IledClockCoordinator` is defined below. `ConfigEntry.__class_getitem__` happily stores
# a string as its type argument without evaluating it, so this needs no further indirection.
IledClockConfigEntry = ConfigEntry["IledClockCoordinator"]

_DAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

_KIND_PREVIEW_LABEL = {
    "clock": "CLOCK", "date": "DATE", "timer": "TIMER", "scoreboard": "SCORE",
    "temperature": "TEMP", "humidity": "HUMID",
}


def _repeat_from_days(item: AlarmItem | TimerSwitchItem) -> int:
    """Packs an AlarmItem/TimerSwitchItem's 7 `is_<day>_on` booleans (plus `is_never`) into the
    Mon..Sun bitmask `state.py` uses (bit0=Monday..bit6=Sunday; 0 = once/never repeats)."""
    if getattr(item, "is_never", False):
        return 0
    bits = 0
    for index, day in enumerate(_DAY_NAMES):
        if getattr(item, f"is_{day}_on"):
            bits |= 1 << index
    return bits


def _days_from_repeat(repeat: int) -> dict[str, bool]:
    """Inverse of `_repeat_from_days`, for building an `AlarmItem`/`TimerSwitchItem` from a
    service call's `repeat` bitmask."""
    return {f"is_{day}_on": bool(repeat & (1 << index)) for index, day in enumerate(_DAY_NAMES)}


def _unwrap_items(response: Any) -> list:
    """`Alarms`/`TimerSwitches`/`Tomato`/`Reminders` each wrap a plain list of items behind an
    `.items` attribute per the protocol agent's own description -- except the description was
    given inconsistently for `Reminders` (worded as if it might just *be* the list), so this
    tolerates either shape rather than assuming one."""
    items = getattr(response, "items", None)
    return items if items is not None else response


def _device_info_changes(info: DeviceInfo) -> dict[str, Any]:
    return {
        "power": info.is_switch_on_off,
        "brightness": info.brightness,
        "rotate": info.rotate,
        "volume": info.volume,
        "firmware": info.firmware_version,
        "program_slots": info.max_program_number,
        # Inherited vendor decode quirk (confirmed by the protocol agent, not introduced here):
        # `is_remote_enable` mirrors `is_show_device_id`'s raw byte instead of its own under some
        # conditions in the vendor's own parser, which `protocol.responses` replicates faithfully
        # for wire parity. A "remote enable" toggle that appears to read back the wrong value on
        # real hardware is this, not a bug in switch.py.
        "show_device_id": info.is_show_device_id,
        "remote_enable": info.is_remote_enable,
    }


def _night_mode_state(nm: NightMode) -> NightModeState:
    return NightModeState(
        enabled=nm.enabled,
        start_h=nm.start_hour,
        start_m=nm.start_minute,
        end_h=nm.end_hour,
        end_m=nm.end_minute,
        device_off=nm.device_state_enabled,
        brightness=nm.brightness,
        wake_minutes=nm.wake_up_duration,
        voice=nm.voice_control_enabled,
        voice_sensitivity=nm.voice_sensitivity,
    )


def _night_mode_cfg(state: NightModeState, **overrides: Any) -> NightMode:
    base: dict[str, Any] = {
        "enabled": state.enabled,
        "start_hour": state.start_h,
        "start_minute": state.start_m,
        "end_hour": state.end_h,
        "end_minute": state.end_m,
        "device_state_enabled": state.device_off,
        "brightness": state.brightness,
        "wake_up_duration": state.wake_minutes,
        "voice_control_enabled": state.voice,
        "voice_sensitivity": state.voice_sensitivity,
    }
    base.update(overrides)
    return NightMode(**base)


def _alarm_states(items: list[AlarmItem]) -> tuple[AlarmState, ...]:
    return tuple(
        AlarmState(id=i, hour=item.hour, minute=item.minute, enabled=item.enable, repeat=_repeat_from_days(item))
        for i, item in enumerate(items)
    )


def alarm_item_from_service(
    *, hour: int, minute: int, enabled: bool, repeat: int, duration: int = 60, reminder_duration: int = 5
) -> AlarmItem:
    """`is_never` isn't a settable field -- it's a computed property on `AlarmItem` itself
    (`weekday_mask(self) == 0`), so a `repeat` of 0 (no weekday selected) already makes it
    `True` automatically once the weekday booleans below are all `False`."""
    return AlarmItem(
        enable=enabled, hour=hour, minute=minute, duration=duration, reminder_duration=reminder_duration,
        **_days_from_repeat(repeat),
    )


def _timer_switch_states(items: list[TimerSwitchItem]) -> tuple[TimerSwitchState, ...]:
    return tuple(
        TimerSwitchState(
            index=i, hour=item.hour, minute=item.minute, on=item.is_set_device_on,
            enabled=item.enable, repeat=_repeat_from_days(item),
        )
        for i, item in enumerate(items)
    )


def timer_switch_item_from_service(*, hour: int, minute: int, on: bool, enabled: bool, repeat: int) -> TimerSwitchItem:
    """See `alarm_item_from_service`'s docstring: `is_never` is computed, not passed."""
    return TimerSwitchItem(
        enable=enabled, hour=hour, minute=minute, is_set_device_on=on,
        **_days_from_repeat(repeat),
    )


def _reminder_states(details: list[ReminderDetail]) -> tuple[ReminderState, ...]:
    return tuple(
        ReminderState(
            id=d.id, content=d.content, year=d.year, month=d.month, day=d.day,
            hour=d.hour, minute=d.minute, repeat=d.repeat_type,
        )
        for d in details
    )


def _countdown_state(status: CountdownStatus) -> CountdownState:
    return CountdownState(
        hours=status.left_hour, minutes=status.left_minute, seconds=status.left_seconds,
        running=status.running,
    )


def _stopwatch_state(status: StopwatchStatus) -> StopwatchState:
    return StopwatchState(hours=status.hour, minutes=status.minute, seconds=status.seconds, running=status.running)


def _scoreboard_state(status: ScoreboardStatus) -> ScoreboardState:
    return ScoreboardState(
        home=status.host_score, away=status.visit_score, minutes=status.device_minute,
        seconds=status.device_seconds, count_down=status.is_countdown, running=status.running,
    )


class IledClockCoordinator(DataUpdateCoordinator[ClockState]):
    """Keeps one clock's state fresh and is the single place every mutation goes through."""

    def __init__(self, hass: HomeAssistant, entry: IledClockConfigEntry, address: str) -> None:
        options = normalize_options(entry.options)
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} {address}",
            update_interval=timedelta(minutes=options[CONF_REFRESH_INTERVAL]),
        )
        self.entry = entry
        self.client = IledClockClient(hass, address, options[CONF_PASSWORD])
        self.client.set_idle_timeout(options[CONF_IDLE_TIMEOUT])
        self.design_library: IledClockDesignLibrary = async_get_design_library(hass)
        self.playlist_store = IledClockPlaylistStore(hass, entry.entry_id)
        self.show_store = IledClockShowStore(hass, entry.entry_id)
        self._show_lock = asyncio.Lock()
        self._time_sync_enabled: bool = options[CONF_TIME_SYNC]
        self._synced_since_start = False
        self._unsub_daily_sync: Callable[[], None] | None = None

        # "Show" (Contract D `iledclock/show`, and every `show_*` service): a temporary or
        # permanent single-program override that bypasses the stored playlist without
        # overwriting it. `_saved_playlist` is the playlist to restore once a *timed* override
        # (`show_text`'s `duration_s`) expires; `None` means "no override pending restore".
        self._saved_playlist: list[PlaylistItem] | None = None
        self._restore_generation = 0
        self._restore_unsub: Callable[[], None] | None = None
        self.active_item: PlaylistItem | None = None
        self.preview_png: bytes | None = None
        self.preview_approximate = False
        self.busy = False

        self.data = ClockState(address=address)

    @property
    def address(self) -> str:
        return self.client.address

    def apply_options(self, entry: IledClockConfigEntry) -> None:
        """Re-applies options in place -- used only if a future HA version stops reloading the
        entry on options change; `config_flow.py` uses `OptionsFlowWithReload` so a full
        `async_setup_entry` (and thus a fresh coordinator) is the normal path today."""
        options = normalize_options(entry.options)
        self.client.set_idle_timeout(options[CONF_IDLE_TIMEOUT])
        self.client.set_password(options[CONF_PASSWORD])
        self.update_interval = timedelta(minutes=options[CONF_REFRESH_INTERVAL])
        self._time_sync_enabled = options[CONF_TIME_SYNC]

    # -- Lifecycle ------------------------------------------------------------------------

    def async_setup(self) -> None:
        """Call once after construction, before the first refresh."""
        if self._time_sync_enabled:
            self._unsub_daily_sync = async_track_time_change(
                self.hass, self._async_daily_time_sync,
                hour=TIME_SYNC_HOUR, minute=TIME_SYNC_MINUTE, second=0,
            )

    async def async_unload(self) -> None:
        if self._unsub_daily_sync is not None:
            self._unsub_daily_sync()
            self._unsub_daily_sync = None
        self._cancel_pending_restore()
        await self.client.async_release()

    async def _async_daily_time_sync(self, _now: datetime) -> None:
        await self._async_try(commands.sync_time(dt_util.now()), "daily time sync")

    # -- Periodic refresh -------------------------------------------------------------------

    async def _async_try(self, payload: bytes, description: str) -> Response | None:
        try:
            return await self.client.async_request(payload)
        except IledClockError as err:
            _LOGGER.debug("iLedClock %s: %s failed: %s", self.address, description, err)
            return None

    async def _async_update_data(self) -> ClockState:
        base = self.data
        try:
            await self.client.async_connect()
        except IledClockError as err:
            failures = base.consecutive_failures + 1
            if failures >= CONSECUTIVE_FAILURES_FOR_UNAVAILABLE:
                raise UpdateFailed(
                    f"iLedClock {self.address} unreachable after {failures} attempts: {err}"
                ) from err
            _LOGGER.debug(
                "iLedClock %s: refresh %s/%s failed: %s",
                self.address, failures, CONSECUTIVE_FAILURES_FOR_UNAVAILABLE, err,
            )
            return merge_state(base, {"connected": False, "consecutive_failures": failures})

        if self._time_sync_enabled and not self._synced_since_start:
            await self._async_try(commands.sync_time(dt_util.now()), "startup time sync")
            self._synced_since_start = True

        changes = await self._async_fetch_all()
        changes["connected"] = True
        changes["consecutive_failures"] = 0
        changes["last_updated"] = dt_util.utcnow().timestamp()
        return merge_state(base, changes)

    async def _async_fetch_all(self) -> dict[str, Any]:
        changes: dict[str, Any] = {}

        info = await self._async_try(commands.device_info(), "device info")
        if isinstance(info, DeviceInfo):
            changes.update(_device_info_changes(info))

        night_mode = await self._async_try(commands.night_mode_get(), "night mode")
        if isinstance(night_mode, NightMode):
            changes["night_mode"] = _night_mode_state(night_mode)

        alarms = await self._async_try(commands.alarms_get(), "alarms")
        if alarms is not None:
            changes["alarms"] = _alarm_states(_unwrap_items(alarms))

        timer_switches = await self._async_try(commands.timer_switch_get(), "timer switches")
        if timer_switches is not None:
            changes["timer_switches"] = _timer_switch_states(_unwrap_items(timer_switches))

        tomato = await self._async_try(commands.tomato_get(), "tomato")
        if tomato is not None:
            changes["tomato"] = TomatoState(minutes=tuple(_unwrap_items(tomato)))

        reminders = await self._async_fetch_reminders()
        if reminders is not None:
            changes["reminders"] = reminders

        temp_humidity = await self._async_try(commands.temperature_humidity(1), "temperature/humidity")
        # Units without the sensor still answer `19 01`, with all zeros (observed on the live
        # clock, docs/HARDWARE.md section 8). 0 degC at exactly 0 %RH is not a real indoor reading,
        # so an all-zero reply means "no sensor" and no temperature/humidity entities are made.
        if isinstance(temp_humidity, TempHumidity) and (temp_humidity.temperature or temp_humidity.humidity):
            changes["temperature"] = temp_humidity.temperature
            changes["humidity"] = temp_humidity.humidity

        countdown = await self._async_try(commands.countdown_status(), "countdown status")
        if isinstance(countdown, CountdownStatus):
            changes["countdown"] = _countdown_state(countdown)

        stopwatch = await self._async_try(commands.stopwatch_status(), "stopwatch status")
        if isinstance(stopwatch, StopwatchStatus):
            changes["stopwatch"] = _stopwatch_state(stopwatch)

        scoreboard = await self._async_try(commands.scoreboard_status(), "scoreboard status")
        if isinstance(scoreboard, ScoreboardStatus):
            changes["scoreboard"] = _scoreboard_state(scoreboard)

        return changes

    async def _async_fetch_reminders(self) -> tuple[ReminderState, ...] | None:
        ids_response = await self._async_try(commands.reminders_get(), "reminders")
        if ids_response is None:
            return None
        details: list[ReminderDetail] = []
        for reminder_id in list(_unwrap_items(ids_response))[:MAX_REMINDERS]:
            detail = await self._async_try(commands.reminder_detail(reminder_id), f"reminder {reminder_id} detail")
            if isinstance(detail, ReminderDetail):
                details.append(detail)
        return _reminder_states(details)

    # -- Playlist / show / upload -----------------------------------------------------------

    def _designs_by_id(self) -> dict[str, Design]:
        return {design.id: design for design in self.design_library.designs}

    async def async_seed_showing_from_playlist(self) -> None:
        if self.show_store.now_showing is not None or not self.playlist_store.playlist:
            return
        await self._async_record_showing(self._descriptor_for_playlist_item(self.playlist_store.playlist[0]))

    async def async_set_playlist(self, items: list[PlaylistItem]) -> None:
        """`iledclock/playlist/set` and the `set_playlist` service: persist and upload."""
        async with self._show_lock:
            self._cancel_pending_restore()
            self._saved_playlist = None
            await self.playlist_store.async_set_playlist(items)
            await self._async_upload_playlist_locked(items, record_showing=True)

    async def _async_upload_playlist_locked(self, items: list[PlaylistItem], *, record_showing: bool = False) -> None:
        programs = build_programs(items, designs=self._designs_by_id())
        await self._async_upload_programs(programs)
        self.active_item = items[0] if items else None
        await self._async_update_preview_for_item(self.active_item)
        if record_showing and self.active_item is not None:
            await self._async_record_showing(self._descriptor_for_playlist_item(self.active_item))

    async def async_show(self, spec: Mapping[str, Any], *, restore_after_s: float | None = None) -> dict[str, Any]:
        """Serialize each clock show from upload through history update."""
        async with self._show_lock:
            return await self._async_show_locked(spec, restore_after_s=restore_after_s)

    async def _async_show_locked(self, spec: Mapping[str, Any], *, restore_after_s: float | None = None) -> dict[str, Any]:
        """Upload one show item and record it only after the clock accepts the program."""
        show_type = spec.get("type")
        params = {key: value for key, value in spec.items() if key != "type"}
        descriptor_params = dict(params)

        if show_type in PLAYLIST_KINDS:
            item = PlaylistItem(kind=show_type, params=params, duration_s=int(params.pop("duration_s", 10)))
            programs = build_programs([item], designs=self._designs_by_id())
            program = programs[0]
            preview_item: PlaylistItem | None = item
        elif show_type == "image":
            frames = await self.async_render_image(params)
            program = Program(contents=[frames_to_content(frames, still=len(frames) == 1)], show_count=10)
            descriptor_params = {
                "title": params.get("title"),
                "frames": [base64.b64encode(bytes(channel for row in frame.pixels for pixel in row for channel in pixel)).decode("ascii") for frame in frames],
                "delays": [frame.duration_ms for frame in frames],
            }
            preview_item = None
            await self._async_update_preview_from_frames(frames, approximate=False)
        elif show_type == "generative":
            frames = await self.async_render_generative(params)
            program = Program(contents=[frames_to_content(frames, still=False)], show_count=10)
            preview_item = None
            await self._async_update_preview_from_frames(frames, approximate=False)
        else:
            raise ProgramBuildError(f"unsupported show type: {show_type!r}")

        self._cancel_pending_restore()
        if self._saved_playlist is None:
            self._saved_playlist = self.playlist_store.playlist

        await self._async_upload_programs([program])
        if preview_item is not None:
            self.active_item = preview_item
            await self._async_update_preview_for_item(preview_item)

        descriptor = self._descriptor_for_spec(show_type, descriptor_params)
        await self._async_record_showing(descriptor)
        if restore_after_s:
            generation = self._restore_generation

            async def restore_playlist(now: datetime) -> None:
                await self._async_restore_playlist(now, generation)

            self._restore_unsub = async_call_later(self.hass, restore_after_s, restore_playlist)
        return dict(self.show_store.now_showing or descriptor)

    def _descriptor_for_spec(self, kind: str, params: Mapping[str, Any]) -> dict[str, Any]:
        fields = dict(params)
        fields.pop("data_b64", None)
        fields.pop("url", None)
        title = fields.pop("title", None)
        if kind == "design":
            design = self.design_library.get_design(str(fields.get("design_id", "")))
            title = title or (design.name if design else "Unavailable design")
        elif kind == "clock":
            title = title or f"Clock · style {fields.get('style', '?')}"
        elif kind == "text":
            title = title or f"Text · {fields.get('text', '')}"
        elif kind == "timer":
            title = title or "Timer"
        elif kind == "scoreboard":
            title = title or "Scoreboard"
        elif kind == "image":
            title = title or "Image"
        elif kind == "generative":
            title = title or str(fields.get("kind", "Generative")).replace("_", " ").title()
            if "kind" in fields:
                fields["effect"] = fields.pop("kind")
        else:
            title = title or kind.replace("_", " ").title()
        return {"kind": kind, **fields, "title": str(title), "shown_at": dt_util.utcnow().isoformat()}

    def _descriptor_for_playlist_item(self, item: PlaylistItem) -> dict[str, Any]:
        return self._descriptor_for_spec(item.kind, {**dict(item.params), "duration_s": item.duration_s})

    async def _async_record_showing(self, descriptor: dict[str, Any]) -> None:
        await self.show_store.async_record(descriptor)
        self.async_set_updated_data(merge_state(self.data, {
            "now_showing": dict(self.show_store.now_showing or {}),
            "show_history": tuple(dict(item) for item in self.show_store.history),
        }))

    async def async_restore_previous(self) -> dict[str, Any]:
        async with self._show_lock:
            return await self._async_restore_previous_locked()

    async def _async_restore_previous_locked(self) -> dict[str, Any]:
        """Re-show the newest available distinct prior item, marking deleted designs skipped."""
        for descriptor in list(self.show_store.history[1:]):
            if descriptor.get("unavailable"):
                continue
            kind = str(descriptor.get("kind", ""))
            if kind == "design" and self.design_library.get_design(str(descriptor.get("design_id", ""))) is None:
                await self.show_store.async_mark_unavailable(str(descriptor.get("design_id", "")))
                self.async_set_updated_data(merge_state(self.data, {
                    "now_showing": self.show_store.now_showing,
                    "show_history": tuple(dict(item) for item in self.show_store.history),
                }))
                continue
            fields = {key: value for key, value in descriptor.items() if key not in {"kind", "title", "shown_at", "unavailable"}}
            if kind == "generative" and "effect" in fields:
                fields["kind"] = fields.pop("effect")
            return await self._async_show_locked({"type": kind, **fields, "title": descriptor.get("title")})
        raise ValueError("nothing_to_restore")

    async def async_mark_design_deleted(self, design_id: str) -> None:
        """Mark any retained reference so clients and Undo can skip the deleted design."""
        if not any(item.get("kind") == "design" and item.get("design_id") == design_id for item in self.show_store.history):
            return
        await self.show_store.async_mark_unavailable(design_id)
        self.async_set_updated_data(merge_state(self.data, {
            "now_showing": self.show_store.now_showing,
            "show_history": tuple(dict(item) for item in self.show_store.history),
        }))

    async def _async_restore_playlist(self, _now: datetime, generation: int | None = None) -> None:
        async with self._show_lock:
            if generation is not None and generation != self._restore_generation:
                return
            self._restore_unsub = None
            saved, self._saved_playlist = self._saved_playlist, None
            if saved:
                await self._async_upload_playlist_locked(saved, record_showing=True)

    def _cancel_pending_restore(self) -> None:
        self._restore_generation += 1
        if self._restore_unsub is not None:
            self._restore_unsub()
            self._restore_unsub = None

    async def _async_upload_programs(self, programs: list[Program]) -> None:
        programs = to_device_timing(power_limit_programs(programs, self.data.brightness))
        entry_id = self.entry.entry_id
        total = len(programs)

        def on_progress(state: str, program: int, programs_count: int, chunk: int, chunks: int) -> None:
            payload = shape_upload_progress(
                state=state, program=program, programs=programs_count, chunk=chunk, chunks=chunks,
            )
            payload["upload"] = {"done": chunk, "total": chunks} if state in {"start", "chunk", "done"} else None
            async_dispatcher_send(self.hass, upload_progress_signal(entry_id), payload)

        self.busy = True
        failed = False
        try:
            await self.client.async_upload(programs, on_progress=on_progress)
        except IledClockError as err:
            failed = True
            async_dispatcher_send(
                self.hass, upload_progress_signal(entry_id),
                {**shape_upload_progress(state="error", program=0, programs=total, chunk=0, chunks=0, error=str(err)), "upload": None},
            )
            raise
        finally:
            self.busy = False
            async_dispatcher_send(
                self.hass, upload_progress_signal(entry_id),
                {**shape_upload_progress(state="error" if failed else "done", program=total, programs=total, chunk=0, chunks=0), "upload": None},
            )

    # -- Preview (image.<name>_display) ------------------------------------------------------

    async def _async_update_preview_for_item(self, item: PlaylistItem | None) -> None:
        if item is None:
            self.preview_png = None
            self.preview_approximate = False
            self.async_update_listeners()
            return
        try:
            if item.kind == "design":
                design = self.design_library.get_design(item.params.get("design_id", ""))
                if design is None:
                    self.preview_png = None
                    self.preview_approximate = False
                    return
                await self._async_update_preview_from_frames(design_to_frames(design), approximate=False)
                return
            if item.kind == "text":
                frames = await self.hass.async_add_executor_job(
                    protocol_render.text_frames, item.params.get("text", ""),
                    item.params.get("font", "5x7"), (255, 255, 255),
                )
                await self._async_update_preview_from_frames(frames, approximate=False)
                return
            label = _KIND_PREVIEW_LABEL.get(item.kind, item.kind.upper())
            frames = await self.hass.async_add_executor_job(
                protocol_render.text_frames, label, "5x7", (255, 255, 255),
            )
            await self._async_update_preview_from_frames(frames, approximate=True)
        except Exception:  # noqa: BLE001 - a failed preview must never break the real upload
            _LOGGER.debug("iLedClock %s: preview render failed", self.address, exc_info=True)
            self.preview_png = None
            self.preview_approximate = False
        self.async_update_listeners()

    async def _async_update_preview_from_frames(self, frames: list[Frame], *, approximate: bool) -> None:
        try:
            self.preview_png = await self.hass.async_add_executor_job(self._render_preview_png, frames[0])
            self.preview_approximate = approximate
        except Exception:  # noqa: BLE001 - see _async_update_preview_for_item
            _LOGGER.debug("iLedClock %s: preview render failed", self.address, exc_info=True)
            self.preview_png = None
            self.preview_approximate = False
        self.async_update_listeners()

    @staticmethod
    def _render_preview_png(frame: Frame) -> bytes:
        canvas = protocol_render.Canvas()
        canvas.blit(frame.pixels, 0, 0)
        return canvas.to_png(8)

    @staticmethod
    def _frames_from_descriptor(params: Mapping[str, Any]) -> list[Frame]:
        raw_frames = params.get("frames")
        if not isinstance(raw_frames, list) or not raw_frames or len(raw_frames) > DESIGN_MAX_FRAMES:
            raise ProgramBuildError("stored image must contain 1 to 64 rendered frames")
        expected_size = DISPLAY_WIDTH * DISPLAY_HEIGHT * 3
        encoded_size = ((expected_size + 2) // 3) * 4
        raw_delays = params.get("delays")
        delays = raw_delays if isinstance(raw_delays, list) else []
        frames: list[Frame] = []
        for index, encoded in enumerate(raw_frames):
            if not isinstance(encoded, str) or len(encoded) != encoded_size:
                raise ProgramBuildError("stored image frame has an invalid size")
            try:
                pixels = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as err:
                raise ProgramBuildError("stored image frame is invalid") from err
            if len(pixels) != expected_size:
                raise ProgramBuildError("stored image frame has an invalid size")
            rows = [
                [tuple(pixels[offset:offset + 3]) for offset in range(row_start, row_start + DISPLAY_WIDTH * 3, 3)]
                for row_start in range(0, expected_size, DISPLAY_WIDTH * 3)
            ]
            try:
                delay = int(delays[index]) if index < len(delays) else 100
            except (TypeError, ValueError):
                delay = 100
            frames.append(Frame(pixels=rows, duration_ms=max(1, min(60_000, delay))))
        return frames

    async def async_render_image(self, params: Mapping[str, Any]) -> list[Frame]:
        if isinstance(params.get("frames"), list):
            return self._frames_from_descriptor(params)
        if params.get("url"):
            session = aiohttp_client.async_get_clientsession(self.hass)
            async with session.get(params["url"]) as response:
                response.raise_for_status()
                data = await response.read()
        elif params.get("data_b64"):
            data = base64.b64decode(params["data_b64"])
        else:
            raise ProgramBuildError("show_image requires either url or data_b64")
        fit = params.get("fit", "contain")
        dither = bool(params.get("dither", True))
        return await self.hass.async_add_executor_job(
            protocol_render.image_to_frames, data, fit, dither, DESIGN_MAX_FRAMES
        )

    async def async_render_generative(self, params: Mapping[str, Any]) -> list[Frame]:
        kind = params.get("kind", "plasma")
        seconds = int(params.get("seconds", 10))
        seed = params.get("seed")
        palette = params.get("palette")
        return await self.hass.async_add_executor_job(
            protocol_render.generative, kind, seconds, seed, palette
        )

    # -- Simple command-then-refresh mutations ----------------------------------------------

    async def async_set_night_mode_enabled(self, enabled: bool) -> None:
        """switch.py: flip just the enabled flag, keeping every other field as last read."""
        current = self.data.night_mode
        if current is None:
            raise IledClockError("night mode configuration is not known yet; try again shortly")
        await self.client.async_request(commands.night_mode_set(_night_mode_cfg(current, enabled=enabled)))
        await self._async_refresh_night_mode()

    async def async_set_night_mode(self, **fields: Any) -> None:
        """The `night_mode` service: set every field explicitly."""
        await self.client.async_request(commands.night_mode_set(NightMode(**fields)))
        await self._async_refresh_night_mode()

    async def _async_refresh_night_mode(self) -> None:
        response = await self._async_try(commands.night_mode_get(), "night mode")
        if isinstance(response, NightMode):
            self.async_set_updated_data(merge_state(self.data, {"night_mode": _night_mode_state(response)}))

    async def async_set_device_setting(self, kind: int, on: bool) -> None:
        await self.client.async_request(commands.device_setting(kind, on))
        await self._async_refresh_device_info()

    async def _async_refresh_device_info(self) -> None:
        info = await self._async_try(commands.device_info(), "device info")
        if isinstance(info, DeviceInfo):
            self.async_set_updated_data(merge_state(self.data, _device_info_changes(info)))

    async def async_set_alarms(self, alarms: list[AlarmItem]) -> None:
        await self.client.async_request(commands.alarms_set(alarms))
        response = await self._async_try(commands.alarms_get(), "alarms")
        if response is not None:
            self.async_set_updated_data(merge_state(self.data, {"alarms": _alarm_states(_unwrap_items(response))}))

    async def async_set_timer_switches(self, items: list[TimerSwitchItem]) -> None:
        await self.client.async_request(commands.timer_switch_set(items))
        response = await self._async_try(commands.timer_switch_get(), "timer switches")
        if response is not None:
            self.async_set_updated_data(
                merge_state(self.data, {"timer_switches": _timer_switch_states(_unwrap_items(response))})
            )

    async def async_set_pomodoro(self, minutes: list[int]) -> None:
        await self.client.async_request(commands.tomato_set(minutes))
        response = await self._async_try(commands.tomato_get(), "tomato")
        if response is not None:
            self.async_set_updated_data(
                merge_state(self.data, {"tomato": TomatoState(minutes=tuple(_unwrap_items(response)))})
            )

    async def async_reminder_delete(self, reminder_id: int) -> None:
        await self.client.async_request(commands.reminder_delete(reminder_id))
        reminders = await self._async_fetch_reminders()
        if reminders is not None:
            self.async_set_updated_data(merge_state(self.data, {"reminders": reminders}))

    async def async_countdown_reset(self, hour: int, minute: int, second: int) -> None:
        await self.client.async_request(commands.countdown_reset(hour, minute, second))
        await self._async_refresh_countdown()

    async def async_countdown_run(self, start: bool) -> None:
        await self.client.async_request(commands.countdown_run(start))
        await self._async_refresh_countdown()

    async def _async_refresh_countdown(self) -> None:
        status = await self._async_try(commands.countdown_status(), "countdown status")
        if isinstance(status, CountdownStatus):
            self.async_set_updated_data(merge_state(self.data, {"countdown": _countdown_state(status)}))

    async def async_stopwatch_reset(self) -> None:
        await self.client.async_request(commands.stopwatch_reset())
        await self._async_refresh_stopwatch()

    async def async_stopwatch_run(self, start: bool) -> None:
        await self.client.async_request(commands.stopwatch_run(start))
        await self._async_refresh_stopwatch()

    async def _async_refresh_stopwatch(self) -> None:
        status = await self._async_try(commands.stopwatch_status(), "stopwatch status")
        if isinstance(status, StopwatchStatus):
            self.async_set_updated_data(merge_state(self.data, {"stopwatch": _stopwatch_state(status)}))

    async def async_scoreboard_set_score(self, home: int, away: int) -> None:
        # `commands.scoreboard_set_score` also takes running match/series totals distinct from
        # the current score, packed as single wire bytes (0-255) unlike the 2-byte live score;
        # the service/WS surface only exposes the current score (matching docs/FEATURES-app.md's
        # own description), so default each total to its own current score, clamped to what the
        # wire format can hold -- correct for the common single-game case, and always overwritten
        # by the next `scoreboard_status` refresh regardless.
        await self.client.async_request(
            commands.scoreboard_set_score(home, away, min(home, 255), min(away, 255))
        )
        await self._async_refresh_scoreboard()

    async def async_scoreboard_set_time(self, minute: int, second: int, count_down: bool) -> None:
        await self.client.async_request(commands.scoreboard_set_time(minute, second, count_down))
        await self._async_refresh_scoreboard()

    async def async_scoreboard_run(self, start: bool) -> None:
        await self.client.async_request(commands.scoreboard_run(start))
        await self._async_refresh_scoreboard()

    async def _async_refresh_scoreboard(self) -> None:
        status = await self._async_try(commands.scoreboard_status(), "scoreboard status")
        if isinstance(status, ScoreboardStatus):
            self.async_set_updated_data(merge_state(self.data, {"scoreboard": _scoreboard_state(status)}))

    async def async_sync_time(self) -> None:
        await self.client.async_request(commands.sync_time(dt_util.now()))

    async def async_release_link(self) -> None:
        await self.client.async_release()

    async def async_send_raw(self, opcode: int, payload_hex: str, timeout_s: float) -> Response:
        payload = bytes([opcode]) + bytes.fromhex(payload_hex)
        return await self.client.async_request(payload, timeout=timeout_s)

    # -- Simple optimistic local-only settings (light.py: power/brightness/colour/rotate/mirror) -

    async def async_set_power(self, on: bool) -> None:
        await self.client.async_request(commands.power(on))
        self.async_set_updated_data(merge_state(self.data, {"power": on}))

    async def async_set_brightness(self, app_value: int) -> None:
        await self.client.async_request(commands.brightness(app_value))
        self.async_set_updated_data(merge_state(self.data, {"brightness": app_value}))

    async def async_set_color(self, rgb: tuple[int, int, int]) -> None:
        await self.client.async_request(commands.color(rgb))

    async def async_set_color_mode(self, mode: int) -> None:
        await self.client.async_request(commands.color_mode(mode))
        self.async_set_updated_data(merge_state(self.data, {"color_mode": mode}))

    async def async_set_color_speed(self, speed: int) -> None:
        await self.client.async_request(commands.color_speed(speed))
        self.async_set_updated_data(merge_state(self.data, {"color_speed": speed}))

    async def async_set_volume(self, volume: int) -> None:
        await self.client.async_request(commands.volume(volume))
        self.async_set_updated_data(merge_state(self.data, {"volume": volume}))

    async def async_set_rotate(self, mode: int) -> None:
        await self.client.async_request(commands.rotate(mode))
        self.async_set_updated_data(merge_state(self.data, {"rotate": mode}))

    async def async_set_mirror(self, on: bool) -> None:
        await self.client.async_request(commands.mirror(on))
        self.async_set_updated_data(merge_state(self.data, {"mirror": on}))

    async def async_set_clock_face(
        self, style: int, color: int, hours24: bool, show_seconds: bool = False, background: bool = True
    ) -> None:
        await self.async_show(
            {"type": "clock", "style": style, "color": color, "hours24": hours24, "show_seconds": show_seconds,
             "background": background}
        )

    async def async_set_stored_password(self, password: str) -> None:
        """The frontend's `set_password` command: NOT a device mutation -- it re-syncs the
        password this integration authenticates with to match one already changed on the clock
        itself (via the vendor app or physically), per the settings panel's own copy. Validates
        by actually reconnecting with the new password before persisting it, so a typo surfaces
        immediately as an auth error instead of silently locking the integration out."""
        password = validate_password(password)
        self.client.set_password(password)
        await self.client.async_release()
        await self.client.async_connect()
        new_options = dict(self.entry.options)
        new_options[CONF_PASSWORD] = password
        self.hass.config_entries.async_update_entry(self.entry, options=new_options)
