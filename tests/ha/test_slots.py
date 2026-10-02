"""Screens A and B and text-as-frames through the real services, websocket commands and entities (the fake
clock stands in for the hardware). The clock's start frame says which screen an upload lands in: byte 20 is the
kind, 00 for the program list (screen A) and 04 for the clock-page store (screen B)."""

from __future__ import annotations

import base64
from datetime import timedelta
from unittest.mock import patch

import pytest
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.iledclock import const, hardware
from custom_components.iledclock.client import IledClockClient
from custom_components.iledclock.const import DOMAIN
from custom_components.iledclock.protocol.programs import AnimationContent, GraffitiContent, Program, TextContent

from .fake_clock import FakeClockDevice

TIMERS_REASON = "Timers and scoreboards only work on screen A."
PICTURES_REASON = "Screen B only takes clock, date and temperature pages for now; pictures go on screen A."
SOLID = base64.b64encode(bytes((10, 20, 30)) * (32 * 16)).decode("ascii")

CLOCK_SPEC = {"type": "clock", "style": 1, "color": [255, 255, 255], "h24": True}


@pytest.fixture
def device_id(hass, config_entry, clock: FakeClockDevice) -> str:
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), config_entry.entry_id)
    assert len(devices) == 1
    return devices[0].id


@pytest.fixture
def sent(config_entry):
    """Every program list handed to the clock, in order (before the power limit and the delay units)."""
    uploads: list[list[Program]] = []
    real = IledClockClient.async_upload

    async def spy(self, programs, **kwargs):
        uploads.append(list(programs))
        return await real(self, programs, **kwargs)

    with patch.object(IledClockClient, "async_upload", spy):
        yield uploads


async def send(client, message: dict) -> dict:
    await client.send_json_auto_id(message)
    return await client.receive_json()


async def show(client, entry, item: dict, *, slot: str | None = None) -> dict:
    message = {"type": "iledclock/show", "entry_id": entry.entry_id, "item": item}
    if slot is not None:
        message["slot"] = slot
    return await send(client, message)


async def save_design(client, **extra) -> str:
    response = await send(client, {"type": "iledclock/designs/save", "design": {"name": "Art", "kind": "image", "frames": [SOLID], **extra}})
    assert response["success"] is True, response
    return response["result"]["id"]


def kinds(clock: FakeClockDevice) -> list[int]:
    """The start-frame kind byte of every upload so far."""
    return [start[20] for start, _chunks in clock.uploads]


async def run_timers(hass, seconds: float) -> None:
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=seconds))
    await hass.async_block_till_done()


# -- Routing ------------------------------------------------------------------------------------------------


