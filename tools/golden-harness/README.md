# iLedClock BLE protocol golden harness

Compiles the **real, unmodified** vendor encoder classes from the decompiled
CoolLED1248 app (`ILedClockUtils`, `LightUtils`, `ILedClockManager`) on a
plain JVM, calls every framing/builder/program-encoder method with realistic
inputs, and records `{fn, args, out}` triples to `vectors.json`. The goal is
a byte-exact oracle for this repo's from-scratch Python port — every
vector's `out` came out of vendor bytecode running on OpenJDK 17, not a
re-implementation.

This directory holds only **our own** code: the minimal Android/library
stubs the vendor classes need to compile against, and the harness that
drives them. It never holds the vendor's decompiled source (that's
regenerated locally, gitignored, never committed — see below) or the
vendor's APK. The generated output is committed separately at
[`tests/fixtures/golden/vectors.json`](../../tests/fixtures/golden/vectors.json);
every protocol test that checks against it reads that path, not this
directory.

## Regenerating from scratch

Needed only when the vendor app updates in a way that changes the protocol,
or if the fixture is ever lost. The last regeneration used CoolLED1248
**version 2.7.7 (versionCode 115)**, apkeep 1.0.0, and jadx v1.5.6 — pin to
those exact versions if you need byte-identical output; a newer app version
may change wire formats, and a newer decompiler *could* format some
control-flow differently (though in practice jadx's output for this APK has
been stable across releases).

