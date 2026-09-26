"""`adapt.py` pipeline tests, covering every stage docs/GALLERY.md calls out explicitly:
scale recovery (incl. noisy blocks), shared trim, majority pooling, near-black lift,
frame merge/decimation, and every layout returning exactly 32x16 output."""

from __future__ import annotations

import random
import unittest

from custom_components.iledclock import adapt
from custom_components.iledclock.const import DISPLAY_HEIGHT, DISPLAY_WIDTH


def _solid(rgba, size=(8, 8)):
    from PIL import Image

    return Image.new("RGBA", size, rgba)


def _checker(size, colors):
    from PIL import Image

    img = Image.new("RGBA", size)
    w, h = size
    for y in range(h):
        for x in range(w):
            img.putpixel((x, y), colors[(x + y) % len(colors)])
    return img


class ScaleRecoveryTests(unittest.TestCase):
    def test_clean_upscaled_8x8_art_recovers_exact_scale(self) -> None:
        from PIL import Image

        random.seed(11)
        base = Image.new("RGBA", (8, 8))
        for y in range(8):
            for x in range(8):
                base.putpixel((x, y), (random.randrange(256), random.randrange(256), random.randrange(256), 255))
        upscaled = base.resize((40, 40), Image.NEAREST)  # clean 5x upscale

        result = adapt.adapt([upscaled], [0])

        self.assertEqual(result.report["detected_scale"], 5)
        self.assertEqual(result.report["native_size"], {"width": 40, "height": 40})

    def test_upscaled_art_with_a_few_noisy_blocks_still_recovers(self) -> None:
        """<=2% noisy blocks (docs/GALLERY.md) must not defeat detection."""
        from PIL import Image

        random.seed(12)
        base = Image.new("RGBA", (8, 8))
        for y in range(8):
            for x in range(8):
                base.putpixel((x, y), (random.randrange(256), random.randrange(256), random.randrange(256), 255))
        upscaled = base.resize((40, 40), Image.NEAREST).convert("RGBA")
        px = upscaled.load()
        # Corrupt 1 of 64 blocks (~1.6%, within the 2% budget) with small per-pixel noise.
        for dx in range(5):
            for dy in range(5):
                x, y = 10 + dx, 15 + dy
                r, g, b, a = px[x, y]
                px[x, y] = (
                    min(255, max(0, r + random.randint(-15, 15))),
                    min(255, max(0, g + random.randint(-15, 15))),
                    min(255, max(0, b + random.randint(-15, 15))),
                    a,
                )

        result = adapt.adapt([upscaled], [0])

        self.assertEqual(result.report["detected_scale"], 5)

    def test_over_budget_noise_correctly_fails_to_recover_that_scale(self) -> None:
        """Regression guard: the noise tolerance must be a real budget, not a no-op --
        pushing well past 2% of blocks corrupted must NOT still report the same scale."""
        from PIL import Image

        random.seed(13)
        base = Image.new("RGBA", (8, 8))
        for y in range(8):
            for x in range(8):
                base.putpixel((x, y), (random.randrange(256), random.randrange(256), random.randrange(256), 255))
        upscaled = base.resize((40, 40), Image.NEAREST).convert("RGBA")
        px = upscaled.load()
        for block_i in range(6):  # 6/64 = ~9.4%, well past the 2% budget
            for dx in range(5):
                for dy in range(5):
                    x, y = block_i * 5 + dx, dy
                    r, g, b, a = px[x, y]
                    px[x, y] = (
                        min(255, max(0, r + random.randint(-80, 80))),
                        min(255, max(0, g + random.randint(-80, 80))),
                        min(255, max(0, b + random.randint(-80, 80))),
                        a,
                    )

        result = adapt.adapt([upscaled], [0])

        self.assertNotEqual(result.report["detected_scale"], 5)

    def test_solid_colour_icon_has_nothing_to_recover(self) -> None:
        """Regression guard: a flat single-colour image must not collapse to a
        degenerate 1x1 'native size' -- there is no structure to recover at any scale."""
        img = _solid((255, 0, 0, 255), size=(8, 8))

        result = adapt.adapt([img], [0])

        self.assertEqual(result.report["detected_scale"], 1)

    def test_explicit_scale_override_skips_detection(self) -> None:
        from PIL import Image

        img = Image.new("RGBA", (32, 32), (0, 255, 0, 255))
        result = adapt.adapt([img], [0], {"scale": 4})
        self.assertEqual(result.report["detected_scale"], 4)