async def test_a_show_to_screen_b_is_a_kind_04_page_and_leaves_screen_a_alone(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    clock.written.clear()
    coordinator = config_entry.runtime_data

    assert (await show(client, config_entry, {"spec": {"type": "text", "text": "HI"}}))["success"]
    on_a = coordinator.slots_json()
    descriptor = (await show(client, config_entry, {"spec": CLOCK_SPEC}, slot="b"))["result"]["now_showing"]

    assert kinds(clock) == [0, 4]
    start = clock.uploads[1][0]
    assert start[9:11] == bytes([0, 1])  # index 0 of 1: a standalone page
    assert start[20:26] == bytes([4, 1, 0, 0, 0, 10])  # the vendor's clock page trailer
    slots = coordinator.slots_json()
    assert slots["a"] == on_a["a"]  # screen A's record is untouched
    assert (slots["b"]["title"], slots["b"]["wire_kind"], slots["b"]["programs"]) == (descriptor["title"], 4, 1)
    assert (slots["a"]["wire_kind"], slots["last_written"]) == (0, "b")
    assert descriptor["slot"] == "b"

    state = (await send(client, {"type": "iledclock/state", "entry_id": config_entry.entry_id}))["result"]
    assert state["slots"] == slots
    assert state["now_showing"]["slot"] == "b"
    assert state["capabilities"]["slots"] == {"ids": ["a", "b"], "b_accepts": ["clock", "date", "temperature", "humidity", "art_clock", "art"]}


async def test_every_clock_page_kind_and_art_with_a_clock_go_to_screen_b(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    icon = await save_design(client, clock_region={"x": 16, "y": 0, "w": 16, "h": 16})
    clock.written.clear()
    items = [
        {"spec": CLOCK_SPEC},
        {"spec": {"type": "date", "color": [255, 255, 255]}},
        {"spec": {"type": "temperature"}},
        {"spec": {"type": "humidity"}},
        {"design_id": icon},
    ]
    for item in items:
        response = await show(client, config_entry, item, slot="b")
        assert response["success"] is True, (item, response)
    assert kinds(clock) == [4] * 5
    trailers = [start[20:26] for start, _ in clock.uploads]
    assert trailers == [bytes([4, 1, 0, 0, 0, n]) for n in (10, 5, 5, 5, 10)]  # clock 10 s; date, temp+humidity 5 s; icon 10 s


async def test_screen_b_refuses_pictures_with_the_art_flag_off_and_timers_always_before_anything_is_sent(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    plain = await save_design(client)
    clock.written.clear()
    coordinator = config_entry.runtime_data
    refused = [
        ({"spec": {"type": "text", "text": "HI"}}, PICTURES_REASON),
        ({"spec": {"type": "generative", "kind": "plasma", "seconds": 1}}, PICTURES_REASON),
        ({"design_id": plain}, PICTURES_REASON),
        ({"spec": {"type": "timer", "mode": "countdown"}}, TIMERS_REASON),
        ({"spec": {"type": "scoreboard"}}, TIMERS_REASON),
    ]
    with patch.object(hardware, "SLOT_B_ACCEPTS_ART", False):
        for item, reason in refused:
            response = await show(client, config_entry, item, slot="b")
            assert response["success"] is False and response["error"]["code"] == "slot_unsupported", (item, response)
            assert response["error"]["message"] == reason
    for item, reason in refused[3:]:  # timers and scoreboards are refused with the art flag on too
        response = await show(client, config_entry, item, slot="b")
        assert response["success"] is False and response["error"]["message"] == reason, (item, response)
    assert clock.uploads == []
    assert coordinator.slots_json() == {"a": None, "b": None, "last_written": None}
    assert coordinator.show_store.history == []


async def test_an_unknown_screen_is_a_schema_error_and_screen_a_is_the_default(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    bad = await show(client, config_entry, {"spec": {"type": "text", "text": "HI"}}, slot="c")
    assert bad["success"] is False and bad["error"]["code"] == "invalid_format"
    clock.written.clear()
    good = await show(client, config_entry, {"spec": {"type": "text", "text": "HI"}})
    assert good["result"]["now_showing"]["slot"] == "a" and kinds(clock) == [0]


async def test_a_replayed_descriptor_that_names_its_screen_goes_back_there(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    clock.written.clear()
    descriptor = (await show(client, config_entry, {"spec": CLOCK_SPEC}, slot="b"))["result"]["now_showing"]
    replay = {key: value for key, value in descriptor.items() if key not in ("kind", "title", "shown_at")}
    await show(client, config_entry, {"spec": {"type": "clock", **replay}})
    assert kinds(clock) == [4, 4]


async def test_text_goes_onto_screen_b_as_a_type_7_page(hass, hass_ws_client, config_entry, clock, sent) -> None:
    client = await hass_ws_client(hass)
    clock.written.clear()
    response = await show(client, config_entry, {"spec": {"type": "text", "text": "HI"}}, slot="b")
    assert response["success"] is True, response
    program = sent[0][0]
    assert (program.resolved_program_type(), program.is_clock_in_list) == (7, False)
    assert clock.uploads[0][0][20:26] == bytes([4, 1, 0, 0, 0, 10])
    assert config_entry.runtime_data.slots_json()["b"]["descriptor"]["text"] == "HI"


async def test_flipping_the_clock_art_flag_refuses_a_design_with_a_clock(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    icon = await save_design(client, clock_region={"x": 16, "y": 0, "w": 16, "h": 16})
    with patch.object(hardware, "SLOT_B_ACCEPTS_ART_WITH_CLOCK", False):
        response = await show(client, config_entry, {"design_id": icon}, slot="b")
        state = (await send(client, {"type": "iledclock/state", "entry_id": config_entry.entry_id}))["result"]
    assert response["error"]["code"] == "slot_unsupported"
    assert "art_clock" not in state["capabilities"]["slots"]["b_accepts"]


# -- Services -----------------------------------------------------------------------------------------------


async def test_clock_face_and_show_design_services_can_write_screen_b(hass, hass_ws_client, config_entry, clock, device_id) -> None:
    client = await hass_ws_client(hass)
    icon = await save_design(client, clock_region={"x": 16, "y": 0, "w": 16, "h": 16})
    clock.written.clear()
    await hass.services.async_call(
        DOMAIN, const.SERVICE_CLOCK_FACE, {"device_id": device_id, "style": 1, "color": 6, "slot": "b"}, blocking=True
    )
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SHOW_DESIGN, {"device_id": device_id, "design_id": icon, "slot": "b"}, blocking=True
    )
    assert kinds(clock) == [4, 4]
    slots = config_entry.runtime_data.slots_json()
    assert (slots["b"]["descriptor"]["kind"], slots["a"]) == ("design", None)


async def test_show_services_refuse_screen_b_in_plain_words(hass, config_entry, clock, device_id) -> None:
    clock.written.clear()
    with patch.object(hardware, "SLOT_B_ACCEPTS_ART", False):
        for service, data in (
            (const.SERVICE_SHOW_TEXT, {"text": "HI"}),
            (const.SERVICE_SHOW_GENERATIVE, {"kind": "plasma"}),
            (const.SERVICE_SHOW_IMAGE, {"data_b64": SOLID}),
        ):
            with pytest.raises(ServiceValidationError, match="pictures go on screen A"):
                await hass.services.async_call(
                    DOMAIN, service, {"device_id": device_id, "slot": "b", **data}, blocking=True
                )
    assert clock.uploads == []


async def test_a_timed_message_needs_screen_a(hass, config_entry, clock, device_id) -> None:
    with pytest.raises(ServiceValidationError, match="only works on screen A"):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_SHOW_TEXT,
            {"device_id": device_id, "text": "HI", "slot": "b", "duration_s": 30}, blocking=True,
        )


async def test_every_show_service_takes_a_screen_and_rejects_an_unknown_one(hass, config_entry, device_id) -> None:
    for service, data in (
        (const.SERVICE_SHOW_TEXT, {"text": "HI"}),
        (const.SERVICE_SHOW_DESIGN, {"design_id": "x"}),
        (const.SERVICE_SHOW_IMAGE, {"data_b64": SOLID}),
        (const.SERVICE_SHOW_GENERATIVE, {"kind": "plasma"}),
        (const.SERVICE_CLOCK_FACE, {"style": 1, "color": 6}),
    ):
        with pytest.raises(Exception) as caught:  # voluptuous Invalid: the schema names the allowed screens
            await hass.services.async_call(DOMAIN, service, {"device_id": device_id, "slot": "c", **data}, blocking=True)
        assert "slot" in str(caught.value), service


# -- The record -----------------------------------------------------------------------------------------------


async def test_the_record_is_written_only_after_the_clock_accepted_the_upload(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    coordinator = config_entry.runtime_data
    clock.chunk_ack_result = 2  # the clock answers every data chunk with a device error
    failed = await show(client, config_entry, {"spec": {"type": "text", "text": "NOPE"}})
    assert failed["success"] is False
    assert coordinator.slots_json() == {"a": None, "b": None, "last_written": None}
    assert coordinator.show_store.now_showing is None and coordinator.show_store.history == []

    clock.chunk_ack_result = 0
    assert (await show(client, config_entry, {"spec": {"type": "text", "text": "YES"}}))["success"]
    assert coordinator.slots_json()["a"]["descriptor"]["text"] == "YES"


async def test_both_records_survive_a_reload_of_the_integration(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    await show(client, config_entry, {"spec": {"type": "text", "text": "KEEP"}})
    await show(client, config_entry, {"spec": CLOCK_SPEC}, slot="b")
    before = config_entry.runtime_data.slots_json()
    crc_length = {slot: (record["crc"], record["length"]) for slot in "ab" if (record := config_entry.runtime_data.slot_store.record(slot))}
    assert all(crc and length for crc, length in crc_length.values())  # the fingerprint of what the start frame carried

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()

    reloaded = config_entry.runtime_data
    assert reloaded.slots_json() == before
    assert {slot: (record["crc"], record["length"]) for slot in "ab" if (record := reloaded.slot_store.record(slot))} == crc_length


async def test_the_fingerprint_is_what_the_start_frame_carried(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    clock.written.clear()
    await show(client, config_entry, {"spec": {"type": "text", "text": "FINGERPRINT"}})
    start = clock.uploads[0][0]
    record = config_entry.runtime_data.slot_store.record("a")
    assert record["crc"] == start[1:5].hex()
    assert record["length"] == int.from_bytes(start[5:9], "big")


async def test_a_playlist_is_recorded_for_screen_a_and_marked_as_the_playlist(hass, config_entry, clock, device_id) -> None:
    clock.written.clear()
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SET_PLAYLIST,
        {"device_id": device_id, "playlist": [
            {"kind": "text", "params": {"text": "ONE"}, "duration_s": 5},
            {"kind": "clock", "params": {"style": 1, "color": 6}, "duration_s": 5},
        ]},
        blocking=True,
    )
    slots = config_entry.runtime_data.slots_json()
    record = slots["a"]
    assert record["programs"] == 2 and record["title"] == "Playlist · 2 programs"
    assert (record["descriptor"]["text"], record["descriptor"]["source"], record["wire_kind"]) == ("ONE", "playlist", 0)
    assert (kinds(clock), slots["b"], slots["last_written"]) == ([0, 0], None, "a")


async def test_a_date_asked_for_screen_a_lands_on_screen_b_and_the_records_say_so(hass, hass_ws_client, config_entry, clock) -> None:
    """The clock files a date page in the clock-page store whichever screen was asked for (its start frame says
    kind 04), so the screen A record must not claim it."""
    client = await hass_ws_client(hass)
    coordinator = config_entry.runtime_data
    await show(client, config_entry, {"spec": {"type": "text", "text": "STAYS"}})
    on_a = coordinator.slots_json()["a"]
    clock.written.clear()

    descriptor = (await show(client, config_entry, {"spec": {"type": "date", "color": [255, 255, 255]}}))["result"]["now_showing"]

    assert kinds(clock) == [4]
    assert descriptor["slot"] == "b"  # the answer says where it really went
    slots = coordinator.slots_json()
    assert slots["a"] == on_a and slots["b"]["descriptor"]["kind"] == "date" and slots["last_written"] == "b"


async def test_a_playlist_date_goes_to_screen_b_and_the_rest_stays_the_program_list(hass, config_entry, clock, device_id) -> None:
    coordinator = config_entry.runtime_data
    clock.written.clear()
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SET_PLAYLIST,
        {"device_id": device_id, "playlist": [
            {"kind": "text", "params": {"text": "ONE"}, "duration_s": 5},
            {"kind": "date", "params": {"color": 6}, "duration_s": 5},
            {"kind": "clock", "params": {"style": 1, "color": 6}, "duration_s": 5},
        ]},
        blocking=True,
    )
    slots = coordinator.slots_json()
    assert kinds(clock) == [0, 4, 0]
    assert (slots["a"]["programs"], slots["a"]["title"]) == (2, "Playlist · 2 programs")  # the date is not in the list
    assert (slots["b"]["descriptor"]["kind"], slots["b"]["descriptor"]["source"], slots["b"]["programs"]) == ("date", "playlist", 1)


async def test_a_playlist_of_only_a_date_leaves_the_screen_a_record_alone(hass, hass_ws_client, config_entry, clock, device_id) -> None:
    client = await hass_ws_client(hass)
    coordinator = config_entry.runtime_data
    await show(client, config_entry, {"spec": {"type": "text", "text": "STAYS"}})
    on_a = coordinator.slots_json()["a"]
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SET_PLAYLIST,
        {"device_id": device_id, "playlist": [{"kind": "date", "params": {"color": 6}, "duration_s": 5}]},
        blocking=True,
    )
    slots = coordinator.slots_json()
    assert slots["a"] == on_a and slots["b"]["descriptor"]["kind"] == "date"
    assert coordinator.show_store.now_showing["slot"] == "b"


def program_count_id(hass, clock) -> str:
    """The program count sensor's entity id, found by its unique id: the entity id follows the display name."""
    entity_id = er.async_get(hass).async_get_entity_id("sensor", DOMAIN, f"{clock.address}_program_count")
    assert entity_id is not None
    return entity_id


async def test_program_count_is_what_the_last_upload_to_screen_a_carried(hass, hass_ws_client, config_entry, clock, device_id) -> None:
    program_count = program_count_id(hass, clock)
    assert hass.states.get(program_count).state == "unknown"  # the clock cannot say, and nothing was sent yet
    client = await hass_ws_client(hass)
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SET_PLAYLIST,
        {"device_id": device_id, "playlist": [
            {"kind": "clock", "params": {"style": 1, "color": 6}, "duration_s": 5},
            {"kind": "text", "params": {"text": "TWO"}, "duration_s": 5},
        ]},
        blocking=True,
    )
    await hass.async_block_till_done()
    state = hass.states.get(program_count)
    assert state.state == "2"
    assert state.attributes["capacity"] == 9 and state.attributes["slot_b"] is None
    assert state.attributes["slot_a"]["programs"] == 2

    await show(client, config_entry, {"spec": CLOCK_SPEC}, slot="b")  # screen B does not change the count
    await hass.async_block_till_done()
    state = hass.states.get(program_count)
    assert state.state == "2"
    assert state.attributes["slot_b"]["programs"] == 1

    await show(client, config_entry, {"spec": {"type": "text", "text": "ONE"}})  # a single show replaces the list
    await hass.async_block_till_done()
    assert hass.states.get(program_count).state == "1"


# -- Undo ---------------------------------------------------------------------------------------------------


async def test_undo_goes_back_on_the_screen_of_the_entry_being_undone(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    await show(client, config_entry, {"spec": {"type": "text", "text": "ONE"}})
    await show(client, config_entry, {"spec": CLOCK_SPEC}, slot="b")
    await show(client, config_entry, {"spec": {"type": "text", "text": "TWO"}})
    await show(client, config_entry, {"spec": {"type": "date", "color": [255, 255, 255]}}, slot="b")

    clock.written.clear()
    undone = await show(client, config_entry, {"restore": "previous"})
    assert undone["result"]["now_showing"]["kind"] == "clock"  # the date on B goes back to the clock on B ...
    assert undone["result"]["now_showing"]["slot"] == "b" and kinds(clock) == [4]  # ... not to the text on A

    await show(client, config_entry, {"spec": {"type": "text", "text": "THREE"}})
    undone = await show(client, config_entry, {"restore": "previous"})
    assert (undone["result"]["now_showing"]["text"], undone["result"]["now_showing"]["slot"]) == ("TWO", "a")
    assert kinds(clock) == [4, 0, 0]  # THREE and the undo of it went to the program list


async def test_undo_has_nothing_to_go_back_to_when_the_other_screen_holds_the_only_earlier_entries(
    hass, hass_ws_client, config_entry, clock
) -> None:
    client = await hass_ws_client(hass)
    await show(client, config_entry, {"spec": {"type": "text", "text": "ONE"}})
    await show(client, config_entry, {"spec": CLOCK_SPEC}, slot="b")
    clock.written.clear()
    response = await show(client, config_entry, {"restore": "previous"})
    assert response["success"] is False and response["error"]["code"] == "nothing_to_restore"
    assert clock.uploads == []


async def test_history_from_before_screens_existed_counts_as_screen_a(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    coordinator = config_entry.runtime_data
    legacy = {"kind": "text", "text": "OLD", "color_mode": 1, "speed": 230, "is_bold": True, "title": "Text · OLD", "shown_at": "t0"}
    coordinator.show_store.history = [coordinator.show_store._without_image_source(legacy)]
    await show(client, config_entry, {"spec": CLOCK_SPEC}, slot="b")
    await show(client, config_entry, {"spec": {"type": "text", "text": "NEW"}})

    clock.written.clear()
    undone = (await show(client, config_entry, {"restore": "previous"}))["result"]["now_showing"]
    assert (undone["text"], undone["slot"], undone["effect"]) == ("OLD", "a", 1)  # shown on A, in today's words
    assert "speed" not in undone and kinds(clock) == [0]  # the old 0-255 wire speed is not a playback speed


# -- A timed message ------------------------------------------------------------------------------------------


async def test_a_timed_message_with_no_playlist_puts_back_what_screen_a_showed(
    hass, hass_ws_client, config_entry, clock, device_id, sent
) -> None:
    client = await hass_ws_client(hass)
    coordinator = config_entry.runtime_data
    art = await save_design(client)
    await hass.services.async_call(DOMAIN, const.SERVICE_SHOW_DESIGN, {"device_id": device_id, "design_id": art}, blocking=True)
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SHOW_TEXT, {"device_id": device_id, "text": "TEMP", "duration_s": 30}, blocking=True
    )
    assert coordinator.show_store.now_showing["text"] == "TEMP"
    assert coordinator._saved_playlist == []  # a timed message started while there was no playlist

    await run_timers(hass, 31)

    assert coordinator.show_store.now_showing["design_id"] == art
    assert coordinator.slots_json()["a"]["descriptor"]["design_id"] == art
    assert [type(batch[0].contents[0]).__name__ for batch in sent] == ["GraffitiContent", "GraffitiContent", "GraffitiContent"]
    assert (coordinator._saved_playlist, coordinator._saved_screen_a) == (None, None)


async def test_a_timed_message_over_a_playlist_puts_the_playlist_back(hass, config_entry, clock, device_id) -> None:
    coordinator = config_entry.runtime_data
    playlist = [{"kind": "clock", "params": {"style": 1, "color": 6}, "duration_s": 5}, {"kind": "text", "params": {"text": "TWO"}, "duration_s": 5}]
    await hass.services.async_call(DOMAIN, const.SERVICE_SET_PLAYLIST, {"device_id": device_id, "playlist": playlist}, blocking=True)
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SHOW_TEXT, {"device_id": device_id, "text": "TEMP", "duration_s": 30}, blocking=True
    )
    clock.written.clear()
    await run_timers(hass, 31)
    assert kinds(clock) == [0, 0]
    record = coordinator.slots_json()["a"]
    assert (record["programs"], record["descriptor"]["source"]) == (2, "playlist")


async def test_a_second_timed_message_does_not_make_the_first_one_the_thing_to_come_back_to(
    hass, hass_ws_client, config_entry, clock, device_id
) -> None:
    client = await hass_ws_client(hass)
    art = await save_design(client)
    await hass.services.async_call(DOMAIN, const.SERVICE_SHOW_DESIGN, {"device_id": device_id, "design_id": art}, blocking=True)
    for text in ("FIRST", "SECOND"):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_SHOW_TEXT, {"device_id": device_id, "text": text, "duration_s": 30}, blocking=True
        )
    await run_timers(hass, 31)
    assert config_entry.runtime_data.show_store.now_showing["design_id"] == art


async def test_showing_something_for_good_cancels_the_pending_return(hass, hass_ws_client, config_entry, clock, device_id) -> None:
    client = await hass_ws_client(hass)
    coordinator = config_entry.runtime_data
    art = await save_design(client)
    await hass.services.async_call(DOMAIN, const.SERVICE_SHOW_DESIGN, {"device_id": device_id, "design_id": art}, blocking=True)
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SHOW_TEXT, {"device_id": device_id, "text": "TEMP", "duration_s": 30}, blocking=True
    )
    await show(client, config_entry, {"spec": {"type": "text", "text": "STAY"}})
    clock.written.clear()
    await run_timers(hass, 31)
    assert clock.uploads == [] and coordinator.show_store.now_showing["text"] == "STAY"


async def test_screen_b_shows_never_touch_a_pending_return_on_screen_a(hass, hass_ws_client, config_entry, clock, device_id) -> None:
    client = await hass_ws_client(hass)
    coordinator = config_entry.runtime_data
    art = await save_design(client)
    await hass.services.async_call(DOMAIN, const.SERVICE_SHOW_DESIGN, {"device_id": device_id, "design_id": art}, blocking=True)
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SHOW_TEXT, {"device_id": device_id, "text": "TEMP", "duration_s": 30}, blocking=True
    )
    pending = (coordinator._saved_playlist, coordinator._saved_screen_a, coordinator._restore_generation)
    await show(client, config_entry, {"spec": CLOCK_SPEC}, slot="b")
    assert (coordinator._saved_playlist, coordinator._saved_screen_a, coordinator._restore_generation) == pending
    assert coordinator.playlist_store.playlist == []

    await run_timers(hass, 31)
    assert coordinator.show_store.now_showing["design_id"] == art  # screen A came back all the same


