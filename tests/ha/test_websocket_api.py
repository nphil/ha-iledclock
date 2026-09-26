"""Every core `iledclock/*` websocket command (Contract D), through `hass_ws_client` against a
real `homeassistant.components.websocket_api` connection: one valid-payload success + shape
check and one invalid-payload check per command."""

from __future__ import annotations

from unittest.mock import patch

from custom_components.iledclock.const import DOMAIN

import base64

from .fake_clock import FakeClockDevice

_FRAME_BYTES = 32 * 16 * 3


def _solid_frame_b64(color: tuple[int, int, int] = (255, 0, 0)) -> str:
    """One 32x16 RGB888 frame, base64-encoded (Contract D design-frame wire shape)."""
    return base64.b64encode(bytes(color) * (32 * 16)).decode("ascii")


# -- iledclock/state ------------------------------------------------------------------------


async def test_ws_state_success_shape(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/state", "entry_id": config_entry.entry_id})
    response = await client.receive_json()
    assert response["success"] is True
    result = response["result"]
    assert result["connected"] is True
    assert result["busy"] is False
    assert result["state"]["power"] is True
    assert result["state"]["firmware"] == 33
    assert result["state"]["program_slots"] == 9
    assert result["playlist"] == []
    assert result["capabilities"]["max_playlist_items"] == 9
    assert result["capabilities"]["has_temperature"] is False


async def test_ws_state_unknown_entry_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/state", "entry_id": "not-a-real-entry"})
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "unknown_entry"


async def test_ws_commands_on_an_entry_that_is_not_loaded_yet(hass, hass_ws_client, make_config_entry) -> None:
    """Regression: right after an HA restart the panel reconnects before the entry has finished
    setting up; that crashed with AttributeError on `runtime_data` instead of a clean error the
    panel can retry on."""
    from homeassistant.setup import async_setup_component

    entry = make_config_entry()
    # Register the integration (and its WebSocket commands) while this entry's own setup is held
    # back, reproducing the window right after a restart.
    with patch("custom_components.iledclock.async_setup_entry", return_value=False):
        assert await async_setup_component(hass, DOMAIN, {})
        await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    for command in ("iledclock/state", "iledclock/playlist/get"):
        await client.send_json_auto_id({"type": command, "entry_id": entry.entry_id})
        response = await client.receive_json()
        assert response["success"] is False, command
        assert response["error"]["code"] == "unknown_entry", command
        assert "not loaded" in response["error"]["message"], command


# -- iledclock/subscribe --------------------------------------------------------------------


async def test_ws_subscribe_pushes_state_on_change(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/subscribe", "entry_id": config_entry.entry_id})
    ack = await client.receive_json()
    assert ack["success"] is True

    coordinator = config_entry.runtime_data
    await coordinator.async_set_power(False)

    event = await client.receive_json()
    assert event["type"] == "event"
    assert event["event"]["state"]["power"] is False


async def test_ws_subscribe_unknown_entry_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/subscribe", "entry_id": "nope"})
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "unknown_entry"


# -- iledclock/designs/* ----------------------------------------------------------------------


async def test_ws_designs_list_shape(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/designs/list"})
    response = await client.receive_json()
    assert response["success"] is True
    assert response["result"] == []


async def test_ws_designs_save_success_and_invalid(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/designs/save",
            "design": {"name": "Red Square", "kind": "image", "frames": [_solid_frame_b64()]},
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    design_id = response["result"]["id"]
    assert isinstance(design_id, str) and design_id

    await client.send_json_auto_id(
        {"type": "iledclock/designs/save", "design": {"name": "", "kind": "image", "frames": [_solid_frame_b64()]}}
    )
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "invalid_design"


async def test_ws_designs_delete_success_and_invalid(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/designs/save",
            "design": {"name": "To Delete", "kind": "image", "frames": [_solid_frame_b64()]},
        }
    )
    design_id = (await client.receive_json())["result"]["id"]

    await client.send_json_auto_id({"type": "iledclock/designs/delete", "design_id": design_id})
    response = await client.receive_json()
    assert response["success"] is True
    assert response["result"] == {}

    await client.send_json_auto_id({"type": "iledclock/designs/list"})
    assert (await client.receive_json())["result"] == []

    # Invalid payload: `design_id` is required, not the reserved websocket message `id`.
    await client.send_json_auto_id({"type": "iledclock/designs/delete"})
    response = await client.receive_json()
    assert response["success"] is False


# -- iledclock/render ------------------------------------------------------------------------


async def test_ws_render_text_success(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/render",
            "entry_id": config_entry.entry_id,
            "spec": {"type": "text", "text": "HI", "color": [0, 255, 0]},
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    result = response["result"]
    assert len(result["frames"]) >= 1
    assert len(result["delays"]) == len(result["frames"])
    for frame_b64 in result["frames"]:
        assert len(base64.b64decode(frame_b64)) == _FRAME_BYTES


async def test_ws_render_generative_success(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/render",
            "entry_id": config_entry.entry_id,
            "spec": {"type": "generative", "kind": "plasma", "seconds": 1},
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    assert len(response["result"]["frames"]) >= 1


async def test_ws_render_image_success(hass, hass_ws_client, config_entry) -> None:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (255, 128, 0)).save(buf, format="PNG")
    data_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/render",
            "entry_id": config_entry.entry_id,
            "spec": {"type": "image", "data_b64": data_b64},
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    assert len(response["result"]["frames"]) >= 1


async def test_ws_render_invalid_type_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "iledclock/render", "entry_id": config_entry.entry_id, "spec": {"type": "not-a-real-type"}}
    )
    response = await client.receive_json()
    assert response["success"] is False


# -- iledclock/show --------------------------------------------------------------------------


async def test_ws_show_uploads_through_fake_transport(hass, hass_ws_client, config_entry, clock: FakeClockDevice) -> None:
    clock.written.clear()
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/show",
            "entry_id": config_entry.entry_id,
            "item": {"spec": {"type": "text", "text": "HI"}},
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    assert response["result"] == {}

    assert len(clock.uploads) == 1
    start_payload, chunk_payloads = clock.uploads[0]
    assert start_payload[0] == 0x02
    assert len(chunk_payloads) >= 1
    assert all(payload[0] == 0x03 for payload in chunk_payloads)


async def test_ws_show_invalid_item_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/show",
            "entry_id": config_entry.entry_id,
            "item": {"spec": {"type": "text"}},  # missing required "text"
        }
    )
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "show_failed"


