package com.jtkj.led1248.light.utils;

import android.content.Context;
import com.jtkj.led1248.light.device.ILedClockManager;

/**
 * STUB: the real FontUtils (17k+ lines) rasterizes glyphs from bundled
 * per-resolution bitmap font binaries via RandomAccessFile + Bitmap/Paint,
 * none of which are available in this harness. ILedClockUtils calls exactly
 * two FontUtils entry points (getFontByteDataILedClockForEmoji for plain
 * scrolling text, getFontByteCustomColorDataILedClockForEmoji for per-glyph
 * colored text); both require real font assets to be byte-faithful and are
 * therefore explicitly out of scope (see README "Not covered"). Golden.java
 * never calls ILedClockUtils.getDataWithTextContentProgramContent /
 * getDataWithTextCustomColorProgramContent, so these stub bodies are never
 * executed.
 */
public class FontUtils {
    public static FontUtils getInstance(Context context) {
        return new FontUtils();
    }

    public java.util.List<String> getFontByteDataILedClockForEmoji(
            ILedClockManager.ILedClockTextContentProgramContent content) {
        throw new UnsupportedOperationException(
                "FontUtils stub: real Android bitmap font rendering unavailable in golden harness");
    }

    public LightUtils.TextColorDataFor32Device getFontByteCustomColorDataILedClockForEmoji(
            ILedClockManager.ILedClockTextCustomColorProgramContent content) {
        throw new UnsupportedOperationException(
                "FontUtils stub: real Android bitmap font rendering unavailable in golden harness");
    }
}