# -- Re-sending screen A's list ------------------------------------------------------------------------------


async def test_screen_a_can_be_re_sent_byte_for_byte(hass, config_entry, clock, device_id) -> None:
    coordinator = config_entry.runtime_data
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SET_PLAYLIST,
        {"device_id": device_id, "playlist": [
            {"kind": "text", "params": {"text": "ONE"}, "duration_s": 5},
            {"kind": "clock", "params": {"style": 1, "color": 6}, "duration_s": 5},
        ]},
        blocking=True,
    )
    first = [start for start, _ in clock.uploads[-2:]]
    clock.written.clear()
    async with coordinator.show_lock:
        assert await coordinator.async_reassert_program_list_locked() is True
    assert [start for start, _ in clock.uploads] == first  # the same two start frames: the clock answers "already present"


async def test_after_a_restart_the_stored_playlist_is_what_gets_re_sent(hass, config_entry, clock, device_id) -> None:
    coordinator = config_entry.runtime_data
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SET_PLAYLIST,
        {"device_id": device_id, "playlist": [{"kind": "text", "params": {"text": "TWO"}, "duration_s": 5}]},
        blocking=True,
    )
    first = clock.uploads[-1][0]
    coordinator._slot_programs.clear()  # what a restart does: the programs are not persisted
    clock.written.clear()
    async with coordinator.show_lock:
        assert await coordinator.async_reassert_program_list_locked() is True
    assert clock.uploads[0][0] == first