class MajorityPoolingTests(unittest.TestCase):
    def test_majority_pool_helper_keeps_a_1px_outline_directly(self) -> None:
        """Direct test of the named mechanism (docs/GALLERY.md: "majority (mode)
        pooling"), isolated from trim/layout classification: a 1-px-wide outline ring,
        upscaled 4x cleanly, must downsample back to the exact original ring -- not a
        blurred/averaged approximation -- when pooled by the matching factor."""
        from PIL import Image

        logical = Image.new("RGBA", (16, 16), (0, 0, 0, 255))
        for y in range(16):
            for x in range(16):
                on_ring = x in (0, 15) or y in (0, 15)
                logical.putpixel((x, y), (0, 0, 0, 255) if on_ring else (255, 255, 255, 255))
        upscaled = logical.resize((64, 64), Image.NEAREST)

        pooled = adapt._majority_pool(upscaled, 4)

        self.assertEqual(pooled.size, (16, 16))
        for y in range(16):
            for x in range(16):
                self.assertEqual(pooled.getpixel((x, y)), logical.getpixel((x, y)), f"pixel ({x},{y})")

    def test_full_pipeline_64_to_16_majority_pooling_keeps_a_1px_outline(self) -> None:
        """Same ring pattern exercised end-to-end through `adapt()`'s "auto" layout: a
        64x64 source (square, >16px) must be recognised as pixel art and majority-pooled
        (not area-averaged), preserving the 1-px outline through trim + pooling +
        centring. The margin/ring/interior use three distinct colours (grey/black/white)
        so trim's border-colour guess can never coincide with the ring itself, and the
        margin width (8px) and ring-cell size (3px) are both exact multiples of 16, so
        trim and the resulting pooling factor land on clean, unambiguous integers."""
        from PIL import Image

        logical = Image.new("RGBA", (16, 16), (0, 0, 0, 255))
        for y in range(16):
            for x in range(16):
                on_ring = x in (0, 15) or y in (0, 15)
                logical.putpixel((x, y), (0, 0, 0, 255) if on_ring else (255, 255, 255, 255))
        region = logical.resize((48, 48), Image.NEAREST)  # 3 physical px per logical cell
        canvas = Image.new("RGBA", (64, 64), (128, 128, 128, 255))  # grey margin
        canvas.paste(region, (8, 8))

        result = adapt.adapt([canvas], [0], {"scale": 1, "layout": "auto"})

        self.assertEqual(result.report["trimmed_box"], {"x": 8, "y": 8, "w": 48, "h": 48})
        self.assertTrue(any("majority-pool-x3" in note for note in result.report["notes"]))
        frame = result.frames[0]

        def pixel_at(buf, x, y):
            off = (y * DISPLAY_WIDTH + x) * 3
            return tuple(buf[off : off + 3])

        for y in range(16):
            for x in range(16):
                expected = logical.getpixel((x, y))[:3]
                got = pixel_at(frame, x + 8, y)  # centred: (32-16)//2 = 8
                self.assertEqual(got, expected, f"pixel ({x},{y})")


class TrimTests(unittest.TestCase):
    def test_shared_trim_box_uses_union_across_frames(self) -> None:
        from PIL import Image

        def make_frame(box):
            img = Image.new("RGBA", (20, 16), (0, 0, 0, 0))
            x0, y0, x1, y1 = box
            for y in range(y0, y1):
                for x in range(x0, x1):
                    img.putpixel((x, y), (200, 30, 30, 255))
            return img

        f0 = make_frame((2, 2, 6, 6))
        f1 = make_frame((4, 4, 8, 8))  # a moving sprite across frames

        result = adapt.adapt([f0, f1], [50, 50], {"scale": 1})

        box = result.report["trimmed_box"]
        self.assertIsNotNone(box)
        # union of (2,2,6,6) and (4,4,8,8) -> x:[2,8) y:[2,8)
        self.assertEqual(box, {"x": 2, "y": 2, "w": 6, "h": 6})


class NearBlackLiftTests(unittest.TestCase):
    def test_minimum_visible_level_matches_the_documented_curve(self) -> None:
        """Independent regression check on the threshold itself (docs/HARDWARE.md 2.2:
        `rgb444_transfer`: v<=47 -> nibble 0, v=48 -> nibble 1) -- hardcoded, not derived
        from the function under test, so a broken threshold can't silently agree with
        itself."""
        self.assertEqual(adapt._minimum_visible_level(), 48)

    def test_dark_navy_content_pixel_is_lifted_above_the_visibility_floor(self) -> None:
        from PIL import Image

        img = Image.new("RGBA", (2, 2), (0, 0, 0, 255))  # background: pure black
        img.putpixel((0, 0), (5, 5, 20, 255))  # dark navy "content"

        result = adapt.adapt([img], [0], {"scale": 1, "layout": "stretch", "enhance": False})

        # Hardcoded, independent expected floor (see test_minimum_visible_level_matches_
        # the_documented_curve above) -- NOT re-derived from adapt._minimum_visible_level(),
        # so a broken threshold implementation can't pass by agreeing with itself.
        floor = 48
        # stretch maps the 2x2 source onto the 32x16 canvas; sample near the source pixel
        # that held the navy value (top-left quadrant after nearest-neighbour stretch).
        frame = result.frames[0]

        def pixel_at(buf, x, y):
            off = (y * DISPLAY_WIDTH + x) * 3
            return tuple(buf[off : off + 3])

        sample = pixel_at(frame, 0, 0)
        self.assertGreaterEqual(max(sample), floor)
        self.assertGreater(sample[2], sample[0])  # hue preserved: blue > red

    def test_background_pixels_are_never_lifted(self) -> None:
        from PIL import Image

        img = Image.new("RGBA", (4, 4), (0, 0, 0, 255))  # entirely background, no content

        result = adapt.adapt([img], [0], {"scale": 1})

        frame = result.frames[0]
        self.assertTrue(all(b == 0 for b in frame))  # still pure black everywhere