1. **Download the vendor app.** Fetch the latest [apkeep](https://github.com/EFForg/apkeep/releases)
   release binary for your platform (`apkeep-x86_64-unknown-linux-gnu` on
   Linux x86_64), then:

   ```sh
   chmod +x apkeep
   ./apkeep -a com.jtkj.led1248 -d apk-pure /path/to/workdir
   ```

   This produces an XAPK (a zip of per-ABI/locale split APKs). The base APK
   with all the app's own code is `com.jtkj.led1248.apk` inside it —
   `unzip com.jtkj.led1248.xapk -d xapk_extract` to get at it.

2. **Decompile it.** Extract the base APK's dex files into a `base/`
   directory (the dex files are just zip members of the APK):

   ```sh
   mkdir base && unzip xapk_extract/com.jtkj.led1248.apk -d base
   ```

   Then run the latest [jadx](https://github.com/skylot/jadx/releases)
   release against them:

   ```sh
   jadx -q -j 8 --no-res -d src base/classes*.dex
   ```

   This writes Java source under `src/sources/com/jtkj/led1248/...`.

3. **Install a JDK** if `javac` isn't already on `PATH` (only a JRE is
   assumed present by default): `apt-get install -y openjdk-17-jdk-headless`.

4. **Recreate `vendor/`** (gitignored — never commit this) alongside this
   README, `stubs/`, `harness/`, and `build.sh`, then copy exactly these 4
   files from the freshly decompiled `src/` tree, preserving their package
   directory structure under `vendor/`:

   - `light/utils/ILedClockUtils.java`
   - `light/utils/LightUtils.java`
   - `light/device/ILedClockManager.java`
   - `` light/utils/CoolledMUtils$LzssCompress$$ExternalSyntheticBackport0.java ``
     (a tiny D8/R8 desugaring helper class `LzssCompress` needs)

   Apply the same **3 documented syntax fixes** to your freshly copied
   `vendor/.../ILedClockUtils.java` — see "Syntax fixes to the copied vendor
   source" below for the exact before/after text and why each one is
   necessary/safe. (All 3 fixes have been needed, byte-identical, across
   every regeneration to date; a real protocol change in a future app
   version could in principle shift line numbers or add new ones — locate
   each by the surrounding code shown below, not by line number alone.)

5. **Build and verify:**

   ```sh
   bash build.sh
   ```

   This does `javac` over `vendor/`, `stubs/`, `harness/` into `out/`, then
   runs `java -cp out -Duser.timezone=UTC Golden vectors.json`. No
   Gradle/Maven, no network access, no external jars beyond the JDK itself.
   Confirm you get exactly **270 vectors across 85 distinct `fn` labels**
   (see the coverage table below); run it twice and diff — every vector
   should be byte-identical **except** the 8 `getCheckPasswordData`/
   `getSetPasswordData` vectors (unseeded `java.util.Random`) and the 1
   `getSynchronizeTime` vector (live wall clock).

6. **Install the fixture:**

   ```sh
   cp vectors.json ../../tests/fixtures/golden/vectors.json
   ```

   (paths relative to this directory). Then run
   `python3 -m unittest discover -s tests/protocol -t .` and
   `-s tests/hardware -t .` from the repo root — every golden-vector test
   should pass with zero skips.

## Directory layout

```
tools/golden-harness/
  vendor/   (gitignored) verbatim copies of the decompiled source, produced by step 4
            above -- 3 syntax fixes, documented below
  stubs/    minimal Android/library surface the vendor classes need to compile -- ours,
            committed
  harness/  Golden.java (framing/simple builders/Lzss/Crc/dataPacket), ProgramEncoders.java
            (content-type encoders), Json.java (dependency-free JSON writer + reflective
            dumper) -- ours, committed
  build.sh
  vectors.json  (gitignored build output; the committed copy lives at
                tests/fixtures/golden/vectors.json)
```

## Stub inventory

Every stub reproduces only the method/field surface the **copied vendor
files actually reference** (checked by attempting to compile, reading the
javac error, adding exactly what it names, repeat).

| Stub | Why | Faithfulness |
|---|---|---|
| `android.graphics.Color` | `Color.red/green/blue/alpha/rgb/argb/parseColor` | Pure-Java reimplementation matching AOSP `Color.java` semantics exactly (bit-shift packing, `parseColor`'s named-color table + `#RRGGBB`/`#AARRGGBB` parsing). No Bitmap/Canvas. |
| `android.text.TextUtils` | `isEmpty(CharSequence)` | Exact one-liner, matches AOSP. |
| `android.content.Context` | `getResources().getAssets().open(String)` / `.openRawResource(int)` chain | Only `ILedClockUtils.getOTAData(Context)` needs this chain to *compile*; it has no real asset bundle to read from, so calling it throws (see "Not covered"). Not used by any covered vector. |
| `com.jtkj.led1248.R2` (`attr` nested class, 4 fields) | jadx aliased 4 numeric literals inside `ILedClockUtils.LzssCompress` and `adjustPowerGraffiti` to R2 resource-id fields that happen to share the same post-shrink integer value (a known jadx/R8 decompilation artifact, not a real resource lookup) | Each field's value was cross-checked against the **full** decompiled `R2.java` (18k lines) and against the classic LZSS reference algorithm's window/lookahead constants (`N=512, F=18` ⇒ `dependency=N-F=494`, `drawableTintMode=N+F-1=529`, `itemTextAppearanceActive=N+1+256=769`); `fabCustomSize=612` matches the literal `612` used by the sibling `adjustPower(int,int)` method for the same "RGB power budget" concept. Exact values, not approximations. |
| `com.jtkj.led1248.CoolLED` | `getInstance()` (returns the stub `Context`), `reportError(String\|Throwable)` (no-op) | Matches real no-op `reportError` bodies; `getInstance()` is a trivial singleton accessor in the real app too. |
| `com.jtkj.led1248.glide.DptLoadImage` | `DecoderAnimationItem` (3 fields) + `getAnimationItem(String)` + `getAnimationItemWithColumnRow(int,int,int)` | Real implementations decode on-disk GIFs via Android `Movie`/`Bitmap`. No real GIF assets exist here, so the stub returns an empty `DecoderAnimationItem`; the golden vectors for `ANIMATION`/`DYNAMIC_TEXT` dispatch never rely on real decoded frames — they either construct `ILedClockAnimationProgramContent` directly with real `DrawView.DrawItem` grids, or (for the dispatch-level GIF/resource paths) accept the stub's empty frames as documented in "Not covered". |
| `com.jtkj.led1248.light.device.DeviceManager` (`DEVICE_ROW`, `DEVICE_COLUMN`, `CoolleduxDeviceVersion` + `TimerSwitchItem`) | Real class is ~9900 lines of BLE session/connection state | `TimerSwitchItem` fields/toString copied verbatim from the decompiled source. The three statics keep their real default values (16, 64, -1) and are mutated by the harness per-vector (`ProgramEncoders.withDeviceGeometry`) to exercise different device geometries, exactly as the real app would after a real device handshake sets them. |
| `com.jtkj.led1248.light.emoji.TextEmojiManager` (`TextEmojiItem` w/ 2 fields, `TextEmoji32Items` marker) | Only field *types* referenced by `ILedClockManager`/unused helper methods (`isArbOrXbl`) | Minimal — these are Arabic/Hebrew text-shaping helpers orthogonal to the encoders under test; not part of any covered vector. |
| `com.jtkj.led1248.light.emoji.TextEmojiManagerCoolLEDUX` | Real class extends `TextEmojiManager` and pulls in Bitmap-based emoji decoding | **`getColorDataWithColor`, `getColorDataWithColorWithRGB444Transfer`, `rgb444Transfer` are copied verbatim** (byte-for-byte) from `light/emoji/TextEmojiManagerCoolLEDUX.java:386-414` — these are the RGB→nibble color encoders every content-type builder calls. Nothing else on the real class is reproduced. |
| `com.jtkj.led1248.light.utils.FontUtils` | Real class is 17k+ lines reading bundled per-resolution bitmap-font binaries via `RandomAccessFile` + Android `Paint`/`Bitmap` | Stub throws `UnsupportedOperationException` from both entry points vendor code calls (`getFontByteDataILedClockForEmoji`, `getFontByteCustomColorDataILedClockForEmoji`). Never invoked by any golden vector — see "Not covered". |
| `com.jtkj.led1248.widget.DrawView` (`DrawItem`: 4 fields, 4 ctors) | Real `DrawView` extends `android.view.View` | Fields/constructors/`toString` copied identically from `widget/DrawView.java:2150-2208`; `Parcelable`/`Serializable` plumbing dropped (never exercised — the harness builds these objects in-process, never serializes them). |
| `com.jtkj.library.commom.logger.CLog` | Real class formats + emits Android `Log.*` calls | No-op stub with the identical method surface (`v/d/i/w/e`, `isDebug`/`setIsDebug`), so all vendor logging calls compile and execute as pure no-ops. |
| `com.jtkj.library.commom.tools.FileUtils` | Real class reads files from disk / raw Android resources | `readFileToBytes(String)` / `readRawImageBytes(Context,int)` return a **deterministic** LCG byte stream seeded from `String.hashCode()` of the path/id (see `FileUtils.syntheticBytes`), so every rebuild reproduces the exact same synthetic "file contents" — golden vectors exercising these paths (animation-from-file, animation-from-resource, encrypted-animation-from-file) are fully reproducible even though the bytes aren't from a real GIF. |

## Syntax fixes to the copied vendor source (`vendor/.../ILedClockUtils.java`)

Exactly three edits were made to the copied file, all forced by jadx
reconstructing bytecode control-flow into Java source that either fails
`javac`'s definite-assignment check or (in one case) is outright wrong —
i.e. it does not match what the real, shipped, working APK computes. No
other line was touched. Each is reasoned from first principles below;
none change any encoder's observable output for the inputs this harness
exercises (proven per-case).

1. **`LzssCompress.lazssCompress`, local `i3` declaration (`int i3;` → `int
   i3 = 0;`)** — satisfies definite-assignment. See fix #2: with fix #2
   applied, `i3` is always assigned (`i3 = b;`) before its first read on
   every path that reaches it, so this initial value is never actually
   observed; it exists solely because Java requires a declared local to
   have *some* value on every path, however unreachable.

2. **`LzssCompress.lazssCompress`, hoisted `i3 = b;` out of the `while (i3 <
   i2)` loop body** — **this is a real correctness bug in the jadx
   reconstruction, not merely a compile error.** As decompiled, the loop was:
   ```java
   while (i3 < i2) {
       i3 = b;                          // b is a byte constant, always 0
       arrayList.add(Byte.valueOf(bArr2[i3]));
       i3++;
   }
   ```
   Resetting `i3 = 0` as the *first statement of the loop body* means it
   never advances past 1 — this is an infinite loop (confirmed empirically:
   running the file as literally decompiled OOMs `ArrayList.add` inside
   `lazssCompress`, called transitively from `getOTAUpdate`/
   `getLzssCompressData`). `N=512, F=18, THRESHOLD=2` and the surrounding
   binary-tree (`lson`/`rson`/`dad`) structure are an unmistakable copy of
   Haruhiko Okumura's public-domain LZSS reference implementation, whose
   equivalent step is `for (i = 0; i < code_buf_ptr; i++) putc(code_buf[i],
   outfile);` — a for-loop whose init clause (`i = 0`) runs **once**, before
   the condition is first checked, not on every iteration. jadx evidently
   failed to recognize the for-loop shape and mis-placed the init statement
   inside the loop body instead of before it. The fix moves the single line
   `i3 = b;` from inside the loop to immediately before it:
   ```java
   i3 = b;
   while (i3 < i2) {
       arrayList.add(Byte.valueOf(bArr2[i3]));
       i3++;
   }
   ```
   This is the only edit in this harness that changes program behavior
   relative to the literal jadx output — and it changes it *towards* the
   real, shipped app's behavior (which obviously does not infinite-loop on
   every OTA update or program upload), not away from it. `LzssCompress`
   vectors are directly tested against 5 buffers of varying size/content
   (see below) and never hang or throw after this fix.

3. **`setColorMode(int)`, local `str` declaration (`String str;` → `String
   str = null;`)** — satisfies definite-assignment (for `i` in
   {29,30,31,other-out-of-range}, `str` is read via `str2 = str;` on two
   lines before ever being written). **Proven inconsequential to
   `setColorMode`'s output** by a full control-flow trace (branch-depth
   verified mechanically, twice, with independent scripts): for *every* `i`
   not in `{1,2,5,6,7,8,9,10}`, execution unconditionally falls through
   **three** later unconditional reassignments of `str2`
   (`str2 = colorMode17;` then `str2 = <colorMode13-literal>;` then
   `str2 = <colorMode9/10/11/12/15/16-shared-literal>;`, each overwriting
   the last) before the method returns — i.e. `str2`'s value from the
   `str`-dependent lines is *always* discarded before it can affect the
   output. This means `setColorMode(i)` for `i` in `{11,...,32}` always
   produces the **same** `str2` payload table regardless of `i` (only `i3`
   and, for a couple of values, `i4` differ) — a real, surprising, and
   almost certainly unintentional quirk of the shipped app (colorMode14,
   colorMode19–30's distinct tables are dead code past `i=10`), faithfully
   reproduced and covered by the `i in 0..32` sweep below. `str`'s
   placeholder value is provably never observed, so `null` was chosen with
   zero risk.

None of the ~5000 lines of static byte-table constants, none of the
per-content-type encoder bodies, and no other control-flow was touched.

## Coverage table (`fn` → vector count, 270 total across 85 distinct `fn` labels)

Grouped by assignment section, reproduced from `vectors.json`:

### 1. Framing

| fn | vectors |
|---|---|
| `getSendDataWithInfo` | 3 (boundary bytes 00/01/02/03/04/ff, 300-byte, 512-byte seeded-random) |
| `recoverData` | 5 (the 3 named live device replies + 2 round-trips of the framing vectors above) |

### 2. Simple builders (`ILedClockUtils.java` lines 4732-5337) — all 40 methods

`getDeviceInfo`(1) `getSwitchData`(2) `getSetBrightness`(6, incl. 256
boundary) `getSetMirror`(2) `getCheckPasswordData`(4) `getSetPasswordData`(4)
`getStartOTAUpdate`(1) `getOTAUpdate`(1) `getMusicDataString`(1)
`getSetRyhthmType`(4, incl. 300 boundary) `getSynchronizeTime`(1)
`getStopwatchStatus`(1) `getStopwatchReset`(1) `getStopwatchStartOrStop`(2)
`getCountDownStatus`(1) `getCountDownReset`(1) `getCountDownStartOrStop`(2)
`getScoreBoardStatus`(1) `getScoreBoardSetCore`(1) `getScoreBoardSetTime`(2)
`getScoreBoardStartOrStop`(2) `getTimerSwitch`(1) `setTimerSwitch`(3, incl.
null/empty) `setDeviceInfo`(3) `setDeviceVolume`(1) `setRotate`(1)
`setColor`(6: red/green/blue/white/black/custom) `adjustPower`(12, bonus —
not in 4732-5337 numerically but a one-line sibling helper of `setColor`)
`setColorSpeed`(1) `setColorMode`(33: every `i` in 0..32 inclusive)
`getDeviceOTAVersion`(1) `getSetTomatoClockTime`(1) `getTomatoClockTime`(1)
`getSetAlarmClockTime`(2, incl. empty) `getAlarmClockTime`(1)
`getTemperatureAndHumidity`(2) `getNightMode`(1) `getSetNightMode`(1)
`getReminder`(1) `getDeleteReminder`(1) `getReminderDetail`(1).

**Random handling** (`getCheckPasswordData`/`getSetPasswordData`): the
vendor calls `new java.util.Random().nextInt(256)` inline with no seed hook
reachable without editing vendor logic. Per the assignment's documented
fallback, each vector's `args.randomByteHex` is the byte **recovered from
that run's own output** via `ILedClockUtils.recoverData(out)` (element
index 1 — right after the opcode byte), with `args.formula` spelling out
exactly how it's used (XOR-scrambles each password nibble, final byte is
the XOR checksum of everything from index 2 onward). This is why these 8
vectors (and only these 8) differ between successive `build.sh` runs.

