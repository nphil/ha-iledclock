/** Minimal Home Assistant frontend types this project actually uses, plus the `iledclock/*`
 * WebSocket payload shapes (Contract D). Hand-rolled instead of depending on
 * `home-assistant-frontend`'s types, same rationale as the Kibble card set this project's
 * conventions from: that package pulls in a large, fast-moving type surface for the handful of
 * shapes actually read here.
 *
 * `ClockState`/`Capabilities`/`PlaylistItem` are this agent's proposal for Contract D's
 * unspecified JSON shape (sent to the Integration agent for confirmation); the frontend never
 * assumes more fields than it needs, and every optional field degrades quietly when absent so a
 * shape drift is a missing chip, not a crash.
 */

export interface HassEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface EntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  platform?: string;
  translation_key?: string | null;
  unique_id?: string;
  name?: string | null;
  original_name?: string | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
}

export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  identifiers?: Array<[string, string]>;
  config_entries?: string[];
}

/** The slice of HA's real `Connection` a card needs for a push subscription
 * (`iledclock/subscribe`). `subscribeMessage` resolves once the subscription is acknowledged and
 * calls `callback` on every subsequent push; its result unsubscribes. */
export interface HomeAssistantConnection {
  subscribeMessage: <T>(callback: (message: T) => void, message: Record<string, unknown>) => Promise<() => Promise<void>>;
}

export interface HomeAssistant {
  states: Record<string, HassEntityState>;
  entities: Record<string, EntityRegistryEntry>;
  devices: Record<string, DeviceRegistryEntry>;
  themes: { darkMode?: boolean; [key: string]: unknown };
  language: string;
  locale?: { language: string; [key: string]: unknown };
  /** Home Assistant's own settings. `time_zone` is the IANA zone the server runs in, which is also the zone the clock's alarms are programmed in (it can differ from the browser's). */
  config?: { time_zone?: string; [key: string]: unknown };
  callService: (domain: string, service: string, data?: Record<string, unknown>, target?: Record<string, unknown>) => Promise<unknown>;
  callWS?: <T = unknown>(msg: Record<string, unknown>) => Promise<T>;
  fetchWithAuth?: (input: string, init?: RequestInit) => Promise<Response>;
  connection?: HomeAssistantConnection;
  auth?: { data: { access_token: string } };
  hassUrl?: string;
}

export interface IledclockCardConfig {
  type: string;
  device_id?: string;
  name?: string;
}

export interface IledclockPanelConfig {
  device_id?: string;
  narrow?: boolean;
  panel?: boolean;
}

// ---- `iledclock/*` WebSocket payload shapes (Contract D) ----

export interface NightModeState {
  enabled: boolean;
  start_h: number;
  start_m: number;
  end_h: number;
  end_m: number;
  device_off: boolean;
  brightness: number;
  wake_minutes: number;
  voice: boolean;
  voice_sensitivity: number;
}

export interface CountdownState {
  hours: number;
  minutes: number;
  seconds: number;
  running: boolean;
}

export interface StopwatchState {
  hours: number;
  minutes: number;
  seconds: number;
  running: boolean;
}

export interface ScoreboardState {
  home: number;
  away: number;
  minutes: number;
  seconds: number;
  count_down: boolean;
  running: boolean;
}

export interface TomatoState {
  minutes: number[];
}

export interface TimerSwitchItem {
  index: number;
  hour: number;
  minute: number;
  on: boolean;
  enabled: boolean;
  repeat: RepeatDays;
}

export type RepeatDays = number; // bitmask, bit0 = Monday .. bit6 = Sunday; 0 = never, 0x7F = every day

export interface AlarmItem {
  id: number;
  hour: number;
  minute: number;
  enabled: boolean;
  repeat: RepeatDays;
}

/** A reminder exactly as the clock reports it (`state.reminders`, read-only, one per clock slot).
 * `year` is the full calendar year. `repeat_type` is the clock's own enum (0 once, 1 daily, 2 weekly,
 * 3 monthly, 4 yearly); `week_mask` is Mon = bit 0 .. Sun = bit 6. Pixel Studio's lists use
 * `ManagedReminder` / `ForeignReminder` from `reminder_list` instead. */
export interface ReminderItem {
  id: number;
  content: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  repeat_type: number;
  week_mask: number;
  duration: number;
  sound: number;
}

/** The clock's full readable state, as pushed by `iledclock/state` and `iledclock/subscribe`.
 * `brightness`/`volume` are the device's own native ranges (brightness 5-100), not HA's 1-255 --
 * the card converts at the edge, same as `light.*_display`'s own attribute. */
export interface ClockState {
  power: boolean;
  brightness: number;
  rotate: 0 | 1 | 2 | 3;
  mirror: boolean;
  volume: number;
  firmware: number;
  program_slots: number;
  color_mode?: number;
  color_speed?: number;
  night_mode: NightModeState | null;
  countdown: CountdownState | null;
  stopwatch: StopwatchState | null;
  scoreboard: ScoreboardState | null;
  tomato: TomatoState | null;
  temperature: number | null;
  humidity: number | null;
  timer_switches: TimerSwitchItem[];
  alarms: AlarmItem[];
  reminders: ReminderItem[];
}