async def test_after_a_restart_only_the_list_programs_are_re_sent_never_a_stored_date_page(
    hass, config_entry, clock, device_id
) -> None:
    """A stored playlist can hold a date item, which the clock files in screen B (kind 04). Re-sending screen A from
    it must not overwrite screen B with that old page, and a playlist that is only a date leaves nothing to send."""
    coordinator = config_entry.runtime_data
    text = {"kind": "text", "params": {"text": "ONE"}, "duration_s": 5}
    date = {"kind": "date", "params": {"color": 6}, "duration_s": 5}

    async def set_playlist(*items) -> None:
        await hass.services.async_call(
            DOMAIN, const.SERVICE_SET_PLAYLIST, {"device_id": device_id, "playlist": list(items)}, blocking=True
        )

    await set_playlist(text, date)
    assert kinds(clock)[-2:] == [0, 4]
    coordinator._slot_programs.clear()  # what a restart does: the programs are not persisted
    clock.written.clear()
    async with coordinator.show_lock:
        assert await coordinator.async_reassert_program_list_locked() is True
    assert kinds(clock) == [0]  # the text only: the date page stayed where it was

    await set_playlist(date)  # writes screen B alone; screen A's record still says "the playlist"
    coordinator._slot_programs.clear()
    clock.written.clear()
    async with coordinator.show_lock:
        assert await coordinator.async_reassert_program_list_locked() is False
    assert clock.uploads == []


