"""Alarms & reminders, the pure domain (`reminders.py`): what is accepted, what a schedule costs on the
clock, which clock reminders it becomes, which ids they get, how the clock's list is compared, and that the
header written for one of them is the vendor's (the recorded golden vectors)."""

from __future__ import annotations

import datetime as dt
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from custom_components.iledclock import hardware, reminders
from custom_components.iledclock.designs import FRAME_BYTES, Design
from custom_components.iledclock.protocol import responses
from custom_components.iledclock.protocol.models import Frame
from custom_components.iledclock.protocol.programs import (
    AnimationContent,
    ClockContent,
    GraffitiContent,
    ReminderContent,
    encode_content,
    plan_upload,
)
from custom_components.iledclock.reminders import (
    DevicePlan,
    ReminderAttachment,
    ReminderCapacityError,
    ReminderItem,
    ReminderValidationError,
    allocate_ids,
    attachment_contents,
    build_reminder_program,
    plan_device_reminders,
    reconcile,
    reminder_state_from_detail,
    slots_needed,
    validate_item,
)
from custom_components.iledclock.state import ReminderState
from custom_components.iledclock.ws_shapes import shape_reminder

VECTORS = Path(__file__).resolve().parents[1] / "fixtures" / "golden" / "vectors.json"

#: A Friday morning.
NOW = dt.datetime(2026, 10, 2, 9, 30)
TODAY = NOW.date()


def make_item(**overrides) -> ReminderItem:
    fields = dict(
        key="k1", name="Wake up", kind="alarm", hour=7, minute=15, date=None, repeat="daily", days=(),
        duration_s=30, attachment=ReminderAttachment(), enabled=True,
    )
    fields.update(overrides)
    return ReminderItem(**fields)


def validate(raw=None, **kwargs):
    base = {"name": "Wake up", "hour": 7, "minute": 15}
    base.update(raw or {})
    return validate_item(base, today=kwargs.pop("today", TODAY), now=kwargs.pop("now", NOW), **kwargs)


def plans(item, *, mask=False, now=NOW):
    return plan_device_reminders(item, today=now.date(), now=now, week_mask_supported=mask)


def device_like(item, plan, reminder_id, **changes) -> ReminderState:
    """What the clock reports for `plan`, with `changes` applied (a clock reminder edited in the vendor app)."""
    fields = dict(
        id=reminder_id, content=item.name, year=plan.date.year, month=plan.date.month, day=plan.date.day,
        hour=plan.hour, minute=plan.minute, repeat_type=plan.repeat_type, week_mask=0,
        duration=item.duration_s, sound=1,
    )
    fields.update(changes)
    return ReminderState(**fields)


