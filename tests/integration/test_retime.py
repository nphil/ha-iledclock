"""`retime.py`: the Speed slider and Smooth motion as one pure function.

What the clock plays (and the panel previews) for a design's speed and smoothing: the speed curve,
Still / Original / Max, the rhythm-preserving scaling, what counts as a slide / fade / cut, the
in-between frames themselves, the 40-frame budget and the poster frame."""

from __future__ import annotations

import json
import random
import unittest
from pathlib import Path

from custom_components.iledclock import hardware, retime

W, H = 32, 16
CURVE_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "playback-curve.json"
UNIT_MS = hardware.DEVICE_MS_PER_DELAY_UNIT


# -- Building frames --------------------------------------------------------------------------------------------------


def blank(background: tuple[int, int, int] = (0, 0, 0)) -> bytearray:
    return bytearray(bytes(background) * (W * H))


def put(frame: bytearray, x: int, y: int, color: tuple[int, int, int]) -> None:
    if 0 <= x < W and 0 <= y < H:
        frame[(y * W + x) * 3 : (y * W + x) * 3 + 3] = bytes(color)


def pixel(frame: bytes, x: int, y: int) -> tuple[int, int, int]:
    i = (y * W + x) * 3
    return frame[i], frame[i + 1], frame[i + 2]


def colours(frame: bytes) -> set[tuple[int, int, int]]:
    return set(zip(frame[0::3], frame[1::3], frame[2::3]))


def level(frame: bytes, x: int, y: int) -> tuple[int, int, int]:
    """The clock's 0-15 level of each channel for one pixel."""
    return tuple(hardware.rgb444_transfer(v) for v in pixel(frame, x, y))  # type: ignore[return-value]


def sprite(seed: int = 5, width: int = 6, height: int = 7) -> list[list[bool]]:
    rng = random.Random(seed)
    cells = [[rng.random() < 0.6 for _ in range(width)] for _ in range(height)]
    cells[0][0] = cells[height - 1][width - 1] = True
    return cells


def draw_sprite(frame: bytearray, shape: list[list[bool]], x0: int, y0: int, color=(255, 160, 0)) -> None:
    for dy, row in enumerate(shape):
        for dx, lit in enumerate(row):
            if lit:
                put(frame, x0 + dx, y0 + dy, color)


def sliding(count: int = 8, step: int = 3, y: int = 4, background=(0, 0, 0), backdrop=None) -> list[bytes]:
    """A sprite that moves `step` pixels right each frame (it never leaves the panel)."""
    shape = sprite()
    frames = []
    for k in range(count):
        frame = blank(background)
        if backdrop is not None:
            backdrop(frame)
        draw_sprite(frame, shape, 1 + step * k, y)
        frames.append(bytes(frame))
    return frames


def block(frame: bytearray, x0: int, y0: int, w: int, h: int, color: tuple[int, int, int]) -> None:
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            put(frame, x, y, color)


def levels_colour(r: int, g: int, b: int) -> tuple[int, int, int]:
    """The raw colour that is exactly these 0-15 levels on the clock."""
    return hardware.rgb444_representative(r), hardware.rgb444_representative(g), hardware.rgb444_representative(b)


