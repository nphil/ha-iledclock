"""Screens A and B: which content each takes (the capability flags are read live), what a screen-B upload looks
like on the wire, the per-screen record that survives a restart, and what is put back on screen A when a timed
message runs out."""

from __future__ import annotations

import asyncio
import base64
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from custom_components.iledclock import hardware
from custom_components.iledclock.const import CONTENT_CLASSES, SLOT_A, SLOT_B
from custom_components.iledclock.coordinator import IledClockCoordinator, _show_spec_from_descriptor
from custom_components.iledclock.designs import validate_design_payload
from custom_components.iledclock.playlist import PlaylistItem
from custom_components.iledclock.program_builder import (
    ProgramBuildError,
    build_programs,
    build_slot_b_program,
    program_screen,
    show_content_class,
)
from custom_components.iledclock.protocol.models import Frame
from custom_components.iledclock.protocol.programs import (
    AnimationContent,
    ClockContent,
    DateContent,
    GraffitiContent,
    HumidityContent,
    TemperatureContent,
    plan_upload,
)
from custom_components.iledclock.slot_store import IledClockSlotStore
from custom_components.iledclock.store import PLAYLIST_FORMAT, IledClockPlaylistStore
from custom_components.iledclock.slots import (
    SlotUnsupportedError,
    content_class_of,
    descriptor_slot,
    require_screen_a_for_timed_show,
    require_slot_accepts,
    slot_accepts,
    upgrade_descriptor,
    wire_kind,
)


FRAME = base64.b64encode(bytes(32 * 16 * 3)).decode()
TIMERS_REASON = "Timers and scoreboards only work on screen A."
PICTURES_REASON = "Screen B only takes clock, date and temperature pages for now; pictures go on screen A."


def design(**extra):
    return validate_design_payload({"name": "icon", "kind": "image", "frames": [FRAME], **extra})


def start_frame(program):
    """The start frame of a one-program upload: index 0 of 1, as every show is sent."""
    return plan_upload(program, 0, 1, 1024).start


def trailer(program) -> bytes:
    """Kind byte, flag byte and the four-byte number: the end of the start frame (bytes 20-25)."""
    return start_frame(program)[20:26]


class ContentClassTest(unittest.TestCase):
    def test_every_show_type_has_a_class_the_ui_also_knows(self) -> None:
        expected = {
            "clock": "clock", "date": "date", "temperature": "temperature", "humidity": "humidity",
            "timer": "timer", "scoreboard": "scoreboard", "text": "art", "image": "art", "generative": "art",
        }
        for show_type, content_class in expected.items():
            self.assertEqual(content_class_of(show_type), content_class)
            self.assertIn(content_class, CONTENT_CLASSES)

    def test_a_design_with_a_clock_beside_its_art_is_its_own_class(self) -> None:
        self.assertEqual(content_class_of("design"), "art")
        self.assertEqual(content_class_of("design", has_clock_region=True), "art_clock")
        plain, with_clock = design(), design(clock_region={"x": 16, "y": 0, "w": 16, "h": 16})
        designs = {plain.id: plain, with_clock.id: with_clock}
        self.assertEqual(show_content_class("design", {"design_id": plain.id}, designs), "art")
        self.assertEqual(show_content_class("design", {"design_id": with_clock.id}, designs), "art_clock")

    def test_unknown_things_are_refused(self) -> None:
        for bad in ("hologram", None, ["clock"]):
            with self.assertRaises(ValueError, msg=bad):
                content_class_of(bad)
        with self.assertRaises(ProgramBuildError):
            show_content_class("design", {"design_id": "gone"}, {})