export interface Capabilities {
  max_playlist_items: number;
  clock_styles: number;
  text_color_modes: number;
  max_alarms: number;
  max_timer_switches: number;
  max_reminders: number;
  has_temperature: boolean;
  has_humidity: boolean;
  slots?: SlotCapabilities;
  reminders?: ReminderCapabilities;
}

// ---- Screens A / B (docs/SLOTS-AND-REMINDERS.md) ----

/** The clock's power button toggles between two screens. A = the program list, B = the clock-page store. */
export type SlotId = "a" | "b";

/** What a show is, for deciding whether screen B takes it. "art" = pictures, animations, text, generated
 * effects and designs without a clock; "art_clock" = a design with a firmware clock beside it. */
export type ContentClass = "clock" | "date" | "temperature" | "humidity" | "art" | "art_clock" | "timer" | "scoreboard";

export interface SlotCapabilities {
  ids: SlotId[];
  /** Content classes screen B takes right now (the server's live-unverified capability flags decide). */
  b_accepts: ContentClass[];
}

/** What Home Assistant last sent to one screen. The clock cannot report its screens, so this is a record. */
export interface SlotRecord {
  title: string;
  /** Same shape as `now_showing`: renderable through `iledclock/render` (`showItemFromDescriptor`). */
  descriptor: Record<string, unknown> & { kind: string } | null;
  /** Start-frame kind byte: 0 = program list (screen A), 4 = clock-page store (screen B). */
  wire_kind: number;
  /** Programs in that upload (screen A may hold a whole rotation, screen B holds one page). */
  programs: number;
  /** ISO-8601 UTC. */
  written_at: string;
}

export interface SlotsState {
  a: SlotRecord | null;
  b: SlotRecord | null;
  /** Screen written most recently (writing a screen also shows it); null before the first write. */
  last_written: SlotId | null;
}

// ---- Alarms & reminders (docs/SLOTS-AND-REMINDERS.md) ----

export type ReminderKind = "alarm" | "reminder";
export type ReminderRepeat = "once" | "daily" | "weekdays" | "weekends" | "custom" | "weekly" | "monthly" | "yearly";

/** What rings and shows: a Library design (still, or an animation of at most `max_frames` frames) or the
 * name drawn as scrolling text. */
export type ReminderAttachment = { kind: "design"; design_id: string } | { kind: "text"; color?: readonly [number, number, number] };

/** synced: on the clock and matching; disabled: switched off (not on the clock); pending: enabled but never
 * sent; missing: should be on the clock but is not ("Re-send"); changed: on the clock but different (edited
 * with the vendor app); error: the last send failed (`last_error`); done: a one-time item whose time has passed. */
export type ReminderStatus = "synced" | "disabled" | "pending" | "missing" | "changed" | "error" | "done";

/** One item of the Alarms & reminders list, managed by Home Assistant (name, art and schedule live in HA;
 * the clock only holds the compiled reminder, which is why it rings without Home Assistant). */
export interface ManagedReminder {
  key: string;
  name: string;
  kind: ReminderKind;
  hour: number;
  minute: number;
  /** ISO "YYYY-MM-DD": the date for once / monthly (day of month) / yearly (month and day); null otherwise. */
  date: string | null;
  repeat: ReminderRepeat;
  /** Weekdays, Mon = 0 .. Sun = 6: the picked days for custom, the one day for weekly; [] otherwise. */
  days: number[];
  duration_s: number;
  attachment: ReminderAttachment;
  enabled: boolean;
  status: ReminderStatus;
  /** Clock slots this item occupies while enabled (a Monday-Friday item uses 5 unless the clock takes a week mask). */
  slots: number;
  /** Clock reminder ids it currently holds. */
  device_ids: number[];
  last_error: string | null;
  /** Epoch seconds of the last edit. */
  updated: number;
}

/** A reminder on the clock that Home Assistant did not create (made in the vendor app): read-only, deletable. */
export type ForeignReminder = ReminderItem;

export interface ReminderList {
  /** Clock slots in total / in use (managed and foreign) / free, as last read from the clock. */
  capacity: number;
  used: number;
  free: number;
  items: ManagedReminder[];
  foreign: ForeignReminder[];
  /** Epoch seconds of the last read of the clock's list; null = never read (clock not reached yet). */
  synced_at: number | null;
}

export interface ReminderCapabilities {
  capacity: number;
  id_min: number;
  id_max: number;
  /** The clock takes several weekdays in one reminder (live-unverified; false = one slot per weekday). */
  week_mask: boolean;
  name_max: number;
  durations: number[];
  repeats: ReminderRepeat[];
  max_frames: number;
}

/** What the editor sends for `reminder_set` (`key` present = edit that item). */
export interface ReminderInput {
  key?: string;
  name: string;
  kind: ReminderKind;
  hour: number;
  minute: number;
  date?: string | null;
  repeat: ReminderRepeat;
  days?: number[];
  duration_s: number;
  attachment: ReminderAttachment;
  enabled: boolean;
}