# -- iledclock/playlist/* ----------------------------------------------------------------------


async def test_ws_playlist_get_set_round_trip(hass, hass_ws_client, config_entry, clock: FakeClockDevice) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/playlist/get", "entry_id": config_entry.entry_id})
    response = await client.receive_json()
    assert response["success"] is True
    assert response["result"] == {"playlist": []}

    clock.written.clear()
    await client.send_json_auto_id(
        {
            "type": "iledclock/playlist/set",
            "entry_id": config_entry.entry_id,
            "playlist": [{"kind": "text", "params": {"text": "HELLO"}, "duration_s": 5}],
        }
    )
    response = await client.receive_json()
    assert response["success"] is True

    await client.send_json_auto_id({"type": "iledclock/playlist/get", "entry_id": config_entry.entry_id})
    response = await client.receive_json()
    assert response["result"]["playlist"] == [{"kind": "text", "params": {"text": "HELLO"}, "duration_s": 5}]
    assert len(clock.uploads) == 1


async def test_ws_playlist_set_invalid_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/playlist/set",
            "entry_id": config_entry.entry_id,
            "playlist": [{"kind": "not-a-real-kind", "params": {}, "duration_s": 5}],
        }
    )
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "invalid_playlist"


# -- iledclock/command -----------------------------------------------------------------------


async def test_ws_command_power_passthrough(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/command",
            "entry_id": config_entry.entry_id,
            "command": "power",
            "params": {"on": False},
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    assert config_entry.runtime_data.data.power is False


async def test_ws_command_night_mode_set_maps_ws_field_names(hass, hass_ws_client, config_entry, clock: FakeClockDevice) -> None:
    """`iledclock/command`'s `night_mode_set` uses its own short field names
    (`start_h`/`start_m`/`end_h`/`end_m`/`device_off`/`wake_minutes`/`voice`), distinct from
    the `night_mode` *service*'s long names -- exercise that mapping directly."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/command",
            "entry_id": config_entry.entry_id,
            "command": "night_mode_set",
            "params": {
                "enabled": True,
                "start_h": 22,
                "start_m": 30,
                "end_h": 7,
                "end_m": 0,
                "device_off": True,
                "brightness": 10,
                "wake_minutes": 15,
                "voice": True,
                "voice_sensitivity": 3,
            },
        }
    )
    response = await client.receive_json()
    assert response["success"] is True

    # The fake clock always answers a follow-up `night_mode_get` with its one canned live
    # reply, so read the *write* back to prove the field mapping instead of the read-back.
    written = clock.last_request(0x14, 0x01)
    assert written is not None
    assert written == bytes((0x14, 0x01, 1, 22, 30, 7, 0, 1, 10, 15, 1, 3))


async def test_ws_command_unknown_command_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/command",
            "entry_id": config_entry.entry_id,
            "command": "not-a-real-command",
            "params": {},
        }
    )
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "command_failed"