class ScreenPolicyTest(unittest.TestCase):
    def test_screen_a_takes_everything(self) -> None:
        self.assertEqual(slot_accepts(SLOT_A), CONTENT_CLASSES)

    def test_screen_b_takes_clock_pages_art_with_a_clock_and_plain_art(self) -> None:
        self.assertEqual(slot_accepts(SLOT_B), ("clock", "date", "temperature", "humidity", "art_clock", "art"))

    def test_flipping_the_art_flag_closes_screen_b_to_pictures_and_back(self) -> None:
        self.assertIn("art", slot_accepts(SLOT_B))
        require_slot_accepts(SLOT_B, "art")
        with patch.object(hardware, "SLOT_B_ACCEPTS_ART", False):
            self.assertNotIn("art", slot_accepts(SLOT_B))
            with self.assertRaises(SlotUnsupportedError) as caught:
                require_slot_accepts(SLOT_B, "art")
            self.assertEqual(str(caught.exception), PICTURES_REASON)
        require_slot_accepts(SLOT_B, "art")

    def test_flipping_the_clock_art_flag_closes_screen_b_to_art_with_a_clock(self) -> None:
        with patch.object(hardware, "SLOT_B_ACCEPTS_ART_WITH_CLOCK", False):
            with self.assertRaises(SlotUnsupportedError):
                require_slot_accepts(SLOT_B, "art_clock")

    def test_timers_and_scoreboards_never_go_to_screen_b(self) -> None:
        for art_flag in (True, False):
            with patch.object(hardware, "SLOT_B_ACCEPTS_ART", art_flag):
                for content_class in ("timer", "scoreboard"):
                    with self.assertRaises(SlotUnsupportedError) as caught:
                        require_slot_accepts(SLOT_B, content_class)
                    self.assertEqual(str(caught.exception), TIMERS_REASON)

    def test_a_message_that_goes_away_by_itself_needs_screen_a(self) -> None:
        require_screen_a_for_timed_show(SLOT_A)
        with self.assertRaises(SlotUnsupportedError) as caught:
            require_screen_a_for_timed_show(SLOT_B)
        self.assertIn("screen A", str(caught.exception))

    def test_each_screen_has_its_wire_kind(self) -> None:
        self.assertEqual((wire_kind(SLOT_A), wire_kind(SLOT_B)), (0, 4))
        with self.assertRaises(ValueError):
            wire_kind("c")