export type PlaylistItemKind = "clock" | "date" | "text" | "design" | "timer" | "scoreboard" | "temperature" | "humidity";

export interface PlaylistItem {
  kind: PlaylistItemKind;
  params: Record<string, unknown>;
  duration_s: number;
}

/** `iledclock/state`'s response and every `iledclock/subscribe` state push. */
export interface ClockStateEnvelope {
  connected: boolean;
  busy: boolean;
  state: ClockState;
  playlist: PlaylistItem[];
  capabilities: Capabilities;
  slots?: SlotsState;
  /** The Alarms & reminders list; null until the clock has been read once. */
  reminder_list?: ReminderList | null;
}

/** The other shape `iledclock/subscribe` can push: upload progress for a playlist send. */
export interface UploadProgressEvent {
  type: "upload";
  state: "start" | "chunk" | "done" | "error";
  program: number;
  programs: number;
  chunk: number;
  chunks: number;
  error?: string;
}

export type SubscribeEvent = ({ type?: undefined } & ClockStateEnvelope) | UploadProgressEvent;

/** One design library entry, as listed by `iledclock/designs/list`. `frames`/`delays` are
 * parallel arrays: `frames[i]` is base64 of `width*height*3` raw RGB888 bytes (1536 for 32x16),
 * `delays[i]` its hold time in ms. `kind: "image"` designs always carry exactly one frame. */
export interface StoredDesign {
  id: string;
  name: string;
  kind: "image" | "animation";
  width: number;
  height: number;
  frames: string[];
  delays: number[];
  created: number;
  updated: number;
  tags?: string[];
  clock_region?: { x: number; y: number; w: number; h: number } | null;
  /** Playback speed: null = Original (the authored delays untouched), 0 = Still, 1..100 = slider position. */
  speed?: number | null;
  /** Smooth motion: null = auto (behaves like "on"), "off" = never add in-between frames. */
  smooth?: SmoothSetting;
}

/** Smooth motion setting as stored and sent: "on", "off", or null for auto (acts like "on"). */
export type SmoothSetting = "on" | "off" | null;

/** What the server did to an animation's pacing for one speed/smooth setting
 * (`iledclock/playback/preview` result, and `render` results for the effective frames). */
export interface PlaybackInfo {
  /** True when speed is 0: one poster frame. */
  still: boolean;
  /** Frames in this result (authored + added). */
  frames: number;
  authored_frames: number;
  /** In-between frames smoothing added. */
  added_frames: number;
  /** Length of one loop on the clock, in ms. */
  loop_ms: number;
  /** Authored frames per second achieved at this setting. */
  pace_fps: number;
  /** Authored frames per second as drawn (the Original pace). */
  native_fps: number;
  /** Slider position (0..100) where the Original pace sits, clamped to 1..100. */
  original_speed: number;
  smooth: {
    /** unavailable: nothing slides or fades; off: available but switched off; idle: on, but speed is
     * Original or faster so nothing is added; applied: in-between frames were added; none: on and
     * slowed, but nothing needed adding. */
    state: "unavailable" | "off" | "idle" | "applied" | "none";
    /** Some step slides or fades, so smoothing could apply when slowed. */
    available: boolean;
    /** The smooth setting is not "off". */
    enabled: boolean;
    slides: number;
    fades: number;
    /** Hard cuts (blinks, sprite swaps). */
    sharp: number;
    /** In-between frames were limited to keep the animation within 40 frames. */
    capped: boolean;
  };
}

export type RenderSpec =
  | { type: "text"; text: string; font?: string; color: readonly [number, number, number]; effect?: string; bold?: boolean; speed?: number | null; smooth?: SmoothSetting }
  | { type: "image"; url?: string; data_b64?: string; fit?: "contain" | "cover" | "stretch"; dither?: boolean; frames?: string[]; delays?: number[]; speed?: number | null; smooth?: SmoothSetting }
  | { type: "generative"; kind: string; seconds: number; seed?: number; speed?: number | null; smooth?: SmoothSetting }
  | { type: "clock"; style: number; color: readonly [number, number, number]; h24: boolean; background?: boolean }
  /** A saved design as the panel shows it: art plus, for "Icon with clock" designs, the live clock
   * the firmware draws in its clock region. */
  | { type: "design"; design_id: string; speed?: number | null; smooth?: SmoothSetting };

export interface RenderResult {
  frames: string[];
  delays: number[];
  approximate?: boolean;
  /** Present when the server applied speed/smooth to these (effective) frames. */
  playback?: PlaybackInfo;
}

/** `iledclock/playback/preview` result: the exact frames the clock will play (delays in ms, possibly fractional). */
export interface PlaybackPreviewResult {
  frames: string[];
  delays: number[];
  playback: PlaybackInfo;
}

/** `iledclock/show`'s `item`: either a design id (optionally with a one-off speed/smooth override)
 * or an inline render spec, uploaded immediately as a single-program playlist override. */
export type ShowItem = { design_id: string; speed?: number | null; smooth?: SmoothSetting } | { spec: RenderSpec } | { restore: "previous" };