def glow(levels: list[int]) -> list[bytes]:
    frames = []
    for lvl in levels:
        frame = blank()
        block(frame, 12, 4, 8, 8, levels_colour(lvl, lvl // 2, 0))
        frames.append(bytes(frame))
    return frames


def noise_frames(count: int, seed: int = 1) -> list[bytes]:
    """Frames that share nothing with each other: every step between them is a hard cut."""
    rng = random.Random(seed)
    frames = []
    for _ in range(count):
        frame = blank()
        for _ in range(60):
            put(frame, rng.randrange(W), rng.randrange(H), (rng.randrange(60, 256), rng.randrange(60, 256), rng.randrange(60, 256)))
        frames.append(bytes(frame))
    return frames


def total(delays: tuple[float, ...]) -> float:
    return sum(delays)


# -- Speed ------------------------------------------------------------------------------------------------------------


class SpeedCurveTests(unittest.TestCase):
    def test_curve_matches_the_shared_fixture(self) -> None:
        """The TypeScript slider (frontend/src/lib/playback.ts) pins the same fixture."""
        fixture = json.loads(CURVE_FIXTURE.read_text())
        self.assertAlmostEqual(hardware.PLAYBACK_MAX_FPS, fixture["max_fps"], places=5)
        self.assertEqual(hardware.PLAYBACK_MIN_FPS, fixture["min_fps"])
        for point in fixture["pace_for_speed"]:
            self.assertAlmostEqual(retime.pace_for_speed(point["speed"]), point["pace_fps"], places=5)
        for point in fixture["speed_for_pace"]:
            self.assertAlmostEqual(retime.speed_for_pace(point["pace_fps"]), point["speed"], places=4)

    def test_max_is_seven_device_units_per_frame(self) -> None:
        frames = noise_frames(4)
        result = retime.retime(frames, [100, 40, 900, 100], 100)
        self.assertEqual(set(result.delays_ms), {7 * UNIT_MS})
        self.assertAlmostEqual(result.info.pace_fps, 1000 / (7 * UNIT_MS), places=2)

    def test_original_is_the_authored_frames_and_delays_untouched(self) -> None:
        frames = sliding()
        delays = [125, 40, 300, 125, 125, 80, 125, 125]
        for smooth in (None, "on", "off"):
            result = retime.retime(frames, delays, None, smooth)
            self.assertEqual(result.frames, tuple(frames))
            self.assertEqual(result.delays_ms, tuple(float(d) for d in delays))
            self.assertEqual(result.info.added_frames, 0)

    def test_still_is_one_frame_the_fullest(self) -> None:
        sparse, full, medium = blank(), blank(), blank()
        put(sparse, 0, 0, (255, 0, 0))
        block(full, 0, 0, 6, 6, (0, 255, 0))
        block(medium, 0, 0, 3, 3, (0, 0, 255))
        result = retime.retime([bytes(sparse), bytes(full), bytes(medium)], [100, 100, 100], 0)
        self.assertEqual(result.frames, (bytes(full),))
        self.assertTrue(result.info.still)
        self.assertEqual(result.info.frames, 1)

    def test_poster_frame_ties_keep_the_earliest(self) -> None:
        a, b = blank(), blank()
        put(a, 1, 1, (255, 0, 0))
        put(b, 9, 9, (0, 255, 0))
        self.assertEqual(retime.poster_frame_index([bytes(a), bytes(b)]), 0)

    def test_rhythm_is_kept_not_flattened(self) -> None:
        """A blink [1500, 100, 100, 100 ms] at 50% stays a long hold followed by quick ones."""
        frames = noise_frames(4)
        result = retime.retime(frames, [1500, 100, 100, 100], 50)
        long_hold, *quick = result.delays_ms
        self.assertAlmostEqual(long_hold, 483, delta=3)
        for delay in quick:
            self.assertAlmostEqual(delay, 32, delta=2)
        self.assertAlmostEqual(long_hold / quick[0], 15, delta=1.5)

    def test_mean_pace_follows_the_curve(self) -> None:
        frames = noise_frames(12)
        for speed in (10, 34, 50, 75, 90):
            result = retime.retime(frames, [125] * 12, speed)
            self.assertAlmostEqual(result.info.pace_fps / retime.pace_for_speed(speed), 1.0, delta=0.02, msg=speed)

    def test_no_frame_goes_below_seven_units(self) -> None:
        frames = noise_frames(3)
        result = retime.retime(frames, [10, 10, 4000], 88)
        self.assertTrue(all(delay >= 7 * UNIT_MS - 1e-9 for delay in result.delays_ms))
        self.assertEqual(len(result.delays_ms), 3)

    def test_original_position_is_where_the_native_pace_sits(self) -> None:
        frames = noise_frames(12)
        info = retime.retime(frames, [125] * 12, None).info
        self.assertAlmostEqual(info.original_speed, 52.8, delta=0.2)
        self.assertAlmostEqual(retime.pace_for_speed(info.original_speed), 8.0, delta=0.05)

    def test_speed_and_smooth_must_be_valid(self) -> None:
        for bad in (-1, 101, "fast", True, float("nan")):
            with self.assertRaises(ValueError, msg=repr(bad)):
                retime.validate_speed(bad)
        for bad in ("auto", True, 1):
            with self.assertRaises(ValueError, msg=repr(bad)):
                retime.validate_smooth(bad)
        self.assertEqual((retime.validate_speed(None), retime.validate_speed(0), retime.validate_speed(33.5)), (None, 0, 33.5))
        self.assertEqual((retime.validate_smooth(None), retime.validate_smooth("on"), retime.validate_smooth("off")), (None, "on", "off"))

    def test_a_single_frame_is_returned_as_it_is(self) -> None:
        frame = bytes([9]) * (W * H * 3)
        for speed in (None, 0, 50, 100):
            result = retime.retime([frame], [0], speed)
            self.assertEqual(result.frames, (frame,))

    def test_identical_neighbours_merge_once_a_speed_is_set(self) -> None:
        a, b = bytes([10]) * (W * H * 3), bytes([200]) * (W * H * 3)
        result = retime.retime([a, a, b, b], [100, 100, 100, 100], 100)
        self.assertEqual(result.frames, (a, b))
        self.assertEqual(result.delays_ms, (14 * UNIT_MS, 14 * UNIT_MS))

    def test_a_long_animation_is_only_scaled(self) -> None:
        """The services can hand over hundreds of frames; nothing is analysed or merged then."""
        frames = noise_frames(20) * 15
        result = retime.retime(frames, [67] * 300, 80)
        self.assertEqual(len(result.frames), 300)
        self.assertEqual(result.info.smooth_state, "unavailable")


# -- Smoothing: sliding -----------------------------------------------------------------------------------------------


class SlideTests(unittest.TestCase):
    def test_a_sliding_sprite_gains_shifted_copies_when_slowed(self) -> None:
        frames = sliding(step=3)
        slow = retime.retime(frames, [125] * 8, 25)
        self.assertGreater(slow.info.added_frames, 0)
        self.assertEqual(slow.info.smooth_state, "applied")
        first, one, two, nxt = slow.frames[:4]
        self.assertEqual(first, frames[0])
        self.assertEqual(nxt, frames[1])
        shape = sprite()
        for in_between, shift in ((one, 1), (two, 2)):
            expected = blank()
            draw_sprite(expected, shape, 1 + shift, 4)
            self.assertEqual(in_between, bytes(expected))

    def test_in_betweens_never_invent_a_colour(self) -> None:
        frames = sliding(step=3)
        slow = retime.retime(frames, [125] * 8, 25)
        allowed = set().union(*(colours(f) for f in frames))
        for frame in slow.frames:
            self.assertLessEqual(colours(frame), allowed)

    def test_smoothing_never_changes_the_loop_length(self) -> None:
        frames = sliding(step=3)
        for speed in (10, 25, 40):
            smooth = retime.retime(frames, [125] * 8, speed, "on")
            plain = retime.retime(frames, [125] * 8, speed, "off")
            self.assertAlmostEqual(total(smooth.delays_ms), total(plain.delays_ms), delta=0.01, msg=speed)

    def test_in_between_steps_stay_between_21_and_45_ms(self) -> None:
        """A 8 px jump held ~177 ms is cut into pieces of about 44 ms; never into slivers below 21 ms."""
        result = retime.retime(sliding(count=4, step=8), [100] * 4, 46)
        pieces = result.delays_ms[:4]
        self.assertEqual(len(result.frames), 4 + 3 * 3)
        self.assertTrue(all(21 <= d <= 45.5 for d in pieces), pieces)

    def test_the_animation_starting_over_stays_a_cut(self) -> None:
        """The sprite crossing the panel and flying back to its start is a restart, not motion to smooth."""
        frames = sliding(step=3)
        result = retime.retime(frames, [125] * 8, 25)
        self.assertEqual(result.info.sharp, 1)
        self.assertEqual(result.info.slides, 7)
        self.assertEqual(len(result.frames), 8 + 7 * 2)
        self.assertEqual(result.frames[-1], frames[-1])
        self.assertGreater(result.delays_ms[-1], 100)  # the last hold is not cut up

    def test_nothing_is_added_at_original_or_faster(self) -> None:
        frames = sliding(step=3)
        self.assertEqual(retime.retime(frames, [125] * 8, None).info.added_frames, 0)
        self.assertEqual(retime.retime(frames, [125] * 8, None).info.smooth_state, "idle")
        fast = retime.retime(frames, [125] * 8, 75)
        self.assertEqual((fast.info.added_frames, fast.info.smooth_state), (0, "idle"))

    def test_off_adds_nothing_but_says_it_could(self) -> None:
        result = retime.retime(sliding(step=3), [125] * 8, 20, "off")
        self.assertEqual(result.info.added_frames, 0)
        self.assertEqual(result.info.smooth_state, "off")
        self.assertTrue(result.info.smooth_available)
        self.assertFalse(result.info.smooth_enabled)

    def test_a_one_pixel_slide_is_already_as_smooth_as_it_gets(self) -> None:
        result = retime.retime(sliding(step=1), [125] * 8, 20)
        self.assertEqual(result.info.added_frames, 0)
        self.assertEqual(result.info.smooth_state, "unavailable")
        self.assertEqual(result.info.slides, 7)

    def test_a_ticker_in_one_half_slides_over_a_busy_static_half(self) -> None:
        rng = random.Random(8)
        noise = [(x, y, (rng.randrange(256), rng.randrange(256), rng.randrange(256))) for x in range(18, 32) for y in range(16)]

        def backdrop(frame: bytearray) -> None:
            for x, y, colour in noise:
                put(frame, x, y, colour)

        result = retime.retime(sliding(step=3, backdrop=backdrop), [125] * 8, 25)
        self.assertGreater(result.info.added_frames, 0)
        self.assertTrue(all(pixel(result.frames[1], x, y) == c for x, y, c in noise))

    def test_a_sprite_crossing_a_picture_that_stays_put_slides_inside_its_box(self) -> None:
        def ground(frame: bytearray) -> None:
            for x in range(W):
                put(frame, x, 14, (0, 90, 0) if x % 3 else (0, 200, 40))
                put(frame, x, 15, (0, 200, 40) if x % 2 else (0, 90, 0))

        result = retime.retime(sliding(step=3, y=2, backdrop=ground), [125] * 8, 25)
        self.assertGreater(result.info.added_frames, 0)
        for frame in result.frames:
            self.assertEqual([pixel(frame, x, 14) for x in range(W)], [pixel(result.frames[0], x, 14) for x in range(W)])

    def test_a_wrapping_scroller_slides_and_its_loop_wraps_cleanly(self) -> None:
        rng = random.Random(2)
        texture = [[rng.random() < 0.5 for _ in range(W)] for _ in range(H)]

        def frame_at(shift: int) -> bytes:
            frame = blank()
            for y in range(H):
                for x in range(W):
                    if texture[y][(x - shift) % W]:
                        put(frame, x, y, (0, 160, 255))
            return bytes(frame)

        frames = [frame_at(4 * k) for k in range(8)]  # 8 steps of 4 px make exactly one 32 px turn
        result = retime.retime(frames, [100] * 8, 20)
        self.assertEqual(result.info.slides, 8)
        self.assertEqual(result.info.sharp, 0)
        self.assertGreater(result.info.added_frames, 0)


# -- Smoothing: fading ------------------------------------------------------------------------------------------------


class FadeTests(unittest.TestCase):
    def test_a_glow_pulsing_in_moderate_steps_gets_level_by_level_in_betweens(self) -> None:
        frames = glow([15, 11, 7, 11])
        result = retime.retime(frames, [200] * 4, 20)
        self.assertGreater(result.info.fades, 0)
        self.assertGreater(result.info.added_frames, 0)
        seen = [level(f, 14, 6)[0] for f in result.frames]
        self.assertEqual(seen[:4], [15, 14, 13, 12][: len(seen[:4])])
        self.assertTrue(all(0 <= v <= 15 for v in seen))

    def test_fade_steps_survive_the_upload_quantiser_exactly(self) -> None:
        """An in-between is stored as a value the clock's curve maps back to the level that was meant."""
        result = retime.retime(glow([15, 11, 7, 11]), [200] * 4, 20)
        fade = result.frames[1]
        self.assertEqual(level(fade, 14, 6)[0], 14)
        self.assertEqual(level(fade, 14, 6)[1], hardware.rgb444_transfer(hardware.rgb444_representative(7)))

    def test_a_blink_between_on_and_off_stays_sharp(self) -> None:
        on, off = blank(), blank()
        block(on, 12, 4, 8, 8, (255, 255, 255))
        result = retime.retime([bytes(on), bytes(off), bytes(on), bytes(off)], [600, 100, 600, 100], 15)
        self.assertEqual(result.info.added_frames, 0)
        self.assertEqual(result.info.sharp, 4)
        self.assertFalse(result.info.smooth_available)

    def test_a_sprite_swap_is_not_cross_faded(self) -> None:
        left, right = blank(), blank()
        block(left, 4, 4, 6, 6, (200, 100, 0))
        block(right, 20, 4, 6, 6, (200, 100, 0))
        result = retime.retime([bytes(left), bytes(right)], [500, 500], 10)
        self.assertEqual((result.info.added_frames, result.info.sharp), (0, 2))

    def test_a_colour_change_is_not_a_fade(self) -> None:
        red, green = blank(), blank()
        block(red, 8, 4, 8, 8, levels_colour(12, 0, 0))
        block(green, 8, 4, 8, 8, levels_colour(0, 12, 0))
        result = retime.retime([bytes(red), bytes(green)], [500, 500], 10)
        self.assertEqual(result.info.added_frames, 0)
        self.assertEqual(result.info.fades, 0)


# -- Smoothing: the frame budget --------------------------------------------------------------------------------------


class BudgetTests(unittest.TestCase):
    def _scroller(self, count: int) -> list[bytes]:
        rng = random.Random(4)
        texture = [[rng.random() < 0.5 for _ in range(W)] for _ in range(H)]
        frames = []
        for k in range(count):
            frame = blank()
            for y in range(H):
                for x in range(W):
                    if texture[y][(x - 3 * k) % W]:
                        put(frame, x, y, (255, 80, 0))
            frames.append(bytes(frame))
        return frames

    def test_in_betweens_never_push_the_animation_past_forty_frames(self) -> None:
        """18 frames sliding 3 px would like 2 in-betweens each (54 frames); the step length is raised
        until it fits, which leaves one each."""
        frames = self._scroller(18)
        result = retime.retime(frames, [100] * 18, 15)
        self.assertLessEqual(len(result.frames), hardware.SMOOTH_MAX_FRAMES)
        self.assertGreater(len(result.frames), 18)
        self.assertTrue(result.info.capped)
        self.assertEqual(result.info.added_frames, len(result.frames) - 18)

    def test_a_long_design_keeps_every_authored_frame_and_adds_nothing_over_the_cap(self) -> None:
        frames = self._scroller(45)
        result = retime.retime(frames, [100] * 45, 15)
        self.assertEqual(len(result.frames), 45)
        self.assertEqual(result.info.added_frames, 0)

    def test_a_roomy_budget_is_not_flagged_as_capped(self) -> None:
        result = retime.retime(sliding(step=3), [125] * 8, 25)
        self.assertFalse(result.info.capped)
        self.assertLessEqual(len(result.frames), hardware.SMOOTH_MAX_FRAMES)


# -- The slide search -------------------------------------------------------------------------------------------------


def reference_slide(a: list[int], b: list[int], width: int, height: int):
    """The slide search written the slow, obvious way: same rules, one pixel at a time."""
    from collections import Counter

    counts = Counter(a)
    background = min(counts, key=lambda v: (-counts[v], v))
    changed = [i for i in range(width * height) if a[i] != b[i]]
    if len(changed) < retime.SHIFT_MIN_CHANGED:
        return None
    content = max(1, sum(1 for v in b if v != background))
    best = None
    for dy in range(-min(retime.SHIFT_MAX_Y, height - 1), min(retime.SHIFT_MAX_Y, height - 1) + 1):
        for dx in range(-min(retime.SHIFT_MAX_X, width - 1), min(retime.SHIFT_MAX_X, width - 1) + 1):
            if not dx and not dy:
                continue
            unexplained = entering = 0
            carried = False
            for y in range(height):
                for x in range(width):
                    sx, sy = x - dx, y - dy
                    here = y * width + x
                    if 0 <= sx < width and 0 <= sy < height:
                        source = a[sy * width + sx]
                        if source != b[here]:
                            unexplained += 1
                        elif source != background and a[here] != b[here]:
                            carried = True
                    elif b[here] != background:
                        entering += 1
            if unexplained > retime.SHIFT_UNEXPLAINED_MAX * len(changed):
                continue
            if entering > retime.SHIFT_ENTERING_MAX * content:
                continue
            if not carried:
                continue
            key = (unexplained, entering, max(abs(dx), abs(dy)), abs(dx) + abs(dy))
            if best is None or key < best[0]:
                best = (key, dx, dy)
    return None if best is None else (best[1], best[2])


class SlideSearchTests(unittest.TestCase):
    def test_the_fast_search_agrees_with_the_obvious_one(self) -> None:
        rng = random.Random(11)
        checked = 0
        for _ in range(60):
            base = blank()
            for _ in range(rng.choice((3, 12, 60))):
                put(base, rng.randrange(W), rng.randrange(H), (rng.randrange(1, 256), rng.randrange(256), 0))
            dx, dy = rng.randint(-6, 6), rng.randint(-3, 3)
            moved = blank()
            for y in range(H):
                for x in range(W):
                    if 0 <= x - dx < W and 0 <= y - dy < H:
                        moved[(y * W + x) * 3 : (y * W + x) * 3 + 3] = base[((y - dy) * W + x - dx) * 3 : ((y - dy) * W + x - dx) * 3 + 3]
            if rng.random() < 0.3:  # spoil it a little
                put(moved, rng.randrange(W), rng.randrange(H), (9, 9, 9))
            a, b = retime._Prepared(bytes(base)), retime._Prepared(bytes(moved))
            found = retime._find_shift(a, b, W, (0, 0, W, H))
            expected = reference_slide(a.levels, b.levels, W, H)
            self.assertEqual(None if found is None else found[:2], expected, (dx, dy))
            checked += found is not None
        self.assertGreater(checked, 20)

    def test_a_clock_region_design_is_judged_on_its_art_columns_only(self) -> None:
        narrow = 16
        shape = sprite()
        frames = []
        for k in range(6):
            frame = bytearray(bytes((0, 0, 0)) * (narrow * H))
            for dy, row in enumerate(shape):
                for dx, lit in enumerate(row):
                    x = 1 + 2 * k + dx
                    if lit and x < narrow:
                        frame[(( 4 + dy) * narrow + x) * 3 : ((4 + dy) * narrow + x) * 3 + 3] = bytes((255, 160, 0))
            frames.append(bytes(frame))
        result = retime.retime(frames, [125] * 6, 20, width=narrow)
        self.assertGreater(result.info.added_frames, 0)
        self.assertTrue(all(len(f) == narrow * H * 3 for f in result.frames))


class InfoShapeTests(unittest.TestCase):
    def test_the_panel_receives_every_field_it_shows(self) -> None:
        info = retime.retime(sliding(step=3), [125] * 8, 25).info.to_json()
        self.assertEqual(
            set(info),
            {"still", "frames", "authored_frames", "added_frames", "loop_ms", "pace_fps", "native_fps", "original_speed", "smooth"},
        )
        self.assertEqual(
            set(info["smooth"]),
            {"state", "available", "enabled", "slides", "fades", "sharp", "capped"},
        )
        self.assertEqual(info["frames"], info["authored_frames"] + info["added_frames"])


if __name__ == "__main__":
    unittest.main()