async def test_with_nothing_known_about_screen_a_nothing_is_re_sent(hass, hass_ws_client, config_entry, clock) -> None:
    coordinator = config_entry.runtime_data
    clock.written.clear()
    async with coordinator.show_lock:
        assert await coordinator.async_reassert_program_list_locked() is False
    client = await hass_ws_client(hass)
    await show(client, config_entry, {"spec": {"type": "text", "text": "SHOW"}})
    coordinator._slot_programs.clear()  # restarted; screen A's last write was a show, not the playlist
    clock.written.clear()
    async with coordinator.show_lock:
        assert await coordinator.async_reassert_program_list_locked() is False
    assert clock.uploads == []


# -- Text as frames ---------------------------------------------------------------------------------------------


async def test_text_is_uploaded_as_a_picture_and_never_as_the_clocks_own_text(hass, hass_ws_client, config_entry, clock, sent) -> None:
    client = await hass_ws_client(hass)
    clock.written.clear()
    await show(client, config_entry, {"spec": {"type": "text", "text": "HI"}})
    await show(client, config_entry, {"spec": {"type": "text", "text": "A MESSAGE MUCH WIDER THAN THE PANEL " * 3}})
    short, scrolling = sent[0][0].contents[0], sent[1][0].contents[0]
    assert isinstance(short, GraffitiContent)
    assert isinstance(scrolling, AnimationContent) and 2 <= len(scrolling.frames) <= 40
    assert not any(isinstance(content, TextContent) for batch in sent for program in batch for content in program.contents)
    assert kinds(clock) == [0, 0]
    assert clock.uploads[0][1], "a new picture really is sent in chunks (the old text answered 'already present' and stayed blank)"


