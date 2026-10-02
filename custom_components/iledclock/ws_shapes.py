"""Pure JSON-shape builders for the websocket API (Contract D).

Kept separate from `websocket_api.py`'s `homeassistant.components.websocket_api` glue so the
shapes themselves -- the thing the frontend actually depends on -- are unit-testable without
homeassistant installed. Field names here are the wire contract agreed with the frontend agent
(see the `iledclock/state` / `designs/list` / upload-progress payloads below); changing any of
them is a cross-agent breaking change, not a local refactor.
"""

from __future__ import annotations

import base64
from typing import Any, Sequence

from . import hardware
from .const import (
    CLOCK_STYLE_MAX,
    DISPLAY_WIDTH,
    MAX_ALARMS,
    MAX_PLAYLIST_ITEMS,
    MAX_TIMER_SWITCHES,
    REMINDER_DURATIONS_S,
    REMINDER_MAX_FRAMES,
    REMINDER_NAME_MAX_UTF16,
    REMINDER_REPEATS,
    SLOT_B,
    SLOTS,
    TEXT_COLOR_MODE_MAX,
)
from .designs import Design
from .playlist import PlaylistItem, playlist_item_to_json
from .retime import Retimed
from .slots import slot_accepts
from .state import (
    AlarmState,
    ClockState,
    CountdownState,
    NightModeState,
    ReminderState,
    ScoreboardState,
    StopwatchState,
    TimerSwitchState,
)


def shape_night_mode(night_mode: NightModeState | None) -> dict[str, Any] | None:
    if night_mode is None:
        return None
    return {
        "enabled": night_mode.enabled,
        "start_h": night_mode.start_h,
        "start_m": night_mode.start_m,
        "end_h": night_mode.end_h,
        "end_m": night_mode.end_m,
        "device_off": night_mode.device_off,
        "brightness": night_mode.brightness,
        "wake_minutes": night_mode.wake_minutes,
        "voice": night_mode.voice,
        "voice_sensitivity": night_mode.voice_sensitivity,
    }


def shape_alarm(alarm: AlarmState) -> dict[str, Any]:
    return {
        "id": alarm.id,
        "hour": alarm.hour,
        "minute": alarm.minute,
        "enabled": alarm.enabled,
        "repeat": alarm.repeat,
    }


def shape_timer_switch(item: TimerSwitchState) -> dict[str, Any]:
    return {
        "index": item.index,
        "hour": item.hour,
        "minute": item.minute,
        "on": item.on,
        "enabled": item.enabled,
        "repeat": item.repeat,
    }


def shape_reminder(reminder: ReminderState) -> dict[str, Any]:
    """One reminder as the clock reports it (`ReminderItem` of types.ts): `year` is the real calendar year,
    `repeat_type` the clock's own 0-4 enum, `week_mask` Mon = bit 0 .. Sun = bit 6."""
    return {
        "id": reminder.id,
        "content": reminder.content,
        "year": reminder.year,
        "month": reminder.month,
        "day": reminder.day,
        "hour": reminder.hour,
        "minute": reminder.minute,
        "repeat_type": reminder.repeat_type,
        "week_mask": reminder.week_mask,
        "duration": reminder.duration,
        "sound": reminder.sound,
    }


def shape_countdown(countdown: CountdownState | None) -> dict[str, Any] | None:
    if countdown is None:
        return None
    return {
        "hours": countdown.hours,
        "minutes": countdown.minutes,
        "seconds": countdown.seconds,
        "running": countdown.running,
    }


def shape_stopwatch(stopwatch: StopwatchState | None) -> dict[str, Any] | None:
    if stopwatch is None:
        return None
    return {
        "hours": stopwatch.hours,
        "minutes": stopwatch.minutes,
        "seconds": stopwatch.seconds,
        "running": stopwatch.running,
    }


def shape_scoreboard(scoreboard: ScoreboardState | None) -> dict[str, Any] | None:
    if scoreboard is None:
        return None
    return {
        "home": scoreboard.home,
        "away": scoreboard.away,
        "minutes": scoreboard.minutes,
        "seconds": scoreboard.seconds,
        "count_down": scoreboard.count_down,
        "running": scoreboard.running,
    }


def shape_clock_state(state: ClockState) -> dict[str, Any]:
    """The nested `state` object in Contract D's `iledclock/state` response."""
    return {
        "power": state.power,
        "brightness": state.brightness,
        "rotate": state.rotate,
        "mirror": state.mirror,
        "volume": state.volume,
        "firmware": state.firmware,
        "program_slots": state.program_slots,
        "color_mode": state.color_mode,
        "color_speed": state.color_speed,
        "night_mode": shape_night_mode(state.night_mode),
        "countdown": shape_countdown(state.countdown),
        "stopwatch": shape_stopwatch(state.stopwatch),
        "scoreboard": shape_scoreboard(state.scoreboard),
        "tomato": {"minutes": list(state.tomato.minutes)} if state.tomato is not None else None,
        "temperature": state.temperature,
        "humidity": state.humidity,
        "timer_switches": [shape_timer_switch(item) for item in state.timer_switches],
        "alarms": [shape_alarm(alarm) for alarm in state.alarms],
        "reminders": [shape_reminder(reminder) for reminder in state.reminders],
    }


