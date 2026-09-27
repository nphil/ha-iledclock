"""Every `iledclock.*` service (Contract A/B, `services.yaml`): schema acceptance plus its
effect on the fake transport, and a parity check that every service in `services.yaml` is both
registered and named by a `SERVICE_*` constant (and vice versa)."""

from __future__ import annotations

import base64

import pytest
import yaml
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from custom_components.iledclock import const
from custom_components.iledclock.const import DOMAIN
from custom_components.iledclock.store import async_get_design_library

from .fake_clock import FakeClockDevice

_SERVICES_YAML = __import__("pathlib").Path(__file__).resolve().parents[2] / "custom_components/iledclock/services.yaml"


@pytest.fixture
def device_id(hass, config_entry, clock: FakeClockDevice) -> str:
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), config_entry.entry_id)
    assert len(devices) == 1
    return devices[0].id


# -- Parity: services.yaml <-> SERVICE_* constants <-> hass.services registry -----------------


def test_services_yaml_matches_registered_services_and_constants(hass, config_entry) -> None:
    yaml_names = set(yaml.safe_load(_SERVICES_YAML.read_text(encoding="utf-8")))
    constant_names = {
        value for name, value in vars(const).items() if name.startswith("SERVICE_") and isinstance(value, str)
    }
    registered_names = set(hass.services.async_services().get(DOMAIN, {}))

    assert yaml_names == constant_names, f"services.yaml vs const.SERVICE_*: {yaml_names ^ constant_names}"
    assert yaml_names == registered_names, f"services.yaml vs registered: {yaml_names ^ registered_names}"


# -- show_* / set_playlist / clock_face: all upload through the fake transport -----------------


async def test_show_text_uploads_and_can_restore(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    clock.written.clear()
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SHOW_TEXT, {"device_id": device_id, "text": "HELLO"}, blocking=True
    )
    assert len(clock.uploads) == 1
    assert clock.uploads[0][0][0] == 0x02  # program start


async def test_show_uses_cached_program_start_ack_and_finishes_progress(
    hass, config_entry, clock: FakeClockDevice
) -> None:
    clock.start_ack_result = 1
    clock.written.clear()
    coordinator = config_entry.runtime_data
    progress: list[dict] = []
    unsubscribe = async_dispatcher_connect(
        hass, const.upload_progress_signal(config_entry.entry_id), progress.append
    )
    try:
        descriptor = await coordinator.async_show(
            {
                "type": "clock",
                "style": 17,
                "color": [255, 255, 255],
                "hours24": False,
                "background": True,
            }
        )
    finally:
        unsubscribe()

    assert descriptor["kind"] == "clock"
    assert descriptor["style"] == 17
    assert descriptor["background"] is True
    assert coordinator.show_store.now_showing == descriptor
    assert len(clock.uploads) == 1
    assert clock.uploads[0][1] == []
    completed = next(event for event in progress if event["state"] == "done" and event["upload"] is not None)
    assert completed["upload"]["done"] == completed["upload"]["total"]
    assert progress[-1]["state"] == "done"
    assert progress[-1]["upload"] is None


async def test_show_design_uploads(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    library = async_get_design_library(hass)
    await library.async_load()
    frame_b64 = base64.b64encode(bytes((10, 20, 30)) * (32 * 16)).decode("ascii")
    design = await library.async_save_design({"name": "Swatch", "kind": "image", "frames": [frame_b64]})

    clock.written.clear()
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SHOW_DESIGN, {"device_id": device_id, "design_id": design.id}, blocking=True
    )
    assert len(clock.uploads) == 1


async def test_show_design_unknown_id_raises_validation_error(hass, config_entry, device_id: str) -> None:
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_SHOW_DESIGN, {"device_id": device_id, "design_id": "no-such-design"}, blocking=True
        )


async def test_show_image_requires_url_or_data(hass, config_entry, device_id: str) -> None:
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_SHOW_IMAGE, {"device_id": device_id}, blocking=True
        )


