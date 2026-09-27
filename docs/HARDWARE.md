# iLedClock 32×16 — hardware & firmware capability profile

Owner: HardwareProfile. Implements `custom_components/iledclock/hardware.py`; tested by
`tests/hardware/`. This is the narrative writeup; the module docstrings in `hardware.py`
carry the same citations in code form.

**Evidence grades**, used throughout:

| Grade | Meaning |
|---|---|
| `[DEVICE]` | Observed directly from the real clock's BLE replies (`tests/live_replies_2026-09-25.json`, `docs/ARCHITECTURE.md`'s live captures). |
| `[VENDOR file.java:line]` | Read directly in the decompiled CoolLED1248 v2.7.7 Java. Root: `/data/home/tmp/led1248/src/sources/com/jtkj/led1248/`. |
| `[VECTOR fn]` | The `[VENDOR]` claim is *additionally* confirmed byte-for-byte by golden vectors produced by running that vendor bytecode on a real JVM: `/data/home/tmp/led1248/golden/vectors.json`. |
| `[INFERENCE]` | Reasoned from the above but not directly observed. Never presented as fact — every one below states its reasoning, and where it affects art quality it is repeated in the Open Questions table with the exact experiment that would confirm or overturn it. |

Device identity: BLE local_name `iLedClock`, manufacturer id 12692, advertised payload
`bcdc070000011000200421` `[DEVICE]` = 6-byte id `bcdc07000001` + height(1B)=`10`=16 +
width(2B)=`0020`=32 + colour-type(1B)=`04` + firmware(1B)=`21`. Service
`0000fff0-0000-1000-8000-00805f9b34fb`, characteristic `0000fff1-...` (write-without-response
+ notify). SoC: JieLi AC695x (from the OTA reply's firmware-id string, decoded below).

---

## 1. Geometry

**32 columns × 16 rows** (`DEVICE_COLUMN=32`, `DEVICE_ROW=16` in vendor terms).

The app derives this **per-connection from the BLE scan record**, not from a static
per-model table:

```java
// [VENDOR light/device/DeviceManager.java:9885-9899]
public static int getDeviceColumn(byte[] bArr) {
    return Integer.parseInt(LightUtils.getHexStringForInt(bArr[18] & 255)
        + LightUtils.getHexStringForInt(bArr[19] & 255), 16);
}
public static int getDeviceRow(byte[] bArr) {
    return Integer.parseInt(LightUtils.getHexStringForInt(bArr[17] & 255), 16);
}
```

i.e. within the full scan record, byte 17 is row/height and bytes 18–19 are a big-endian
2-byte column/width. `[DEVICE]`-cross-validated: our manufacturer-data *payload* (not the
full scan record — the payload starts a fixed number of bytes into the record, after the
flags and local-name AD structures) has height at its own offset 6 and width at offset 7–8,
exactly self-consistent with scan-record offsets 17 and 18–19 once that fixed prefix is
accounted for. `hardware.derive_geometry_from_manufacturer_data()` operates on the 11-byte
payload directly (offsets 6/7–8/9/10) and is tested against our exact device's real
advertised bytes.

Once connected, `DeviceManager` also branches on the advertised **device name** to pick a
`DEVICE_TYPE` and `COOL_LED_DEVICE_COLOR_TYPE` — for a device named exactly `iLedClock`,
colour type is **hardcoded to 4** by the name match, not re-derived from either the
manufacturer-data byte or any reply
`[VENDOR DeviceManager.java ~line 1015-1020]`:

```java
} else if (name.equalsIgnoreCase(ILED_CLOCK)) {
    ...
    COOL_LED_DEVICE_COLOR_TYPE = 4;   // hardcoded, not read from any reply
```

The manufacturer-data colour-type byte we independently observe (`0x04`) happens to agree —
treat it as corroborating, not as the actual mechanism.

**Pixel/refresh facts**: no vendor evidence of the LED matrix's true refresh rate, PWM
frequency, or per-pixel current limits beyond the power-budget arithmetic in §2/§3.
**Rotation/mirror**: see §7 (Other hardware) — `rotate`/`mirror` share one wire opcode and a
4-value enum (none / xy-flip / x-flip / y-flip), not independent axes.

---

## 2. Colour

### 2.1 What "colour type 4" means

`COOL_LED_COLORFUL_ILED_CLOCK = 4` is simply the identifier the app uses to pick this
device's UI/encoding branch (vs. other CoolLED-family products: type 0 = monochrome
`COOL_LED`, type 1/2 = "colourful" with a different palette-picker UI, etc.) — it does not,
by itself, encode a specific bit depth. The bit depth (RGB444, 4 bits/channel) is a *separate*
fact established by which encoder functions the content types call (§2.2), all of which pack
exactly 2 bytes = 2×4-bit-pairs per pixel regardless of `COOL_LED_DEVICE_COLOR_TYPE`.

### 2.2 Two different encoders — not one — depending on content path

`[VENDOR light/emoji/TextEmojiManagerCoolLEDUX.java:386-414]`:

```java
public static List<String> getColorDataWithColor(int i) {                    // LINEAR
    int iRed = Color.red(i) / 16, iGreen = Color.green(i) / 16, iBlue = Color.blue(i) / 16;
    ... // packs [0x0<iRed>][<iGreen><iBlue>]
}

public static List<String> getColorDataWithColorWithRGB444Transfer(int i) {   // CURVED
    int r = rgb444Transfer(Color.red(i)), g = rgb444Transfer(Color.green(i)), b = rgb444Transfer(Color.blue(i));
    ...
}

public static int rgb444Transfer(int i) {
    if (i >= 238) return 15;
    if (i <= 47) return 0;
    return ((i - 47) / 14) + 1;
}
```

**The curved `rgb444Transfer` table** (16 unequal steps — this is what `hardware.py`'s
`encode_channel`/`rgb444_transfer` implement, `[VECTOR]`-confirmed against every `setColor`
and `adjustPower` golden vector):

| input range | nibble | input range | nibble | input range | nibble | input range | nibble |
|---|---|---|---|---|---|---|---|
| 0–47 | 0 | 89–102 | 4 | 145–158 | 8 | 201–214 | 12 |
| 48–61 | 1 | 103–116 | 5 | 159–172 | 9 | 215–228 | 13 |
| 62–74 | 2 | 117–130 | 6 | 173–186 | 10 | 229–237 | 14 |
| 75–88 | 3 | 131–144 | 7 | 187–200 | 11 | 238–255 | 15 |