**`getSynchronizeTime`**: reads `java.util.Calendar.getInstance()`
internally with no seam to inject a fixed clock without editing vendor
logic; `Golden.main` forces the JVM default `TimeZone` to UTC once at
startup (harness-level, not a vendor edit) so at least the *interpretation*
of "now" is deterministic across machines, but "now" itself still advances
between runs. Per the documented fallback, the exact year/month/day/weekday/
hour/minute/second fields the vendor call actually used are decoded back
out of that call's own output via `recoverData` and stored in `args`
(`yearOffsetFrom2000Hex` etc.) rather than captured from a separate,
possibly-racy `Calendar.getInstance()` call in the harness.

### 3. `LzssCompress` / `CrcCode`

Each of `LzssCompress.lazssCompress`, `LzssCompress.getLzssCompressData`,
`CrcCode.getCrc32CheckCode`, `CrcCode.getCrc32CheckCode2`,
`CrcCode.getCrcCode` run against: empty, 1 byte (`0xAB`), 100 zero bytes,
1000 bytes from `new Random(7L)`, and a 5000-byte `0xCA,0xFE` repeating
buffer (5 functions × 5 buffers = 25 vectors, minus 1 documented skip below
= 24).

**Quirk preserved, not fixed**: `lazssCompress(byte[])` returns Java `null`
for zero-length input (the vendor's own `if (textsize == 0) return null;`
short-circuit) — that vector's `out` is JSON `null`, not `""`.
`getLzssCompressData(List<String>)` unconditionally calls
`LightUtils.byte2hex(lazssCompress(...))`, which throws a
`NullPointerException` on the empty-input case (`byte2hex` iterates a null
array) — this is a **real vendor bug reachable from empty input**, not a
harness artifact. That one specific `(getLzssCompressData, empty)`
combination is recorded with `out: null` and a `note` explaining the
NPE instead of a crash; `lazssCompress` itself is exercised directly on
empty input to capture the `null`-return quirk cleanly.

