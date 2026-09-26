/** The iLedClock card: a glowing 32x16 LED-matrix mirror as the hero, status pills, five big mode
 * pills (Clock/Text/Art/Timer/Score) and a compact per-mode control surface underneath, brightness
 * + power in the hero corner, and every secondary setting behind the gear. See ARCHITECTURE.md
 * Contract E and the reference Kibble card (`/data/home/Homelabber/kibble-card`) for the design
 * language this follows: HA theme variables for every generic surface, one accent colour, pill
 * shapes, container queries (not viewport) for the phone/tablet/desktop layouts.
 */

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { ClockState, ClockStateEnvelope, HomeAssistant, IledclockCardConfig, RenderSpec, StoredDesign, SubscribeEvent } from "../types.ts";
import { resolveIledclockEntities, type IledclockEntities } from "../lib/resolve-entities.ts";
import { resolveEntryId } from "../lib/entry-id.ts";
import { watchKey } from "../lib/ws-query.ts";
import { brightnessToPercent, percentToBrightness } from "../lib/brightness.ts";
import { CLOCK_COLORS, CLOCK_FACE_COUNT, CLOCK_FACES } from "../lib/clock-faces.ts";
import { TEXT_EFFECTS } from "../lib/text-effects.ts";
import { hexToRgb, quantizePreviewRgbLinear, rgbToHex, type RGB } from "../lib/color.ts";
import { frameIndexAtTime } from "../lib/frame-player.ts";
import { createFrame, type PixelFrame } from "../lib/grid.ts";
import { designToFrames } from "../lib/design-codec.ts";
import { buildClockRenderSpec, buildTextRenderSpec, commandRequest, designsListRequest, renderRequest, showRequest } from "../lib/ws-api.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-matrix-canvas.ts";
import "./iledclock-segmented-picker.ts";
import "./iledclock-settings-sheet.ts";
import "./iledclock-card-editor.ts";

const MODE_OPTIONS = [
  { value: "clock", label: "Clock" },
  { value: "text", label: "Text" },
  { value: "art", label: "Art" },
  { value: "timer", label: "Timer" },
  { value: "score", label: "Score" },
] as const;
type ModeValue = (typeof MODE_OPTIONS)[number]["value"];

const TIMER_TAB_OPTIONS = [
  { value: "countdown", label: "Countdown" },
  { value: "stopwatch", label: "Stopwatch" },
  { value: "pomodoro", label: "Pomodoro" },
] as const;
type TimerTab = (typeof TIMER_TAB_OPTIONS)[number]["value"];

/** How often the hero re-renders a fresh clock preview while idle -- a clock preview a minute
 * stale is still honestly "the current time" to a glance, and this avoids hammering the render
 * WS command every second for a hero nobody is actively editing. */
const IDLE_CLOCK_REFRESH_MS = 60_000;
const TEXT_PREVIEW_DEBOUNCE_MS = 400;