class ValidationTests(unittest.TestCase):
    def assertRejected(self, raw, field, containing=""):
        with self.assertRaises(ReminderValidationError) as caught:
            validate(raw)
        self.assertEqual(caught.exception.field, field)
        self.assertIn(containing, str(caught.exception))
        self.assertIsInstance(caught.exception, ValueError)

    def test_a_minimal_input_gets_the_documented_defaults(self) -> None:
        item = validate()
        self.assertEqual(
            (item.kind, item.repeat, item.days, item.duration_s, item.attachment, item.enabled, item.date),
            ("alarm", "once", (), 30, ReminderAttachment(kind="text"), True, TODAY + dt.timedelta(days=1)),
        )  # 07:15 has already passed today, so the one-time default date is tomorrow
        self.assertRegex(item.key, r"^[0-9a-f]{12}$")
        self.assertEqual((item.device_ids, item.last_ids, item.last_error), ((), (), None))

    def test_unknown_keys_are_ignored_and_the_name_is_trimmed(self) -> None:
        item = validate({"name": "  Pills  ", "colour": "red", "status": "synced", "slots": 9})
        self.assertEqual(item.name, "Pills")

    def test_name_must_not_be_empty_or_hold_control_characters(self) -> None:
        for name in ("", "   ", None, 5):
            self.assertRejected({"name": name}, "name", "name")
        self.assertRejected({"name": "line\nbreak"}, "name", "control characters")

    def test_name_limit_counts_utf16_units_not_characters(self) -> None:
        self.assertEqual(validate({"name": "A" * 20}).name, "A" * 20)
        self.assertRejected({"name": "A" * 21}, "name", "at most 20")
        # An emoji is two UTF-16 units: ten fit, eleven do not.
        self.assertEqual(validate({"name": "\U0001F600" * 10}).name, "\U0001F600" * 10)
        self.assertRejected({"name": "\U0001F600" * 11}, "name", "at most 20")

    def test_name_is_also_limited_in_utf8_bytes(self) -> None:
        wide = "\u6d17" * 20  # 20 UTF-16 units but 60 UTF-8 bytes: exactly at the byte limit
        self.assertEqual(validate({"name": wide}).name, wide)
        with patch.object(reminders, "REMINDER_NAME_MAX_UTF16", 30):
            self.assertRejected({"name": "\u6d17" * 21}, "name", "too long for the clock")

    def test_time_must_be_whole_numbers_in_range(self) -> None:
        for hour in (0, 23, 7.0):
            self.assertEqual(validate({"hour": hour}).hour, int(hour))
        for minute in (0, 59):
            self.assertEqual(validate({"minute": minute}).minute, minute)
        for bad in (24, -1, True, "7", 7.5, None):
            self.assertRejected({"hour": bad}, "hour", "0 and 23")
        for bad in (60, -1, False, "30"):
            self.assertRejected({"minute": bad}, "minute", "0 and 59")

    def test_kind_repeat_and_ring_length_must_be_known_values(self) -> None:
        self.assertEqual(validate({"kind": "reminder"}).kind, "reminder")
        self.assertRejected({"kind": "timer"}, "kind", "Alarm or Reminder")
        self.assertRejected({"repeat": "hourly"}, "repeat")
        for seconds in (30, 60, 120, 180):
            self.assertEqual(validate({"duration_s": seconds}).duration_s, seconds)
        for bad in (0, 45, 300, True, "60"):
            self.assertRejected({"duration_s": bad}, "duration_s", "30, 60, 120 or 180")

    def test_enabled_must_be_a_real_boolean(self) -> None:
        self.assertFalse(validate({"enabled": False}).enabled)
        self.assertRejected({"enabled": 1}, "enabled")

    def test_one_time_without_a_date_gets_the_next_time_it_is_that_time_of_day(self) -> None:
        self.assertEqual(validate({"hour": 10, "minute": 0}).date, TODAY)
        self.assertEqual(validate({"hour": 9, "minute": 31}).date, TODAY)
        # Exactly now, and earlier today: tomorrow.
        self.assertEqual(validate({"hour": 9, "minute": 30}).date, TODAY + dt.timedelta(days=1))
        self.assertEqual(validate({"hour": 9, "minute": 0}).date, TODAY + dt.timedelta(days=1))

    def test_an_enabled_one_time_item_in_the_past_is_rejected_but_a_disabled_one_is_kept(self) -> None:
        past = {"date": "2026-10-02", "hour": 9, "minute": 30}  # exactly now counts as passed
        self.assertRejected(past, "date", "That time has already passed")
        self.assertRejected({"date": "2026-10-01", "hour": 23, "minute": 59}, "date", "already passed")
        self.assertEqual(validate({**past, "enabled": False}).date, TODAY)
        self.assertEqual(validate({"date": "2026-10-02", "hour": 9, "minute": 31}).date, TODAY)

    def test_dates_must_be_real_and_inside_the_supported_years(self) -> None:
        self.assertRejected({"date": "2026-02-30"}, "date", "valid date")
        self.assertRejected({"date": "next friday"}, "date", "valid date")
        self.assertRejected({"date": 20261002}, "date", "valid date")
        self.assertRejected({"date": "2100-01-01"}, "date", "between 2000 and 2099")
        self.assertEqual(validate({"date": dt.date(2027, 1, 5)}).date, dt.date(2027, 1, 5))

    def test_monthly_needs_a_day_from_1_to_28(self) -> None:
        self.assertRejected({"repeat": "monthly"}, "date", "day of the month")
        for day in (1, 28):
            self.assertEqual(validate({"repeat": "monthly", "date": f"2026-11-{day:02d}"}).date.day, day)
        for day in (29, 30, 31):
            self.assertRejected({"repeat": "monthly", "date": f"2026-10-{day:02d}"}, "date", "1 to 28")

    def test_yearly_needs_a_date_that_exists_every_year(self) -> None:
        self.assertRejected({"repeat": "yearly"}, "date", "Pick the date")
        self.assertRejected({"repeat": "yearly", "date": "2028-02-29"}, "date", "29 February")
        self.assertEqual(validate({"repeat": "yearly", "date": "2026-02-28"}).date, dt.date(2026, 2, 28))

    def test_weekly_takes_exactly_one_day_and_custom_at_least_one(self) -> None:
        self.assertEqual(validate({"repeat": "weekly", "days": [4]}).days, (4,))
        for days in ([], [1, 2], None):
            self.assertRejected({"repeat": "weekly", "days": days}, "days", "one weekday")
        self.assertEqual(validate({"repeat": "custom", "days": [6, 0, 6, 2]}).days, (0, 2, 6))
        self.assertRejected({"repeat": "custom", "days": []}, "days", "at least one")
        for days in ([7], [-1], ["mon"], [True], "0", 3):
            self.assertRejected({"repeat": "custom", "days": days}, "days", "0 (Monday) to 6 (Sunday)")

    def test_custom_with_all_seven_days_becomes_daily(self) -> None:
        item = validate({"repeat": "custom", "days": [0, 1, 2, 3, 4, 5, 6]})
        self.assertEqual((item.repeat, item.days), ("daily", ()))

    def test_repeats_that_carry_no_days_or_no_date_drop_them(self) -> None:
        for repeat in ("daily", "weekdays", "weekends"):
            item = validate({"repeat": repeat, "days": [1, 2], "date": "2026-11-01"})
            self.assertEqual((item.days, item.date), ((), None))
        weekly = validate({"repeat": "weekly", "days": [3], "date": "2026-11-01"})
        self.assertIsNone(weekly.date)
        monthly = validate({"repeat": "monthly", "days": [1], "date": "2026-11-05"})
        self.assertEqual(monthly.days, ())

    def test_attachment_is_a_design_or_text_with_an_optional_colour(self) -> None:
        self.assertEqual(validate({"attachment": None}).attachment, ReminderAttachment())
        self.assertEqual(validate({"attachment": {}}).attachment, ReminderAttachment())
        design = validate({"attachment": {"kind": "design", "design_id": "abc"}}).attachment
        self.assertEqual((design.kind, design.design_id), ("design", "abc"))
        text = validate({"attachment": {"kind": "text", "color": [0, 128, 255]}}).attachment
        self.assertEqual((text.kind, text.color), ("text", (0, 128, 255)))
        self.assertRejected({"attachment": {"kind": "design"}}, "attachment", "Pick a design")
        self.assertRejected({"attachment": {"kind": "design", "design_id": ""}}, "attachment", "Pick a design")
        self.assertRejected({"attachment": {"kind": "sound"}}, "attachment", "design or use the name")
        self.assertRejected({"attachment": "design"}, "attachment", "design or use the name")
        for color in ([1, 2], [1, 2, 3, 4], [1, 2, 256], [1, 2, -1], "red", [1.5, 2, 3]):
            self.assertRejected({"attachment": {"kind": "text", "color": color}}, "attachment", "three numbers")

    def test_an_edit_keeps_what_the_input_leaves_out_and_the_clock_bookkeeping(self) -> None:
        existing = make_item(
            repeat="weekly", days=(4,), duration_s=120, attachment=ReminderAttachment(kind="design", design_id="d1"),
            device_ids=(3,), last_ids=(3, 4), last_error="boom", updated=12.5, enabled=False, kind="reminder",
        )
        item = validate({"name": "New name"}, existing=existing)
        self.assertEqual(
            (item.key, item.name, item.kind, item.hour, item.minute, item.repeat, item.days, item.duration_s),
            ("k1", "New name", "reminder", 7, 15, "weekly", (4,), 120),
        )
        self.assertEqual((item.attachment.design_id, item.enabled), ("d1", False))
        self.assertEqual((item.device_ids, item.last_ids, item.last_error, item.updated), ((3,), (3, 4), "boom", 12.5))

    def test_an_edit_cannot_take_another_items_key(self) -> None:
        existing = make_item(key="mine")
        self.assertEqual(validate({"key": "someone-else"}, existing=existing).key, "mine")

    def test_a_given_key_is_used_for_a_new_item(self) -> None:
        self.assertEqual(validate(key="abc123def456").key, "abc123def456")

    def test_something_that_is_not_an_object_is_rejected(self) -> None:
        with self.assertRaises(ReminderValidationError):
            validate_item(["Wake up"], today=TODAY, now=NOW)

    def test_a_timezone_aware_now_is_read_as_wall_clock_time(self) -> None:
        aware = NOW.replace(tzinfo=dt.timezone(dt.timedelta(hours=-4)))
        self.assertEqual(validate({"hour": 9, "minute": 31}, now=aware).date, TODAY)


