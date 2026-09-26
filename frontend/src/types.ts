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

export interface ReminderItem {
  id: number;
  content: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  repeat: RepeatDays;
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
}

export type RenderSpec =
  | { type: "text"; text: string; font?: string; color: readonly [number, number, number]; effect?: string; speed?: number }
  | { type: "image"; url?: string; data_b64?: string; fit?: "contain" | "cover" | "stretch"; dither?: boolean }
  | { type: "generative"; kind: string; seconds: number; seed?: number }
  | { type: "clock"; style: number; color: readonly [number, number, number]; h24: boolean };

export interface RenderResult {
  frames: string[];
  delays: number[];
  approximate?: boolean;
}

/** `iledclock/show`'s `item`: either a design id or an inline render spec, uploaded immediately
 * as a single-program playlist override. */
export type ShowItem = { design_id: string } | { spec: RenderSpec };
