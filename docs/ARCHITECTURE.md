# iLedClock for Home Assistant — architecture & contracts

Repo: `/data/home/PixelClock/ha-iledclock` (git, branch `main`; GitHub `nphil/ha-iledclock`). HA domain `iledclock`, title "iLedClock".
Device: BLE name `iLedClock`, service `0000fff0-0000-1000-8000-00805f9b34fb`, char `0000fff1-0000-1000-8000-00805f9b34fb`
(write-without-response + notify), 32x16 RGB (RGB444 on the wire), JieLi AC695x firmware 0x21. Live test unit
`01:00:00:67:0D:8A` in the Plant Room, reached through ESPHome BLE proxies.

Ground truth for bytes = vendor Java at `/data/home/tmp/led1248/src/sources/com/jtkj/led1248/`
(`light/utils/ILedClockUtils.java`, `light/utils/LightUtils.java`, `light/device/DeviceManager.java`
[`checkILedClockMessages` line 3636; program/OTA transfer ~1650-1960, 4200-4400], `light/device/ILedClockManager.java`,
`light/emoji/TextEmojiManagerCoolLEDUX.java`, `light/utils/FontUtils.java`) and golden vectors produced by running that
Java: `/data/home/tmp/led1248/golden/vectors.json` (`{fn, args, out}`; out = lowercase hex, arrays for multi-frame).
Scout prose in `local://iledclock-spec-*.md` is a map, NOT truth (it wrongly claims little-endian in places; all
LightUtils helpers are big-endian; `getHexListStringForInt(i)` emits NOTHING for i > 255 — such quirks must be preserved).

## Verified live facts (2026-09-25)
- App framing accepted: `01` + escape(len_hi, len_lo, payload) + `03`; escape only bytes 0x01..0x03 as `02, b^4`.
- `1f` → `1f 01 a3 00 00 00 00 01 09 01 04 03 00 00 04 00 00 21 00 10 00 00 00 05` (on, brightness 0xa3, 9 program slots, fw 0x21, volume 5).
- `fd` → `fd 01 00 21 1d "AC695X_01_16x65535UX_00000400"`.
- `14 02` → `14 02 01 15 00 08 00 01 19 01 1e 06` (night mode on 21:00→08:00 …).
- `0d` check-password with default "000000" → `0d 00` (00 = success). Always authenticate with the stored password
  (default "000000") right after enabling notifications, exactly like the app.
- Replies arrive as notifications framed the same way; a reply may span several notifications (reassemble 01…03).

## Layout
```
custom_components/iledclock/
  manifest.json          bluetooth matcher {local_name: "iLedClock"}; dependencies: bluetooth_adapters, http, frontend, websocket_api; iot_class local_polling; requirements: [] (Pillow ships with HA core — import lazily)
  __init__.py            setup/unload, registers static path + frontend extra JS + panel, services, websocket
  const.py
  config_flow.py         bluetooth discovery + user step (pick discovered iLedClock); options (OptionsFlowWithReload)
  protocol/              PURE PYTHON, no homeassistant imports (unit-testable standalone)
    __init__.py
    hexutil.py           faithful ports of LightUtils helpers incl. quirks
    framing.py           encode_frame(payload)->bytes, decode_frame(frame)->payload, FrameAssembler
    lzss.py  crc.py      byte-identical ports
    commands.py          every simple builder -> payload bytes (UNFRAMED; caller frames)
    responses.py         parse(payload)->typed dataclass (port of checkILedClockMessages + connect-time parsing)
    programs.py          content dataclasses + encoders + program container + start frame + packetization
    render.py            Canvas (32x16 RGB888), RGB444 quantisation exactly as the app, text rasterisation, image/GIF import (Pillow), generative animations
    fonts/               bundled pixel fonts (open-licensed, e.g. 3x5, 5x7, 8x16-ish) as compact python/json data
  client.py              BLE transport (HA bluetooth + bleak-retry-connector), serialized GATT ownership
  coordinator.py         DataUpdateCoordinator[ClockState]
  entity.py light.py switch.py number.py select.py sensor.py button.py text.py image.py binary_sensor.py
  services.py services.yaml
  websocket_api.py
  store.py               design library + playlist persistence (helpers.storage.Store)
  slots.py slot_store.py screens A/B: which content screen B takes (capability flags), per-screen record of what was sent (kind 00 / 04)
  reminders.py reminder_store.py reminder_manager.py   named alarms & reminders: pure domain (validation, plans, ids, reconcile), persistence, the only code that writes reminders to the clock
  diagnostics.py
  strings.json translations/en.json icons.json brand/
  frontend/iledclock.js  BUILT bundle (committed)
frontend/                Lit 3 + TypeScript + esbuild source (build writes custom_components/iledclock/frontend/iledclock.js)
tests/                   pytest-free unittest for protocol (python3 -m unittest), plus frontend tests (node --test or bun test)
hacs.json README.md LICENSE tools/
```

