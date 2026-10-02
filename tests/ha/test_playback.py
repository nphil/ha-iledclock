"""Speed and Smooth motion through the real WebSocket commands and services: what is stored with a
design, what the panel previews, and that "Show on clock" uploads exactly those frames and delays."""

from __future__ import annotations

import base64
import random
from unittest.mock import patch

import pytest
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import device_registry as dr
from voluptuous import Invalid

from custom_components.iledclock import const
from custom_components.iledclock.client import IledClockClient
from custom_components.iledclock.const import DOMAIN

from .fake_clock import FakeClockDevice

W, H = 32, 16
UNIT_MS = 1.5


def sliding_frames(count: int = 8, step: int = 3) -> list[bytes]:
    """A sprite that moves `step` pixels right each frame."""
    rng = random.Random(5)
    shape = [[rng.random() < 0.6 for _ in range(6)] for _ in range(7)]
    frames = []
    for k in range(count):
        frame = bytearray(W * H * 3)
        for dy, row in enumerate(shape):
            for dx, lit in enumerate(row):
                if lit:
                    at = ((4 + dy) * W + 1 + step * k + dx) * 3
                    frame[at : at + 3] = bytes((255, 160, 0))
        frames.append(bytes(frame))
    return frames


def b64s(frames: list[bytes]) -> list[str]:
    return [base64.b64encode(frame).decode("ascii") for frame in frames]


async def save_slide(client, **extra) -> str:
    await client.send_json_auto_id(
        {
            "type": "iledclock/designs/save",
            "design": {"name": "Slide", "kind": "animation", "frames": b64s(sliding_frames()), "delays": [125] * 8, **extra},
        }
    )
    response = await client.receive_json()
    assert response["success"] is True, response
    return response["result"]["id"]


async def call(client, message: dict) -> dict:
    await client.send_json_auto_id(message)
    return await client.receive_json()


async def design_record(client, design_id: str) -> dict:
    listing = (await call(client, {"type": "iledclock/designs/list"}))["result"]
    return next(design for design in listing if design["id"] == design_id)


# -- iledclock/designs/set_playback ---------------------------------------------------------------


