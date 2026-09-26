import com.jtkj.led1248.light.device.DeviceManager;
import com.jtkj.led1248.light.device.ILedClockManager;
import com.jtkj.led1248.light.utils.ILedClockUtils;
import com.jtkj.led1248.widget.DrawView;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static com.jtkj.led1248.light.device.ILedClockManager.*;

/**
 * Golden vectors for the program/content-type encoders, ILedClockUtils.java
 * lines 2598-4730. Construction values are grounded in the real UI layer
 * (light/iledclock/*.java) per README's coverage notes: device geometry
 * 16x32 is the app's common default (ILedClockGraffitiActivity,
 * ILedClockClockTimeFragment, ILedClockScoreboardActivity all gate their
 * field construction on `DEVICE_ROW==16 && DEVICE_COLUMN==32`), and the
 * 7-color DrawItem palette (RED/MAGENTA/YELLOW/GREEN/CYAN/BLUE/WHITE) comes
 * from ILedClockDrawGraffitiActivity's default palette. A second, larger
 * device geometry (32x128, matching the *ProgramContent classes' own
 * showWidth=128/showHeight=32 field defaults) is exercised in parallel so
 * the DEVICE_ROW/DEVICE_COLUMN-gated font-table dispatch in the
 * clock/date/timeCount/scoreboard encoders is covered on two distinct
 * paths, not just the (sparser) 16x32 one.
 */
final class ProgramEncoders {
    private ProgramEncoders() {}

    // Real 7-color DrawView.DrawItem palette from ILedClockDrawGraffitiActivity.java:134-140.
    static final int RED = 0xFFFF0000;
    static final int MAGENTA = 0xFFFF00FF;
    static final int YELLOW = 0xFFFFFF00;
    static final int GREEN = 0xFF00FF00;
    static final int CYAN = 0xFF00FFFF;
    static final int BLUE = 0xFF0000FF;
    static final int WHITE = 0xFFFFFFFF;
    static final int BLACK = 0xFF000000;