class SlotCostTests(unittest.TestCase):
    def test_without_a_week_mask_each_picked_weekday_costs_a_slot(self) -> None:
        cost = lambda repeat, days=(): slots_needed(repeat, days, week_mask_supported=False)  # noqa: E731
        self.assertEqual([cost(r) for r in ("once", "daily", "weekly", "monthly", "yearly")], [1] * 5)
        self.assertEqual((cost("weekdays"), cost("weekends")), (5, 2))
        self.assertEqual([cost("custom", days) for days in ((2,), (0, 3), (0, 2, 4, 6))], [1, 2, 4])

    def test_with_a_week_mask_everything_costs_one_slot(self) -> None:
        cost = lambda repeat, days=(): slots_needed(repeat, days, week_mask_supported=True)  # noqa: E731
        self.assertEqual(
            [cost("weekdays"), cost("weekends"), cost("custom", (0, 2, 4, 6)), cost("weekly", (1,)), cost("once")],
            [1] * 5,
        )

    def test_a_custom_week_of_seven_is_just_daily(self) -> None:
        self.assertEqual(slots_needed("custom", tuple(range(7)), week_mask_supported=False), 1)


class PlanTests(unittest.TestCase):
    """NOW is Friday 2 October 2026, 09:30."""

    def test_one_time_uses_its_own_date(self) -> None:
        item = make_item(repeat="once", date=dt.date(2026, 11, 3), hour=18, minute=5)
        self.assertEqual(plans(item), [DevicePlan(0, None, dt.date(2026, 11, 3), 18, 5)])

    def test_daily_is_type_1_with_todays_date_and_the_vendor_mask(self) -> None:
        self.assertEqual(plans(make_item(repeat="daily")), [DevicePlan(1, None, TODAY, 7, 15)])

    def test_weekly_goes_to_the_next_occurrence_of_its_weekday_after_now(self) -> None:
        friday_later = make_item(repeat="weekly", days=(4,), hour=10)
        self.assertEqual(plans(friday_later)[0].date, TODAY)
        friday_passed = make_item(repeat="weekly", days=(4,), hour=9, minute=30)
        self.assertEqual(plans(friday_passed)[0].date, dt.date(2026, 10, 9))
        monday = make_item(repeat="weekly", days=(0,))
        self.assertEqual(plans(monday), [DevicePlan(2, None, dt.date(2026, 10, 5), 7, 15)])

    def test_weekdays_become_five_weekly_reminders_without_a_week_mask(self) -> None:
        got = plans(make_item(repeat="weekdays"))
        self.assertEqual([p.repeat_type for p in got], [2] * 5)
        self.assertEqual([p.week_mask for p in got], [None] * 5)
        # Friday 07:15 has already passed, so Friday means next Friday.
        self.assertEqual(
            [p.date for p in got],
            [dt.date(2026, 10, 5), dt.date(2026, 10, 6), dt.date(2026, 10, 7), dt.date(2026, 10, 8), dt.date(2026, 10, 9)],
        )

    def test_weekends_and_custom_days_become_one_weekly_reminder_per_day(self) -> None:
        self.assertEqual([p.date for p in plans(make_item(repeat="weekends"))], [dt.date(2026, 10, 3), dt.date(2026, 10, 4)])
        custom = plans(make_item(repeat="custom", days=(6, 0, 4), hour=10))
        # One reminder per picked day, in weekday order; each on its next occurrence after now.
        self.assertEqual([p.date.weekday() for p in custom], [0, 4, 6])
        self.assertEqual([p.date for p in custom], [dt.date(2026, 10, 5), TODAY, dt.date(2026, 10, 4)])

    def test_with_a_week_mask_a_multi_day_item_is_one_daily_reminder_with_the_mask(self) -> None:
        self.assertEqual(plans(make_item(repeat="weekdays"), mask=True), [DevicePlan(1, 0x1F, TODAY, 7, 15)])
        self.assertEqual(plans(make_item(repeat="weekends"), mask=True), [DevicePlan(1, 0x60, TODAY, 7, 15)])
        custom = plans(make_item(repeat="custom", days=(0, 2, 6)), mask=True)
        self.assertEqual(custom, [DevicePlan(1, 0b1000101, TODAY, 7, 15)])

    def test_the_week_mask_flag_does_not_change_one_day_patterns(self) -> None:
        for item in (make_item(repeat="weekly", days=(2,)), make_item(repeat="daily"),
                     make_item(repeat="once", date=dt.date(2026, 12, 1))):
            self.assertEqual(plans(item, mask=False), plans(item, mask=True))

    def test_monthly_goes_to_the_next_occurrence_of_its_day_of_month(self) -> None:
        item = make_item(repeat="monthly", date=dt.date(2026, 1, 15))
        self.assertEqual(plans(item), [DevicePlan(3, None, dt.date(2026, 10, 15), 7, 15)])
        passed = make_item(repeat="monthly", date=dt.date(2026, 1, 2), hour=9, minute=30)  # today, 09:30 = now
        self.assertEqual(plans(passed)[0].date, dt.date(2026, 11, 2))
        december = dt.datetime(2026, 12, 20, 8, 0)
        self.assertEqual(plans(item, now=december)[0].date, dt.date(2027, 1, 15))

    def test_yearly_goes_to_the_next_occurrence_of_its_month_and_day(self) -> None:
        later = make_item(repeat="yearly", date=dt.date(2024, 12, 25))
        self.assertEqual(plans(later), [DevicePlan(4, None, dt.date(2026, 12, 25), 7, 15)])
        passed = make_item(repeat="yearly", date=dt.date(2026, 3, 15))
        self.assertEqual(plans(passed)[0].date, dt.date(2027, 3, 15))

    def test_a_one_time_item_without_a_date_cannot_be_planned(self) -> None:
        with self.assertRaises(ReminderValidationError):
            plans(make_item(repeat="once", date=None))


