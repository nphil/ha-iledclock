"""Alarms & reminders end to end: the websocket commands and services of the real integration against the
scripted fake clock, which keeps reminder slots like the firmware (`tests/ha/fake_clock.py`).

What must hold: an alarm is stored on the CLOCK (so it rings without Home Assistant), slots are used and freed
sensibly, the definition survives every clock failure with the reason and a way to send it again, and a reminder
write never touches the playlist or the shows. Names here are 5 letters or fewer on purpose: they fit the panel,
so the name-as-text art is one still picture (a long name is a 40-frame marquee, a few seconds of pure-Python
compression per upload)."""

from __future__ import annotations

import base64
import datetime as dt
import time
from unittest.mock import AsyncMock, patch

import pytest
import voluptuous as vol
from bleak.exc import BleakError
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.util import dt as dt_util

from custom_components.iledclock import const, hardware
from custom_components.iledclock.client import IledClockConnectionError, IledClockTimeoutError
from custom_components.iledclock.const import DOMAIN
from custom_components.iledclock.reminders import ReminderAttachment, ReminderItem

from .fake_clock import FakeClockDevice

GRAFFITI, ANIMATION = 0x02, 0x03


@pytest.fixture(autouse=True)
def _no_settle_delay(monkeypatch) -> None:
    """A write waits a second for the clock to settle before it reads the reminder back; the fake needs none."""
    monkeypatch.setattr(hardware, "REMINDER_SAVE_SETTLE_S", 0.0)


@pytest.fixture
def one_reminder_per_day(monkeypatch) -> None:
    """The clock takes no week mask: a multi-weekday alarm costs one weekly reminder per weekday (the flag's False
    path; the default is the week mask)."""
    monkeypatch.setattr(hardware, "REMINDER_WEEK_MASK_SUPPORTED", False)


@pytest.fixture
async def ws(hass, hass_ws_client, config_entry):
    """An admin websocket connection, opened only after the integration is set up (the HTTP router freezes
    once the first client connects)."""
    return await hass_ws_client(hass)


@pytest.fixture
def device_id(hass, config_entry) -> str:
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), config_entry.entry_id)
    assert len(devices) == 1
    return devices[0].id


async def send(ws, entry, command: str, /, **params) -> dict:
    await ws.send_json_auto_id(
        {"type": "iledclock/command", "entry_id": entry.entry_id, "command": command, "params": params}
    )
    return await ws.receive_json()


async def item_of(ws, entry, command: str, /, **params) -> dict:
    """The saved item a successful command answers with."""
    response = await send(ws, entry, command, **params)
    assert response["success"] is True, response
    return response["result"]["item"]


async def fail_of(ws, entry, command: str, /, **params) -> str:
    """The message of a command that must fail with `command_failed`."""
    response = await send(ws, entry, command, **params)
    assert response["success"] is False, response
    assert response["error"]["code"] == "command_failed", response
    return response["error"]["message"]


async def full_state(ws, entry) -> dict:
    await ws.send_json_auto_id({"type": "iledclock/state", "entry_id": entry.entry_id})
    response = await ws.receive_json()
    assert response["success"] is True
    return response["result"]


async def listing(ws, entry) -> dict:
    return (await full_state(ws, entry))["reminder_list"]


def item_row(listed: dict, key: str) -> dict:
    return next(item for item in listed["items"] if item["key"] == key)


def stored_date(reminder) -> dt.date:
    return dt.date(2000 + reminder.year, reminder.month, reminder.day)


def tomorrow() -> dt.date:
    return dt_util.now().date() + dt.timedelta(days=1)


ALARM = {"name": "Wake", "hour": 7, "minute": 15, "repeat": "daily"}


# -- create / edit / switch / delete ---------------------------------------------------------------


async def test_creating_an_alarm_stores_one_reminder_on_the_clock_and_lists_it(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    clock.written.clear()
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)

    assert (item["status"], item["device_ids"], item["slots"], item["last_error"]) == ("synced", [1], 1, None)
    reminder = clock.reminders[1]
    assert (reminder.title, reminder.hour, reminder.minute, reminder.repeat_type) == ("Wake", 7, 15, 1)
    assert (reminder.duration, reminder.week_mask, reminder.sound) == (30, 0x7F, 1)
    assert reminder.attachment_tags == [GRAFFITI]  # the name fits the panel: one still picture
    assert len(clock.uploads) == 1
    start = clock.uploads[0][0]
    assert (start[9], start[10], start[-2:]) == (0, 1, b"\x05\x01")  # index 0 of 1, trailer 05 <id>

    state = await full_state(ws, config_entry)
    listed = state["reminder_list"]
    assert (listed["capacity"], listed["used"], listed["free"], listed["foreign"]) == (14, 1, 13, [])
    assert [row["key"] for row in listed["items"]] == [item["key"]]
    assert listed["synced_at"] is not None
    assert (state["now_showing"], state["history"], state["playlist"]) == (None, [], [])


@pytest.mark.parametrize(
    ("extra", "types", "slots", "per_day"),
    [
        ({"repeat": "once", "date": "tomorrow"}, [0], 1, False),
        ({"repeat": "daily"}, [1], 1, False),
        ({"repeat": "weekly", "days": [2]}, [2], 1, False),
        ({"repeat": "monthly", "date": "tomorrow"}, [3], 1, False),
        ({"repeat": "yearly", "date": "2024-12-25"}, [4], 1, False),
        ({"repeat": "weekends"}, [1], 1, False),  # the default: one reminder with a week mask
        ({"repeat": "custom", "days": [0, 3, 6]}, [1], 1, False),
        ({"repeat": "weekends"}, [2, 2], 2, True),  # no week mask: one weekly reminder per weekday
        ({"repeat": "custom", "days": [0, 3, 6]}, [2, 2, 2], 3, True),
    ],
)
async def test_every_repeat_reaches_the_clock_as_the_right_kind_and_number_of_reminders(
    ws, config_entry, clock: FakeClockDevice, monkeypatch, extra: dict, types: list[int], slots: int, per_day: bool
) -> None:
    if per_day:
        monkeypatch.setattr(hardware, "REMINDER_WEEK_MASK_SUPPORTED", False)
    extra = {key: (tomorrow().isoformat() if value == "tomorrow" else value) for key, value in extra.items()}
    if extra.get("repeat") == "monthly":
        extra["date"] = tomorrow().replace(day=min(tomorrow().day, 28)).isoformat()
    item = await item_of(ws, config_entry, "reminder_set", name="Gym", hour=18, minute=30, **extra)

    assert item["slots"] == slots == len(item["device_ids"])
    stored = [clock.reminders[reminder_id] for reminder_id in item["device_ids"]]
    assert [reminder.repeat_type for reminder in stored] == types
    picked_days_mask = {"weekends": 0x60, "custom": 0x49}  # Mon = bit 0 .. Sun = bit 6
    for reminder in stored:  # the mask byte is the vendor's rule for that type
        every_day = picked_days_mask.get(extra["repeat"], 0x7F) if not per_day else 0x7F
        expected = {0: 0, 1: every_day, 2: 1 << stored_date(reminder).weekday(), 3: 0, 4: 0}[reminder.repeat_type]
        assert reminder.week_mask == expected
    if extra["repeat"] == "once":
        assert stored_date(stored[0]) == tomorrow()
    if extra["repeat"] == "weekly" or per_day:
        wanted = {"weekly": [2], "weekends": [5, 6], "custom": [0, 3, 6]}[extra["repeat"]]
        assert [stored_date(reminder).weekday() for reminder in stored] == wanted
        assert all(stored_date(reminder) >= dt_util.now().date() for reminder in stored)