async def test_set_playback_changes_only_the_playback_keys_that_are_present(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    design_id = await save_slide(client)

    response = await call(client, {"type": "iledclock/designs/set_playback", "design_id": design_id, "speed": 30, "smooth": "off"})
    assert response["success"] is True, response
    assert response["result"]["id"] == design_id
    assert (response["result"]["speed"], response["result"]["smooth"]) == (30, "off")

    await call(client, {"type": "iledclock/designs/set_playback", "design_id": design_id, "smooth": None})
    record = await design_record(client, design_id)
    assert (record["speed"], record["smooth"]) == (30, None)  # speed was not mentioned, so it stays
    assert len(record["frames"]) == 8 and record["delays"] == [125] * 8  # the picture itself never changes


async def test_set_playback_refuses_bad_values_and_unknown_designs(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    design_id = await save_slide(client)
    for bad in ({"speed": 101}, {"speed": -3}, {"smooth": "maybe"}):
        response = await call(client, {"type": "iledclock/designs/set_playback", "design_id": design_id, **bad})
        assert response["success"] is False and response["error"]["code"] == "invalid_playback", bad
    response = await call(client, {"type": "iledclock/designs/set_playback", "design_id": design_id, "speed": "fast"})
    assert response["success"] is False  # not even a number: refused before it reaches the library
    response = await call(client, {"type": "iledclock/designs/set_playback", "design_id": "nope", "speed": 5})
    assert response["success"] is False and response["error"]["code"] == "not_found"


async def test_saving_a_design_without_playback_keys_keeps_its_stored_choice(hass, hass_ws_client, config_entry) -> None:
    """A rename from an older panel only sends what it read; it must not wipe Speed or Smooth motion."""
    client = await hass_ws_client(hass)
    design_id = await save_slide(client, speed=40, smooth="off")
    response = await call(
        client,
        {"type": "iledclock/designs/save", "design": {"id": design_id, "name": "Renamed", "kind": "animation",
                                                      "frames": b64s(sliding_frames()), "delays": [125] * 8}},
    )
    assert response["success"] is True
    record = await design_record(client, design_id)
    assert (record["name"], record["speed"], record["smooth"]) == ("Renamed", 40, "off")

    # ... while a save that does say something replaces it
    await call(client, {"type": "iledclock/designs/save", "design": {"id": design_id, "name": "Renamed", "kind": "animation",
                                                                      "frames": b64s(sliding_frames()), "delays": [125] * 8,
                                                                      "speed": None, "smooth": None}})
    record = await design_record(client, design_id)
    assert (record["speed"], record["smooth"]) == (None, None)


# -- iledclock/playback/preview ---------------------------------------------------------------------


async def test_playback_preview_of_a_saved_design_uses_its_stored_choice_unless_overridden(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    design_id = await save_slide(client, speed=25)

    stored = (await call(client, {"type": "iledclock/playback/preview", "design_id": design_id}))["result"]
    assert stored["playback"]["smooth"]["state"] == "applied"
    assert len(stored["frames"]) == stored["playback"]["frames"] > 8
    assert all(len(base64.b64decode(frame)) == W * H * 3 for frame in stored["frames"])

    still = (await call(client, {"type": "iledclock/playback/preview", "design_id": design_id, "speed": 0}))["result"]
    assert len(still["frames"]) == 1 and still["playback"]["still"] is True

    original = (await call(client, {"type": "iledclock/playback/preview", "design_id": design_id, "speed": None}))["result"]
    assert original["delays"] == [125] * 8 and original["playback"]["added_frames"] == 0


async def test_playback_preview_of_inline_frames(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    response = await call(
        client,
        {"type": "iledclock/playback/preview", "frames": b64s(sliding_frames()), "delays": [125] * 8, "speed": 100, "smooth": None},
    )
    assert response["success"] is True, response
    assert response["result"]["delays"] == [10.5] * 8
    assert response["result"]["playback"]["pace_fps"] == pytest.approx(95.2, abs=0.1)

    for bad in (
        {"frames": b64s(sliding_frames()), "delays": [125] * 3},
        {"frames": ["!!"], "delays": [125]},
        {"frames": b64s(sliding_frames()), "delays": [125] * 8, "speed": 400},
    ):
        response = await call(client, {"type": "iledclock/playback/preview", **bad})
        assert response["success"] is False and response["error"]["code"] == "invalid_playback", bad
    response = await call(client, {"type": "iledclock/playback/preview", "design_id": "nope"})
    assert response["success"] is False and response["error"]["code"] == "not_found"


async def test_render_of_a_design_follows_its_playback_and_accepts_overrides(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    design_id = await save_slide(client, speed=100)
    spec = {"type": "design", "design_id": design_id}
    rendered = (await call(client, {"type": "iledclock/render", "entry_id": config_entry.entry_id, "spec": spec}))["result"]
    assert rendered["delays"] == [10.5] * 8
    overridden = (await call(client, {"type": "iledclock/render", "entry_id": config_entry.entry_id, "spec": {**spec, "speed": 0}}))["result"]
    assert len(overridden["frames"]) == 1


# -- Show on clock uploads exactly what the preview shows ---------------------------------------------


async def test_show_uploads_exactly_the_frames_and_delays_the_preview_returns(
    hass, hass_ws_client, config_entry, clock: FakeClockDevice
) -> None:
    client = await hass_ws_client(hass)
    design_id = await save_slide(client, speed=30)
    preview = (await call(client, {"type": "iledclock/playback/preview", "design_id": design_id}))["result"]

    sent = []
    real = IledClockClient.async_upload

    async def spy(self, programs, **kwargs):
        sent.extend(programs)
        return await real(self, programs, **kwargs)

    with patch.object(IledClockClient, "async_upload", spy):
        response = await call(client, {"type": "iledclock/show", "entry_id": config_entry.entry_id, "item": {"design_id": design_id}})
    assert response["success"] is True, response

    frames = sent[0].contents[0].frames
    pixels = [bytes(c for row in f.pixels for px in row for c in px) for f in frames]
    assert pixels == [base64.b64decode(frame) for frame in preview["frames"]]
    assert [f.duration_ms for f in frames] == [round(d / UNIT_MS) for d in preview["delays"]]
    assert len(preview["frames"]) > 8  # the in-between frames really are in the upload
    assert len(clock.uploads) == 1


# -- Services ---------------------------------------------------------------------------------------


@pytest.fixture
def device_id(hass, config_entry, clock: FakeClockDevice) -> str:
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), config_entry.entry_id)
    assert len(devices) == 1
    return devices[0].id


async def test_show_design_service_takes_speed_and_smooth(hass, hass_ws_client, config_entry, clock, device_id) -> None:
    client = await hass_ws_client(hass)
    design_id = await save_slide(client, speed=30)
    sent = []
    real = IledClockClient.async_upload

    async def spy(self, programs, **kwargs):
        sent.extend(programs)
        return await real(self, programs, **kwargs)

    with patch.object(IledClockClient, "async_upload", spy):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_SHOW_DESIGN,
            {"device_id": device_id, "design_id": design_id, "speed": 100, "smooth": False}, blocking=True,
        )
    frames = sent[0].contents[0].frames
    assert len(frames) == 8 and {f.duration_ms for f in frames} == {7}
    descriptor = config_entry.runtime_data.show_store.now_showing
    assert (descriptor["speed"], descriptor["smooth"]) == (100.0, "off")  # so an Undo re-shows it the same way


async def test_show_design_service_without_speed_uses_the_saved_choice(hass, hass_ws_client, config_entry, clock, device_id) -> None:
    client = await hass_ws_client(hass)
    design_id = await save_slide(client, speed=0)
    sent = []
    real = IledClockClient.async_upload

    async def spy(self, programs, **kwargs):
        sent.extend(programs)
        return await real(self, programs, **kwargs)

    with patch.object(IledClockClient, "async_upload", spy):
        await hass.services.async_call(DOMAIN, const.SERVICE_SHOW_DESIGN, {"device_id": device_id, "design_id": design_id}, blocking=True)
    assert len(sent[0].contents) == 1 and hasattr(sent[0].contents[0], "pixels")  # Still: one graffiti picture
    assert "speed" not in config_entry.runtime_data.show_store.now_showing


async def test_show_services_reject_a_speed_outside_0_to_100(hass, config_entry, device_id) -> None:
    for service, data in (
        (const.SERVICE_SHOW_DESIGN, {"design_id": "x"}),
        (const.SERVICE_SHOW_IMAGE, {"data_b64": "AAAA"}),
        (const.SERVICE_SHOW_GENERATIVE, {"kind": "plasma"}),
    ):
        with pytest.raises((Invalid, ServiceValidationError)):
            await hass.services.async_call(DOMAIN, service, {"device_id": device_id, "speed": 101, **data}, blocking=True)


async def test_show_generative_service_scales_the_effect(hass, config_entry, clock, device_id) -> None:
    sent = []
    real = IledClockClient.async_upload

    async def spy(self, programs, **kwargs):
        sent.extend(programs)
        return await real(self, programs, **kwargs)

    with patch.object(IledClockClient, "async_upload", spy):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_SHOW_GENERATIVE,
            {"device_id": device_id, "kind": "rainbow", "seconds": 1, "speed": 100}, blocking=True,
        )
    frames = sent[0].contents[0].frames
    assert len(frames) > 1 and {f.duration_ms for f in frames} == {7}
