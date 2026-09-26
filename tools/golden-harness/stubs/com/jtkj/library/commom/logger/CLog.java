package com.jtkj.library.commom.logger;

/** STUB: no-op logger with the same method surface as the real CLog. */
public final class CLog {
    private CLog() {}

    public static boolean isDebug() {
        return false;
    }

    public static void setIsDebug(boolean debug) {}

    public static void v(String tag, String msg) {}

    public static void v(String tag, String msg, Throwable t) {}

    public static void d(String tag, String msg) {}

    public static void d(String tag, String msg, Throwable t) {}

    public static void i(String tag, Throwable t) {}

    public static void i(String tag, String msg) {}

    public static void i(String tag, String msg, Throwable t) {}

    public static void w(String tag, String msg) {}

    public static void w(String tag, String msg, Throwable t) {}

    public static void e(String tag, String msg) {}

    public static void e(String tag, String msg, Throwable t) {}
}
