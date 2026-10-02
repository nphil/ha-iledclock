"""Named alarms and reminders: the pure domain model (no Home Assistant imports).

Pixel Studio keeps ONE list of alarms and reminders. `kind` ("alarm" or "reminder") is presentation
only: on the clock both are the same thing, a type-14 *reminder* that lives in the clock's own
reminder slots (up to 16 of them) and rings by itself, without Home Assistant. Home Assistant keeps
the definition (name, schedule, art, on/off) because the clock cannot hand back the art, and
compiles it into one or several clock reminders:

* **Slots.** A clock reminder repeats never / daily / weekly (one weekday) / monthly / yearly. "Weekdays",
  "weekends" and "custom days" therefore cost one slot per day unless the clock turns out to take a
  weekday mask (`hardware.REMINDER_WEEK_MASK_SUPPORTED`, live-unverified, default False).
* **Off = removed.** The clock has no enabled flag: a switched-off item is deleted from the clock and its
  definition stays here (`last_ids` remembers the slots so switching on again prefers them).
* **Ids.** `allocate_ids` hands out the lowest free ids in `hardware.REMINDER_ID_MIN..MAX`.

Everything here is pure: validation, slot cost, the plan of clock reminders, the program for one of them,
id allocation and the comparison with what the clock reports (`reconcile`). The manager
(`reminder_manager.py`) does the talking to the clock. All times are the clock's own wall time (naive
local datetimes, the same wall time `sync_time` sets).

Status of an item (`reconcile`); the first row that matches wins, top to bottom:

| status     | when                                                                                      |
|------------|-------------------------------------------------------------------------------------------|
| `disabled` | switched off and no clock slot is held                                                    |
| `error`    | switched off but a clock slot is still held (the delete failed)                           |
| `done`     | one-time, and its moment has passed (the clock may or may not still list it)              |
| `error`    | switched on and `last_error` is set (the last send failed)                                |
| `pending`  | switched on, no clock slot held, no error (never sent)                                    |
| `synced`   | switched on, sent, and the clock has not been read yet (believe the last send)            |
| `missing`  | at least one of its clock slots is not on the clock any more                              |
| `changed`  | all slots there, but hour, minute, name, repeat type or ring length (one-time items: also |
|            | the date) differ from what would be sent now, or the slot count no longer matches         |
| `synced`   | all slots there and matching                                                              |
"""

from __future__ import annotations

import datetime as dt
import unicodedata
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, NamedTuple

from . import hardware
from .const import (
    REMINDER_CONTENT_MAX_LENGTH,
    REMINDER_DEFAULT_DURATION_S,
    REMINDER_DURATIONS_S,
    REMINDER_KINDS,
    REMINDER_MAX_FRAMES,
    REMINDER_NAME_MAX_UTF16,
    REMINDER_REPEATS,
)
from .designs import Design
from .program_builder import design_play_frames, frames_to_content
from .protocol import render as protocol_render
from .protocol.programs import AnimationContent, Content, GraffitiContent, Program, ReminderContent
from .state import ReminderState

# -- vocabulary ------------------------------------------------------------------------------------

ATTACHMENT_DESIGN = "design"
ATTACHMENT_TEXT = "text"
#: The vendor UI has no sound choice and always writes 1 (ILedClockManager.java:285).
REMINDER_SOUND = 1
TEXT_FONT = "5x7"
DEFAULT_TEXT_COLOR = (255, 255, 255)

#: The clock's own repeat types (ILedClockReminderRepeatDialog.java:86-90).
REPEAT_TYPE_ONCE = 0
REPEAT_TYPE_DAILY = 1
REPEAT_TYPE_WEEKLY = 2
REPEAT_TYPE_MONTHLY = 3
REPEAT_TYPE_YEARLY = 4