class ScreenBProgramTest(unittest.TestCase):
    """What goes to the clock-page store: one standalone page, start-frame kind 04, never in the program list."""

    def _check_page(self, program, program_type: int, number: int) -> None:
        self.assertEqual(program.resolved_program_type(), program_type)
        self.assertFalse(program.is_clock_in_list)
        self.assertEqual(start_frame(program)[9:11], bytes([0, 1]))  # index 0 of 1
        self.assertEqual(trailer(program), bytes([4, 1]) + number.to_bytes(4, "big"))

    def test_a_clock_is_a_background_and_a_clock_with_the_vendors_ten_second_trailer(self) -> None:
        program = build_slot_b_program("clock", {"style": 1, "color": 6}, designs={})
        self.assertIsInstance(program.contents[0], AnimationContent)
        self.assertIsInstance(program.contents[-1], ClockContent)
        self._check_page(program, 7, 10)

    def test_a_plain_clock_without_its_background_is_just_the_clock(self) -> None:
        program = build_slot_b_program("clock", {"style": 1, "color": 6, "background": False}, designs={})
        self.assertEqual([type(c) for c in program.contents], [ClockContent])
        self._check_page(program, 7, 10)

    def test_a_date_is_a_background_and_a_date_with_the_five_second_trailer(self) -> None:
        program = build_slot_b_program("date", {"color": 6}, designs={})
        self.assertIsInstance(program.contents[-1], DateContent)
        self._check_page(program, 6, 5)

    def test_temperature_and_humidity_are_one_page_whichever_you_ask_for(self) -> None:
        by_temperature = build_slot_b_program("temperature", {}, designs={})
        by_humidity = build_slot_b_program("humidity", {}, designs={})
        self.assertEqual([type(c) for c in by_temperature.contents], [TemperatureContent, HumidityContent])
        self.assertEqual(by_temperature, by_humidity)
        self._check_page(by_temperature, 19, 5)

    def test_a_colour_asked_for_paints_both_numbers(self) -> None:
        program = build_slot_b_program("temperature", {"color": [10, 200, 30]}, designs={})
        self.assertEqual({c.color for c in program.contents}, {(10, 200, 30)})

    def test_a_design_with_a_clock_is_the_vendors_art_plus_clock_page(self) -> None:
        icon = design(clock_region={"x": 16, "y": 0, "w": 16, "h": 16})
        program = build_slot_b_program("design", {"design_id": icon.id}, designs={icon.id: icon})
        self.assertEqual([type(c) for c in program.contents], [GraffitiContent, ClockContent])
        self._check_page(program, 7, 10)
        # the same design on screen A is part of the program list instead
        on_a = build_programs([PlaylistItem("design", {"design_id": icon.id}, 10)], designs={icon.id: icon})[0]
        self.assertTrue(on_a.is_clock_in_list)
        self.assertEqual(start_frame(on_a)[20], 0)

    def test_pictures_are_refused_before_anything_is_built_while_the_art_flag_is_off(self) -> None:
        plain = design()
        with patch.object(hardware, "SLOT_B_ACCEPTS_ART", False):
            for kind, params in (("text", {"text": "HI"}), ("design", {"design_id": plain.id})):
                with self.assertRaises(SlotUnsupportedError, msg=kind) as caught:
                    build_slot_b_program(kind, params, designs={plain.id: plain})
                self.assertEqual(str(caught.exception), PICTURES_REASON)

    def test_by_default_pictures_become_a_type_7_page(self) -> None:
        plain = design()
        for kind, params in (("text", {"text": "HI"}), ("design", {"design_id": plain.id})):
            program = build_slot_b_program(kind, params, designs={plain.id: plain})
            self.assertIsInstance(program.contents[0], GraffitiContent)
            self._check_page(program, 7, 10)
        art = GraffitiContent(start_column=0, start_row=0, show_width=32, show_height=16, pixels=Frame.blank())
        rendered = build_slot_b_program("image", {}, designs={}, art=art)
        self.assertEqual(rendered.contents, [art])
        self._check_page(rendered, 7, 10)

    def test_timers_and_scoreboards_are_refused_whatever_the_art_flag_says(self) -> None:
        for art_flag in (True, False):
            with patch.object(hardware, "SLOT_B_ACCEPTS_ART", art_flag):
                for kind, params in (("timer", {"mode": "countdown"}), ("scoreboard", {})):
                    with self.assertRaises(SlotUnsupportedError, msg=kind):
                        build_slot_b_program(kind, params, designs={})

    def test_an_unknown_design_or_type_is_a_build_error(self) -> None:
        with self.assertRaises(ProgramBuildError):
            build_slot_b_program("design", {"design_id": "gone"}, designs={})
        with self.assertRaises(ProgramBuildError):
            build_slot_b_program("hologram", {}, designs={})

    def test_screen_a_shows_keep_their_program_list_trailer(self) -> None:
        text = build_programs([PlaylistItem("text", {"text": "HI"}, 7)], designs={})[0]
        self.assertEqual(trailer(text), bytes([0, 0]) + (7).to_bytes(4, "big"))
        clock = build_programs([PlaylistItem("clock", {"style": 1, "color": 6}, 10)], designs={})[0]
        self.assertEqual(trailer(clock), bytes([0, 1]) + (50).to_bytes(4, "big"))


class WhichScreenAProgramLandsInTest(unittest.TestCase):
    """The clock files an upload by the kind byte of its start frame, and a program's type decides that byte. A date
    is encoded for the clock-page store whichever screen was asked for (proven live), so `program_screen` has to
    agree with the real start frame for every kind of program."""

    def _programs(self):
        icon = design(clock_region={"x": 16, "y": 0, "w": 16, "h": 16})
        designs = {icon.id: icon}
        on_a = lambda kind, **params: build_programs([PlaylistItem(kind, params, 10)], designs=designs)[0]  # noqa: E731
        return {
            "text on A": on_a("text", text="HI"),
            "clock on A": on_a("clock", style=1, color=6),
            "date on A": on_a("date", color=6),
            "temperature on A": on_a("temperature"),
            "humidity on A": on_a("humidity"),
            "timer on A": on_a("timer", mode="countdown"),
            "scoreboard on A": on_a("scoreboard"),
            "icon with clock on A": on_a("design", design_id=icon.id),
            "clock on B": build_slot_b_program("clock", {"style": 1, "color": 6}, designs=designs),
            "date on B": build_slot_b_program("date", {"color": 6}, designs=designs),
            "temperature page on B": build_slot_b_program("temperature", {}, designs=designs),
            "icon with clock on B": build_slot_b_program("design", {"design_id": icon.id}, designs=designs),
        }

    def test_it_agrees_with_the_start_frame_kind_of_every_program(self) -> None:
        for name, program in self._programs().items():
            with self.subTest(name):
                self.assertEqual(program_screen(program), SLOT_B if start_frame(program)[20] == 4 else SLOT_A)

    def test_only_a_date_asked_for_screen_a_changes_screen(self) -> None:
        landing = {name: program_screen(program) for name, program in self._programs().items()}
        self.assertEqual(
            {name for name, screen in landing.items() if screen == SLOT_B},
            {"date on A", "clock on B", "date on B", "temperature page on B", "icon with clock on B"},
        )