async def test_a_120_character_message_scrolls_in_at_most_40_frames(hass, hass_ws_client, config_entry, clock, sent) -> None:
    client = await hass_ws_client(hass)
    response = await show(client, config_entry, {"spec": {"type": "text", "text": "W" * 120}})
    assert response["success"] is True, response
    assert len(sent[0][0].contents[0].frames) == 40
    too_long = await show(client, config_entry, {"spec": {"type": "text", "text": "W" * 121}})
    assert too_long["success"] is False and "too long" in too_long["error"]["message"]


async def test_the_preview_is_exactly_what_is_uploaded(hass, hass_ws_client, config_entry, clock, sent) -> None:
    client = await hass_ws_client(hass)
    for extra in ({}, {"speed": 50}, {"speed": 100, "smooth": "off"}, {"speed": 0}):
        spec = {"type": "text", "text": "THE QUICK BROWN FOX", "color": [255, 128, 0], "effect": "2", "bold": False, "font": "5x7", **extra}
        preview = (await send(client, {"type": "iledclock/render", "entry_id": config_entry.entry_id, "spec": spec}))["result"]
        sent.clear()
        assert (await show(client, config_entry, {"spec": spec}))["success"] is True
        content = sent[0][0].contents[0]
        frames = content.frames if isinstance(content, AnimationContent) else [content.pixels]
        uploaded = [bytes(c for row in frame.pixels for px in row for c in px) for frame in frames]
        assert uploaded == [base64.b64decode(frame) for frame in preview["frames"]], extra
        assert len(preview["delays"]) == len(uploaded)