`CrcCode.getCrc32CheckCode`/`getCrc32CheckCode2` return `int`; rendered as
an 8-hex-char big-endian representation (`String.format("%08x", crc)`) —
documented convention, not a vendor format. `getCrc32CheckCode2` also has a
vendor `System.out.println(i)` debug statement that fires on every call;
harmless stdout noise from `build.sh`, not written to `vectors.json`.

### 4. `getDataPacket`

`getDataPacket(list,tag)` and `getDataPacket(list,tag,size)` each on 10,
1024, 1025, and 5000-byte lists (content = a repeating 0x00-0xff counting
sequence — the algorithm only depends on length, not content) = 8 vectors,
each `out` an array of per-packet hex strings (multi-frame).

### 5. Program/content-type encoders (`ILedClockUtils.java` lines 2598-4730)

| Content type | fn(s) | vectors |
|---|---|---|
| Frame | `getDataWithFrameProgramContent` | 5 (frameType 1/8/15/20 + custom position/size) |
| Text, auto-color | `getDataWithTextAutoColorProgramContent` | 5 (autoColorType 1/14/28 + 2 out-of-range boundary) |
| Text, custom-color / content | — | **not covered**, see below |
| Animation (direct content object) | `getDataWithAnimationCombineProgram(content)` | 2 (with/without explicit per-frame delays) |
| Animation (gif content object / plain file / resource id / encrypted file) | `getDataWithAnimationCombineProgram(...)` × 3 overloads, `getDataWithAnimationCombineProgramEncryped` | 4 |
| Animation dispatch (`getDataForCombineProgram`, all 4 sub-paths incl. encrypted) | `getDataForCombineProgram(ANIMATION)` | 4 |
| GIF-file animation dispatch | `getDataForCombineProgram(GIF_FILE_ANIMATION)` | 1 |
| Graffiti (+ speed>255 boundary) | `getDataWithGraffitiCombineProgram` | 3 |
| Graffiti, ForTable variant | `getDataWithGraffitiCombineProgramForTable` | 1 |
| Graffiti dispatch | `getDataForCombineProgram(GRAFFITI)` | 1 |
| Frame dispatch | `getDataForCombineProgram(FRAME)` | 1 |
| Clock | `getDataWithClockCombineProgram` | 3 (2 working @16x32 + 1 documented-throws @32x128) |
| Date | `getDataWithDateCombineProgram` | 2 (@16x32 and @32x128, both succeed) |
| Time count | `getDataWithTimeCountCombineProgram` | 3 (2 working @16x32 + 1 documented-throws @32x128) |
| Scoreboard | `getDataWithScoreBoardCombineProgram` | 2 (@16x32 and @32x128, both succeed) |
| Temperature | `getDataWithTemperatureCombineProgram` | 2 |
| Humidity | `getDataWithHumidityCombineProgram` | 2 |
| Reminder | `getDataWithReminderCombineProgram` | 3 (repeatType 0/1/2) |
| Combine program (full `ILedClockProgram`) | `getDataForProgram`, `getDataWithProgram` | 1 each |
| `getStartDataForProgram` (all 5 overloads) | 5 distinct signatures | 30 |
| `getDataResult` (all 3 overloads × 6 single-type programs, ×2 output fields each) | 6 distinct fn labels | 36 |
| `getOtaDataResult` (both overloads) | 2 |

