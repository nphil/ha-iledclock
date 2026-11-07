"""Renaming an entity id (Settings -> Entities) on Home Assistant 2026.11 and newer.

From 2026.11 an entity whose class has its own `async_added_to_hass` is removed and added again on
a rename, unless the class opts in to in-place renames with `async_entity_id_changed`. The preview
image entity is the one such entity here; opted in, a rename must not run its add hook again.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import Entity

from custom_components.iledclock.const import DOMAIN
from custom_components.iledclock.image import IledClockDisplayImage

from .fake_clock import FakeClockDevice

pytestmark = pytest.mark.skipif(
    not hasattr(Entity, "async_entity_id_changed"),
    reason="Home Assistant before 2026.11 always removes and adds an entity again on an entity id change",
)


async def test_preview_image_keeps_its_entity_when_the_entity_id_changes(
    hass, config_entry, clock: FakeClockDevice
) -> None:
    registry = er.async_get(hass)
    old_entity_id = registry.async_get_entity_id("image", DOMAIN, f"{clock.address}_display_preview")
    assert old_entity_id is not None
    new_entity_id = "image.renamed_clock_preview"

    with patch.object(
        IledClockDisplayImage,
        "async_added_to_hass",
        autospec=True,
        side_effect=IledClockDisplayImage.async_added_to_hass,
    ) as added:
        registry.async_update_entity(old_entity_id, new_entity_id=new_entity_id)
        await hass.async_block_till_done()

    added.assert_not_called()
    assert hass.states.get(old_entity_id) is None
    state = hass.states.get(new_entity_id)
    assert state is not None
    assert "approximate" in state.attributes
