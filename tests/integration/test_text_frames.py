"""Text is drawn to pixel frames and uploaded as ordinary picture content (the clock's own text engine drew
nothing -- BlankText report). What the drawing promises: how many frames, how fast they move, what the effects,
bold and speed do, and that the colours reach the clock as asked."""

from __future__ import annotations

import colorsys
import unittest

from custom_components.iledclock import hardware, retime
from custom_components.iledclock.const import TEXT_MAX_FRAMES
from custom_components.iledclock.playlist import PlaylistItem
from custom_components.iledclock.program_builder import (
    ProgramBuildError,
    build_programs,
    parse_text_spec,
    poster_frame,
    text_playback_frames,
)
from custom_components.iledclock.protocol import hexutil, render
from custom_components.iledclock.protocol.fonts import get_font
from custom_components.iledclock.protocol.models import Frame
from custom_components.iledclock.protocol.programs import (
    AnimationContent,
    GraffitiContent,
    TextContent,
    encode_content,
    plan_upload,
)

MS_PER_PX = 42  # 23.8 px/s, "about 24 px/s"
BLACK = (0, 0, 0)


def lit(frame: Frame) -> set[tuple[int, int]]:
    return {(x, y) for y, row in enumerate(frame.pixels) for x, pixel in enumerate(row) if pixel != BLACK}


def lit_columns(frame: Frame) -> set[int]:
    return {x for x, _ in lit(frame)}


def lit_colors(frame: Frame) -> set[tuple[int, int, int]]:
    return {pixel for row in frame.pixels for pixel in row if pixel != BLACK}


def column(frame: Frame, x: int) -> list[tuple[int, int, int]]:
    return [row[x] for row in frame.pixels]


def text_width(text: str, font: str = "5x7") -> int:
    """Columns the text takes: each glyph's own width plus one blank column between neighbours."""
    glyphs = get_font(font)
    return sum(len(glyphs[char]) for char in text) + len(text) - 1


