/** A minimal but honest `hass` stand-in for the iLedClock frontend: real `states`/`entities`/
 * `devices` maps built from the fixtures, a `callService` that mutates state for the native HA
 * entities (light/text/select/number/switch/button) a card interaction would actually touch, and
 * a `callWS` that answers every `iledclock/*` Contract D command against one in-memory clock/
 * design-library/playlist store, so clicking through a real card and panel in a browser exercises
 * the whole flow end to end instead of a single static render.
 *
 * `iledclock/subscribe` goes through `hass.connection.subscribeMessage` (the real integration's
 * push-subscription mechanism), not `callWS`: subscribing immediately gets one push of the
 * current envelope (matching a real subscribe ack that includes current state), and every later
 * mutating command (`playlist/set`, `command`, `show`) pushes a fresh envelope to every open
 * subscription -- so a card and a panel mounted side by side in the same harness page both see
 * each other's changes live, exactly like two real HA frontend tabs.
 *
 * Two response envelopes are this mock's own inferred convention (Contract D's WS reply shapes
 * for list-y commands aren't pinned by any file in this repo yet): `iledclock/designs/list`
 * replies `{ designs }`, `iledclock/playlist/get` replies `{ playlist }` -- named the same as the
 * request payload's own field for symmetry with `iledclock/playlist/set`'s request shape.
 */

import type { AlarmItem, ClockStateEnvelope, HomeAssistant, NightModeState, PlaylistItem, ReminderItem, RenderResult, RenderSpec, StoredDesign, TimerSwitchItem } from "../src/types.ts";
import { percentToBrightness } from "../src/lib/brightness.ts";
import { quantizePreviewRgb, quantizePreviewRgbLinear, type RGB } from "../src/lib/color.ts";
import { createFrame, GRID_HEIGHT, GRID_WIDTH, setPixelMut, type PixelFrame } from "../src/lib/grid.ts";
import { plotEllipse, plotRect } from "../src/lib/rasterize.ts";
import { frameToBase64 } from "../src/lib/design-codec.ts";
import { normalizePlaylist } from "../src/lib/ws-api.ts";
import { findGalleryItem, galleryPreview, GALLERY_SOURCES, gallerySearch, importFilePreview } from "./gallery-fixtures.ts";
import { ALARMS, buildClockState, buildStates, CAPABILITIES, DESIGNS, DEVICE, ENTITY_REGISTRY, ENTRY_ID, PLAYLIST, REMINDERS, TIMER_SWITCHES } from "./fixtures.ts";

export { DEVICE_ID, ENTRY_ID } from "./fixtures.ts";

type WsError = { code: string; message: string };

function wsError(code: string, message: string): WsError {
  return { code, message };
}

/** Renders text as blocky per-character rectangles -- honest about not doing real font
 * rasterisation (see the shared task context), but a genuinely non-blank frame of the right
 * byte length whose block count and colour match what was actually requested. Characters past
 * the 32-pixel-wide grid are clipped, not wrapped, matching how a real single-line render would
 * clip an over-long string. */
function renderTextFrame(text: string, color: RGB): PixelFrame {
  const frame = createFrame(GRID_WIDTH, GRID_HEIGHT, [0, 0, 0]);
  const rgb = quantizePreviewRgb(color);
  let cursor = 1;
  for (const ch of text) {
    if (cursor + 2 >= GRID_WIDTH) break;
    if (ch !== " ") {
      for (let y = 5; y <= 10; y++) {
        for (let x = cursor; x <= cursor + 2; x++) setPixelMut(frame, x, y, rgb);
      }
    }
    cursor += 4;
  }
  return frame;
}

/** A static ring in the requested colour -- stands in for "a real clock face preview" (the
 * device's own firmware renders the actual digits/ring style; the harness has no equivalent
 * renderer to call), same "well-formed, non-blank, right byte length" bar as the text mock.
 * Native `clock` content quantises through the LINEAR path (`hardware.py`'s `LINEAR_PATHS`),
 * not the CURVED path `plotEllipse` defaults to -- pass `quantizePreviewRgbLinear` explicitly
 * so this preview matches what the real device would show for a clock-face colour. */
function renderClockFrame(color: RGB): PixelFrame {
  return plotEllipse(createFrame(GRID_WIDTH, GRID_HEIGHT, [0, 0, 0]), 6, 1, 25, 14, color, false, quantizePreviewRgbLinear);
}