export class IledclockCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _entities: { state: true },
    _entryId: { state: true },
    _envelope: { state: true },
    _mode: { state: true },
    _settingsOpen: { state: true },
    _heroFrames: { state: true },
    _heroApproximate: { state: true },
    _designs: { state: true },
    _designsLoading: { state: true },
    _clockFaceIndex: { state: true },
    _clockColorIndex: { state: true },
    _clock24h: { state: true },
    _textMessage: { state: true },
    _textColorHex: { state: true },
    _textEffect: { state: true },
    _textSpeed: { state: true },
    _selectedDesignId: { state: true },
    _timerTab: { state: true },
    _countdownDraft: { state: true },
    _tomatoDraft: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };

  declare hass: HomeAssistant;
  declare _config: IledclockCardConfig | undefined;
  declare _entities: IledclockEntities;
  declare _entryId: string | undefined;
  declare _envelope: ClockStateEnvelope | null;
  declare _mode: ModeValue;
  declare _settingsOpen: boolean;
  declare _heroFrames: PixelFrame[];
  declare _heroApproximate: boolean;
  declare _designs: StoredDesign[] | null;
  declare _designsLoading: boolean;
  declare _clockFaceIndex: number;
  declare _clockColorIndex: number;
  declare _clock24h: boolean;
  declare _textMessage: string;
  declare _textColorHex: string;
  declare _textEffect: number;
  declare _textSpeed: number;
  declare _selectedDesignId: string | null;
  declare _timerTab: TimerTab;
  declare _countdownDraft: { h: number; m: number; s: number };
  declare _tomatoDraft: number[];
  declare _busy: string | null;
  declare _error: string | null;

  private _unsubscribe: (() => Promise<void>) | null = null;
  private _lastEntryIdSubscribed: string | undefined;
  private _heroStartedAt = 0;
  private _heroRafId: number | null = null;
  private _idleClockTimer: ReturnType<typeof setInterval> | undefined;
  private _textDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _designsWatchKey = "";

  constructor() {
    super();
    this._entities = { deviceId: "", settingSwitches: [] };
    this._envelope = null;
    this._mode = "clock";
    this._settingsOpen = false;
    this._heroFrames = [createFrame()];
    this._heroApproximate = false;
    this._designs = null;
    this._designsLoading = false;
    this._clockFaceIndex = 1;
    this._clockColorIndex = 6; // white
    this._clock24h = true;
    this._textMessage = "";
    this._textColorHex = "#ffffff";
    this._textEffect = 1;
    this._textSpeed = 80;
    this._selectedDesignId = null;
    this._timerTab = "countdown";
    this._countdownDraft = { h: 0, m: 5, s: 0 };
    this._tomatoDraft = [25];
    this._busy = null;
    this._error = null;
  }

  setConfig(config: IledclockCardConfig): void {
    if (!config.device_id) throw new Error("iLedClock card: a device is required. Choose it in the card editor.");
    this._config = config;
  }

  getCardSize(): number {
    return 6;
  }

  static getStubConfig(hass: HomeAssistant): IledclockCardConfig {
    const entry = Object.values(hass.entities ?? {}).find((entity) => entity.platform === "iledclock");
    return { type: "custom:iledclock-card", device_id: entry?.device_id ?? "" };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("iledclock-card-editor");
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._startHeroLoop();
    this._idleClockTimer = setInterval(() => {
      if (this._mode === "clock" || (this._heroFrames.length <= 1 && this._heroApproximate)) this._refreshIdleClockPreview();
    }, IDLE_CLOCK_REFRESH_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopHeroLoop();
    clearInterval(this._idleClockTimer);
    clearTimeout(this._textDebounceTimer);
    if (this._unsubscribe) void this._unsubscribe();
  }

  protected willUpdate(changed: PropertyValues): void {
    if ((changed.has("hass") || changed.has("_config")) && this.hass && this._config?.device_id) {
      this._entities = resolveIledclockEntities(this.hass.entities, this._config.device_id);
      const entryId = resolveEntryId(this.hass.devices, this._config.device_id);
      this._entryId = entryId;
      if (entryId && entryId !== this._lastEntryIdSubscribed) {
        this._lastEntryIdSubscribed = entryId;
        void this._connect(entryId);
      }
    }
    if (changed.has("_mode") && this._mode === "art") this._loadDesigns();
  }

  // ---- live state ----

  private async _connect(entryId: string): Promise<void> {
    if (this._unsubscribe) {
      void this._unsubscribe();
      this._unsubscribe = null;
    }
    if (!this.hass.callWS) return;
    try {
      this._envelope = await this.hass.callWS<ClockStateEnvelope>({ type: "iledclock/state", entry_id: entryId });
    } catch {
      // The push subscription below still gives us a chance to recover a snapshot.
    }
    if (!this._heroApproximate) this._refreshIdleClockPreview();
    if (this.hass.connection) {
      this._unsubscribe = await this.hass.connection.subscribeMessage<SubscribeEvent>((event) => {
        if (event.type === "upload") return; // the studio panel owns upload-progress UI
        this._envelope = event;
      }, { type: "iledclock/subscribe", entry_id: entryId });
    }
  }

  // ---- hero animation ----

  private _startHeroLoop(): void {
    if (this._heroRafId !== null) return;
    this._heroStartedAt = performance.now();
    const step = () => {
      this.requestUpdate("_heroFrames");
      this._heroRafId = requestAnimationFrame(step);
    };
    this._heroRafId = requestAnimationFrame(step);
  }

  private _stopHeroLoop(): void {
    if (this._heroRafId !== null) cancelAnimationFrame(this._heroRafId);
    this._heroRafId = null;
  }

  private _currentHeroFrame(): PixelFrame {
    const elapsed = performance.now() - this._heroStartedAt;
    const index = frameIndexAtTime(this._heroFrames, elapsed);
    return this._heroFrames[index] ?? createFrame();
  }

  private async _refreshIdleClockPreview(): Promise<void> {
    if (!this._entryId || !this.hass.callWS) return;
    const spec = buildClockRenderSpec(this._clockFaceIndex, CLOCK_COLORS[this._clockColorIndex]?.rgb ?? [255, 255, 255], this._clock24h, CLOCK_FACE_COUNT);
    await this._loadHeroPreview(spec, true);
  }

  private async _loadHeroPreview(spec: RenderSpec, isIdle: boolean): Promise<void> {
    if (!this._entryId || !this.hass.callWS) return;
    try {
      const result = await this.hass.callWS<{ frames: string[]; delays: number[]; approximate?: boolean }>(renderRequest(this._entryId, spec));
      const width = this._entities ? 32 : 32;
      const frames = result.frames.map((b64, i) => {
        const bin = atob(b64);
        const pixels = new Uint8Array(width * 16 * 3);
        for (let i2 = 0; i2 < Math.min(bin.length, pixels.length); i2++) pixels[i2] = bin.charCodeAt(i2);
        return { width, height: 16, pixels, durationMs: result.delays[i] ?? 100 };
      });
      if (frames.length > 0) {
        this._heroFrames = frames;
        this._heroApproximate = isIdle && Boolean(result.approximate);
        this._heroStartedAt = performance.now();
      }
    } catch {
      // A failed preview render leaves the hero showing whatever it last had -- never blank.
    }
  }

  // ---- mode selection ----

  private _selectMode(mode: string): void {
    this._mode = mode as ModeValue;
    if (mode === "art" && this._selectedDesignId) {
      const design = this._designs?.find((d) => d.id === this._selectedDesignId);
      if (design) {
        this._heroFrames = designToFrames(design);
        this._heroStartedAt = performance.now();
      }
    }
  }

  // ---- power / brightness ----

  private _toggleDisplay(): void {
    const entity = this._entities.display;
    if (!entity) return;
    const isOn = this.hass.states[entity]?.state === "on";
    void this.hass.callService("light", isOn ? "turn_off" : "turn_on", {}, { entity_id: entity });
  }

  private _setBrightnessPercent(percent: number): void {
    const entity = this._entities.display;
    if (!entity) return;
    void this.hass.callService("light", "turn_on", { brightness: percentToBrightness(percent) }, { entity_id: entity });
  }

  // ---- clock mode ----

  private _sendClock(): void {
    if (!this._entryId || !this.hass.callWS) return;
    const spec = buildClockRenderSpec(this._clockFaceIndex, CLOCK_COLORS[this._clockColorIndex]?.rgb ?? [255, 255, 255], this._clock24h, CLOCK_FACE_COUNT);
    this._runCommand("show-clock", () => this.hass.callWS!(showRequest(this._entryId!, { spec })));
    void this._loadHeroPreview(spec, false);
  }

  // ---- text mode ----

  private _onTextInput(value: string): void {
    this._textMessage = value;
    clearTimeout(this._textDebounceTimer);
    this._textDebounceTimer = setTimeout(() => this._previewText(), TEXT_PREVIEW_DEBOUNCE_MS);
  }

  private _previewText(): void {
    const spec = buildTextRenderSpec(this._textMessage, hexToRgb(this._textColorHex), { effect: String(this._textEffect), speed: this._textSpeed });
    if (spec) void this._loadHeroPreview(spec, false);
  }

  private _sendText(): void {
    if (!this._entryId || !this.hass.callWS) return;
    const spec = buildTextRenderSpec(this._textMessage, hexToRgb(this._textColorHex), { effect: String(this._textEffect), speed: this._textSpeed });
    if (!spec) return;
    this._runCommand("show-text", () => this.hass.callWS!(showRequest(this._entryId!, { spec })));
  }

  // ---- art mode ----

  private async _loadDesigns(): Promise<void> {
    const key = `${this._entryId ?? ""}`;
    if (this._designsWatchKey === key && this._designs) return;
    this._designsWatchKey = key;
    if (!this.hass.callWS) return;
    this._designsLoading = true;
    try {
      this._designs = await this.hass.callWS<StoredDesign[]>(designsListRequest(this._entryId));
    } catch {
      this._designs = [];
    } finally {
      this._designsLoading = false;
    }
  }

  private _selectDesign(design: StoredDesign): void {
    this._selectedDesignId = design.id;
    this._heroFrames = designToFrames(design);
    this._heroStartedAt = performance.now();
  }

  private _sendDesign(): void {
    if (!this._entryId || !this._selectedDesignId || !this.hass.callWS) return;
    this._runCommand("show-design", () => this.hass.callWS!(showRequest(this._entryId!, { design_id: this._selectedDesignId! })));
  }

  private _openStudio(): void {
    history.pushState(null, "", "/iledclock");
    window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
  }

  // ---- timer mode ----

  private _runCommand(key: string, run: () => Promise<unknown>): void {
    this._busy = key;
    this._error = null;
    run()
      .catch((err: unknown) => {
        this._error = err instanceof Error ? err.message : "Something went wrong.";
      })
      .finally(() => {
        this._busy = null;
        this.requestUpdate();
      });
  }

  private _command(command: string, params: Record<string, unknown> = {}): void {
    if (!this._entryId || !this.hass.callWS) return;
    this._runCommand(command, () => this.hass.callWS!(commandRequest(this._entryId!, command, params)));
  }

  // ---- score mode ----

  private _adjustScore(side: "home" | "away", delta: number): void {
    const score = this._envelope?.state.scoreboard;
    const home = Math.max(0, (score?.home ?? 0) + (side === "home" ? delta : 0));
    const away = Math.max(0, (score?.away ?? 0) + (side === "away" ? delta : 0));
    this._command("scoreboard_set_score", { home, away });
  }

  // ---- render ----

  render() {
    if (!this._config) return nothing;
    const state = this._envelope?.state ?? null;
    return html`
      <ha-card>
        <div class="container">
          <div class="root">
            <div class="hero-wrap">
              <iledclock-matrix-canvas .frame=${this._currentHeroFrame()} bloom></iledclock-matrix-canvas>
              ${this._heroApproximate ? html`<span class="approximate-badge">Preview</span>` : nothing}
              <div class="hero-corner left">
                ${this._entities.display
                  ? html`
                      <button type="button" class="chip icon-chip" @click=${this._toggleDisplay} aria-label="Toggle display">
                        ${mdiIcon("power")}
                      </button>
                      <input
                        class="brightness-slider"
                        type="range"
                        min="1"
                        max="100"
                        .value=${String(brightnessToPercent(Number(this.hass.states[this._entities.display]?.attributes.brightness ?? 128)))}
                        @input=${(e: Event) => this._setBrightnessPercent(Number((e.target as HTMLInputElement).value))}
                        aria-label="Brightness"
                      />
                    `
                  : nothing}
              </div>
              <button type="button" class="chip icon-chip hero-corner right" @click=${() => (this._settingsOpen = true)} aria-label="Settings">
                ${mdiIcon("cog")}
              </button>
              <div class="status-pills">${this._renderStatusPills(state)}</div>
            </div>
            <div class="controls">
              <iledclock-segmented-picker
                group-label="Mode"
                .options=${MODE_OPTIONS}
                .value=${this._mode}
                @option-selected=${(e: CustomEvent<{ value: string }>) => this._selectMode(e.detail.value)}
              ></iledclock-segmented-picker>
              ${this._error ? html`<p class="error">${this._error}</p>` : nothing}
              <div class="mode-panel">
                ${this._mode === "clock" ? this._renderClockPanel() : nothing}
                ${this._mode === "text" ? this._renderTextPanel() : nothing}
                ${this._mode === "art" ? this._renderArtPanel() : nothing}
                ${this._mode === "timer" ? this._renderTimerPanel(state) : nothing}
                ${this._mode === "score" ? this._renderScorePanel(state) : nothing}
              </div>
            </div>
          </div>
        </div>
      </ha-card>
      <iledclock-settings-sheet
        .hass=${this.hass}
        .entities=${this._entities}
        .entryId=${this._entryId}
        .state=${state}
        ?open=${this._settingsOpen}
        @close-requested=${() => (this._settingsOpen = false)}
      ></iledclock-settings-sheet>
    `;
  }

  private _renderStatusPills(state: ClockState | null) {
    const pills = [];
    if (this._entities.connected) {
      const connected = this._envelope?.connected ?? this.hass.states[this._entities.connected]?.state === "on";
      pills.push(html`<span class="pill ${connected ? "good" : "warn"}"><span class="dot"></span>${connected ? "Connected" : "Offline"}</span>`);
    }
    if (state?.night_mode?.enabled) pills.push(html`<span class="pill night">${mdiIcon("nightMode")} Night mode</span>`);
    if (state?.temperature != null) pills.push(html`<span class="pill">${mdiIcon("thermometer")} ${state.temperature}\u00b0</span>`);
    if (state?.humidity != null) pills.push(html`<span class="pill">${mdiIcon("humidity")} ${state.humidity}%</span>`);
    return pills;
  }

  private _renderClockPanel() {
    return html`
      <div class="panel-section">
        <div class="face-grid">
          ${CLOCK_FACES.map(
            (face) => html`<button type="button" class="face-btn ${face.style === this._clockFaceIndex ? "selected" : ""}" @click=${() => (this._clockFaceIndex = face.style, this._refreshIdleClockPreview())}>
              ${face.style}
            </button>`,
          )}
        </div>
        <div class="swatch-row">
          ${CLOCK_COLORS.map(
            (c) => html`<button
              type="button"
              class="swatch ${c.index === this._clockColorIndex ? "selected" : ""}"
              style="background:${`rgb(${quantizePreviewRgbLinear(c.rgb).join(",")})`}"
              aria-label=${c.label}
              @click=${() => (this._clockColorIndex = c.index, this._refreshIdleClockPreview())}
            ></button>`,
          )}
        </div>
        <iledclock-segmented-picker
          group-label="Hour format"
          content-fit
          .options=${[
            { value: "24", label: "24h" },
            { value: "12", label: "12h" },
          ]}
          .value=${this._clock24h ? "24" : "12"}
          @option-selected=${(e: CustomEvent<{ value: string }>) => ((this._clock24h = e.detail.value === "24"), this._refreshIdleClockPreview())}
        ></iledclock-segmented-picker>
        <button type="button" class="primary-action" ?disabled=${this._busy === "show-clock"} @click=${this._sendClock}>Set clock face</button>
      </div>
    `;
  }

  private _renderTextPanel() {
    return html`
      <div class="panel-section">
        <input class="text-input" type="text" maxlength="64" placeholder="Message" .value=${this._textMessage} @input=${(e: Event) => this._onTextInput((e.target as HTMLInputElement).value)} />
        <div class="swatch-row">
          <input type="color" class="color-input" .value=${this._textColorHex} @input=${(e: Event) => ((this._textColorHex = (e.target as HTMLInputElement).value), this._previewText())} />
          <select class="effect-select" @change=${(e: Event) => ((this._textEffect = Number((e.target as HTMLSelectElement).value)), this._previewText())}>
            ${TEXT_EFFECTS.map((effect) => html`<option value=${effect.mode} ?selected=${effect.mode === this._textEffect}>${effect.label}</option>`)}
          </select>
        </div>
        <label class="field-label">
          Speed
          <input type="range" min="0" max="255" .value=${String(this._textSpeed)} @input=${(e: Event) => ((this._textSpeed = Number((e.target as HTMLInputElement).value)), this._previewText())} />
        </label>
        <button type="button" class="primary-action" ?disabled=${this._busy === "show-text" || this._textMessage.trim().length === 0} @click=${this._sendText}>Send</button>
      </div>
    `;
  }

  private _renderArtPanel() {
    return html`
      <div class="panel-section">
        ${this._designsLoading ? html`<p class="hint">Loading designs…</p>` : nothing}
        ${!this._designsLoading && (this._designs?.length ?? 0) === 0 ? html`<p class="hint">No saved designs yet. Open the studio to create one.</p>` : nothing}
        <div class="carousel">
          ${(this._designs ?? []).map((design) => {
            const frame = designToFrames(design)[0]!;
            return html`
              <button type="button" class="carousel-item ${design.id === this._selectedDesignId ? "selected" : ""}" @click=${() => this._selectDesign(design)}>
                <span class="carousel-thumb"><iledclock-matrix-canvas .frame=${frame}></iledclock-matrix-canvas></span>
                <span class="carousel-label">${design.name}</span>
              </button>
            `;
          })}
        </div>
        <div class="button-row">
          <button type="button" class="primary-action" ?disabled=${this._busy === "show-design" || !this._selectedDesignId} @click=${this._sendDesign}>Send</button>
          <button type="button" class="secondary-action" @click=${this._openStudio}>Open studio</button>
        </div>
      </div>
    `;
  }

  private _renderTimerPanel(state: ClockState | null) {
    return html`
      <div class="panel-section">
        <iledclock-segmented-picker
          group-label="Timer type"
          content-fit
          .options=${TIMER_TAB_OPTIONS}
          .value=${this._timerTab}
          @option-selected=${(e: CustomEvent<{ value: string }>) => (this._timerTab = e.detail.value as TimerTab)}
        ></iledclock-segmented-picker>
        ${this._timerTab === "countdown" ? this._renderCountdown(state) : nothing}
        ${this._timerTab === "stopwatch" ? this._renderStopwatch(state) : nothing}
        ${this._timerTab === "pomodoro" ? this._renderPomodoro(state) : nothing}
      </div>
    `;
  }

  private _renderCountdown(state: ClockState | null) {
    const countdown = state?.countdown;
    const draft = this._countdownDraft;
    return html`
      <div class="timer-display">${this._formatHms(countdown?.hours ?? draft.h, countdown?.minutes ?? draft.m, countdown?.seconds ?? draft.s)}</div>
      <div class="hms-inputs">
        ${this._renderHmsField("h", draft.h, 0, 23)}
        ${this._renderHmsField("m", draft.m, 0, 59)}
        ${this._renderHmsField("s", draft.s, 0, 59)}
      </div>
      <div class="button-row">
        <button type="button" class="secondary-action" @click=${() => this._command("countdown_reset", { h: draft.h, m: draft.m, s: draft.s })}>Reset</button>
        <button type="button" class="primary-action" @click=${() => this._command("countdown_run", { start: !countdown?.running })}>${countdown?.running ? "Stop" : "Start"}</button>
      </div>
    `;
  }

  private _renderStopwatch(state: ClockState | null) {
    const stopwatch = state?.stopwatch;
    return html`
      <div class="timer-display">${this._formatHms(stopwatch?.hours ?? 0, stopwatch?.minutes ?? 0, stopwatch?.seconds ?? 0)}</div>
      <div class="button-row">
        <button type="button" class="secondary-action" @click=${() => this._command("stopwatch_reset")}>Reset</button>
        <button type="button" class="primary-action" @click=${() => this._command("stopwatch_run", { start: !stopwatch?.running })}>${stopwatch?.running ? "Stop" : "Start"}</button>
      </div>
    `;
  }

  private _renderPomodoro(state: ClockState | null) {
    const minutes = state?.tomato?.minutes ?? this._tomatoDraft;
    return html`
      <div class="tomato-list">
        ${minutes.map(
          (m, i) => html`
            <span class="tomato-chip">
              ${m}m
              <button type="button" class="chip-remove" @click=${() => (this._tomatoDraft = minutes.filter((_, j) => j !== i))} aria-label="Remove">${mdiIcon("close")}</button>
            </span>
          `,
        )}
        ${minutes.length < 6
          ? html`<button type="button" class="chip-add" @click=${() => (this._tomatoDraft = [...minutes, 25])}>${mdiIcon("plus")}</button>`
          : nothing}
      </div>
      <button type="button" class="primary-action" @click=${() => this._command("tomato_set", { minutes })}>Set</button>
    `;
  }

  private _renderHmsField(unit: "h" | "m" | "s", value: number, min: number, max: number) {
    return html`
      <label class="hms-field">
        ${unit.toUpperCase()}
        <input
          type="number"
          min=${min}
          max=${max}
          .value=${String(value)}
          @input=${(e: Event) => (this._countdownDraft = { ...this._countdownDraft, [unit]: Math.max(min, Math.min(max, Number((e.target as HTMLInputElement).value))) })}
        />
      </label>
    `;
  }

  private _formatHms(h: number, m: number, s: number): string {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  private _renderScorePanel(state: ClockState | null) {
    const score = state?.scoreboard;
    return html`
      <div class="panel-section">
        <div class="score-row">
          <div class="score-side">
            <span class="score-label">Home</span>
            <span class="score-value">${score?.home ?? 0}</span>
            <div class="score-buttons">
              <button type="button" class="step-btn" @click=${() => this._adjustScore("home", -1)}>&minus;</button>
              <button type="button" class="step-btn" @click=${() => this._adjustScore("home", 1)}>&plus;</button>
            </div>
          </div>
          <div class="score-side">
            <span class="score-label">Away</span>
            <span class="score-value">${score?.away ?? 0}</span>
            <div class="score-buttons">
              <button type="button" class="step-btn" @click=${() => this._adjustScore("away", -1)}>&minus;</button>
              <button type="button" class="step-btn" @click=${() => this._adjustScore("away", 1)}>&plus;</button>
            </div>
          </div>
        </div>
        <div class="timer-display">${this._formatMs(score?.minutes ?? 0, score?.seconds ?? 0)}</div>
        <div class="button-row">
          <button type="button" class="secondary-action" @click=${() => this._command("scoreboard_set_time", { m: 10, s: 0, count_down: true })}>Reset time</button>
          <button type="button" class="primary-action" @click=${() => this._command("scoreboard_run", { start: !score?.running })}>${score?.running ? "Stop" : "Start"}</button>
        </div>
      </div>
    `;
  }

  private _formatMs(m: number, s: number): string {
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host {
      display: block;
    }
    .container {
      container-type: inline-size;
    }
    .root {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .hero-wrap {
      position: relative;
      aspect-ratio: 2 / 1;
      border-radius: calc(var(--ha-card-border-radius, 12px) - 2px);
      overflow: hidden;
      background: #050607;
    }
    .approximate-badge {
      position: absolute;
      left: 8px;
      bottom: 8px;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: var(--lu-radius-pill);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
    }
    .hero-corner {
      position: absolute;
      top: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .hero-corner.left {
      left: 8px;
    }
    button.hero-corner.right {
      right: 8px;
      top: 8px;
    }
    .chip {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      cursor: pointer;
    }
    .brightness-slider {
      width: 90px;
      accent-color: var(--lu-accent);
    }
    .status-pills {
      position: absolute;
      right: 8px;
      bottom: 8px;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: var(--lu-radius-pill);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      font-size: 12px;
      font-weight: 600;
    }
    .pill svg {
      width: 14px;
      height: 14px;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--lu-positive);
    }
    .pill.warn .dot {
      background: var(--lu-danger);
    }
    .pill.night {
      color: var(--lu-ink-2);
    }
    .controls {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .error {
      margin: 0;
      font-size: 13px;
      color: var(--lu-danger);
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .mode-panel {
      min-height: 0;
    }
    .panel-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .face-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
      gap: 6px;
      max-height: 132px;
      overflow-y: auto;
      padding: 2px;
    }
    .face-btn {
      min-height: 40px;
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }
    .face-btn {
      transition: transform 90ms var(--lu-ease, ease), background-color 150ms ease;
    }
    .face-btn:active {
      transform: scale(0.97);
    }
    .face-btn.selected {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      border-color: transparent;
      font-weight: 700;
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .swatch-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .swatch {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
    }
    .swatch.selected {
      border-color: var(--primary-text-color);
    }
    .color-input {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      overflow: hidden;
      padding: 0;
      background: none;
      cursor: pointer;
    }
    .effect-select {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 8px;
    }
    .field-label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .field-label input[type="range"] {
      accent-color: var(--lu-accent);
    }
    .text-input {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 12px;
      font-size: 15px;
      box-sizing: border-box;
    }
    .primary-action,
    .secondary-action {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      flex: 1;
    }
    .primary-action {
      border: none;
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      transition: transform 90ms var(--lu-ease, ease);
    }
    .primary-action:active:not(:disabled) {
      transform: scale(0.97);
    }
    .primary-action:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .secondary-action {
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--primary-text-color);
    }
    .button-row {
      display: flex;
      gap: 10px;
    }
    .carousel {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding: 2px;
      scroll-snap-type: x proximity;
    }
    .carousel-item {
      flex: none;
      width: 96px;
      border: 2px solid transparent;
      border-radius: var(--lu-radius-tile);
      background: none;
      cursor: pointer;
      scroll-snap-align: start;
      padding: 4px;
    }
    .carousel-item {
      transition: transform 90ms var(--lu-ease, ease), border-color 150ms ease;
    }
    .carousel-item:active {
      transform: scale(0.97);
    }
    .carousel-item.selected {
      border-color: var(--lu-accent);
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .carousel-thumb {
      display: block;
      aspect-ratio: 2 / 1;
      border-radius: var(--lu-radius-control);
      overflow: hidden;
    }
    .carousel-label {
      display: block;
      margin-top: 4px;
      font-size: 12px;
      color: var(--primary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .timer-display {
      font-size: 34px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
      color: var(--primary-text-color);
    }
    .hms-inputs {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .hms-field {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: 12px;
      color: var(--secondary-text-color);
      gap: 4px;
    }
    .hms-field input {
      width: 56px;
      min-height: var(--lu-target, 48px);
      text-align: center;
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 16px;
    }
    .tomato-list {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .tomato-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 6px 6px 12px;
      border-radius: var(--lu-radius-pill);
      background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      font-size: 13px;
      font-weight: 600;
    }
    .chip-remove,
    .chip-add {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--secondary-text-color);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .chip-add {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border: 1px dashed var(--divider-color);
      color: var(--primary-text-color);
    }
    .score-row {
      display: flex;
      gap: 16px;
    }
    .score-side {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .score-label {
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .score-value {
      font-size: 40px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .score-buttons {
      display: flex;
      gap: 8px;
    }
    .step-btn {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: 50%;
      border: 2px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 22px;
      cursor: pointer;
    }
    @container (min-width: 560px) {
      .root {
        flex-direction: row;
        align-items: flex-start;
      }
      .hero-wrap {
        flex: 1 1 58%;
      }
      .controls {
        flex: 1 1 42%;
      }
    }
  `,
  ];
}

customElements.define("iledclock-card", IledclockCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "iledclock-card",
  name: "iLedClock",
  description: "Control and preview an iLedClock 32x16 RGB BLE pixel clock.",
});

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-card": IledclockCard;
  }
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string }>;
  }
}
