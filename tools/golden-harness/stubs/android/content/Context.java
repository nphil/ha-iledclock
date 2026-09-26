package android.content;

import java.io.IOException;
import java.io.InputStream;

/**
 * STUB: minimal surface so vendor code compiles. Only ILedClockUtils.getOTAData(Context)
 * calls through Context -> Resources -> AssetManager, and that method is out of scope
 * for the golden vectors (no real asset bundle available); see README "Not covered".
 */
public class Context {
    public static class AssetManager {
        public InputStream open(String fileName) throws IOException {
            throw new IOException("stub Context: no assets available in golden harness");
        }
    }

    public static class Resources {
        private final AssetManager assets = new AssetManager();

        public AssetManager getAssets() {
            return assets;
        }

        public InputStream openRawResource(int id) {
            throw new UnsupportedOperationException("stub Context: no raw resources available in golden harness");
        }
    }

    private final Resources resources = new Resources();

    public Resources getResources() {
        return resources;
    }
}