class AllocationTests(unittest.TestCase):
    def test_hands_out_the_lowest_free_ids(self) -> None:
        self.assertEqual(allocate_ids((), 3, ()), [1, 2, 3])
        self.assertEqual(allocate_ids((), 2, {1, 2, 4}), [3, 5])

    def test_preferred_ids_come_first_when_they_are_free(self) -> None:
        self.assertEqual(allocate_ids([7, 9], 2, {1}), [7, 9])
        self.assertEqual(allocate_ids([7, 9], 3, ()), [7, 9, 1])  # the rest from the lowest free
        self.assertEqual(allocate_ids([7, 9], 1, ()), [7])  # a shrunken plan keeps the first ids

    def test_preferred_ids_that_are_taken_duplicated_or_out_of_range_are_skipped(self) -> None:
        self.assertEqual(allocate_ids([7, 7, 0, 17, 300, 9], 3, {9}), [7, 1, 2])

    def test_a_full_clock_raises_a_capacity_error_with_the_numbers(self) -> None:
        with self.assertRaises(ReminderCapacityError) as caught:
            allocate_ids((), 1, set(range(1, 15)))
        self.assertEqual((caught.exception.needed, caught.exception.free, caught.exception.field), (1, 0, "slots"))
        self.assertIn("needs 1 clock slot, only 0 free", str(caught.exception))
        self.assertIsInstance(caught.exception, ReminderValidationError)

    def test_it_does_not_fit_message_says_how_many_are_needed_and_free(self) -> None:
        with self.assertRaises(ReminderCapacityError) as caught:
            allocate_ids((), 5, set(range(1, 13)))  # twelve of fourteen used
        self.assertIn("needs 5 clock slots, only 2 free", str(caught.exception))

    def test_exactly_filling_the_clock_is_fine(self) -> None:
        self.assertEqual(allocate_ids((), 14, ()), list(range(1, 15)))
        self.assertEqual(allocate_ids((), 2, set(range(1, 13))), [13, 14])

    def test_every_reminder_on_the_clock_takes_room_also_one_outside_the_id_range(self) -> None:
        """The clock holds fourteen in all (live T6). Id 0 (the vendor app's own on the live clock) is outside 1-15 but
        still takes a slot: fourteen reminders numbered 0-13 leave no room although ids 14 and 15 are unused."""
        with self.assertRaises(ReminderCapacityError) as caught:
            allocate_ids((), 1, set(range(0, 14)))
        self.assertEqual((caught.exception.needed, caught.exception.free), (1, 0))
        self.assertEqual(allocate_ids((), 1, set(range(0, 13))), [13])  # thirteen taken: one slot left, the lowest free id
        with self.assertRaises(ReminderCapacityError) as caught:
            allocate_ids((), 2, {0, *range(2, 15)})  # ids 1 and 15 are unused, but no slot is free
        self.assertIn("needs 2 clock slots, only 0 free", str(caught.exception))

    def test_ids_above_fourteen_are_handed_out_when_lower_ones_are_held(self) -> None:
        # live T6: ids 14 and 15 were accepted with 0, 1 and 4-13 on the clock
        self.assertEqual(allocate_ids((), 2, {0, 1, *range(4, 14)}), [2, 3])
        self.assertEqual(allocate_ids([14, 15], 2, {0, 1, *range(4, 14)}), [14, 15])

    def test_more_taken_than_the_clock_can_hold_means_nothing_is_free(self) -> None:
        with self.assertRaises(ReminderCapacityError) as caught:
            allocate_ids((), 1, set(range(0, 40)))
        self.assertEqual(caught.exception.free, 0)

    def test_the_id_range_is_read_from_the_flags_at_call_time(self) -> None:
        with patch.object(hardware, "REMINDER_ID_MIN", 0), patch.object(hardware, "REMINDER_ID_MAX", 15):
            self.assertEqual(allocate_ids((), 2, ()), [0, 1])
            self.assertEqual(allocate_ids([0], 1, {1}), [0])
            with self.assertRaises(ReminderCapacityError):
                allocate_ids((), 1, set(range(0, 16)))
        self.assertEqual(allocate_ids([0], 1, ()), [1])  # back to 1..15: 0 is out of range