**The linear encoder** is plain truncating division: nibble = `v // 16` (e.g. 0→0, 15→0,
16→1, ..., 240→15, 255→15). Note both formulas agree at the extremes (0→0, 255→15) —
**every golden vector in the entire corpus only ever tests primary colours (each channel is
0 or 255)**, so no golden vector can distinguish which formula a path uses at a mid-range
value; that distinction rests entirely on the direct source citations below, cross-checked
independently by ProtocolLib against the same source.

| Content path | Encoder | Citation |
|---|---|---|
| Global solid colour (`setColor`, opcode `0x13 0x01`) | **curved** | `ILedClockUtils.java:5064-5069` |
| TEXT, custom/explicit colour | **curved** | `ILedClockUtils.java:3046` |
| GRAFFITI pixels | **curved** | `ILedClockUtils.java:3190` (`getDrawListDataFColor`), loop confirmed identical to animation's at `3041-3050`/independently at CoolledUXUtils.java |
| ANIMATION pixels | **curved** | `ILedClockUtils.java:3041-3050` (`getAnimationDataColor`) |
| CLOCK (hour/minute/second/ampm/space colours) | **linear** | `ILedClockUtils.java:3388,3393,3401,3406,3417,3422` |
| DATE (year/month/day/week colours) | **linear** | `ILedClockUtils.java:3577,3582,3593,3603,3614,3619,3630` |
| TIMECOUNT | **linear** | `ILedClockUtils.java:4045,4050,4057,4062,4069` |
| SCOREBOARD | **linear** | `ILedClockUtils.java:4137,4142,4188,4193,4235,4240,4280` |
| TEMPERATURE / HUMIDITY | **linear** | `ILedClockUtils.java:4305,4330` |
| TEXT, `autoColorType` 1–28 | **pre-baked** (no live RGB888 input — see §7.2) | `ILedClockUtils.java` `colorType1`..`colorType28` constants |

**Does the firmware then apply its own gamma on top?** No vendor evidence either way — the
app never needs to invert the nibble back to a displayed value, so there is no code path
that would reveal it. `displayed_rgb()` expands nibble→RGB888 by bit-replication
(`nibble * 17`, so 0→0 and 15→255 exactly) as the standard, defensible convention for a
*preview*, explicitly flagged `[INFERENCE]` — see Open Questions §1.

**The vendor's own GIF-import pipeline applies neither encoder at decode time.**
`getDrawItemsFromBitmap(Bitmap)` `[VENDOR TextEmojiManagerCoolLEDUX.java:549-562]` stores raw
8-bit ARGB straight into each `DrawItem.color`. The curved transfer above is applied later,
once, by the *same shared encoder* that also handles hand-drawn graffiti/animation — so an
imported GIF's colours and a finger-painted graffiti's colours are quantized **identically**,
just at different pipeline stages, and there is **no dithering anywhere** in the vendor's own
pipeline (grep-confirmed absent from `glide/DptLoadImage.java` and `utils/GifUtils.java`).

### 2.3 `adjustPower` — the app's per-pixel/per-frame current-budget rule

`[VENDOR ILedClockUtils.java:5072-5086]`, `[VECTOR]` all 12 `adjustPower` golden vectors
match exactly:

```java
public static int adjustPower(int i, int i2) {              // i=ARGB colour, i2=brightness
    if (i2 <= 96) return i;
    int sum = Color.red(i) + Color.green(i) + Color.blue(i);
    if (sum <= 612) return i;
    float f = 612.0f / sum;
    return Color.rgb((int)(r*f), (int)(g*f), (int)(b*f));   // truncating, preserves hue
}
```

Once brightness exceeds **96**, any pixel whose R+G+B sum exceeds **612** (exactly 80.0% of
the theoretical max 765 = 255×3 — a real, deliberate current-budget constant, not a rounding
artefact) is scaled down until its sum is exactly 612.

The sibling whole-frame rule, `adjustPowerGraffiti`/`adjustPowerAnimation`
`[VENDOR ILedClockUtils.java:3196-3230]`, applies the **same 612-per-pixel-average budget**
but as one **aggregate** sum over an entire frame — `size × 612` — scaling every pixel in that
frame by the same uniform factor if exceeded (preserves relative brightness across the
frame; no per-pixel banding). For a multi-frame animation, each frame's budget is evaluated
**independently**, so frames with different lit-pixel counts can visibly differ in overall
dimming from each other.

**Evidence-graded finding, surprising and important**: grepping the *entire* decompiled
source tree (not just `light/`) for calls to `adjustPower(`, `adjustPowerGraffiti(`,
`adjustPowerAnimation(` finds invocations **only inside these three sibling methods calling
each other** (e.g. `adjustPowerAnimation` calling `adjustPowerGraffiti` per frame). **No UI
Activity/Fragment and no content encoder** (`getDataWithGraffitiCombineProgram`,
`getDataWithAnimationCombineProgram`, `setColor`, ...) calls any of them. The functions are
real, byte-exact, and sound — but are **not demonstrably wired into any real encode/upload
path** in this decompiled snapshot. `hardware.power_limited`/`power_limited_frame` still
implement the exact vendor arithmetic (protecting the user's own hardware from excess
current draw is worth doing proactively regardless), but this should not be assumed to be
something the vendor app — or necessarily the firmware itself — reliably enforces. See Open
Questions §4.

---

## 3. Brightness

