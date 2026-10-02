"""`IledClockClient.async_upload_reminder` against the scripted fake clock: one start frame
(index 0, count 1, trailer `05 <id>`), chunks only when the clock did not already have the
reminder, and the vendor's second spelling of a start ack (`1a xx`)."""

from __future__ import annotations

import pytest

from custom_components.iledclock.client import IledClockConnectionError, IledClockError
from custom_components.iledclock.protocol.programs import Program, ReminderContent

from .fake_clock import FakeClockDevice

OPCODE_REMINDER = 0x1A


def reminder_program(remind_id: int = 16) -> Program:
    content = ReminderContent(
        remind_id=remind_id, title="Take medicine", year=26, month=10, day=2, hour=7, minute=30
    )
    return Program(contents=[content], show_count=1, is_clock_in_list=False, program_type=14)


def answer_start_with_1a(clock: FakeClockDevice) -> None:
    """Make the fake clock acknowledge a program start as `1a <result>` instead of `02 <result>`."""
    real = clock._reply_for

    def reply_for(payload: bytes) -> bytes | None:
        if payload[0] == 0x02:
            return bytes((OPCODE_REMINDER, clock.start_ack_result))
        return real(payload)

    clock._reply_for = reply_for


async def test_start_frame_is_index_0_count_1_with_reminder_trailer_and_chunks_follow(
    config_entry, clock: FakeClockDevice
) -> None:
    clock.start_ack_result = 0
    clock.written.clear()
    sent = await config_entry.runtime_data.client.async_upload_reminder(reminder_program(16))

    assert sent is True
    assert len(clock.uploads) == 1
    start, chunks = clock.uploads[0]
    assert start[9] == 0  # program index
    assert start[10] == 1  # program count
    assert start[-2:] == b"\x05\x10"  # reminder trailer: 05 <id>
    assert len(chunks) >= 1


async def test_start_ack_1_means_already_present_and_sends_no_chunks(
    config_entry, clock: FakeClockDevice
) -> None:
    clock.start_ack_result = 1
    clock.written.clear()
    sent = await config_entry.runtime_data.client.async_upload_reminder(reminder_program())

    assert sent is False
    assert len(clock.uploads) == 1
    assert clock.uploads[0][1] == []


@pytest.mark.parametrize(("ack", "expect_chunks"), [(0, True), (1, False)])
async def test_start_ack_spelled_1a_is_understood(
    config_entry, clock: FakeClockDevice, ack: int, expect_chunks: bool
) -> None:
    answer_start_with_1a(clock)
    clock.start_ack_result = ack
    clock.written.clear()
    sent = await config_entry.runtime_data.client.async_upload_reminder(reminder_program())

    assert sent is expect_chunks
    assert bool(clock.uploads[0][1]) is expect_chunks


async def test_rejected_chunk_raises_and_reports_error_progress(
    config_entry, clock: FakeClockDevice
) -> None:
    clock.chunk_ack_result = 2
    clock.written.clear()
    events: list[tuple] = []

    with pytest.raises(IledClockError):
        await config_entry.runtime_data.client.async_upload_reminder(
            reminder_program(), on_progress=lambda *args: events.append(args)
        )

    assert events[-1][0] == "error"


async def test_link_dropped_after_the_start_ack_raises_a_connection_error_not_an_assertion(
    config_entry, clock: FakeClockDevice
) -> None:
    client = config_entry.runtime_data.client
    await client.async_connect()
    clock.start_ack_result = 0
    clock.written.clear()
    clock.disconnect_after_requests = 1  # the start frame is answered, then the link drops
    events: list[tuple] = []

    with pytest.raises(IledClockConnectionError):
        await client.async_upload_reminder(reminder_program(), on_progress=lambda *args: events.append(args))

    assert [event[0] for event in events] == ["start", "error"]
    assert len(clock.uploads) == 1 and clock.uploads[0][1] == []  # no chunk reached the clock
