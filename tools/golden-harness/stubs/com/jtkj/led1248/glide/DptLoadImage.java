package com.jtkj.led1248.glide;

import com.jtkj.led1248.widget.DrawView;
import java.util.ArrayList;
import java.util.List;

/**
 * STUB: the real DptLoadImage decodes GIF files (via Android Bitmap/Movie
 * APIs) into per-frame DrawView.DrawItem grids. No real GIF assets exist in
 * this harness, so only the method surface ILedClockUtils references is
 * reproduced (DecoderAnimationItem + the two overloads it calls); callers
 * needing real decoded frames should build ILedClockAnimationProgramContent
 * directly with DrawView.DrawItem grids instead of going through this path
 * (that is what Golden.java does — see README "Not covered").
 */
public final class DptLoadImage {
    private DptLoadImage() {}

    public static class DecoderAnimationItem {
        public List<Integer> delays;
        public List<List<DrawView.DrawItem>> listDrawItems = new ArrayList<>();
        public int speed;
    }

    public static DecoderAnimationItem getAnimationItem(String path) {
        return new DecoderAnimationItem();
    }

    public static DecoderAnimationItem getAnimationItemWithColumnRow(int imageId, int column, int row) {
        return new DecoderAnimationItem();
    }
}