/** A slowly hue-rotating diagonal band -- stands in for one of the device's generative programs
 * (fire/rain/plasma/etc.), `seconds` only controlling how many frames of motion come back. */
function renderGenerativeFrames(seconds: number): { frames: PixelFrame[]; delays: number[] } {
  const frameCount = Math.max(2, Math.min(20, Math.round(seconds * 2)));
  const frames: PixelFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const hueStep = i / frameCount;
    const rgb: RGB = [Math.round(127 + 127 * Math.sin(2 * Math.PI * hueStep)), Math.round(127 + 127 * Math.sin(2 * Math.PI * hueStep + 2.09)), Math.round(127 + 127 * Math.sin(2 * Math.PI * hueStep + 4.19))];
    const frame = createFrame(GRID_WIDTH, GRID_HEIGHT, [0, 0, 0]);
    const quantized = quantizePreviewRgb(rgb);
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        if ((x + y + i * 2) % 6 < 3) setPixelMut(frame, x, y, quantized);
      }
    }
    frames.push(frame);
  }
  return { frames, delays: frames.map(() => 100) };
}

/** No real image decoder in the harness -- a checkerboard placeholder in two shades stands in
 * for "an imported photo, dithered/fit to the grid", well-formed and non-blank either way. */
function renderImagePlaceholderFrame(): PixelFrame {
  return plotRect(createFrame(GRID_WIDTH, GRID_HEIGHT, [40, 40, 40]), 4, 3, 27, 12, [180, 180, 190], true);
}

function renderSpec(spec: RenderSpec): RenderResult {
  if (spec.type === "text") {
    const frame = renderTextFrame(spec.text, spec.color);
    return { frames: [frameToBase64(frame)], delays: [Math.max(20, Math.round(1000 / Math.max(1, spec.speed ?? 10)))], approximate: true };
  }
  if (spec.type === "clock") {
    const frame = renderClockFrame(spec.color);
    return { frames: [frameToBase64(frame)], delays: [1000], approximate: true };
  }
  if (spec.type === "generative") {
    const { frames, delays } = renderGenerativeFrames(spec.seconds);
    return { frames: frames.map(frameToBase64), delays, approximate: true };
  }
  const frame = renderImagePlaceholderFrame();
  return { frames: [frameToBase64(frame)], delays: [100], approximate: true };
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}


