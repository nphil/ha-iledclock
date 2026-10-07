"""Every iLedClock service (Contract A/B, "covering every app feature" that has a real service-
shaped action; decorative borders deliberately have none). Alarms and reminders are created, switched
on and off and deleted by `reminder_set`, `reminder_set_enabled` and `reminder_delete`.

Registration is idempotent (`hass.services.has_service` guard) since `async_setup` can, in
principle, run once per config entry attempt.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import WEEKDAYS
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr

from .client import IledClockError
from .const import (
    ATTR_ALARMS,
    ATTR_AWAY,
    ATTR_BACKGROUND,
    ATTR_COLOR,
    ATTR_COLOR_MODE,
    ATTR_COUNT_DOWN,
    ATTR_DATA_B64,
    ATTR_DATE,
    ATTR_DAYS,
    ATTR_DESIGN_ID,
    ATTR_DITHER,
    ATTR_DURATION_S,
    ATTR_ENABLED,
    ATTR_END_HOUR,
    ATTR_END_MINUTE,
    ATTR_FIT,
    ATTR_FONT,
    ATTR_HOME,
    ATTR_HOUR,
    ATTR_HOURS24,
    ATTR_ID,
    ATTR_IS_BOLD,
    ATTR_KEY,
    ATTR_KIND,
    ATTR_MINUTE,
    ATTR_MINUTES,
    ATTR_NAME,
    ATTR_ON,
    ATTR_OPCODE,
    ATTR_PAYLOAD_HEX,
    ATTR_PLAYLIST,
    ATTR_REPEAT,
    ATTR_SECOND,
    ATTR_SECONDS,
    ATTR_SEED,
    ATTR_SHOW_SECONDS,
    ATTR_SLOT,
    ATTR_SMOOTH,
    ATTR_SPEED,
    ATTR_START,
    ATTR_START_HOUR,
    ATTR_START_MINUTE,
    ATTR_STYLE,
    ATTR_TEXT,
    ATTR_TIME,
    ATTR_TIMEOUT_S,
    ATTR_TIMER_SWITCHES,
    ATTR_URL,
    CLOCK_COLOR_MAX,
    CLOCK_COLOR_MIN,
    CLOCK_STYLE_MAX,
    CLOCK_STYLE_MIN,
    DEFAULT_SLOT,
    DOMAIN,
    GENERATIVE_KINDS,
    GENERATIVE_SECONDS_MAX,
    GENERATIVE_SECONDS_MIN,
    MAX_ALARMS,
    MAX_TIMER_SWITCHES,
    MAX_TOMATO_ENTRIES,
    MIN_TOMATO_ENTRIES,
    NIGHT_MODE_BRIGHTNESS_MAX,
    NIGHT_MODE_BRIGHTNESS_MIN,
    NIGHT_MODE_VOICE_SENSITIVITY_MAX,
    NIGHT_MODE_VOICE_SENSITIVITY_MIN,
    NIGHT_MODE_WAKE_MINUTES_MAX,
    NIGHT_MODE_WAKE_MINUTES_MIN,
    PLAYLIST_DURATION_MAX_S,
    PLAYLIST_DURATION_MIN_S,
    REMINDER_DURATIONS_S,
    REMINDER_KINDS,
    REMINDER_REPEATS,
    REQUEST_TIMEOUT_S,
    SCOREBOARD_MINUTES_MAX,
    SCOREBOARD_MINUTES_MIN,
    SCOREBOARD_SCORE_MAX,
    SCOREBOARD_SCORE_MIN,
    SCOREBOARD_SECONDS_MAX,
    SCOREBOARD_SECONDS_MIN,
    SERVICE_CLOCK_FACE,
    SERVICE_COUNTDOWN_RESET,
    SERVICE_COUNTDOWN_RUN,
    SERVICE_NIGHT_MODE,
    SERVICE_RELEASE_LINK,
    SERVICE_SWITCH_SCREEN,
    SERVICE_REMINDER_DELETE,
    SERVICE_REMINDER_SET,
    SERVICE_REMINDER_SET_ENABLED,
    SERVICE_SCOREBOARD_RUN,
    SERVICE_SCOREBOARD_SET_SCORE,
    SERVICE_SCOREBOARD_SET_TIME,
    SERVICE_SEND_RAW,
    SERVICE_SET_ALARMS,
    SERVICE_SET_PLAYLIST,
    SERVICE_SET_POMODORO,
    SERVICE_SET_TIMER_SWITCHES,
    SERVICE_SHOW_DESIGN,
    SERVICE_SHOW_GENERATIVE,
    SERVICE_SHOW_IMAGE,
    SERVICE_SHOW_TEXT,
    SERVICE_STOPWATCH_RESET,
    SERVICE_STOPWATCH_RUN,
    SERVICE_SYNC_TIME,
    SLOTS,
    TEXT_COLOR_MODE_MAX,
    TEXT_COLOR_MODE_MIN,
    TEXT_MODE_MAX_LENGTH,
    TOMATO_MINUTES_MAX,
    TOMATO_MINUTES_MIN,
    WIRE_BYTE_MAX,
)
from .coordinator import (
    IledClockCoordinator,
    alarm_item_from_service,
    timer_switch_item_from_service,
)
from .playlist import PlaylistValidationError, validate_playlist

ATTR_DEVICE_ID = "device_id"


def _coordinator_for_device(hass: HomeAssistant, device_id: str) -> IledClockCoordinator:
    """Resolve a service call's target device to its coordinator."""
    device = dr.async_get(hass).async_get(device_id)
    if device is not None:
        for entry_id in device.config_entries:
            entry = hass.config_entries.async_get_entry(entry_id)
            if (
                entry is not None
                and entry.domain == DOMAIN
                and entry.state is ConfigEntryState.LOADED
            ):
                return entry.runtime_data
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_device",
        translation_placeholders={"device_id": device_id},
    )


