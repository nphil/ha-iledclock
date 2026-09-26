package com.jtkj.led1248.widget;

import java.util.List;

/**
 * STUB: the real DrawView extends android.view.View and is a full custom
 * drawing widget. Only its nested DrawItem value type is used by the
 * copied encoders (graffiti/animation pixel grids). Fields and
 * constructors below are copied identically from the decompiled
 * widget/DrawView.java (lines 2150-2208); Parcelable/Serializable plumbing
 * and the View subclass itself are dropped as unused by ILedClockUtils.
 */
public final class DrawView {
    private DrawView() {}

    public static class DrawItem {
        public int color;
        public List<String> colors;
        public String data;
        public int index;

        public DrawItem() {}

        public DrawItem(String data) {
            this.data = data;
        }

        public DrawItem(String data, List<String> colors) {
            this.data = data;
            this.colors = colors;
        }

        public DrawItem(String data, List<String> colors, int color) {
            this.data = data;
            this.colors = colors;
            this.color = color;
        }

        public String toString() {
            return "DrawItem{data='" + this.data + "', colors=" + this.colors + ", color=" + this.color + '}';
        }
    }
}
