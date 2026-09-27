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
from .const import (
    CLOCK_STYLE_MAX,
    MAX_ALARMS,
    MAX_PLAYLIST_ITEMS,
    MAX_REMINDERS,
    MAX_TIMER_SWITCHES,
    TEXT_COLOR_MODE_MAX,
)
from .clock_backgrounds import CLOCK_BACKGROUNDS, DATE_BACKGROUND, ClockBackground
from .designs import Design
from .playlist import PlaylistItem, playlist_item_to_json
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
    return {
        "id": reminder.id,
        "content": reminder.content,
        "year": reminder.year,
        "month": reminder.month,
        "day": reminder.day,
        "hour": reminder.hour,
        "minute": reminder.minute,
        "repeat": reminder.repeat,
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
    reading (`has_temperature`/`has_humidity`: not every unit reports both sensors)."""
    return {
        "max_playlist_items": MAX_PLAYLIST_ITEMS,
        "clock_styles": CLOCK_STYLE_MAX,
        "text_color_modes": TEXT_COLOR_MODE_MAX,
        "max_alarms": MAX_ALARMS,
        "max_timer_switches": MAX_TIMER_SWITCHES,
        "max_reminders": MAX_REMINDERS,
        "has_temperature": state.temperature is not None,
        "has_humidity": state.humidity is not None,
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
) -> dict[str, Any]:
    """Contract D `iledclock/state` response and every `iledclock/subscribe` push:
    `{connected, busy, state, playlist, capabilities, now_showing, history}`."""
    return {
        "connected": connected,
        "busy": busy,
        "state": shape_clock_state(state),
        "playlist": shape_playlist(playlist),
        "capabilities": shape_capabilities(state),
        "now_showing": dict(now_showing) if now_showing is not None else None,
        "history": [dict(item) for item in show_history],
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


def shape_clock_background(background: ClockBackground) -> dict[str, Any]:
    """One style's (or the date companion's) background animation, `iledclock/render`-shaped
    (`{frames: [b64 rgb888], delays: [ms]}`) so the frontend can reuse its existing base64
    RGB888 frame decoder (`design-codec.ts`'s `base64ToFrame`) unchanged."""
    return shape_frames_payload(background.frames, [background.delay_ms] * len(background.frames))


def shape_clock_backgrounds() -> dict[str, Any]:
    """`iledclock/clock_backgrounds` result: every firmware clock style's background plus the
    shared date-companion background, in one shot -- these are static bundled assets (not
    per-device state), so the frontend fetches this once per session and caches it."""
    return {
        "styles": {str(style): shape_clock_background(background) for style, background in CLOCK_BACKGROUNDS.items()},
        "date": shape_clock_background(DATE_BACKGROUND),
    }


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
