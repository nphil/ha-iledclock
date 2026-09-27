"""The aggregate clock state the coordinator maintains (Contract B/C).

A single periodic refresh cycle issues several independent protocol requests (device info,
night mode, alarms, timer switches, tomato, reminders, temperature/humidity, countdown/
stopwatch/scoreboard status) and each of those can also be refreshed individually right after a
service call changes it (e.g. `set_alarms` re-reads only alarms, not the whole device). `merge_state`
is how a partial result -- "here is the new value for these fields" -- gets folded onto the
previous `ClockState` without disturbing anything that round didn't touch.

Deliberately decoupled from `protocol.responses`' dataclasses: this module has zero imports from
`protocol` (or `homeassistant`) so it stays importable and unit-testable on its own, and so a
field-naming choice on either side of that boundary is a one-line adapter fix in coordinator.py
rather than a change here. Field names instead mirror the wire contract agreed with the frontend
for `iledclock/state` (Contract D) so `ws_shapes.py`'s job is a close-to-mechanical translation.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, replace
from typing import Any


@dataclass(frozen=True, slots=True)
class NightModeState:
    """docs/FEATURES-app.md #12."""

    enabled: bool
    start_h: int
    start_m: int
    end_h: int
    end_m: int
    device_off: bool
    brightness: int
    wake_minutes: int
    voice: bool
    voice_sensitivity: int


@dataclass(frozen=True, slots=True)
class AlarmState:
    """docs/FEATURES-app.md #11. `repeat` is a Mon..Sun bitmask (0 = once, 0x7f = every day)."""

    id: int
    hour: int
    minute: int
    enabled: bool
    repeat: int


@dataclass(frozen=True, slots=True)
class TimerSwitchState:
    """docs/FEATURES-app.md #13. `repeat` is a Mon..Sun bitmask like `AlarmState.repeat` (0 =
    once, 0x7f = every day) -- the device carries the same 7-day pattern for timer switches as
    it does for alarms even though the feature catalogue doesn't call that out explicitly."""

    index: int
    hour: int
    minute: int
    on: bool
    enabled: bool
    repeat: int


@dataclass(frozen=True, slots=True)
class ReminderState:
    """docs/FEATURES-app.md #21. `year` is the real calendar year (protocol's own year-offset-
    from-2000 encoding is a wire-level detail `protocol.responses` already resolves for us)."""

    id: int
    content: str
    year: int
    month: int
    day: int
    hour: int
    minute: int
    repeat: int


@dataclass(frozen=True, slots=True)
class CountdownState:
    """docs/FEATURES-app.md #7."""

    hours: int
    minutes: int
    seconds: int
    running: bool


@dataclass(frozen=True, slots=True)
class StopwatchState:
    """docs/FEATURES-app.md #8."""

    hours: int
    minutes: int
    seconds: int
    running: bool


@dataclass(frozen=True, slots=True)
class ScoreboardState:
    """docs/FEATURES-app.md #9."""

    home: int
    away: int
    minutes: int
    seconds: int
    count_down: bool
    running: bool


@dataclass(frozen=True, slots=True)
class TomatoState:
    """docs/FEATURES-app.md #10: 1-6 durations, in minutes."""

    minutes: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class ClockState:
    """Everything the coordinator knows about one clock. Every field defaults to "unknown"
    (`None`/empty) so a freshly-added config entry -- before its first successful refresh -- has
    a well-formed, honestly-empty state rather than fabricated zeros."""

    address: str
    connected: bool = False
    power: bool | None = None
    brightness: int | None = None
    #: No readback exists in `DeviceInfo` -- the device only reports the combined `rotate`
    #: mode, not a separate mirror flag. Set optimistically, locally, whenever we send
    #: `mirror(on)` ourselves; stays `None` ("unknown") until then.
    mirror: bool | None = None
    rotate: int | None = None
    volume: int | None = None
    color_mode: int | None = None
    color_speed: int | None = None
    firmware: int | None = None
    program_slots: int | None = None
    #: The two 0x1e device-setting booleans with recovered UI meaning (see switch.py). Not part
    #: of Contract D's websocket JSON (frontend has no use for them); carried here purely so the
    #: HA switch entities have something to read between refreshes.
    show_device_id: bool | None = None
    remote_enable: bool | None = None
    night_mode: NightModeState | None = None
    alarms: tuple[AlarmState, ...] = ()
    timer_switches: tuple[TimerSwitchState, ...] = ()
    tomato: TomatoState | None = None
    reminders: tuple[ReminderState, ...] = ()
    temperature: float | None = None
    humidity: float | None = None
    countdown: CountdownState | None = None
    stopwatch: StopwatchState | None = None
    scoreboard: ScoreboardState | None = None
    last_updated: float | None = None
    consecutive_failures: int = 0
    now_showing: dict[str, Any] | None = None
    show_history: tuple[dict[str, Any], ...] = ()

    def merge(self, **changes: Any) -> "ClockState":
        """Same as `merge_state(self, changes)`; convenience for call sites that already have
        the changes as keyword arguments."""
        return merge_state(self, changes)


_FIELD_NAMES = frozenset(f.name for f in dataclasses.fields(ClockState))


def merge_state(base: ClockState, changes: dict[str, Any]) -> ClockState:
    """Return a new `ClockState` with `changes` applied on top of `base`; every field not
    mentioned in `changes` keeps its previous value. Rejects unknown field names loudly (instead
    of silently accepting a typo) since a partial refresh writing to the wrong key would
    otherwise fail silently -- the field would just never appear to update."""
    unknown = set(changes) - _FIELD_NAMES
    if unknown:
        raise ValueError(f"unknown ClockState field(s): {sorted(unknown)}")
    return replace(base, **changes)
