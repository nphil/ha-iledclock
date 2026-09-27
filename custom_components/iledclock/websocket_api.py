"""WebSocket API for the frontend (Contract D).

Command names, request/response shapes, and the `iledclock/command` sub-command vocabulary are
matched exactly against `frontend/src/lib/ws-api.ts` and the components that call it
(`iledclock-card.ts`, `iledclock-studio-panel.ts`, `iledclock-settings-sheet.ts`) -- those are
real call sites in a sibling agent's code, not just the prose summary in ARCHITECTURE.md, so
field names here follow what that code actually sends over the wire.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any, Mapping

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .client import IledClockError
from .clock_backgrounds import CLOCK_BACKGROUNDS
from .clock_styles import CLOCK_STYLES
from .const import DOMAIN, upload_progress_signal
from .coordinator import (
    IledClockCoordinator,
    alarm_item_from_service,
    timer_switch_item_from_service,
)
from .designs import DesignValidationError
from .playlist import PlaylistValidationError, playlist_item_to_json, validate_playlist
from .program_builder import ProgramBuildError
from .protocol import clock_faces as protocol_clock_faces
from .protocol import render as protocol_render
from .protocol.models import Frame
from .store import async_get_design_library
from .ws_shapes import shape_designs_list, shape_frames_payload, shape_state_event

_LOGGER = logging.getLogger(__name__)


class _UnknownEntryError(Exception):
    """A well-formed `entry_id` that doesn't (or no longer) resolve to a loaded iLedClock."""


def _coordinator(hass: HomeAssistant, entry_id: str) -> IledClockCoordinator:
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None or entry.domain != DOMAIN:
        raise _UnknownEntryError(f"{entry_id} is not an iLedClock config entry")
    # `runtime_data` only exists once setup has finished. The panel reconnects the moment HA is
    # back after a restart - before this entry has connected to the clock - so an unloaded entry
    # is an ordinary transient state, not a crash (seen live: AttributeError on runtime_data).
    if entry.state is not ConfigEntryState.LOADED:
        raise _UnknownEntryError(f"iLedClock entry {entry_id} is not loaded yet ({entry.state.value})")
    return entry.runtime_data


def _state_event(coordinator: IledClockCoordinator) -> dict[str, Any]:
    return shape_state_event(
        connected=coordinator.data.connected,
        busy=coordinator.busy,
        state=coordinator.data,
        playlist=coordinator.playlist_store.playlist,
        now_showing=coordinator.show_store.now_showing,
        show_history=coordinator.show_store.history,
    )