class DescriptorTest(unittest.TestCase):
    def test_descriptors_without_a_screen_are_screen_a(self) -> None:
        self.assertEqual(descriptor_slot({"kind": "clock"}), "a")
        self.assertEqual(descriptor_slot({"kind": "clock", "slot": "b"}), "b")
        self.assertEqual(descriptor_slot({"kind": "clock", "slot": "nonsense"}), "a")

    def test_an_old_text_descriptor_loses_its_wire_speed_and_gets_the_new_effect_name(self) -> None:
        old = {"kind": "text", "text": "HI", "color_mode": 2, "speed": 230, "is_bold": True, "title": "Text · HI"}
        self.assertEqual(
            upgrade_descriptor(old),
            {"kind": "text", "text": "HI", "effect": 2, "is_bold": True, "title": "Text · HI"},
        )

    def test_descriptors_that_do_not_need_it_are_returned_untouched(self) -> None:
        current = {"kind": "text", "text": "HI", "speed": 40, "slot": "a"}  # a real playback speed: has a screen
        self.assertIs(upgrade_descriptor(current), current)
        clock = {"kind": "clock", "style": 3, "speed": 230}
        self.assertIs(upgrade_descriptor(clock), clock)

    def test_a_descriptor_is_tagged_with_its_screen_and_speaks_one_vocabulary(self) -> None:
        coordinator = object.__new__(IledClockCoordinator)
        descriptor = coordinator._descriptor_for_spec(
            "text", {"text": "HI", "bold": True, "color_mode": 4, "speed": 40}, slot="b"
        )
        self.assertEqual(
            {key: descriptor[key] for key in ("kind", "text", "is_bold", "effect", "speed", "slot", "title")},
            {"kind": "text", "text": "HI", "is_bold": True, "effect": 4, "speed": 40, "slot": "b", "title": "Text · HI"},
        )
        self.assertNotIn("bold", descriptor)
        self.assertNotIn("color_mode", descriptor)
        self.assertEqual(coordinator._descriptor_for_spec("clock", {"style": 2})["slot"], "a")

    def test_showing_a_descriptor_again_does_not_carry_its_screen_or_source(self) -> None:
        descriptor = {
            "kind": "generative", "effect": "plasma", "seconds": 5, "title": "Plasma", "slot": "b",
            "source": "playlist", "shown_at": "t",
        }
        self.assertEqual(
            _show_spec_from_descriptor(descriptor),
            {"type": "generative", "kind": "plasma", "seconds": 5, "title": "Plasma"},
        )


class MemoryStore:
    data_by_key: dict[str, dict] = {}

    def __init__(self, _hass, _version, key):
        self.key = key

    async def async_load(self):
        value = self.data_by_key.get(self.key)
        return dict(value) if value is not None else None

    async def async_save(self, value):
        self.data_by_key[self.key] = value


class SlotStoreTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        MemoryStore.data_by_key = {}
        patcher = patch("custom_components.iledclock.slot_store.Store", MemoryStore)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def _record(self, store, slot, title="Text · HI", programs=1):
        descriptor = {"kind": "text", "text": "HI", "title": title, "slot": slot}
        return await store.async_record(slot, title=title, descriptor=descriptor, programs=programs, crc="0badf00d", length=88)

    async def test_nothing_is_known_before_the_first_write(self) -> None:
        store = IledClockSlotStore(None, "clock")
        await store.async_load()
        self.assertEqual(store.json(), {"a": None, "b": None, "last_written": None})
        self.assertIsNone(store.record("a"))

    async def test_a_record_survives_a_restart_and_the_studio_does_not_get_crc_or_length(self) -> None:
        store = IledClockSlotStore(None, "clock")
        await store.async_load()
        await self._record(store, "a", programs=3)
        await self._record(store, "b", title="Clock · style 1")

        reloaded = IledClockSlotStore(None, "clock")
        await reloaded.async_load()
        shown = reloaded.json()

        self.assertEqual(shown["last_written"], "b")
        self.assertEqual(
            set(shown["a"]), {"title", "descriptor", "wire_kind", "programs", "written_at"}
        )
        self.assertEqual((shown["a"]["programs"], shown["a"]["wire_kind"], shown["b"]["wire_kind"]), (3, 0, 4))
        self.assertEqual(shown["a"]["descriptor"]["text"], "HI")
        self.assertEqual((reloaded.record("a")["crc"], reloaded.record("a")["length"]), ("0badf00d", 88))  # kept in storage

    async def test_writing_one_screen_leaves_the_other_alone(self) -> None:
        store = IledClockSlotStore(None, "clock")
        await store.async_load()
        first = await self._record(store, "a")
        await self._record(store, "b")
        self.assertEqual(store.record("a"), first)
        self.assertEqual(store.last_written, "b")

    async def test_records_are_copies_so_callers_cannot_change_them(self) -> None:
        store = IledClockSlotStore(None, "clock")
        await store.async_load()
        await self._record(store, "a")
        store.record("a")["descriptor"]["text"] = "CHANGED"
        store.json()["a"]["descriptor"]["text"] = "CHANGED"
        self.assertEqual(store.record("a")["descriptor"]["text"], "HI")

    async def test_damaged_storage_is_ignored_not_fatal(self) -> None:
        store = IledClockSlotStore(None, "clock")
        MemoryStore.data_by_key[store._store.key] = {
            "a": {"title": "ok", "descriptor": "not a dict", "programs": 2, "written_at": "t", "wire_kind": 99},
            "b": {"title": 5, "programs": "many"},
            "last_written": "b",
        }
        await store.async_load()
        self.assertEqual(store.json()["a"]["programs"], 2)
        self.assertIsNone(store.json()["a"]["descriptor"])
        self.assertEqual(store.json()["a"]["wire_kind"], 0)  # the screen decides, not the file
        self.assertIsNone(store.json()["b"])
        self.assertIsNone(store.last_written)  # it named a screen that has no record


class StoredPlaylistTest(unittest.IsolatedAsyncioTestCase):
    """A playlist saved before text was drawn as pixels holds the clock's own 0-255 text speed (230, ...). The
    builder rightly refuses that as a playback speed, so loading has to bring the item up to date: otherwise the
    stored playlist could never be uploaded again (after a restart, or when a timed message ends)."""

    def setUp(self) -> None:
        MemoryStore.data_by_key = {}
        patcher = patch("custom_components.iledclock.store.Store", MemoryStore)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_an_old_text_item_loads_in_todays_words_and_can_be_uploaded_again(self) -> None:
        store = IledClockPlaylistStore(None, "clock")
        MemoryStore.data_by_key[store._store.key] = {"playlist": [
            {"kind": "text", "params": {"text": "OLD", "speed": 230, "color_mode": 2, "is_bold": True}, "duration_s": 7},
            {"kind": "text", "params": {"text": "SLOW", "speed": 60}, "duration_s": 5},
            {"kind": "design", "params": {"design_id": "art", "speed": 40}, "duration_s": 5},
        ]}

        await store.async_load()

        old, slow, art = store.playlist
        self.assertEqual(old.params, {"text": "OLD", "effect": 2, "is_bold": True})
        self.assertEqual(slow.params, {"text": "SLOW"})  # 60 on the old scale is not a playback speed of 60
        self.assertEqual(art.params, {"design_id": "art", "speed": 40})  # only text items change
        build_programs([old, slow], designs={})  # a speed of 230 made this raise
        saved = MemoryStore.data_by_key[store._store.key]  # the result was kept, and the file marked as current
        self.assertEqual(saved["format"], PLAYLIST_FORMAT)
        self.assertEqual(saved["playlist"][0]["params"], {"text": "OLD", "effect": 2, "is_bold": True})

    async def test_a_playlist_saved_by_todays_code_keeps_its_playback_speed(self) -> None:
        store = IledClockPlaylistStore(None, "clock")
        await store.async_load()
        item = PlaylistItem("text", {"text": "NEW", "speed": 40, "smooth": "on", "effect": "2"}, 5)
        await store.async_set_playlist([item])

        reloaded = IledClockPlaylistStore(None, "clock")
        await reloaded.async_load()

        self.assertEqual(reloaded.playlist, [item])