def _playback_overrides(call: ServiceCall) -> dict[str, Any]:
    """The Speed / Smooth motion a show service was given, as the keys `iledclock/show` understands;
    empty when the caller left them out."""
    overrides: dict[str, Any] = {}
    if ATTR_SPEED in call.data:
        overrides["speed"] = call.data[ATTR_SPEED]
    if ATTR_SMOOTH in call.data:
        overrides["smooth"] = "on" if call.data[ATTR_SMOOTH] else "off"
    return overrides


async def _async_guard(coro: Any) -> Any:
    """Every handler funnels its actual work through this so a client/protocol failure becomes
    a proper `HomeAssistantError` for the caller (automation trace, UI toast) instead of an
    opaque stack trace."""
    try:
        return await coro
    except IledClockError as err:
        raise HomeAssistantError(str(err)) from err
    except (ValueError, KeyError) as err:
        raise ServiceValidationError(str(err)) from err


_DEVICE_ID = {vol.Required(ATTR_DEVICE_ID): cv.string}
_HOUR = vol.All(vol.Coerce(int), vol.Range(min=0, max=23))
_MINUTE = vol.All(vol.Coerce(int), vol.Range(min=0, max=59))
_SECOND = vol.All(vol.Coerce(int), vol.Range(min=0, max=59))
_REPEAT = vol.All(vol.Coerce(int), vol.Range(min=0, max=0x7F))

#: The Speed slider of Pixel Studio: 0 = a still picture, 100 = the fastest the clock can play. Left out,
#: the design's own saved speed (or the animation's own timing, or a text's own scroll pace) is used.
_PLAYBACK_SPEED = vol.All(vol.Coerce(float), vol.Range(min=0, max=100))
_PLAYBACK_FIELDS = {
    vol.Optional(ATTR_SPEED): _PLAYBACK_SPEED,
    vol.Optional(ATTR_SMOOTH): cv.boolean,
}
#: Which of the clock's two screens (the power button switches between them) a show goes to: A, the program
#: list, unless told otherwise. B, the clock-page store, only takes clock-type pages for now.
_SLOT_FIELD = {vol.Optional(ATTR_SLOT, default=DEFAULT_SLOT): vol.In(SLOTS)}
_RGB = vol.All(cv.ensure_list, [vol.All(vol.Coerce(int), vol.Range(min=0, max=255))], vol.Length(min=3, max=3))