class ReconcileTests(unittest.TestCase):
    def sync(self, item, devices, **kwargs):
        return reconcile([item], devices, now=kwargs.pop("now", NOW), **kwargs)

    def status(self, item, devices, **kwargs):
        return self.sync(item, devices, **kwargs).statuses[item.key]

    def sent(self, **overrides):
        """An item that was sent to slot 5 and the clock reminder it should be there."""
        item = make_item(repeat="weekly", days=(0,), device_ids=(5,), **overrides)
        plan = plans(item)[0]
        return item, plan, device_like(item, plan, 5)

    def test_synced_when_every_slot_is_there_and_matches(self) -> None:
        item, _plan, device = self.sent()
        self.assertEqual(self.status(item, [device]), "synced")

    def test_changed_when_a_field_differs(self) -> None:
        item, _plan, device = self.sent()
        for changes in (
            {"hour": 8}, {"minute": 16}, {"content": "Wake up "}, {"repeat_type": 1}, {"duration": 60},
        ):
            with self.subTest(changes):
                self.assertEqual(self.status(item, [device_like(item, plans(item)[0], 5, **changes)]), "changed")

    def test_the_date_only_matters_for_one_time_items(self) -> None:
        item, plan, _device = self.sent()
        later_day = device_like(item, plan, 5, day=plan.date.day + 1)
        self.assertEqual(self.status(item, [later_day]), "synced")  # weekly dates drift: ignored
        once = make_item(repeat="once", date=dt.date(2026, 11, 3), device_ids=(5,))
        once_plan = plans(once)[0]
        self.assertEqual(self.status(once, [device_like(once, once_plan, 5)]), "synced")
        for changes in ({"day": 4}, {"month": 12}, {"year": 2027}):
            self.assertEqual(self.status(once, [device_like(once, once_plan, 5, **changes)]), "changed")

    def test_missing_when_a_slot_is_gone_even_if_others_are_there(self) -> None:
        item = make_item(repeat="weekends", device_ids=(5, 6))
        first, _second = plans(item)
        self.assertEqual(self.status(item, [device_like(item, first, 5)]), "missing")
        self.assertEqual(self.status(item, []), "missing")

    def test_a_multi_day_item_is_changed_when_the_slot_count_no_longer_matches_the_plan(self) -> None:
        item = make_item(repeat="weekdays", device_ids=(1, 2, 3, 4, 5))
        devices = [device_like(item, plan, i + 1) for i, plan in enumerate(plans(item))]
        self.assertEqual(self.status(item, devices), "synced")
        with patch.object(hardware, "REMINDER_WEEK_MASK_SUPPORTED", True):  # now one reminder would be sent
            self.assertEqual(self.status(item, devices), "changed")

    def test_pending_error_and_disabled(self) -> None:
        self.assertEqual(self.status(make_item(), []), "pending")
        self.assertEqual(self.status(make_item(last_error="no link"), []), "error")
        self.assertEqual(self.status(make_item(enabled=False), []), "disabled")
        self.assertEqual(self.status(make_item(enabled=False, last_error="stale"), []), "disabled")

    def test_error_wins_over_what_the_clock_shows(self) -> None:
        item, _plan, device = self.sent(last_error="could not send")
        self.assertEqual(self.status(item, [device]), "error")

    def test_a_switched_off_item_that_still_holds_a_slot_is_an_error(self) -> None:
        item = make_item(enabled=False, device_ids=(5,), last_error="Couldn't remove it from the clock.")
        self.assertEqual(self.status(item, []), "error")

    def test_one_time_item_is_done_once_its_moment_has_passed(self) -> None:
        past = make_item(repeat="once", date=TODAY, hour=9, minute=30, device_ids=(5,))
        self.assertEqual(self.status(past, []), "done")  # whether or not the clock still lists it
        self.assertEqual(self.status(past, [device_like(past, plans(past)[0], 5)]), "done")
        self.assertEqual(self.status(make_item(repeat="once", date=TODAY, hour=9, minute=30, last_error="x"), []), "done")
        future = make_item(repeat="once", date=TODAY, hour=9, minute=31, device_ids=(5,))
        self.assertEqual(self.status(future, [device_like(future, plans(future)[0], 5)]), "synced")
        off = make_item(repeat="once", date=TODAY, hour=9, minute=30, enabled=False)
        self.assertEqual(self.status(off, []), "disabled")

    def test_before_the_clock_was_ever_read_nothing_is_missing_or_changed(self) -> None:
        sent = make_item(device_ids=(5,))
        result = reconcile([sent, make_item(key="k2"), make_item(key="k3", enabled=False)], None, now=NOW)
        self.assertEqual(result.statuses, {"k1": "synced", "k2": "pending", "k3": "disabled"})
        self.assertEqual(result.foreign, [])

    def test_a_send_that_was_not_finished_is_an_error_even_before_the_clock_was_ever_read(self) -> None:
        interrupted = make_item(device_ids=(5,), last_error="Sending was interrupted. Send it again.")
        self.assertEqual(reconcile([interrupted], None, now=NOW).statuses, {"k1": "error"})

    def test_clock_reminders_no_item_holds_are_foreign_and_sorted_by_id(self) -> None:
        item, _plan, mine = self.sent()
        other = make_item(key="k2", enabled=False, device_ids=(9,), last_error="x")
        foreign_b = ReminderState(
            id=11, content="B", year=2026, month=1, day=1, hour=1, minute=1, repeat_type=0, week_mask=0, duration=30, sound=1
        )
        foreign_a = ReminderState(
            id=0, content="Testing testing ", year=2026, month=10, day=1, hour=23, minute=32,
            repeat_type=0, week_mask=0, duration=30, sound=1,
        )
        claimed_by_other = ReminderState(
            id=9, content="x", year=2026, month=1, day=1, hour=1, minute=1, repeat_type=0, week_mask=0, duration=30, sound=1
        )
        result = reconcile([item, other], [foreign_b, mine, claimed_by_other, foreign_a], now=NOW)
        self.assertEqual([d.id for d in result.foreign], [0, 11])

    def test_an_item_that_cannot_be_planned_shows_as_changed_instead_of_breaking_the_publish(self) -> None:
        broken = make_item(repeat="once", date=None, device_ids=(5,))  # cannot come out of validate_item
        on_clock = ReminderState(
            id=5, content="Wake up", year=2026, month=1, day=1, hour=7, minute=15, repeat_type=0, week_mask=0,
            duration=30, sound=1,
        )
        self.assertEqual(self.status(broken, [on_clock]), "changed")

    def test_week_mask_flag_defaults_to_the_hardware_flag_at_call_time(self) -> None:
        item = make_item(repeat="weekdays", device_ids=(1,))
        device = device_like(item, plans(item, mask=True)[0], 1)
        self.assertEqual(self.status(item, [device]), "changed")
        with patch.object(hardware, "REMINDER_WEEK_MASK_SUPPORTED", True):
            self.assertEqual(self.status(item, [device]), "synced")
        self.assertEqual(self.status(item, [device], week_mask_supported=True), "synced")


