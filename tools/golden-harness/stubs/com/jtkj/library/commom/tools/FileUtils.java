package com.jtkj.library.commom.tools;

import android.content.Context;

/**
 * STUB: the real FileUtils reads GIF/raw-image bytes from disk or Android
 * resources, neither of which exist in this harness. Instead of real file
 * content we return a deterministic pseudo-random byte sequence derived
 * from the requested path/resource id (LCG seeded by String.hashCode()), so
 * repeated builds are byte-identical and the derivation is fully
 * documented/reproducible. See README "Not covered" for the vendor call
 * sites that depend on real external assets.
 */
public final class FileUtils {
    private FileUtils() {}

    public static byte[] readFileToBytes(String path) {
        return syntheticBytes("file:" + path, 256);
    }

    public static byte[] readRawImageBytes(Context context, int resId) {
        return syntheticBytes("raw:" + resId, 256);
    }

    /** Deterministic LCG byte stream from a string seed; documented in README. */
    static byte[] syntheticBytes(String seed, int length) {
        byte[] out = new byte[length];
        int state = seed.hashCode();
        for (int i = 0; i < length; i++) {
            state = state * 1103515245 + 12345;
            out[i] = (byte) (state >>> 16);
        }
        return out;
    }
}
