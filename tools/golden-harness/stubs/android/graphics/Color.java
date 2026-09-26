package android.graphics;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * STUB: pure-Java re-implementation of android.graphics.Color's integer ARGB
 * packing helpers. Semantics copied from AOSP frameworks/base
 * graphics/java/android/graphics/Color.java so vendor code that calls these
 * helpers produces byte-identical results to the real Android runtime.
 * Bitmap/Paint/Canvas rendering is NOT provided (out of scope; see README).
 */
public final class Color {
    private Color() {}

    public static int red(int color) {
        return (color >> 16) & 0xFF;
    }

    public static int green(int color) {
        return (color >> 8) & 0xFF;
    }

    public static int blue(int color) {
        return color & 0xFF;
    }

    public static int alpha(int color) {
        return color >>> 24;
    }

    public static int rgb(int red, int green, int blue) {
        return 0xff000000 | ((red & 0xFF) << 16) | ((green & 0xFF) << 8) | (blue & 0xFF);
    }

    public static int argb(int alpha, int red, int green, int blue) {
        return ((alpha & 0xFF) << 24) | ((red & 0xFF) << 16) | ((green & 0xFF) << 8) | (blue & 0xFF);
    }

    private static final Map<String, Integer> COLOR_NAME_MAP = new HashMap<>();
    static {
        COLOR_NAME_MAP.put("black", 0xFF000000);
        COLOR_NAME_MAP.put("darkgray", 0xFF444444);
        COLOR_NAME_MAP.put("gray", 0xFF888888);
        COLOR_NAME_MAP.put("lightgray", 0xFFCCCCCC);
        COLOR_NAME_MAP.put("white", 0xFFFFFFFF);
        COLOR_NAME_MAP.put("red", 0xFFFF0000);
        COLOR_NAME_MAP.put("green", 0xFF00FF00);
        COLOR_NAME_MAP.put("blue", 0xFF0000FF);
        COLOR_NAME_MAP.put("yellow", 0xFFFFFF00);
        COLOR_NAME_MAP.put("cyan", 0xFF00FFFF);
        COLOR_NAME_MAP.put("magenta", 0xFFFF00FF);
        COLOR_NAME_MAP.put("aqua", 0xFF00FFFF);
        COLOR_NAME_MAP.put("fuchsia", 0xFFFF00FF);
        COLOR_NAME_MAP.put("darkgrey", 0xFF444444);
        COLOR_NAME_MAP.put("grey", 0xFF888888);
        COLOR_NAME_MAP.put("lightgrey", 0xFFCCCCCC);
        COLOR_NAME_MAP.put("lime", 0xFF00FF00);
        COLOR_NAME_MAP.put("maroon", 0xFF800000);
        COLOR_NAME_MAP.put("navy", 0xFF000080);
        COLOR_NAME_MAP.put("olive", 0xFF808000);
        COLOR_NAME_MAP.put("purple", 0xFF800080);
        COLOR_NAME_MAP.put("silver", 0xFFC0C0C0);
        COLOR_NAME_MAP.put("teal", 0xFF008080);
        COLOR_NAME_MAP.put("transparent", 0);
    }

    /** Mirrors android.graphics.Color#parseColor(String). */
    public static int parseColor(String colorString) {
        if (colorString.charAt(0) == '#') {
            long color = Long.parseLong(colorString.substring(1), 16);
            if (colorString.length() == 7) {
                color |= 0x00000000ff000000L;
            } else if (colorString.length() != 9) {
                throw new IllegalArgumentException("Unknown color: " + colorString);
            }
            return (int) color;
        }
        Integer color = COLOR_NAME_MAP.get(colorString.toLowerCase(Locale.ROOT));
        if (color != null) {
            return color;
        }
        throw new IllegalArgumentException("Unknown color: " + colorString);
    }
}
