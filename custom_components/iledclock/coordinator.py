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
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from functools import partial
from typing import Any, Mapping

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import aiohttp_client
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_time_change
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from . import shutdown
from .client import IledClockClient, IledClockError, IledClockShuttingDownError
from .const import (
    CONF_IDLE_TIMEOUT,
    CONF_LAST_HOLDING_PROXY,
    CONF_PASSWORD,
    CONF_REFRESH_INTERVAL,
    CONF_TIME_SYNC,
    CONSECUTIVE_FAILURES_FOR_UNAVAILABLE,
    DEFAULT_SLOT,
    DESIGN_MAX_FRAMES,
    DISPLAY_HEIGHT,
    DISPLAY_WIDTH,
    DOMAIN,
    PLAYLIST_KINDS,
    SLOT_A,
    SLOT_B,
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
    build_slot_b_program,
    design_play_frames,
    frames_to_content,
    poster_frame,
    power_limit_programs,
    program_screen,
    retimed_frames,
    show_content_class,
    text_playback_frames,
    to_device_timing,
)
from .protocol import commands
from .protocol import render as protocol_render
from .protocol.models import AlarmItem, Frame, NightMode, TimerSwitchItem
from .protocol.programs import Program, program_fingerprint
from .protocol.responses import (
    CountdownStatus,
    DeviceInfo,
    Response,
    ScoreboardStatus,
    StopwatchStatus,
    TempHumidity,
)
from .reminder_manager import ReminderManager
from .slot_store import IledClockSlotStore
from .slots import (
    check_slot,
    descriptor_slot,
    require_screen_a_for_timed_show,
    require_slot_accepts,
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

#: Upper bound for the shutdown-time release; HA gives all shutdown jobs one shared 20 s budget.
SHUTDOWN_RELEASE_TIMEOUT_S = 8.0

# Forward reference as a string: this alias is used in type hints throughout the integration
# before `IledClockCoordinator` is defined below. `ConfigEntry.__class_getitem__` happily stores
# a string as its type argument without evaluating it, so this needs no further indirection.
IledClockConfigEntry = ConfigEntry["IledClockCoordinator"]

_DAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

_KIND_PREVIEW_LABEL = {
    "clock": "CLOCK", "date": "DATE", "timer": "TIMER", "scoreboard": "SCORE",
    "temperature": "TEMP", "humidity": "HUMID",
}


def _wire_fingerprint(program: Program, brightness: int | None) -> tuple[str, int]:
    """`program_fingerprint` of `program` exactly as `IledClockCoordinator._async_send_to_clock` sends it (the
    power limit and the clock's delay units applied), i.e. the CRC and length its start frame carried."""
    return program_fingerprint(to_device_timing(power_limit_programs([program], brightness))[0])


def _show_spec_from_descriptor(descriptor: Mapping[str, Any]) -> dict[str, Any]:
    """The show spec that draws a stored descriptor again (undo, and putting screen A back after a timed show).
    Presentation fields and the screen are not part of what is shown; a generative preset is stored as `effect`
    but shown as `kind`."""
    kind = str(descriptor.get("kind", ""))
    fields = {
        key: value for key, value in descriptor.items()
        if key not in {"kind", "title", "shown_at", "unavailable", "slot", "source"}
    }
    if kind == "generative" and "effect" in fields:
        fields["kind"] = fields.pop("effect")
    return {"type": kind, **fields, "title": descriptor.get("title")}


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
        # The clock's flag means "keep the display on (dimmed) at night" [DEVICE 2026-10-06]: with it set, the
        # night window's start switched an off display ON; cleared, the display stayed off. `device_off` is its opposite.
        device_off=not nm.device_state_enabled,
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
        "device_state_enabled": not state.device_off,
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
        self.client = IledClockClient(
            hass,
            address,
            options[CONF_PASSWORD],
            last_holder=lambda: entry.data.get(CONF_LAST_HOLDING_PROXY) or None,
            on_route=self._on_route,
            on_link_change=self.async_update_listeners,
        )
        self.client.set_idle_timeout(options[CONF_IDLE_TIMEOUT])
        self.design_library: IledClockDesignLibrary = async_get_design_library(hass)
        self.playlist_store = IledClockPlaylistStore(hass, entry.entry_id)
        self.show_store = IledClockShowStore(hass, entry.entry_id)
        #: What Home Assistant last sent to each of the clock's two screens (written after an upload succeeds).
        self.slot_store = IledClockSlotStore(hass, entry.entry_id)
        #: Alarms & reminders: named definitions kept here, compiled onto the clock's own reminder slots.
        self.reminders = ReminderManager(self)
        self._show_lock = asyncio.Lock()
        self._time_sync_enabled: bool = options[CONF_TIME_SYNC]
        self._synced_since_start = False
        self._unsub_daily_sync: Callable[[], None] | None = None

        # "Show" (Contract D `iledclock/show`, and every `show_*` service): a temporary or
        # permanent single-program override that bypasses the stored playlist without
        # overwriting it. `_saved_playlist` is what to put back on screen A once a *timed* override
        # (`show_text`'s `duration_s`) expires: `None` = no timed show is pending, `[]` = one started
        # while there was no playlist, and then `_saved_screen_a` (the record screen A held before
        # it) is shown again. Screen B shows never touch any of this.
        self._saved_playlist: list[PlaylistItem] | None = None
        self._saved_screen_a: dict[str, Any] | None = None
        self._restore_generation = 0
        #: What was last uploaded to each screen, as built (before the power limit and the clock's
        #: own delay units), so re-sending it is byte-identical. Not persisted.
        self._slot_programs: dict[str, list[Program]] = {}
        self._restore_unsub: Callable[[], None] | None = None
        self.active_item: PlaylistItem | None = None
        self.preview_png: bytes | None = None
        self.preview_approximate = False
        self.busy = False

        self.data = ClockState(address=address)
        #: False until one refresh has really read the clock. Until then every entity is unavailable (startup
        #: contract S3): the defaults in `ClockState` are placeholders, not readings.
        self.has_data = False
        #: The first refresh, running in the background while setup waits for it (see `__init__.py`).
        self.startup_refresh: asyncio.Task[None] | None = None
        #: Set when the entry starts unloading; late entity additions refuse from then on.
        self.unloading = False

    @property
    def address(self) -> str:
        return self.client.address

    @property
    def link_held(self) -> bool:
        """Whether the link is in practice kept open between uses: never idle-disconnected, or the periodic
        refresh comes round before the idle timeout would drop it."""
        options = normalize_options(self.entry.options)
        idle = options[CONF_IDLE_TIMEOUT]
        return idle == 0 or options[CONF_REFRESH_INTERVAL] * 60 < idle

    @callback
    def _on_route(self, adapter: str) -> None:
        """Remember which proxy carries the link (its ESPHome node name, never a MAC string), so a silent ghost
        link can later be freed from the right proxy."""
        entry = self.entry
        if shutdown.in_progress(self.hass) or entry.data.get(CONF_LAST_HOLDING_PROXY) == adapter:
            return
        self.hass.config_entries.async_update_entry(entry, data={**entry.data, CONF_LAST_HOLDING_PROXY: adapter})

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

    async def async_stop_startup(self) -> None:
        """First step of every unload/reload: nothing may add entities any more (`unloading`), and a first
        refresh still connecting in the background is stopped (it holds the client's lock, so the release
        that follows would otherwise wait for the connect to give up on its own). A reading that lands while
        the platforms are being unloaded must not create entities on a platform that is going away."""
        self.unloading = True
        refresh, self.startup_refresh = self.startup_refresh, None
        if refresh is not None and not refresh.done():
            refresh.cancel()
            await asyncio.wait({refresh})

    def async_resume_startup(self) -> None:
        """The unload failed and the entry stays loaded: undo `async_stop_startup`, picking the first read
        back up if it never happened."""
        self.unloading = False
        if not self.has_data and self.startup_refresh is None:
            self.startup_refresh = self.entry.async_create_background_task(
                self.hass, self.async_refresh(), f"iledclock first refresh {self.entry.title}"
            )

    async def async_unload(self) -> None:
        self.async_quiet_for_shutdown()
        await self.async_stop_startup()
        await self.client.async_release()

    @callback
    def async_quiet_for_shutdown(self) -> None:
        """Stop what could act on the link later: the daily time sync and any timed-show restore."""
        if self._unsub_daily_sync is not None:
            self._unsub_daily_sync()
            self._unsub_daily_sync = None
        self._cancel_pending_restore()

    async def async_release_at_shutdown(self) -> None:
        """Home Assistant shutdown job (Stage 1, before `bluetooth` and the ESPHome proxies go away).

        Latches the client so nothing reconnects, then releases the GATT link so the proxy
        is not left holding a ghost link. Bounded to 8 s, never raises, and deliberately does
        NOT unload the entry (that would write a wave of `unavailable` states)."""
        shutdown.begin(self.hass)
        self.async_quiet_for_shutdown()
        started = time.monotonic()
        try:
            async with asyncio.timeout(SHUTDOWN_RELEASE_TIMEOUT_S):
                await self.client.async_release_for_shutdown()
        except TimeoutError:
            _LOGGER.warning(
                "Timed out releasing BLE link to %s at shutdown after %.0f s",
                self.address, SHUTDOWN_RELEASE_TIMEOUT_S,
            )
        except Exception as err:  # noqa: BLE001 - a shutdown job must never raise
            _LOGGER.warning("Could not release BLE link to %s at shutdown: %s", self.address, err)
        else:
            _LOGGER.info(
                "Released BLE link to %s at shutdown in %.2f s",
                self.address, time.monotonic() - started,
            )

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
            if isinstance(err, IledClockShuttingDownError) or self.client.is_closing:
                # Not a fault of the clock (the link was dropped on purpose, or never opened):
                # no failure counted, nothing marked unavailable.
                return base
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

        # The refresh reads the reminders in the middle of its pass and publishes at the end. A reminder write that
        # starts or ends in between has already published a newer list, so the token is checked at the very end, right
        # before publishing (nothing is awaited after the check).
        reminder_token = self.reminders.begin_read()
        changes = await self._async_fetch_all()
        if self.client.is_closing:
            return self.data  # the release cut this pass short; do not publish a half-read state
        changes["connected"] = True
        changes["consecutive_failures"] = 0
        self.has_data = True
        changes["last_updated"] = dt_util.utcnow().timestamp()
        reminders = changes.pop("reminders", None)
        if reminders is not None and self.reminders.read_is_current(reminder_token):
            self.reminders.async_refresh_from_clock(reminders)
            changes["reminders"] = reminders
        # Merge onto what is current now, not onto what it was when this refresh began: whatever finished meanwhile
        # (a reminder write, a show) has published newer values that this refresh knows nothing about.
        return merge_state(self.data, changes)

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
        """The clock's reminders for the periodic refresh: all or nothing (None keeps the last known list, so a
        flaky read never makes reminders look missing). Only reads: `_async_update_data` decides at the very end,
        right before publishing, whether the read is still current."""
        try:
            return await self.reminders.async_read_clock()
        except IledClockError as err:
            _LOGGER.debug("iLedClock %s: reminders failed: %s", self.address, err)
            return None

    # -- Playlist / show / upload -----------------------------------------------------------

    def _designs_by_id(self) -> dict[str, Design]:
        return {design.id: design for design in self.design_library.designs}

    async def async_seed_showing_from_playlist(self) -> None:
        if self.show_store.now_showing is not None or not self.playlist_store.playlist:
            return
        await self._async_record_showing(self._descriptor_for_playlist_item(self.playlist_store.playlist[0]))

    async def async_set_playlist(self, items: list[PlaylistItem]) -> None:
        """`iledclock/playlist/set` and the `set_playlist` service: persist and upload (screen A)."""
        async with self._show_lock:
            # Built first: an item that cannot be drawn (text too long, an unknown design, ...) is refused before
            # anything is stored, cancelled or sent.
            programs = await self._async_build_programs(items)
            self._cancel_pending_restore()
            self._saved_playlist = None
            self._saved_screen_a = None
            await self.playlist_store.async_set_playlist(items)
            await self._async_upload_playlist_locked(items, record_showing=True, programs=programs)

    async def _async_build_programs(self, items: list[PlaylistItem]) -> list[Program]:
        """`build_programs` off the event loop: working out a design's Speed and Smooth motion is real work."""
        return await self.hass.async_add_executor_job(
            partial(build_programs, items, designs=self._designs_by_id())
        )

    async def _async_upload_playlist_locked(
        self, items: list[PlaylistItem], *, record_showing: bool = False, programs: list[Program] | None = None
    ) -> None:
        """Upload `items` as screen A's program list (`programs` when already built); screen A's record is written
        once the clock has it."""
        if programs is None:
            programs = await self._async_build_programs(items)
        await self._async_upload_programs(programs)
        self.active_item = items[0] if items else None
        await self._async_update_preview_for_item(self.active_item)
        if not items:
            return  # nothing was sent, so screen A still holds whatever it held
        # The clock files each program by its start frame, so a date page never joins the program list: it replaces
        # the clock-page store (screen B). The records say what really went where.
        entries = [(item, program, program_screen(program)) for item, program in zip(items, programs)]
        listed = [(item, program) for item, program, screen in entries if screen == SLOT_A]
        pages = [(item, program) for item, program, screen in entries if screen == SLOT_B]
        if listed:
            list_programs = [program for _item, program in listed]
            head = self._descriptor_for_playlist_item(listed[0][0])
            title = head["title"] if len(list_programs) == 1 else f"Playlist · {len(list_programs)} programs"
            await self._async_record_slot_write(
                SLOT_A, list_programs, title=title, descriptor={**head, "source": "playlist"}
            )
        if pages:
            page_item, page_program = pages[-1]
            page = self._descriptor_for_playlist_item(page_item, slot=SLOT_B)
            await self._async_record_slot_write(
                SLOT_B, [page_program], title=page["title"], descriptor={**page, "source": "playlist"}
            )
        if record_showing:
            await self._async_record_showing(self._descriptor_for_playlist_item(items[0], slot=entries[0][2]))

    async def async_show(
        self, spec: Mapping[str, Any], *, slot: str = DEFAULT_SLOT, restore_after_s: float | None = None
    ) -> dict[str, Any]:
        """Serialize each clock show from upload through history update. `slot` is the screen it goes to: "a"
        (the program list, the default) or "b" (the clock-page store, which only takes clock-type pages)."""
        check_slot(slot)
        async with self._show_lock:
            return await self._async_show_locked(spec, slot=slot, restore_after_s=restore_after_s)

    async def _async_show_locked(
        self, spec: Mapping[str, Any], *, slot: str = DEFAULT_SLOT, restore_after_s: float | None = None
    ) -> dict[str, Any]:
        """Upload one show item to screen `slot` and record it only after the clock accepts the program."""
        check_slot(slot)
        show_type = spec.get("type")
        # `slot` and `source` belong to a stored descriptor, not to what is shown: the `slot` argument decides.
        params = {key: value for key, value in spec.items() if key not in {"type", "slot", "source"}}
        descriptor_params = dict(params)
        if restore_after_s:
            require_screen_a_for_timed_show(slot)
        designs = self._designs_by_id()
        # Refused here, before anything is drawn, fetched or sent.
        require_slot_accepts(slot, show_content_class(show_type, params, designs))

        item: PlaylistItem | None = None
        preview_frames: list[Frame] | None = None
        if show_type in PLAYLIST_KINDS:
            item = PlaylistItem(kind=show_type, params=params, duration_s=int(params.pop("duration_s", 10)))
            if slot == SLOT_A:
                programs = await self._async_build_programs([item])
            else:
                programs = [
                    await self.hass.async_add_executor_job(
                        partial(build_slot_b_program, show_type, params, designs=designs)
                    )
                ]
        else:  # "image" or "generative": `show_content_class` refused every other type
            if show_type == "image":
                rendered = await self.async_render_image(params)
                # History keeps the frames as rendered plus the playback choice, so showing it again
                # works the speed out afresh instead of applying it twice.
                descriptor_params = {
                    "title": params.get("title"),
                    "frames": [base64.b64encode(bytes(channel for row in frame.pixels for pixel in row for channel in pixel)).decode("ascii") for frame in rendered],
                    "delays": [frame.duration_ms for frame in rendered],
                    **{key: params[key] for key in ("speed", "smooth") if key in params},
                }
            else:
                rendered = await self.async_render_generative(params)
            preview_frames = await self.hass.async_add_executor_job(retimed_frames, rendered, params)
            art = frames_to_content(preview_frames, still=len(preview_frames) == 1)
            if slot == SLOT_A:
                programs = [Program(contents=[art], show_count=10)]
            else:
                programs = [build_slot_b_program(show_type, params, designs=designs, art=art)]

        if slot == SLOT_A and program_screen(programs[0]) == SLOT_B:
            # A date page is filed in the clock-page store whichever screen was asked for (the start frame's kind
            # byte decides): this is a screen B write, so the records say so and screen A's return is left alone.
            slot, restore_after_s = SLOT_B, None
        await self._async_upload_programs(programs)
        # The clock has it. Nothing above changed any state, so a failed upload leaves everything as it was.
        if slot == SLOT_A:
            self._note_screen_a_show(restore_after_s)
            if item is not None:
                self.active_item = item
        if item is not None:
            await self._async_update_preview_for_item(item)
        elif preview_frames is not None:
            await self._async_update_preview_from_frames(preview_frames, approximate=False)

        descriptor = self._descriptor_for_spec(show_type, descriptor_params, slot=slot)
        await self._async_record_slot_write(slot, programs, title=descriptor["title"], descriptor=descriptor)
        await self._async_record_showing(descriptor)
        if restore_after_s:
            generation = self._restore_generation

            async def restore_playlist(now: datetime) -> None:
                await self._async_restore_playlist(now, generation)

            self._restore_unsub = async_call_later(self.hass, restore_after_s, restore_playlist)
        return dict(self.show_store.now_showing or descriptor)

    def _note_screen_a_show(self, restore_after_s: float | None) -> None:
        """Screen A just received a show: any pending timed restore is obsolete. A timed show also remembers what
        to put back (the playlist, or when there is none the record screen A held), but only the first of a
        chain does, so a second timed message does not make the first one the thing to come back to."""
        self._cancel_pending_restore()
        if not restore_after_s:
            self._saved_playlist = None
            self._saved_screen_a = None
        elif self._saved_playlist is None:
            self._saved_playlist = self.playlist_store.playlist
            self._saved_screen_a = self.slot_store.record(SLOT_A)

    async def _async_record_slot_write(
        self, slot: str, programs: list[Program], *, title: str, descriptor: dict[str, Any]
    ) -> None:
        """Remember what the clock accepted for screen `slot`; call only after the upload succeeded. The
        fingerprint is of the first program exactly as it went out (power limit and delay units applied)."""
        brightness = self.data.brightness
        crc, length = await self.hass.async_add_executor_job(_wire_fingerprint, programs[0], brightness)
        self._slot_programs[slot] = list(programs)
        await self.slot_store.async_record(
            slot, title=title, descriptor=descriptor, programs=len(programs), crc=crc, length=length
        )

    def _descriptor_for_spec(
        self, kind: str, params: Mapping[str, Any], *, slot: str = DEFAULT_SLOT
    ) -> dict[str, Any]:
        """The descriptor of history, `now_showing` and the screen records: renderable through `iledclock/render`
        and tagged with the screen it was written to."""
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
            # One vocabulary on record, whoever asked: `is_bold` (not `bold`) and `effect` (not `color_mode`).
            if "bold" in fields:
                fields.setdefault("is_bold", bool(fields.pop("bold")))
            if "color_mode" in fields:
                fields.setdefault("effect", fields.pop("color_mode"))
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
        return {"kind": kind, **fields, "title": str(title), "slot": slot, "shown_at": dt_util.utcnow().isoformat()}

    def _descriptor_for_playlist_item(self, item: PlaylistItem, *, slot: str = DEFAULT_SLOT) -> dict[str, Any]:
        return self._descriptor_for_spec(item.kind, {**dict(item.params), "duration_s": item.duration_s}, slot=slot)

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
        """Undo: re-show the newest earlier item of the SAME screen as the entry being undone (the newest one in
        history), marking deleted designs skipped. Entries from before screens existed count as screen A."""
        history = list(self.show_store.history)
        slot = descriptor_slot(history[0]) if history else DEFAULT_SLOT
        for descriptor in history[1:]:
            if descriptor.get("unavailable") or descriptor_slot(descriptor) != slot:
                continue
            kind = str(descriptor.get("kind", ""))
            if kind == "design" and self.design_library.get_design(str(descriptor.get("design_id", ""))) is None:
                await self.show_store.async_mark_unavailable(str(descriptor.get("design_id", "")))
                self.async_set_updated_data(merge_state(self.data, {
                    "now_showing": self.show_store.now_showing,
                    "show_history": tuple(dict(item) for item in self.show_store.history),
                }))
                continue
            return await self._async_show_locked(_show_spec_from_descriptor(descriptor), slot=slot)
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
        """A timed show ran out: put screen A back. `_saved_playlist` is `None` when nothing is pending, so it is
        never tested for truthiness: `[]` means the timed show started while there was no playlist, and then the
        record screen A held before it (its descriptor) is shown again."""
        async with self._show_lock:
            if generation is not None and generation != self._restore_generation:
                return
            self._restore_unsub = None
            saved, self._saved_playlist = self._saved_playlist, None
            earlier, self._saved_screen_a = self._saved_screen_a, None
            if saved is None:
                return
            if saved:
                await self._async_upload_playlist_locked(saved, record_showing=True)
                return
            descriptor = (earlier or {}).get("descriptor")
            if not descriptor or descriptor.get("source") == "playlist":
                return  # nothing known to put back (a playlist record cannot be rebuilt once the playlist is gone)
            if descriptor.get("kind") == "design" and self.design_library.get_design(str(descriptor.get("design_id", ""))) is None:
                return  # the design was deleted meanwhile
            await self._async_show_locked(_show_spec_from_descriptor(descriptor), slot=SLOT_A)

    def _cancel_pending_restore(self) -> None:
        self._restore_generation += 1
        if self._restore_unsub is not None:
            self._restore_unsub()
            self._restore_unsub = None

    async def _async_upload_programs(self, programs: list[Program]) -> None:
        """Upload `programs` as the clock's program list (index 0..N-1, count N): screen A."""
        await self._async_send_to_clock(programs, self.client.async_upload)

    async def _async_send_to_clock(
        self,
        programs: list[Program],
        upload: Callable[..., Awaitable[Any]],
    ) -> Any:
        """The one chokepoint every program upload goes through (shows, playlists and reminders):
        applies the vendor power budget and the clock's own delay units, raises the busy flag,
        publishes upload progress for the studio's status chip, and always publishes the end state.
        `upload(programs, on_progress=...)` does the actual Bluetooth transfer and may return a value."""
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
            return await upload(programs, on_progress=on_progress)
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

    # -- Screens A / B and the alarms & reminders list: JSON for the studio ------------------------

    @property
    def show_lock(self) -> asyncio.Lock:
        """Serialises everything that talks program data to the clock (shows, playlists, reminders)."""
        return self._show_lock

    def slots_json(self) -> dict[str, Any]:
        """`slots` of the `iledclock/state` payload: what Home Assistant last sent to each screen of the clock."""
        return self.slot_store.json()

    def reminder_list_json(self) -> dict[str, Any] | None:
        """`reminder_list` of the `iledclock/state` payload: the saved alarms and reminders, their status against
        the clock, and the reminders only the clock has (`ReminderManager.json`)."""
        return self.reminders.json()

    async def async_reassert_program_list_locked(self) -> bool:
        """Re-send screen A's last program list if Home Assistant knows it (caller holds `show_lock`): the programs
        of its last upload, kept in memory; after a restart, the list programs of the stored playlist when screen A's
        last write was the playlist; otherwise nothing. Cheap when the clock still has it: an unchanged program is
        answered "already present" and no data chunks go out. Used after reminder writes while
        `hardware.REMINDER_UPLOAD_PRESERVES_SLOTS` is False. Returns whether a list was sent; upload errors
        (`IledClockError`) propagate."""
        programs = self._slot_programs.get(SLOT_A)
        if not programs:
            record = self.slot_store.record(SLOT_A)
            items = self.playlist_store.playlist
            if record is None or (record.get("descriptor") or {}).get("source") != "playlist" or not items:
                return False
            # The stored playlist can hold a date page. The clock files it in screen B (start-frame kind 04), so
            # sending it again would overwrite screen B with that old page: only the list programs belong here.
            built = await self._async_build_programs(items)
            programs = [program for program in built if program_screen(program) == SLOT_A]
            if not programs:
                return False
        await self._async_upload_programs(programs)
        return True

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
                frames, _played = await self.hass.async_add_executor_job(design_play_frames, design, item.params)
                await self._async_update_preview_from_frames(frames, approximate=False)
                return
            if item.kind == "text":
                # Scrolling text starts almost blank, so the picture shows the frame with the most lit LEDs.
                poster = await self.hass.async_add_executor_job(
                    lambda: poster_frame(text_playback_frames(item.params))
                )
                await self._async_update_preview_from_frames([poster], approximate=False)
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
        """Delete a reminder that exists only on the clock (made in the vendor app): the delete is checked and the
        clock is read back. One a saved alarm holds is refused -- delete the alarm instead (`reminders.async_delete`)."""
        await self.reminders.async_delete(device_id=reminder_id)

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

    async def async_switch_screen(self) -> None:
        """Press the clock's power key once (`commands.screen_toggle`): flips between screen A and
        screen B. One-way and a toggle: the clock does not answer, and the visible screen is not
        tracked anywhere. Waits for any running upload (`show_lock`) so it never lands mid-transfer."""
        async with self._show_lock:
            await self.client.async_send_oneway(commands.screen_toggle())

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
        self, style: int, color: int, hours24: bool, show_seconds: bool = False, background: bool = True,
        *, slot: str = DEFAULT_SLOT,
    ) -> None:
        await self.async_show(
            {"type": "clock", "style": style, "color": color, "hours24": hours24, "show_seconds": show_seconds,
             "background": background},
            slot=slot,
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
