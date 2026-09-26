package com.jtkj.led1248.light.emoji;

import java.io.Serializable;

/**
 * STUB: minimal nested value types referenced by field/parameter type from
 * the copied vendor sources. TextEmojiItem carries only the two fields
 * (isText/text) that ILedClockUtils.isArbOrXbl/dealWithArbAndXbl read;
 * those helpers are not part of the golden vector set (they are Arabic/
 * Hebrew text shaping utilities, orthogonal to the BLE encoders under
 * test) but must still compile. TextEmoji32Items is only ever held as a
 * field on ILedClockManager.ILedClock*TextContentProgramContent and never
 * dereferenced by the encoders we cover (font rendering is out of scope;
 * see README "Not covered"), so it is an empty marker.
 */
public class TextEmojiManager {
    public static class TextEmojiItem implements Serializable {
        private static final long serialVersionUID = 4308644912702335910L;
        public boolean isText;
        public String text;
    }

    public static class TextEmoji32Items implements Serializable {
        private static final long serialVersionUID = -8766787384029485437L;
    }
}