async def test_show_image_with_data_b64_uploads(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 0, 0)).save(buf, format="PNG")
    data_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    clock.written.clear()
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SHOW_IMAGE, {"device_id": device_id, "data_b64": data_b64}, blocking=True
    )
    assert len(clock.uploads) == 1


async def test_show_image_with_url_uploads(
    hass, config_entry, clock: FakeClockDevice, device_id: str, aioclient_mock
) -> None:
    """`async_render_image`'s `url` branch fetches through
    `aiohttp_client.async_get_clientsession(hass)` -- a distinct code path from `data_b64`,
    exercised here through HA's real shared client session."""
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (0, 128, 255)).save(buf, format="PNG")
    aioclient_mock.get("https://example.com/swatch.png", content=buf.getvalue())

    clock.written.clear()
    await hass.services.async_call(
        DOMAIN,
        const.SERVICE_SHOW_IMAGE,
        {"device_id": device_id, "url": "https://example.com/swatch.png"},
        blocking=True,
    )
    assert len(clock.uploads) == 1


async def test_show_generative_uploads(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    clock.written.clear()
    await hass.services.async_call(
        DOMAIN,
        const.SERVICE_SHOW_GENERATIVE,
        {"device_id": device_id, "kind": "plasma", "seconds": 1},
        blocking=True,
    )
    assert len(clock.uploads) == 1


async def test_set_playlist_persists_and_uploads(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    clock.written.clear()
    await hass.services.async_call(
        DOMAIN,
        const.SERVICE_SET_PLAYLIST,
        {"device_id": device_id, "playlist": [{"kind": "text", "params": {"text": "HI"}, "duration_s": 5}]},
        blocking=True,
    )
    coordinator = config_entry.runtime_data
    assert [p.kind for p in coordinator.playlist_store.playlist] == ["text"]
    assert len(clock.uploads) == 1


async def test_set_playlist_invalid_kind_raises(hass, config_entry, device_id: str) -> None:
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN,
            const.SERVICE_SET_PLAYLIST,
            {"device_id": device_id, "playlist": [{"kind": "not-a-kind", "params": {}, "duration_s": 5}]},
            blocking=True,
        )


async def test_clock_face_uploads(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    clock.written.clear()
    await hass.services.async_call(
        DOMAIN,
        const.SERVICE_CLOCK_FACE,
        {"device_id": device_id, "style": 3, "color": 2, "hours24": True, "show_seconds": True},
        blocking=True,
    )
    assert len(clock.uploads) == 1


# -- Timers / scoreboard --------------------------------------------------------------------


async def test_countdown_reset_and_run(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    await hass.services.async_call(
        DOMAIN, const.SERVICE_COUNTDOWN_RESET, {"device_id": device_id, "hour": 0, "minute": 5, "second": 30}, blocking=True
    )
    assert clock.last_request(0x0F, 0x02) == bytes((0x0F, 0x02, 0, 5, 30))

    await hass.services.async_call(
        DOMAIN, const.SERVICE_COUNTDOWN_RUN, {"device_id": device_id, "start": True}, blocking=True
    )
    assert clock.last_request(0x0F, 0x03) == bytes((0x0F, 0x03, 1))


async def test_stopwatch_reset_and_run(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    await hass.services.async_call(DOMAIN, const.SERVICE_STOPWATCH_RESET, {"device_id": device_id}, blocking=True)
    assert clock.last_request(0x10, 0x02) == bytes((0x10, 0x02))

    await hass.services.async_call(
        DOMAIN, const.SERVICE_STOPWATCH_RUN, {"device_id": device_id, "start": True}, blocking=True
    )
    assert clock.last_request(0x10, 0x03) == bytes((0x10, 0x03, 1))


async def test_scoreboard_set_score_set_time_run(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SCOREBOARD_SET_SCORE, {"device_id": device_id, "home": 3, "away": 21}, blocking=True
    )
    assert clock.last_request(0x11, 0x02) == bytes((0x11, 0x02, 0, 3, 0, 21, 3, 21))

    await hass.services.async_call(
        DOMAIN,
        const.SERVICE_SCOREBOARD_SET_TIME,
        {"device_id": device_id, "minute": 12, "second": 34, "count_down": False},
        blocking=True,
    )
    assert clock.last_request(0x11, 0x03) == bytes((0x11, 0x03, 12, 34, 0))

    await hass.services.async_call(
        DOMAIN, const.SERVICE_SCOREBOARD_RUN, {"device_id": device_id, "start": True}, blocking=True
    )
    assert clock.last_request(0x11, 0x04) == bytes((0x11, 0x04, 1))


# -- Alarms / timer switches / pomodoro / night mode / reminders -----------------------------


async def test_set_alarms(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    await hass.services.async_call(
        DOMAIN,
        const.SERVICE_SET_ALARMS,
        {"device_id": device_id, "alarms": [{"hour": 7, "minute": 15, "enabled": True, "repeat": 0x1F}]},
        blocking=True,
    )
    assert clock.last_request(0x16, 0x01) is not None


async def test_set_timer_switches(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    await hass.services.async_call(
        DOMAIN,
        const.SERVICE_SET_TIMER_SWITCHES,
        {"device_id": device_id, "timer_switches": [{"hour": 22, "minute": 0, "on": False, "enabled": True, "repeat": 0}]},
        blocking=True,
    )
    assert clock.last_request(0x0A, None) is not None


async def test_set_pomodoro(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    await hass.services.async_call(
        DOMAIN, const.SERVICE_SET_POMODORO, {"device_id": device_id, "minutes": [25, 5, 25, 5, 25, 15]}, blocking=True
    )
    assert clock.last_request(0x15, 0x01) is not None


async def test_night_mode_service_field_names(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    """The `night_mode` *service* uses long field names (`start_hour`/`start_minute`/...),
    distinct from `iledclock/command`'s WS-only short names -- exercised separately here."""
    await hass.services.async_call(
        DOMAIN,
        const.SERVICE_NIGHT_MODE,
        {
            "device_id": device_id,
            "enabled": True,
            "start_hour": 23,
            "start_minute": 15,
            "end_hour": 6,
            "end_minute": 45,
            "device_off": True,
            "brightness": 20,
            "wake_minutes": 10,
            "voice": False,
            "voice_sensitivity": 4,
        },
        blocking=True,
    )
    # ..., brightness, voice, wake, sensitivity (vendor call site; confirmed on the live clock)
    assert clock.last_request(0x14, 0x01) == bytes((0x14, 0x01, 1, 23, 15, 6, 45, 1, 20, 0, 10, 4))


async def test_reminder_delete(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    await hass.services.async_call(
        DOMAIN, const.SERVICE_REMINDER_DELETE, {"device_id": device_id, "id": 2}, blocking=True
    )
    assert clock.last_request(0x1A, 0x03) == bytes((0x1A, 0x03, 2))


# -- Link / raw -------------------------------------------------------------------------------


async def test_sync_time(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    await hass.services.async_call(DOMAIN, const.SERVICE_SYNC_TIME, {"device_id": device_id}, blocking=True)
    assert clock.last_request(0x09, None) is not None


async def test_release_link_disconnects(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    assert clock.connected is True
    await hass.services.async_call(DOMAIN, const.SERVICE_RELEASE_LINK, {"device_id": device_id}, blocking=True)
    assert clock.connected is False


async def test_send_raw(hass, config_entry, clock: FakeClockDevice, device_id: str) -> None:
    await hass.services.async_call(
        DOMAIN,
        const.SERVICE_SEND_RAW,
        {"device_id": device_id, "opcode": 0x1F, "payload_hex": "", "timeout_s": 5.0},
        blocking=True,
    )
    assert clock.last_request(0x1F, None) == bytes((0x1F,))


async def test_service_unknown_device_id_raises(hass, config_entry) -> None:
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_SYNC_TIME, {"device_id": "not-a-real-device"}, blocking=True
        )
