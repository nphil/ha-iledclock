"""Show ordering and persisted image-frame contracts."""

from __future__ import annotations

import asyncio
import base64
import unittest

from custom_components.iledclock.const import DISPLAY_HEIGHT, DISPLAY_WIDTH
from custom_components.iledclock.coordinator import IledClockCoordinator
from custom_components.iledclock.program_builder import ProgramBuildError


class ShowDescriptorTests(unittest.TestCase):
    def test_image_frames_round_trip_as_bounded_rgb_pixels(self) -> None:
        pixels = bytes((12, 120, 240)) * (DISPLAY_WIDTH * DISPLAY_HEIGHT)
        encoded = base64.b64encode(pixels).decode("ascii")

        frames = IledClockCoordinator._frames_from_descriptor({"frames": [encoded], "delays": [250]})

        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].pixels[0][0], (12, 120, 240))
        self.assertEqual(frames[0].pixels[-1][-1], (12, 120, 240))
        self.assertEqual(frames[0].duration_ms, 250)

    def test_image_frame_descriptor_rejects_unbounded_or_malformed_content(self) -> None:
        with self.assertRaises(ProgramBuildError):
            IledClockCoordinator._frames_from_descriptor({"frames": []})
        with self.assertRaises(ProgramBuildError):
            IledClockCoordinator._frames_from_descriptor({"frames": ["A"]})
        with self.assertRaises(ProgramBuildError):
            IledClockCoordinator._frames_from_descriptor({"frames": ["A"] * 65})

    def test_image_show_descriptor_never_contains_source_url_or_base64(self) -> None:
        coordinator = object.__new__(IledClockCoordinator)
        descriptor = coordinator._descriptor_for_spec(
            "image",
            {
                "title": "Artwork",
                "url": "https://example.invalid/source.png",
                "data_b64": "private-source",
                "frames": ["rendered-frame"],
                "delays": [100],
            },
        )

        self.assertEqual(descriptor["frames"], ["rendered-frame"])
        self.assertNotIn("data_b64", descriptor)
        self.assertNotIn("url", descriptor)


class ShowOrderingTests(unittest.IsolatedAsyncioTestCase):
    async def test_show_lock_covers_complete_upload_and_history_transaction(self) -> None:
        class CoordinatorPort:
            def __init__(self) -> None:
                self._show_lock = asyncio.Lock()
                self.first_entered = asyncio.Event()
                self.release_first = asyncio.Event()
                self.second_entered = asyncio.Event()
                self.active = 0
                self.max_active = 0
                self.order: list[str] = []

            async def _async_show_locked(self, spec, *, restore_after_s=None):
                label = spec["label"]
                self.active += 1
                self.max_active = max(self.max_active, self.active)
                self.order.append("start " + label)
                try:
                    if label == "first":
                        self.first_entered.set()
                        await self.release_first.wait()
                    else:
                        self.second_entered.set()
                    self.order.append("finish " + label)
                    return {"label": label}
                finally:
                    self.active -= 1

        coordinator = CoordinatorPort()
        first = asyncio.create_task(IledClockCoordinator.async_show(coordinator, {"label": "first"}))
        await coordinator.first_entered.wait()
        second = asyncio.create_task(IledClockCoordinator.async_show(coordinator, {"label": "second"}))
        await asyncio.sleep(0)
        self.assertFalse(coordinator.second_entered.is_set())

        coordinator.release_first.set()
        self.assertEqual(await asyncio.gather(first, second), [{"label": "first"}, {"label": "second"}])
        self.assertEqual(coordinator.max_active, 1)
        self.assertEqual(coordinator.order, ["start first", "finish first", "start second", "finish second"])
    async def test_stale_timed_restore_cannot_replace_newer_show(self) -> None:
        class CoordinatorPort:
            def __init__(self) -> None:
                self._show_lock = asyncio.Lock()
                self._restore_generation = 4
                self._restore_unsub = object()
                self._saved_playlist = ["newer playlist"]
                self.uploaded: list[list[str]] = []

            async def _async_upload_playlist_locked(self, items, *, record_showing=False):
                self.uploaded.append(items)

        coordinator = CoordinatorPort()
        await IledClockCoordinator._async_restore_playlist(coordinator, None, generation=3)

        self.assertEqual(coordinator._saved_playlist, ["newer playlist"])
        self.assertIsNotNone(coordinator._restore_unsub)
        self.assertEqual(coordinator.uploaded, [])
