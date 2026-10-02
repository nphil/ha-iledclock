/** `?demo=playback` -- the Speed control on its own, bound to a real `PlaybackSession` and a real
 * `iledclock-led-preview`, so the control can be checked in a browser before any screen hosts it.
 *
 * Query options: `design=<id>` (default `design-slide-hello`; also `design-blink`, `design-pulse`,
 * `design-smiley` for a single picture), `width=<px>` (cap the demo column, e.g. 375), `theme=light`.
 * `window.__playbackDemo` exposes the session for scripted checks.
 */

import "../src/main.ts";
import type { IledclockPlaybackControl, PlaybackEventDetail } from "../src/components/iledclock-playback-control.ts";
import type { IledclockLedPreview } from "../src/components/iledclock-led-preview.ts";
import { designToFrames } from "../src/lib/design-codec.ts";
import { PlaybackSession } from "../src/lib/playback-session.ts";
import { playbackPreviewRequest } from "../src/lib/ws-api.ts";
import type { StoredDesign } from "../src/types.ts";
import { createMockHass } from "./mock-hass.ts";

declare global {
  interface Window {
    __playbackDemo?: { session: PlaybackSession; preview: IledclockLedPreview; control: IledclockPlaybackControl; events: string[] };
  }
}

const LIGHT_THEME: Record<string, string> = {
  "--card-background-color": "#ffffff",
  "--primary-text-color": "#212121",
  "--secondary-text-color": "#5f6368",
  "--disabled-text-color": "#9e9e9e",
  "--divider-color": "rgba(0, 0, 0, 0.12)",
  "--primary-color": "#0277bd",
  "--primary-background-color": "#f4f4f4",
  "--text-primary-color": "#ffffff",
};

function setTheme(light: boolean): void {
  const root = document.documentElement;
  const dark = {
    "--card-background-color": "#1c1c1c",
    "--primary-text-color": "#e1e1e1",
    "--secondary-text-color": "#9b9b9b",
    "--divider-color": "rgba(255, 255, 255, 0.14)",
    "--primary-color": "#03a9f4",
    "--primary-background-color": "#111111",
  };
  for (const [name, value] of Object.entries(light ? LIGHT_THEME : dark)) root.style.setProperty(name, value);
  root.classList.toggle("dark", !light);
}

export async function mountPlaybackDemo(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const hass = createMockHass();
  const designs = await hass.callWS!<StoredDesign[]>({ type: "iledclock/designs/list" });
  let design = designs.find((d) => d.id === params.get("design")) ?? designs.find((d) => d.id === "design-slide-hello") ?? designs[0]!;

  setTheme(params.get("theme") === "light");
  document.body.replaceChildren();
  document.body.style.alignItems = "center";

  const column = document.createElement("div");
  column.style.cssText = `width:100%;max-width:${Number(params.get("width")) || 520}px;display:flex;flex-direction:column;gap:16px;`;
  const picker = document.createElement("select");
  picker.setAttribute("aria-label", "Demo design");
  picker.style.cssText = "min-height:48px;font:inherit;padding:0 12px;";
  for (const d of designs) picker.append(new Option(`${d.name} (${d.frames.length} frame${d.frames.length === 1 ? "" : "s"})`, d.id, false, d.id === design.id));
  const themeButton = document.createElement("button");
  themeButton.type = "button";
  themeButton.textContent = params.get("theme") === "light" ? "Switch to dark" : "Switch to light";
  themeButton.style.cssText = "min-height:48px;font:inherit;";
  themeButton.addEventListener("click", () => {
    const light = !document.documentElement.classList.contains("dark");
    setTheme(!light);
    themeButton.textContent = light ? "Switch to light" : "Switch to dark";
  });
  const preview = document.createElement("iledclock-led-preview");
  preview.context = "hero";
  preview.label = "Preview of the clock";
  const control = document.createElement("iledclock-playback-control");
  const status = document.createElement("pre");
  status.style.cssText = "margin:0;font:12px/1.5 monospace;color:var(--secondary-text-color);white-space:pre-wrap;";
  column.append(picker, themeButton, preview, control, status);
  document.body.append(column);

  const events: string[] = [];
  const session = new PlaybackSession({
    callWS: (request) => hass.callWS!(request),
    buildRequest: (state) => playbackPreviewRequest({ designId: design.id }, state),
    onChange: () => {
      preview.frames = session.frames;
      preview.delays = session.delays;
      preview.rate = session.rate;
      preview.playing = session.playing;
      const info = session.info;
      status.textContent = [
        `speed=${session.speed} smooth=${session.smooth} rate=${session.rate.toFixed(3)} playing=${session.playing}`,
        `frames=${session.frames.length} loading=${session.loading} error=${session.error ?? "-"}`,
        info ? `info: pace=${info.pace_fps.toFixed(2)} native=${info.native_fps.toFixed(2)} original@${info.original_speed.toFixed(1)} smooth=${info.smooth.state} +${info.added_frames}` : "info: (none yet)",
        `last events: ${events.slice(-4).join(" | ")}`,
      ].join("\n");
    },
  });
  control.session = session;
  for (const type of ["playback-input", "playback-commit"] as const) {
    control.addEventListener(type, (event) => {
      const detail = (event as CustomEvent<PlaybackEventDetail>).detail;
      events.push(`${type.replace("playback-", "")} ${JSON.stringify(detail)}`);
      if (events.length > 20) events.shift();
    });
  }

  const load = (next: StoredDesign): void => {
    design = next;
    session.setSource(designToFrames(next), { state: { speed: next.speed ?? null, smooth: next.smooth ?? null } });
  };
  picker.addEventListener("change", () => load(designs.find((d) => d.id === picker.value) ?? design));
  load(design);
  window.__playbackDemo = { session, preview, control, events };
  window.__iledclockReady = true;
}
