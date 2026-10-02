/** The harness's stand-in for the server's `iledclock/playback/preview`.
 *
 * Two paths. First it POSTs the request (design already resolved to inline frames) to a Python bridge
 * on http://127.0.0.1:4174/playback/preview, which runs the REAL retime code, so smoothing and the 40-frame
 * budget behave exactly as on the clock. When the bridge is not running it falls back to a TypeScript port
 * of the pace scaling only: no in-between frames and `smooth.available` false, so the Smooth row reads
 * "Nothing slides or fades here". Honest about being a stand-in, never fakes smoothing.
 */

import { base64ToFrame } from "../src/lib/design-codec.ts";
import { nativeFps, originalSpeed, paceForSpeed, UNIT_MS, MIN_FRAME_UNITS } from "../src/lib/playback.ts";
import { posterFrameIndex } from "../src/lib/tile-policy.ts";
import type { PlaybackPreviewResult, SmoothSetting } from "../src/types.ts";

export const RETIME_BRIDGE_URL = "http://127.0.0.1:4174/playback/preview";
const BRIDGE_TIMEOUT_MS = 2500;
/** After a connection failure, skip the bridge for this long so a missing bridge costs one try, not one per request. */
const BRIDGE_RETRY_MS = 4000;

export interface InlinePlaybackRequest {
  type: "iledclock/playback/preview";
  frames: string[];
  delays: number[];
  clock_region?: { x: number; y: number; w: number; h: number } | null;
  speed: number | null;
  smooth: SmoothSetting;
}

const MIN_DELAY_MS = MIN_FRAME_UNITS * UNIT_MS;

/** Pace scaling only: hold times are stretched or squeezed together so the loop plays at the requested
 * authored-frames-a-second, each hold floored at the clock's 7-unit minimum. Speed 0 is the fullest frame. */
export function retimeLocally(request: InlinePlaybackRequest): PlaybackPreviewResult {
  const authored = request.frames.length;
  const total = request.delays.reduce((sum, delay) => sum + delay, 0);
  const native = nativeFps(request.delays);
  const smoothInfo = { state: "unavailable" as const, available: false, enabled: request.smooth !== "off", slides: 0, fades: 0, sharp: 0, capped: false };
  const base = { authored_frames: authored, added_frames: 0, native_fps: native, original_speed: originalSpeed(native), smooth: smoothInfo };

  if (request.speed !== null && request.speed <= 0) {
    const poster = posterFrameIndex(request.frames.map((b64) => base64ToFrame(b64, 32, 16, 100)));
    return { frames: [request.frames[poster]!], delays: [1000], playback: { ...base, still: true, frames: 1, loop_ms: 0, pace_fps: 0 } };
  }
  if (request.speed === null) {
    return { frames: request.frames, delays: request.delays, playback: { ...base, still: false, frames: authored, loop_ms: total, pace_fps: native } };
  }
  const pace = paceForSpeed(request.speed);
  const loopMs = (authored * 1000) / pace;
  const delays = request.delays.map((delay) => Math.max(MIN_DELAY_MS, (delay * loopMs) / total));
  const achievedLoop = delays.reduce((sum, delay) => sum + delay, 0);
  return { frames: request.frames, delays, playback: { ...base, still: false, frames: authored, loop_ms: achievedLoop, pace_fps: (authored * 1000) / achievedLoop } };
}

let bridgeDownUntil = 0;

export async function retime(request: InlinePlaybackRequest): Promise<PlaybackPreviewResult> {
  if (Date.now() >= bridgeDownUntil) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
      const response = await fetch(RETIME_BRIDGE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const body = (await response.json()) as PlaybackPreviewResult;
        if (Array.isArray(body.frames) && Array.isArray(body.delays) && body.playback) return body;
      }
    } catch {
      bridgeDownUntil = Date.now() + BRIDGE_RETRY_MS;
    }
  }
  return retimeLocally(request);
}