async def test_the_old_text_speed_is_rejected_by_the_preview_and_the_show_alike(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    spec = {"type": "text", "text": "HI", "speed": 128}
    rendered = await send(client, {"type": "iledclock/render", "entry_id": config_entry.entry_id, "spec": spec})
    shown = await show(client, config_entry, {"spec": spec})
    assert (rendered["error"]["code"], shown["error"]["code"]) == ("render_failed", "show_failed")
    assert "0 to 100" in rendered["error"]["message"] and "0 to 100" in shown["error"]["message"]


async def test_a_text_descriptor_keeps_every_option_and_the_screen(hass, hass_ws_client, config_entry, clock) -> None:
    client = await hass_ws_client(hass)
    spec = {"type": "text", "text": "HI", "color": [0, 255, 0], "effect": "4", "bold": True, "font": "5x7", "speed": 50, "smooth": "on"}
    descriptor = (await show(client, config_entry, {"spec": spec}))["result"]["now_showing"]
    assert {key: descriptor[key] for key in ("kind", "text", "color", "effect", "is_bold", "font", "speed", "smooth", "slot")} == {
        "kind": "text", "text": "HI", "color": [0, 255, 0], "effect": "4", "is_bold": True, "font": "5x7",
        "speed": 50, "smooth": "on", "slot": "a",
    }
    assert "bold" not in descriptor
    # and undoing a different show brings it back exactly as it was
    await show(client, config_entry, {"spec": {"type": "text", "text": "NEXT"}})
    again = (await show(client, config_entry, {"restore": "previous"}))["result"]["now_showing"]
    assert {key: again[key] for key in ("text", "color", "effect", "is_bold", "speed", "smooth")} == {
        "text": "HI", "color": [0, 255, 0], "effect": "4", "is_bold": True, "speed": 50, "smooth": "on",
    }


async def test_the_show_text_service_draws_with_its_colour_effect_and_speed(hass, config_entry, clock, device_id, sent) -> None:
    clock.written.clear()
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SHOW_TEXT,
        {"device_id": device_id, "text": "1234567", "font": "3x5", "color": [0, 0, 255], "color_mode": 4, "speed": 100, "smooth": False},
        blocking=True,
    )
    descriptor = config_entry.runtime_data.show_store.now_showing
    assert (descriptor["color"], descriptor["effect"], descriptor["speed"], descriptor["smooth"]) == ([0, 0, 255], 4, 100.0, "off")
    content = sent[0][0].contents[0]
    assert isinstance(content, GraffitiContent)  # speed 100 on a text that fits is still one picture
    colours = {px for row in content.pixels.pixels for px in row if px != (0, 0, 0)}
    assert colours == {(255, 0, 0), (255, 255, 0), (0, 255, 0), (0, 255, 255), (0, 0, 255), (255, 0, 255)}  # colour_mode 4 ignores `color`