export function createMockHass(onChange?: () => void): HomeAssistant {
  const states = buildStates(buildClockState(), DESIGNS.length);
  const clockState = buildClockState();
  const designs: StoredDesign[] = DESIGNS.map((d) => ({ ...d, frames: [...d.frames], delays: [...d.delays] }));
  let playlist: PlaylistItem[] = PLAYLIST.map((item) => ({ ...item, params: { ...item.params } }));
  const subscribers = new Set<(message: ClockStateEnvelope) => void>();
  let designSaveCounter = 0;

  function envelope(): ClockStateEnvelope {
    return { connected: true, busy: false, state: jsonClone(clockState), playlist: jsonClone(playlist), capabilities: CAPABILITIES };
  }

  function pushState(): void {
    const message = envelope();
    for (const callback of subscribers) callback(message);
  }

  function notify(): void {
    hass.states = { ...states };
    onChange?.();
  }

  function requireEntry(entryId: unknown): void {
    if (entryId !== ENTRY_ID) throw wsError("not_found", `Unknown config entry ${String(entryId)}`);
  }

  function syncDisplayLight(): void {
    const id = `light.plant_room_clock_display`;
    const existing = states[id];
    if (!existing) return;
    states[id] = {
      ...existing,
      state: clockState.power ? "on" : "off",
      attributes: { ...existing.attributes, brightness: percentToBrightness(clockState.brightness) },
    };
  }

  function applyCommand(command: string, params: Record<string, unknown>): void {
    switch (command) {
      case "power": {
        clockState.power = Boolean(params.on);
        syncDisplayLight();
        break;
      }
      case "brightness": {
        clockState.brightness = Math.max(5, Math.min(100, Math.round(Number(params.value))));
        syncDisplayLight();
        break;
      }
      case "rotate": {
        const value = Math.max(0, Math.min(3, Math.round(Number(params.value)))) as 0 | 1 | 2 | 3;
        clockState.rotate = value;
        states[`select.plant_room_clock_rotation`] = { ...states[`select.plant_room_clock_rotation`]!, state: String(value * 90) };
        break;
      }
      case "mirror": {
        clockState.mirror = Boolean(params.enabled);
        break;
      }
      case "volume": {
        clockState.volume = Math.max(0, Math.min(100, Math.round(Number(params.value))));
        states[`number.plant_room_clock_volume`] = { ...states[`number.plant_room_clock_volume`]!, state: String(clockState.volume) };
        break;
      }
      case "color_speed": {
        clockState.color_speed = Math.max(0, Math.min(15, Math.round(Number(params.value))));
        states[`number.plant_room_clock_color_speed`] = { ...states[`number.plant_room_clock_color_speed`]!, state: String(clockState.color_speed) };
        break;
      }
      case "alarms_set": {
        clockState.alarms = (Array.isArray(params.alarms) ? (params.alarms as AlarmItem[]) : ALARMS).slice(0, CAPABILITIES.max_alarms);
        break;
      }
      case "timer_switch_set": {
        clockState.timer_switches = (Array.isArray(params.timer_switches) ? (params.timer_switches as TimerSwitchItem[]) : TIMER_SWITCHES).slice(0, CAPABILITIES.max_timer_switches);
        break;
      }
      case "reminders": {
        clockState.reminders = (Array.isArray(params.reminders) ? (params.reminders as ReminderItem[]) : REMINDERS).slice(0, CAPABILITIES.max_reminders);
        break;
      }
      case "night_mode_set": {
        clockState.night_mode = (params.night_mode as NightModeState | null) ?? null;
        states[`switch.plant_room_clock_night_mode`] = { ...states[`switch.plant_room_clock_night_mode`]!, state: clockState.night_mode?.enabled ? "on" : "off" };
        break;
      }
      case "tomato_set": {
        clockState.tomato = { minutes: Array.isArray(params.minutes) ? (params.minutes as number[]) : [] };
        break;
      }
      case "countdown_set": {
        clockState.countdown = { hours: Number(params.hours) || 0, minutes: Number(params.minutes) || 0, seconds: Number(params.seconds) || 0, running: false };
        break;
      }
      case "countdown_start": {
        if (clockState.countdown) clockState.countdown = { ...clockState.countdown, running: true };
        break;
      }
      case "countdown_stop": {
        if (clockState.countdown) clockState.countdown = { ...clockState.countdown, running: false };
        break;
      }
      case "countdown_reset": {
        clockState.countdown = { hours: 0, minutes: 0, seconds: 0, running: false };
        break;
      }
      case "stopwatch_start": {
        if (clockState.stopwatch) clockState.stopwatch = { ...clockState.stopwatch, running: true };
        break;
      }
      case "stopwatch_stop": {
        if (clockState.stopwatch) clockState.stopwatch = { ...clockState.stopwatch, running: false };
        break;
      }
      case "stopwatch_reset": {
        clockState.stopwatch = { hours: 0, minutes: 0, seconds: 0, running: false };
        break;
      }
      case "scoreboard_set": {
        clockState.scoreboard = {
          home: Number(params.home) || 0,
          away: Number(params.away) || 0,
          minutes: Number(params.minutes) || 0,
          seconds: Number(params.seconds) || 0,
          count_down: Boolean(params.count_down),
          running: clockState.scoreboard?.running ?? false,
        };
        break;
      }
      case "scoreboard_start": {
        if (clockState.scoreboard) clockState.scoreboard = { ...clockState.scoreboard, running: true };
        break;
      }
      case "scoreboard_stop": {
        if (clockState.scoreboard) clockState.scoreboard = { ...clockState.scoreboard, running: false };
        break;
      }
      case "sync_time": {
        states[`button.plant_room_clock_sync_time`] = { ...states[`button.plant_room_clock_sync_time`]!, state: new Date().toISOString() };
        break;
      }
      default: {
        // Passthrough contract: an unrecognised-but-real firmware command still acks rather than
        // rejecting outright, since the exact command vocabulary isn't pinned by any file here.
        console.log("[mock hass] iledclock/command passthrough (unhandled by mock)", command, params);
      }
    }
  }

  const hass: HomeAssistant = {
    states,
    entities: ENTITY_REGISTRY,
    devices: { [DEVICE.id]: DEVICE },
    themes: { darkMode: true },
    language: "en",
    locale: { language: "en" },
    auth: { data: { access_token: "mock-token" } },
    hassUrl: "http://localhost:4173",
    callService: async (domain, service, data, target) => {
      console.log("[mock hass] callService", { domain, service, data, target });
      const entityId = (target?.entity_id as string | undefined) ?? undefined;
      const existing = entityId ? states[entityId] : undefined;
      if (!entityId || !existing) return undefined;
      if (domain === "light" && (service === "turn_on" || service === "turn_off")) {
        clockState.power = service === "turn_on";
        if (service === "turn_on" && typeof data?.brightness === "number") {
          clockState.brightness = Math.max(5, Math.min(100, Math.round(((data.brightness as number) / 255) * 100)));
        }
        syncDisplayLight();
      } else if (domain === "text" && service === "set_value") {
        states[entityId] = { ...existing, state: String(data?.value ?? "") };
      } else if (domain === "select" && service === "select_option") {
        const option = String(data?.option ?? "");
        states[entityId] = { ...existing, state: option };
        if (entityId.endsWith("_rotation")) clockState.rotate = (Math.max(0, Math.min(3, Number(option) / 90)) as 0 | 1 | 2 | 3);
      } else if (domain === "number" && service === "set_value") {
        const value = Number(data?.value ?? 0);
        states[entityId] = { ...existing, state: String(value) };
        if (entityId.endsWith("_volume")) clockState.volume = value;
        if (entityId.endsWith("_color_speed")) clockState.color_speed = value;
      } else if (domain === "switch" && (service === "turn_on" || service === "turn_off" || service === "toggle")) {
        const next = service === "toggle" ? (existing.state === "on" ? "off" : "on") : service === "turn_on" ? "on" : "off";
        states[entityId] = { ...existing, state: next };
        if (entityId.endsWith("_night_mode") && clockState.night_mode) clockState.night_mode = { ...clockState.night_mode, enabled: next === "on" };
      } else if (domain === "button" && service === "press") {
        applyCommand("sync_time", {});
      }
      notify();
      pushState();
      return undefined;
    },
    callWS: async <T = unknown>(msg: Record<string, unknown>): Promise<T> => {
      const type = msg.type as string | undefined;
      if (type === "iledclock/state") {
        requireEntry(msg.entry_id);
        return envelope() as unknown as T;
      }
      if (type === "iledclock/designs/list") {
        // Contract D (ARCHITECTURE.md): a raw array, not wrapped -- matches iledclock-studio-panel.ts's own expectation.
        return designs.map((d) => ({ ...d })) as unknown as T;
      }
      if (type === "iledclock/designs/save") {
        const design = msg.design as StoredDesign;
        if (!design || typeof design !== "object") throw wsError("agent_rejected", "Malformed design");
        const id = design.id && design.id.length > 0 ? design.id : `design-upload-${designSaveCounter++}`;
        const now = Math.floor(Date.now() / 1000);
        const saved: StoredDesign = { ...design, id, created: designs.find((d) => d.id === id)?.created ?? now, updated: now };
        const index = designs.findIndex((d) => d.id === id);
        if (index === -1) designs.push(saved);
        else designs[index] = saved;
        states[`sensor.plant_room_clock_program_count`] = { ...states[`sensor.plant_room_clock_program_count`]!, state: String(designs.length) };
        notify();
        return { id: saved.id } as unknown as T;
      }
      if (type === "iledclock/designs/delete") {
        const id = msg.design_id as string | undefined;
        const index = id ? designs.findIndex((d) => d.id === id) : -1;
        if (index === -1) throw wsError("not_found", `Unknown design ${String(id)}`);
        designs.splice(index, 1);
        states[`sensor.plant_room_clock_program_count`] = { ...states[`sensor.plant_room_clock_program_count`]!, state: String(designs.length) };
        notify();
        return {} as unknown as T;
      }
      if (type === "iledclock/render") {
        requireEntry(msg.entry_id);
        return renderSpec(msg.spec as RenderSpec) as unknown as T;
      }
      if (type === "iledclock/show") {
        requireEntry(msg.entry_id);
        console.log("[mock hass] iledclock/show", msg.item);
        pushState();
        return {} as unknown as T;
      }
      if (type === "iledclock/playlist/get") {
        requireEntry(msg.entry_id);
        return { playlist: playlist.map((item) => ({ ...item })) } as unknown as T;
      }
      if (type === "iledclock/playlist/set") {
        requireEntry(msg.entry_id);
        const requested = Array.isArray(msg.playlist) ? (msg.playlist as PlaylistItem[]) : [];
        playlist = normalizePlaylist(requested, CAPABILITIES.max_playlist_items);
        pushState();
        return { playlist: playlist.map((item) => ({ ...item })) } as unknown as T;
      }
      if (type === "iledclock/command") {
        requireEntry(msg.entry_id);
        applyCommand(String(msg.command), (msg.params as Record<string, unknown>) ?? {});
        notify();
        pushState();
        return {} as unknown as T;
      }
      if (type === "iledclock/gallery/sources") {
        requireEntry(msg.entry_id);
        return GALLERY_SOURCES.map((s) => ({ ...s })) as unknown as T;
      }
      if (type === "iledclock/gallery/search") {
        requireEntry(msg.entry_id);
        return gallerySearch({
          source: String(msg.source ?? ""),
          sort: String(msg.sort ?? ""),
          page: Number(msg.page ?? 1) - 1, // the wire is 1-based like the real server
          query: typeof msg.query === "string" ? msg.query : undefined,
          size: typeof msg.size === "string" ? msg.size : undefined,
          animatedOnly: Boolean(msg.animated_only),
        }) as unknown as T;
      }
      if (type === "iledclock/gallery/preview") {
        requireEntry(msg.entry_id);
        const source = String(msg.source ?? "");
        const id = String(msg.item_id ?? "");
        if (!findGalleryItem(source, id)) throw wsError("not_found", `Unknown gallery item ${source}/${id}`);
        return galleryPreview(source, id) as unknown as T;
      }
      if (type === "iledclock/gallery/import") {
        requireEntry(msg.entry_id);
        const source = String(msg.source ?? "");
        const id = String(msg.item_id ?? "");
        const item = findGalleryItem(source, id);
        if (!item) throw wsError("not_found", `Unknown gallery item ${source}/${id}`);
        const preview = galleryPreview(source, id);
        const designId = `design-gallery-${designSaveCounter++}`;
        const now = Math.floor(Date.now() / 1000);
        designs.push({
          id: designId,
          name: typeof msg.name === "string" && msg.name.length > 0 ? msg.name : item.title,
          kind: preview.frames.length > 1 ? "animation" : "image",
          width: GRID_WIDTH,
          height: GRID_HEIGHT,
          frames: preview.frames,
          delays: preview.delays_ms,
          created: now,
          updated: now,
        });
        states[`sensor.plant_room_clock_program_count`] = { ...states[`sensor.plant_room_clock_program_count`]!, state: String(designs.length) };
        notify();
        return { design_id: designId } as unknown as T;
      }
      if (type === "iledclock/import/file") {
        requireEntry(msg.entry_id);
        const filename = String(msg.filename ?? "import");
        const preview = importFilePreview(filename);
        if (msg.save) {
          const designId = `design-import-${designSaveCounter++}`;
          const now = Math.floor(Date.now() / 1000);
          designs.push({
            id: designId,
            name: typeof msg.name === "string" && msg.name.length > 0 ? msg.name : filename.replace(/\.[^.]+$/, ""),
            kind: preview.frames.length > 1 ? "animation" : "image",
            width: GRID_WIDTH,
            height: GRID_HEIGHT,
            frames: preview.frames,
            delays: preview.delays_ms,
            created: now,
            updated: now,
          });
          states[`sensor.plant_room_clock_program_count`] = { ...states[`sensor.plant_room_clock_program_count`]!, state: String(designs.length) };
          notify();
          return { design_id: designId } as unknown as T;
        }
        return preview as unknown as T;
      }
      throw wsError("unknown_command", `Unknown command: ${String(type)}`);
    },
    fetchWithAuth: async (input) => {
      return new Response(null, { status: 404, statusText: `mock hass has no fetch backing for ${String(input)}` });
    },
    connection: {
      subscribeMessage: async (callback, message) => {
        if (message.type !== "iledclock/subscribe") throw new Error(`mock hass: unsupported subscribe message ${String(message.type)}`);
        requireEntry(message.entry_id);
        subscribers.add(callback as (message: ClockStateEnvelope) => void);
        queueMicrotask(() => (callback as (message: ClockStateEnvelope) => void)(envelope()));
        return async () => {
          subscribers.delete(callback as (message: ClockStateEnvelope) => void);
        };
      },
    },
  };
  return hass;
}