class ClockReadbackTests(unittest.TestCase):
    """What the clock reports reaches the studio with the real year (it used to arrive as 26)."""

    #: The reminder made in the vendor app on the live clock, as `1a 02 00` answered: id 0, sound 1, year byte 0x1a (26),
    #: 10-01 23:32, repeat 0, mask 0, duration 30, 'Testing testing '. Sound, mask and duration were not recorded live.
    LIVE_READBACK = bytes.fromhex("1a020001" "1a0a01" "1720" "0000" "001e" "10") + b"Testing testing "

    def test_year_regression_the_wire_year_becomes_the_real_year_all_the_way_to_the_websocket_shape(self) -> None:
        detail = responses.parse(self.LIVE_READBACK)
        self.assertEqual(detail.year, 26)  # the protocol keeps the wire value
        shaped = shape_reminder(reminder_state_from_detail(detail))
        self.assertEqual(
            shaped,
            {"id": 0, "content": "Testing testing ", "year": 2026, "month": 10, "day": 1, "hour": 23, "minute": 32,
             "repeat_type": 0, "week_mask": 0, "duration": 30, "sound": 1},
        )

    def test_the_week_mask_and_ring_length_survive_the_trip(self) -> None:
        payload = bytes.fromhex("1a02050f1b0c1f080001" "1f" "00b4" "04") + b"Gym!"
        shaped = shape_reminder(reminder_state_from_detail(responses.parse(payload)))
        self.assertEqual((shaped["year"], shaped["repeat_type"], shaped["week_mask"], shaped["duration"], shaped["sound"]),
                         (2027, 1, 0x1F, 180, 15))