## Contract A — protocol package API (pure Python; implemented by the Protocol agent, consumed by Integration agent)
All builders return the UNFRAMED payload `bytes` starting with the opcode; `framing.encode_frame()` frames it.
```python
# framing.py
def encode_frame(payload: bytes) -> bytes
def decode_frame(frame: bytes) -> bytes            # returns payload (opcode first), raises FrameError
class FrameAssembler:                              # notification reassembly
    def feed(self, data: bytes) -> list[bytes]     # returns zero or more complete payloads

# commands.py  (names mirror the Java; values validated, ValueError on out-of-range)
device_info() power(on) brightness(level) mirror(on) rotate(mode) check_password(pw, salt=None) set_password(pw, salt=None)
sync_time(dt: datetime) music_data(kind, values) rhythm_type(kind)
stopwatch_status() stopwatch_reset() stopwatch_run(start: bool)
countdown_status() countdown_reset(h, m, s) countdown_run(start: bool)
scoreboard_status() scoreboard_set_score(home, away, a, b) scoreboard_set_time(m, s, count_down: bool) scoreboard_run(start: bool)
timer_switch_get() timer_switch_set(items: list[TimerSwitchItem])
device_setting(kind: int, on: bool) volume(level)
color(rgb: tuple[int,int,int]) color_speed(v) color_mode(mode: int)
ota_version() tomato_set(minutes: list[int]) tomato_get()
alarms_set(items: list[AlarmItem]) alarms_get() temperature_humidity(kind: int)
night_mode_get() night_mode_set(cfg: NightMode) reminders_get() reminder_detail(rid) reminder_delete(rid)
# dataclasses TimerSwitchItem, AlarmItem, NightMode, Reminder… live in protocol/models.py and are shared with responses.py

# responses.py
def parse(payload: bytes) -> Response             # Response = union of frozen dataclasses:
# DeviceInfo, OtaVersion, PasswordResult(ok), Ack(opcode, sub, status), NightMode, Alarms, TimerSwitches, Tomato,
# Reminders, ReminderDetail, TempHumidity, CountdownStatus, StopwatchStatus, ScoreboardStatus,
# ProgramStartAck(result), ProgramChunkAck(index, result), Unknown(opcode, raw)
def response_key(payload: bytes) -> tuple[int, int | None]   # (opcode, sub-op or None) for request/response correlation

# programs.py
@dataclass Frame: pixels: list[list[tuple[int,int,int]]]  (16 rows x 32 cols RGB888) + duration_ms
content dataclasses: ClockContent, DateContent, TextContent (glyph bitmaps + colour mode/speed/effects), GraffitiContent,
AnimationContent (frames, per-frame delay), TimeCountContent, ScoreboardContent, TemperatureContent, HumidityContent,
ReminderContent, FrameContent (border)
@dataclass Program: program_type: int; contents: list[Content]; show_count: int; is_clock_in_list: bool = False
def encode_program(program) -> bytes                        # == getDataWithProgram
@dataclass UploadPlan: start: bytes (payload, opcode 0x02 / 0x1a); chunks: list[bytes] (payloads, tag 0x03)
def plan_upload(program, index, count, package_size) -> UploadPlan   # == getDataResult(program, i, i2, i3)

# render.py
class Canvas(width=32, height=16): set/get/fill/line/rect/blit/text(...)/to_rgb444()/to_png(scale)
def quantize(rgb) -> rgb   # exactly the app's RGB444 mapping, so previews show what the LEDs can show
def text_frames(text, font, color, ...) -> list[Frame]
def image_to_frames(data: bytes, fit, dither, max_frames) -> list[Frame]    # PNG/JPEG/GIF
def generative(kind: str, seconds, seed, palette) -> list[Frame]           # life, fire, plasma, matrix, starfield, rainbow, sparkle
```

## Contract B — client & coordinator behaviour (Integration agent)
- One `asyncio.Lock` owns the GATT link; every request (and whole uploads) runs under it. No concurrent writes.
- Connect via `bluetooth.async_ble_device_from_address(connectable=True)` + `bleak_retry_connector.establish_connection`;
  start notify; authenticate (`check_password(stored or "000000")`); then read state.