**Device-geometry-gated quirks preserved, not fixed** (each recorded with
`out: null` and a `note` in `vectors.json`, via `ProgramEncoders.safeRecord`):
`getDataWithClockCombineProgram` and `getDataWithTimeCountCombineProgram`
hard-code their per-style hour-numeral table lookup to
`DEVICE_ROW==16 && DEVICE_COLUMN==32` with **no fallback table** for any
other geometry (`"".split(",")` → `[""]` → `NumberFormatException`
parsing it as a byte) — i.e. these two content types are, as shipped, only
usable on exactly one device geometry. `getDataWithDateCombineProgram` and
`getDataWithScoreBoardCombineProgram` are more defensively coded (real
per-geometry tables or non-empty defaults) and succeed at both 16x32 and
32x128 in this harness.

## Not covered (and why)

- **`getDataWithTextContentProgramContent`, `getDataWithTextCustomColorProgramContent`,
  and their shared helper `getTextCustomColorDataForEmoji`** — both call
  into `FontUtils.getInstance(context).getFontBy...ForEmoji(...)`, ~2000
  vendor-source lines each, which rasterizes glyphs from bundled
  per-resolution bitmap-font binaries (`RandomAccessFile` + Android
  `Paint`/`Bitmap`/`Canvas`) that do not exist in this harness and cannot be
  faithfully reproduced without them. `getDataWithTextAutoColorProgramContent`
  (the third TEXT variant — a color-band/rainbow effect with no character
  content at all) needs no font rendering and *is* fully covered above.
