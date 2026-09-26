/** Fixture data for the dev harness: one populated `Plant Room Clock` device with a full entity
 * registry (every role `resolve-entities.ts`'s `RULES` looks for, plus two generic settings
 * switches that fall into `settingSwitches`), a rich `ClockState` exercising every optional
 * field (temperature/humidity, night mode, alarms, timer switches with `repeat`, reminders, a
 * running countdown/stopwatch/scoreboard), a 5-design library (mixed `image`/`animation`, real
 * pixel data via `grid.ts`/`rasterize.ts` -- a filled circle, diagonal stripes, a smiley, a
 * pulsing dot, and a scrolling-stripe marquee), and a 4-item playlist. Entity ids and
 * `translation_key`s follow `resolve-entities.ts`'s `RULES` table exactly so
 * `resolveIledclockEntities`/`resolveEntryId` resolve a full `IledclockEntities` set against
 * this fixture exactly like a live registry.
 */

import type {
  AlarmItem,
  Capabilities,
  ClockState,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HassEntityState,
  PlaylistItem,
  ReminderItem,
  StoredDesign,
  TimerSwitchItem,
} from "../src/types.ts";
import { type RGB, rgbToHex } from "../src/lib/color.ts";
import { cloneFrame, createFrame, getPixel, GRID_HEIGHT, GRID_WIDTH, type PixelFrame, setPixelMut, shiftFrame } from "../src/lib/grid.ts";
import { plotEllipse, plotRect } from "../src/lib/rasterize.ts";
import { framesToDesign } from "../src/lib/design-codec.ts";
import { CLOCK_FACES } from "../src/lib/clock-faces.ts";

export const DEVICE_ID = "iledclock-device-1";
export const ENTRY_ID = "iledclock-entry-1";
const SLUG = "plant_room_clock";

// ---- registry plumbing ----

function entry(objectId: string, domain: string, translationKey: string, name?: string): EntityRegistryEntry {
  const entityId = `${domain}.${SLUG}_${objectId}`;
  return { entity_id: entityId, device_id: DEVICE_ID, platform: "iledclock", translation_key: translationKey, name: name ?? null, original_name: name ?? null, disabled_by: null, hidden_by: null };
}

function state(entityId: string, value: string, attributes: Record<string, unknown> = {}): HassEntityState {
  const now = new Date().toISOString();
  return { entity_id: entityId, state: value, attributes, last_changed: now, last_updated: now };
}

export const DEVICE: DeviceRegistryEntry = {
  id: DEVICE_ID,
  name: "Plant Room Clock",
  name_by_user: null,
  model: "iLedClock",
  manufacturer: "iLedClock",
  identifiers: [["iledclock", "01:00:00:67:0D:8A"]],
  config_entries: [ENTRY_ID],
};

const ROTATION_OPTIONS = ["0", "90", "180", "270"] as const;
const CLOCK_FACE_OPTIONS = CLOCK_FACES.map((f) => f.label);

export const ENTITY_REGISTRY: Record<string, EntityRegistryEntry> = Object.fromEntries(
  [
    entry("display", "light", "display"),
    entry("message", "text", "message"),
    entry("display", "image", "display"),
    entry("temperature", "sensor", "temperature"),
    entry("humidity", "sensor", "humidity"),
    entry("firmware", "sensor", "firmware"),
    entry("program_count", "sensor", "program_count"),
    entry("connected", "binary_sensor", "connected"),
    entry("sync_time", "button", "sync_time"),
    entry("rotation", "select", "rotation"),
    entry("clock_face", "select", "clock_face"),
    entry("volume", "number", "volume"),
    entry("color_speed", "number", "color_speed"),
    entry("night_mode", "switch", "night_mode"),
    entry("remote_enable", "switch", "remote_enable", "Remote enable"),
    entry("show_device_id", "switch", "show_device_id", "Show device ID"),
  ].map((registryEntry) => [registryEntry.entity_id, registryEntry]),
);

// ---- ClockState (rich: every optional field populated with plausible, non-zero data) ----

export const NIGHT_MODE_ENABLED_BRIGHTNESS = 15;

export const ALARMS: AlarmItem[] = [
  { id: 1, hour: 6, minute: 45, enabled: true, repeat: 0b0011111 }, // weekdays
  { id: 2, hour: 9, minute: 0, enabled: false, repeat: 0 }, // weekend lie-in, currently off
];

export const TIMER_SWITCHES: TimerSwitchItem[] = [
  { index: 0, hour: 7, minute: 0, on: true, enabled: true, repeat: 0b0011111 }, // weekday morning on
  { index: 1, hour: 22, minute: 30, on: false, enabled: true, repeat: 0x7f }, // nightly off, every day
];