@callback
def async_setup_websocket_api(hass: HomeAssistant) -> None:
    """Idempotent: registering the same command id twice raises, so guard with our own flag
    (HA's websocket_api internals aren't a documented registry to introspect)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("websocket_registered"):
        return
    domain_data["websocket_registered"] = True
    websocket_api.async_register_command(hass, ws_state)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_designs_list)
    websocket_api.async_register_command(hass, ws_designs_save)
    websocket_api.async_register_command(hass, ws_designs_delete)
    websocket_api.async_register_command(hass, ws_render)
    websocket_api.async_register_command(hass, ws_show)
    websocket_api.async_register_command(hass, ws_playlist_get)
    websocket_api.async_register_command(hass, ws_playlist_set)
    websocket_api.async_register_command(hass, ws_command)


# -- iledclock/state ----------------------------------------------------------------------------


@websocket_api.websocket_command(
    {vol.Required("type"): "iledclock/state", vol.Required("entry_id"): str}
)
@websocket_api.async_response
async def ws_state(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        coordinator = _coordinator(hass, msg["entry_id"])
    except _UnknownEntryError as err:
        connection.send_error(msg["id"], "unknown_entry", str(err))
        return
    connection.send_result(msg["id"], _state_event(coordinator))


# -- iledclock/subscribe ------------------------------------------------------------------------


@websocket_api.websocket_command(
    {vol.Required("type"): "iledclock/subscribe", vol.Required("entry_id"): str}
)
@websocket_api.async_response
async def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    try:
        coordinator = _coordinator(hass, msg["entry_id"])
    except _UnknownEntryError as err:
        connection.send_error(msg["id"], "unknown_entry", str(err))
        return

    @callback
    def _forward_state() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], _state_event(coordinator))
        )

    @callback
    def _forward_upload(payload: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    remove_listener = coordinator.async_add_listener(_forward_state)
    remove_dispatcher = async_dispatcher_connect(
        hass, upload_progress_signal(coordinator.entry.entry_id), _forward_upload
    )

    @callback
    def _unsubscribe() -> None:
        remove_listener()
        remove_dispatcher()

    connection.subscriptions[msg["id"]] = _unsubscribe
    connection.send_result(msg["id"])


# -- iledclock/designs/* --------------------------------------------------------------------------


@websocket_api.websocket_command(
    {vol.Required("type"): "iledclock/designs/list", vol.Optional("entry_id"): str}
)
@websocket_api.async_response
async def ws_designs_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    library = async_get_design_library(hass)
    await library.async_load()
    connection.send_result(msg["id"], shape_designs_list(library.designs))


@websocket_api.websocket_command(
    {vol.Required("type"): "iledclock/designs/save", vol.Required("design"): dict}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_designs_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    library = async_get_design_library(hass)
    await library.async_load()
    try:
        design = await library.async_save_design(msg["design"])
    except DesignValidationError as err:
        connection.send_error(msg["id"], "invalid_design", str(err))
        return
    connection.send_result(msg["id"], {"id": design.id})


@websocket_api.websocket_command(
    {vol.Required("type"): "iledclock/designs/delete", vol.Required("design_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_designs_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    library = async_get_design_library(hass)
    await library.async_load()
    await library.async_delete_design(msg["design_id"])
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state == ConfigEntryState.LOADED:
            await entry.runtime_data.async_mark_design_deleted(msg["design_id"])
    connection.send_result(msg["id"], {})


# -- iledclock/render -----------------------------------------------------------------------------


async def _async_render_spec(
    hass: HomeAssistant, coordinator: IledClockCoordinator, spec: Mapping[str, Any]
) -> tuple[list, list[int], bool]:
    """Server-side preview rendering only -- never touches the real device. Returns
    `(frames, delays_ms, approximate)`."""
    spec_type = spec.get("type")
    if spec_type == "text":
        color = tuple(spec.get("color", (255, 255, 255)))
        # `effect` (an auto colour-cycle mode, sent as a numeric string) only matters for a
        # real upload's `TextAutoColor` (program_builder.py); the preview here always renders
        # in the requested flat colour regardless, which is an honest simplification -- an
        # animated colour-cycle effect has no single still "preview colour" to begin with.
        frames = await hass.async_add_executor_job(
            protocol_render.text_frames, spec.get("text", ""), spec.get("font", "5x7"), color,
        )
        return frames, [frame.duration_ms for frame in frames], False
    if spec_type == "image":
        frames = await coordinator.async_render_image(spec)
        return frames, [frame.duration_ms for frame in frames], False
    if spec_type == "generative":
        frames = await coordinator.async_render_generative(spec)
        return frames, [frame.duration_ms for frame in frames], False
    if spec_type == "clock":
        # Pixel-accurate: the vendor's own per-style digit/colon glyphs (protocol.render.
        # clock_face_frames, decoded from protocol.clock_faces' bit-packed tables) over that
        # style's real background animation -- no longer an approximate placeholder.
        style_index = int(spec.get("style", 1))
        style = CLOCK_STYLES.get(style_index)
        if style is None:
            raise ProgramBuildError(f"unknown clock style {style_index}")
        color = tuple(spec.get("color", (255, 255, 255)))
        hours24 = bool(spec.get("h24", True))
        wants_background = bool(spec.get("background", True))
        geometry = protocol_render.ClockFaceGeometry(
            num_width=style.num_width, num_height=style.num_height, hour=style.hour,
            space_hour=style.space_hour, minute=style.minute, space_minute=style.space_minute,
            seconds=style.seconds, show_space_minute=style.show_space_minute,
            number_table=protocol_clock_faces.STYLE_NUMBER[style_index],
            space_table=protocol_clock_faces.STYLE_SPACE[style_index],
        )
        bundled = CLOCK_BACKGROUNDS.get(style_index) if wants_background else None
        background = (
            protocol_render.ClockFaceBackground(
                width=bundled.width, height=bundled.height, delay_ms=bundled.delay_ms, frames=bundled.frames,
            )
            if bundled is not None
            else None
        )
        frames = await hass.async_add_executor_job(
            protocol_render.clock_face_frames, geometry, color, hours24, background,
        )
        return frames, [frame.duration_ms for frame in frames], False
    raise ProgramBuildError(f"unsupported render type: {spec_type!r}")


def _frames_to_rgb888(frames: Sequence[Frame]) -> list[bytes]:
    """`protocol.render` hands back `Frame` pixel grids, but Contract D's `iledclock/render`
    wire shape (`ws_shapes.shape_frames_payload`, and the design library's own `frames`)
    carries each frame as base64 of raw row-major RGB888 bytes -- so flatten them here."""
    return [
        bytes(channel for row in frame.pixels for pixel in row for channel in pixel)
        for frame in frames
    ]


@websocket_api.websocket_command(
    {
        vol.Required("type"): "iledclock/render",
        vol.Required("entry_id"): str,
        vol.Required("spec"): dict,
    }
)
@websocket_api.async_response
async def ws_render(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        coordinator = _coordinator(hass, msg["entry_id"])
    except _UnknownEntryError as err:
        connection.send_error(msg["id"], "unknown_entry", str(err))
        return
    try:
        frames, delays, approximate = await _async_render_spec(hass, coordinator, msg["spec"])
    except (ProgramBuildError, IledClockError, KeyError, ValueError) as err:
        connection.send_error(msg["id"], "render_failed", str(err))
        return
    payload = shape_frames_payload(_frames_to_rgb888(frames), delays)
    if approximate:
        payload["approximate"] = True
    connection.send_result(msg["id"], payload)


# -- iledclock/show -------------------------------------------------------------------------------


def _show_spec_from_item(item: Mapping[str, Any]) -> dict[str, Any]:
    """`ShowItem = {design_id} | {spec: RenderSpec}` (frontend/src/types.ts). A `RenderSpec`'s
    `type: "clock"` carries `h24`; our own playlist/service vocabulary calls the same field
    `hours24` (Contract C's `clock_face` service) -- translated here so `async_show`'s content
    builders only ever need to understand one name."""
    if "design_id" in item:
        return {"type": "design", "design_id": item["design_id"]}
    spec = dict(item.get("spec", {}))
    if spec.get("type") == "clock" and "h24" in spec:
        spec["hours24"] = spec.pop("h24")
    return spec


@websocket_api.websocket_command(
    {
        vol.Required("type"): "iledclock/show",
        vol.Required("entry_id"): str,
        vol.Required("item"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_show(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        coordinator = _coordinator(hass, msg["entry_id"])
    except _UnknownEntryError as err:
        connection.send_error(msg["id"], "unknown_entry", str(err))
        return
    try:
        if msg["item"].get("restore") == "previous":
            descriptor = await coordinator.async_restore_previous()
            connection.send_result(msg["id"], {"now_showing": descriptor})
            return
        spec = _show_spec_from_item(msg["item"])
        descriptor = await coordinator.async_show(spec)
    except ValueError as err:
        if str(err) == "nothing_to_restore":
            connection.send_error(msg["id"], "nothing_to_restore", str(err))
            return
        connection.send_error(msg["id"], "show_failed", str(err))
        return
    except (ProgramBuildError, IledClockError, DesignValidationError, KeyError) as err:
        connection.send_error(msg["id"], "show_failed", str(err))
        return
    connection.send_result(msg["id"], {"now_showing": descriptor})


# -- iledclock/playlist/* -------------------------------------------------------------------------


@websocket_api.websocket_command(
    {vol.Required("type"): "iledclock/playlist/get", vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_playlist_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    try:
        coordinator = _coordinator(hass, msg["entry_id"])
    except _UnknownEntryError as err:
        connection.send_error(msg["id"], "unknown_entry", str(err))
        return
    connection.send_result(
        msg["id"], {"playlist": [playlist_item_to_json(item) for item in coordinator.playlist_store.playlist]}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "iledclock/playlist/set",
        vol.Required("entry_id"): str,
        vol.Required("playlist"): list,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_playlist_set(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    try:
        coordinator = _coordinator(hass, msg["entry_id"])
    except _UnknownEntryError as err:
        connection.send_error(msg["id"], "unknown_entry", str(err))
        return
    try:
        items = validate_playlist(msg["playlist"])
    except PlaylistValidationError as err:
        connection.send_error(msg["id"], "invalid_playlist", str(err))
        return
    try:
        await coordinator.async_set_playlist(items)
    except IledClockError as err:
        connection.send_error(msg["id"], "playlist_failed", str(err))
        return
    connection.send_result(msg["id"], {})


# -- iledclock/command ----------------------------------------------------------------------------


async def _async_dispatch_command(
    coordinator: IledClockCoordinator, command: str, params: Mapping[str, Any]
) -> None:
    """Every `iledclock/command` sub-command actually sent by the frontend
    (`iledclock-card.ts`/`iledclock-studio-panel.ts`/`iledclock-settings-sheet.ts`), plus a few
    direct passthroughs Contract D also names that the current UI happens to reach through
    ordinary HA entity services instead (`power`/`brightness`/`rotate`/`sync_time`) -- kept here
    too so nothing in Contract D's command list is unreachable over this API."""
    if command == "night_mode_set":
        await coordinator.async_set_night_mode(
            enabled=bool(params["enabled"]),
            start_hour=int(params["start_h"]),
            start_minute=int(params["start_m"]),
            end_hour=int(params["end_h"]),
            end_minute=int(params["end_m"]),
            device_state_enabled=bool(params["device_off"]),
            brightness=int(params["brightness"]),
            wake_up_duration=int(params["wake_minutes"]),
            voice_control_enabled=bool(params["voice"]),
            voice_sensitivity=int(params["voice_sensitivity"]),
        )
    elif command == "alarms_set":
        items = [
            alarm_item_from_service(
                hour=int(item["hour"]), minute=int(item["minute"]),
                enabled=bool(item["enabled"]), repeat=int(item["repeat"]),
            )
            for item in params["items"]
        ]
        await coordinator.async_set_alarms(items)
    elif command == "timer_switch_set":
        items = [
            timer_switch_item_from_service(
                hour=int(item["hour"]), minute=int(item["minute"]), on=bool(item["on"]),
                enabled=bool(item["enabled"]), repeat=int(item["repeat"]),
            )
            for item in params["items"]
        ]
        await coordinator.async_set_timer_switches(items)
    elif command == "reminder_delete":
        await coordinator.async_reminder_delete(int(params["id"]))
    elif command == "set_password":
        await coordinator.async_set_stored_password(str(params["password"]))
    elif command == "countdown_reset":
        await coordinator.async_countdown_reset(
            int(params.get("h", 0)), int(params.get("m", 0)), int(params.get("s", 0))
        )
    elif command == "countdown_run":
        await coordinator.async_countdown_run(bool(params["start"]))
    elif command == "stopwatch_reset":
        await coordinator.async_stopwatch_reset()
    elif command == "stopwatch_run":
        await coordinator.async_stopwatch_run(bool(params["start"]))
    elif command == "tomato_set":
        await coordinator.async_set_pomodoro([int(minutes) for minutes in params["minutes"]])
    elif command == "scoreboard_set_score":
        await coordinator.async_scoreboard_set_score(int(params["home"]), int(params["away"]))
    elif command == "scoreboard_set_time":
        await coordinator.async_scoreboard_set_time(
            int(params.get("m", 0)), int(params.get("s", 0)), bool(params.get("count_down", True))
        )
    elif command == "scoreboard_run":
        await coordinator.async_scoreboard_run(bool(params["start"]))
    elif command == "power":
        await coordinator.async_set_power(bool(params["on"]))
    elif command == "brightness":
        await coordinator.async_set_brightness(int(params["value"]))
    elif command == "rotate":
        await coordinator.async_set_rotate(int(params["mode"]))
    elif command == "sync_time":
        await coordinator.async_sync_time()
    else:
        raise ValueError(f"unknown command: {command!r}")


@websocket_api.websocket_command(
    {
        vol.Required("type"): "iledclock/command",
        vol.Required("entry_id"): str,
        vol.Required("command"): str,
        vol.Optional("params", default=dict): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_command(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        coordinator = _coordinator(hass, msg["entry_id"])
    except _UnknownEntryError as err:
        connection.send_error(msg["id"], "unknown_entry", str(err))
        return
    try:
        await _async_dispatch_command(coordinator, msg["command"], msg["params"])
    except (IledClockError, KeyError, ValueError, TypeError) as err:
        connection.send_error(msg["id"], "command_failed", str(err))
        return
    connection.send_result(msg["id"], {})