- Request/response: write framed payload write-without-response in chunks of `min(client.mtu_size-3, 180)` with 15 ms spacing
  (app: SplitWriter 180/20, 15 ms); await the reply whose `response_key` matches; timeout 5 s; 3 retries for uploads per chunk
  (app: MAX_RETRY 3, 5000 ms).
- Link policy: connect on demand and hold the link for `idle_timeout` (option, default 60 s) after the last operation, then
  disconnect, so ESPHome proxy slots and the vendor phone app are not starved. Option "keep connected" (idle_timeout 0).
  Periodic refresh every 15 min (option) reads device info, night mode, alarms, timer switches, tomato, reminders,
  temp/humidity, countdown/stopwatch/scoreboard status. Time sync on first connect after HA start and daily at 03:30 local.
- Unavailable only after 3 consecutive failed refreshes; last good state is kept meanwhile.
- Silent ghost link (0.3.9): the clock only answers requests, so a proxy that kept a link its host forgot goes unnoticed. The
  client records the proxy carrying each link (`scanner.adapter`, persisted as entry data `last_holding_proxy`); at the top of
  every connect attempt, once no scanner has heard the clock for `GHOST_SILENCE_S` since the last link ended, it calls that
  proxy's `esphome.<slug>_force_disconnect_handle` for handles 0..3 until the clock is heard (retry 30 min, 2 h, then 6 h,
  counted from the end of a pass). Under the request lock, bounded per call, never after the shutdown latch.
- `iledclock.release_link` service disconnects now and reports honestly.
- Uploads: `plan_upload` for each program in the playlist with index i, count n; send start, await ProgramStartAck, send chunks
  awaiting ProgramChunkAck(index), retry per app semantics; progress is published on the dispatcher signal
  `iledclock_upload_progress_<entry_id>` as `{state, program, programs, chunk, chunks}` and via WS subscription.