async def test_editing_keeps_the_same_slot_and_replaces_what_is_on_the_clock(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)
    edited = await item_of(ws, config_entry, "reminder_set", key=item["key"], **{**ALARM, "hour": 8, "name": "Rise"})

    assert (edited["key"], edited["device_ids"], edited["status"]) == (item["key"], [1], "synced")
    assert sorted(clock.reminders) == [1]
    assert (clock.reminders[1].title, clock.reminders[1].hour) == ("Rise", 8)
    assert len(clock.uploads) == 2
    assert len((await listing(ws, config_entry))["items"]) == 1


async def test_a_plan_that_shrinks_frees_its_extra_slots_only_after_the_new_ones_are_up(
    ws, config_entry, clock: FakeClockDevice, one_reminder_per_day
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekdays")
    assert item["device_ids"] == [1, 2, 3, 4, 5]
    clock.written.clear()

    edited = await item_of(ws, config_entry, "reminder_set", key=item["key"], repeat="weekends")

    assert (edited["device_ids"], edited["slots"], sorted(clock.reminders)) == ([1, 2], 2, [1, 2])
    deletes = [payload for payload in clock.written if payload[:2] == b"\x1a\x03"]
    assert [payload[2] for payload in deletes] == [3, 4, 5]
    last_start = max(index for index, payload in enumerate(clock.written) if payload[0] == 0x02)
    first_delete = min(index for index, payload in enumerate(clock.written) if payload[:2] == b"\x1a\x03")
    assert first_delete > last_start


async def test_switching_off_removes_it_from_the_clock_and_on_again_prefers_its_old_slot(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    first = await item_of(ws, config_entry, "reminder_set", **ALARM)
    second = await item_of(ws, config_entry, "reminder_set", **{**ALARM, "name": "Pills"})
    third = await item_of(ws, config_entry, "reminder_set", **{**ALARM, "name": "Bins"})
    assert [first["device_ids"], second["device_ids"], third["device_ids"]] == [[1], [2], [3]]

    off = await item_of(ws, config_entry, "reminder_set_enabled", key=first["key"], enabled=False)
    await item_of(ws, config_entry, "reminder_set_enabled", key=second["key"], enabled=False)
    assert (off["status"], off["enabled"], off["device_ids"], off["last_error"]) == ("disabled", False, [], None)
    assert sorted(clock.reminders) == [3]
    listed = await listing(ws, config_entry)
    assert (listed["used"], listed["free"], len(listed["items"])) == (1, 13, 3)  # the definitions stay

    again = await item_of(ws, config_entry, "reminder_set_enabled", key=second["key"], enabled=True)
    assert (again["status"], again["device_ids"]) == ("synced", [2])  # its old slot, not the lowest free one (1)
    assert sorted(clock.reminders) == [2, 3]


async def test_switching_on_something_that_is_already_on_and_in_sync_does_not_touch_the_clock(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)
    clock.written.clear()

    again = await item_of(ws, config_entry, "reminder_set_enabled", key=item["key"], enabled=True)
    assert (again["status"], again["device_ids"]) == ("synced", [1])
    assert clock.written == []


async def test_deleting_removes_every_slot_and_then_the_definition(
    ws, config_entry, clock: FakeClockDevice, one_reminder_per_day
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekdays")
    assert sorted(clock.reminders) == [1, 2, 3, 4, 5]

    response = await send(ws, config_entry, "reminder_delete", key=item["key"])
    assert response["success"] is True and response["result"] == {}
    assert clock.reminders == {}
    listed = await listing(ws, config_entry)
    assert (listed["items"], listed["used"]) == ([], 0)
    assert "no longer exists" in await fail_of(ws, config_entry, "reminder_delete", key=item["key"])


@pytest.mark.parametrize("command", ["delete", "switch_off"])
async def test_removing_an_alarm_the_clock_already_lost_still_refreshes_what_the_clock_holds(
    ws, config_entry, clock: FakeClockDevice, command: str
) -> None:
    """Its slot was deleted in the vendor app, where two other reminders were made: there is nothing left to delete,
    but what Home Assistant shows of the clock (`used`, `foreign`, `state.reminders`) must be read afresh, not kept."""
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)
    del clock.reminders[1]
    clock.add_reminder(7, "Seven")
    clock.add_reminder(8, "Eight")

    if command == "delete":
        assert (await send(ws, config_entry, "reminder_delete", key=item["key"]))["success"] is True
    else:
        await item_of(ws, config_entry, "reminder_set_enabled", key=item["key"], enabled=False)

    state = await full_state(ws, config_entry)
    listed = state["reminder_list"]
    assert [reminder["id"] for reminder in state["state"]["reminders"]] == [7, 8]
    assert (listed["used"], [reminder["id"] for reminder in listed["foreign"]]) == (2, [7, 8])
    assert [row["status"] for row in listed["items"]] == ([] if command == "delete" else ["disabled"])


# -- the week mask flag --------------------------------------------------------------------------------


async def test_weekdays_use_five_slots_when_the_clock_takes_no_week_mask(
    ws, config_entry, clock: FakeClockDevice, one_reminder_per_day
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekdays")
    assert (item["slots"], item["device_ids"]) == (5, [1, 2, 3, 4, 5])
    assert [clock.reminders[i].repeat_type for i in item["device_ids"]] == [2] * 5
    assert [stored_date(clock.reminders[i]).weekday() for i in item["device_ids"]] == [0, 1, 2, 3, 4]
    state = await full_state(ws, config_entry)
    assert (state["capabilities"]["reminders"]["week_mask"], state["reminder_list"]["used"]) == (False, 5)


async def test_weekdays_use_one_slot_by_default_because_the_clock_takes_a_week_mask(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekdays")

    assert (item["slots"], item["device_ids"], item["status"]) == (1, [1], "synced")
    reminder = clock.reminders[1]
    assert (reminder.repeat_type, reminder.week_mask) == (1, 0x1F)
    state = await full_state(ws, config_entry)
    assert (state["capabilities"]["reminders"]["week_mask"], state["reminder_list"]["used"]) == (True, 1)


async def test_switching_the_week_mask_flag_makes_old_sends_show_as_changed(
    ws, config_entry, clock: FakeClockDevice, monkeypatch
) -> None:
    monkeypatch.setattr(hardware, "REMINDER_WEEK_MASK_SUPPORTED", False)
    item = await item_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekdays")
    assert item["device_ids"] == [1, 2, 3, 4, 5]
    monkeypatch.setattr(hardware, "REMINDER_WEEK_MASK_SUPPORTED", True)
    assert item_row(await listing(ws, config_entry), item["key"])["status"] == "changed"

    resent = await item_of(ws, config_entry, "reminder_resend", key=item["key"])
    assert (resent["status"], resent["device_ids"], resent["slots"]) == ("synced", [1], 1)
    assert sorted(clock.reminders) == [1]  # the four extra slots are freed


# -- a clock that is full ----------------------------------------------------------------------------------


async def test_a_full_clock_refuses_but_keeps_the_definition_and_resend_works_once_there_is_room(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    for reminder_id in range(1, 15):
        clock.add_reminder(reminder_id, f"Old {reminder_id}")

    message = await fail_of(ws, config_entry, "reminder_set", **ALARM)
    assert "needs 1 clock slot, only 0 free" in message
    row = (await listing(ws, config_entry))["items"][0]
    assert (row["status"], row["last_error"], row["device_ids"], row["enabled"]) == ("error", message, [], True)
    assert len(clock.uploads) == 0  # nothing was sent to a full clock

    deleted = await send(ws, config_entry, "reminder_delete", id=5)  # make room: a reminder from the vendor app
    assert deleted["success"] is True
    resent = await item_of(ws, config_entry, "reminder_resend", key=row["key"])
    assert (resent["status"], resent["device_ids"], resent["last_error"]) == ("synced", [5], None)


async def test_an_item_that_needs_more_slots_than_are_free_says_how_many(
    ws, config_entry, clock: FakeClockDevice, one_reminder_per_day
) -> None:
    for reminder_id in range(1, 11):
        clock.add_reminder(reminder_id, f"Old {reminder_id}")
    message = await fail_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekdays")
    assert "needs 5 clock slots, only 4 free" in message
    assert sorted(clock.reminders) == list(range(1, 11))


async def test_fourteen_reminders_numbered_0_to_13_leave_no_room_even_though_ids_14_and_15_are_unused(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    """The clock holds fourteen reminders in all (live T6). One of them (the vendor app's own, id 0) is outside the 1-15
    range we hand out, but it still takes a slot: ids 14 and 15 must not be used as if there were room."""
    for reminder_id in range(0, 14):
        clock.add_reminder(reminder_id, f"Old {reminder_id}")

    message = await fail_of(ws, config_entry, "reminder_set", **ALARM)
    assert "needs 1 clock slot, only 0 free" in message
    assert sorted(clock.reminders) == list(range(14)) and len(clock.uploads) == 0


async def test_growing_an_alarm_counts_every_reminder_on_the_clock_not_just_the_ids_in_range(
    ws, config_entry, clock: FakeClockDevice, one_reminder_per_day
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekly", days=[2])
    assert item["device_ids"] == [1]
    clock.add_reminder(0, "Vendor")  # outside 1..15, but it takes a slot
    for reminder_id in range(2, 14):
        clock.add_reminder(reminder_id, f"Old {reminder_id}")  # fourteen on the clock now: 0, 1 (the alarm), 2..13

    message = await fail_of(ws, config_entry, "reminder_set", key=item["key"], repeat="weekends")  # one slot more
    assert "needs 2 clock slots, only 1 free" in message
    assert sorted(clock.reminders) == list(range(14))
    assert item_row(await listing(ws, config_entry), item["key"])["device_ids"] == [1]  # still holds its one slot


async def test_slots_other_alarms_hold_are_never_handed_out_again_even_if_the_clock_lost_them(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    first = await item_of(ws, config_entry, "reminder_set", **ALARM)
    del clock.reminders[1]  # deleted behind our back
    second = await item_of(ws, config_entry, "reminder_set", **{**ALARM, "name": "Pills"})
    assert (first["device_ids"], second["device_ids"]) == ([1], [2])


def stale_owner(kind: str) -> ReminderItem:
    """An item that still lists slot 1 although the clock no longer holds it: a one-time alarm that has rung
    ("finished"), or an alarm that was switched off while the clock refused to delete it and was then deleted on the
    clock itself ("switched_off")."""
    past = dt_util.now().replace(tzinfo=None) - dt.timedelta(hours=1)
    common = dict(
        key="aaaaaaaaaaaa", kind="alarm", hour=past.hour, minute=past.minute, days=(), duration_s=30,
        attachment=ReminderAttachment(), device_ids=(1,), last_ids=(1,),
    )
    if kind == "finished":
        return ReminderItem(name="Rang", date=past.date(), repeat="once", enabled=True, **common)
    return ReminderItem(
        name="Off", date=None, repeat="daily", enabled=False, last_error="Couldn't remove it from the clock.", **common
    )


@pytest.mark.parametrize("kind", ["finished", "switched_off"])
async def test_a_slot_the_clock_dropped_goes_to_the_new_alarm_and_switching_that_off_really_removes_it(
    ws, config_entry, clock: FakeClockDevice, kind: str
) -> None:
    await config_entry.runtime_data.reminders._store.async_upsert(stale_owner(kind))
    mine = await item_of(ws, config_entry, "reminder_set", **{**ALARM, "name": "Mine"})
    assert mine["device_ids"] == [1]  # the clock has slot 1 free, so Mine gets it

    old = item_row(await listing(ws, config_entry), "aaaaaaaaaaaa")
    assert old["device_ids"] == [] and old["last_error"] is None  # the old owner no longer claims the slot
    assert old["status"] == ("done" if kind == "finished" else "disabled")

    # Switching Mine off must really take it off the clock. It used to stay there and keep ringing, because the
    # old owner's stale claim made the slot look like somebody else's.
    off = await item_of(ws, config_entry, "reminder_set_enabled", key=mine["key"], enabled=False)
    assert (off["status"], off["device_ids"]) == ("disabled", [])
    assert clock.reminders == {}


@pytest.mark.parametrize("kind", ["finished", "switched_off"])
async def test_deleting_the_old_owner_of_a_slot_leaves_the_new_owners_reminder_alone(
    ws, config_entry, clock: FakeClockDevice, kind: str
) -> None:
    await config_entry.runtime_data.reminders._store.async_upsert(stale_owner(kind))
    mine = await item_of(ws, config_entry, "reminder_set", **{**ALARM, "name": "Mine"})

    assert (await send(ws, config_entry, "reminder_delete", key="aaaaaaaaaaaa"))["success"] is True
    assert [row["key"] for row in (await listing(ws, config_entry))["items"]] == [mine["key"]]
    assert clock.reminders[1].title == "Mine"
    assert item_row(await listing(ws, config_entry), mine["key"])["status"] == "synced"


# -- when the clock does not cooperate ---------------------------------------------------------------------------


async def test_a_start_ack_of_1_means_the_clock_already_has_it_and_no_data_is_sent(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)
    clock.start_ack_result = 1
    resent = await item_of(ws, config_entry, "reminder_resend", key=item["key"])

    assert (resent["status"], resent["device_ids"]) == ("synced", [1])
    assert clock.uploads[-1][1] == []  # start frame only, no chunks


async def test_an_already_present_ack_for_something_the_clock_does_not_hold_is_caught_by_the_read_back(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    clock.start_ack_result = 1
    message = await fail_of(ws, config_entry, "reminder_set", **ALARM)
    assert "didn't keep that alarm" in message
    row = (await listing(ws, config_entry))["items"][0]
    assert (row["status"], row["last_error"], row["device_ids"]) == ("error", message, [1])  # slot 1 stays claimed

    clock.start_ack_result = 0
    resent = await item_of(ws, config_entry, "reminder_resend", key=row["key"])
    assert (resent["status"], resent["device_ids"], resent["last_error"]) == ("synced", [1], None)
    assert sorted(clock.reminders) == [1]


async def test_a_rejected_chunk_keeps_the_definition_and_resend_fixes_it(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    clock.chunk_ack_result = 2
    message = await fail_of(ws, config_entry, "reminder_set", **ALARM)
    assert "refused the data" in message
    row = (await listing(ws, config_entry))["items"][0]
    assert (row["status"], row["last_error"], row["enabled"]) == ("error", message, True)
    assert clock.reminders == {}

    clock.chunk_ack_result = 0
    resent = await item_of(ws, config_entry, "reminder_resend", key=row["key"])
    assert (resent["status"], resent["last_error"]) == ("synced", None)
    assert sorted(clock.reminders) == [1]


async def test_the_definition_is_saved_before_the_clock_is_touched(ws, config_entry) -> None:
    """If everything dies at the first step (here: an error nobody anticipated), what the user typed is still there,
    marked as not finished."""
    with patch(
        "custom_components.iledclock.reminder_manager.attachment_contents", side_effect=RuntimeError("stopped early")
    ):
        response = await send(ws, config_entry, "reminder_set", **ALARM)
    assert response["success"] is False

    row = (await listing(ws, config_entry))["items"][0]
    assert (row["name"], row["enabled"], row["status"], row["device_ids"]) == ("Wake", True, "error", [])
    assert "interrupted" in row["last_error"]


async def test_the_slots_are_claimed_before_they_are_written_so_a_crash_mid_send_leaves_no_strays(
    ws, config_entry
) -> None:
    coordinator = config_entry.runtime_data
    with patch.object(coordinator, "_async_send_to_clock", AsyncMock(side_effect=RuntimeError("stopped mid-send"))):
        response = await send(ws, config_entry, "reminder_set", **ALARM)
    assert response["success"] is False

    row = (await listing(ws, config_entry))["items"][0]
    # It owns slot 1 (a Re-send reuses it) and says the send was not finished.
    assert (row["name"], row["status"], row["device_ids"]) == ("Wake", "error", [1])
    assert "interrupted" in row["last_error"]


async def test_an_edit_that_never_reached_the_clock_is_not_reported_as_synced_after_a_restart(
    hass, ws, config_entry, clock: FakeClockDevice
) -> None:
    """Only the art changes, so hour, minute, name, repeat and ring length -- everything the status compares with the
    clock -- still match what the clock holds. Home Assistant stops after the edit is saved and before it is sent."""
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)
    with patch(
        "custom_components.iledclock.reminder_manager.attachment_contents", side_effect=RuntimeError("stopped early")
    ):
        response = await send(
            ws, config_entry, "reminder_set", key=item["key"], attachment={"kind": "text", "color": [255, 0, 0]}
        )
    assert response["success"] is False

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()

    row = item_row(await listing(ws, config_entry), item["key"])
    assert row["status"] == "error" and "interrupted" in row["last_error"]
    assert row["attachment"] == {"kind": "text", "color": [255, 0, 0]}  # the edit itself was kept

    sent = await item_of(ws, config_entry, "reminder_resend", key=item["key"])  # and sending it again clears the mark
    assert (sent["status"], sent["last_error"]) == ("synced", None)


async def test_a_resend_that_stopped_after_claiming_its_slots_is_not_reported_as_synced_after_a_restart(
    hass, ws, config_entry, clock: FakeClockDevice
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)
    coordinator = config_entry.runtime_data
    with patch.object(coordinator, "_async_send_to_clock", AsyncMock(side_effect=RuntimeError("stopped mid-send"))):
        assert (await send(ws, config_entry, "reminder_resend", key=item["key"]))["success"] is False

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    row = item_row(await listing(ws, config_entry), item["key"])
    assert (row["status"], row["device_ids"]) == ("error", [1]) and "interrupted" in row["last_error"]

    sent = await item_of(ws, config_entry, "reminder_resend", key=item["key"])
    assert (sent["status"], sent["last_error"]) == ("synced", None)


async def test_the_clock_gets_the_settle_time_before_a_reminder_is_read_back(
    ws, config_entry, clock: FakeClockDevice, monkeypatch
) -> None:
    monkeypatch.setattr(hardware, "REMINDER_SAVE_SETTLE_S", 0.3)
    stamps: list[tuple[float, bytes]] = []
    real = clock._reply_for

    def stamped(payload: bytes):
        stamps.append((time.monotonic(), payload[:2]))
        return real(payload)

    monkeypatch.setattr(clock, "_reply_for", stamped)
    await item_of(ws, config_entry, "reminder_set", **ALARM)

    last_chunk = max(at for at, head in stamps if head[0] == 0x03)
    read_back = min(at for at, head in stamps if head == b"\x1a\x02" and at > last_chunk)
    assert read_back - last_chunk >= 0.25


async def test_a_reminder_the_clock_stored_differently_is_reported_not_trusted(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    # Whatever was sent, slot 1 reads back at 09:00 instead of 07:15.
    clock.reply_overrides[(0x1A, 0x02)] = bytes.fromhex("1a0201011a0a0109000100001e04") + b"Wake"
    message = await fail_of(ws, config_entry, "reminder_set", **ALARM)

    assert "didn't keep that alarm" in message
    row = (await listing(ws, config_entry))["items"][0]
    assert (row["status"], row["last_error"], row["device_ids"]) == ("error", message, [1])


async def test_an_unreachable_clock_keeps_the_definition_and_deleting_needs_the_clock_only_for_held_slots(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    held = await item_of(ws, config_entry, "reminder_set", **ALARM)
    clock.mark_disconnected()
    clock.connect_error = BleakError("no route to device")

    message = await fail_of(ws, config_entry, "reminder_set", **{**ALARM, "name": "Pills"})
    assert "reach the clock" in message
    pills = next(row for row in (await listing(ws, config_entry))["items"] if row["name"] == "Pills")
    assert (pills["status"], pills["last_error"], pills["device_ids"]) == ("error", message, [])

    # An item that holds nothing on the clock can be switched off and deleted without the clock.
    off = await item_of(ws, config_entry, "reminder_set_enabled", key=pills["key"], enabled=False)
    assert (off["status"], off["last_error"]) == ("disabled", None)
    assert (await send(ws, config_entry, "reminder_delete", key=pills["key"]))["success"] is True

    # One that holds a slot cannot be deleted while the clock is out of reach, and keeps saying why.
    assert "reach the clock" in await fail_of(ws, config_entry, "reminder_delete", key=held["key"])
    row = item_row(await listing(ws, config_entry), held["key"])
    assert (row["status"], row["device_ids"]) == ("error", [1])

    clock.connect_error = None
    assert (await send(ws, config_entry, "reminder_delete", key=held["key"]))["success"] is True
    assert clock.reminders == {}


async def test_a_clock_that_keeps_a_slot_when_told_to_delete_it_leaves_the_item_in_place_with_the_slot_held(
    ws, config_entry, clock: FakeClockDevice, one_reminder_per_day
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekends")
    clock.reminder_delete_results[2] = 1  # the clock refuses to delete slot 2

    message = await fail_of(ws, config_entry, "reminder_set_enabled", key=item["key"], enabled=False)
    assert "remove it from the clock" in message
    row = item_row(await listing(ws, config_entry), item["key"])
    assert (row["enabled"], row["device_ids"], row["status"], row["last_error"]) == (False, [2], "error", message)
    assert sorted(clock.reminders) == [2]

    clock.reminder_delete_results.clear()
    again = await item_of(ws, config_entry, "reminder_resend", key=item["key"])
    assert (again["status"], again["device_ids"], again["last_error"]) == ("disabled", [], None)
    assert clock.reminders == {}


# -- the clock's own reminders: listing, deleting, drifting --------------------------------------------------------


async def test_reminders_made_in_the_vendor_app_are_listed_and_can_be_deleted_by_id(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    clock.add_reminder(0, "Testing testing ", year=26, month=10, day=1, hour=23, minute=32)
    await config_entry.runtime_data.async_refresh()

    listed = await listing(ws, config_entry)
    assert (listed["used"], listed["free"], listed["items"]) == (1, 13, [])
    assert listed["foreign"] == [
        {"id": 0, "content": "Testing testing ", "year": 2026, "month": 10, "day": 1, "hour": 23, "minute": 32,
         "repeat_type": 0, "week_mask": 0, "duration": 30, "sound": 1}
    ]

    assert (await send(ws, config_entry, "reminder_delete", id=0))["success"] is True
    assert clock.reminders == {}
    listed = await listing(ws, config_entry)
    assert (listed["foreign"], listed["used"]) == ([], 0)


async def test_a_slot_an_alarm_holds_cannot_be_deleted_by_id_and_one_target_must_be_given(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)

    assert "belongs to" in await fail_of(ws, config_entry, "reminder_delete", id=1)
    assert sorted(clock.reminders) == [1]
    assert "key or an id" in await fail_of(ws, config_entry, "reminder_delete")
    assert "key or an id" in await fail_of(ws, config_entry, "reminder_delete", id=1, key=item["key"])
    assert "between 0 and 255" in await fail_of(ws, config_entry, "reminder_delete", id=300)


async def test_a_clock_reminder_that_vanished_or_was_edited_is_flagged_and_resend_puts_it_right(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    coordinator = config_entry.runtime_data
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)

    clock.reminders[1].hour = 9  # edited in the vendor app
    await coordinator.async_refresh()
    assert item_row(await listing(ws, config_entry), item["key"])["status"] == "changed"
    fixed = await item_of(ws, config_entry, "reminder_resend", key=item["key"])
    assert (fixed["status"], clock.reminders[1].hour) == ("synced", 7)

    del clock.reminders[1]  # deleted in the vendor app
    await coordinator.async_refresh()
    assert item_row(await listing(ws, config_entry), item["key"])["status"] == "missing"
    back = await item_of(ws, config_entry, "reminder_resend", key=item["key"])
    assert (back["status"], back["device_ids"], sorted(clock.reminders)) == ("synced", [1], [1])


async def test_alarms_survive_a_restart_and_match_up_with_the_clock_again(
    hass, ws, config_entry, clock: FakeClockDevice
) -> None:
    item = await item_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekdays")
    off = await item_of(ws, config_entry, "reminder_set", **{**ALARM, "name": "Pills", "enabled": False})
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()

    listed = await listing(ws, config_entry)
    assert [(row["key"], row["status"], row["device_ids"]) for row in listed["items"]] == [
        (item["key"], "synced", [1]),  # one reminder with the week mask
        (off["key"], "disabled", []),
    ]
    assert (listed["used"], listed["foreign"]) == (1, []) and listed["synced_at"] is not None
    resent = await item_of(ws, config_entry, "reminder_set", key=item["key"], hour=8)  # and still editable
    assert (resent["status"], resent["device_ids"]) == ("synced", [1])


async def test_a_refresh_that_cannot_read_every_reminder_keeps_the_last_known_list(
    config_entry, clock: FakeClockDevice
) -> None:
    coordinator = config_entry.runtime_data
    clock.add_reminder(1, "A")
    clock.add_reminder(2, "B")
    await coordinator.async_refresh()
    assert [reminder.id for reminder in coordinator.data.reminders] == [1, 2]

    real = coordinator.client.async_request

    async def flaky(payload: bytes, **kwargs):
        if payload[:3] == b"\x1a\x02\x02":
            raise IledClockTimeoutError("did not answer")
        return await real(payload, **kwargs)

    clock.add_reminder(3, "C")
    with patch.object(coordinator.client, "async_request", flaky):
        await coordinator.async_refresh()
    assert [reminder.id for reminder in coordinator.data.reminders] == [1, 2]


async def test_a_refresh_whose_reminder_read_is_overtaken_by_a_save_keeps_the_saved_state(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    coordinator = config_entry.runtime_data
    manager = coordinator.reminders
    real_read = manager.async_read_clock
    reads = {"count": 0}

    async def read_then_save():
        reads["count"] += 1
        if reads["count"] > 1:
            return await real_read()
        stale = await real_read()  # the refresh reads the still empty clock ...
        await manager.async_save(ALARM)  # ... and a save completes before the refresh publishes
        return stale

    with patch.object(manager, "async_read_clock", read_then_save):
        await coordinator.async_refresh()

    listed = await listing(ws, config_entry)
    assert (listed["used"], [row["status"] for row in listed["items"]]) == (1, ["synced"])
    assert [reminder.id for reminder in coordinator.data.reminders] == [1]


async def test_a_save_that_lands_while_a_refresh_is_still_reading_other_things_is_not_overwritten(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    """The refresh reads the reminders in the middle of its pass; the countdown, stopwatch and scoreboard reads come
    after. A save that completes during those later reads must survive the refresh's final publication."""
    coordinator = config_entry.runtime_data
    real = coordinator.client.async_request
    saved: list[dict] = []

    async def request(payload: bytes, **kwargs):
        if payload[:2] == b"\x0f\x01" and not saved:  # countdown status, read after the reminders
            saved.append(await coordinator.reminders.async_save(ALARM))
        return await real(payload, **kwargs)

    with patch.object(coordinator.client, "async_request", request):
        await coordinator.async_refresh()

    assert len(saved) == 1
    assert [reminder.id for reminder in coordinator.data.reminders] == [1]
    listed = await listing(ws, config_entry)
    assert (listed["used"], [row["status"] for row in listed["items"]]) == (1, ["synced"])


async def test_year_regression_the_live_readback_shows_the_real_year(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    """The reminder made in the vendor app on the live clock (2026-10-01): the wire carries the year as 26
    (0x1a), which used to reach the UI raw ("26-10-01"). Bytes: id 0, sound 1, YY 26, 10-01 23:32, repeat 0, mask 0,
    duration 30, title 'Testing testing ' (sound, mask and duration were not recorded live; these are plausible)."""
    title = b"Testing testing "
    clock.reply_overrides[(0x1A, 0x01)] = bytes.fromhex("1a010100")
    clock.reply_overrides[(0x1A, 0x02)] = bytes.fromhex("1a020001" "1a0a01" "1720" "00" "00" "001e" "10") + title
    await config_entry.runtime_data.async_refresh()

    expected = {
        "id": 0, "content": "Testing testing ", "year": 2026, "month": 10, "day": 1, "hour": 23, "minute": 32,
        "repeat_type": 0, "week_mask": 0, "duration": 30, "sound": 1,
    }
    state = await full_state(ws, config_entry)
    assert state["state"]["reminders"] == [expected]
    assert state["reminder_list"]["foreign"] == [expected]


# -- art ------------------------------------------------------------------------------------------------------------------


async def save_design(ws, *, kind: str = "image", frames: int = 1, **extra) -> str:
    """A Library design of solid red / blue 32x16 frames; returns its id."""
    colours = [(200, 0, 0), (0, 0, 200)]
    encoded = [base64.b64encode(bytes(colours[index % 2]) * (32 * 16)).decode("ascii") for index in range(frames)]
    design = {"name": "Art", "kind": kind, "frames": encoded, **extra}
    if kind == "animation":
        design["delays"] = [100] * frames
    await ws.send_json_auto_id({"type": "iledclock/designs/save", "design": design})
    response = await ws.receive_json()
    assert response["success"] is True, response
    return response["result"]["id"]


async def test_library_art_is_what_the_clock_stores_and_the_name_is_the_title(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    still = await save_design(ws)
    moving = await save_design(ws, kind="animation", frames=3)

    one = await item_of(ws, config_entry, "reminder_set", **ALARM, attachment={"kind": "design", "design_id": still})
    two = await item_of(
        ws, config_entry, "reminder_set", **{**ALARM, "name": "Pills"}, attachment={"kind": "design", "design_id": moving}
    )
    assert (clock.reminders[one["device_ids"][0]].attachment_tags, clock.reminders[one["device_ids"][0]].title) == (
        [GRAFFITI], "Wake")
    assert clock.reminders[two["device_ids"][0]].attachment_tags == [ANIMATION]
    assert two["attachment"] == {"kind": "design", "design_id": moving}


async def test_a_design_that_cannot_ride_on_a_reminder_is_refused_with_the_reason_and_kept_as_a_definition(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    with_clock = await save_design(ws, kind="animation", frames=2, clock_region={"x": 16, "y": 0, "w": 16, "h": 7})
    message = await fail_of(
        ws, config_entry, "reminder_set", **ALARM, attachment={"kind": "design", "design_id": with_clock}
    )
    assert "design with a clock" in message
    row = (await listing(ws, config_entry))["items"][0]
    assert (row["status"], row["last_error"], row["device_ids"]) == ("error", message, [])

    gone = await fail_of(ws, config_entry, "reminder_set", **ALARM, attachment={"kind": "design", "design_id": "nope"})
    assert "isn't in the Library" in gone
    assert clock.reminders == {} and len(clock.uploads) == 0


async def test_a_long_name_scrolls_as_a_marquee_the_clock_accepts(ws, config_entry, clock: FakeClockDevice) -> None:
    item = await item_of(ws, config_entry, "reminder_set", name="Take out the garbage", hour=7, minute=0, repeat="daily")
    assert item["status"] == "synced"
    reminder = clock.reminders[item["device_ids"][0]]
    assert (reminder.title, reminder.attachment_tags) == ("Take out the garbage", [ANIMATION])


# -- what must NOT change -------------------------------------------------------------------------------------------------


async def test_reminder_writes_leave_the_playlist_and_what_is_showing_alone(
    hass, ws, config_entry, clock: FakeClockDevice, device_id: str
) -> None:
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SET_PLAYLIST,
        {"device_id": device_id, "playlist": [{"kind": "text", "params": {"text": "HI"}, "duration_s": 5}]},
        blocking=True,
    )
    before = await full_state(ws, config_entry)
    item = await item_of(ws, config_entry, "reminder_set", **ALARM)
    await item_of(ws, config_entry, "reminder_set_enabled", key=item["key"], enabled=False)
    await send(ws, config_entry, "reminder_delete", key=item["key"])

    after = await full_state(ws, config_entry)
    for key in ("playlist", "now_showing", "history"):
        assert after[key] == before[key], key
    assert before["playlist"] and before["now_showing"] is not None


@pytest.mark.parametrize("preserves", [False, True])
async def test_after_an_upload_screen_a_is_put_back_unless_the_clock_is_known_to_keep_it(
    ws, config_entry, clock: FakeClockDevice, monkeypatch, preserves: bool
) -> None:
    monkeypatch.setattr(hardware, "REMINDER_UPLOAD_PRESERVES_SLOTS", preserves)
    coordinator = config_entry.runtime_data
    held_during: list[bool] = []

    async def reassert() -> None:
        held_during.append(coordinator.show_lock.locked())

    monkeypatch.setattr(coordinator, "async_reassert_program_list_locked", reassert)

    item = await item_of(ws, config_entry, "reminder_set", **ALARM)
    assert held_during == ([] if preserves else [True])  # called with the show lock held

    await item_of(ws, config_entry, "reminder_set_enabled", key=item["key"], enabled=False)  # deletes only
    assert held_during == ([] if preserves else [True])

    await item_of(ws, config_entry, "reminder_set_enabled", key=item["key"], enabled=True)  # uploads again
    assert held_during == ([] if preserves else [True, True])

    clock.chunk_ack_result = 2  # a failed upload does not re-send anything
    await fail_of(ws, config_entry, "reminder_set", key=item["key"], hour=9)
    assert held_during == ([] if preserves else [True, True])


@pytest.mark.parametrize("preserves", [False, True])
async def test_screen_a_program_list_really_follows_a_reminder_upload_unless_the_clock_keeps_it(
    hass, ws, config_entry, clock: FakeClockDevice, device_id: str, monkeypatch, preserves: bool
) -> None:
    monkeypatch.setattr(hardware, "REMINDER_UPLOAD_PRESERVES_SLOTS", preserves)
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SET_PLAYLIST,
        {"device_id": device_id, "playlist": [{"kind": "text", "params": {"text": "HI"}, "duration_s": 5}]},
        blocking=True,
    )
    clock.written.clear()

    await item_of(ws, config_entry, "reminder_set", **ALARM)

    # The byte after the 8 zeros of every start frame is its kind: 05 for a reminder, 00 for the program list.
    assert [start[20] for start, _chunks in clock.uploads] == ([5] if preserves else [5, 0])


async def test_a_failed_screen_a_restore_is_reported_but_the_alarm_stays_saved(
    ws, config_entry, clock: FakeClockDevice, monkeypatch
) -> None:
    async def reassert() -> None:
        raise IledClockConnectionError("link dropped")

    monkeypatch.setattr(config_entry.runtime_data, "async_reassert_program_list_locked", reassert)
    message = await fail_of(ws, config_entry, "reminder_set", **ALARM)
    assert "saved on the clock" in message and "screen A" in message
    row = (await listing(ws, config_entry))["items"][0]
    assert (row["status"], row["last_error"], row["device_ids"]) == ("synced", None, [1])
    assert sorted(clock.reminders) == [1]


async def test_progress_events_count_the_slots_of_a_multi_slot_save(
    hass, ws, config_entry, clock: FakeClockDevice, one_reminder_per_day
) -> None:
    events: list[dict] = []

    @callback
    def record(payload: dict) -> None:
        events.append(payload)

    unsubscribe = async_dispatcher_connect(hass, const.upload_progress_signal(config_entry.entry_id), record)
    try:
        await item_of(ws, config_entry, "reminder_set", name="Gym", hour=7, minute=0, repeat="weekdays")
    finally:
        unsubscribe()

    starts = [event for event in events if event["state"] == "start"]
    assert [(event["program"], event["programs"]) for event in starts] == [(index, 5) for index in range(5)]
    assert events[-1]["state"] == "done" and events[-1]["upload"] is None


# -- validation: nothing is saved -------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("params", "containing"),
    [
        ({"name": "   "}, "Give it a name"),
        ({"name": "A" * 21}, "at most 20"),
        ({"hour": 24}, "between 0 and 23"),
        ({"repeat": "weekly", "days": [1, 2]}, "one weekday"),
        ({"repeat": "monthly", "date": "2026-11-30"}, "1 to 28"),
        ({"duration_s": 45}, "30, 60, 120 or 180"),
        ({"repeat": "once", "date": "2020-01-01"}, "already passed"),
        ({"attachment": {"kind": "design"}}, "Pick a design"),
    ],
)
async def test_invalid_input_is_refused_in_plain_words_and_saves_nothing(
    ws, config_entry, clock: FakeClockDevice, params: dict, containing: str
) -> None:
    message = await fail_of(ws, config_entry, "reminder_set", **{**ALARM, **params})
    assert containing in message
    assert (await listing(ws, config_entry))["items"] == [] and len(clock.uploads) == 0


async def test_unknown_keys_and_wrong_types_are_command_failures_not_crashes(ws, config_entry) -> None:
    assert "no longer exists" in await fail_of(ws, config_entry, "reminder_set", key="deadbeef0000", **ALARM)
    assert "no longer exists" in await fail_of(ws, config_entry, "reminder_resend", key="deadbeef0000")
    assert "no longer exists" in await fail_of(ws, config_entry, "reminder_set_enabled", key="deadbeef0000", enabled=True)
    assert "on or off" in await fail_of(ws, config_entry, "reminder_set_enabled", key="deadbeef0000", enabled="yes")
    assert "no longer exists" in await fail_of(ws, config_entry, "reminder_resend")
    assert (await listing(ws, config_entry))["items"] == []


async def test_a_finished_one_time_alarm_cannot_be_switched_on_again_until_it_gets_a_new_time(
    ws, config_entry, clock: FakeClockDevice
) -> None:
    coordinator = config_entry.runtime_data
    past = dt_util.now().replace(tzinfo=None) - dt.timedelta(hours=1)
    stale = ReminderItem(
        key="aaaaaaaaaaaa", name="Done", kind="alarm", hour=past.hour, minute=past.minute, date=past.date(),
        repeat="once", days=(), duration_s=30, attachment=ReminderAttachment(), enabled=True, device_ids=(4,),
    )
    await coordinator.reminders._store.async_upsert(stale)

    row = item_row(await listing(ws, config_entry), "aaaaaaaaaaaa")
    assert row["status"] == "done"
    off = await item_of(ws, config_entry, "reminder_set_enabled", key="aaaaaaaaaaaa", enabled=False)
    assert off["status"] == "disabled"
    assert "already passed" in await fail_of(ws, config_entry, "reminder_set_enabled", key="aaaaaaaaaaaa", enabled=True)


async def test_the_list_of_saved_alarms_is_capped(ws, config_entry) -> None:
    store = config_entry.runtime_data.reminders._store
    for index in range(const.REMINDER_MAX_ITEMS):
        await store.async_upsert(ReminderItem(
            key=f"{index:012x}", name=f"N{index}", kind="alarm", hour=7, minute=0, date=None, repeat="daily",
            days=(), duration_s=30, attachment=ReminderAttachment(), enabled=False,
        ))
    assert f"up to {const.REMINDER_MAX_ITEMS}" in await fail_of(ws, config_entry, "reminder_set", **ALARM)


# -- services ---------------------------------------------------------------------------------------------------------------------


async def test_services_create_switch_and_delete_and_answer_with_the_item(
    hass, config_entry, clock: FakeClockDevice, device_id: str, one_reminder_per_day
) -> None:
    made = await hass.services.async_call(
        DOMAIN, const.SERVICE_REMINDER_SET,
        {"device_id": device_id, "name": "Gym", "time": "18:30:00", "repeat": "custom", "days": ["mon", "wed"],
         "duration_s": 60, "kind": "reminder"},
        blocking=True, return_response=True,
    )
    item = made["item"]
    assert (item["kind"], item["repeat"], item["days"], item["duration_s"], item["slots"]) == (
        "reminder", "custom", [0, 2], 60, 2)
    assert sorted(clock.reminders) == item["device_ids"] == [1, 2]
    assert (clock.reminders[1].hour, clock.reminders[1].minute, clock.reminders[1].duration) == (18, 30, 60)

    # An edit through the service keeps everything it does not mention.
    moved = await hass.services.async_call(
        DOMAIN, const.SERVICE_REMINDER_SET,
        {"device_id": device_id, "key": item["key"], "name": "Gym", "time": "19:00:00"},
        blocking=True, return_response=True,
    )
    assert (moved["item"]["days"], moved["item"]["repeat"], moved["item"]["hour"]) == ([0, 2], "custom", 19)
    assert (clock.reminders[1].hour, clock.reminders[1].minute) == (19, 0)

    off = await hass.services.async_call(
        DOMAIN, const.SERVICE_REMINDER_SET_ENABLED,
        {"device_id": device_id, "key": item["key"], "enabled": False}, blocking=True, return_response=True,
    )
    assert (off["item"]["status"], clock.reminders) == ("disabled", {})

    await hass.services.async_call(
        DOMAIN, const.SERVICE_REMINDER_SET_ENABLED, {"device_id": device_id, "key": item["key"], "enabled": True},
        blocking=True,
    )
    assert sorted(clock.reminders) == [1, 2]
    await hass.services.async_call(
        DOMAIN, const.SERVICE_REMINDER_DELETE, {"device_id": device_id, "key": item["key"]}, blocking=True
    )
    assert clock.reminders == {}


async def test_services_take_a_date_and_an_empty_design_means_name_as_text(
    hass, ws, config_entry, clock: FakeClockDevice, device_id: str
) -> None:
    art = await save_design(ws)
    day = dt.date(2030, 12, 25)
    made = await hass.services.async_call(
        DOMAIN, const.SERVICE_REMINDER_SET,
        {"device_id": device_id, "name": "Bday", "time": "09:00:00", "repeat": "yearly", "date": day.isoformat(),
         "design_id": art},
        blocking=True, return_response=True,
    )
    assert made["item"]["attachment"] == {"kind": "design", "design_id": art}
    assert made["item"]["date"] == day.isoformat()
    again = await hass.services.async_call(
        DOMAIN, const.SERVICE_REMINDER_SET,
        {"device_id": device_id, "key": made["item"]["key"], "name": "Bday", "time": "09:00:00", "design_id": ""},
        blocking=True, return_response=True,
    )
    assert again["item"]["attachment"] == {"kind": "text"}


async def test_service_calls_that_cannot_work_say_so(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    base = {"device_id": device_id, "name": "Gym", "time": "07:00:00"}
    for bad in ({"repeat": "hourly"}, {"duration_s": 45}, {"days": ["someday"]}, {"time": "25:00"}):
        with pytest.raises(vol.Invalid):
            await hass.services.async_call(DOMAIN, const.SERVICE_REMINDER_SET, {**base, **bad}, blocking=True)
    with pytest.raises(ServiceValidationError, match="at most 20"):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_REMINDER_SET, {**base, "name": "A" * 21}, blocking=True
        )
    with pytest.raises(ServiceValidationError, match="no longer exists"):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_REMINDER_SET_ENABLED, {"device_id": device_id, "key": "nope", "enabled": True},
            blocking=True,
        )
    for both_or_neither in ({}, {"id": 1, "key": "abc"}):
        with pytest.raises(vol.Invalid):
            await hass.services.async_call(
                DOMAIN, const.SERVICE_REMINDER_DELETE, {"device_id": device_id, **both_or_neither}, blocking=True
            )
    clock.mark_disconnected()
    clock.connect_error = BleakError("no route to device")
    with pytest.raises(HomeAssistantError, match="reach the clock"):
        await hass.services.async_call(DOMAIN, const.SERVICE_REMINDER_SET, base, blocking=True)
    assert len(clock.uploads) == 0
