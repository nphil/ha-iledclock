# iLedClock 32×16 Feature & Protocol Catalogue

Source: CoolLED1248 v2.7.7 decompiled with JADX. All lines cited from /data/home/tmp/led1248/src/sources/com/jtkj/led1248/light/iledclock/*.java and light/utils/ILedClockUtils.java.

## Protocol Frame Format (VERIFIED)
Frame = `01` + escape(len_hi, len_lo, payload...) + `03`
Escape rule: byte b where 0 < b < 4 becomes `02` + (b ^ 0x04); 0x00 NOT escaped.
Length = payload size (2-byte big-endian).
Chunked data (large programs): tag (1B) + total_len(4B-LE) + chunk_idx(2B-LE) + chunk_len(2B-LE) + chunk + XOR-all-body-bytes(1B).

## 25 Features (Comprehensive List)

### Display Programs
1. **Clock (Opcode, 41 Styles)** — ILedClockClockTimeActivity.java / getDataWithClockCombineProgram() line 3357. Styles 1–41 (line 98–138), colours 0–7 (red/magenta/yellow/green/cyan/blue/white/black), hours 24/12 mode, show duration. State: reads via opcode 09 (sync), opcode 1f (device info).

2. **Text Program (28 Colour Modes)** — ILedClockTextActivity.java / getDataWithTextAutoColorProgramContent() line 2746. Modes 1–28 (line 2758–2942: rainbow, fade, transitions), speed 0–255, position/size (col/row in 2B-LE each, lines 2754–2757), mode byte, font size, stay time. Encoding: RGB444 via TextEmojiManagerCoolLEDUX line 3046.

3. **Graffiti / Pixel Art** — ILedClockGraffitiActivity.java / getDataWithGraffitiCombineProgram() line 3302. Free-form drawing on 32×16 canvas, speed, mode, stay time. getGraffitiData() line 3182 encodes pixel-by-pixel RGB444 (line 3190).

4. **Animation (Multi-Frame GIF)** — ILedClockAnimationActivity.java / getDataWithAnimationCombineProgram() [four overloads, lines 3053–3148]. Frame list, speed (uniform or per-frame delays), position/size (2B-LE each). Supports: JSON GIF, file path, embedded resource, encrypted image. Animation frame count (2B-LE, line 3164), delay per frame (2B-LE, line 3167 or 3172).

5. **Material Library (Pre-Built Assets)** — ILedClockMaterialFragment.java / ILedClockMaterialDetailFragment.java. Icons, animations, text effects from bundle + server download (OkHttpUtils). Not sent directly; converted to Text/Animation/Graffiti programs via builders before transmission.

6. **Text Templates (Type 3–4)** — ILedClockTextTemplateActivity.java / ILedClockTextTemplateThreeActivity.java / ILedClockTextTemplateFourActivity.java. Multi-layer text with predefined layout. Encodes as multiple text layers via getDataWithTextAutoColorProgramContent().

### Timer & Clock Features
7. **Countdown (Opcode 0f, Sub 01/02/03)** — ILedClockCountdownActivity.java. Hours 0–23, minutes 0–59, seconds 0–59. Actions: 01=status, 02=reset, 03=start|stop. UI: wheel pickers (line 41–52). Response: hour/min/sec/isStartOrStop.

8. **Stopwatch (Opcode 10)** — ILedClockStopwatchActivity.java. Actions: 01=status, 02=reset, 03=start|stop. Display: HH:MM:SS (formatTime() line 365). State sync: full time + running flag read back.

9. **Scoreboard (Opcode 11)** — ILedClockScoreboardActivity.java. Host score, visitor score (0–999+), timer mode (0=count-up, 1=countdown), minutes 1–999, seconds 0–59. Touch to adjust; swipe up/down ±1. Time update every 1000ms (line 299).

10. **Tomato Clock / Pomodoro (Opcode 15, Sub 01)** — ILedClockTomatoClockActivity.java. List of 1–6 durations. getUsernput via dialog (line 34). State: read back via 15 02 (getTomatoClockTime() line 5237).

11. **Alarm Clock (Opcode 16, Max 16)** — ILedClockAlarmClockActivity.java. Hour 0–23, minute 0–59, enable/disable, repeat (none / every day / custom days Mon–Sun). State: read back via 16 02 (getAlarmClockTime() line 5277). Response: ILedClockGetAlarmClockResponseEvent.

### Control & Config
12. **Night Mode (Opcode 14, 10 Parameters)** — ILedClockNightModeActivity.java. (1) enabled, (2) start hour, (3) start minute, (4) end hour, (5) end minute, (6) device state enabled, (7) brightness 0–100, (8) wake duration 5–? minutes, (9) voice control enabled, (10) voice sensitivity 1–?. State: read back via 14 02 (getNightMode() line 5291). Response: ILedCLockGetNightModeEventResponse (line 88–97).

13. **Timer Switch / Scheduling (Opcode 0a/0b, Max 4)** — ILedClockTimerSwitchActivity.java. Time HH:MM, action (on/off), enable/disable per entry. State: read via 0b (getTimerSwitch() line 4989).

14. **Device Settings (Opcode 1e/1f)** — ILedClockSettingsFragment.java. Brightness 5–100 (seekbar +5 offset, line 99), rotate 0–3 (none/xy/x/y, line 77–82), volume, device ID show, remote enable. State: read via 1f (getDeviceInfo() line 4732).

15. **Power (Opcode 05)** — getSwitchData() line 4738. Boolean on/off → byte 01 or 00. State: read via 1f.

16. **Brightness (Opcode 04)** — getSetBrightness() [builder not grep'd; called line 232 ILedClockSettingsFragment]. Range 5–100. State: read via 1f.

17. **Rotate / Mirror (Opcode 0c)** — Embedded in device settings. Mode 0–3 (none / xy-flip / x-flip / y-flip, line 77–82). State: read via 1f.

### Audio & Sensing
18. **Music Rhythm (Opcode 01, 5 Types)** — ILedClockMusicFragment.java. Rhythm type 1–5 (UI carousel, line 50–65), audio source (local music or microphone), play mode (in-order / single / random). Builder: getMusicDataString() line 4819 encodes opcode 01 + int[rhythm_type] + byte[frequency_spectrum]. State: send-only; no read-back.

19. **Microphone Input (Opcode 01 subset)** — ILedClockMicFragment.java. Real-time audio capture (Android permissions READ_MEDIA_AUDIO, RECORD_AUDIO, line 120–145). Synchronized with music rhythm in local processing; streamed as opcode 01.

20. **Temperature & Humidity (Opcode 19)** — ILedClockTemperatureAndHumidityActivity.java (201-byte stub). Source selection (internal/external) TBD. State: likely read via opcode 19.

### Data & Communication
21. **Reminder / Notification (Opcode 1a, Max 16)** — ILedClockReminderActivity.java. Reminder ID 1–16 (random, line 399–416), content (UTF-8), date (year offset from 2000, month, day, line 274), time (hour 0–23, minute 0–59, line 275), repeat type (never / every day / bitmask Mon–Sun, line 276). State: read via 1a 01 (list), then 1a 02 (per-ID detail). Delete: 1a [cmd] [id].

22. **Time Sync (Opcode 09)** — getSynchronizeTime() line 4834. Year (offset 2000), month 1–12, day 1–31, hour 0–23, minute 0–59, second 0–59, day-of-week. Send-only; triggered on clock/timer entry (onCreate).

23. **Device Info / Get All (Opcode 1f)** — getDeviceInfo() line 4732. Query all settings: brightness, volume, rotate, device ID, remote enable, device state (power on/off), etc. Response: ILedClockDeviceInfoEvent.

### OTA & Advanced
24. **OTA Version Query (Opcode fd)** — getDeviceOTAVersion() line 5219. Opcode fd → device firmware version (uint32). State: reads via fd response.

25. **OTA Firmware Update (Opcode fe / ff)** — getStartDataForOtaUpgrade() line 4651 (opcode fe start), then chunked via ff (data). DeviceManager lines 1650–1960: state machine with retry logic (checkRetryTimes*ILedClock* methods). Progress via DeviceManager.ProgressCoolLEDEvent.

## External References
- **coolledx-driver** (Python): https://github.com/UpDryTwist/coolledx-driver — Full protocol implementation.
- **coolled1248-rs** (Rust no_std): https://github.com/jean-santos/coolled1248-rs — Rust driver.
- **coolled-editor** (Web UI): https://github.com/HumbertoL/coolled-editor — .jt file format reverse engineering.
- **LED FaceShields** (Original RE): https://git.team23.org/CrimsonClyde/led-faceshields — CrimsonClyde's foundational work.

## Colour Encoding
RGB444 (12-bit): 4R + 4G + 4B. Transferred via TextEmojiManagerCoolLEDUX.getColorDataWithRGB444Transfer() (line 3046, 3190, 3295) or getColorDataWithColor() (line 3388, 3401, 3417, 3422). Pixel data: row-major, left-to-right, top-to-bottom.

## Known Unknowns
- Exact byte-packing of RGB444 data (infer from TextEmojiManagerCoolLEDUX.java).
- Flutter word-game, night_mode_page, remind_page routes (libapp.so Dart binary, not accessible via decompilation).
- Material library server URLs (in OkHttpUtils.java, not extracted).
- Graffiti pen/eraser palette and DrawView.DrawItem encoding (likely simple RGB pixel array).
- Per-frame animation delay encoding (2-byte LE inferred from line 3167).