class MarqueeTest(unittest.TestCase):
    def test_text_that_fits_is_one_centred_frame(self) -> None:
        frames = render.text_frames("HELLO")  # 29 of 32 columns
        self.assertEqual(len(frames), 1)
        self.assertEqual((min(lit_columns(frames[0])), max(lit_columns(frames[0]))), (1, 29))  # (32 - 29) // 2 = 1

    def test_wider_text_enters_at_the_right_edge_leaves_at_the_left_and_ends_on_a_blank_panel(self) -> None:
        text = "SCROLLING TEXT"
        frames = render.text_frames(text)  # no budget: one frame per pixel
        self.assertEqual(len(frames), 32 + text_width(text))
        self.assertEqual(lit_columns(frames[0]), {31})  # only the first column of the text has come in
        self.assertEqual(lit(frames[-1]), set())  # the loop ends empty: that is the gap before it starts again
        self.assertTrue(lit(frames[-2]))
        self.assertEqual(lit_columns(frames[-2]), {0})  # ... right after the last column left
        # one pixel left per frame
        for before, after in zip(frames[10:60], frames[11:61]):
            for x in range(31):
                self.assertEqual(column(after, x), column(before, x + 1))

    def test_a_frame_budget_means_bigger_steps_never_more_frames(self) -> None:
        # (letters, columns to cross, step in px, frames): D = 32 + columns, step = ceil(D / 40), frames = ceil(D / step)
        for letters, step, frames in ((7, 2, 37), (11, 3, 33), (39, 7, 38), (120, 19, 40)):
            with self.subTest(letters=letters):
                distance = 32 + text_width("W" * letters)
                self.assertEqual(step, -(-distance // 40))
                drawn = render.text_frames("W" * letters, max_frames=40)
                self.assertEqual(len(drawn), frames)
                self.assertEqual({frame.duration_ms for frame in drawn}, {step * MS_PER_PX})

    def test_the_longest_allowed_text_never_skips_a_column(self) -> None:
        for font in ("3x5", "5x7", "8x16"):
            for bold in (False, True):
                drawn = render.text_frames("W" * 120, font, bold=bold, max_frames=TEXT_MAX_FRAMES)
                step = drawn[0].duration_ms // MS_PER_PX
                self.assertLessEqual(len(drawn), TEXT_MAX_FRAMES)
                self.assertLess(step, 32, f"{font} bold={bold}: a step as wide as the panel would skip text")

    def test_one_frame_of_budget_shows_the_start_of_the_text_still(self) -> None:
        drawn = render.text_frames("W" * 20, max_frames=1)
        self.assertEqual(len(drawn), 1)
        self.assertEqual(min(lit_columns(drawn[0])), 0)
        with self.assertRaises(ValueError):
            render.text_frames("A", max_frames=0)

    def test_empty_text_is_one_blank_frame(self) -> None:
        drawn = render.text_frames("")
        self.assertEqual(len(drawn), 1)
        self.assertEqual(lit(drawn[0]), set())

    def test_the_old_positional_call_still_works(self) -> None:
        frames = render.text_frames("HI", "5x7", (255, 0, 0))
        self.assertEqual((len(frames), lit_colors(frames[0])), (1, {(255, 0, 0)}))


class EffectTest(unittest.TestCase):
    def test_solid_draws_the_requested_colour(self) -> None:
        self.assertEqual(lit_colors(render.text_frames("AB", color=(255, 0, 0))[0]), {(255, 0, 0)})

    def test_rainbow_runs_along_the_text_from_red_to_magenta_and_scrolls_with_it(self) -> None:
        frame = render.text_frames("RAIN", effect=2)[0]
        by_column = {x: column(frame, x) for x in lit_columns(frame)}
        first, last = min(by_column), max(by_column)
        self.assertIn((255, 0, 0), by_column[first])
        self.assertIn((255, 0, 255), by_column[last])
        hues = [colorsys.rgb_to_hsv(*[c / 255 for c in next(p for p in by_column[x] if p != BLACK)])[0] for x in sorted(by_column)]
        self.assertEqual(hues, sorted(hues))  # red to magenta, never back
        self.assertGreater(len(lit_colors(frame)), 8)
        # the colours belong to the text: once it scrolls, a column keeps its colour on its way across
        wide = render.text_frames("RAINBOW COLOURS", effect=2)
        for before, after in zip(wide[5:20], wide[6:21]):
            for x in range(31):
                self.assertEqual(column(after, x), column(before, x + 1))

    def test_letter_rainbow_gives_each_letter_a_colour_and_repeats_every_six(self) -> None:
        frame = render.text_frames("1234567", "3x5", effect=4)[0]  # 27 columns, 3 per digit, origin 2
        colors = [(255, 0, 0), (255, 255, 0), (0, 255, 0), (0, 255, 255), (0, 0, 255), (255, 0, 255), (255, 0, 0)]
        for letter, expected in enumerate(colors):
            left = 2 + 4 * letter
            painted = {pixel for x in range(left, left + 3) for pixel in column(frame, x) if pixel != BLACK}
            self.assertEqual(painted, {expected}, f"letter {letter}")

    def test_the_other_colour_modes_draw_one_colour(self) -> None:
        solid = render.text_frames("MODE", color=(0, 255, 0), effect=1)
        for mode in (3, 5, 9, 28):
            self.assertEqual(render.text_frames("MODE", color=(0, 255, 0), effect=mode), solid, mode)


class BoldTest(unittest.TestCase):
    def test_bold_widens_every_letter_by_one_column_and_keeps_the_gap_between_letters(self) -> None:
        plain, bold = render.text_frames("HI")[0], render.text_frames("HI", bold=True)[0]
        span = lambda frame: max(lit_columns(frame)) - min(lit_columns(frame)) + 1  # noqa: E731
        self.assertEqual(span(bold), span(plain) + 2)
        gap = min(lit_columns(bold)) + len(get_font("5x7")["H"]) + 1  # H plus its extra column
        self.assertNotIn(gap, lit_columns(bold))

    def test_bold_is_off_by_default_because_it_costs_a_letter(self) -> None:
        self.assertEqual(len(render.text_frames("HELLO")), 1)  # five letters fit the 32 columns ...
        self.assertGreater(len(render.text_frames("HELLO", bold=True)), 1)  # ... bold ones scroll


class PanelColourTest(unittest.TestCase):
    def test_the_clock_keeps_the_level_that_was_asked_for(self) -> None:
        """Uploaded pixels are encoded with the vendor's curve; the colours drawn must come out as the same
        levels (the preview's level*17 colours would not: 102 -> level 4, not the 6 it stands for)."""
        for requested in ((255, 128, 0), (100, 150, 200), (255, 255, 255), (60, 60, 60), (200, 10, 90)):
            with self.subTest(requested=requested):
                drawn = lit_colors(render.text_frames("1", color=requested)[0])
                self.assertEqual({hexutil.rgb444_pixel(pixel) for pixel in drawn}, {hexutil.rgb444_pixel(requested)})

    def test_every_level_is_drawn_as_the_hardware_table_says(self) -> None:
        for level in range(1, 16):
            value = hardware.rgb444_representative(level)
            self.assertEqual(lit_colors(render.text_frames("1", color=(value,) * 3)[0]), {(value,) * 3}, level)


class TextPlaybackTest(unittest.TestCase):
    LONG = "THE QUICK BROWN FOX"

    def _loop_ms(self, **spec) -> float:
        return sum(frame.duration_ms for frame in text_playback_frames({"text": self.LONG, **spec}))

    def test_without_a_speed_the_text_plays_exactly_as_drawn(self) -> None:
        self.assertEqual(text_playback_frames({"text": self.LONG}), render.text_frames(self.LONG, max_frames=TEXT_MAX_FRAMES))

    def test_speed_is_the_playback_speed_every_other_show_has(self) -> None:
        self.assertEqual(len(text_playback_frames({"text": self.LONG, "speed": 0})), 1)  # Still: one picture
        self.assertEqual({f.duration_ms for f in text_playback_frames({"text": self.LONG, "speed": 100})}, {7 * 1.5})  # Max
        loops = [self._loop_ms(speed=speed) for speed in (10, 30, 60, 100)]
        self.assertEqual(loops, sorted(loops, reverse=True))  # the faster, the shorter the loop
        self.assertAlmostEqual(self._loop_ms(speed=50), 35 * 1000 / retime.pace_for_speed(50), delta=60)

    def test_the_still_picture_is_the_fullest_window_of_the_text(self) -> None:
        still = text_playback_frames({"text": self.LONG, "speed": 0})[0]
        authored = render.text_frames(self.LONG, max_frames=TEXT_MAX_FRAMES)
        self.assertEqual(len(lit(still)), max(len(lit(frame)) for frame in authored))
        self.assertEqual(lit(still), lit(poster_frame(authored)))

    def test_a_playback_speed_above_100_is_refused_so_the_old_text_speed_cannot_sneak_in(self) -> None:
        for speed in (128, 230, 255, -1, "fast"):
            with self.assertRaises(ValueError, msg=speed) as caught:
                text_playback_frames({"text": "HI", "speed": speed})
            self.assertIn("0 to 100", str(caught.exception))

    def test_both_vocabularies_mean_the_same(self) -> None:
        studio = text_playback_frames({"text": "RAIN", "bold": True, "effect": "2", "color": [1, 2, 3]})
        service = text_playback_frames({"text": "RAIN", "is_bold": True, "color_mode": 2})
        self.assertEqual(studio, service)  # the colour is ignored by the rainbow; bold, effect and colour_mode agree

    def test_mistakes_are_refused_in_plain_words(self) -> None:
        for params, fragment in (
            ({}, "text"),
            ({"text": "x" * 121}, "too long"),
            ({"text": "HI", "font": "comic"}, "font"),
            ({"text": "HI", "effect": 0}, "effect"),
            ({"text": "HI", "effect": 29}, "effect"),
            ({"text": "HI", "effect": "rainbow"}, "effect"),
            ({"text": "HI", "color": [1, 2]}, "colour"),
            ({"text": "HI", "smooth": "maybe"}, "smooth"),
        ):
            with self.subTest(params=params):
                with self.assertRaises(ValueError) as caught:
                    parse_text_spec(params)
                self.assertIn(fragment, str(caught.exception))

    def test_120_characters_is_the_longest_text_and_still_fits_the_frame_budget(self) -> None:
        frames = text_playback_frames({"text": "W" * 120})
        self.assertEqual(len(frames), TEXT_MAX_FRAMES)


class TextUploadTest(unittest.TestCase):
    def _program(self, text: str, **params):
        return build_programs([PlaylistItem(kind="text", params={"text": text, **params}, duration_s=7)], designs={})[0]

    def test_text_goes_to_the_clock_as_a_picture_never_as_native_text(self) -> None:
        short, scrolling = self._program("HI"), self._program("A LONG MESSAGE TO SCROLL")
        self.assertIsInstance(short.contents[0], GraffitiContent)
        self.assertIsInstance(scrolling.contents[0], AnimationContent)
        self.assertLessEqual(len(scrolling.contents[0].frames), TEXT_MAX_FRAMES)
        for program in (short, scrolling):
            self.assertEqual(len(program.contents), 1)
            self.assertNotIsInstance(program.contents[0], TextContent)
            tag = encode_content(program.contents[0])[4]
            self.assertIn(tag, (0x02, 0x03))  # graffiti / animation: not the glyph (01) or colour (05, 06) layers
            self.assertEqual(plan_upload(program, 0, 1, 1024).start[20], 0)  # start-frame kind 00: the program list

    def test_speed_reaches_the_uploaded_frames(self) -> None:
        fast = self._program("A LONG MESSAGE TO SCROLL", speed=100).contents[0].frames
        self.assertEqual({frame.duration_ms for frame in fast}, {7 * 1.5})
        still = self._program("A LONG MESSAGE TO SCROLL", speed=0).contents[0]
        self.assertIsInstance(still, GraffitiContent)


if __name__ == "__main__":
    unittest.main()
