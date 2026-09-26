package com.jtkj.led1248.light.emoji;

import android.graphics.Color;
import java.util.ArrayList;
import java.util.List;

/**
 * STUB with verbatim vendor logic: getColorDataWithColor, getColorDataWithColorWithRGB444Transfer
 * and rgb444Transfer below are copied unmodified from the decompiled
 * light/emoji/TextEmojiManagerCoolLEDUX.java (lines 386-414) — these are the
 * exact RGB->nibble color encoders every ILedClockUtils content-program
 * builder calls. Everything else on the real class (bitmap/emoji-image
 * decoding, inherited TextEmojiManager instance state) is Android-UI-only
 * and out of scope, so this stub does not extend TextEmojiManager.
 */
public final class TextEmojiManagerCoolLEDUX {
    private TextEmojiManagerCoolLEDUX() {}

    // --- verbatim from vendor source, light/emoji/TextEmojiManagerCoolLEDUX.java:386-394 ---
    public static List<String> getColorDataWithColor(int i) {
        ArrayList arrayList = new ArrayList();
        int iRed = Color.red(i) / 16;
        int iGreen = Color.green(i) / 16;
        int iBlue = Color.blue(i) / 16;
        arrayList.add(Integer.toHexString(0) + Integer.toHexString(iRed));
        arrayList.add(Integer.toHexString(iGreen) + Integer.toHexString(iBlue));
        return arrayList;
    }

    // --- verbatim from vendor source, light/emoji/TextEmojiManagerCoolLEDUX.java:396-404 ---
    public static List<String> getColorDataWithColorWithRGB444Transfer(int i) {
        ArrayList arrayList = new ArrayList();
        int iRgb444Transfer = rgb444Transfer(Color.red(i));
        int iRgb444Transfer2 = rgb444Transfer(Color.green(i));
        int iRgb444Transfer3 = rgb444Transfer(Color.blue(i));
        arrayList.add(Integer.toHexString(0) + Integer.toHexString(iRgb444Transfer));
        arrayList.add(Integer.toHexString(iRgb444Transfer2) + Integer.toHexString(iRgb444Transfer3));
        return arrayList;
    }

    // --- verbatim from vendor source, light/emoji/TextEmojiManagerCoolLEDUX.java:406-414 ---
    public static int rgb444Transfer(int i) {
        if (i >= 238) {
            return 15;
        }
        if (i <= 47) {
            return 0;
        }
        return ((i - 47) / 14) + 1;
    }
}