class JsonRoundTripTests(unittest.TestCase):
    MANAGED_REMINDER_KEYS = {
        "key", "name", "kind", "hour", "minute", "date", "repeat", "days", "duration_s", "attachment",
        "enabled", "status", "slots", "device_ids", "last_error", "updated",
    }

    def full_item(self) -> ReminderItem:
        return make_item(
            repeat="custom", days=(0, 4), kind="reminder", duration_s=120, last_error="Couldn't reach the clock.",
            attachment=ReminderAttachment(kind="text", color=(1, 2, 3)), device_ids=(3, 4), last_ids=(3, 4, 5),
            updated=1234.5,
        )

    def test_to_json_carries_exactly_the_managed_reminder_fields(self) -> None:
        data = self.full_item().to_json(status="error", slots=2)
        self.assertEqual(set(data), self.MANAGED_REMINDER_KEYS)
        self.assertEqual((data["status"], data["slots"], data["device_ids"], data["days"]), ("error", 2, [3, 4], [0, 4]))
        self.assertEqual(data["attachment"], {"kind": "text", "color": [1, 2, 3]})
        json.dumps(data)  # plain JSON, nothing to convert

    def test_json_in_gives_the_same_item_back(self) -> None:
        item = self.full_item()
        again = validate_item(item.to_json(status="synced", slots=2), today=TODAY, now=NOW, existing=item)
        self.assertEqual(again, item)

    def test_the_date_travels_as_iso_text(self) -> None:
        item = make_item(repeat="once", date=dt.date(2026, 11, 3))
        data = item.to_json(status="synced", slots=1)
        self.assertEqual(data["date"], "2026-11-03")
        self.assertEqual(validate_item(data, today=TODAY, now=NOW, existing=item).date, dt.date(2026, 11, 3))

    def test_storage_round_trip_keeps_the_bookkeeping(self) -> None:
        item = self.full_item()
        stored = json.loads(json.dumps(item.to_storage()))
        self.assertEqual(ReminderItem.from_storage(stored), item)
        self.assertEqual(stored["last_ids"], [3, 4, 5])

    def test_a_stored_one_time_item_in_the_past_still_loads(self) -> None:
        item = make_item(repeat="once", date=dt.date(2020, 1, 1))
        self.assertEqual(ReminderItem.from_storage(item.to_storage()).date, dt.date(2020, 1, 1))

    def test_damaged_bookkeeping_is_dropped_but_a_damaged_definition_is_refused(self) -> None:
        stored = make_item().to_storage()
        loaded = ReminderItem.from_storage(
            {**stored, "device_ids": "7", "last_ids": [1, "x", 1, 999, True, 2], "last_error": 5, "updated": "yesterday"}
        )
        self.assertEqual((loaded.device_ids, loaded.last_ids, loaded.last_error, loaded.updated), ((), (1, 2), None, 0.0))
        for damaged in (None, [], {**stored, "key": ""}, {**stored, "name": ""}, {**stored, "hour": 99},
                        {k: v for k, v in stored.items() if k != "key"}):
            with self.assertRaises(ReminderValidationError):
                ReminderItem.from_storage(damaged)


