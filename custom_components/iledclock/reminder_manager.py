"""Alarms & reminders on the clock: persist the definition, then make the clock match it.

`ReminderManager` is owned by the coordinator (`coordinator.reminders`) and is the only thing that writes
reminders to the clock. The clock keeps the compiled reminders in its own slots, so they ring without Home
Assistant; Home Assistant keeps the definitions (`reminder_store.py`) because the clock cannot hand back the
art. The pure rules (validation, slot cost, plans, ids, comparison) are in `reminders.py`.

Rules every mutation follows (`async_save`, `async_set_enabled`, `async_delete`, `async_resend`):

* All of them run under `coordinator.show_lock`, the same lock as shows and playlists, so two uploads never
  interleave on the Bluetooth link. They never touch the playlist, the screen records or the show history.
* The definition is persisted BEFORE the clock is touched, so what the user typed is never lost. It is saved marked
  as not finished (`last_error`, see `_UNFINISHED_ON`) and the mark is cleared only once the clock has been read
  back and matches, so a restart in between shows "Couldn't send", never "synced".
* A failure after that point keeps the definition and records why: `last_error` (plain language) is stored,
  the slots the item may hold are kept in `device_ids` (nothing it wrote is orphaned), the list is published
  and the error is raised (`ReminderValidationError` for rules such as "the clock is full" or "that design is
  gone", `ReminderDeviceError` -- an `IledClockError` -- for anything the clock did or did not do). The row then
  says "Couldn't send" and offers Re-send, which makes the clock match the definition.
* A slot id has ONE owner. Items that are switched off or finished keep the ids they used (the clock may have
  dropped them), so when an id is given to an item (`_async_claim`) it is taken from every other item in the same
  write. Switching off or deleting therefore removes exactly the ids the item holds.
* Writing is: fresh id list, allocate ids (every reminder on the clock takes room), claim them, upload each clock
  reminder, let the clock settle, read everything back and verify, delete the surplus slots of a plan that
  shrank (only AFTER the new ones are up), read back again, store `device_ids`; then, unless
  `hardware.REMINDER_UPLOAD_PRESERVES_SLOTS`, re-send screen A's program list.
* Switching off or deleting needs the clock for the slots the item holds (and reads it afresh, so what is shown
  of the clock stays right); an item that holds none never touches Bluetooth.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
from collections.abc import AsyncIterator, Iterable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from functools import partial
from typing import TYPE_CHECKING, Any

from homeassistant.core import callback
from homeassistant.util import dt as dt_util

from . import hardware
from .client import (
    IledClockAuthError,
    IledClockConnectionError,
    IledClockError,
    IledClockProtocolError,
    IledClockTimeoutError,
)
from .const import MAX_REMINDERS, REMINDER_MAX_ITEMS
from .protocol import commands
from .protocol.programs import Program
from .protocol.responses import Ack, ReminderDetail
from .reminder_store import IledClockReminderStore
from .reminders import (
    ReminderItem,
    ReminderValidationError,
    allocate_ids,
    attachment_contents,
    build_reminder_program,
    is_done,
    matches_plan,
    plan_device_reminders,
    reconcile,
    reminder_state_from_detail,
    slots_needed,
    validate_item,
)
from .state import ReminderState, merge_state
from .ws_shapes import shape_reminder

if TYPE_CHECKING:
    from .coordinator import IledClockCoordinator

_LOGGER = logging.getLogger(__name__)

#: Saved together with a definition BEFORE the clock is touched, as its `last_error`, and cleared only once the clock
#: has been read back and matches (a failure replaces it with the real reason). If Home Assistant stops in between,
#: the item shows "Couldn't send" with a Re-send instead of believing the last send.
_UNFINISHED_ON = "Sending was interrupted. Send it again."
_UNFINISHED_OFF = "Removing it from the clock was interrupted. Try again."


class ReminderDeviceError(IledClockError):
    """The clock did not do what a reminder write needs (or could not be reached). The message is one plain
    line for the user."""


def plain_clock_error(err: Exception) -> str:
    """One short sentence saying what went wrong with the clock and what to do, for the row and the sheet."""
    if isinstance(err, ReminderDeviceError):
        return str(err)
    if isinstance(err, IledClockAuthError):
        return "The clock didn't accept the saved password. Fix it in the integration settings."
    if isinstance(err, IledClockConnectionError):
        return "Couldn't reach the clock. Check that it's on and in Bluetooth range, then try again."
    cause: BaseException | None = err
    while cause is not None:
        if isinstance(cause, IledClockProtocolError):
            return "The clock refused the data. Try again, or use simpler art."
        cause = cause.__cause__
    if isinstance(err, IledClockTimeoutError):
        return "The clock didn't answer in time. Try again in a moment."
    return "The clock didn't accept that. Try again in a moment."


@dataclass(slots=True)
class _Claims:
    """What one mutation has put on the clock so far, so that a failure can be recorded without losing track
    of a slot: `ids` are the slots the item holds (or may hold), `states` the freshest read of the clock."""

    ids: tuple[int, ...]
    states: tuple[ReminderState, ...] | None = None


class ReminderManager:
    """Definitions plus the clock's own list, and everything that changes either of them."""

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        self._coordinator = coordinator
        self._store = IledClockReminderStore(coordinator.hass, coordinator.entry.entry_id)
        #: The clock's reminders as last read; None until the first successful read.
        self._device: tuple[ReminderState, ...] | None = None
        self._synced_at: float | None = None
        self._epoch = 0
        self._active = False

    async def async_load(self) -> None:
        await self._store.async_load()

    # -- views -------------------------------------------------------------------------------------

    def _now_epoch(self) -> float:
        return dt_util.utcnow().timestamp()

    def _local_now(self) -> dt.datetime:
        """Local wall time, the time the clock itself keeps (`sync_time` sends `dt_util.now()`)."""
        return dt_util.now().replace(tzinfo=None)

    def _slots(self, item: ReminderItem) -> int:
        return slots_needed(item.repeat, item.days, week_mask_supported=hardware.REMINDER_WEEK_MASK_SUPPORTED)

    def item_json(self, item: ReminderItem) -> dict[str, Any]:
        """`ManagedReminder` of types.ts for one item."""
        status = reconcile([item], self._device, now=self._local_now()).statuses[item.key]
        return item.to_json(status=status, slots=self._slots(item))

    def json(self) -> dict[str, Any]:
        """The `reminder_list` of the `iledclock/state` payload (`ReminderList` of types.ts). Computed fresh from
        the definitions and the last read of the clock; `synced_at` None means the clock has not been read yet
        (then `used` is what the definitions believe they hold)."""
        items = self._store.items
        result = reconcile(items, self._device, now=self._local_now())
        capacity = hardware.REMINDER_ID_MAX - hardware.REMINDER_ID_MIN + 1
        if self._device is None:
            used = len({reminder_id for item in items for reminder_id in item.device_ids})
        else:
            used = len(self._device)
        return {
            "capacity": capacity,
            "used": used,
            "free": max(0, capacity - used),
            "items": [
                item.to_json(status=result.statuses[item.key], slots=self._slots(item)) for item in items
            ],
            "foreign": [shape_reminder(reminder) for reminder in result.foreign],
            "synced_at": self._synced_at,
        }

    # -- reading the clock ---------------------------------------------------------------------------

    async def _async_list_ids(self) -> list[int]:
        reply = await self._coordinator.client.async_request(commands.reminders_get())
        if not isinstance(reply, list):
            raise ReminderDeviceError("The clock sent an unexpected answer. Try again in a moment.")
        return list(reply)

    async def async_read_clock(self) -> tuple[ReminderState, ...]:
        """Read the clock's reminder list and every reminder in it, all or nothing: any read that fails raises
        `IledClockError` (a partial list would make reminders look missing)."""
        client = self._coordinator.client
        states: list[ReminderState] = []
        for reminder_id in (await self._async_list_ids())[:MAX_REMINDERS]:
            detail = await client.async_request(commands.reminder_detail(reminder_id))
            if not isinstance(detail, ReminderDetail):
                raise ReminderDeviceError("The clock sent an unexpected answer. Try again in a moment.")
            states.append(reminder_state_from_detail(detail))
        return tuple(states)

    def begin_read(self) -> int | None:
        """Token for a read of the clock that starts now, or None while a reminder write is running (the read
        would see it half done). Hand it to `read_is_current` right before the read is used: a write that started
        or ended in between has published a newer list, and this read must then be dropped."""
        return None if self._active else self._epoch

    def read_is_current(self, token: int | None) -> bool:
        """True if no reminder write started or ended since `begin_read`, i.e. the read can be trusted."""
        return token is not None and token == self._epoch and not self._active

    @callback
    def async_refresh_from_clock(self, details: Sequence[ReminderState]) -> None:
        """The periodic refresh read the clock's reminders: remember them and reconcile (the next published
        state shows the new statuses). Never writes to the clock or the definitions."""
        self._device = tuple(details)
        self._synced_at = self._now_epoch()

    def _remember(self, states: tuple[ReminderState, ...]) -> None:
        """A fresh full read made by a mutation: keep it and publish it (also as `state.reminders`)."""
        self._device = states
        self._synced_at = self._now_epoch()
        coordinator = self._coordinator
        coordinator.async_set_updated_data(merge_state(coordinator.data, {"reminders": states}))

    # -- plumbing for mutations -----------------------------------------------------------------------

    @asynccontextmanager
    async def _mutation(self) -> AsyncIterator[None]:
        async with self._coordinator.show_lock:
            self._epoch += 1
            self._active = True
            try:
                yield
            finally:
                self._active = False
                self._epoch += 1

    def _require(self, key: Any) -> ReminderItem:
        item = self._store.get(key) if isinstance(key, str) else None
        if item is None:
            raise ReminderValidationError("key", "That alarm no longer exists. Refresh the page and try again.")
        return item

    def _live_claims(self, item: ReminderItem, now: dt.datetime) -> set[int]:
        """Slots other definitions hold that should be on the clock (on, not finished): the clock can have lost
        them, but they must not be handed to anything else."""
        return {
            reminder_id
            for other in self._store.items
            if other.key != item.key and other.enabled and not is_done(other, now)
            for reminder_id in other.device_ids
        }

    @staticmethod
    def _unfinished(item: ReminderItem) -> ReminderItem:
        """`item` as it is saved BEFORE the clock is touched: marked as not finished. `reconcile` shows a marked item
        as an error and `last_error` says why, so a restart between this save and the verified end of the write can
        never show it as `synced`. A successful write stores the item with `last_error=None`; a failed one replaces
        the mark with the real reason."""
        return replace(item, last_error=_UNFINISHED_ON if item.enabled else _UNFINISHED_OFF)

    async def _async_claim(self, item: ReminderItem, ids: tuple[int, ...]) -> None:
        """Save that `item` holds `ids` BEFORE they are written to the clock (a restart in the middle still knows
        which slots to reuse), marked as not finished, and in the same write take the ids away from every other item.

        A slot id has one owner. An item that is switched off or finished keeps the ids it used, and the clock may no
        longer list them, so `allocate_ids` can give one of them to another item. If the old owner kept its claim,
        the new owner's reminder would later look like somebody else's: switching it off would leave it on the clock,
        still ringing."""
        claimed = set(ids)
        changes = [replace(item, device_ids=ids, last_ids=ids, last_error=_UNFINISHED_ON)]
        for other in self._store.items:
            if other.key == item.key or not claimed & {*other.device_ids, *other.last_ids}:
                continue
            device_ids = tuple(reminder_id for reminder_id in other.device_ids if reminder_id not in claimed)
            changes.append(
                replace(
                    other,
                    device_ids=device_ids,
                    last_ids=tuple(reminder_id for reminder_id in other.last_ids if reminder_id not in claimed),
                    # A switched-off item that holds nothing any more has nothing left to report.
                    last_error=other.last_error if other.enabled or device_ids else None,
                )
            )
        await self._store.async_upsert_many(changes)

    async def _async_delete_present(
        self, ids: Iterable[int], present: set[int]
    ) -> tuple[tuple[ReminderState, ...] | None, list[int]]:
        """Delete these slots from the clock, but only those the clock lists (`present`). The ids are the caller's
        own: no two items share a slot id (`_async_claim`). Every delete is checked (`Ack.ok`) and the clock is
        read back. Returns `(fresh read or None when nothing was deleted, slots that are still there)`."""
        wanted = [reminder_id for reminder_id in ids if reminder_id in present]
        if not wanted:
            return None, []
        client = self._coordinator.client
        refused: set[int] = set()
        for reminder_id in wanted:
            ack = await client.async_request(commands.reminder_delete(reminder_id))
            if not (isinstance(ack, Ack) and ack.ok):
                refused.add(reminder_id)
        states = await self.async_read_clock()
        still_there = {state.id for state in states}
        return states, sorted(refused | {reminder_id for reminder_id in wanted if reminder_id in still_there})

    async def _async_take_off_clock(
        self, item: ReminderItem, claims: _Claims
    ) -> tuple[ReminderState, ...] | None:
        """Remove the slots `item` holds from the clock and return a fresh read of the clock (None when the item
        holds no slot: that never touches Bluetooth). `claims.ids` ends up as the slots still there; raises when
        any is."""
        held = tuple(item.device_ids)
        if not held:
            claims.ids = ()
            return None
        present = set(await self._async_list_ids())
        states, failed = await self._async_delete_present(held, present)
        if states is None:
            # None of its slots is on the clock any more (deleted behind our back): nothing to remove, but what is
            # shown of the clock (`state.reminders`, `used`, the foreign list) must still be brought up to date.
            states = await self.async_read_clock()
        claims.ids = tuple(failed)
        claims.states = states
        if failed:
            raise ReminderDeviceError("Couldn't remove it from the clock. Try again in a moment.")
        return states

    async def _async_upload(self, programs: list[Program], *, on_progress: Any) -> list[bool]:
        """The coordinator's upload callable for reminders: one start frame (index 0, count 1) per clock reminder,
        with the studio's progress told "program i of n"."""
        client = self._coordinator.client
        total = len(programs)
        sent: list[bool] = []
        for index, program in enumerate(programs):

            def forward(state: str, _program: int, _count: int, chunk: int, chunks: int, index: int = index) -> None:
                on_progress(state, index, total, chunk, chunks)

            sent.append(await client.async_upload_reminder(program, on_progress=forward))
        return sent

    async def _async_put_on_clock(
        self, item: ReminderItem, claims: _Claims
    ) -> tuple[tuple[int, ...], tuple[ReminderState, ...]]:
        """Make the clock hold `item` (enabled): returns the slots it holds now and the final read of the clock."""
        coordinator = self._coordinator
        now = self._local_now()
        plans = plan_device_reminders(
            item, today=now.date(), now=now, week_mask_supported=hardware.REMINDER_WEEK_MASK_SUPPORTED
        )
        designs = {design.id: design for design in coordinator.design_library.designs}
        contents = await coordinator.hass.async_add_executor_job(
            partial(attachment_contents, item, designs=designs)
        )

        held = tuple(item.device_ids)
        on_clock = await self._async_list_ids()
        taken = (set(on_clock) - set(held)) | self._live_claims(item, now)
        ids = tuple(allocate_ids(held or item.last_ids, len(plans), taken))
        claims.ids = ids + tuple(reminder_id for reminder_id in held if reminder_id not in ids)
        # Claim the slots before writing them: if the process dies mid-send the item still owns them, so a
        # Re-send reuses them instead of leaving strays on the clock, and no other item claims them any more.
        await self._async_claim(item, claims.ids)

        programs = [
            build_reminder_program(item, plan, reminder_id, contents) for plan, reminder_id in zip(plans, ids)
        ]
        await coordinator._async_send_to_clock(programs, self._async_upload)
        await asyncio.sleep(hardware.REMINDER_SAVE_SETTLE_S)

        states = await self.async_read_clock()
        claims.states = states
        by_id = {state.id: state for state in states}
        for plan, reminder_id in zip(plans, ids):
            device = by_id.get(reminder_id)
            if device is None or not matches_plan(item, plan, device, dates="month_day"):
                raise ReminderDeviceError("The clock didn't keep that alarm. Try sending it again.")

        # Slots of a plan that shrank: only now that the new ones are up.
        surplus = [reminder_id for reminder_id in held if reminder_id not in ids]
        deleted, failed = await self._async_delete_present(surplus, set(by_id))
        if deleted is not None:
            states = deleted
            claims.states = states
        claims.ids = ids + tuple(failed)
        if failed:
            raise ReminderDeviceError("Saved, but couldn't remove an old copy from the clock. Try Re-send.")
        return ids, states

    async def _async_record_failure(self, item: ReminderItem, claims: _Claims, err: Exception) -> Exception:
        """Keep the definition, remember why the clock write failed and what the item may hold, publish, and
        return the error to raise."""
        user_error: Exception = err if isinstance(err, (ReminderValidationError, ReminderDeviceError)) else (
            ReminderDeviceError(plain_clock_error(err))
        )
        _LOGGER.debug(
            "iLedClock %s: alarm %s is not on the clock: %s (%r)", self._coordinator.address, item.key, user_error, err
        )
        await self._store.async_upsert(
            replace(item, device_ids=claims.ids, last_ids=claims.ids or item.last_ids, last_error=str(user_error))
        )
        if claims.states is not None:
            self._remember(claims.states)
        else:
            self._coordinator.async_update_listeners()
        return user_error

    async def _async_converge_locked(self, item: ReminderItem) -> ReminderItem:
        """Make the clock match the persisted `item` (caller holds the lock): on -> the clock holds it, off ->
        the clock holds nothing of it. Returns the stored result; on failure records it and raises."""
        claims = _Claims(item.device_ids)
        uploaded = False
        try:
            if item.enabled:
                uploaded = True
                ids, states = await self._async_put_on_clock(item, claims)
                stored = replace(item, device_ids=ids, last_ids=ids, last_error=None)
            else:
                states = await self._async_take_off_clock(item, claims)
                stored = replace(item, device_ids=(), last_ids=item.device_ids or item.last_ids, last_error=None)
        except (IledClockError, ReminderValidationError) as err:
            raise await self._async_record_failure(item, claims, err) from err

        await self._store.async_upsert(stored)
        if states is not None:
            self._remember(states)
        else:
            self._coordinator.async_update_listeners()
        if uploaded and not hardware.REMINDER_UPLOAD_PRESERVES_SLOTS:
            try:
                await self._coordinator.async_reassert_program_list_locked()
            except IledClockError as err:
                raise ReminderDeviceError(
                    "The alarm is saved on the clock, but screen A's pictures couldn't be put back. "
                    "Show something from the Library again to restore them."
                ) from err
        return stored

    # -- mutations -------------------------------------------------------------------------------------

    async def async_save(self, raw: Mapping[str, Any]) -> dict[str, Any]:
        """Create (no `key`) or edit (`key`) an alarm or reminder: validate, persist, write it to the clock, read
        it back. Returns the item (`ManagedReminder`). A key that no longer exists is an error, never a new item."""
        async with self._mutation():
            existing = None
            if isinstance(raw, Mapping) and raw.get("key") is not None:
                existing = self._require(raw["key"])
            now = self._local_now()
            item = validate_item(
                raw, today=now.date(), now=now, existing=existing,
                key=None if existing is not None else self._store.new_key(),
            )
            if existing is None and len(self._store.items) >= REMINDER_MAX_ITEMS:
                raise ReminderValidationError(
                    "name", f"You can keep up to {REMINDER_MAX_ITEMS} alarms and reminders. Delete one first."
                )
            item = self._unfinished(replace(item, updated=self._now_epoch()))
            await self._store.async_upsert(item)
            return self.item_json(await self._async_converge_locked(item))

    async def async_set_enabled(self, key: Any, enabled: bool) -> dict[str, Any]:
        """Switch an item on (write it to the clock) or off (remove it from the clock, keep the definition)."""
        async with self._mutation():
            item = self._require(key)
            if item.enabled == enabled and self.item_json(item)["status"] in ("synced", "done", "disabled"):
                return self.item_json(item)
            now = self._local_now()
            changed = validate_item({"enabled": enabled}, today=now.date(), now=now, existing=item)
            changed = self._unfinished(replace(changed, updated=self._now_epoch()))
            await self._store.async_upsert(changed)
            return self.item_json(await self._async_converge_locked(changed))

    async def async_resend(self, key: Any) -> dict[str, Any]:
        """Make the clock match the definition again (an item that is missing, changed, failed or never sent)."""
        async with self._mutation():
            item = self._require(key)
            now = self._local_now()
            checked = validate_item({}, today=now.date(), now=now, existing=item)
            return self.item_json(await self._async_converge_locked(checked))

    async def async_delete(self, *, key: Any = None, device_id: Any = None) -> None:
        """Delete an item (`key`: its clock slots, then its definition) or a reminder that exists only on the clock
        (`device_id`: the clock's own id; one that an item holds must be deleted through the item)."""
        if (key is None) == (device_id is None):
            raise ReminderValidationError("key", "Say which one to delete: a key or an id.")
        async with self._mutation():
            if key is not None:
                await self._async_delete_item_locked(self._require(key))
            else:
                await self._async_delete_clock_only_locked(device_id)

    async def _async_delete_item_locked(self, item: ReminderItem) -> None:
        claims = _Claims(item.device_ids)
        try:
            states = await self._async_take_off_clock(item, claims)
        except IledClockError as err:
            raise await self._async_record_failure(item, claims, err) from err
        await self._store.async_remove(item.key)
        if states is not None:
            self._remember(states)
        else:
            self._coordinator.async_update_listeners()

    async def _async_delete_clock_only_locked(self, device_id: Any) -> None:
        if isinstance(device_id, bool) or not isinstance(device_id, int) or not 0 <= device_id <= 255:
            raise ReminderValidationError("id", "Pick a reminder id between 0 and 255.")
        owner = next((item for item in self._store.items if device_id in item.device_ids), None)
        if owner is not None:
            raise ReminderValidationError(
                "id", f"That one belongs to \u201c{owner.name}\u201d. Delete it from the list instead."
            )
        try:
            ack = await self._coordinator.client.async_request(commands.reminder_delete(device_id))
            if not (isinstance(ack, Ack) and ack.ok):
                raise ReminderDeviceError("The clock wouldn't delete it. Try again in a moment.")
            states = await self.async_read_clock()
            if any(state.id == device_id for state in states):
                raise ReminderDeviceError("The clock still has it. Try again in a moment.")
        except ReminderDeviceError:
            raise
        except IledClockError as err:
            raise ReminderDeviceError(plain_clock_error(err)) from err
        self._remember(states)