class RestoreAfterTimedShowTest(unittest.IsolatedAsyncioTestCase):
    """`_saved_playlist` is None when nothing is pending and [] when a timed message started while there was no
    playlist. The old code tested it for truthiness, so [] meant "nothing to restore" and the message stayed."""

    BEFORE = {"kind": "text", "text": "BEFORE", "title": "Text · BEFORE", "slot": "a", "shown_at": "t"}

    def _port(self, saved, earlier):
        class Port:
            def __init__(self) -> None:
                self._show_lock = asyncio.Lock()
                self._restore_generation = 1
                self._restore_unsub = object()
                self._saved_playlist = saved
                self._saved_screen_a = earlier
                self.design_library = SimpleNamespace(get_design=lambda design_id: None)
                self.uploaded: list = []
                self.shown: list = []

            async def _async_upload_playlist_locked(self, items, *, record_showing=False):
                self.uploaded.append((items, record_showing))

            async def _async_show_locked(self, spec, *, slot="a", restore_after_s=None):
                self.shown.append((spec, slot))

        return Port()

    async def _expire(self, port) -> None:
        await IledClockCoordinator._async_restore_playlist(port, None, generation=1)

    async def test_with_no_playlist_what_screen_a_held_before_comes_back(self) -> None:
        port = self._port([], {"descriptor": self.BEFORE})
        await self._expire(port)
        self.assertEqual(port.shown, [({"type": "text", "text": "BEFORE", "title": "Text · BEFORE"}, "a")])
        self.assertEqual(port.uploaded, [])
        self.assertEqual((port._saved_playlist, port._saved_screen_a), (None, None))

    async def test_a_playlist_is_put_back_in_preference(self) -> None:
        items = [PlaylistItem("clock", {"style": 1}, 10)]
        port = self._port(items, {"descriptor": self.BEFORE})
        await self._expire(port)
        self.assertEqual(port.uploaded, [(items, True)])
        self.assertEqual(port.shown, [])

    async def test_nothing_pending_means_nothing_is_sent(self) -> None:
        port = self._port(None, {"descriptor": self.BEFORE})
        await self._expire(port)
        self.assertEqual((port.uploaded, port.shown), ([], []))

    async def test_with_no_playlist_and_nothing_known_nothing_is_sent(self) -> None:
        for earlier in (None, {"descriptor": None}):
            port = self._port([], earlier)
            await self._expire(port)
            self.assertEqual((port.uploaded, port.shown), ([], []), earlier)

    async def test_a_playlist_record_cannot_be_rebuilt_without_the_playlist(self) -> None:
        port = self._port([], {"descriptor": {**self.BEFORE, "source": "playlist"}})
        await self._expire(port)
        self.assertEqual((port.uploaded, port.shown), ([], []))

    async def test_a_deleted_design_is_not_brought_back(self) -> None:
        gone = {"kind": "design", "design_id": "gone", "title": "Gone", "slot": "a", "shown_at": "t"}
        port = self._port([], {"descriptor": gone})
        await self._expire(port)
        self.assertEqual(port.shown, [])


if __name__ == "__main__":
    unittest.main()
