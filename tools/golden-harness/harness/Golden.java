import com.jtkj.led1248.light.device.DeviceManager;
import com.jtkj.led1248.light.device.ILedClockManager;
import com.jtkj.led1248.light.utils.ILedClockUtils;
import com.jtkj.led1248.light.utils.LightUtils;
import com.jtkj.led1248.widget.DrawView;

import java.io.BufferedWriter;
import java.io.FileWriter;
import java.io.Writer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TimeZone;

/**
 * Golden-vector generator: calls the REAL, unmodified vendor ILedClockUtils
 * (and LightUtils) methods copied into vendor/, and records every call as
 * {fn, args, out} into vectors.json. See README.md for the full coverage
 * table, stub inventory, and documented non-determinism (Random/Calendar).
 */
public class Golden {
    static final List<Object> VECTORS = new ArrayList<>();

    public static void main(String[] rawArgs) throws Exception {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));

        framing();
        simpleBuilders();
        lzssAndCrc();
        dataPacket();
        programEncoders();

        String path = rawArgs.length > 0 ? rawArgs[0] : "vectors.json";
        try (Writer w = new BufferedWriter(new FileWriter(path))) {
            w.write(Json.write(VECTORS));
        }
        System.out.println("Wrote " + VECTORS.size() + " vectors to " + path);
    }

    // ------------------------------------------------------------------
    // recording helpers
    // ------------------------------------------------------------------

    static String hex(List<String> parts) {
        return String.join("", parts);
    }

    @SuppressWarnings("unchecked")
    static Object hexOrFrames(Object raw) {
        if (raw == null) return null;
        if (raw instanceof String) return raw;
        if (raw instanceof List) {
            List<?> l = (List<?>) raw;
            if (!l.isEmpty() && l.get(0) instanceof List) {
                List<Object> frames = new ArrayList<>();
                for (Object frame : l) frames.add(hex((List<String>) frame));
                return frames;
            }
            return hex((List<String>) l);
        }
        if (raw instanceof Map) return raw;
        throw new IllegalArgumentException("unsupported out type: " + raw.getClass());
    }

    static void v(String fn, Map<String, Object> args, Object rawOut) {
        VECTORS.add(Json.obj("fn", fn, "args", args, "out", hexOrFrames(rawOut)));
    }

    static String hex32(int value) {
        return String.format("%08x", value);
    }

    static List<String> hexList(byte[] arr) {
        return LightUtils.byte2hex(arr);
    }

    static List<String> hexTokens(String... tokens) {
        return new ArrayList<>(Arrays.asList(tokens));
    }

    /** Splits a flat hex string ("0102ff...") into 2-char byte tokens, e.g. for the live BLE replies. */
    static List<String> splitHex(String flat) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i + 2 <= flat.length(); i += 2) out.add(flat.substring(i, i + 2));
        return out;
    }

    static byte[] zeros(int n) {
        return new byte[n];
    }

    static byte[] seededRandomBytes(long seed, int n) {
        Random r = new Random(seed);
        byte[] out = new byte[n];
        r.nextBytes(out);
        return out;
    }

    static byte[] repeatingBuffer(int n, byte... pattern) {
        byte[] out = new byte[n];
        for (int i = 0; i < n; i++) out[i] = pattern[i % pattern.length];
        return out;
    }

    static byte[] sequentialBytes(int n) {
        byte[] out = new byte[n];
        for (int i = 0; i < n; i++) out[i] = (byte) (i & 0xFF);
        return out;
    }

    static List<String> hexRange(int n) {
        // "10, 1024, 1025, 5000 byte lists" for getDataPacket: content values don't matter to the vendor
        // algorithm (pure length-based splitting + checksum), so a simple counting sequence is used.
        List<String> out = new ArrayList<>();
        for (int i = 0; i < n; i++) out.add(LightUtils.getHexStringForInt(i & 0xFF));
        return out;
    }

    // ------------------------------------------------------------------
    // 1. Framing: getSendDataWithInfo / recoverData
    // ------------------------------------------------------------------

    static void framing() {
        List<String> boundaryBytes = hexTokens("00", "01", "02", "03", "04", "ff");
        v("getSendDataWithInfo",
                Json.obj("payload", boundaryBytes, "note", "boundary escape bytes 00,01,02,03,04,ff"),
                ILedClockUtils.getSendDataWithInfo(boundaryBytes));

        List<String> longPayload = hexRange(300);
        v("getSendDataWithInfo",
                Json.obj("payloadLength", 300, "payload", longPayload),
                ILedClockUtils.getSendDataWithInfo(longPayload));

        List<String> longPayload2 = hexList(seededRandomBytes(20260925L, 512));
        v("getSendDataWithInfo",
                Json.obj("payloadLength", 512, "payloadSeed", 20260925L, "note", "512-byte seeded-random payload"),
                ILedClockUtils.getSendDataWithInfo(longPayload2));

        // recoverData: the three live device replies named in the assignment, plus round-trips of
        // the frames just generated above (both directions of the framing protocol).
        String[] liveReplies = {
                "0100181f0205a300000000020509020504020700000400002100100000000503",
                "010022fd020500211d4143363935585f30315f313678363535333555585f303030303034303003",
                "01000c14020602051500080002051902051e0603",
        };
        for (String reply : liveReplies) {
            List<String> framed = splitHex(reply);
            v("recoverData",
                    Json.obj("framedReplyHex", reply),
                    ILedClockUtils.recoverData(framed));
        }

        v("recoverData",
                Json.obj("note", "round-trip of getSendDataWithInfo(boundary escape bytes)", "payload", boundaryBytes),
                ILedClockUtils.recoverData(ILedClockUtils.getSendDataWithInfo(boundaryBytes)));
        v("recoverData",
                Json.obj("note", "round-trip of getSendDataWithInfo(300-byte payload)", "payloadLength", 300),
                ILedClockUtils.recoverData(ILedClockUtils.getSendDataWithInfo(longPayload)));
    }

    // ------------------------------------------------------------------
    // 2. Every simple builder, ILedClockUtils.java lines 4732-5337
    // ------------------------------------------------------------------

    static void simpleBuilders() {
        v("getDeviceInfo", Json.obj(), ILedClockUtils.getDeviceInfo());

        for (boolean on : new boolean[]{true, false}) {
            v("getSwitchData", Json.obj("on", on), ILedClockUtils.getSwitchData(on));
        }

        for (int b : new int[]{0, 1, 50, 100, 255, 256}) {
            Map<String, Object> args = Json.obj("brightness", b);
            if (b == 256) {
                args.put("note", "out of single-byte range: LightUtils.getHexStringForInt (singular) only "
                        + "zero-pads Integer.toHexString(i) when it is exactly 1 character (i.e. i<16); for "
                        + "16<=i<=255 toHexString is already 2 hex chars, but for i>=256 it returns 3+ RAW "
                        + "hex characters with no padding or truncation, desynchronizing every subsequent "
                        + "byte's alignment in the packet -- a real device-observed quirk (note the odd "
                        + "total hex length of 'out' below), not a harness bug. See README.");
            }
            v("getSetBrightness", args, ILedClockUtils.getSetBrightness(b));
        }

        for (boolean on : new boolean[]{true, false}) {
            v("getSetMirror", Json.obj("mirror", on), ILedClockUtils.getSetMirror(on));
        }

        for (String pw : new String[]{"0000", "1234", "abcd", "9999"}) {
            recordPasswordVector("getCheckPasswordData", pw, ILedClockUtils.getCheckPasswordData(pw));
            recordPasswordVector("getSetPasswordData", pw, ILedClockUtils.getSetPasswordData(pw));
        }

        List<String> otaBytes = hexList(seededRandomBytes(42L, 4096));
        v("getStartOTAUpdate", Json.obj("dataLength", 4096, "seed", 42L), ILedClockUtils.getStartOTAUpdate(otaBytes));
        v("getOTAUpdate", Json.obj("dataLength", 4096, "seed", 42L), ILedClockUtils.getOTAUpdate(otaBytes));

        v("getMusicDataString", Json.obj("mode", 3, "levels", new int[]{1, 5, 10, 15, 20, 25, 30}),
                ILedClockUtils.getMusicDataString(3, new int[]{1, 5, 10, 15, 20, 25, 30}));

        for (int rhythm : new int[]{0, 1, 5, 300}) {
            Map<String, Object> args = Json.obj("type", rhythm);
            if (rhythm == 300) {
                args.put("note", "out of single-byte range: this method uses the DIFFERENT sibling helper "
                        + "LightUtils.getHexListStringForInt (plural/List-returning, not getHexStringForInt), "
                        + "whose length-3+ branch is simply absent -- for i>=256 it falls through every 'if' "
                        + "and returns an EMPTY list, silently omitting the type byte entirely (the packet is "
                        + "shorter, not misaligned, unlike getSetBrightness's out-of-range quirk above). See README.");
            }
            v("getSetRyhthmType", args, ILedClockUtils.getSetRyhthmType(rhythm));
        }

        recordSynchronizeTime();

        v("getStopwatchStatus", Json.obj(), ILedClockUtils.getStopwatchStatus());
        v("getStopwatchReset", Json.obj(), ILedClockUtils.getStopwatchReset());
        for (boolean on : new boolean[]{true, false}) {
            v("getStopwatchStartOrStop", Json.obj("start", on), ILedClockUtils.getStopwatchStartOrStop(on));
        }

        v("getCountDownStatus", Json.obj(), ILedClockUtils.getCountDownStatus());
        v("getCountDownReset", Json.obj("hour", 0, "minute", 10, "second", 30),
                ILedClockUtils.getCountDownReset(0, 10, 30));
        for (boolean on : new boolean[]{true, false}) {
            v("getCountDownStartOrStop", Json.obj("start", on), ILedClockUtils.getCountDownStartOrStop(on));
        }

        v("getScoreBoardStatus", Json.obj(), ILedClockUtils.getScoreBoardStatus());
        v("getScoreBoardSetCore", Json.obj("hostScore", 7, "visitScore", 3, "hostTotal", 12, "visitTotal", 9),
                ILedClockUtils.getScoreBoardSetCore(7, 3, 12, 9));
        for (boolean countDown : new boolean[]{true, false}) {
            v("getScoreBoardSetTime", Json.obj("minute", 8, "second", 45, "countDown", countDown),
                    ILedClockUtils.getScoreBoardSetTime(8, 45, countDown));
        }
        for (boolean on : new boolean[]{true, false}) {
            v("getScoreBoardStartOrStop", Json.obj("start", on), ILedClockUtils.getScoreBoardStartOrStop(on));
        }

        v("getTimerSwitch", Json.obj(), ILedClockUtils.getTimerSwitch());
        v("setTimerSwitch", Json.obj("items", new ArrayList<>()), ILedClockUtils.setTimerSwitch(null));
        v("setTimerSwitch", Json.obj("items", Json.arr()), ILedClockUtils.setTimerSwitch(new ArrayList<>()));

        List<DeviceManager.TimerSwitchItem> timers = new ArrayList<>();
        timers.add(timerItem(7, 30, true, false, true, false, true, false, true, true, false, true));
        timers.add(timerItem(22, 0, true, true, true, true, true, true, true, true, true, false));
        v("setTimerSwitch", Json.obj("items", timers), ILedClockUtils.setTimerSwitch(timers));

        v("setDeviceInfo", Json.obj("action", 1, "enabled", true), ILedClockUtils.setDeviceInfo(1, true));
        v("setDeviceInfo", Json.obj("action", 2, "enabled", false), ILedClockUtils.setDeviceInfo(2, false));
        v("setDeviceInfo", Json.obj("action", 3, "enabled", true), ILedClockUtils.setDeviceInfo(3, true));

        v("setDeviceVolume", Json.obj("volume", 8), ILedClockUtils.setDeviceVolume(8));
        v("setRotate", Json.obj("rotate", 1), ILedClockUtils.setRotate(1));

        int[] colors = {0xFFFF0000, 0xFF00FF00, 0xFF0000FF, 0xFFFFFFFF, 0xFF000000, 0xFF123456};
        for (int c : colors) {
            v("setColor", Json.obj("colorArgb", hex32(c), "speed", 128), ILedClockUtils.setColor(c, 128));
        }

        for (int c : colors) {
            for (int pixelCount : new int[]{48, 200}) {
                v("adjustPower", Json.obj("colorArgb", hex32(c), "pixelCount", pixelCount),
                        hex32(ILedClockUtils.adjustPower(c, pixelCount)));
            }
        }

        v("setColorSpeed", Json.obj("speed", 40), ILedClockUtils.setColorSpeed(40));

        for (int mode = 0; mode <= 32; mode++) {
            v("setColorMode", Json.obj("mode", mode), ILedClockUtils.setColorMode(mode));
        }

        v("getDeviceOTAVersion", Json.obj(), ILedClockUtils.getDeviceOTAVersion());

        List<ILedClockManager.TomatoClockItem> tomatoes = new ArrayList<>();
        tomatoes.add(new ILedClockManager.TomatoClockItem(25));
        tomatoes.add(new ILedClockManager.TomatoClockItem(5));
        v("getSetTomatoClockTime", Json.obj("items", tomatoes), ILedClockUtils.getSetTomatoClockTime(tomatoes));
        v("getTomatoClockTime", Json.obj(), ILedClockUtils.getTomatoClockTime());

        List<ILedClockManager.ILedClockAlarmClockItem> alarms = new ArrayList<>();
        alarms.add(alarmItem(7, 0, true, true, false, true, false, true, false, true, false, 30, 9));
        alarms.add(alarmItem(21, 30, false, false, false, false, false, false, false, false, true, 15, 0));
        v("getSetAlarmClockTime", Json.obj("items", alarms), ILedClockUtils.getSetAlarmClockTime(alarms));
        v("getSetAlarmClockTime", Json.obj("items", Json.arr()), ILedClockUtils.getSetAlarmClockTime(new ArrayList<>()));
        v("getAlarmClockTime", Json.obj(), ILedClockUtils.getAlarmClockTime());

        v("getTemperatureAndHumidity", Json.obj("type", 1), ILedClockUtils.getTemperatureAndHumidity(1));
        v("getTemperatureAndHumidity", Json.obj("type", 2), ILedClockUtils.getTemperatureAndHumidity(2));

        v("getNightMode", Json.obj(), ILedClockUtils.getNightMode());
        v("getSetNightMode",
                Json.obj("nightModeEnabled", 1, "startHour", 22, "startMinute", 0, "endHour", 6, "endMinute", 30,
                        "deviceStateEnabled", 1, "brightness", 3, "wakeUpDuration", 10, "voiceControlEnabled", 1,
                        "voiceSensitivity", 2),
                ILedClockUtils.getSetNightMode(1, 22, 0, 6, 30, 1, 3, 10, 1, 2));

        v("getReminder", Json.obj(), ILedClockUtils.getReminder());
        v("getDeleteReminder", Json.obj("id", 4), ILedClockUtils.getDeleteReminder(4));
        v("getReminderDetail", Json.obj("id", 4), ILedClockUtils.getReminderDetail(4));
    }

    static DeviceManager.TimerSwitchItem timerItem(int hour, int minute, boolean enable, boolean never,
            boolean mon, boolean tue, boolean wed, boolean thu, boolean fri, boolean sat, boolean sun,
            boolean setDeviceOn) {
        DeviceManager.TimerSwitchItem t = new DeviceManager.TimerSwitchItem();
        t.hour = hour;
        t.minute = minute;
        t.enable = enable;
        t.isNever = never;
        t.isMondayOn = mon;
        t.isTuesdayOn = tue;
        t.isWednesdayOn = wed;
        t.isThursdayOn = thu;
        t.isFridayOn = fri;
        t.isSaturdayOn = sat;
        t.isSundayOn = sun;
        t.isSetDeviceOn = setDeviceOn;
        return t;
    }

    static ILedClockManager.ILedClockAlarmClockItem alarmItem(int hour, int minute, boolean never,
            boolean mon, boolean tue, boolean wed, boolean thu, boolean fri, boolean sat, boolean sun,
            boolean enable, int duration, int reminderDuration) {
        ILedClockManager.ILedClockAlarmClockItem a = new ILedClockManager.ILedClockAlarmClockItem();
        a.hour = hour;
        a.minute = minute;
        a.isNever = never;
        a.isMondayOn = mon;
        a.isTuesdayOn = tue;
        a.isWednesdayOn = wed;
        a.isThursdayOn = thu;
        a.isFridayOn = fri;
        a.isSaturdayOn = sat;
        a.isSundayOn = sun;
        a.enable = enable;
        a.duration = duration;
        a.reminderDuration = reminderDuration;
        return a;
    }

    /** Extracts the vendor-chosen java.util.Random byte back out of the encoded output; see README. */
    static void recordPasswordVector(String fn, String password, List<String> out) {
        List<String> inner = ILedClockUtils.recoverData(out);
        String randomByteHex = inner.get(1);
        Map<String, Object> args = Json.obj(
                "password", password,
                "randomByteHex", randomByteHex,
                "formula", "byte[1] = new java.util.Random().nextInt(256) (unseeded, differs per run); "
                        + "each password hex-nibble is XORed with byte[1]; final byte = XOR of all bytes "
                        + "from index 2 onward (checksum). randomByteHex above was recovered from this "
                        + "run's own output via ILedClockUtils.recoverData, not independently seeded.");
        v(fn, args, out);
    }

    /** getSynchronizeTime() reads the live wall clock; fields are decoded back out of its own output. */
    static void recordSynchronizeTime() {
        List<String> out = ILedClockUtils.getSynchronizeTime();
        List<String> inner = ILedClockUtils.recoverData(out);
        // inner = ["09", yearOffsetFrom2000, month, day, weekValue, hour, minute, second]
        Map<String, Object> args = Json.obj(
                "note", "time-dependent: fields decoded back out of this run's own output "
                        + "(java.util.Calendar.getInstance() with JVM default TimeZone forced to UTC "
                        + "at harness startup). weekValue mapping: Mon=1..Sat=6,Sun=7 (Calendar.DAY_OF_WEEK "
                        + "remapped by ILedClockUtils itself, not by this harness).",
                "yearOffsetFrom2000Hex", inner.get(1),
                "monthHex", inner.get(2),
                "dayHex", inner.get(3),
                "weekValueHex", inner.get(4),
                "hourHex", inner.get(5),
                "minuteHex", inner.get(6),
                "secondHex", inner.get(7));
        v("getSynchronizeTime", args, out);
    }

    // ------------------------------------------------------------------
    // 3. LzssCompress + CrcCode
    // ------------------------------------------------------------------

    static void lzssAndCrc() {
        Map<String, byte[]> buffers = new LinkedHashMap<>();
        buffers.put("empty", new byte[0]);
        buffers.put("1byte", new byte[]{(byte) 0xAB});
        buffers.put("100zeros", zeros(100));
        buffers.put("1000randomSeed7", seededRandomBytes(7L, 1000));
        buffers.put("5000repetitive", repeatingBuffer(5000, (byte) 0xCA, (byte) 0xFE));

        for (Map.Entry<String, byte[]> e : buffers.entrySet()) {
            String label = e.getKey();
            byte[] buf = e.getValue();
            List<String> asHexList = hexList(buf);

            byte[] compressed = ILedClockUtils.LzssCompress.lazssCompress(buf);
            Map<String, Object> lazssArgs = Json.obj("label", label, "inputLength", buf.length);
            if (compressed == null) {
                lazssArgs.put("note", "vendor lazssCompress(byte[]) returns null for zero-length input "
                        + "(textsize==0 short-circuit) -- out is JSON null, not an empty string. See README.");
                v("LzssCompress.lazssCompress", lazssArgs, (Object) null);
            } else {
                v("LzssCompress.lazssCompress", lazssArgs, hexList(compressed));
            }

            if (buf.length == 0) {
                v("LzssCompress.getLzssCompressData", Json.obj("label", label, "inputLength", 0,
                                "note", "SKIPPED: vendor getLzssCompressData(list) calls "
                                        + "LightUtils.byte2hex(lazssCompress(...)) unconditionally; since "
                                        + "lazssCompress returns null for empty input, the real vendor code "
                                        + "throws a NullPointerException here (byte2hex iterates a null "
                                        + "array). Captured via LzssCompress.lazssCompress directly instead."),
                        (Object) null);
            } else {
                v("LzssCompress.getLzssCompressData", Json.obj("label", label, "inputLength", buf.length),
                        ILedClockUtils.LzssCompress.getLzssCompressData(asHexList));
            }

            int crc1 = ILedClockUtils.CrcCode.getCrc32CheckCode(buf);
            v("CrcCode.getCrc32CheckCode", Json.obj("label", label, "inputLength", buf.length), hex32(crc1));

            int crc2 = ILedClockUtils.CrcCode.getCrc32CheckCode2(buf);
            v("CrcCode.getCrc32CheckCode2", Json.obj("label", label, "inputLength", buf.length), hex32(crc2));

            v("CrcCode.getCrcCode", Json.obj("label", label, "inputLength", buf.length),
                    ILedClockUtils.CrcCode.getCrcCode(asHexList));
        }
    }

    // ------------------------------------------------------------------
    // 4. getDataPacket(list, tag[, size])
    // ------------------------------------------------------------------

    static void dataPacket() {
        for (int n : new int[]{10, 1024, 1025, 5000}) {
            List<String> list = hexRange(n);
            v("getDataPacket(list,tag)", Json.obj("length", n, "tag", "03"),
                    ILedClockUtils.getDataPacket(list, "03"));
            v("getDataPacket(list,tag,size)", Json.obj("length", n, "tag", "03", "size", 256),
                    ILedClockUtils.getDataPacket(list, "03", 256));
        }
    }

    // ------------------------------------------------------------------
    // 5. Program encoders (2598-4730) -- see ProgramEncoders.java
    // ------------------------------------------------------------------

    static void programEncoders() {
        ProgramEncoders.run();
    }
}