def shape_capabilities(state: ClockState) -> dict[str, Any]:
    """Static device limits plus the two facts we can only know from having actually seen a
    reading (`has_temperature`/`has_humidity`: not every unit reports both sensors), plus the
    current values of the live-unverified capability flags in `hardware` (screen B contents, the
    reminder id range and week-mask support) so Pixel Studio never hard-codes them."""
    return {
        "max_playlist_items": MAX_PLAYLIST_ITEMS,
        "clock_styles": CLOCK_STYLE_MAX,
        "text_color_modes": TEXT_COLOR_MODE_MAX,
        "max_alarms": MAX_ALARMS,
        "max_timer_switches": MAX_TIMER_SWITCHES,
        "max_reminders": hardware.REMINDER_CAPACITY,
        "has_temperature": state.temperature is not None,
        "has_humidity": state.humidity is not None,
        "slots": {"ids": list(SLOTS), "b_accepts": list(slot_accepts(SLOT_B))},
        "reminders": {
            "capacity": hardware.REMINDER_CAPACITY,
            "id_min": hardware.REMINDER_ID_MIN,
            "id_max": hardware.REMINDER_ID_MAX,
            "week_mask": hardware.REMINDER_WEEK_MASK_SUPPORTED,
            "name_max": REMINDER_NAME_MAX_UTF16,
            "durations": list(REMINDER_DURATIONS_S),
            "repeats": list(REMINDER_REPEATS),
            "max_frames": REMINDER_MAX_FRAMES,
        },
    }


def shape_playlist(items: Sequence[PlaylistItem]) -> list[dict[str, Any]]:
    return [playlist_item_to_json(item) for item in items]


def shape_state_event(
    *,
    connected: bool,
    busy: bool,
    state: ClockState,
    playlist: Sequence[PlaylistItem],
    now_showing: dict[str, Any] | None = None,
    show_history: Sequence[dict[str, Any]] = (),
    slots: dict[str, Any] | None = None,
    reminder_list: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Contract D `iledclock/state` response and every `iledclock/subscribe` push:
    `{connected, busy, state, playlist, capabilities, now_showing, history, slots, reminder_list}`.
    `slots` is the JSON the slot store builds (`{"a": record|null, "b": record|null,
    "last_written": "a"|"b"|null}`); `reminder_list` the JSON the reminder manager builds (null
    until the manager exists or the clock has never been read). See docs/SLOTS-AND-REMINDERS.md."""
    return {
        "connected": connected,
        "busy": busy,
        "state": shape_clock_state(state),
        "playlist": shape_playlist(playlist),
        "capabilities": shape_capabilities(state),
        "now_showing": dict(now_showing) if now_showing is not None else None,
        "history": [dict(item) for item in show_history],
        "slots": dict(slots) if slots is not None else {"a": None, "b": None, "last_written": None},
        "reminder_list": dict(reminder_list) if reminder_list is not None else None,
    }


def shape_design_summary(design: Design) -> dict[str, Any]:
    """Contract D `designs/list` entry."""
    return design.to_json()


def shape_designs_list(designs: Sequence[Design]) -> list[dict[str, Any]]:
    return [shape_design_summary(design) for design in designs]


def shape_frames_payload(frames: Sequence[bytes], delays_ms: Sequence[int]) -> dict[str, Any]:
    """`iledclock/render` result: `{frames: [b64 rgb888], delays: [ms]}`."""
    return {
        "frames": [base64.b64encode(frame).decode("ascii") for frame in frames],
        "delays": list(delays_ms),
    }


def _pad_rgb888(frame: bytes, width: int) -> bytes:
    """Black columns on the right so an art-width frame fills the panel again."""
    full = DISPLAY_WIDTH
    if width >= full:
        return frame
    stride, blank = width * 3, bytes((full - width) * 3)
    return b"".join(frame[at : at + stride] + blank for at in range(0, len(frame), stride))


def shape_playback_payload(played: Retimed, width: int) -> dict[str, Any]:
    """`iledclock/playback/preview` result: the frames and delays the clock will play (padded back to
    the full panel when only `width` art columns are played) and what smoothing did to them."""
    payload = shape_frames_payload([_pad_rgb888(frame, width) for frame in played.frames], played.delays_ms)
    payload["playback"] = played.info.to_json()
    return payload


def shape_upload_progress(
    *,
    state: str,
    program: int,
    programs: int,
    chunk: int,
    chunks: int,
    error: str | None = None,
) -> dict[str, Any]:
    """Base progress fields shared by dispatcher pushes. The coordinator preserves these fields
    and adds `upload: {done, total}` while sending, then `upload: null` at completion or failure."""
    payload: dict[str, Any] = {
        "type": "upload",
        "state": state,
        "program": program,
        "programs": programs,
        "chunk": chunk,
        "chunks": chunks,
    }
    if error is not None:
        payload["error"] = error
    return payload
