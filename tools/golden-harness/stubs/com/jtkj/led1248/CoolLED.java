package com.jtkj.led1248;

import android.content.Context;

/** STUB: minimal surface — a singleton-like Context provider and a no-op error reporter. */
public final class CoolLED {
    private static final Context INSTANCE = new Context();

    private CoolLED() {}

    public static Context getInstance() {
        return INSTANCE;
    }

    public static void reportError(String message) {
        // no-op
    }

    public static void reportError(Throwable t) {
        // no-op
    }
}
