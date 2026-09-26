import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON value model + writer (no external deps) plus a generic
 * reflective dumper that turns any vendor POJO (ILedClockManager content
 * classes, DrawView.DrawItem, DeviceManager.TimerSwitchItem, ...) into a
 * plain Map/List/primitive tree by walking its public instance fields.
 * This keeps Golden.java's "args" payloads complete and 1:1 with the real
 * constructed objects without hand-duplicating every field name.
 */
final class Json {
    private Json() {}

    /** Recursively converts an arbitrary value into JSON-writable Map/List/primitive/null. */
    static Object toJsonValue(Object o) {
        if (o == null) return null;
        if (o instanceof String || o instanceof Number || o instanceof Boolean) return o;
        if (o instanceof int[]) {
            List<Object> out = new ArrayList<>();
            for (int v : (int[]) o) out.add(v);
            return out;
        }
        if (o instanceof byte[]) {
            // represented as a plain array of unsigned ints; callers that want hex use hex() explicitly
            List<Object> out = new ArrayList<>();
            for (byte b : (byte[]) o) out.add(b & 0xFF);
            return out;
        }
        if (o instanceof List) {
            List<Object> out = new ArrayList<>();
            for (Object item : (List<?>) o) out.add(toJsonValue(item));
            return out;
        }
        if (o instanceof Map) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                out.put(String.valueOf(e.getKey()), toJsonValue(e.getValue()));
            }
            return out;
        }
        if (o.getClass().isEnum()) return o.toString();
        // Generic vendor POJO: reflect public instance fields in declaration order.
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("$type", o.getClass().getSimpleName());
        for (Field f : o.getClass().getFields()) {
            if (Modifier.isStatic(f.getModifiers())) continue;
            try {
                f.setAccessible(true);
                m.put(f.getName(), toJsonValue(f.get(o)));
            } catch (Exception e) {
                m.put(f.getName(), "<unreadable:" + e + ">");
            }
        }
        return m;
    }

    /** Builds a JSON object (LinkedHashMap) from alternating key/value varargs, values auto-converted. */
    static Map<String, Object> obj(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put((String) kv[i], toJsonValue(kv[i + 1]));
        }
        return m;
    }

    static List<Object> arr(Object... items) {
        List<Object> l = new ArrayList<>();
        for (Object it : items) l.add(toJsonValue(it));
        return l;
    }

    static String write(Object value) {
        StringBuilder sb = new StringBuilder();
        writeValue(value, sb, 0);
        return sb.toString();
    }

    private static void indent(StringBuilder sb, int depth) {
        for (int i = 0; i < depth; i++) sb.append("  ");
    }

    @SuppressWarnings("unchecked")
    private static void writeValue(Object value, StringBuilder sb, int depth) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof String) {
            writeString((String) value, sb);
        } else if (value instanceof Boolean || value instanceof Integer || value instanceof Long) {
            sb.append(value.toString());
        } else if (value instanceof Double || value instanceof Float) {
            sb.append(value.toString());
        } else if (value instanceof Map) {
            Map<String, Object> m = (Map<String, Object>) value;
            if (m.isEmpty()) {
                sb.append("{}");
                return;
            }
            sb.append("{\n");
            int i = 0, n = m.size();
            for (Map.Entry<String, Object> e : m.entrySet()) {
                indent(sb, depth + 1);
                writeString(e.getKey(), sb);
                sb.append(": ");
                writeValue(e.getValue(), sb, depth + 1);
                if (++i < n) sb.append(',');
                sb.append('\n');
            }
            indent(sb, depth);
            sb.append('}');
        } else if (value instanceof List) {
            List<Object> l = (List<Object>) value;
            if (l.isEmpty()) {
                sb.append("[]");
                return;
            }
            sb.append("[\n");
            for (int i = 0; i < l.size(); i++) {
                indent(sb, depth + 1);
                writeValue(l.get(i), sb, depth + 1);
                if (i + 1 < l.size()) sb.append(',');
                sb.append('\n');
            }
            indent(sb, depth);
            sb.append(']');
        } else {
            writeString(value.toString(), sb);
        }
    }

    private static void writeString(String s, StringBuilder sb) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }
}