## Contract C — entities (Integration agent). House rules: config-category entities are `EntityCategory.CONFIG` and
`entity_registry_enabled_default=False` (the card/panel is where settings live); control + primary sensors enabled.
- `light.<name>_display` — on/off (0x05), brightness (0x04, app range 5–100 ↔ HA 1–255), rgb_color (0x13 01), effects = colour modes (0x13 03 list with names).
- `text.<name>_message` — shows a text message immediately (drawn to pixel frames, default style).
- `image.<name>_display` — PNG preview (scaled, LED-look) of the program currently on the clock (from our own record).
- `sensor` temperature / humidity (only if device reports), firmware (diagnostic), program count (diagnostic: programs in screen A's last upload; per-screen attributes).
- `binary_sensor.<name>_connected` (diagnostic, connectivity).
- `button` sync_time (config), stopwatch/countdown start-stop are services + card, not buttons.
- `select` rotation (config, disabled), clock face (primary: uploads a clock program with the chosen style)
- `number` volume (config, disabled), colour speed (config, disabled).
- `switch` night mode (config, disabled) and each 0x1e device setting (config, disabled).

## Contract D — WebSocket API for the frontend (Integration implements, Frontend consumes). All require admin=False except
where noted; `entry_id` identifies the clock.
- `iledclock/state {entry_id}` → `{connected, busy, state: ClockState as JSON, playlist, capabilities, now_showing, history, slots, reminder_list}`.
  `slots` = `{a: SlotRecord|null, b: SlotRecord|null, last_written}` (what Home Assistant last sent to each power-button screen; the clock cannot report it);
  `reminder_list` = the Alarms & reminders list (managed items with status, clock-only reminders, slot use); `capabilities.slots.b_accepts` and
  `capabilities.reminders` carry the current values of the live-unverified flags in `hardware.py`. See docs/SLOTS-AND-REMINDERS.md.
- `iledclock/subscribe {entry_id}` → event stream of the same object on every change + upload progress events `{type:"upload", ...}`
- `iledclock/designs/list {entry_id?}` → `[{id, name, kind, frames:[{png_b64? no: rgb444 hex string of 32*16*3 nibbles}], delays:[ms], created, updated, tags}]`
  Canonical design JSON: `{id, name, kind: "image"|"animation", width:32, height:16, frames:[string hex 768 chars RGB888? ]}`
  → DECISION: frames travel as base64 of raw RGB888 (32*16*3 = 1536 bytes per frame); delays in ms per frame.
- `iledclock/designs/save {design}` (admin) → `{id}`; `iledclock/designs/delete {design_id}` (admin)
  A design also carries its playback: `speed` (`null` = Original, the authored delays untouched; `0` = Still; `1..100` = the Speed
  slider) and `smooth` (`null` = auto, `"on"`, `"off"`). A save that leaves these keys out keeps the stored values.
- `iledclock/designs/set_playback {design_id, speed?, smooth?}` (admin) → `{id, speed, smooth, updated}`; only the keys present change.
  Errors: `not_found`, `invalid_playback`.
- `iledclock/playback/preview {entry_id?, design_id? | frames, delays, clock_region?, speed?, smooth?}` → `{frames:[b64 rgb888], delays:[ms],
  playback}` the exact frames and delays the clock will play (same code as the upload; delays may be fractional: whole device units × 1.5 ms)
  plus `playback = {still, frames, authored_frames, added_frames, loop_ms, pace_fps, native_fps, original_speed, smooth:{state, available,
  enabled, slides, fades, sharp, capped}}`. With `design_id`, present `speed`/`smooth` keys override the stored values. Never touches the clock.
- `iledclock/render {entry_id, spec}` → `{frames:[b64 rgb888], delays:[ms]}` server-side rendering of: `{type:"text", text, font, color, effect, bold, speed, smooth}`
  (the SAME frames the text show uploads: one frame if it fits 32 columns, else a marquee of at most 40 frames),
  `{type:"image", url|data_b64, fit, dither}`, `{type:"generative", kind, seconds, seed}`, `{type:"clock", style, color, h24}`
  (clock = our best-effort preview of firmware face; mark `approximate: true`), `{type:"design", design_id}` (what the clock plays: the design's
  saved playback applied). `text`, `design`, `image` and `generative` take optional `speed` (0-100 playback speed, null/absent = Original) / `smooth`.
- `iledclock/show {entry_id, item, slot?}` (admin) → uploads immediately as a single-program override (`item` = design id or inline spec;
  a design item may carry `speed` / `smooth` overrides). `slot` = `"a"` (program list, default) or `"b"` (clock-page store); error `slot_unsupported`
  when that screen cannot take the content. A `date` show is always filed on screen B. `{restore:"previous"}` re-shows the previous item of the same screen.
- `iledclock/playlist/get|set {entry_id, playlist}` (admin): up to device max (9) items `{kind:"clock"|"date"|"text"|"design"|"timer"|"scoreboard"|"temperature"|"humidity", params, duration_s}`; `set` uploads.
- `iledclock/command {entry_id, command, params}` (admin): thin, validated passthrough to named commands (brightness, power, rotate, alarms_set, night_mode_set, timer_switch_set, tomato_set, countdown/stopwatch/scoreboard control, sync_time, `switch_screen`)
  plus the alarms & reminders commands `reminder_set`, `reminder_set_enabled`, `reminder_delete` (`{key}` or `{id}`), `reminder_resend`, which answer `{item}`.

## Contract E — frontend (Frontend agent)
- Lit 3 + TypeScript + esbuild, one ESM bundle `custom_components/iledclock/frontend/iledclock.js`, registered by the integration with
  `frontend.add_extra_js_url` (cards available with no manual resource) and as a sidebar panel `iledclock` ("Pixel Studio", icon `mdi:dots-grid`)
  using `panel_custom` with `module_url` pointing at the same bundle and element `iledclock-studio-panel`.
- Custom elements: `iledclock-card` (dashboard card, with editor `iledclock-card-editor`), `iledclock-studio-panel` (full editor).
- Panel chrome MUST follow HA: own app bar with a menu button firing `hass-toggle-menu` (bubbles+composed), shown only while `narrow`.
- Design language = the user's Kibble card (`/data/home/Homelabber/kibble-card`: read DESIGN.md, src/styles/tokens.ts, src/kibble-card.ts,
  components/kibble-segmented-picker.ts, kibble-hold-button.ts, screenshots/sigil-hero/*.png): the device is the hero (here: a glowing 32x16
  LED matrix mirror rendered on <canvas> with per-pixel round LEDs and bloom, RGB444-quantised so it shows what the LEDs can show),
  status in pill chips, large rounded segmented pills for modes, one action accent, HA theme variables for everything else,
  container queries (not viewport), prefers-reduced-motion honoured, touch-safe (hold-to-confirm for destructive/overwrite actions).