class TimingTests(unittest.TestCase):
    def test_identical_consecutive_frames_are_merged(self) -> None:
        from PIL import Image

        red = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
        blue = Image.new("RGBA", (8, 8), (0, 0, 255, 255))

        result = adapt.adapt([red, red, blue], [50, 50, 60], {"scale": 1})

        self.assertEqual(len(result.frames), 2)
        self.assertEqual(result.delays_ms, [100, 60])
        self.assertEqual(result.report["frames_out"], 2)

    def test_decimation_preserves_total_loop_duration(self) -> None:
        from PIL import Image

        # Colours stay well above the near-black visibility floor (~48, see
        # NearBlackLiftTests) so the lift step can't coincidentally collapse distinct
        # source frames into identical output frames before decimation even runs. Delays
        # stay comfortably inside [20, 10000] (the clamp step's own range, see
        # test_delays_are_clamped_to_pipeline_range below) so clamping is a no-op here
        # and the preserved total is unambiguously the original one, not a clamp-altered
        # one.
        frames = [Image.new("RGBA", (4, 4), (80 + (i % 150), 0, 0, 255)) for i in range(100)]
        delays = [50] * 100

        result = adapt.adapt(frames, delays, {"scale": 1})

        self.assertEqual(len(result.frames), 64)
        self.assertEqual(sum(result.delays_ms), sum(delays))
        self.assertEqual(result.report["duration_in_ms"], 5000)
        self.assertEqual(result.report["duration_out_ms"], 5000)

    def test_delays_are_clamped_to_pipeline_range(self) -> None:
        from PIL import Image

        img = Image.new("RGBA", (4, 4), (1, 2, 3, 255))
        result = adapt.adapt([img, img.copy()], [1, 99999], {"scale": 1})
        # both frames are identical so they'll merge into one; the merged delay
        # (1+99999=100000) must still be clamped to the ceiling afterward.
        self.assertEqual(result.delays_ms, [10_000])


class LayoutTests(unittest.TestCase):
    """Every layout must return exactly 32x16 output regardless of source size."""

    def _make_sources(self):
        from PIL import Image

        return {
            "tiny_8x8": Image.new("RGBA", (8, 8), (10, 200, 10, 255)),
            "wide_32x8": Image.new("RGBA", (32, 8), (200, 10, 10, 255)),
            "square_64x64": Image.new("RGBA", (64, 64), (10, 10, 200, 255)),
            "huge_photo_like": _checker((300, 200), [(10, 10, 10, 255), (240, 240, 240, 255)]),
            "odd_45x45": Image.new("RGBA", (45, 45), (120, 60, 200, 255)),
        }

    def test_every_layout_returns_exactly_32x16_for_every_source_shape(self) -> None:
        sources = self._make_sources()
        for layout in adapt.LAYOUTS:
            for name, img in sources.items():
                with self.subTest(layout=layout, source=name):
                    result = adapt.adapt([img], [0], {"layout": layout})
                    self.assertEqual(result.layout, layout)
                    self.assertEqual(len(result.frames), 1)
                    self.assertEqual(len(result.frames[0]), DISPLAY_WIDTH * DISPLAY_HEIGHT * 3)

    def test_layouts_available_lists_every_layout(self) -> None:
        result = adapt.adapt([_solid((1, 2, 3, 255))], [0])
        self.assertEqual(set(result.layouts_available), set(adapt.LAYOUTS))

    def test_icon_with_clock_reports_native_region(self) -> None:
        img = _solid((10, 200, 10, 255), size=(16, 16))
        result = adapt.adapt([img], [0], {"layout": "icon_with_clock", "icon_size": 16})
        region = result.report.get("native_region")
        self.assertIsNotNone(region)
        self.assertEqual(region["x"], 16)
        self.assertEqual(region["w"], DISPLAY_WIDTH - 16)
        self.assertEqual(region["h"], DISPLAY_HEIGHT)

    def test_unknown_layout_raises(self) -> None:
        with self.assertRaises(adapt.AdaptError):
            adapt.adapt([_solid((1, 1, 1, 255))], [0], {"layout": "not-a-real-layout"})


class InputValidationTests(unittest.TestCase):
    def test_empty_frames_raises(self) -> None:
        with self.assertRaises(adapt.AdaptError):
            adapt.adapt([], [])

    def test_mismatched_lengths_raises(self) -> None:
        with self.assertRaises(adapt.AdaptError):
            adapt.adapt([_solid((1, 1, 1, 255)), _solid((2, 2, 2, 255))], [10])


if __name__ == "__main__":
    unittest.main()