export const REMINDERS: ReminderItem[] = [
  { id: 1, content: "Water the plants", year: 2026, month: 9, day: 26, hour: 9, minute: 0, repeat: 0x7f },
  { id: 2, content: "Vet appointment", year: 2026, month: 10, day: 3, hour: 14, minute: 30, repeat: 0 },
];

export function buildClockState(): ClockState {
  return {
    power: true,
    brightness: 70,
    rotate: 0,
    mirror: false,
    volume: 60,
    firmware: 114,
    program_slots: 16,
    color_mode: 3,
    color_speed: 6,
    night_mode: {
      enabled: true,
      start_h: 22,
      start_m: 30,
      end_h: 6,
      end_m: 30,
      device_off: false,
      brightness: NIGHT_MODE_ENABLED_BRIGHTNESS,
      wake_minutes: 15,
      voice: true,
      voice_sensitivity: 3,
    },
    countdown: { hours: 0, minutes: 4, seconds: 30, running: true },
    stopwatch: { hours: 0, minutes: 12, seconds: 47, running: false },
    scoreboard: { home: 3, away: 2, minutes: 8, seconds: 15, count_down: true, running: true },
    tomato: { minutes: [25, 5, 15] },
    temperature: 24.5,
    humidity: 48,
    timer_switches: TIMER_SWITCHES.map((t) => ({ ...t })),
    alarms: ALARMS.map((a) => ({ ...a })),
    reminders: REMINDERS.map((r) => ({ ...r })),
  };
}

export const CAPABILITIES: Capabilities = {
  max_playlist_items: 20,
  clock_styles: CLOCK_FACES.length,
  text_color_modes: 8,
  max_alarms: 8,
  max_timer_switches: 8,
  max_reminders: 8,
  has_temperature: true,
  has_humidity: true,
};

// ---- pixel design fixtures: real, recognisable shapes via grid.ts/rasterize.ts ----

const CIRCLE_COLOR: RGB = [255, 140, 0];
const STRIPE_A: RGB = [0, 200, 220];
const STRIPE_B: RGB = [10, 10, 30];
const SMILEY_FACE: RGB = [255, 210, 0];
const SMILEY_INK: RGB = [30, 20, 0];
const PULSE_COLOR: RGB = [0, 230, 255];

function buildStripesFrame(): PixelFrame {
  const frame = cloneFrame(createFrame(GRID_WIDTH, GRID_HEIGHT));
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      setPixelMut(frame, x, y, (x + y) % 4 < 2 ? STRIPE_A : STRIPE_B);
    }
  }
  return frame;
}

function buildSmileyFrame(): PixelFrame {
  let frame = plotEllipse(createFrame(GRID_WIDTH, GRID_HEIGHT), 8, 1, 23, 14, SMILEY_FACE, true);
  frame = plotRect(frame, 12, 5, 13, 6, SMILEY_INK, true);
  frame = plotRect(frame, 18, 5, 19, 6, SMILEY_INK, true);
  const mouth = cloneFrame(frame);
  const midX = 15.5;
  const halfWidth = 3.5;
  for (let x = 12; x <= 19; x++) {
    const t = (x - midX) / halfWidth;
    const y = Math.round(9 + 2 * (1 - t * t));
    setPixelMut(mouth, x, y, SMILEY_INK);
  }
  return mouth;
}

function buildPulseFrames(): PixelFrame[] {
  const radii = [1, 3, 5, 3, 1];
  const durations = [120, 140, 160, 140, 120];
  return radii.map((r, i) => {
    const frame = plotEllipse(createFrame(GRID_WIDTH, GRID_HEIGHT), 15 - r, 7 - r, 15 + r, 7 + r, PULSE_COLOR, true);
    return { ...frame, durationMs: durations[i]! };
  });
}

function buildMarqueeFrames(): PixelFrame[] {
  const base = buildStripesFrame();
  const frames: PixelFrame[] = [{ ...base, durationMs: 120 }];
  let current = base;
  for (let i = 1; i < 4; i++) {
    current = shiftFrame(current, 2, 0, true);
    frames.push({ ...current, durationMs: 120 });
  }
  return frames;
}

const NOW_S = Math.floor(Date.now() / 1000);
const DAY_S = 86400;

