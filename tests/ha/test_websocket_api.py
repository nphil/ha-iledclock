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


async def test_ws_render_clock_is_pixel_accurate_not_approximate(hass, hass_ws_client, config_entry) -> None:
    """Regression: this used to render a generic '12:34' text placeholder and always report
    `approximate: true`; it now uses the vendor's real per-style digit glyphs and background."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/render",
            "entry_id": config_entry.entry_id,
            "spec": {"type": "clock", "style": 24, "color": [255, 255, 255], "h24": True},
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    result = response["result"]
    assert "approximate" not in result
    assert len(result["frames"]) >= 1
    assert len(result["delays"]) == len(result["frames"])
    for frame_b64 in result["frames"]:
        assert len(base64.b64decode(frame_b64)) == _FRAME_BYTES

    await client.send_json_auto_id(
        {
            "type": "iledclock/render",
            "entry_id": config_entry.entry_id,
            "spec": {"type": "clock", "style": 999, "color": [255, 255, 255], "h24": True},
        }
    )
    response = await client.receive_json()
    assert response["success"] is False


async def test_ws_render_design_paints_live_clock_into_its_region(hass, hass_ws_client, config_entry) -> None:
    """An "Icon with clock" design shows art left of its clock region and a firmware clock inside
    it; the preview must draw that clock (it used to leave the region blank), and never let the
    art bleed into the region."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/designs/save",
            "design": {
                "name": "Art + clock", "kind": "animation",
                "frames": [_solid_frame_b64((255, 0, 0)), _solid_frame_b64((0, 0, 255))],
                "delays": [100, 100], "clock_region": [16, 0, 16, 16],
            },
        }
    )
    saved = await client.receive_json()
    assert saved["success"] is True, saved
    await client.send_json_auto_id(
        {
            "type": "iledclock/render",
            "entry_id": config_entry.entry_id,
            "spec": {"type": "design", "design_id": saved["result"]["id"], "color": [0, 255, 0]},
        }
    )
    response = await client.receive_json()
    assert response["success"] is True, response
    frames = [base64.b64decode(f) for f in response["result"]["frames"]]
    assert len(frames) == 2

    def px(frame: bytes, x: int, y: int) -> tuple[int, int, int]:
        i = (y * 32 + x) * 3
        return tuple(frame[i : i + 3])

    for frame, art in zip(frames, ((255, 0, 0), (0, 0, 255))):
        assert px(frame, 0, 0) == art and px(frame, 15, 15) == art
        region = {px(frame, x, y) for x in range(16, 32) for y in range(16)}
        assert art not in region
        assert (0, 255, 0) in region  # clock digits in the requested colour


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
    descriptor = response["result"]["now_showing"]
    assert descriptor["kind"] == "text"
    assert descriptor["text"] == "HI"
    assert descriptor["title"] == "Text · HI"
    assert descriptor["shown_at"]

    state_client = await hass_ws_client(hass)
    await state_client.send_json_auto_id({"type": "iledclock/state", "entry_id": config_entry.entry_id})
    state = (await state_client.receive_json())["result"]
    assert state["now_showing"] == descriptor
    assert state["history"] == [descriptor]

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


async def test_ws_show_restore_previous_and_nothing_to_restore(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)

    async def show(text: str) -> dict:
        await client.send_json_auto_id({"type": "iledclock/show", "entry_id": config_entry.entry_id, "item": {"spec": {"type": "text", "text": text}}})
        return await client.receive_json()

    first = await show("FIRST")
    assert first["success"] is True
    second = await show("SECOND")
    assert second["success"] is True
    assert second["result"]["now_showing"]["text"] == "SECOND"

    await client.send_json_auto_id({"type": "iledclock/show", "entry_id": config_entry.entry_id, "item": {"restore": "previous"}})
    restored = await client.receive_json()
    assert restored["success"] is True
    assert restored["result"]["now_showing"]["text"] == "FIRST"

    state_client = await hass_ws_client(hass)
    await state_client.send_json_auto_id({"type": "iledclock/state", "entry_id": config_entry.entry_id})
    state = (await state_client.receive_json())["result"]
    assert state["now_showing"] == restored["result"]["now_showing"]
    assert state["history"][0]["text"] == "FIRST"
    assert state["history"][1]["text"] == "SECOND"


async def test_generative_show_descriptor_restores_without_kind_collision(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)

    async def show(item: dict) -> dict:
        await client.send_json_auto_id({"type": "iledclock/show", "entry_id": config_entry.entry_id, "item": item})
        return await client.receive_json()

    generative = await show({"spec": {"type": "generative", "kind": "plasma", "seconds": 1}})
    assert generative["success"] is True
    assert generative["result"]["now_showing"]["kind"] == "generative"
    assert generative["result"]["now_showing"]["effect"] == "plasma"
    assert (await show({"spec": {"type": "text", "text": "NEXT"}}))["success"] is True

    restored = await show({"restore": "previous"})
    assert restored["success"] is True
    assert restored["result"]["now_showing"]["kind"] == "generative"
    assert restored["result"]["now_showing"]["effect"] == "plasma"


async def test_deleted_design_is_marked_and_skipped_by_undo(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)

    async def send(message: dict) -> dict:
        await client.send_json_auto_id(message)
        return await client.receive_json()

    base = {"type": "iledclock/show", "entry_id": config_entry.entry_id}
    assert (await send({**base, "item": {"spec": {"type": "text", "text": "KEEP"}}}))["success"]
    saved = await send({"type": "iledclock/designs/save", "design": {"name": "Soon Deleted", "kind": "image", "frames": [_solid_frame_b64()]}})
    design_id = saved["result"]["id"]
    assert (await send({**base, "item": {"design_id": design_id}}))["success"]
    assert (await send({**base, "item": {"spec": {"type": "text", "text": "LATEST"}}}))["success"]

    assert (await send({"type": "iledclock/designs/delete", "design_id": design_id}))["success"]
    state = await send({"type": "iledclock/state", "entry_id": config_entry.entry_id})
    design_entry = next(item for item in state["result"]["history"] if item.get("design_id") == design_id)
    assert design_entry["unavailable"] is True

    restored = await send({**base, "item": {"restore": "previous"}})
    assert restored["success"] is True
    assert restored["result"]["now_showing"]["text"] == "KEEP"


async def test_ws_show_restore_without_history_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/show", "entry_id": config_entry.entry_id, "item": {"restore": "previous"}})
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "nothing_to_restore"


async def test_ws_subscribe_pushes_chunk_progress_and_clears_upload(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/subscribe", "entry_id": config_entry.entry_id})
    assert (await client.receive_json())["success"] is True

    show_client = await hass_ws_client(hass)
    await show_client.send_json_auto_id({"type": "iledclock/show", "entry_id": config_entry.entry_id, "item": {"spec": {"type": "text", "text": "PROGRESS"}}})
    assert (await show_client.receive_json())["success"] is True

    events = []
    for _ in range(20):
        message = await client.receive_json()
        if message.get("type") == "event":
            events.append(message["event"])
            if message["event"].get("upload") is None:
                break
    progress = [event["upload"] for event in events if isinstance(event.get("upload"), dict)]
    assert progress
    assert all(set(item) == {"done", "total"} for item in progress)
    assert any(event.get("upload") is None for event in events)


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
    # ..., brightness, voice, wake, sensitivity (vendor call site; confirmed on the live clock)
    assert written == bytes((0x14, 0x01, 1, 22, 30, 7, 0, 1, 10, 1, 15, 3))


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