#: Item statuses (frontend/src/types.ts `ReminderStatus`); the table is in the module docstring.
STATUS_SYNCED = "synced"
STATUS_DISABLED = "disabled"
STATUS_PENDING = "pending"
STATUS_MISSING = "missing"
STATUS_CHANGED = "changed"
STATUS_ERROR = "error"
STATUS_DONE = "done"

#: Mon = 0 .. Sun = 6, like `datetime.date.weekday()` and the studio's day chips.
WEEKDAYS = (0, 1, 2, 3, 4)
WEEKENDS = (5, 6)
ALL_DAYS = (0, 1, 2, 3, 4, 5, 6)

#: A reminder date must fit the clock's year byte (2000 + 0..255); this is the range the studio offers.
_YEAR_MIN = 2000
_YEAR_MAX = 2099
#: The one-time default date and the storage loader need "a now" that never makes anything look past.
_LONG_AGO = dt.datetime(2000, 1, 1)

_INPUT_FIELDS = ("name", "kind", "hour", "minute", "date", "repeat", "days", "duration_s", "attachment", "enabled")


# -- errors ----------------------------------------------------------------------------------------


class ReminderValidationError(ValueError):
    """The input cannot be used. `field` names the input to fix (`name`, `hour`, `date`, `days`, `attachment`,
    `slots`, ...); the message is one plain line telling the user what to do."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


class ReminderCapacityError(ReminderValidationError):
    """The clock has too few free reminder slots for what was asked."""

    def __init__(self, needed: int, free: int) -> None:
        plural = "" if needed == 1 else "s"
        super().__init__(
            "slots",
            f"This needs {needed} clock slot{plural}, only {free} free. Delete an alarm or reminder first.",
        )
        self.needed = needed
        self.free = free


# -- the item --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ReminderAttachment:
    """What shows (and rings) when the item fires: a Library design, or the name drawn as text."""

    kind: str = ATTACHMENT_TEXT
    design_id: str | None = None
    color: tuple[int, int, int] | None = None

    def to_json(self) -> dict[str, Any]:
        if self.kind == ATTACHMENT_DESIGN:
            return {"kind": ATTACHMENT_DESIGN, "design_id": self.design_id}
        data: dict[str, Any] = {"kind": ATTACHMENT_TEXT}
        if self.color is not None:
            data["color"] = list(self.color)
        return data


@dataclass(frozen=True, slots=True)
class ReminderItem:
    """One alarm or reminder as Home Assistant keeps it.

    `date` is the day of a one-time item, the day of the month of a monthly one (month and year only
    anchor it) and month and day of a yearly one; None for every other repeat. `days` are weekdays
    (Mon = 0 .. Sun = 6): the picked days of "custom", the one day of "weekly", () otherwise.
    `device_ids` are the clock slots it holds right now, `last_ids` the ones it held when last sent or
    switched off (a later send prefers them), `last_error` why the last send failed."""

    key: str
    name: str
    kind: str
    hour: int
    minute: int
    date: dt.date | None
    repeat: str
    days: tuple[int, ...]
    duration_s: int
    attachment: ReminderAttachment
    enabled: bool
    device_ids: tuple[int, ...] = ()
    last_ids: tuple[int, ...] = ()
    last_error: str | None = None
    updated: float = 0.0

    def to_input(self) -> dict[str, Any]:
        """The editable fields, in the shape `validate_item` accepts (the studio's `ReminderInput`)."""
        return {
            "name": self.name,
            "kind": self.kind,
            "hour": self.hour,
            "minute": self.minute,
            "date": self.date.isoformat() if self.date is not None else None,
            "repeat": self.repeat,
            "days": list(self.days),
            "duration_s": self.duration_s,
            "attachment": self.attachment.to_json(),
            "enabled": self.enabled,
        }

    def to_json(self, *, status: str, slots: int) -> dict[str, Any]:
        """`ManagedReminder` of frontend/src/types.ts: the item plus its derived `status` and `slots`."""
        data = self.to_input()
        return {
            "key": self.key,
            **data,
            "status": status,
            "slots": slots,
            "device_ids": list(self.device_ids),
            "last_error": self.last_error,
            "updated": self.updated,
        }

    def to_storage(self) -> dict[str, Any]:
        return {
            "key": self.key,
            **self.to_input(),
            "device_ids": list(self.device_ids),
            "last_ids": list(self.last_ids),
            "last_error": self.last_error,
            "updated": self.updated,
        }

    @classmethod
    def from_storage(cls, data: Any) -> "ReminderItem":
        """Read an item back from storage. Raises `ReminderValidationError` when the definition itself is
        unusable; damaged bookkeeping (slot ids, error text, time stamp) is dropped instead, because the
        definition is what the user typed in and the rest can be rebuilt by sending again."""
        if not isinstance(data, Mapping):
            raise ReminderValidationError("item", "A saved alarm could not be read.")
        key = data.get("key")
        if not isinstance(key, str) or not key:
            raise ReminderValidationError("item", "A saved alarm has no key.")
        item = _build_item(
            data, existing=None, key=key, today=_LONG_AGO.date(), now=_LONG_AGO, check_past=False
        )
        last_error = data.get("last_error")
        updated = data.get("updated")
        return replace(
            item,
            device_ids=_stored_ids(data.get("device_ids")),
            last_ids=_stored_ids(data.get("last_ids")),
            last_error=last_error if isinstance(last_error, str) and last_error else None,
            updated=float(updated) if isinstance(updated, (int, float)) and not isinstance(updated, bool) else 0.0,
        )


def _stored_ids(value: Any) -> tuple[int, ...]:
    if not isinstance(value, (list, tuple)):
        return ()
    ids: list[int] = []
    for entry in value:
        if isinstance(entry, int) and not isinstance(entry, bool) and 0 <= entry <= 255 and entry not in ids:
            ids.append(entry)
    return tuple(ids)


def new_key(taken: Iterable[str] = ()) -> str:
    """A fresh item key: 12 hex characters, never one of `taken`."""
    used = set(taken)
    while True:
        key = uuid.uuid4().hex[:12]
        if key not in used:
            return key


# -- validation ------------------------------------------------------------------------------------


def _naive(moment: dt.datetime) -> dt.datetime:
    """The wall-clock reading of `moment` (the clock only knows local wall time)."""
    return moment.replace(tzinfo=None) if moment.tzinfo is not None else moment


def _parse_name(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ReminderValidationError("name", "Give it a name.")
    name = value.strip()
    if any(unicodedata.category(char) == "Cc" for char in name):
        raise ReminderValidationError("name", "The name can't contain line breaks or other control characters.")
    try:
        utf16_units = len(name.encode("utf-16-le")) // 2
        utf8_bytes = len(name.encode("utf-8"))
    except UnicodeEncodeError:
        raise ReminderValidationError("name", "The name has a character the clock can't show.") from None
    if utf16_units > REMINDER_NAME_MAX_UTF16:
        raise ReminderValidationError(
            "name", f"The name can be at most {REMINDER_NAME_MAX_UTF16} characters long."
        )
    if utf8_bytes > REMINDER_CONTENT_MAX_LENGTH:
        raise ReminderValidationError("name", "That name is too long for the clock. Shorten it.")
    return name


def _parse_int(value: Any, field: str, message: str, low: int, high: int) -> int:
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ReminderValidationError(field, message)
    return value


def _parse_days(value: Any) -> tuple[int, ...]:
    if value is None:
        return ()
    message = "Days must be numbers from 0 (Monday) to 6 (Sunday)."
    if isinstance(value, (str, bytes, Mapping)) or not isinstance(value, Iterable):
        raise ReminderValidationError("days", message)
    return tuple(sorted({_parse_int(day, "days", message, 0, 6) for day in value}))


def _parse_date(value: Any) -> dt.date | None:
    if value is None or value == "":
        return None
    if isinstance(value, dt.datetime):
        value = value.date()
    if isinstance(value, dt.date):
        date = value
    elif isinstance(value, str):
        try:
            date = dt.date.fromisoformat(value)
        except ValueError:
            raise ReminderValidationError("date", "Pick a valid date.") from None
    else:
        raise ReminderValidationError("date", "Pick a valid date.")
    if not _YEAR_MIN <= date.year <= _YEAR_MAX:
        raise ReminderValidationError("date", f"Pick a date between {_YEAR_MIN} and {_YEAR_MAX}.")
    return date


def _parse_attachment(value: Any) -> ReminderAttachment:
    if value is None:
        return ReminderAttachment()
    pick = "Pick a design or use the name as text."
    if not isinstance(value, Mapping):
        raise ReminderValidationError("attachment", pick)
    kind = value.get("kind")
    if kind is None:
        kind = ATTACHMENT_DESIGN if "design_id" in value else ATTACHMENT_TEXT
    if kind == ATTACHMENT_DESIGN:
        design_id = value.get("design_id")
        if not isinstance(design_id, str) or not design_id:
            raise ReminderValidationError("attachment", "Pick a design.")
        return ReminderAttachment(kind=ATTACHMENT_DESIGN, design_id=design_id)
    if kind != ATTACHMENT_TEXT:
        raise ReminderValidationError("attachment", pick)
    color = value.get("color")
    if color is None:
        return ReminderAttachment()
    channels = "The text colour must be three numbers from 0 to 255."
    if isinstance(color, (str, bytes, Mapping)) or not isinstance(color, Iterable):
        raise ReminderValidationError("attachment", channels)
    rgb = tuple(_parse_int(channel, "attachment", channels, 0, 255) for channel in color)
    if len(rgb) != 3:
        raise ReminderValidationError("attachment", channels)
    return ReminderAttachment(color=(rgb[0], rgb[1], rgb[2]))


def _build_item(
    raw: Any,
    *,
    existing: ReminderItem | None,
    key: str | None,
    today: dt.date,
    now: dt.datetime,
    check_past: bool,
) -> ReminderItem:
    if not isinstance(raw, Mapping):
        raise ReminderValidationError("item", "That alarm could not be read. Try again.")
    merged: dict[str, Any] = {
        "kind": "alarm", "date": None, "repeat": "once", "days": (),
        "duration_s": REMINDER_DEFAULT_DURATION_S, "attachment": None, "enabled": True,
    }
    if existing is not None:
        merged.update(existing.to_input())
    merged.update({name: raw[name] for name in _INPUT_FIELDS if name in raw})

    name = _parse_name(merged.get("name"))
    kind = merged["kind"]
    if kind not in REMINDER_KINDS:
        raise ReminderValidationError("kind", "Choose Alarm or Reminder.")
    hour = _parse_int(merged.get("hour"), "hour", "Pick an hour between 0 and 23.", 0, 23)
    minute = _parse_int(merged.get("minute"), "minute", "Pick a minute between 0 and 59.", 0, 59)
    repeat = merged["repeat"]
    if repeat not in REMINDER_REPEATS:
        raise ReminderValidationError("repeat", "Choose how often it repeats.")
    duration_s = merged["duration_s"]
    if isinstance(duration_s, float) and duration_s.is_integer():
        duration_s = int(duration_s)
    if isinstance(duration_s, bool) or duration_s not in REMINDER_DURATIONS_S:
        options = ", ".join(str(seconds) for seconds in REMINDER_DURATIONS_S[:-1])
        raise ReminderValidationError("duration_s", f"Ring length must be {options} or {REMINDER_DURATIONS_S[-1]} seconds.")
    enabled = merged["enabled"]
    if not isinstance(enabled, bool):
        raise ReminderValidationError("enabled", "Switch it on or off.")
    days = _parse_days(merged["days"])
    date = _parse_date(merged["date"])
    attachment = _parse_attachment(merged["attachment"])

    if repeat == "once":
        days = ()
        if date is None:
            # No date given: the next time it is that time of day.
            date = today if dt.datetime.combine(today, dt.time(hour, minute)) > now else today + dt.timedelta(days=1)
        elif check_past and enabled and dt.datetime.combine(date, dt.time(hour, minute)) <= now:
            raise ReminderValidationError("date", "That time has already passed.")
    elif repeat == "monthly":
        days = ()
        if date is None:
            raise ReminderValidationError("date", "Pick the day of the month.")
        if date.day > 28:
            raise ReminderValidationError("date", "Pick a day from 1 to 28 so it happens every month.")
    elif repeat == "yearly":
        days = ()
        if date is None:
            raise ReminderValidationError("date", "Pick the date.")
        if (date.month, date.day) == (2, 29):
            raise ReminderValidationError("date", "29 February doesn't come every year. Pick another date.")
    else:
        date = None
        if repeat == "weekly":
            if len(days) != 1:
                raise ReminderValidationError("days", "Pick one weekday.")
        elif repeat == "custom":
            if not days:
                raise ReminderValidationError("days", "Pick at least one day.")
            if len(days) == len(ALL_DAYS):
                repeat, days = "daily", ()
        else:  # daily, weekdays, weekends
            days = ()

    return ReminderItem(
        key=existing.key if existing is not None else (key or new_key()),
        name=name,
        kind=kind,
        hour=hour,
        minute=minute,
        date=date,
        repeat=repeat,
        days=days,
        duration_s=duration_s,
        attachment=attachment,
        enabled=enabled,
        device_ids=existing.device_ids if existing is not None else (),
        last_ids=existing.last_ids if existing is not None else (),
        last_error=existing.last_error if existing is not None else None,
        updated=existing.updated if existing is not None else 0.0,
    )


def validate_item(
    raw: Any,
    *,
    today: dt.date,
    now: dt.datetime,
    existing: ReminderItem | None = None,
    key: str | None = None,
) -> ReminderItem:
    """Turn what the studio or a service sent into a `ReminderItem`, or raise `ReminderValidationError`.

    With `existing` (an edit) every field `raw` leaves out keeps the existing value and the clock
    bookkeeping (`device_ids`, `last_ids`, `last_error`, `updated`) carries over; without it, missing
    optional fields take their defaults (alarm, once, 30 s, name as text, switched on) and a new
    `key` is made (`key` if given). Unknown keys are ignored. `today` / `now` are the clock's local
    wall time: an enabled one-time item whose moment is not after `now` is rejected, and a one-time
    item without a date gets the next time it is that time of day."""
    return _build_item(raw, existing=existing, key=key, today=today, now=_naive(now), check_past=True)


# -- slots and the plan of clock reminders ---------------------------------------------------------


def slots_needed(repeat: str, days: Sequence[int], *, week_mask_supported: bool) -> int:
    """Clock reminder slots an enabled item occupies. A clock reminder repeats never / daily / on one
    weekday / monthly / yearly, so weekdays cost 5, weekends 2 and custom as many as days picked, unless
    the clock takes a weekday mask in one reminder (then everything costs 1)."""
    if week_mask_supported:
        return 1
    if repeat == "weekdays":
        return len(WEEKDAYS)
    if repeat == "weekends":
        return len(WEEKENDS)
    if repeat == "custom":
        count = len(set(days))
        return 1 if count in (0, len(ALL_DAYS)) else count
    return 1


class DevicePlan(NamedTuple):
    """One reminder to write to the clock: its repeat type (0-4), an explicit weekday mask (None = the
    vendor's own rule for that type), the date written into it, and the time of day."""

    repeat_type: int
    week_mask: int | None
    date: dt.date
    hour: int
    minute: int


def _next_weekday(now: dt.datetime, weekday: int, hour: int, minute: int) -> dt.date:
    """The first date with this weekday whose `hour:minute` is after `now`."""
    for offset in range(8):
        date = now.date() + dt.timedelta(days=offset)
        if date.weekday() == weekday and dt.datetime.combine(date, dt.time(hour, minute)) > now:
            return date
    raise AssertionError("unreachable: one of eight consecutive days has every weekday")  # pragma: no cover


def _next_monthly(now: dt.datetime, day: int, hour: int, minute: int) -> dt.date:
    """The first date with this day of the month whose `hour:minute` is after `now`."""
    year, month = now.year, now.month
    for _ in range(36):
        try:
            date = dt.date(year, month, day)
        except ValueError:  # a month too short for this day
            date = None
        if date is not None and dt.datetime.combine(date, dt.time(hour, minute)) > now:
            return date
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    raise ReminderValidationError("date", "Pick a day from 1 to 28 so it happens every month.")


def _next_yearly(now: dt.datetime, month: int, day: int, hour: int, minute: int) -> dt.date:
    """The first date with this month and day whose `hour:minute` is after `now`."""
    for year in range(now.year, now.year + 9):
        try:
            date = dt.date(year, month, day)
        except ValueError:  # 29 February in a common year
            continue
        if dt.datetime.combine(date, dt.time(hour, minute)) > now:
            return date
    raise ReminderValidationError("date", "Pick another date.")


def plan_device_reminders(
    item: ReminderItem, *, today: dt.date, now: dt.datetime, week_mask_supported: bool
) -> list[DevicePlan]:
    """The clock reminders that make `item` happen, in slot order.

    once -> type 0 on its date; daily -> type 1 (the clock fires it every day whatever the date);
    weekly -> type 2 on the next occurrence of that weekday; weekdays / weekends / custom -> one type 2
    per day, each on the next occurrence of its weekday, or, when the clock takes a weekday mask, ONE
    type 1 with that mask (Mon = bit 0 .. Sun = bit 6, weekdays 0x1F, weekends 0x60); monthly -> type 3 and
    yearly -> type 4, both on the next occurrence of the date. "Next" means after `now`."""
    now = _naive(now)
    hour, minute = item.hour, item.minute
    repeat = item.repeat
    if repeat == "once":
        if item.date is None:
            raise ReminderValidationError("date", "Pick a date.")
        return [DevicePlan(REPEAT_TYPE_ONCE, None, item.date, hour, minute)]
    if repeat == "daily":
        return [DevicePlan(REPEAT_TYPE_DAILY, None, today, hour, minute)]
    if repeat == "weekly":
        return [DevicePlan(REPEAT_TYPE_WEEKLY, None, _next_weekday(now, item.days[0], hour, minute), hour, minute)]
    if repeat in ("weekdays", "weekends", "custom"):
        days = WEEKDAYS if repeat == "weekdays" else WEEKENDS if repeat == "weekends" else tuple(sorted(set(item.days)))
        if week_mask_supported:
            mask = sum(1 << day for day in days)
            return [DevicePlan(REPEAT_TYPE_DAILY, mask, today, hour, minute)]
        return [
            DevicePlan(REPEAT_TYPE_WEEKLY, None, _next_weekday(now, day, hour, minute), hour, minute) for day in days
        ]
    if item.date is None:
        raise ReminderValidationError("date", "Pick the date.")
    if repeat == "monthly":
        return [DevicePlan(REPEAT_TYPE_MONTHLY, None, _next_monthly(now, item.date.day, hour, minute), hour, minute)]
    return [
        DevicePlan(
            REPEAT_TYPE_YEARLY, None, _next_yearly(now, item.date.month, item.date.day, hour, minute), hour, minute
        )
    ]


def allocate_ids(preferred: Iterable[int], count: int, taken: Iterable[int]) -> list[int]:
    """`count` clock reminder ids in `hardware.REMINDER_ID_MIN..MAX`, none of them in `taken`: first the
    `preferred` ones that are free and in range (an edit keeps its ids, switching on again tries its old
    ones), then the lowest free ones.

    The clock holds `hardware.REMINDER_CAPACITY` reminders in all, and EVERY id in `taken` uses up one of them,
    also one outside the range we hand out (the vendor app's own reminder reads back as id 0 on the live clock).
    Raises `ReminderCapacityError` when fewer than `count` slots are free."""
    low, high = hardware.REMINDER_ID_MIN, hardware.REMINDER_ID_MAX
    blocked = set(taken)
    room = max(0, hardware.REMINDER_CAPACITY - len(blocked))
    if count > room:
        raise ReminderCapacityError(count, room)
    free = [reminder_id for reminder_id in range(low, high + 1) if reminder_id not in blocked]  # len(free) >= room
    chosen: list[int] = []
    for reminder_id in preferred:
        if len(chosen) == count:
            break
        if low <= reminder_id <= high and reminder_id not in blocked and reminder_id not in chosen:
            chosen.append(reminder_id)
    for reminder_id in free:
        if len(chosen) == count:
            break
        if reminder_id not in chosen:
            chosen.append(reminder_id)
    return chosen


# -- programs --------------------------------------------------------------------------------------


def build_reminder_program(
    item: ReminderItem, plan: DevicePlan, device_id: int, attachment_contents: Sequence[Content]
) -> Program:
    """The type-14 program that writes one clock reminder: the reminder header first (`device_id` travels in
    the start frame's `05 <id>` trailer), then the art. Only pictures and animations may follow the header."""
    for content in attachment_contents:
        if not isinstance(content, (GraffitiContent, AnimationContent)):
            raise ValueError(f"a reminder can only carry pictures or animations, not {type(content).__name__}")
    header = ReminderContent.from_full_year(
        remind_id=device_id,
        title=item.name,
        full_year=plan.date.year,
        month=plan.date.month,
        day=plan.date.day,
        hour=plan.hour,
        minute=plan.minute,
        sound=REMINDER_SOUND,
        repeat_type=plan.repeat_type,
        duration=item.duration_s,
        week_mask=plan.week_mask,
    )
    return Program(contents=[header, *attachment_contents], show_count=1, is_clock_in_list=False, program_type=14)


def attachment_contents(item: ReminderItem, *, designs: Mapping[str, Design]) -> list[Content]:
    """The art contents for `item`, checked at send time against the Library: the design must exist, must
    not reserve room for a clock, and (after its own playback speed and smoothing) must have at most
    `REMINDER_MAX_FRAMES` frames. A text attachment draws the name as pixel frames (the same text path as
    every other show, so a still picture for a short name and a marquee for a long one). Does real work
    (retiming, text drawing): run it off the event loop."""
    attachment = item.attachment
    if attachment.kind == ATTACHMENT_DESIGN:
        design = designs.get(attachment.design_id or "")
        if design is None:
            raise ReminderValidationError("attachment", "That design isn't in the Library any more. Pick another one.")
        if design.clock_region is not None:
            raise ReminderValidationError(
                "attachment", "A design with a clock can't be used on an alarm. Pick another one."
            )
        frames, _played = design_play_frames(design, {})
        if len(frames) > REMINDER_MAX_FRAMES:
            raise ReminderValidationError(
                "attachment",
                f"That design has {len(frames)} frames, an alarm takes at most {REMINDER_MAX_FRAMES}. Pick a shorter one.",
            )
        return [frames_to_content(frames, still=design.kind == "image" or len(frames) == 1)]
    frames = protocol_render.text_frames(
        item.name, TEXT_FONT, attachment.color or DEFAULT_TEXT_COLOR, max_frames=REMINDER_MAX_FRAMES
    )
    return [frames_to_content(frames, still=len(frames) == 1)]


# -- comparing with the clock ----------------------------------------------------------------------


def reminder_state_from_detail(detail: Any) -> ReminderState:
    """A `protocol.responses.ReminderDetail` as the integration's own `ReminderState`: the real calendar year
    (the wire only carries year - 2000, the old state kept that raw value) and the fields that used to be dropped."""
    return ReminderState(
        id=detail.id,
        content=detail.content,
        year=detail.full_year,
        month=detail.month,
        day=detail.day,
        hour=detail.hour,
        minute=detail.minute,
        repeat_type=detail.repeat_type,
        week_mask=detail.week_mask,
        duration=detail.duration,
        sound=detail.sound,
    )


def is_done(item: ReminderItem, now: dt.datetime) -> bool:
    """A one-time item whose moment is not after `now`."""
    return (
        item.repeat == "once"
        and item.date is not None
        and dt.datetime.combine(item.date, dt.time(item.hour, item.minute)) <= _naive(now)
    )


def matches_plan(item: ReminderItem, plan: DevicePlan, device: ReminderState, *, dates: str) -> bool:
    """Does the clock's reminder `device` hold what `plan` says? Compares hour, minute, name, repeat type and
    ring length, plus the date as `dates` says: "full" (year, month, day), "month_day" or "none"."""
    if (device.hour, device.minute) != (plan.hour, plan.minute):
        return False
    if device.content != item.name or device.repeat_type != plan.repeat_type or device.duration != item.duration_s:
        return False
    if dates == "full":
        return (device.year, device.month, device.day) == (plan.date.year, plan.date.month, plan.date.day)
    if dates == "month_day":
        return (device.month, device.day) == (plan.date.month, plan.date.day)
    return True


class Reconciliation(NamedTuple):
    """`statuses`: item key -> status. `foreign`: clock reminders no item holds a slot for, by id."""

    statuses: dict[str, str]
    foreign: list[ReminderState]


def _status(
    item: ReminderItem,
    on_clock: Mapping[int, ReminderState] | None,
    now: dt.datetime,
    week_mask_supported: bool,
) -> str:
    if not item.enabled:
        return STATUS_ERROR if item.device_ids else STATUS_DISABLED
    if is_done(item, now):
        return STATUS_DONE
    if item.last_error:
        return STATUS_ERROR
    if not item.device_ids:
        return STATUS_PENDING
    if on_clock is None:  # the clock has not been read yet: believe what was last sent
        return STATUS_SYNCED
    if any(reminder_id not in on_clock for reminder_id in item.device_ids):
        return STATUS_MISSING
    try:
        plans = plan_device_reminders(item, today=now.date(), now=now, week_mask_supported=week_mask_supported)
    except ReminderValidationError:
        # Every item built by `validate_item` / `from_storage` can be planned. This runs while the state is being
        # published to every open panel, so an item that somehow cannot be planned is shown as not matching rather
        # than breaking the publish for everything.
        return STATUS_CHANGED
    if len(plans) != len(item.device_ids):
        return STATUS_CHANGED
    dates = "full" if item.repeat == "once" else "none"
    for plan, reminder_id in zip(plans, item.device_ids):
        if not matches_plan(item, plan, on_clock[reminder_id], dates=dates):
            return STATUS_CHANGED
    return STATUS_SYNCED


def reconcile(
    items: Iterable[ReminderItem],
    device_details: Iterable[ReminderState] | None,
    *,
    now: dt.datetime,
    week_mask_supported: bool | None = None,
) -> Reconciliation:
    """Status of every item against what the clock reports, plus the clock reminders nobody here owns (made
    in the vendor app). `device_details` None means the clock has not been read yet: then no item is called
    missing or changed and nothing is foreign. See the module docstring for the status table."""
    if week_mask_supported is None:
        week_mask_supported = hardware.REMINDER_WEEK_MASK_SUPPORTED
    now = _naive(now)
    details = None if device_details is None else list(device_details)
    on_clock = None if details is None else {detail.id: detail for detail in details}
    statuses: dict[str, str] = {}
    claimed: set[int] = set()
    for item in items:
        claimed.update(item.device_ids)
        statuses[item.key] = _status(item, on_clock, now, week_mask_supported)
    foreign = [] if details is None else sorted((d for d in details if d.id not in claimed), key=lambda d: d.id)
    return Reconciliation(statuses=statuses, foreign=foreign)