- **`ILedClockUtils.getOTAData(Context)`** — reads a bundled OTA firmware
  binary from the Android asset bundle (`context.getResources().getAssets()
  .open("coolledux.bin")`); no such asset bundle exists here. Not in the
  assignment's required list; the stub `Context.AssetManager.open` throws
  `IOException` if ever called (never is, by this harness).
- **Real GIF/raw-image decoding** (`DptLoadImage.getAnimationItem(String)`,
  `getAnimationItemWithColumnRow(int,int,int)`, and the `FileUtils.readFileToBytes`/
  `readRawImageBytes` bytes they and the direct animation-from-file/resource/
  encrypted-file encoders consume) — real implementations need an actual GIF
  codec and real files/resources. The *encoder logic* around these calls
  (packet framing, XOR "encryption", length prefixing) is fully exercised
  using deterministic synthetic byte content (see `FileUtils` stub above);
  only the *pixel content* of a real animated GIF is out of scope. The
  `ANIMATION`/`DYNAMIC_TEXT`-via-`getDataForCombineProgram` dispatch paths
  that go through `DptLoadImage` similarly get the stub's empty frame list
  rather than real decoded pixels.
- **`getDataWithClockCombineProgram` / `getDataWithTimeCountCombineProgram`
  at any `DeviceManager.DEVICE_ROW`/`DEVICE_COLUMN` other than 16x32** — see
  "Device-geometry-gated quirks" above; this is a real vendor limitation,
  captured as a documented `out: null` vector rather than skipped silently.

