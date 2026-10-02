/** The state machine behind the Speed slider: what speed/smooth the user picked, which frames the
 * preview is playing, and how those line up with what the clock will really play.
 *
 * The idea: the server computes the EXACT frames (pace scaling plus in-between frames) with
 * `iledclock/playback/preview`, but a round-trip per slider step would feel laggy. So while the
 * slider is dragged the session keeps the last exact frames and just plays them faster or slower
 * (`rate = target pace / loaded pace`); Still swaps to the poster frame at once. Once the user lets
 * go (release, keyboard, switch, reset) it waits a short debounce, fetches the exact frames, swaps
 * them in and puts `rate` back to 1. Answers to anything but the newest request are ignored.
 *
 * Framework-free on purpose (no Lit, no DOM): the WebSocket call, request builder and timers are
 * injected so the whole thing is unit-tested with fakes. Screens create one session per previewed
 * thing; `iledclock-playback-control` and `iledclock-led-preview` just read it.
 */

import { base64ToFrame } from "./design-codec.ts";
import { GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "./grid.ts";
import { nativeFps, originalSpeed, previewRate } from "./playback.ts";
import { posterFrameIndex } from "./tile-policy.ts";
import type { PlaybackInfo, PlaybackPreviewResult, SmoothSetting } from "../types.ts";

export interface PlaybackState {
  /** null = Original, 0 = Still, 1..100 = slider position. */
  speed: number | null;
  /** null = auto (acts like "on"). */
  smooth: SmoothSetting;
}

export interface PlaybackSessionDeps {
  /** Sends the request built by `buildRequest` (`iledclock/playback/preview`) and resolves with its result. */
  callWS: (request: Record<string, unknown>) => Promise<PlaybackPreviewResult>;
  /** Builds the preview request for the current source: `playbackPreviewRequest({designId}, state)` or
   * an inline-frames source. Receives the authored frames the session was given. */
  buildRequest: (state: PlaybackState, authored: readonly PixelFrame[]) => Record<string, unknown>;
  /** Called after every visible change; more listeners can join through `subscribe`. */
  onChange?: () => void;
  /** Injected for tests; default `setTimeout`. */
  setTimer?: (callback: () => void, ms: number) => unknown;
  /** Injected for tests; default `clearTimeout`. */
  clearTimer?: (handle: unknown) => void;
  /** Wait after a commit before asking the server. Default 200 ms. */
  debounceMs?: number;
  /** The state `reset()` restores. Default Original with auto smooth. */
  defaultState?: PlaybackState;
}

export const PLAYBACK_DEBOUNCE_MS = 200;
const ORIGINAL_STATE: PlaybackState = { speed: null, smooth: null };

interface FrameSet {
  frames: PixelFrame[];
  delays: number[];
  /** Authored frames a second these frames play at (rate 1). */
  paceFps: number;
}

function errorText(error: unknown): string {
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : typeof error === "string" ? error : "";
  return message ? `Couldn't update the preview: ${message}` : "Couldn't update the preview";
}

function sameState(a: PlaybackState, b: PlaybackState): boolean {
  return a.speed === b.speed && a.smooth === b.smooth;
}

export class PlaybackSession {
  private readonly deps: PlaybackSessionDeps;
  private readonly listeners = new Set<() => void>();
  private readonly debounceMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private _state: PlaybackState;
  private _default: PlaybackState;
  private _authored: PixelFrame[] = [];
  private _sourceRef: readonly PixelFrame[] | null = null;
  /** The last playable (not Still) frames: authored until the first exact result arrives. */
  private _playable: FrameSet = { frames: [], delays: [], paceFps: 0 };
  private _display: { frames: PixelFrame[]; delays: number[] } = { frames: [], delays: [] };
  private _exactState: PlaybackState | null = null;
  private _info: PlaybackInfo | null = null;
  private _rate = 1;
  private _playing = false;
  private _loading = false;
  private _error: string | null = null;
  private _timer: unknown = null;
  private _requestId = 0;
  private _disposed = false;

  constructor(deps: PlaybackSessionDeps) {
    this.deps = deps;
    this.debounceMs = deps.debounceMs ?? PLAYBACK_DEBOUNCE_MS;
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as number));
    this._default = { ...(deps.defaultState ?? ORIGINAL_STATE) };
    this._state = { ...this._default };
    if (deps.onChange) this.listeners.add(deps.onChange);
  }

  // ---- reads ----

  /** What the user picked (the slider position and the Smooth switch). */
  get state(): PlaybackState {
    return { ...this._state };
  }
  get defaultState(): PlaybackState {
    return { ...this._default };
  }
  get speed(): number | null {
    return this._state.speed;
  }
  get smooth(): SmoothSetting {
    return this._state.smooth;
  }
  /** The frames to hand to `iledclock-led-preview` (`.frames`) and their hold times in ms (`.delays`). */
  get frames(): PixelFrame[] {
    return this._display.frames;
  }
  get delays(): number[] {
    return this._display.delays;
  }
  /** Playback speed multiplier for `iledclock-led-preview` (`.rate`). 1 whenever the frames are exact. */
  get rate(): number {
    return this._rate;
  }
  /** False for Still, single-frame designs and before any frames exist. */
  get playing(): boolean {
    return this._playing;
  }
  /** An exact-preview request is waiting for its debounce or in flight. */
  get loading(): boolean {
    return this._loading;
  }
  /** Plain-language failure text from the last exact request, or null. Hosts show it. */
  get error(): string | null {
    return this._error;
  }
  /** What the server said about the exact frames; null until the first result. */
  get info(): PlaybackInfo | null {
    return this._info;
  }
  /** False for a single picture: the whole Speed section hides. */
  get hasMotion(): boolean {
    return this._authored.length > 1;
  }
  get authoredFrames(): number {
    return this._authored.length;
  }
  /** Authored frames a second as drawn (the Original pace). */
  get nativeFps(): number {
    return this._info?.native_fps ?? nativeFps(this._authored.map((frame) => frame.durationMs));
  }
  /** Slider position of the Original tick: the server's value once known, else computed locally. */
  get originalSpeed(): number {
    return this._info?.original_speed ?? originalSpeed(this.nativeFps);
  }
  /** Authored frames a second the currently loaded exact frames play at. */
  get loadedPace(): number {
    return this._playable.paceFps;
  }

  // ---- changes ----

  /** Subscribe to every visible change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Point the session at new authored frames (a different design, a new import). Resets the exact
   * result and fetches at once (no debounce) so the Smooth row knows what is available. `options.state`
   * sets both the starting and the Reset state (a stored design's speed/smooth); without it the
   * current state is kept. Passing the very same frames array with no state is a no-op. */
  setSource(frames: readonly PixelFrame[], options: { state?: PlaybackState } = {}): void {
    if (this._disposed) return;
    if (frames === this._sourceRef && !options.state) return;
    this._sourceRef = frames;
    this._authored = [...frames];
    if (options.state) {
      this._default = { ...options.state };
      this._state = { ...options.state };
    }
    this._cancelPending();
    this._info = null;
    this._exactState = null;
    this._error = null;
    this._playable = {
      frames: this._authored,
      delays: this._authored.map((frame) => frame.durationMs),
      paceFps: nativeFps(this._authored.map((frame) => frame.durationMs)),
    };
    this._display = { frames: this._playable.frames, delays: this._playable.delays };
    this._applyLocal();
    this._notify();
    if (this._authored.length > 0) void this._fetch();
  }

  /** Change speed and/or smooth. `commit: false` is a drag step: the preview adapts locally at once and
   * no request goes out. `commit: true` (release, key, switch) schedules the exact request after the
   * debounce. */
  setState(next: Partial<PlaybackState>, options: { commit?: boolean } = {}): void {
    if (this._disposed) return;
    const merged: PlaybackState = { speed: next.speed !== undefined ? next.speed : this._state.speed, smooth: next.smooth !== undefined ? next.smooth : this._state.smooth };
    this._state = merged;
    this._cancelPending();
    this._applyLocal();
    if (options.commit) this._scheduleFetch();
    this._notify();
  }

  /** Restore the default state (Original unless the host set one) and refresh the exact frames. */
  reset(): void {
    this.setState(this._default, { commit: true });
  }

  /** Make `state` the one `reset()` returns to, without changing what is playing (a host calls this
   * after saving the design). */
  setDefaultState(state: PlaybackState): void {
    this._default = { ...state };
    this._notify();
  }

  /** Fetch the exact frames right now (no debounce). */
  refresh(): void {
    if (this._disposed) return;
    this._cancelPending();
    void this._fetch();
  }

  /** Stop everything: pending timers, in-flight answers and listeners. */
  dispose(): void {
    this._disposed = true;
    this._cancelPending();
    this.listeners.clear();
  }

  // ---- internals ----

  private _notify(): void {
    if (this._disposed) return;
    for (const listener of [...this.listeners]) listener();
  }

  /** Drop any waiting debounce and make older in-flight answers stale. */
  private _cancelPending(): void {
    if (this._timer !== null) {
      this.clearTimer(this._timer);
      this._timer = null;
    }
    this._requestId++;
    this._loading = false;
  }

  private _scheduleFetch(): void {
    if (this._authored.length === 0) return;
    if (this._exactState && sameState(this._exactState, this._state) && !this._error) {
      // The frames on screen already ARE this setting's exact frames.
      this._rate = 1;
      return;
    }
    this._loading = true;
    this._timer = this.setTimer(() => {
      this._timer = null;
      void this._fetch();
    }, this.debounceMs);
  }

  /** Make the preview look like `_state` using only what is already loaded. */
  private _applyLocal(): void {
    const speed = this._state.speed;
    if (this._authored.length === 0) {
      this._display = { frames: [], delays: [] };
      this._rate = 1;
      this._playing = false;
      return;
    }
    if (speed !== null && speed <= 0) {
      const poster = this._authored[posterFrameIndex(this._authored)] ?? this._authored[0]!;
      this._display = { frames: [poster], delays: [poster.durationMs] };
      this._rate = 1;
      this._playing = false;
      return;
    }
    this._display = { frames: this._playable.frames, delays: this._playable.delays };
    this._rate = previewRate(speed, this._playable.paceFps, nativeFps(this._authored.map((frame) => frame.durationMs)));
    this._playing = this._display.frames.length > 1;
  }

  private async _fetch(): Promise<void> {
    const id = ++this._requestId;
    const requested: PlaybackState = { ...this._state };
    this._loading = true;
    this._error = null;
    this._notify();
    try {
      const result = await this.deps.callWS(this.deps.buildRequest(requested, this._authored));
      if (id !== this._requestId) return;
      this._acceptResult(result, requested);
    } catch (error) {
      if (id !== this._requestId) return;
      this._loading = false;
      this._error = errorText(error);
    }
    this._notify();
  }

  private _acceptResult(result: PlaybackPreviewResult, requested: PlaybackState): void {
    if (!result || !Array.isArray(result.frames) || !Array.isArray(result.delays) || result.frames.length === 0 || result.frames.length !== result.delays.length || !result.playback) {
      throw new Error("The server sent a preview this panel can't read");
    }
    const first = this._authored[0];
    const width = first?.width ?? GRID_WIDTH;
    const height = first?.height ?? GRID_HEIGHT;
    const delays = result.delays.map((delay) => Math.max(1, Number(delay)));
    const frames = result.frames.map((b64, index) => base64ToFrame(b64, width, height, delays[index]!));
    this._info = result.playback;
    this._exactState = requested;
    this._loading = false;
    if (result.playback.still) {
      this._display = { frames, delays };
      this._playing = false;
      this._rate = 1;
      return;
    }
    this._playable = { frames, delays, paceFps: result.playback.pace_fps };
    this._display = { frames, delays };
    this._rate = 1;
    this._playing = frames.length > 1;
  }
}