async def test_the_show_text_service_defaults_are_white_not_bold_and_the_texts_own_pace(hass, config_entry, clock, device_id) -> None:
    await hass.services.async_call(DOMAIN, const.SERVICE_SHOW_TEXT, {"device_id": device_id, "text": "HI"}, blocking=True)
    descriptor = config_entry.runtime_data.show_store.now_showing
    assert (descriptor["color"], descriptor["effect"], descriptor["is_bold"]) == ([255, 255, 255], 1, False)
    assert "speed" not in descriptor and "smooth" not in descriptor  # Original: nothing was asked for
    for bad in ({"speed": 255}, {"color": [1, 2]}, {"text": "x" * 121}):
        with pytest.raises(Exception):  # the schema rejects the old 0-255 speed, a short colour and too long a text
            await hass.services.async_call(DOMAIN, const.SERVICE_SHOW_TEXT, {"device_id": device_id, "text": "HI", **bad}, blocking=True)


async def test_the_message_entity_shows_text_on_screen_a(hass, config_entry, clock) -> None:
    clock.written.clear()
    await hass.services.async_call(
        "text", "set_value", {"entity_id": "text.mock_title_message", "value": "HELLO"}, blocking=True
    )
    assert kinds(clock) == [0]
    assert config_entry.runtime_data.slots_json()["a"]["descriptor"]["text"] == "HELLO"