SHOW_TEXT_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Required(ATTR_TEXT): vol.All(cv.string, vol.Length(max=TEXT_MODE_MAX_LENGTH)),
        vol.Optional(ATTR_COLOR, default=lambda: [255, 255, 255]): _RGB,
        vol.Optional(ATTR_COLOR_MODE, default=1): vol.All(
            vol.Coerce(int), vol.Range(min=TEXT_COLOR_MODE_MIN, max=TEXT_COLOR_MODE_MAX)
        ),
        vol.Optional(ATTR_FONT): cv.string,
        vol.Optional(ATTR_IS_BOLD, default=False): cv.boolean,
        vol.Optional(ATTR_DURATION_S): vol.All(
            vol.Coerce(int), vol.Range(min=PLAYLIST_DURATION_MIN_S, max=PLAYLIST_DURATION_MAX_S)
        ),
        **_PLAYBACK_FIELDS,
        **_SLOT_FIELD,
    }
)
SHOW_DESIGN_SCHEMA = vol.Schema(
    {**_DEVICE_ID, vol.Required(ATTR_DESIGN_ID): cv.string, **_PLAYBACK_FIELDS, **_SLOT_FIELD}
)
SHOW_IMAGE_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Optional(ATTR_URL): cv.string,
        vol.Optional(ATTR_DATA_B64): cv.string,
        vol.Optional(ATTR_FIT, default="contain"): vol.In(("contain", "cover", "stretch")),
        vol.Optional(ATTR_DITHER, default=True): cv.boolean,
        **_PLAYBACK_FIELDS,
        **_SLOT_FIELD,
    }
)
SHOW_GENERATIVE_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Required(ATTR_KIND): vol.In(GENERATIVE_KINDS),
        vol.Optional(ATTR_SECONDS, default=10): vol.All(
            vol.Coerce(int), vol.Range(min=GENERATIVE_SECONDS_MIN, max=GENERATIVE_SECONDS_MAX)
        ),
        vol.Optional(ATTR_SEED): vol.Coerce(int),
        **_PLAYBACK_FIELDS,
        **_SLOT_FIELD,
    }
)
SET_PLAYLIST_SCHEMA = vol.Schema(
    {**_DEVICE_ID, vol.Required(ATTR_PLAYLIST): vol.All(cv.ensure_list, [dict])}
)
CLOCK_FACE_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Required(ATTR_STYLE): vol.All(vol.Coerce(int), vol.Range(min=CLOCK_STYLE_MIN, max=CLOCK_STYLE_MAX)),
        vol.Required(ATTR_COLOR): vol.All(vol.Coerce(int), vol.Range(min=CLOCK_COLOR_MIN, max=CLOCK_COLOR_MAX)),
        vol.Optional(ATTR_HOURS24, default=True): cv.boolean,
        vol.Optional(ATTR_SHOW_SECONDS, default=False): cv.boolean,
        vol.Optional(ATTR_BACKGROUND, default=True): cv.boolean,
        **_SLOT_FIELD,
    }
)
COUNTDOWN_RESET_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Optional(ATTR_HOUR, default=0): _HOUR,
        vol.Optional(ATTR_MINUTE, default=0): _MINUTE,
        vol.Optional(ATTR_SECOND, default=0): _SECOND,
    }
)
START_SCHEMA = vol.Schema({**_DEVICE_ID, vol.Required(ATTR_START): cv.boolean})
DEVICE_ONLY_SCHEMA = vol.Schema(_DEVICE_ID)
SCOREBOARD_SET_SCORE_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Required(ATTR_HOME): vol.All(vol.Coerce(int), vol.Range(min=SCOREBOARD_SCORE_MIN, max=SCOREBOARD_SCORE_MAX)),
        vol.Required(ATTR_AWAY): vol.All(vol.Coerce(int), vol.Range(min=SCOREBOARD_SCORE_MIN, max=SCOREBOARD_SCORE_MAX)),
    }
)
SCOREBOARD_SET_TIME_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Required(ATTR_MINUTE): vol.All(
            vol.Coerce(int), vol.Range(min=SCOREBOARD_MINUTES_MIN, max=SCOREBOARD_MINUTES_MAX)
        ),
        vol.Required(ATTR_SECOND): vol.All(
            vol.Coerce(int), vol.Range(min=SCOREBOARD_SECONDS_MIN, max=SCOREBOARD_SECONDS_MAX)
        ),
        vol.Optional(ATTR_COUNT_DOWN, default=True): cv.boolean,
    }
)
_ALARM_ITEM = vol.Schema(
    {
        vol.Required(ATTR_HOUR): _HOUR,
        vol.Required(ATTR_MINUTE): _MINUTE,
        vol.Optional(ATTR_ENABLED, default=True): cv.boolean,
        vol.Optional(ATTR_REPEAT, default=0): _REPEAT,
    }
)
SET_ALARMS_SCHEMA = vol.Schema(
    {**_DEVICE_ID, vol.Required(ATTR_ALARMS): vol.All(cv.ensure_list, [_ALARM_ITEM], vol.Length(max=MAX_ALARMS))}
)
_TIMER_SWITCH_ITEM = vol.Schema(
    {
        vol.Required(ATTR_HOUR): _HOUR,
        vol.Required(ATTR_MINUTE): _MINUTE,
        vol.Required(ATTR_ON): cv.boolean,
        vol.Optional(ATTR_ENABLED, default=True): cv.boolean,
        vol.Optional(ATTR_REPEAT, default=0): _REPEAT,
    }
)
SET_TIMER_SWITCHES_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Required(ATTR_TIMER_SWITCHES): vol.All(
            cv.ensure_list, [_TIMER_SWITCH_ITEM], vol.Length(max=MAX_TIMER_SWITCHES)
        ),
    }
)
SET_POMODORO_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Required(ATTR_MINUTES): vol.All(
            cv.ensure_list,
            [vol.All(vol.Coerce(int), vol.Range(min=TOMATO_MINUTES_MIN, max=TOMATO_MINUTES_MAX))],
            vol.Length(min=MIN_TOMATO_ENTRIES, max=MAX_TOMATO_ENTRIES),
        ),
    }
)
NIGHT_MODE_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Required(ATTR_ENABLED): cv.boolean,
        vol.Required(ATTR_START_HOUR): _HOUR,
        vol.Required(ATTR_START_MINUTE): _MINUTE,
        vol.Required(ATTR_END_HOUR): _HOUR,
        vol.Required(ATTR_END_MINUTE): _MINUTE,
        vol.Optional("device_off", default=False): cv.boolean,
        vol.Optional("brightness", default=50): vol.All(
            vol.Coerce(int), vol.Range(min=NIGHT_MODE_BRIGHTNESS_MIN, max=NIGHT_MODE_BRIGHTNESS_MAX)
        ),
        vol.Optional("wake_minutes", default=5): vol.All(
            vol.Coerce(int), vol.Range(min=NIGHT_MODE_WAKE_MINUTES_MIN, max=NIGHT_MODE_WAKE_MINUTES_MAX)
        ),
        vol.Optional("voice", default=False): cv.boolean,
        vol.Optional("voice_sensitivity", default=5): vol.All(
            vol.Coerce(int), vol.Range(min=NIGHT_MODE_VOICE_SENSITIVITY_MIN, max=NIGHT_MODE_VOICE_SENSITIVITY_MAX)
        ),
    }
)
#: Alarms & reminders (docs/SLOTS-AND-REMINDERS.md). `days` are weekday names here ("mon" .. "sun"); the studio's
#: websocket commands use numbers 0 (Monday) to 6 (Sunday) for the same thing.
REMINDER_SET_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Optional(ATTR_KEY): cv.string,
        vol.Required(ATTR_NAME): cv.string,
        vol.Optional(ATTR_KIND): vol.In(REMINDER_KINDS),
        vol.Required(ATTR_TIME): cv.time,
        vol.Optional(ATTR_DATE): cv.date,
        vol.Optional(ATTR_REPEAT): vol.In(REMINDER_REPEATS),
        vol.Optional(ATTR_DAYS): cv.weekdays,
        vol.Optional(ATTR_DURATION_S): vol.All(vol.Coerce(int), vol.In(REMINDER_DURATIONS_S)),
        vol.Optional(ATTR_DESIGN_ID): cv.string,
        vol.Optional(ATTR_ENABLED): cv.boolean,
    }
)
REMINDER_SET_ENABLED_SCHEMA = vol.Schema(
    {**_DEVICE_ID, vol.Required(ATTR_KEY): cv.string, vol.Required(ATTR_ENABLED): cv.boolean}
)
REMINDER_DELETE_SCHEMA = vol.All(
    vol.Schema(
        {
            **_DEVICE_ID,
            vol.Exclusive(ATTR_ID, "target"): vol.Coerce(int),
            vol.Exclusive(ATTR_KEY, "target"): cv.string,
        }
    ),
    cv.has_at_least_one_key(ATTR_ID, ATTR_KEY),
)
SEND_RAW_SCHEMA = vol.Schema(
    {
        **_DEVICE_ID,
        vol.Required(ATTR_OPCODE): vol.All(vol.Coerce(int), vol.Range(min=0, max=WIRE_BYTE_MAX)),
        vol.Optional(ATTR_PAYLOAD_HEX, default=""): cv.string,
        vol.Optional(ATTR_TIMEOUT_S, default=REQUEST_TIMEOUT_S): vol.All(
            vol.Coerce(float), vol.Range(min=0.1, max=60)
        ),
    }
)