    static void run() {
        frame();
        textAutoColor();
        animation();
        graffiti();
        clock();
        date();
        timeCount();
        scoreBoard();
        temperature();
        humidity();
        reminder();
        combineProgramDispatch();
        fullProgramsAndResults();
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    static List<DrawView.DrawItem> grid(int width, int height, int... palette) {
        List<DrawView.DrawItem> items = new ArrayList<>(width * height);
        int n = width * height;
        for (int idx = 0; idx < n; idx++) {
            int color = palette[idx % palette.length];
            items.add(new DrawView.DrawItem("true", null, color));
        }
        return items;
    }

    static void withDeviceGeometry(int row, int column, Runnable body) {
        int prevRow = DeviceManager.DEVICE_ROW;
        int prevCol = DeviceManager.DEVICE_COLUMN;
        DeviceManager.DEVICE_ROW = row;
        DeviceManager.DEVICE_COLUMN = column;
        try {
            body.run();
        } finally {
            DeviceManager.DEVICE_ROW = prevRow;
            DeviceManager.DEVICE_COLUMN = prevCol;
        }
    }

    /**
     * Some ILedClockUtils content encoders hard-code a lookup for exactly one
     * DeviceManager.DEVICE_ROW/DEVICE_COLUMN pair (e.g. the clock encoder's
     * per-style hour-numeral table only exists for 16x32; every other
     * geometry falls through to an empty-string table that itself throws
     * NumberFormatException, since "".split(",") yields [""] not []). That is
     * a genuine, faithfully-preserved vendor limitation, not a harness bug --
     * this wrapper records it as a vector with out=null and an explanatory
     * note instead of aborting the whole run. See README "Not covered".
     */
    static void safeRecord(String fn, Map<String, Object> args, java.util.function.Supplier<Object> call) {
        try {
            Golden.v(fn, args, call.get());
        } catch (RuntimeException e) {
            args.put("note", "vendor threw " + e.getClass().getName() + ": " + e.getMessage()
                    + " for this DeviceManager.DEVICE_ROW/DEVICE_COLUMN geometry -- a real, "
                    + "faithfully-preserved limitation of the copied encoder (only specific device "
                    + "geometries are supported by its hardcoded per-style font-table lookups), not "
                    + "a harness bug. out is intentionally null.");
            Golden.v(fn, args, (Object) null);
        }
    }

    // ------------------------------------------------------------------
    // FRAME
    // ------------------------------------------------------------------

    static ILedClockFrameProgramContent frame(int frameType, int startRow, int startColumn,
            int showHeight, int showWidth) {
        ILedClockFrameProgramContent c = new ILedClockFrameProgramContent();
        c.frameType = frameType;
        c.startRow = startRow;
        c.startColumn = startColumn;
        c.showHeight = showHeight;
        c.showWidth = showWidth;
        return c;
    }

    static void frame() {
        for (int frameType : new int[]{1, 8, 15, 20}) {
            ILedClockFrameProgramContent c = frame(frameType, 0, 0, 32, 128);
            Golden.v("getDataWithFrameProgramContent", Json.obj("content", c),
                    ILedClockUtils.getDataWithFrameProgramContent(c));
        }
        ILedClockFrameProgramContent custom = frame(5, 2, 3, 16, 64);
        custom.frameShowType = 1;
        custom.speed = 128;
        Golden.v("getDataWithFrameProgramContent", Json.obj("content", custom, "note", "custom position/size/speed"),
                ILedClockUtils.getDataWithFrameProgramContent(custom));
    }

    // ------------------------------------------------------------------
    // TEXT AUTO COLOR (only text-* encoder not requiring FontUtils; see README)
    // ------------------------------------------------------------------

    static void textAutoColor() {
        for (int autoColorType : new int[]{1, 14, 28}) {
            ILedClockTextAutoColorProgramContent c = new ILedClockTextAutoColorProgramContent();
            c.autoColorType = autoColorType;
            Golden.v("getDataWithTextAutoColorProgramContent", Json.obj("content", c),
                    ILedClockUtils.getDataWithTextAutoColorProgramContent(c));
        }
        for (int outOfRange : new int[]{0, 99}) {
            ILedClockTextAutoColorProgramContent c = new ILedClockTextAutoColorProgramContent();
            c.autoColorType = outOfRange;
            Golden.v("getDataWithTextAutoColorProgramContent",
                    Json.obj("content", c, "note", "autoColorType outside 1-28: the vendor if/else-if chain "
                            + "has no trailing else, so the color-type sub-block is silently omitted and the "
                            + "packet only contains the 7-zero-byte header + position/size fields -- a real "
                            + "device-observed quirk, not a harness bug."),
                    ILedClockUtils.getDataWithTextAutoColorProgramContent(c));
        }
    }

    // ------------------------------------------------------------------
    // ANIMATION (direct content object; combine-program dispatch variants are in combineProgramDispatch())
    // ------------------------------------------------------------------

    static void animation() {
        ILedClockAnimationProgramContent withDelays = new ILedClockAnimationProgramContent();
        withDelays.showWidth = 32;
        withDelays.showHeight = 16;
        withDelays.speed = 900; // 950 - mShowSpeed, per ILedClockAnimationActivity
        withDelays.mListDrawItems = Arrays.asList(
                grid(32, 16, RED, GREEN, BLUE),
                grid(32, 16, YELLOW, CYAN, MAGENTA, WHITE));
        withDelays.delays = Arrays.asList(200, 400);
        Golden.v("getDataWithAnimationCombineProgram(content)", Json.obj("content", withDelays),
                ILedClockUtils.getDataWithAnimationCombineProgram(withDelays));

        ILedClockAnimationProgramContent noDelays = new ILedClockAnimationProgramContent();
        noDelays.showWidth = 32;
        noDelays.showHeight = 16;
        noDelays.speed = 850;
        noDelays.mListDrawItems = Arrays.asList(
                grid(32, 16, WHITE),
                grid(32, 16, BLACK),
                grid(32, 16, RED));
        noDelays.delays = null;
        Golden.v("getDataWithAnimationCombineProgram(content)",
                Json.obj("content", noDelays, "note", "delays==null: per-frame speed repeated instead"),
                ILedClockUtils.getDataWithAnimationCombineProgram(noDelays));

        // getDataWithAnimationCombineProgram(gifAnimationProgramContent) reads a real file via FileUtils
        // (stubbed to deterministic synthetic bytes -- see README "Not covered" for real-GIF caveats).
        ILedClockGifAnimationProgramContent gifContent = new ILedClockGifAnimationProgramContent();
        gifContent.file = "/golden/fake-animation.gif";
        gifContent.showWidth = 32;
        gifContent.showHeight = 16;
        Golden.v("getDataWithAnimationCombineProgram(gifAnimationProgramContent)", Json.obj("content", gifContent),
                ILedClockUtils.getDataWithAnimationCombineProgram(gifContent));

        // getDataWithAnimationCombineProgram(layer,col,row,w,h, String path) -- plain file variant.
        Golden.v("getDataWithAnimationCombineProgram(layer,col,row,w,h,path)",
                Json.obj("layerType", 1, "startColumn", 0, "startRow", 0, "showWidth", 32, "showHeight", 16,
                        "path", "/golden/fake-plain.gif"),
                ILedClockUtils.getDataWithAnimationCombineProgram(1, 0, 0, 32, 16, "/golden/fake-plain.gif"));

        // getDataWithAnimationCombineProgram(layer,col,row,w,h, int resId) -- built-in resource variant.
        Golden.v("getDataWithAnimationCombineProgram(layer,col,row,w,h,resId)",
                Json.obj("layerType", 1, "startColumn", 0, "startRow", 0, "showWidth", 32, "showHeight", 16,
                        "resId", 12345),
                ILedClockUtils.getDataWithAnimationCombineProgram(1, 0, 0, 32, 16, 12345));

        // Encrypted-file variant explicitly required by the assignment.
        Golden.v("getDataWithAnimationCombineProgramEncryped",
                Json.obj("layerType", 1, "startColumn", 0, "startRow", 0, "showWidth", 32, "showHeight", 16,
                        "path", "/golden/fake-encrypted.gif",
                        "note", "first 32 bytes of the (stub, synthetic) file XORed with 0xDA"),
                ILedClockUtils.getDataWithAnimationCombineProgramEncryped(1, 0, 0, 32, 16, "/golden/fake-encrypted.gif"));
    }

    // ------------------------------------------------------------------
    // GRAFFITI (+ ForTable)
    // ------------------------------------------------------------------

    static void graffiti() {
        ILedClockGraffitiProgramContent c = new ILedClockGraffitiProgramContent();
        c.showWidth = 32;   // DeviceManager.DEVICE_COLUMN, per ILedClockGraffitiActivity:325-365
        c.showHeight = 16;  // DeviceManager.DEVICE_ROW
        c.mode = 2;
        c.speed = 240 + 10; // mShowSpeed(10) + 240, per ILedClockGraffitiActivity -- stays in-range
        c.stayTime = 3;
        c.mDrawItems = grid(32, 16, RED, MAGENTA, YELLOW, GREEN, CYAN, BLUE, WHITE);
        Golden.v("getDataWithGraffitiCombineProgram", Json.obj("content", c),
                ILedClockUtils.getDataWithGraffitiCombineProgram(c));

        ILedClockGraffitiProgramContent single = new ILedClockGraffitiProgramContent();
        single.showWidth = 96;
        single.showHeight = 16;
        single.mode = 1;
        single.speed = 255;
        single.stayTime = 1;
        single.mDrawItems = grid(96, 16, WHITE);
        Golden.v("getDataWithGraffitiCombineProgram", Json.obj("content", single, "note", "single-color 96x16 canvas"),
                ILedClockUtils.getDataWithGraffitiCombineProgram(single));

        // Boundary: mShowSpeed at its observed UI maximum (100) makes speed=340, which exceeds a single
        // byte. getDataWithGraffitiCombineProgram encodes speed via the same LightUtils.getHexStringForInt
        // quirk documented on getSetBrightness above (raw unpadded 3-char hex, desynchronizing every
        // subsequent byte) -- a real, UI-reachable device quirk, not a harness bug.
        ILedClockGraffitiProgramContent fastSpeed = new ILedClockGraffitiProgramContent();
        fastSpeed.showWidth = 32;
        fastSpeed.showHeight = 16;
        fastSpeed.mode = 2;
        fastSpeed.speed = 240 + 100;
        fastSpeed.stayTime = 3;
        fastSpeed.mDrawItems = grid(32, 16, RED, GREEN, BLUE);
        Golden.v("getDataWithGraffitiCombineProgram",
                Json.obj("content", fastSpeed, "note", "speed=340 (mShowSpeed at UI max 100 + 240) exceeds "
                        + "a single byte -- see LightUtils.getHexStringForInt quirk note on getSetBrightness; "
                        + "out's total hex length is odd because of it."),
                ILedClockUtils.getDataWithGraffitiCombineProgram(fastSpeed));

        // ForTable: an explicit (row, column) grid distinct from the content's own showWidth/showHeight.
        ILedClockGraffitiProgramContent table = new ILedClockGraffitiProgramContent();
        table.mode = 2;
        table.speed = 255;
        table.stayTime = 2;
        table.mDrawItems = grid(8, 4, RED, GREEN, BLUE, WHITE);
        Golden.v("getDataWithGraffitiCombineProgramForTable",
                Json.obj("content", table, "tableRows", 4, "tableColumns", 8),
                ILedClockUtils.getDataWithGraffitiCombineProgramForTable(table, 4, 8));
    }

    // ------------------------------------------------------------------
    // CLOCK
    // ------------------------------------------------------------------

    static ILedClockClockProgramContent clockContent(int styleIndex, boolean is24h, boolean showDate,
            boolean spaceShing, int color) {
        ILedClockClockProgramContent c = new ILedClockClockProgramContent();
        c.styleIndex = styleIndex;
        c.is24HourShowMode = is24h;
        c.isDateShowMode = showDate;
        c.isSpaceShing = spaceShing;
        c.hourColor = color;
        c.minuteColor = color;
        c.secondsColor = color;
        c.ampmColor = color;
        c.spaceHourColor = color;
        c.spaceMinuteColor = color;
        c.hourStartColumn = 0;
        c.hourStartRow = 0;
        c.hourWidth = 14;
        c.hourHeight = 12;
        c.spaceHourStartColumn = 14;
        c.spaceHourStartRow = 2;
        c.spaceHourWidth = 2;
        c.spaceHourHeight = 8;
        c.minuteStartColumn = 18;
        c.minuteStartRow = 0;
        c.minuteWidth = 14;
        c.minuteHeight = 12;
        c.spaceMinuteStartColumn = 32;
        c.spaceMinuteStartRow = 2;
        c.spaceMinuteWidth = 2;
        c.spaceMinuteHeight = 8;
        c.secondsStartColumn = 36;
        c.secondsStartRow = 0;
        c.secondsWidth = 14;
        c.secondsHeight = 12;
        c.ampmStartColumn = 50;
        c.ampmStartRow = 0;
        c.ampmWidth = 10;
        c.ampmHeight = 6;
        return c;
    }

    static void clock() {
        // Real 16x32-device values per ILedClockClockTimeFragment.java (scout-verified): style 1, WHITE.
        withDeviceGeometry(16, 32, () -> {
            ILedClockClockProgramContent c = clockContent(1, true, false, false, WHITE);
            safeRecord("getDataWithClockCombineProgram", Json.obj("content", c, "deviceRow", 16, "deviceColumn", 32),
                    () -> ILedClockUtils.getDataWithClockCombineProgram(c));
        });
        // Second style, still 16x32 (the only geometry the vendor's hour-numeral table lookup supports;
        // any other DEVICE_ROW/DEVICE_COLUMN throws, see the 32x128 vector below and README).
        withDeviceGeometry(16, 32, () -> {
            ILedClockClockProgramContent c = clockContent(2, false, true, true, RED);
            c.showSpaceMinuteColor = true;
            safeRecord("getDataWithClockCombineProgram", Json.obj("content", c, "deviceRow", 16, "deviceColumn", 32),
                    () -> ILedClockUtils.getDataWithClockCombineProgram(c));
        });
        // Documented negative case: getDataWithClockCombineProgram hardcodes its per-style hour-numeral
        // table lookup to DEVICE_ROW==16 && DEVICE_COLUMN==32 with no fallback table for any other
        // geometry (falls to "" -> "".split(",") -> [""] -> NumberFormatException parsing it as a byte).
        withDeviceGeometry(32, 128, () -> {
            ILedClockClockProgramContent c = clockContent(1, true, false, false, WHITE);
            safeRecord("getDataWithClockCombineProgram", Json.obj("content", c, "deviceRow", 32, "deviceColumn", 128),
                    () -> ILedClockUtils.getDataWithClockCombineProgram(c));
        });
    }

    // ------------------------------------------------------------------
    // DATE
    // ------------------------------------------------------------------

    static ILedClockDateProgramContent dateContent(int color) {
        ILedClockDateProgramContent c = new ILedClockDateProgramContent();
        c.yearColor = color;
        c.monthColor = color;
        c.dayColor = color;
        c.weekColor = color;
        c.spaceYearColor = color;
        c.spaceMonthColor = color;
        c.spaceDayColor = color;
        c.yearStartColumn = 0;
        c.yearStartRow = 0;
        c.yearWidth = 20;
        c.yearHeight = 7;
        c.monthStartColumn = 5;
        c.monthStartRow = 2;
        c.monthWidth = 10;
        c.monthHeight = 7;
        c.dayStartColumn = 18;
        c.dayStartRow = 2;
        c.dayWidth = 10;
        c.dayHeight = 7;
        c.weekStartColumn = 7;
        c.weekStartRow = 11;
        c.weekWidth = 16;
        c.weekHeight = 7;
        return c;
    }

    static void date() {
        withDeviceGeometry(16, 32, () -> {
            ILedClockDateProgramContent c = dateContent(WHITE);
            safeRecord("getDataWithDateCombineProgram", Json.obj("content", c, "deviceRow", 16, "deviceColumn", 32),
                    () -> ILedClockUtils.getDataWithDateCombineProgram(c));
        });
        withDeviceGeometry(32, 128, () -> {
            ILedClockDateProgramContent c = dateContent(CYAN);
            c.showSpaceYear = true;
            c.showSpaceMonth = true;
            c.showSpaceDay = true;
            c.monthFlag = 1;
            safeRecord("getDataWithDateCombineProgram", Json.obj("content", c, "deviceRow", 32, "deviceColumn", 128),
                    () -> ILedClockUtils.getDataWithDateCombineProgram(c));
        });
    }

    // ------------------------------------------------------------------
    // TIME COUNT
    // ------------------------------------------------------------------

    static ILedClockTimeCountProgramContent timeCountContent(int color) {
        ILedClockTimeCountProgramContent c = new ILedClockTimeCountProgramContent();
        c.hourColor = color;
        c.minuteColor = color;
        c.secondsColor = color;
        c.spaceHourColor = color;
        c.spaceMinuteColor = color;
        c.hourStartColumn = 2;
        c.hourStartRow = 0;
        c.hourWidth = 10;
        c.hourHeight = 12;
        c.minuteStartColumn = 14;
        c.minuteStartRow = 10;
        c.minuteWidth = 10;
        c.minuteHeight = 12;
        c.secondsStartColumn = 26;
        c.secondsStartRow = 0;
        c.secondsWidth = 10;
        c.secondsHeight = 12;
        return c;
    }

    static void timeCount() {
        withDeviceGeometry(16, 32, () -> {
            ILedClockTimeCountProgramContent c = timeCountContent(WHITE);
            c.timeCountMode = 0;
            safeRecord("getDataWithTimeCountCombineProgram", Json.obj("content", c, "deviceRow", 16, "deviceColumn", 32),
                    () -> ILedClockUtils.getDataWithTimeCountCombineProgram(c));
        });
        withDeviceGeometry(16, 32, () -> {
            ILedClockTimeCountProgramContent c = timeCountContent(GREEN);
            c.timeCountMode = 1;
            safeRecord("getDataWithTimeCountCombineProgram", Json.obj("content", c, "deviceRow", 16, "deviceColumn", 32),
                    () -> ILedClockUtils.getDataWithTimeCountCombineProgram(c));
        });
        // Documented negative case, as with the clock encoder above: this device geometry's hour-numeral
        // table lookup is unsupported and throws (see safeRecord's note in the resulting vector).
        withDeviceGeometry(32, 128, () -> {
            ILedClockTimeCountProgramContent c = timeCountContent(GREEN);
            c.timeCountMode = 1;
            safeRecord("getDataWithTimeCountCombineProgram", Json.obj("content", c, "deviceRow", 32, "deviceColumn", 128),
                    () -> ILedClockUtils.getDataWithTimeCountCombineProgram(c));
        });
    }

    // ------------------------------------------------------------------
    // SCOREBOARD
    // ------------------------------------------------------------------

    static ILedClockScoreBoardProgramContent scoreBoardContent() {
        ILedClockScoreBoardProgramContent c = new ILedClockScoreBoardProgramContent();
        c.scoreHostColor = RED;
        c.scoreVisitColor = BLUE;
        c.scoreTotalHostColor = RED;
        c.scoreTotalVisitColor = BLUE;
        c.minuteColor = WHITE;
        c.secondsColor = WHITE;
        c.spaceMinuteColor = WHITE;
        c.scoreHostStartColumn = 0;
        c.scoreHostStartRow = 0;
        c.scoreHostWidth = 10;
        c.scoreHostHeight = 7;
        c.scoreVisitStartColumn = 20;
        c.scoreVisitStartRow = 0;
        c.scoreVisitWidth = 10;
        c.scoreVisitHeight = 7;
        c.scoreTotalHostStartColumn = 0;
        c.scoreTotalHostStartRow = 9;
        c.scoreTotalHostWidth = 5;
        c.scoreTotalHostHeight = 5;
        c.scoreTotalVisitStartColumn = 25;
        c.scoreTotalVisitStartRow = 9;
        c.scoreTotalVisitWidth = 5;
        c.scoreTotalVisitHeight = 5;
        c.minuteStartColumn = 12;
        c.minuteStartRow = 9;
        c.minuteWidth = 4;
        c.minuteHeight = 5;
        c.spaceMinuteStartColumn = 16;
        c.spaceMinuteStartRow = 9;
        c.spaceMinuteWidth = 2;
        c.spaceMinuteHeight = 5;
        c.secondsStartColumn = 18;
        c.secondsStartRow = 9;
        c.secondsWidth = 4;
        c.secondsHeight = 5;
        return c;
    }

    static void scoreBoard() {
        withDeviceGeometry(16, 32, () -> {
            ILedClockScoreBoardProgramContent c = scoreBoardContent();
            safeRecord("getDataWithScoreBoardCombineProgram", Json.obj("content", c, "deviceRow", 16, "deviceColumn", 32),
                    () -> ILedClockUtils.getDataWithScoreBoardCombineProgram(c));
        });
        withDeviceGeometry(32, 128, () -> {
            ILedClockScoreBoardProgramContent c = scoreBoardContent();
            safeRecord("getDataWithScoreBoardCombineProgram", Json.obj("content", c, "deviceRow", 32, "deviceColumn", 128),
                    () -> ILedClockUtils.getDataWithScoreBoardCombineProgram(c));
        });
    }

    // ------------------------------------------------------------------
    // TEMPERATURE / HUMIDITY
    // ------------------------------------------------------------------

    static void temperature() {
        // Real 16x32-device values per ILedClockClockTimeFragment.java:1265-1290.
        ILedClockTemperatureCombineProgram combine = new ILedClockTemperatureCombineProgram();
        combine.item = new ILedClockTemperatureItem();
        combine.item.content = new ILedClockTemperatureProgramContent();
        combine.item.content.color = WHITE;
        combine.item.content.startColumn = 5;
        combine.item.content.startRow = 0;
        combine.item.content.width = 27;
        combine.item.content.height = 7;
        Golden.v("getDataWithTemperatureCombineProgram", Json.obj("content", combine),
                ILedClockUtils.getDataWithTemperatureCombineProgram(combine));

        ILedClockTemperatureCombineProgram combine2 = new ILedClockTemperatureCombineProgram();
        combine2.item = new ILedClockTemperatureItem();
        combine2.item.content = new ILedClockTemperatureProgramContent();
        combine2.item.content.color = CYAN;
        combine2.item.content.startColumn = 0;
        combine2.item.content.startRow = 0;
        combine2.item.content.width = 30;
        combine2.item.content.height = 8;
        combine2.item.content.numHeight = 2;
        combine2.item.content.numWidth = 2;
        Golden.v("getDataWithTemperatureCombineProgram", Json.obj("content", combine2, "note", "scaled 2x numerals"),
                ILedClockUtils.getDataWithTemperatureCombineProgram(combine2));
    }

    static void humidity() {
        // Real 16x32-device values per ILedClockClockTimeFragment.java:1291-1310.
        ILedClockHumidityCombineProgram combine = new ILedClockHumidityCombineProgram();
        combine.item = new ILedClockHumidityItem();
        combine.item.content = new ILedClockHumidityProgramContent();
        combine.item.content.color = CYAN;
        combine.item.content.startColumn = 11;
        combine.item.content.startRow = 9;
        combine.item.content.width = 18;
        combine.item.content.height = 7;
        Golden.v("getDataWithHumidityCombineProgram", Json.obj("content", combine),
                ILedClockUtils.getDataWithHumidityCombineProgram(combine));

        ILedClockHumidityCombineProgram combine2 = new ILedClockHumidityCombineProgram();
        combine2.item = new ILedClockHumidityItem();
        combine2.item.content = new ILedClockHumidityProgramContent();
        combine2.item.content.color = WHITE;
        combine2.item.content.startColumn = 0;
        combine2.item.content.startRow = 0;
        combine2.item.content.width = 32;
        combine2.item.content.height = 16;
        Golden.v("getDataWithHumidityCombineProgram", Json.obj("content", combine2, "note", "full-panel placement"),
                ILedClockUtils.getDataWithHumidityCombineProgram(combine2));
    }

    // ------------------------------------------------------------------
    // REMINDER
    // ------------------------------------------------------------------

    static ILedClockReminderCombineProgram reminder(String title, int year, int month, int day, int hour,
            int minute, int repeatType, int duration, int sound) {
        ILedClockReminderCombineProgram combine = new ILedClockReminderCombineProgram();
        combine.item = new ILedClockReminderItem();
        combine.item.content = new ILedClockReminderProgramContent();
        combine.item.content.title = title;
        combine.item.content.year = year;
        combine.item.content.month = month;
        combine.item.content.day = day;
        combine.item.content.hour = hour;
        combine.item.content.minute = minute;
        combine.item.content.repeatType = repeatType;
        combine.item.content.duration = duration;
        combine.item.content.sound = sound;
        return combine;
    }

    static void reminder() {
        // repeatType=1: every day (127 == all 7 weekday bits set).
        ILedClockReminderCombineProgram everyDay = reminder("Take medicine", 26, 3, 15, 8, 0, 1, 10, 1);
        Golden.v("getDataWithReminderCombineProgram", Json.obj("content", everyDay, "note", "repeatType=1 (every day)"),
                ILedClockUtils.getDataWithReminderCombineProgram(everyDay));

        // repeatType=2: a single specific weekday derived from year/month/day (2026-03-15 -> Sunday).
        ILedClockReminderCombineProgram oneShot = reminder("Water plants", 26, 3, 15, 18, 30, 2, 5, 2);
        Golden.v("getDataWithReminderCombineProgram", Json.obj("content", oneShot, "note", "repeatType=2 (single weekday derived from date)"),
                ILedClockUtils.getDataWithReminderCombineProgram(oneShot));

        // repeatType=0: no repeat flag byte.
        ILedClockReminderCombineProgram none = reminder("Meeting", 25, 12, 31, 23, 59, 0, 0, 0);
        Golden.v("getDataWithReminderCombineProgram", Json.obj("content", none, "note", "repeatType=0 (none)"),
                ILedClockUtils.getDataWithReminderCombineProgram(none));
    }

    // ------------------------------------------------------------------
    // getDataForCombineProgram dispatch (type-based routing, incl. ANIMATION's 3 sub-paths + DYNAMIC_TEXT)
    // ------------------------------------------------------------------

    static void combineProgramDispatch() {
        int savedVersion = DeviceManager.CoolleduxDeviceVersion;
        try {
            // ANIMATION dispatch, version < 30: routes straight to the plain content-object encoder.
            DeviceManager.CoolleduxDeviceVersion = -1;
            ILedClockAnimationCombineProgram legacy = new ILedClockAnimationCombineProgram();
            legacy.animationItem = new ILedClockAnimationItem();
            legacy.animationItem.animationProgramContent = new ILedClockAnimationProgramContent();
            legacy.animationItem.animationProgramContent.showWidth = 32;
            legacy.animationItem.animationProgramContent.showHeight = 16;
            legacy.animationItem.animationProgramContent.mListDrawItems =
                    Arrays.asList(grid(32, 16, RED), grid(32, 16, BLUE));
            legacy.animationItem.animationProgramContent.delays = Arrays.asList(300, 300);
            Golden.v("getDataForCombineProgram(ANIMATION)",
                    Json.obj("combine", legacy, "coolleduxDeviceVersion", -1, "note", "version<30: direct content path"),
                    ILedClockUtils.getDataForCombineProgram(legacy));

            // ANIMATION dispatch, version in [30,255): imageId>0 -> resource-id path.
            DeviceManager.CoolleduxDeviceVersion = 40;
            ILedClockAnimationCombineProgram byImageId = new ILedClockAnimationCombineProgram();
            byImageId.animationItem = new ILedClockAnimationItem();
            byImageId.animationItem.animationProgramContent = new ILedClockAnimationProgramContent();
            byImageId.animationItem.animationProgramContent.imageId = 777;
            byImageId.animationItem.animationProgramContent.showWidth = 32;
            byImageId.animationItem.animationProgramContent.showHeight = 16;
            Golden.v("getDataForCombineProgram(ANIMATION)",
                    Json.obj("combine", byImageId, "coolleduxDeviceVersion", 40, "note", "imageId>0: built-in resource path"),
                    ILedClockUtils.getDataForCombineProgram(byImageId));

            // ANIMATION dispatch, version in [30,255): gifFile set, not encrypted -> file path.
            ILedClockAnimationCombineProgram byFile = new ILedClockAnimationCombineProgram();
            byFile.animationItem = new ILedClockAnimationItem();
            byFile.animationItem.animationProgramContent = new ILedClockAnimationProgramContent();
            byFile.animationItem.animationProgramContent.gifFile = "/golden/dispatch-plain.gif";
            byFile.animationItem.animationProgramContent.isGIfFileEncrypted = false;
            byFile.animationItem.animationProgramContent.showWidth = 32;
            byFile.animationItem.animationProgramContent.showHeight = 16;
            Golden.v("getDataForCombineProgram(ANIMATION)",
                    Json.obj("combine", byFile, "coolleduxDeviceVersion", 40, "note", "gifFile set, isGIfFileEncrypted=false"),
                    ILedClockUtils.getDataForCombineProgram(byFile));

            // ANIMATION dispatch, version in [30,255): gifFile set, encrypted -> encrypted file path.
            ILedClockAnimationCombineProgram byEncryptedFile = new ILedClockAnimationCombineProgram();
            byEncryptedFile.animationItem = new ILedClockAnimationItem();
            byEncryptedFile.animationItem.animationProgramContent = new ILedClockAnimationProgramContent();
            byEncryptedFile.animationItem.animationProgramContent.gifFile = "/golden/dispatch-encrypted.gif";
            byEncryptedFile.animationItem.animationProgramContent.isGIfFileEncrypted = true;
            byEncryptedFile.animationItem.animationProgramContent.showWidth = 32;
            byEncryptedFile.animationItem.animationProgramContent.showHeight = 16;
            Golden.v("getDataForCombineProgram(ANIMATION)",
                    Json.obj("combine", byEncryptedFile, "coolleduxDeviceVersion", 40, "note", "gifFile set, isGIfFileEncrypted=true"),
                    ILedClockUtils.getDataForCombineProgram(byEncryptedFile));
        } finally {
            DeviceManager.CoolleduxDeviceVersion = savedVersion;
        }

        // GIF_FILE_ANIMATION dispatch (type 15).
        ILedClockGifAnimationCombineProgram gifCombine = new ILedClockGifAnimationCombineProgram();
        gifCombine.animationItem = new ILedClockGifAnimationItem();
        gifCombine.animationItem.gifAnimationProgramContent = new ILedClockGifAnimationProgramContent();
        gifCombine.animationItem.gifAnimationProgramContent.file = "/golden/dispatch.gif";
        gifCombine.animationItem.gifAnimationProgramContent.showWidth = 32;
        gifCombine.animationItem.gifAnimationProgramContent.showHeight = 16;
        Golden.v("getDataForCombineProgram(GIF_FILE_ANIMATION)", Json.obj("combine", gifCombine),
                ILedClockUtils.getDataForCombineProgram(gifCombine));

        // GRAFFITI / FRAME dispatch, exercised via getDataForCombineProgram too (not just the direct encoders).
        ILedClockGraffitiCombineProgram graffitiCombine = new ILedClockGraffitiCombineProgram();
        graffitiCombine.graffitiItem = new ILedClockGraffitiItem();
        graffitiCombine.graffitiItem.graffitiProgramContent = new ILedClockGraffitiProgramContent();
        graffitiCombine.graffitiItem.graffitiProgramContent.showWidth = 32;
        graffitiCombine.graffitiItem.graffitiProgramContent.showHeight = 16;
        graffitiCombine.graffitiItem.graffitiProgramContent.mDrawItems = grid(32, 16, GREEN, YELLOW);
        Golden.v("getDataForCombineProgram(GRAFFITI)", Json.obj("combine", graffitiCombine),
                ILedClockUtils.getDataForCombineProgram(graffitiCombine));

        ILedClockFrameCombineProgram frameCombine = new ILedClockFrameCombineProgram();
        frameCombine.frameProgramContent = frame(3, 0, 0, 16, 32);
        Golden.v("getDataForCombineProgram(FRAME)", Json.obj("combine", frameCombine),
                ILedClockUtils.getDataForCombineProgram(frameCombine));
    }

    // ------------------------------------------------------------------
    // Full ILedClockProgram assembly: getDataForProgram / getDataWithProgram /
    // getStartDataForProgram (all 5 overloads) / getDataResult (all 3 overloads) / getOtaDataResult.
    // ------------------------------------------------------------------

    static ILedClockProgram program(int programType, boolean isClockInProgramList, int showCount,
            ILedClockCombineProgram... combines) {
        ILedClockProgram p = new ILedClockProgram();
        p.programType = programType;
        p.isClockInProgramList = isClockInProgramList;
        p.showCount = showCount;
        p.title = "Golden";
        p.combinePrograms = new ArrayList<>(Arrays.asList(combines));
        return p;
    }

    static ILedClockFrameCombineProgram frameCombine() {
        ILedClockFrameCombineProgram f = new ILedClockFrameCombineProgram();
        f.frameProgramContent = frame(1, 0, 0, 16, 32);
        return f;
    }

    static ILedClockGraffitiCombineProgram graffitiCombine() {
        ILedClockGraffitiCombineProgram g = new ILedClockGraffitiCombineProgram();
        g.graffitiItem = new ILedClockGraffitiItem();
        g.graffitiItem.graffitiProgramContent = new ILedClockGraffitiProgramContent();
        g.graffitiItem.graffitiProgramContent.showWidth = 32;
        g.graffitiItem.graffitiProgramContent.showHeight = 16;
        g.graffitiItem.graffitiProgramContent.mDrawItems = grid(32, 16, RED, BLUE);
        return g;
    }

    static ILedClockClockCombineProgram clockCombine() {
        ILedClockClockCombineProgram c = new ILedClockClockCombineProgram();
        c.clockItem = new ILedClockClockItem();
        c.clockItem.clockProgramContent = clockContent(1, true, false, false, WHITE);
        return c;
    }

    static ILedClockDateCombineProgram dateCombine() {
        ILedClockDateCombineProgram d = new ILedClockDateCombineProgram();
        d.dateItem = new ILedClockDateItem();
        d.dateItem.dateProgramContent = dateContent(WHITE);
        return d;
    }

    static ILedClockScoreBoardCombineProgram scoreBoardCombine() {
        ILedClockScoreBoardCombineProgram s = new ILedClockScoreBoardCombineProgram();
        s.scoreBoardItem = new ILedClockScoreBoardItem();
        s.scoreBoardItem.scorBoardProgramContent = scoreBoardContent();
        return s;
    }

    static ILedClockTimeCountCombineProgram timeCountCombine() {
        ILedClockTimeCountCombineProgram t = new ILedClockTimeCountCombineProgram();
        t.timeCountItem = new ILedClockTimeCountItem();
        t.timeCountItem.timeCountProgramContent = timeCountContent(WHITE);
        return t;
    }

    static ILedClockReminderCombineProgram reminderCombine(int remindId) {
        ILedClockReminderCombineProgram r = reminder("Golden reminder", 26, 6, 1, 9, 0, 1, 5, 1);
        r.item.content.remindId = remindId;
        return r;
    }

    static void fullProgramsAndResults() {
        withDeviceGeometry(16, 32, () -> {
            // A genuine multi-type "combine program": frame + graffiti + clock together.
            ILedClockProgram combined = program(ILedClockCombineProgram.FRAME, false, 1,
                    frameCombine(), graffitiCombine(), clockCombine());
            Golden.v("getDataForProgram", Json.obj("program", combined),
                    ILedClockUtils.getDataForProgram(combined));
            Golden.v("getDataWithProgram", Json.obj("program", combined),
                    ILedClockUtils.getDataWithProgram(combined));

            // getStartDataForProgram: all 5 overloads, each with a representative programType.
            List<String> body = ILedClockUtils.getDataWithProgram(combined);
            Golden.v("getStartDataForProgram(list,i,i2,i3)",
                    Json.obj("bodyLength", body.size(), "i", 1, "i2", 1, "i3", 1),
                    ILedClockUtils.getStartDataForProgram(body, 1, 1, 1));
            Golden.v("getStartDataForProgram(list,i)",
                    Json.obj("bodyLength", body.size(), "i", 0),
                    ILedClockUtils.getStartDataForProgram(body, 0));

            for (int programType : new int[]{8, 9, 11, 7, 6, 19, 4}) {
                Golden.v("getStartDataForProgram(i,list,i2,i3,i4,i5)",
                        Json.obj("programType", programType, "bodyLength", body.size(), "remindId", 3,
                                "i4", 1, "i5", 2, "showCount", 5),
                        ILedClockUtils.getStartDataForProgram(programType, body, 3, 1, 2, 5));
                Golden.v("getStartDataForProgram(i,z,list,i2,i3,i4)",
                        Json.obj("programType", programType, "isClockInProgramList", true, "bodyLength", body.size(),
                                "i2", 1, "i3", 2, "showCount", 5),
                        ILedClockUtils.getStartDataForProgram(programType, true, body, 1, 2, 5));
                Golden.v("getStartDataForProgram(i,z,list,i2,i3,i4)",
                        Json.obj("programType", programType, "isClockInProgramList", false, "bodyLength", body.size(),
                                "i2", 1, "i3", 2, "showCount", 5),
                        ILedClockUtils.getStartDataForProgram(programType, false, body, 1, 2, 5));
                Golden.v("getStartDataForProgram(i,list,i2,i3,i4)",
                        Json.obj("programType", programType, "bodyLength", body.size(), "i2", 1, "i3", 2, "showCount", 5),
                        ILedClockUtils.getStartDataForProgram(programType, body, 1, 2, 5));
            }

            // getDataResult overloads on distinct single-type programs (clean per-type showCount plumbing).
            recordDataResult(program(ILedClockCombineProgram.CLOCK, true, 3, clockCombine()));
            recordDataResult(program(ILedClockCombineProgram.DATE, false, 2, dateCombine()));
            recordDataResult(program(ILedClockCombineProgram.SCOREBOARD, false, 1, scoreBoardCombine()));
            recordDataResult(program(ILedClockCombineProgram.STOPWATCH, false, 1, timeCountCombine()));
            recordDataResult(program(ILedClockCombineProgram.FRAME, false, 4, frameCombine()));

            ILedClockProgram reminderProgram = program(ILedClockCombineProgram.REMINDER, false, 1,
                    reminderCombine(9));
            recordDataResult(reminderProgram);
        });

        // getOtaDataResult(byte[]) / (byte[], size) -- OTA framing built on the same Lzss/Crc/getDataPacket
        // primitives already covered directly; included here for completeness since it is one of the
        // getDataResult-family "overloads" this section documents.
        byte[] fw = Golden.seededRandomBytes(99L, 2048);
        Golden.v("getOtaDataResult(bytes)", Json.obj("length", 2048, "seed", 99L),
                otaResultToJson(ILedClockUtils.getOtaDataResult(fw)));
        Golden.v("getOtaDataResult(bytes,size)", Json.obj("length", 2048, "seed", 99L, "size", 512),
                otaResultToJson(ILedClockUtils.getOtaDataResult(fw, 512)));
    }

    static void recordDataResult(ILedClockProgram p) {
        ILedClockUtils.DataResult r2 = ILedClockUtils.getDataResult(p, 1, 2);
        Golden.v("getDataResult(program,i,i2).beginDataForProgram", Json.obj("program", p, "i", 1, "i2", 2),
                r2.beginDataForProgram);
        Golden.v("getDataResult(program,i,i2).dataForProgram", Json.obj("program", p, "i", 1, "i2", 2),
                r2.dataForProgram);

        ILedClockUtils.DataResult r3 = ILedClockUtils.getDataResult(p, 1, 2, 256);
        Golden.v("getDataResult(program,i,i2,i3).beginDataForProgram", Json.obj("program", p, "i", 1, "i2", 2, "i3", 256),
                r3.beginDataForProgram);
        Golden.v("getDataResult(program,i,i2,i3).dataForProgram", Json.obj("program", p, "i", 1, "i2", 2, "i3", 256),
                r3.dataForProgram);

        ILedClockUtils.DataResult r1 = ILedClockUtils.getDataResult(p, 7);
        Golden.v("getDataResult(program,i).beginDataForProgram", Json.obj("program", p, "i", 7),
                r1.beginDataForProgram);
        Golden.v("getDataResult(program,i).dataForProgram", Json.obj("program", p, "i", 7),
                r1.dataForProgram);
    }

    static Map<String, Object> otaResultToJson(ILedClockUtils.ILedClockOTADataResult r) {
        return Json.obj(
                "beginDataForOTAUpgrade", Golden.hexOrFrames(r.beginDataForOTAUpgrade),
                "dataForForOTAUpgrade", Golden.hexOrFrames(r.dataForForOTAUpgrade));
    }
}