| | Value | Grade |
|---|---|---|
| SET wire range (opcode `0x04`) | **5–100** | `[VENDOR]` UI seekbar displays exactly this range; the byte sent equals the displayed number (seekbar's *internal widget position* is offset by −5, a pure widget detail, not a wire transform) — `ILedClockSettingsFragment.java:56-57`, `ILedClockUtils.java:4749-4754` |
| DEVICE-INFO reported brightness (our unit, live) | **0xa3 = 163** | `[DEVICE]` — **outside** the 5–100 SET range above |
| Power-limit threshold | brightness **> 96** | `[VENDOR]`, see §2.3 |
| Night-mode brightness | separate 0–100 field, no offset on receive | `[VENDOR ILedClockNightModeActivity.java:87]`; **[DEVICE]** our unit's stored night-mode brightness = `0x19` = 25 |

The 163 reading is a real, unresolved inconsistency: the byte is assigned unconditionally
(`ILedClockManager.brightNess = list[2]` `[VENDOR DeviceManager.java:4584]`, no range check
on receive), so the *decode* is certain, but 163 cannot be a value the SET command's own
documented 5–100 range would ever produce. Either the reported value uses different units
than the set value, or this unit was left in an unusual state. See Open Questions §7.

There is no dedicated "curve" evidence for brightness (linear PWM vs. gamma-corrected) —
only that the wire value is a single byte in 5–100.

---

## 4. Content / layer model

### 4.1 Content type IDs

`[VENDOR ILedClockUtils.java:4378-4504 getDataForCombineProgram dispatch]`:

| id | Type | id | Type | id | Type |
|---|---|---|---|---|---|
| 1 | Graffiti | 8 | Timecount | 16 | Dynamic text |
| 2 | Animation | 11 | Scoreboard | 17 | Temperature |
| 3 | Text | 14 | Reminder | 18 | Humidity |
| 4 | Frame (border) | 15 | GIF-file animation | | |
| 6 | Date | 7 | Clock | | |

### 4.2 Multiple contents genuinely coexist in one program — this is firmware-native, not something the adaptation pipeline needs to fake

`[VENDOR ILedClockManager.java:888]`: `ILedClockProgram.combinePrograms` is a
**`List<ILedClockCombineProgram>`**. `getDataForProgram` `[VENDOR ILedClockUtils.java:4506-4513]`
simply concatenates every member's encoded bytes:

```java
public static List<String> getDataForProgram(ILedClockProgram p) {
    List<String> out = new ArrayList<>();
    for (ILedClockCombineProgram cp : p.combinePrograms) out.addAll(getDataForCombineProgram(cp));
    return out;
}
```

i.e. **one program slot (of the device's 9) can hold multiple independent content layers**
— e.g. a CLOCK content *and* a GRAFFITI/ANIMATION content — each with its own region, and the
device renders all of them together, live, with zero re-upload for anything that updates
from device-tracked state (the clock keeps ticking).

**Region fields**: every content type except Reminder carries spatial placement fields.
Frame/Text/Animation/Graffiti/GifAnimation each have one box:
`layerType, startColumn, startRow, showWidth, showHeight`. **Clock does not have one single
box** — each of its hour/spaceHour/minute/spaceMinute/seconds/ampm sub-groups carries its
own independent `{color, startColumn, startRow, width, height}`
`[VENDOR ILedClockUtils.java:3388-3425]`, so the clock's digits can be confined to fewer than
32 columns, leaving the rest of the panel free for another content's own disjoint region —
this is exactly what makes an "icon beside the live clock" composition possible as two
ordinary combine-programs in one program, not a special mode.

**`layerType`** is binary (0 or 1) in every content type's default value found in source —
never anything richer:

| default 0 (base-ish) | default 1 (overlay-ish) |
|---|---|
| Clock, Temperature, Scoreboard, Humidity, Reminder, GIF-file-animation's background | Date, Timecount, Text, Animation, Graffiti, Dynamic-text |

Reading this as "0 = base/background, 1 = overlay" is a reasonable pattern match, **not
vendor-confirmed compositing semantics** — see §4.3.

**Max contents per program**: no explicit count cap found anywhere in decompiled code. The
real constraint is whatever the true total-transfer-byte ceiling turns out to be (§6) — see
Open Questions §3.

**Max programs**: **9**, `[DEVICE]` our unit's `0x1f` reply byte[8] (`maxProgramNumber`) = `0x09`,
`[VENDOR DeviceManager.java:4590]` `ILedClockManager.maxProgramNumber = list[8]`.

### 4.3 Layer transparency / z-order — UNCONFIRMED

Structurally, **disjoint (non-overlapping) regions from different content items definitely
coexist correctly** — each carries its own independently-addressed region and the app's own
encoding never blends a shared canvas; whatever compositing happens is entirely on-device.
Whether **overlapping** regions blend (e.g. is a `layerType`-1 content's black/off pixels
treated as transparent, letting a `layerType`-0 content underneath show through?), mask, or
simply have the later-listed content win outright with no alpha at all, has **no evidence
either way**. See Open Questions §5.

### 4.4 `showCount`/duration semantics are content-type-specific

`[VENDOR ILedClockUtils.java:4527-4640]` — the "start upload" header's duration/show-count
suffix has a *different shape* depending on `programType`:

| `programType` | Suffix shape | Meaning |
|---|---|---|
| 8 (Timecount) | `01` | fixed |
| 9 | `02` | fixed |
| 11 (Scoreboard) | `03` | fixed |
| 7 (Clock), `isClockInProgramList=false` | `04,01,+4B(10)` | fixed unit 10, standalone clock |
| 7 (Clock), `isClockInProgramList=true` | `00,01,+4B(showCount*5)` | clock sharing a playlist with other programs — duration computed as `showCount * 5` |
| 6 or 19 (Date-family) | `04,01,+4B(5)` | always fixed unit 5 |
| 14 (Reminder) | `05,+1B(reminderId)` | carries the reminder's own ID, not a duration at all |
| everything else | `00,00,+4B(showCount)` | raw showCount value |

`isClockInProgramList` specifically changes how a **clock program's own on-screen duration**
is computed depending on whether it is the sole program or one of several in rotation.

---

## 5. Animation

**Frame count**: raw 2-byte wire field (`getHexListStringForIntWithTwoByte(frames.size())`)
`[VENDOR ILedClockUtils.java:3164]` — hard field-width ceiling 65535, far beyond any
practical transfer budget (§6). **No frame-count cap of any kind found in the vendor's own
GIF decode loop** — `for (i=0; i<standardGifDecoder.getFrameCount(); i++)`, unconditional,
no decimation/skipping logic anywhere in `glide/DptLoadImage.java`.

**Per-frame delay**: also a raw 2-byte field, **per frame** if a `delays` list is supplied,
else every frame repeats one uniform `speed` 2-byte value
`[VENDOR ILedClockUtils.java:3163-3175]`. Units are **milliseconds**: the vendor's own
GIF-import path gets each frame's delay from Glide's `StandardGifDecoder.getDelay(i)`
(already ms-normalized from the GIF's native centiseconds) and floors it —
`Math.max(delay, 20)` `[VENDOR DptLoadImage.java:~994]` — before storing it directly, with no
further scaling, into the very same list that becomes the wire field. So: **1ms granularity,
0–65535 hard wire range, 20ms is an app-side import convention (not a proven firmware/wire
minimum)**.

**Pixel wire order — a real, non-obvious correction**: `getAnimationDataColor`
`[VENDOR ILedClockUtils.java:3041-3050]`:

```java
for (List<DrawItem> frame : frames)
    for (int col = 0; col < width; col++)      // OUTER loop = column
        for (int row = 0; row < height; row++)  // INNER loop = row
            emit(colour(frame.get(row*width + col)));
```

The wire byte order is **column-major** (every row of column 0, then every row of column 1,
...) even though the *source* list is row-major-indexed (`row*width+col`). An earlier project
doc (`docs/FEATURES-app.md`) claims flatly "row-major" — that is wrong for this content type.
Confirmed identical for GRAFFITI's `getDrawListDataFColor` (same loop shape, independently
verified by ProtocolLib against the same source). Any code that builds animation/graffiti
wire bytes directly (not via `hardware.py`, which does not encode full frames) must respect
this or images will come out transposed on the real device.

**Vendor's own GIF/image import pipeline** (`glide/DptLoadImage.java`, this is the vendor's
*reference* adaptation pipeline, not ours):

1. **Decode**: Glide's `StandardGifDecoder` + `GifHeaderParser`, all frames, unconditional
   loop, no cap `[VENDOR DptLoadImage.java:~975-1000]`.
2. **Resize, two passes** `[VENDOR DptLoadImage.java:1063-1080]`:
   - Aspect-ratio-preserving pass: adjusts one target dimension to match the source's aspect
     ratio, then `Bitmap.createScaledBitmap(bitmap, w, h, false)` — **nearest-neighbor**
     (`false` = no filtering).
   - Final exact-size pass: `Bitmap.createScaledBitmap(bitmap, w, h, true)` — **bilinear**
     (`true` = filtered), only when the aspect-preserving result isn't already the exact
     target size.
   - Net effect: NOT a center-crop, NOT a plain stretch — a letterbox/pillarbox-style
     aspect-preserving fit (nearest-neighbor) followed by a smoothing pass to the final exact
     box.
3. **No dithering anywhere** (grep-confirmed absent from both `DptLoadImage.java` and
   `utils/GifUtils.java`).
4. **Colour extraction**: `getDrawItemsFromBitmap(Bitmap)` stores raw 8-bit ARGB per pixel
   directly `[VENDOR TextEmojiManagerCoolLEDUX.java:549-562]` — RGB444 quantization happens
   later, at encode time, via the shared curved encoder (§2.2), identically to hand-drawn
   graffiti.

`utils/GifUtils.java` is the *reverse* direction only (exporting/generating a GIF file from
`DrawItem` frames for save/preview) — it plays no role in importing art onto the device.

---

## 6. Memory / transfer

**Wire cost per pixel**: exactly **2 bytes**, always, any RGB444-encoded content path (both
`getColorDataWithColor*` variants return a 2-element hex list per call). A full 32×16 frame
is **1024 raw (pre-compression) bytes**, plus ~19–21 bytes of fixed per-content
header/region overhead for animation/graffiti.

**Chunking** (`getDataPacket(list, tag, packageSize)` `[VENDOR ILedClockUtils.java:2509-2537]`,
`[VECTOR]`-confirmed against all 4 `getDataPacket(list,tag,size)` golden vectors): the
**LZSS-compressed** byte stream (not raw pixel bytes) is split into `packageSize`-byte
groups; each chunk is wrapped `tag(1B) + total_compressed_len(4B BE) + chunk_index(2B BE) +
chunk_len(2B BE) + chunk_bytes + xor_checksum(1B)`, then 01/03-framed and escaped like every
other command. **All multi-byte fields here are big-endian** — confirmed by direct read of
`LightUtils.getHexListStringForIntWithFourByte`/`WithTwoByte` (most-significant substring
emitted first, `[VENDOR LightUtils.java:199-222,291-339]`) — this corrects an older project
note (`docs/FEATURES-app.md`) that guessed little-endian.

**`packageSize`**: `[VENDOR DeviceManager.java:4594-4607]` read from the `0x1f` device-info
reply bytes 19–20 (big-endian 2-byte) **only if the reply has exactly 21 fields**; clamped
back to the **1024 default** if the reported value is 0 or > 4096. Our live device's reply
has **24** fields, so this branch never fires and it silently defaults to **1024**
`[DEVICE]`.

**Errors**: `[VENDOR DeviceManager.java, program-upload state machine]` — opcode `0x02`
("program start") ack byte: `0`=ready to send chunks, `1`=matching program already stored
(successful cache hit: skip chunks and complete the show), other=unknown-error. Opcode `0x03`
`1`/`2`/`3`=distinct device/data-error codes (exact per-code distinction not cleanly
recoverable from decompiled logic; opcode `0xff` mirrors this for OTA chunks). Retries:
`MAX_RETRY_TIMES_FOR_PACKAGE=3`, `MAX_RETRY_TIMES_FOR_ALL=3`, `MESSAGE_SEND_OVERTIME=5000ms`
`[VENDOR DeviceManager.java:159-163]`. **No explicit pre-upload size check exists anywhere**
— `getDataResult()` only returns `null` if LZSS compression itself fails (the one documented
case: empty input, a real vendor NPE bug, `[VECTOR golden/README.md]`), never from a program
simply being "too big". A real DATA_LENGTH_ERROR-style code was not found; whatever happens
on an oversized upload is presumably a device-side rejection at one of the ack codes above,
untested.

**LZSS compression ratio** — measured directly from the vendor algorithm's own 5 golden test
corpora (not pixel-representative, but the only real measurements available):

| corpus | original | compressed | ratio |
|---|---|---|---|
| 100 zero bytes | 100 B | 13 B | **7.7× smaller** |
| 5000 B, 2-byte repeating pattern | 5000 B | 593 B | **8.4× smaller** |
| 1000 B, PRNG-random | 1000 B | 1125 B | **1.125× *larger*** (LZSS has no raw-store fallback) |

Real pixel art usually has large flat-colour runs and repeated 2-byte RGB444 pairs, so the
repetitive-data measurements (~4–8×) are a far better planning proxy than the random-data
one; noisy/photographic/generative-dither content should plan for little or no compression
headroom, possibly *negative* headroom. `hardware.estimate_lzss_ratio()` exposes both
measured ratios directly.

**No hard total-program-byte ceiling was found anywhere** (decompiled code or live replies)
— `hardware.frame_budget()`'s default (`DEFAULT_MAX_PROGRAM_BYTES_ESTIMATE = 65536`) is
explicitly `[INFERENCE]`, order-of-magnitude reasoning only (64 full raw frames; same rough
scale as a small-MCU RAM budget — the JieLi AC695x is a Bluetooth-audio SoC repurposed here,
no public datasheet with an exact RAM figure was found by web search). See Open Questions
§3.

---

## 7. Firmware-native features (composable layers)

See `hardware.NATIVE_LAYERS` for the machine-readable catalogue; narrative detail below.

### 7.1 Clock faces — 41 styles, not 30

**41**, not 30: exactly 41 distinct `styleNNumberData1632` constants exist in source,
`N = 1..41` contiguous, verified by direct grep count
`[VENDOR ILedClockUtils.java:112-...]`. Style selection UI is
`ILedClockClockTimeActivity`/`ILedClockClockTimeFragment.java`
(`light/iledclock/`, our device's own screens). A sibling scout initially found "30 styles"
from `ic_clock_style1-30_1632.gif` drawables — those belong to
`light/coolledux/DiscoverClockActivity.java`, the **older, generic CoolledUX-family product's**
discovery screen, a different (sibling) product line's UI, not this device's own. **41 is the
correct count for iLedClock.**

**8 named colours, including black — not 7**: `[VENDOR ILedClockClockTimeActivity.java:121-128]`,
directly read, in this exact order:

| index | name | RGB | index | name | RGB |
|---|---|---|---|---|---|
| 0 | red | `#FF0000` | 4 | cyan | `#00FFFF` |
| 1 | magenta | `#FF00FF` | 5 | blue | `#0000FF` |
| 2 | yellow | `#FFFF00` | 6 | white | `#FFFFFF` |
| 3 | green | `#00FF00` | 7 | black | `#000000` |

(A sibling scout's "7 colours, no black" came from the same `DiscoverClockActivity.java`
sibling-product screen as the 30-style discrepancy above — same root cause, same
resolution.)

**Structure** (`getDataWithClockCombineProgram`, `[VENDOR ILedClockUtils.java:3357-3453]`):
`layerType`, mode flags (`is24HourShowMode`/`isDateShowMode`/`isSpaceShing`), then per-group
`{colour(linear RGB444), startColumn, startRow, width, height}` for hour → spaceHour → minute
→ spaceMinute → seconds → ampm, each with its own numeral-glyph-table length+data where
applicable. **Hard-coded to `DEVICE_ROW==16 && DEVICE_COLUMN==32` with no fallback table for
any other geometry** `[VECTOR golden/README.md "Device-geometry-gated quirks"]` — this is
fine, it *is* our geometry, but it means this content type is only usable at exactly this
resolution.

Glyph geometry (style 10, representative sample): 60 bytes total ÷ 10 digits = **6 bytes per
digit**. Exact pixel width/height split of those 6 bytes was **not** independently confirmed
pixel-by-pixel `[INFERENCE]` — see Open Questions §6. No clock-face preview images were
found in the app's own assets specifically for these 41 styles (only compiled drawable
resources for the *sibling* CoolledUX product's 30 styles) — we cannot show real face
thumbnails without rendering them ourselves from the glyph tables or capturing them live.

### 7.2 Date, Temperature, Humidity, Timecount, Scoreboard

All render from live device-tracked state at zero re-upload cost. Wire structure fully
specified per-type (see `hardware.NATIVE_LAYERS`); Date is more defensively coded than Clock
(succeeds at multiple geometries in the golden harness, not hardcoded to one)
`[VECTOR golden/README.md]`. Scoreboard: minutes 0–99, seconds 0–59
`[VENDOR light/iledclock/ILedClockScoreBoardTimeDialog.java]`; score itself has no
enforced maximum. Timecount: hardcoded to our exact geometry like Clock, hours 0–23/minutes
0–59/seconds 0–59.

### 7.3 Text — 28 colour-cycle modes (not 31 — that number belongs to a different, global command)

Two genuinely different enumerations exist and must not be conflated:

- **TEXT content's own `autoColorType`, 1–28**: pre-baked nibble-pair pattern tables (already
  in final RGB444 form, no live RGB888 quantization at all) — 1–14 are individually distinct
  `[VECTOR ProtocolLib's protocol/color_tables.py COLOR_TYPE_1..14]`, 15–28 all share one
  3-colour literal `"00,FF,0F,0F,0F,F0"` `[VENDOR ILedClockUtils.java colorType15-28 constants]`.
- **The GLOBAL solid-colour-effect command** (opcode `0x13 0x03`, `setColorMode`, entirely
  separate from any uploaded program content — more like a whole-panel "light effect" mode):
  accepts `i` 0–32, dispatches across 30 named `colorModeN` tables in source, but a confirmed
  real vendor bug (`[VECTOR golden/README.md]`'s `setColorMode` control-flow analysis,
  independently mechanically verified twice) collapses every `i >= 11` onto one of 3 shared
  dead-end tables — so only modes **1–10 are meaningfully distinct in practice**, despite 30
  tables existing in source.

Custom/explicit-colour text uses the curved encoder (§2.2), same as graffiti/animation.

**Font sizes**: 12, 14, or 16 px `[VENDOR light/iledclock/ILedClockTextFontSizeDialog.java]`;
16px is the default for our width, 14px preferred for 32-column/RTL contexts. On-device font
assets exist (`UNICODE12`/`UNICODE12_BOLD`/`UNICODE16`/`UNICODE16_BOLD` plus
device-specific `32_16_large`/`32_16_small` binary blobs in `base/assets/`) but their binary
format was not reverse-engineered — not needed, since text rendering for *our own uploaded
art* goes through our own font rasterizer (`protocol/render.py`), never the device's;
on-device fonts only matter for the native Text *layer*, whose glyphs the firmware draws
itself from parameters we send (a colour mode, a size, the string), not from pixels we push.

### 7.4 Border/frame

20 built-in patterns (`frameType` 1–20) `[VENDOR/VECTOR — ProtocolLib's protocol/color_tables.py
FRAME_TYPE, ported from getDataWithFrameProgramContent's dispatch; golden vectors cover
frameType 1/8/15/20]`, plus a `frameShowType`/`speed` pair suggesting an animated-border
option (exact enum not fully traced). Genuinely composable as a decorative border around an
art region.

### 7.5 Reminder

Notification, not a visual layer — max **16**, ID randomly assigned 1–16
`[VENDOR light/iledclock/ILedClockReminderActivity.java:198-202]`, repeat type
0=never/1=every_day/2=every_week/3=every_month/4=every_year. Included for completeness only.

---

## 8. Other hardware

| Feature | Finding | Grade |
|---|---|---|
| **Microphone / rhythm** | The app's music-rhythm visualiser uses the **phone's** microphone (`MicManager.startRecording()` needs Android's `RECORD_AUDIO`) or local music files, computes a **frequency-spectrum summary** on the phone and streams it over BLE (opcode `0x01`, never raw PCM); opcode `0x06` picks one of 5 rhythm display types (ids 1–5). The device-info flag `isLocalMicSupported`=`00` belongs to the CoolLED M/UX on-device rhythm feature (only read by `coolledm/*Rhythm1696PlusFragment`, `coolledux/DiscoverRhythmCoolleduxActivity`), not to iLedClock. **Separately, night mode has "voice control"** (enable, sensitivity, wake-up duration 5+ min) — the firmware wakes the dimmed display on sound, which implies an **on-board sound sensor/mic used only by the firmware** `[INFERENCE]`; nothing in the protocol reads its level. Live unit: voice control on, sensitivity 6, wake 30 min `[DEVICE]`. | `[VENDOR light/iledclock/ILedClockMicFragment.java:103-162, ILedClockMusicFragment.java, ILedClockNightModeActivity.java:58-110]` |
| **Buzzer / volume** | Range **0–5** (6 discrete steps). `[DEVICE]` live volume=5 — exactly the observed max, self-consistent. | `[VENDOR light/iledclock/ILedClockVolumeActivity.java:54-59]` |
| **Temperature/humidity sensor** | `ILedClockTemperatureAndHumidityActivity.java` is an **empty stub** — no `onCreate`, no UI, no sensor-presence flag anywhere in decompiled code. `[DEVICE]` live query `19 01` → reply `19 01 00 00 00` (temp=0, temp_frac=0, humidity=0); live query `19 00` → **no reply at all**. Best-evidence conclusion: **no working sensor on this unit.** | `[VENDOR]`+`[DEVICE]`, not 100% conclusive — see Open Questions §10 |
| **RTC / time sync** | `getSynchronizeTime()` (opcode `0x09`) sends year(−2000)/month/day/weekday/h/m/s; send-only, triggered from clock/timer screens on open. | `[VENDOR ILedClockUtils.java:4834-4888]` |
| **Power-on behaviour** | No evidence found either way of what the display shows immediately after power-on before any app connects (e.g. does it resume the last program, or show a fixed boot animation?). | not found — genuinely open, low priority for art |
| **Physical buttons/keys** | None. Grepped all 98 `light/iledclock/*.java` files for `KeyEvent`/`onKeyDown`/`onKeyUp`/`onKeyLongPress` — the only hits are software-IME editor-action handling in text-entry dialogs, never a physical device key. Control is BLE-only. | `[VENDOR]`, exhaustive grep |

---

## 9. Device-info / OTA reply decode

Decoded with the exact vendor `LightUtils.recoverData` algorithm (strip 01/03 frame,
un-escape `02,b → b^4`, drop the 2-byte length prefix) applied to the real captured frames in
`tests/live_replies_2026-09-25.json`.

### 9.1 `0x1f` device info (24 bytes unescaped)

```
1f 01 a3 00 00 00 00 01 09 01 04 03 00 00 04 00 00 21 00 10 00 00 00 05
```

| offset | field | value | meaning | grade |
|---|---|---|---|---|
| 0 | opcode | `1f` | — | — |
| 1 | isSwitchOnOff | `01` | display on | `[VENDOR DeviceManager.java:4608]` |
| 2 | brightness | `a3`=163 | **outside** the 5–100 SET range — see §3 | `[VENDOR DeviceManager.java:4584]`, `[DEVICE]` |
| 3 | rotate | `00` | none | `[VENDOR]` |
| 4 | isLocalMicSupported | `00` | false (see caveat below) | `[VENDOR]` |
| 5 | isLocalMicOnOff | `00` | false | `[VENDOR]` |
| 6 | localMicMode | `00` | — | `[VENDOR]` |
| 7 | isShowDeviceId | `01` | true | `[VENDOR]` |
| 8 | maxProgramNumber | `09`=9 | **9 program slots** | `[VENDOR]`, `[DEVICE]` |
| 9 | (isRemoteEnable source) | `01` | see quirk below | `[VENDOR]` |
| 10–18 | *not parsed by the app* | — | present in the reply but the app never reads these bytes — reserved/future/other-variant fields | `[VENDOR]` (absence of a read, confirmed) |
| 19–20 | packageSize (only if reply has 21 fields) | n/a here (reply has 24 fields) | falls back to default 1024 | `[VENDOR DeviceManager.java:4594-4607]` |
| 21 | *not parsed* | `00` | — | `[VENDOR]` |
| 22 | (isMute source) | `00` | see quirk below | `[VENDOR]` |
| 23 | volume | `05`=5 | matches observed max (§8) | `[VENDOR]`, `[DEVICE]` |

**Real vendor bug worth knowing about** (harmless for the capability profile, relevant if
`protocol/responses.py` ever ports this app-state derivation): both the `isRemoteEnable` and
`isMute` "true" branches erroneously test the *previous* loop variable
(`i109`, sourced from byte 7) instead of their own (`i110`/`i111`, bytes 9/22) —
`[VENDOR DeviceManager.java:4628-4636]`. The false branches are unaffected.

### 9.2 `0xfd` OTA version reply (34 bytes unescaped)

```
fd 01 00 21 1d "AC695X_01_16x65535UX_00000400"
```

| offset | field | value |
|---|---|---|
| 0 | opcode | `fd` |
| 1 | otaFlag | `01` (update-check flag set) |
| 2–3 | firmware version (big-endian) | `0021` = 33 decimal — **matches the manufacturer-data firmware byte exactly** |
| 4 | filename length | `1d` = 29 |
| 5–33 | ASCII filename | `AC695X_01_16x65535UX_00000400` (29 bytes) — **`AC695X`** is the JieLi SoC family name; `16x65535` reads as `rows×(some 16-bit field)`, `UX` likely the CoolledUX firmware family tag |

### 9.3 `0x14 0x02` night mode reply (12 bytes: opcode+subcmd+10 params)

```
14 02 01 15 00 08 00 01 19 01 1e 06
```

| param | value | meaning |
|---|---|---|
| enabled | `01` | on |
| start | `15:00` | 21:00 |
| end | `08:00` | 08:00 |
| deviceStateEnabled | `01` | device stays "on" logically during night mode |
| brightness | `19`=25 | dimmed night brightness |
| voiceControlEnabled | `01` | on |
| wakeUpDuration | `1e`=30 | minutes — self-consistent round number |
| voiceSensitivity | `06`=6 | small integer level — self-consistent |

(Field ORDER here — voiceControlEnabled before wakeUpDuration/voiceSensitivity — is read
directly from the receive-side parsing code, not assumed from an earlier project doc's
guessed order, and is internally self-consistent: both booleans decode to clean 0/1 and both
numeric fields decode to plausible round numbers under this ordering, unlike the alternative.)

### 9.4 Other live replies decoded (supplementary, not core to art capability)

| query | reply payload | reading |
|---|---|---|
| `0b` timer switch get | `0b 00` | 0 configured |
| `15 02` tomato get | `15 02 04 05 0a 19 2d` | 4 durations configured: **5, 10, 25, 45** — confirms unit is minutes (upgrades an earlier `[INFERENCE]` to `[DEVICE]`-graded) |
| `16 02` alarms get | `16 02 00` | 0 configured |
| `1a 01` reminders get | `1a 01 00` | 0 configured |
| `11 01` scoreboard status | all-zero | idle |
| `10 01` stopwatch status | all-zero | stopped at 0 |

---

## Open questions → live experiments (ordered by value to art quality)

| # | Question | Experiment | What to look for |
|---|---|---|---|
| 1 | Does `displayed_rgb`'s `nibble * 17` bit-replication expansion actually match the LEDs' real perceived brightness per nibble level, or is the true PWM response non-linear? | Upload a `setColor` (opcode `0x13 0x01`) solid fill for each of the 16 curved-transfer input values that hit nibbles 0–15 (e.g. R channel = 0, 48, 62, 75, ... 238), photograph the panel with fixed camera exposure/ISO for each, measure relative luminance. | Plot measured luminance vs. nibble; compare to the linear `n*17`/255 line. A logarithmic/gamma-like curve would mean `displayed_rgb` should apply a gamma correction instead of bit-replication for accurate previews. |
| 2 | ~~What is the device's real *minimum* frame delay~~ **Answered 2026-09-26 [DEVICE]:** the delay field counts ~1.5 ms per unit (8x125 -> ~1.5 s loop, 32x20 -> ~1.0 s loop), and a 10 ms-real frame (7 units) still plays visibly faster and smooth, so the clock sustains ~100 fps; `hardware.DEVICE_MS_PER_DELAY_UNIT`, floor 10 ms. Original question: What is the device's real *minimum* frame delay (does it honour <20ms, or does it have its own coarser refresh-rate floor), and is there a practical maximum sensible delay? | Upload a 2-frame animation (solid red / solid green, distinguishable by eye or photodiode) with `delay=1ms`, then repeat at 5, 10, 20, 50, 100ms. Film at high frame rate (120fps+ phone slow-mo) or use a photodiode+scope. | The smallest delay where frames are still visibly/measurably distinct swaps is the real floor — replaces the `[INFERENCE]`-graded 20ms default in `ANIMATION_DELAY_PRACTICAL_FLOOR_MS`. |
| 3 | What is the real maximum program size (bytes) or frame count before the device rejects/fails an upload? | Binary-search: upload progressively larger animations (start at 8 frames of full 32×16 noise — worst-case incompressible, per §6 — double each time) via the real upload flow, watch for a nonzero chunk-ack status or a connection drop. | The largest program that uploads and displays correctly (both compressed-byte size and frame count) replaces the `[INFERENCE]`-graded `DEFAULT_MAX_PROGRAM_BYTES_ESTIMATE` (currently 65536, unverified) with a real number. |
| 4 | Does the *firmware itself* protect against excess current draw at high brightness + full-white content, independent of the app-side `adjustPower` code we found has no call sites? | Set brightness to 100 (wire max), upload a solid full-white (`255,255,255`) `setColor` fill with **no** `power_limited()` pre-scaling applied client-side, observe/photograph actual output brightness/colour, and if possible measure current draw. | If the panel visibly dims or shifts colour on its own vs. a calculated-safe (612-budget) equivalent sent instead, the firmware has its own protection and `power_limited()` is redundant-but-harmless; if it stays full brightness with no self-protection, `power_limited()` is a genuinely load-bearing safety measure our pipeline should always apply. |
| 5 | Do two content layers with **overlapping** regions actually composite (black-transparent, masked) or does one simply overwrite the other? | Upload one program with a CLOCK content (digits confined to columns 0–20) plus an ANIMATION content whose region **overlaps** the clock digits (e.g. columns 10–31), animation content = mostly black with a few bright pixels inside the overlap. Photograph the result. | If clock digits show through the animation's black pixels in the overlap zone, `layerType` 1-over-0 masks on black (real alpha-like compositing). If the animation content simply blanks/overwrites that region, there's no compositing — art layouts must keep clock and art regions strictly disjoint (as GalleryEngine's `icon_with_clock` currently does, defensively, pending this answer). |
| 6 | Exact pixel width/height of the 41 clock styles' numeral glyphs at our geometry (needed for a real style-picker gallery, and to size an `icon_with_clock` composition's reserved column width precisely). | For each of the 41 styles, upload a CLOCK program at a fixed time and photograph/screenshot the panel (or decode+render the raw `styleNNumberData1632` bytes ourselves once the bit-packing is confirmed by this same photograph). | A 41-image reference gallery (feeds GalleryUI's style picker) plus a confirmed minimum practical column width per style for `icon_with_clock`, replacing the current `[INFERENCE]`-graded "6 bytes/digit, exact pixel split unconfirmed" note. |
| 7 | Is the live device-info brightness reading (`0xa3`=163, outside the documented 5–100 SET range) a units mismatch, or something else? | `getSetBrightness(50)` (a known, in-range value), then immediately `getDeviceInfo()` (opcode `0x1f`) and read byte 2 back. | If it comes back as `50` (or `0x32`), the earlier 163 reading was simply whatever the device was last set to by some other means (app/OTA default) and the SET/GET units genuinely match — safe to treat device-info brightness as directly comparable to the SET range everywhere (e.g. in a `sensor.iledclock_brightness`). If it comes back scaled/different, there's a real unit conversion to add. |
| 8 | Confirm the minimum practical column width the CLOCK content's hour+minute digits can be confined to, for `icon_with_clock` layout sizing. | Upload a CLOCK program with `hourWidth`/`minuteWidth`/`spaceHourWidth` progressively narrowed from their example values (14/14/4-ish per the golden vector sample) down toward 0, observe when digits become illegible or the upload itself is rejected. | The smallest workable width becomes a real constant for `NATIVE_LAYERS["clock"]`'s region guidance, replacing GalleryEngine's current placeholder tunable. |
| 9 | Is there truly no temperature/humidity sensor, or does the `19 01`/`19 00` query need a different trigger (e.g. only responds after the device has been powered on for a warm-up period, or needs a different sub-command byte than 0/1)? | Try `getTemperatureAndHumidity(i)` for every `i` in 0–5 (not just the 2 already captured), and repeat the `19 01` query a few minutes after power-on/after the display has been running warm content. | Any non-zero, plausible-looking reading overturns the current best-evidence "no sensor" conclusion; consistent all-zero/no-reply across all sub-commands and timings confirms it firmly enough to disable the temperature/humidity entities outright rather than showing a perpetual "0°". |
| 10 | Exact distinct meaning of chunk-ack status codes 1/2/3 (`0x03` opcode) — are they all equally "retry the same chunk", or do any warrant a different client response (e.g. abort vs. retry vs. re-send-from-start)? | Deliberately trigger each: send a chunk with a corrupted XOR checksum (→ suspected DATA_ERROR), send chunks out of order (→ suspected DEVICE_ERROR), and a normal chunk after an artificial delay past the 5000ms timeout, observe which status byte each provokes. | Confirms (or corrects) the current generic "1/2/3 = distinct device/data errors, all retry" reading in §6, most useful to ProtocolLib's retry-handling logic rather than to art quality directly — lowest priority of the ten, included because it is the last real gap in the transfer-error picture. |
| 11 | Does the clock really have its own sound sensor (night-mode "voice control"), and how sensitive is each level? | During night mode (or with night mode temporarily set to cover the current time), clap/speak near the clock at sensitivity 1, 6 and max; watch whether the display wakes and for how long. | Waking on sound confirms an on-board sound sensor (firmware-only, not readable over BLE); the lowest level that reacts to a normal voice becomes the default we suggest in the UI. |

---

## Coordination notes (for other agents, not part of the evidence record above)

- **GalleryEngine**: `adapt.py` should call `displayed_rgb`/`power_limited`/
  `quantize_delay_ms`/`frame_budget` from this module, and prefer composing with
  `NATIVE_LAYERS` (e.g. a small icon region beside a live `NATIVE_LAYERS["clock"]` layer,
  using disjoint regions per §4.3's open compositing question) over replacing the firmware
  clock with a fully-rendered approximation.
- **ProtocolLib**: colour-path split, column-major animation/graffiti pixel order, and the
  "adjustPower has no call sites" finding were already cross-confirmed live over `hub`
  during this work (2026-09-26) — no outstanding discrepancy between `protocol/` and this
  module as of writing.
- **GalleryUI/StudioFrontend**: the LED-look preview canvas should use `displayed_rgb`
  semantics (curved for animation/graffiti/solid/custom-text, linear for clock/date/
  timer/scoreboard/temperature/humidity — not one blanket RGB444 mapping), and should expose
  `NATIVE_LAYERS`-based compositions (e.g. "icon beside clock") as selectable layout choices
  once GalleryEngine lands them.

## Live session 2026-09-26 (Nitin at the clock)

- **Pixel upload**: a test pattern (white border, red/green/blue thirds, yellow marker top-left)
  showed correctly - colour order, orientation and column-major packing confirmed [DEVICE].
- **Brightness**: the firmware keeps getting brighter above the vendor slider's 100: 100 < 163 <
  255, clearly visible [DEVICE]. HA now maps its 1-255 onto 5-255. The dim-looking white at 163
  was simply brightness.
- **Frame timing**: the delay field counts ~1.5 ms per unit (8x125 -> ~1.5 s loop, 32x20 -> ~1.0
  s loop) and 7 units (10 ms real) still plays visibly faster and smooth [DEVICE];
  `DEVICE_MS_PER_DELAY_UNIT`. Exact ceiling (~100 fps?) needs a 240 fps slow-motion video.
- **Art + live clock**: an animation in columns 0-15 plus firmware clock style 16 in columns
  16-31 in one program (type 7) displays both, the clock keeping time by itself [DEVICE].
  Firmware-drawn faces MUST use the vendor's per-style geometry and digit size
  (`clock_styles.py`); invented geometry renders fragments [DEVICE].
- **Night mode order**: set order is ..., brightness, voice, wake, sensitivity (vendor call site
  DeviceManager.java:6983), identical to the 14 02 reply [DEVICE: wrong order stored "wake 1 min"].
- **Voice wake (clap)**: not yet observed. Every BLE command also wakes the display for the full
  wake period, so test it after the display has dimmed on its own, with HA idle.
