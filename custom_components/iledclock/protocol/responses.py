"""Port of ``DeviceManager.checkILedClockMessages`` (line 3636+) and the connect-time
device-info/OTA/password notification parsing.

Every reply arrives as a decoded, unescaped payload (``framing.decode_frame``'s output) —
opcode first. :func:`parse` dispatches on that opcode (and, for opcodes that carry one, a
second "sub-op" byte) into a frozen dataclass. :func:`response_key` computes the same
``(opcode, sub)`` shape from either a *request* payload (before sending) or a *reply*
payload (after receiving), so a client can correlate the two — see its docstring for the
opcodes where the vendor's own wire format has no sub-op byte at all (or has a byte in that
position that is request-specific data, not an echoed selector), where naively reading
``payload[1]`` would desynchronise request/reply matching.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Union

from .models import AlarmItem, NightMode, TimerSwitchItem, weekday_flags

#: Opcodes whose second byte is a genuine sub-operation that the device echoes back unchanged in
#: its reply (``0f 01`` -> ``0f 01 ...``), so request and reply share it and it must be part of the
#: correlation key. Every OTHER opcode keys on the opcode alone: its second byte is either absent
#: in the request or is data (a level, salt, count, calendar field) - and in replies it is often a
#: status value. Listing the sub-op opcodes (rather than the exceptions) keeps an unlisted opcode
#: from silently never matching: ``1f``'s reply byte[1] is the power flag and ``fd``'s is the OTA
#: flag, and keying on those made every device-info/firmware request time out on real hardware.
#: Verified against ``DeviceManager.checkILedClockMessages`` and the live captures in
#: ``tests/live_replies_2026-09-25.json``.
_SUBOP_OPCODES = frozenset(
    {
        0x0F,  # countdown: 01 status / 02 reset / 03 run
        0x10,  # stopwatch: 01 status / 02 reset / 03 run
        0x11,  # scoreboard: 01 status / 02 score / 03 time / 04 run
        0x13,  # colour: 01 rgb / 02 speed / 03 mode
        0x14,  # night mode: 01 set / 02 get
        0x15,  # pomodoro: 01 set / 02 get
        0x16,  # alarms: 01 set / 02 get
        0x19,  # temperature/humidity kind
        0x1A,  # reminders: 01 list / 02 detail / 03 delete
    }
)


def response_key(payload: bytes) -> tuple[int, int | None]:
    """``(opcode, sub)`` for correlating a request payload with its reply payload. ``sub`` is
    ``payload[1]`` for opcodes that carry a genuine, request/reply-shared sub-operation byte
    (0x0f/0x10/0x11/0x13/0x14/0x15/0x16/0x19/0x1a/0xfd), else always ``None`` — see
    :data:`_SUBOP_OPCODES`. Works identically on an unframed request payload (as built by
    ``commands.py``) and a decoded reply payload, which is the whole point.
    """
    if not payload:
        raise ValueError("empty payload has no response key")
    opcode = payload[0]
    if opcode in _SUBOP_OPCODES and len(payload) >= 2:
        return (opcode, payload[1])
    return (opcode, None)


# --- response dataclasses -----------------------------------------------------------------


@dataclass(frozen=True)
class DeviceInfo:
    """Opcode 0x1f (``getDeviceInfo``/``ILedClockDeviceInfoEvent``)."""

    is_switch_on_off: bool
    brightness: int
    rotate: int
    is_local_mic_supported: bool
    is_local_mic_on_off: bool
    local_mic_mode: int
    is_show_device_id: bool
    max_program_number: int
    is_remote_enable: bool
    is_mute: bool
    volume: int
    firmware_version: int
    raw: bytes


@dataclass(frozen=True)
class OtaVersion:
    """Opcode 0xfd (``getDeviceOTAVersion``)."""

    supported: bool
    version: int | None = None
    filename: str | None = None


@dataclass(frozen=True)
class PasswordResult:
    """Opcode 0x0d/0x0e ack (``check_password``/``set_password``)."""

    ok: bool


@dataclass(frozen=True)
class Ack:
    """Generic ``[opcode, (sub,) status]`` acknowledgement for opcodes with no richer reply
    shape (brightness/power/mirror-rotate echoes, sync_time/timer_switch_set/night_mode_set/
    alarms_set/reminder_delete/colour acks, ...). ``status == 0`` means success for every
    opcode that uses this shape (matching the vendor's own ``== 0`` success checks).
    """

    opcode: int
    sub: int | None
    status: int

    @property
    def ok(self) -> bool:
        return self.status == 0


@dataclass(frozen=True)
class ReminderDetail:
    """Opcode 0x1a 0x02 (``ILedCLockGetReminderDetailResponseEvent``)."""

    id: int
    sound: int
    year: int
    month: int
    day: int
    hour: int
    minute: int
    repeat_type: int
    duration: int
    content: str


@dataclass(frozen=True)
class TempHumidity:
    """Opcode 0x19 (``ILedClockGetTemperatureAndHumidityResponseEvent``, ``kind==1`` only —
    the device sends no reply at all for ``kind==0``, not a vendor parsing quirk on our end).
    """

    kind: int
    temperature: float
    humidity: int


@dataclass(frozen=True)
class CountdownStatus:
    """Opcode 0x0f, every reply shape (``ILedClockCountDownEventResponse``).

    ``action``: 1=status, 2=reset ack, 3=start/stop ack, 4=finished notification.
    ``success`` is only meaningful for ``action == 2``.
    """

    action: int
    running: bool = False
    set_hour: int = 0
    set_minute: int = 0
    set_seconds: int = 0
    left_hour: int = 0
    left_minute: int = 0
    left_seconds: int = 0
    success: bool = True


@dataclass(frozen=True)
class StopwatchStatus:
    """Opcode 0x10, every reply shape (``ILedClockStopWatchEventResponse``).

    ``action``: 1=status, 2=reset ack, 3=start/stop ack. ``success`` only for ``action == 2``.
    """

    action: int
    running: bool = False
    hour: int = 0
    minute: int = 0
    seconds: int = 0
    success: bool = True


@dataclass(frozen=True)
class ScoreboardStatus:
    """Opcode 0x11, every reply shape (``ILedClockScoreBoardEventResponse``).

    ``action``: 1=status, 2=set-score ack, 3=set-time ack, 4=start/stop ack, 5=finished.
    ``success`` only for ``action`` in ``{2,3,4}``.
    """

    action: int
    running: bool = False
    host_score: int = 0
    visit_score: int = 0
    host_total_score: int = 0
    visit_total_score: int = 0
    device_minute: int = 0
    device_seconds: int = 0
    set_minute: int = 0
    set_seconds: int = 0
    is_countdown: bool = False
    success: bool = True


@dataclass(frozen=True)
class ProgramStartAck:
    """Opcode 0x02, a 2-byte ``[opcode, result]`` reply to a ``plan_upload`` start frame.
    ``result == 0`` means send chunks; ``result == 1`` means the matching program is already
    present and the upload is complete without chunks.
    """

    result: int


@dataclass(frozen=True)
class ProgramChunkAck:
    """Opcode 0x03/0xff, a 5-byte ``[opcode, reserved, index_hi, index_lo, result]`` reply to
    one uploaded content chunk. ``result``: 0=continue/success, 1=send error (retry), 2=device
    error, 3=data error, other=unknown error."""

    index: int
    result: int


@dataclass(frozen=True)
class Unknown:
    """A well-formed, decoded payload this module has no specific dataclass for."""

    opcode: int
    raw: bytes


Response = Union[
    DeviceInfo,
    OtaVersion,
    PasswordResult,
    Ack,
    NightMode,
    ReminderDetail,
    TempHumidity,
    CountdownStatus,
    StopwatchStatus,
    ScoreboardStatus,
    ProgramStartAck,
    ProgramChunkAck,
    list,
    Unknown,
]


def _u16(payload: bytes, offset: int) -> int:
    return (payload[offset] << 8) | payload[offset + 1]


def _parse_reminder_list(payload: bytes) -> list[int]:
    count = payload[2]
    return list(payload[3 : 3 + count])


def _parse_reminder_detail(payload: bytes) -> ReminderDetail:
    reminder_id = payload[2]
    sound = payload[3]
    year = payload[4]
    month = payload[5]
    day = payload[6]
    hour = payload[7]
    minute = payload[8]
    repeat_type = payload[9]
    # payload[10] is read and discarded by the vendor parser too.
    duration = _u16(payload, 11)
    content_len = payload[13]
    content = bytes(payload[14 : 14 + content_len]).decode("utf-8", errors="replace")
    return ReminderDetail(
        id=reminder_id,
        sound=sound,
        year=year,
        month=month,
        day=day,
        hour=hour,
        minute=minute,
        repeat_type=repeat_type,
        duration=duration,
        content=content,
    )


def _parse_night_mode(payload: bytes) -> NightMode:
    return NightMode(
        enabled=payload[2] != 0,
        start_hour=payload[3],
        start_minute=payload[4],
        end_hour=payload[5],
        end_minute=payload[6],
        device_state_enabled=payload[7] != 0,
        brightness=payload[8],
        voice_control_enabled=payload[9] != 0,
        wake_up_duration=payload[10],
        voice_sensitivity=payload[11],
    )


def _parse_temp_humidity(payload: bytes) -> Response:
    if len(payload) < 5 or payload[1] != 1:
        return Unknown(opcode=payload[0], raw=payload)
    raw = _u16(payload, 2)
    value = ((raw & 0x7FF0) >> 4) + (raw & 0x0F) * 0.1
    if (raw & 0x8000) >> 15 == 1:
        value = -value
    return TempHumidity(kind=1, temperature=value, humidity=payload[4])


def _parse_tomato(payload: bytes) -> list[int]:
    count = payload[2]
    if len(payload) == count + 3:
        return list(payload[3 : 3 + count])
    return []


def _parse_alarms(payload: bytes) -> list[AlarmItem]:
    count = payload[2]
    items: list[AlarmItem] = []
    for i in range(count):
        base = i * 7 + 3
        enable = payload[base] != 0
        hour = payload[base + 1]
        minute = payload[base + 2]
        repeat_mask = payload[base + 3]
        duration = _u16(payload, base + 4)
        reminder_duration = payload[base + 6]
        flags = weekday_flags(repeat_mask)
        items.append(
            AlarmItem(
                hour=hour,
                minute=minute,
                enable=enable,
                duration=duration,
                reminder_duration=reminder_duration,
                **flags,
            )
        )
    return items


def _parse_timer_switches(payload: bytes) -> list[TimerSwitchItem]:
    count = payload[1]
    items: list[TimerSwitchItem] = []
    for i in range(count):
        base = i * 6 + 2
        enable = payload[base] != 0
        hour = payload[base + 1]
        minute = payload[base + 2]
        repeat_mask = payload[base + 3]
        is_set_device_on = payload[base + 4] != 0
        # payload[base + 5] is read and discarded by the vendor parser too.
        flags = weekday_flags(repeat_mask)
        items.append(
            TimerSwitchItem(
                enable=enable,
                hour=hour,
                minute=minute,
                is_set_device_on=is_set_device_on,
                **flags,
            )
        )
    return items


def _parse_stopwatch(payload: bytes) -> Response:
    if len(payload) == 3 and payload[1] == 2:
        return StopwatchStatus(action=2, success=payload[2] == 0)
    if len(payload) == 6 and payload[1] in (1, 3):
        return StopwatchStatus(
            action=payload[1],
            running=payload[2] == 1,
            hour=payload[3],
            minute=payload[4],
            seconds=payload[5],
        )
    return Unknown(opcode=payload[0], raw=payload)


def _parse_countdown(payload: bytes) -> Response:
    if len(payload) == 3 and payload[1] == 2:
        return CountdownStatus(action=2, success=payload[2] == 0)
    if len(payload) == 9 and payload[1] in (1, 3):
        return CountdownStatus(
            action=payload[1],
            running=payload[2] == 1,
            set_hour=payload[3],
            set_minute=payload[4],
            set_seconds=payload[5],
            left_hour=payload[6],
            left_minute=payload[7],
            left_seconds=payload[8],
        )
    if len(payload) == 9 and payload[1] == 4:
        return CountdownStatus(action=4)
    return Unknown(opcode=payload[0], raw=payload)


def _parse_scoreboard(payload: bytes) -> Response:
    sub = payload[1]
    if sub in (1, 5) and len(payload) == 14:
        return ScoreboardStatus(
            action=sub,
            host_score=_u16(payload, 2),
            visit_score=_u16(payload, 4),
            host_total_score=payload[6],
            visit_total_score=payload[7],
            device_minute=payload[8],
            device_seconds=payload[9],
            running=payload[10] == 1,
            set_minute=payload[11],
            set_seconds=payload[12],
            is_countdown=payload[13] == 1,
        )
    if sub in (2, 3, 4) and len(payload) == 3:
        return ScoreboardStatus(action=sub, success=payload[2] == 0)
    return Unknown(opcode=payload[0], raw=payload)


def _parse_device_info(payload: bytes) -> DeviceInfo:
    show_device_id_raw = payload[7]
    is_show_device_id = show_device_id_raw != 0
    is_remote_enable_raw = payload[9]
    is_mute_raw = payload[22] if len(payload) > 22 else 0
    # Faithful port of a vendor copy-paste bug (DeviceManager.java, getILedCLockDeviceInfo):
    # the "else if" branch of both `isRemoteEnable` and `isMute` compares `i109`
    # (isShowDeviceId's raw byte) against `1` instead of comparing their own raw byte
    # (`i110`/`i111` respectively) against `1` -- so a genuinely fresh (never-previously-
    # true) flag only ever becomes true when isShowDeviceId's raw byte is *exactly* 1, not
    # merely nonzero. The vendor's class-level static field additionally means an untouched
    # flag simply keeps its PREVIOUS value when neither branch fires; a stateless parser has
    # no such history to fall back to, so that case resolves to False here (the static
    # field's declared default before ever being touched) -- documented, not silently
    # guessed.
    is_remote_enable = False if is_remote_enable_raw == 0 else show_device_id_raw == 1
    is_mute = False if is_mute_raw == 0 else show_device_id_raw == 1
    return DeviceInfo(
        is_switch_on_off=payload[1] != 0,
        brightness=payload[2],
        rotate=payload[3],
        is_local_mic_supported=payload[4] != 0,
        is_local_mic_on_off=payload[5] != 0,
        local_mic_mode=payload[6],
        is_show_device_id=is_show_device_id,
        max_program_number=payload[8],
        is_remote_enable=is_remote_enable,
        is_mute=is_mute,
        volume=payload[23] if len(payload) > 23 else 0,
        firmware_version=payload[17] if len(payload) > 17 else 0,
        raw=payload,
    )


def _parse_ota_version(payload: bytes) -> OtaVersion:
    if len(payload) < 2 or payload[1] == 0:
        return OtaVersion(supported=False)
    version = _u16(payload, 2)
    name_len = payload[4]
    filename = bytes(payload[5 : 5 + name_len]).decode("ascii", errors="replace").strip()
    return OtaVersion(supported=True, version=version, filename=filename)


def parse(payload: bytes) -> Response:
    """``DeviceManager.checkILedClockMessages`` + connect-time device-info/OTA/password
    parsing. ``payload`` is a decoded (``framing.decode_frame``), unescaped, opcode-first
    byte sequence — never call this on a raw, still-framed/escaped notification.
    """
    if not payload:
        return Unknown(opcode=-1, raw=payload)
    opcode = payload[0]

    if opcode == 0x1A:
        if len(payload) == 2:
            return ProgramStartAck(result=payload[1])
        sub = payload[1]
        if sub == 0x01:
            return _parse_reminder_list(payload)
        if sub == 0x02:
            return _parse_reminder_detail(payload)
        if sub == 0x03:
            return Ack(opcode=0x1A, sub=0x03, status=payload[2])
        return Unknown(opcode=opcode, raw=payload)

    if opcode == 0x14:
        sub = payload[1]
        if sub == 0x01:
            return Ack(opcode=0x14, sub=0x01, status=payload[2])
        if sub == 0x02:
            return _parse_night_mode(payload)
        return Unknown(opcode=opcode, raw=payload)

    if opcode == 0x19:
        return _parse_temp_humidity(payload)

    if opcode == 0x15:
        sub = payload[1]
        if sub == 0x02:
            return _parse_tomato(payload)
        if sub == 0x01:
            return Ack(opcode=0x15, sub=0x01, status=payload[2] if len(payload) > 2 else 0)
        return Unknown(opcode=opcode, raw=payload)

    if opcode == 0x16:
        sub = payload[1]
        if sub == 0x02:
            return _parse_alarms(payload)
        if sub == 0x01:
            return Ack(opcode=0x16, sub=0x01, status=payload[2])
        return Unknown(opcode=opcode, raw=payload)

    if opcode == 0x0B:
        return _parse_timer_switches(payload)

    if opcode == 0x0A:
        return Ack(opcode=0x0A, sub=None, status=payload[1])

    if opcode == 0x10:
        return _parse_stopwatch(payload)

    if opcode == 0x0F:
        return _parse_countdown(payload)

    if opcode == 0x11:
        return _parse_scoreboard(payload)

    if opcode == 0x13:
        return Ack(opcode=0x13, sub=payload[1], status=payload[2] if len(payload) > 2 else 0)

    if opcode == 0x09:
        return Ack(opcode=0x09, sub=None, status=payload[1] if len(payload) > 1 else 0)

    if opcode == 0xFD:
        return _parse_ota_version(payload)

    if opcode == 0x1F:
        return _parse_device_info(payload)

    if opcode in (0x0D, 0x0E):
        return PasswordResult(ok=payload[1] == 0)

    if opcode == 0x04:
        return Ack(opcode=0x04, sub=None, status=payload[1])

    if opcode == 0x05:
        return Ack(opcode=0x05, sub=None, status=payload[1])

    if opcode == 0x0C:
        return Ack(opcode=0x0C, sub=None, status=payload[1])

    if opcode == 0x02 and len(payload) == 2:
        return ProgramStartAck(result=payload[1])

    if opcode in (0x03, 0xFF) and len(payload) == 5:
        return ProgramChunkAck(index=_u16(payload, 2), result=payload[4])

    if opcode == 0xFE and len(payload) == 2:
        return ProgramStartAck(result=payload[1])

    return Unknown(opcode=opcode, raw=payload)