export const DESIGNS: StoredDesign[] = [
  framesToDesign([plotEllipse(createFrame(GRID_WIDTH, GRID_HEIGHT, [6, 6, 16]), 10, 2, 21, 13, CIRCLE_COLOR, true)], { id: "design-circle", name: "Sunset dot", kind: "image", created: NOW_S - 20 * DAY_S, updated: NOW_S - 20 * DAY_S, tags: ["shape"] }),
  framesToDesign([buildStripesFrame()], { id: "design-stripes", name: "Cyan stripes", kind: "image", created: NOW_S - 15 * DAY_S, updated: NOW_S - 15 * DAY_S, tags: ["pattern"] }),
  framesToDesign([buildSmileyFrame()], { id: "design-smiley", name: "Smiley", kind: "image", created: NOW_S - 10 * DAY_S, updated: NOW_S - 2 * DAY_S, tags: ["face"] }),
  framesToDesign(buildPulseFrames(), { id: "design-pulse", name: "Pulsing dot", kind: "animation", created: NOW_S - 8 * DAY_S, updated: NOW_S - 8 * DAY_S, tags: ["animation"] }),
  framesToDesign(buildMarqueeFrames(), { id: "design-marquee", name: "Scrolling stripes", kind: "animation", created: NOW_S - 3 * DAY_S, updated: NOW_S - 1 * DAY_S, tags: ["animation", "pattern"] }),
];

export const PLAYLIST: PlaylistItem[] = [
  { kind: "clock", params: { style: 12, color: [0, 220, 255], h24: true }, duration_s: 30 },
  { kind: "design", params: { design_id: "design-smiley" }, duration_s: 15 },
  { kind: "text", params: { text: "Good morning!", color: [255, 220, 0], effect: 2, speed: 40 }, duration_s: 20 },
  { kind: "temperature", params: {}, duration_s: 10 },
];

// ---- states, built to agree with the ClockState/entity fixtures above ----

export function buildStates(clockState: ClockState, designCount: number): Record<string, HassEntityState> {
  const displayId = `light.${SLUG}_display`;
  const brightness255 = Math.round((clockState.brightness / 100) * 255);
  return Object.fromEntries(
    [
      state(displayId, clockState.power ? "on" : "off", {
        brightness: brightness255,
        rgb_color: [0, 220, 255],
        effect_list: ["Solid", "Rainbow", "Fade"],
        effect: "Solid",
        supported_color_modes: ["rgb"],
      }),
      state(`text.${SLUG}_message`, "Good morning!"),
      state(`image.${SLUG}_display`, new Date().toISOString(), { entity_picture: frameToDataUri(buildSmileyFrame()) }),
      state(`sensor.${SLUG}_temperature`, String(clockState.temperature), { unit_of_measurement: "°C", device_class: "temperature", state_class: "measurement" }),
      state(`sensor.${SLUG}_humidity`, String(clockState.humidity), { unit_of_measurement: "%", device_class: "humidity", state_class: "measurement" }),
      state(`sensor.${SLUG}_firmware`, "1.14"),
      state(`sensor.${SLUG}_program_count`, String(designCount)),
      state(`binary_sensor.${SLUG}_connected`, "on", { device_class: "connectivity" }),
      state(`button.${SLUG}_sync_time`, new Date(Date.now() - 3600_000).toISOString(), { device_class: "restart" }),
      state(`select.${SLUG}_rotation`, String(clockState.rotate * 90), { options: ROTATION_OPTIONS }),
      state(`select.${SLUG}_clock_face`, CLOCK_FACE_OPTIONS[11]!, { options: CLOCK_FACE_OPTIONS }),
      state(`number.${SLUG}_volume`, String(clockState.volume), { min: 0, max: 100, step: 1, mode: "slider" }),
      state(`number.${SLUG}_color_speed`, String(clockState.color_speed ?? 0), { min: 0, max: 15, step: 1, mode: "slider" }),
      state(`switch.${SLUG}_night_mode`, clockState.night_mode?.enabled ? "on" : "off"),
      state(`switch.${SLUG}_remote_enable`, "on"),
      state(`switch.${SLUG}_show_device_id`, "off"),
    ].map((entityState) => [entityState.entity_id, entityState]),
  );
}

/** Renders a `PixelFrame` as an inline SVG data URI -- a genuine per-pixel preview of the design
 * (not a blank/generic placeholder), cheap enough to build at fixture time since it only runs
 * once per still image, not per animation tick. Off (black) pixels are skipped in favour of one
 * background rect, keeping the URI a fraction of the size a rect-per-pixel encoding would need. */
export function frameToDataUri(frame: PixelFrame): string {
  const rects: string[] = [];
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const rgb = getPixel(frame, x, y);
      if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) continue;
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${rgbToHex(rgb)}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frame.width} ${frame.height}" shape-rendering="crispEdges"><rect width="${frame.width}" height="${frame.height}" fill="#000000"/>${rects.join("")}</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
