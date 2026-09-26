package android.text;

/** STUB: only the one static helper the vendor encoders call. */
public final class TextUtils {
    private TextUtils() {}

    public static boolean isEmpty(CharSequence str) {
        return str == null || str.length() == 0;
    }
}