## Output/JSON conventions (harness-defined, not vendor format)

- `out` is the hex-joined `List<String>` the vendor method returned. For
  `List<List<String>>` (multi-frame) returns, `out` is a JSON array of
  per-frame hex strings.
- Vendor methods returning a plain `int` (`CrcCode.getCrc32CheckCode[2]`,
  `adjustPower`) are rendered as an 8-hex-char big-endian string via
  `String.format("%08x", value)`.
- Vendor methods returning a composite object (`DataResult` has
  `beginDataForProgram`/`dataForProgram`; `ILedClockOTADataResult` has
  `beginDataForOTAUpgrade`/`dataForForOTAUpgrade`) are split into one
  `vectors.json` entry per field, `fn` suffixed `.fieldName`, **except**
  `getOtaDataResult` whose two fields are kept together in one `out` object
  (`{beginDataForOTAUpgrade, dataForForOTAUpgrade}`) since both overloads
  are only tested once each.
- `args` is a JSON object mirroring the actual Java call: primitives keep
  their name; vendor value objects (`ILedClockManager.*ProgramContent`,
  `DrawView.DrawItem`, `DeviceManager.TimerSwitchItem`, `ILedClockProgram`,
  ...) are dumped by reflecting every public instance field (see
  `Json.toJsonValue`), tagged with `"$type": "<simple class name>"`, so the
  exact constructed input is always fully visible next to `out`.
- `args.note` (when present) documents a boundary condition, a vendor
  quirk, or — when `out` is `null` — why the real vendor code doesn't
  produce output for that input.