def async_setup_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_SHOW_TEXT):
        return

    async def show_text(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        spec: dict[str, Any] = {
            "type": "text",
            ATTR_TEXT: call.data[ATTR_TEXT],
            ATTR_COLOR: call.data[ATTR_COLOR],
            # The vendor's colour mode, kept as the service's `color_mode`: only 1 (one colour), 2 (rainbow
            # along the text) and 4 (every letter its own colour) look different. On record it is the `effect`.
            "effect": call.data[ATTR_COLOR_MODE],
            ATTR_IS_BOLD: call.data[ATTR_IS_BOLD],
            **_playback_overrides(call),
        }
        if ATTR_FONT in call.data:
            spec[ATTR_FONT] = call.data[ATTR_FONT]
        await _async_guard(
            coordinator.async_show(
                spec, slot=call.data[ATTR_SLOT], restore_after_s=call.data.get(ATTR_DURATION_S)
            )
        )

    async def show_design(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(
            coordinator.async_show(
                {"type": "design", ATTR_DESIGN_ID: call.data[ATTR_DESIGN_ID], **_playback_overrides(call)},
                slot=call.data[ATTR_SLOT],
            )
        )

    async def show_image(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        if not call.data.get(ATTR_URL) and not call.data.get(ATTR_DATA_B64):
            raise ServiceValidationError("show_image requires either url or data_b64")
        await _async_guard(
            coordinator.async_show(
                {
                    "type": "image",
                    ATTR_URL: call.data.get(ATTR_URL),
                    ATTR_DATA_B64: call.data.get(ATTR_DATA_B64),
                    ATTR_FIT: call.data[ATTR_FIT],
                    ATTR_DITHER: call.data[ATTR_DITHER],
                    **_playback_overrides(call),
                },
                slot=call.data[ATTR_SLOT],
            )
        )

    async def show_generative(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(
            coordinator.async_show(
                {
                    "type": "generative",
                    ATTR_KIND: call.data[ATTR_KIND],
                    ATTR_SECONDS: call.data[ATTR_SECONDS],
                    ATTR_SEED: call.data.get(ATTR_SEED),
                    **_playback_overrides(call),
                },
                slot=call.data[ATTR_SLOT],
            )
        )

    async def set_playlist(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        try:
            items = validate_playlist(call.data[ATTR_PLAYLIST])
        except PlaylistValidationError as err:
            raise ServiceValidationError(str(err)) from err
        await _async_guard(coordinator.async_set_playlist(items))

    async def clock_face(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(
            coordinator.async_set_clock_face(
                call.data[ATTR_STYLE], call.data[ATTR_COLOR], call.data[ATTR_HOURS24], call.data[ATTR_SHOW_SECONDS],
                background=call.data[ATTR_BACKGROUND],
                slot=call.data[ATTR_SLOT],
            )
        )

    async def countdown_reset(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(
            coordinator.async_countdown_reset(call.data[ATTR_HOUR], call.data[ATTR_MINUTE], call.data[ATTR_SECOND])
        )

    async def countdown_run(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(coordinator.async_countdown_run(call.data[ATTR_START]))

    async def stopwatch_reset(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(coordinator.async_stopwatch_reset())

    async def stopwatch_run(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(coordinator.async_stopwatch_run(call.data[ATTR_START]))

    async def scoreboard_set_score(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(coordinator.async_scoreboard_set_score(call.data[ATTR_HOME], call.data[ATTR_AWAY]))

    async def scoreboard_set_time(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(
            coordinator.async_scoreboard_set_time(
                call.data[ATTR_MINUTE], call.data[ATTR_SECOND], call.data[ATTR_COUNT_DOWN]
            )
        )

    async def scoreboard_run(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(coordinator.async_scoreboard_run(call.data[ATTR_START]))

    async def set_alarms(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        alarms = [
            alarm_item_from_service(
                hour=item[ATTR_HOUR], minute=item[ATTR_MINUTE], enabled=item[ATTR_ENABLED], repeat=item[ATTR_REPEAT]
            )
            for item in call.data[ATTR_ALARMS]
        ]
        await _async_guard(coordinator.async_set_alarms(alarms))

    async def set_timer_switches(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        items = [
            timer_switch_item_from_service(
                hour=item[ATTR_HOUR], minute=item[ATTR_MINUTE], on=item[ATTR_ON],
                enabled=item[ATTR_ENABLED], repeat=item[ATTR_REPEAT],
            )
            for item in call.data[ATTR_TIMER_SWITCHES]
        ]
        await _async_guard(coordinator.async_set_timer_switches(items))

    async def set_pomodoro(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(coordinator.async_set_pomodoro(call.data[ATTR_MINUTES]))

    async def night_mode(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(
            coordinator.async_set_night_mode(
                enabled=call.data[ATTR_ENABLED],
                start_hour=call.data[ATTR_START_HOUR],
                start_minute=call.data[ATTR_START_MINUTE],
                end_hour=call.data[ATTR_END_HOUR],
                end_minute=call.data[ATTR_END_MINUTE],
                device_state_enabled=not call.data["device_off"],  # the clock's flag keeps the display on
                brightness=call.data["brightness"],
                wake_up_duration=call.data["wake_minutes"],
                voice_control_enabled=call.data["voice"],
                voice_sensitivity=call.data["voice_sensitivity"],
            )
        )

    async def reminder_set(call: ServiceCall) -> dict[str, Any]:
        """Create (no `key`) or edit (`key`) an alarm or reminder; what the call leaves out keeps its value on an
        edit and takes its default on a new one. Answers `{"item": ...}` to a caller that asks for a response, so
        an automation can learn the `key` of what it made."""
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        data = call.data
        raw: dict[str, Any] = {"name": data[ATTR_NAME], "hour": data[ATTR_TIME].hour, "minute": data[ATTR_TIME].minute}
        for attribute, field in ((ATTR_KEY, "key"), (ATTR_KIND, "kind"), (ATTR_REPEAT, "repeat"),
                                 (ATTR_DURATION_S, "duration_s"), (ATTR_ENABLED, "enabled")):
            if attribute in data:
                raw[field] = data[attribute]
        if ATTR_DATE in data:
            raw["date"] = data[ATTR_DATE].isoformat()
        if ATTR_DAYS in data:
            raw["days"] = [WEEKDAYS.index(day) for day in data[ATTR_DAYS]]
        if ATTR_DESIGN_ID in data:  # an empty design id means "draw the name as text"
            design_id = data[ATTR_DESIGN_ID]
            raw["attachment"] = {"kind": "design", "design_id": design_id} if design_id else {"kind": "text"}
        return {"item": await _async_guard(coordinator.reminders.async_save(raw))}

    async def reminder_set_enabled(call: ServiceCall) -> dict[str, Any]:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        item = await _async_guard(
            coordinator.reminders.async_set_enabled(call.data[ATTR_KEY], call.data[ATTR_ENABLED])
        )
        return {"item": item}

    async def reminder_delete(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        if ATTR_KEY in call.data:
            await _async_guard(coordinator.reminders.async_delete(key=call.data[ATTR_KEY]))
        else:
            await _async_guard(coordinator.async_reminder_delete(call.data[ATTR_ID]))

    async def sync_time(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(coordinator.async_sync_time())

    async def release_link(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(coordinator.async_release_link())

    async def send_raw(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(
            coordinator.async_send_raw(
                call.data[ATTR_OPCODE], call.data[ATTR_PAYLOAD_HEX], call.data[ATTR_TIMEOUT_S]
            )
        )

    async def switch_screen(call: ServiceCall) -> None:
        coordinator = _coordinator_for_device(hass, call.data[ATTR_DEVICE_ID])
        await _async_guard(coordinator.async_switch_screen())

    hass.services.async_register(DOMAIN, SERVICE_SHOW_TEXT, show_text, schema=SHOW_TEXT_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SHOW_DESIGN, show_design, schema=SHOW_DESIGN_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SHOW_IMAGE, show_image, schema=SHOW_IMAGE_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SHOW_GENERATIVE, show_generative, schema=SHOW_GENERATIVE_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SET_PLAYLIST, set_playlist, schema=SET_PLAYLIST_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_CLOCK_FACE, clock_face, schema=CLOCK_FACE_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_COUNTDOWN_RESET, countdown_reset, schema=COUNTDOWN_RESET_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_COUNTDOWN_RUN, countdown_run, schema=START_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_STOPWATCH_RESET, stopwatch_reset, schema=DEVICE_ONLY_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_STOPWATCH_RUN, stopwatch_run, schema=START_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_SCOREBOARD_SET_SCORE, scoreboard_set_score, schema=SCOREBOARD_SET_SCORE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SCOREBOARD_SET_TIME, scoreboard_set_time, schema=SCOREBOARD_SET_TIME_SCHEMA
    )
    hass.services.async_register(DOMAIN, SERVICE_SCOREBOARD_RUN, scoreboard_run, schema=START_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SET_ALARMS, set_alarms, schema=SET_ALARMS_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_SET_TIMER_SWITCHES, set_timer_switches, schema=SET_TIMER_SWITCHES_SCHEMA
    )
    hass.services.async_register(DOMAIN, SERVICE_SET_POMODORO, set_pomodoro, schema=SET_POMODORO_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_NIGHT_MODE, night_mode, schema=NIGHT_MODE_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_REMINDER_SET, reminder_set, schema=REMINDER_SET_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_REMINDER_SET_ENABLED, reminder_set_enabled, schema=REMINDER_SET_ENABLED_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(DOMAIN, SERVICE_REMINDER_DELETE, reminder_delete, schema=REMINDER_DELETE_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SYNC_TIME, sync_time, schema=DEVICE_ONLY_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_RELEASE_LINK, release_link, schema=DEVICE_ONLY_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SEND_RAW, send_raw, schema=SEND_RAW_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_SWITCH_SCREEN, switch_screen, schema=DEVICE_ONLY_SCHEMA)