class HeaderTests(unittest.TestCase):
    """`build_reminder_program` writes the vendor's header: the recorded golden vectors of
    `ILedClockUtils.getDataWithReminderCombineProgram` (vendor bytecode run on a JVM)."""

    @staticmethod
    def vectors() -> list[dict]:
        found = [v for v in json.loads(VECTORS.read_text()) if v["fn"] == "getDataWithReminderCombineProgram"]
        assert len(found) == 3
        return found

    def test_header_matches_every_recorded_vector_except_the_sound_byte(self) -> None:
        # Our programs always carry sound 1 (the vendor UI has no sound control); the vectors use 1, 2 and 0,
        # so compare with the sound byte (offset 13: 4 length + 1 tag + 8 reserved) forced to 01.
        for vector in self.vectors():
            raw = vector["args"]["content"]["item"]["content"]
            item = make_item(name=raw["title"], hour=raw["hour"], minute=raw["minute"], duration_s=raw["duration"])
            plan = DevicePlan(raw["repeatType"], None, dt.date(2000 + raw["year"], raw["month"], raw["day"]), raw["hour"], raw["minute"])
            program = build_reminder_program(item, plan, 9, [])
            expected = bytearray.fromhex(vector["out"])
            expected[13] = 1
            self.assertEqual(encode_content(program.contents[0]), bytes(expected), raw["title"])

    def test_the_program_is_a_type_14_single_program_with_the_id_in_the_start_frame_trailer(self) -> None:
        item = make_item(name="Take medicine", hour=8, minute=0, duration_s=30)
        plan = DevicePlan(1, None, dt.date(2026, 3, 15), 8, 0)
        picture = GraffitiContent(start_column=0, start_row=0, show_width=32, show_height=16, pixels=Frame(
            pixels=[[(255, 255, 255)] * 32 for _ in range(16)], duration_ms=100))
        program = build_reminder_program(item, plan, 12, [picture])
        self.assertEqual((program.resolved_program_type(), program.show_count, program.is_clock_in_list), (14, 1, False))
        self.assertIsInstance(program.contents[0], ReminderContent)
        self.assertIs(program.contents[1], picture)
        start = plan_upload(program, 0, 1, 1024).start
        self.assertEqual(start[9:11], bytes((0, 1)))  # index 0, count 1
        self.assertEqual(start[-2:], b"\x05\x0c")  # trailer: 05 <id 12>

    def test_the_week_mask_is_written_verbatim_and_otherwise_derived_like_the_vendor(self) -> None:
        item = make_item()
        daily = encode_content(build_reminder_program(item, DevicePlan(1, None, TODAY, 7, 15), 1, []).contents[0])
        masked = encode_content(build_reminder_program(item, DevicePlan(1, 0x1F, TODAY, 7, 15), 1, []).contents[0])
        sunday = encode_content(build_reminder_program(item, DevicePlan(2, None, dt.date(2026, 3, 15), 7, 15), 1, []).contents[0])
        self.assertEqual((daily[20], masked[20], sunday[20]), (0x7F, 0x1F, 0x40))

    def test_only_pictures_and_animations_may_follow_the_header(self) -> None:
        with self.assertRaises(ValueError):
            build_reminder_program(make_item(), DevicePlan(1, None, TODAY, 7, 15), 1, [
                ClockContent(style_index=1, is_24_hour=True)])


def design(frames: int = 1, *, kind: str = "animation", clock_region=None, speed=None) -> Design:
    return Design(
        id="d1", name="Art", kind=kind, width=32, height=16,
        frames=tuple(bytes([40 * (index % 6)]) * FRAME_BYTES for index in range(frames)),
        delays_ms=tuple(100 for _ in range(frames)), created=0.0, updated=0.0,
        clock_region=clock_region, speed=speed,
    )


class AttachmentTests(unittest.TestCase):
    def contents(self, item, *designs):
        return attachment_contents(item, designs={d.id: d for d in designs})

    def with_design(self, **kwargs):
        return make_item(attachment=ReminderAttachment(kind="design", design_id="d1"), **kwargs)

    def test_a_still_design_becomes_a_picture_and_an_animation_stays_one(self) -> None:
        still = self.contents(self.with_design(), design(1, kind="image"))
        self.assertEqual([type(c) for c in still], [GraffitiContent])
        moving = self.contents(self.with_design(), design(4))
        self.assertEqual([type(c) for c in moving], [AnimationContent])
        self.assertEqual(len(moving[0].frames), 4)

    def test_a_design_with_a_clock_a_missing_design_and_a_too_long_one_are_refused(self) -> None:
        with self.assertRaises(ReminderValidationError) as caught:
            self.contents(self.with_design(), design(2, clock_region=(16, 0, 16, 7)))
        self.assertEqual(caught.exception.field, "attachment")
        self.assertIn("clock", str(caught.exception))
        with self.assertRaises(ReminderValidationError) as caught:
            self.contents(self.with_design())
        self.assertIn("isn't in the Library", str(caught.exception))
        with self.assertRaises(ReminderValidationError) as caught:
            self.contents(self.with_design(), design(41))
        self.assertIn("41 frames", str(caught.exception))
        self.assertEqual(len(self.contents(self.with_design(), design(40))[0].frames), 40)

    def test_the_frame_limit_is_checked_after_the_designs_own_playback_retiming(self) -> None:
        # Speed 0 is "Still": 45 stored frames play as one picture, which is allowed.
        content = self.contents(self.with_design(), design(45, speed=0))
        self.assertEqual([type(c) for c in content], [GraffitiContent])

    def test_text_attachment_draws_the_name_once_for_a_short_name_and_scrolls_a_long_one(self) -> None:
        short = self.contents(make_item(name="Hi"))
        self.assertEqual([type(c) for c in short], [GraffitiContent])
        long = self.contents(make_item(name="Take out the garbage"))
        self.assertEqual([type(c) for c in long], [AnimationContent])
        self.assertLessEqual(len(long[0].frames), reminders.REMINDER_MAX_FRAMES)
        self.assertGreater(len(long[0].frames), 1)

    def test_text_attachment_uses_the_chosen_colour(self) -> None:
        red = self.contents(make_item(name="Hi", attachment=ReminderAttachment(color=(255, 0, 0))))
        lit = {pixel for row in red[0].pixels.pixels for pixel in row if pixel != (0, 0, 0)}
        self.assertTrue(lit)
        self.assertTrue(all(r > 0 and g == 0 and b == 0 for r, g, b in lit), lit)


if __name__ == "__main__":
    unittest.main()
