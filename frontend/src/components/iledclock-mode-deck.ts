import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { ClockState, HomeAssistant, RenderResult, RenderSpec, ShowItem, StoredDesign } from "../types.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { CLOCK_COLORS, CLOCK_FACE_COUNT, CLOCK_FACES } from "../lib/clock-faces.ts";
import { TEXT_EFFECTS } from "../lib/text-effects.ts";
import { buildClockRenderSpec, buildTextRenderSpec, commandRequest, designsListRequest, renderRequest } from "../lib/ws-api.ts";
import { hexToRgb, quantizePreviewRgbLinear } from "../lib/color.ts";
import { designToFrames } from "../lib/design-codec.ts";
import { createFrame, GRID_HEIGHT, GRID_WIDTH } from "../lib/grid.ts";
import { showWithUndo } from "../lib/show-with-undo.ts";
import { navigateStudioRoute } from "../lib/route.ts";
import { describeWsError } from "../lib/ws-query.ts";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import "./iledclock-segmented-picker.ts";
import "./iledclock-stepper.ts";
import "./iledclock-hold-button.ts";
import "./iledclock-led-preview.ts";
import "./iledclock-art-tile.ts";
import "./iledclock-clock-face-thumb.ts";
import "./lu-pill-button.ts";
import "./lu-error.ts";

const MODE_OPTIONS = [
  { value: "clock", label: "Clock" },
  { value: "text", label: "Text" },
  { value: "art", label: "Art" },
  { value: "timer", label: "Timer" },
  { value: "score", label: "Score" },
] as const;
type Mode = (typeof MODE_OPTIONS)[number]["value"];
const TIMER_OPTIONS = [{ value: "countdown", label: "Countdown" }, { value: "stopwatch", label: "Stopwatch" }];
const TIMER_PRESETS = [1, 5, 10, 25] as const;
const TEXT_PREVIEW_DEBOUNCE_MS = 300;
const EMPTY_FRAME = createFrame(GRID_WIDTH, GRID_HEIGHT);

function decodeFrames(result: RenderResult): PixelFrame[] {
  return result.frames.map((encoded, index) => {
    const binary = atob(encoded);
    const pixels = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 3);
    for (let i = 0; i < Math.min(binary.length, pixels.length); i++) pixels[i] = binary.charCodeAt(i);
    return { width: GRID_WIDTH, height: GRID_HEIGHT, pixels, durationMs: result.delays[index] ?? 100 };
  });
}

/** Shared controls for Now and the Lovelace card; it owns mode state and all mode-specific behavior. */
export class IledclockModeDeck extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    state: { attribute: false },
    _mode: { state: true },
    _clockStyle: { state: true },
    _clockColor: { state: true },
    _hours24: { state: true },
    _showDate: { state: true },
    _text: { state: true },
    _textColor: { state: true },
    _textEffect: { state: true },
    _textSpeed: { state: true },
    _textFrames: { state: true },
    _textLoading: { state: true },
    _designs: { state: true },
    _designsLoading: { state: true },
    _designsError: { state: true },
    _selectedDesignId: { state: true },
    _timerType: { state: true },
    _timerMinutes: { state: true },
    _homeName: { state: true },
    _awayName: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare state: ClockState | null;
  declare _mode: Mode;
  declare _clockStyle: number;
  declare _clockColor: number;
  declare _hours24: boolean;
  declare _showDate: boolean;
  declare _text: string;
  declare _textColor: string;
  declare _textEffect: number;
  declare _textSpeed: number;
  declare _textFrames: PixelFrame[];
  declare _textLoading: boolean;
  declare _designs: StoredDesign[] | null;
  declare _designsLoading: boolean;
  declare _designsError: string | null;
  declare _selectedDesignId: string | null;
  declare _timerType: "countdown" | "stopwatch";
  declare _timerMinutes: number;
  declare _homeName: string;
  declare _awayName: string;
  declare _busy: string | null;
  declare _error: string | null;

  private _designsEntry = "";
  private _designsRevision = 0;
  private _textTimer: ReturnType<typeof setTimeout> | undefined;
  private _textPreviewRevision = 0;
  private _modeResizeObserver: ResizeObserver | null = null;

  constructor() {
    super();
    this._mode = "clock";
    this._clockStyle = 1;
    this._clockColor = 6;
    this._hours24 = true;
    this._showDate = false;
    this._text = "";
    this._textColor = "#ffffff";
    this._textEffect = 1;
    this._textSpeed = 80;
    this._textFrames = [EMPTY_FRAME];
    this._textLoading = false;
    this._designs = null;
    this._designsLoading = false;
    this._designsError = null;
    this._selectedDesignId = null;
    this._timerType = "countdown";
    this._timerMinutes = 5;
    this._homeName = "Home";
    this._awayName = "Away";
    this._busy = null;
    this._error = null;
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("entryId") && this.entryId !== this._designsEntry) {
      this._designsEntry = this.entryId ?? "";
      this._designs = null;
      this._selectedDesignId = null;
      this._designsRevision++;
      this._designsLoading = false;
    }
  }

  protected updated(changed: PropertyValues): void {
    if ((changed.has("_mode") && this._mode === "art") || (changed.has("entryId") && this._mode === "art")) void this._loadDesigns();
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof ResizeObserver === "undefined") return;
    this._modeResizeObserver = new ResizeObserver((entries) => {
      this.toggleAttribute("compact", (entries[0]?.contentRect.width ?? 0) < 360);
    });
    this._modeResizeObserver.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._modeResizeObserver?.disconnect();
    this._modeResizeObserver = null;
    clearTimeout(this._textTimer);
    this._textPreviewRevision++;
  }

  private async _loadDesigns(): Promise<void> {
    const entryId = this.entryId;
    if (!entryId || !this.hass?.callWS) return;
    const revision = ++this._designsRevision;
    this._designsLoading = true;
    this._designsError = null;
    try {
      const designs = await this.hass.callWS<StoredDesign[]>(designsListRequest(entryId));
      if (revision !== this._designsRevision || entryId !== this.entryId) return;
      this._designs = designs;
      if (!this._selectedDesignId) this._selectedDesignId = this._recentDesigns()[0]?.id ?? this._favoriteDesigns()[0]?.id ?? null;
    } catch (error) {
      if (revision !== this._designsRevision || entryId !== this.entryId) return;
      this._designs = [];
      this._designsError = describeWsError(error);
    } finally {
      if (revision === this._designsRevision) this._designsLoading = false;
    }
  }

  private _recentDesigns(): StoredDesign[] {
    return [...(this._designs ?? [])].sort((a, b) => b.updated - a.updated).slice(0, 6);
  }

  private _favoriteDesigns(): StoredDesign[] {
    return (this._designs ?? []).filter((design) => design.tags?.some((tag) => /^(favorite|favourite)$/i.test(tag.trim()))).slice(0, 6);
  }

  private async _show(item: ShowItem, title: string): Promise<void> {
    if (!this.entryId || !this.hass?.callWS || this._busy) return;
    this._busy = "show";
    this._error = null;
    await showWithUndo(this, this.hass, this.entryId, item, title);
    this._busy = null;
  }

  private async _command(command: string, params: Record<string, unknown> = {}): Promise<boolean> {
    if (!this.entryId || !this.hass?.callWS || this._busy) return false;
    this._busy = command;
    this._error = null;
    try {
      await this.hass.callWS(commandRequest(this.entryId, command, params));
      return true;
    } catch (error) {
      this._error = describeWsError(error);
      return false;
    } finally {
      this._busy = null;
    }
  }

  private _setMode(mode: Mode): void {
    this._mode = mode;
    this._error = null;
  }

  private _onModeKeydown(event: KeyboardEvent, index: number): void {
    const last = MODE_OPTIONS.length - 1;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % MODE_OPTIONS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + last) % MODE_OPTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    const option = MODE_OPTIONS[next];
    if (!option) return;
    this._setMode(option.value);
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLButtonElement>(`[data-mode-index="${next}"]`)?.focus());
  }

  private _clockSpec(): RenderSpec {
    return buildClockRenderSpec(this._clockStyle, CLOCK_COLORS[this._clockColor]?.rgb ?? [255, 255, 255], this._hours24, CLOCK_FACE_COUNT);
  }

  private _showClock(): void {
    if (this._showDate) {
      const dateItem = { spec: { type: "date", color: CLOCK_COLORS[this._clockColor]?.rgb ?? [255, 255, 255] } } as unknown as ShowItem;
      void this._show(dateItem, "Date");
      return;
    }
    void this._show({ spec: this._clockSpec() }, "Clock · style " + this._clockStyle);
  }

  private _scheduleTextPreview(): void {
    this._textPreviewRevision++;
    clearTimeout(this._textTimer);
    if (!this.entryId || !this.hass?.callWS) {
      this._textLoading = false;
      this._textFrames = [EMPTY_FRAME];
      return;
    }
    this._textLoading = true;
    this._textTimer = setTimeout(() => {
      this._textTimer = undefined;
      void this._previewText();
    }, TEXT_PREVIEW_DEBOUNCE_MS);
  }

  private _onTextChange(event: Event): void {
    this._text = (event.target as HTMLInputElement).value;
    this._scheduleTextPreview();
  }

  private async _previewText(): Promise<void> {
    const revision = ++this._textPreviewRevision;
    const entryId = this.entryId;
    const hass = this.hass;
    if (!entryId || !hass?.callWS) {
      this._textLoading = false;
      return;
    }
    const spec = buildTextRenderSpec(this._text, hexToRgb(this._textColor), { effect: String(this._textEffect), speed: this._textSpeed });
    if (!spec) {
      this._textFrames = [EMPTY_FRAME];
      this._textLoading = false;
      return;
    }
    this._textLoading = true;
    try {
      const result = await hass.callWS<RenderResult>(renderRequest(entryId, spec));
      if (revision !== this._textPreviewRevision || entryId !== this.entryId) return;
      this._textFrames = decodeFrames(result).slice(0, 1);
      if (!this._textFrames.length) this._textFrames = [EMPTY_FRAME];
    } catch {
      if (revision === this._textPreviewRevision && entryId === this.entryId) this._textFrames = [EMPTY_FRAME];
    } finally {
      if (revision === this._textPreviewRevision) this._textLoading = false;
    }
  }

  private _selectColor(index: number): void {
    this._clockColor = index;
  }

  private _showText(): void {
    const spec = buildTextRenderSpec(this._text, hexToRgb(this._textColor), { effect: String(this._textEffect), speed: this._textSpeed });
    if (spec) void this._show({ spec }, "Text · " + this._text);
  }

  private _showDesign(design: StoredDesign): void {
    this._selectedDesignId = design.id;
    void this._show({ design_id: design.id }, design.name);
  }

  private _selectDesign(event: CustomEvent<{ itemId: string }>): void {
    const design = this._designs?.find((item) => item.id === event.detail.itemId);
    if (design) this._showDesign(design);
  }

  private _openLibrary(): void {
    navigateStudioRoute({ destination: "library" });
  }

  private async _startCountdown(): Promise<void> {
    const h = Math.floor(this._timerMinutes / 60);
    const m = this._timerMinutes % 60;
    if (await this._command("countdown_reset", { h, m, s: 0 })) await this._command("countdown_run", { start: true });
  }

  private _toggleTimer(): void {
    if (this._timerType === "countdown") {
      if (this.state?.countdown?.running) void this._command("countdown_run", { start: false });
      else void this._startCountdown();
    } else {
      void this._command("stopwatch_run", { start: !this.state?.stopwatch?.running });
    }
  }

  private _resetTimer(): void {
    if (this._timerType === "countdown") {
      void this._command("countdown_reset", { h: Math.floor(this._timerMinutes / 60), m: this._timerMinutes % 60, s: 0 });
    } else {
      void this._command("stopwatch_reset");
    }
  }

  private _adjustScore(side: "home" | "away", delta: number): void {
    const score = this.state?.scoreboard;
    const home = Math.max(0, Math.min(999, (score?.home ?? 0) + (side === "home" ? delta : 0)));
    const away = Math.max(0, Math.min(999, (score?.away ?? 0) + (side === "away" ? delta : 0)));
    void this._command("scoreboard_set_score", { home, away });
  }

  private async _resetScore(): Promise<void> {
    if (await this._command("scoreboard_set_score", { home: 0, away: 0 })) await this._command("scoreboard_set_time", { m: 10, s: 0, count_down: true });
  }

  private _renderClockMode() {
    const color = CLOCK_COLORS[this._clockColor]?.rgb ?? [255, 255, 255];
    return html`<div class="panel-content">
      <div class="control-label"><h3>Clock face</h3><span>Choose a built-in style</span></div>
      <div class="faces" role="group" aria-label="Clock face previews">
        ${CLOCK_FACES.map((face) => html`<iledclock-clock-face-thumb .hass=${this.hass} .entryId=${this.entryId} .faceStyle=${face.style} .color=${color} .hours24=${this._hours24} ?selected=${face.style === this._clockStyle} @face-selected=${(event: CustomEvent<{ style: number }>) => (this._clockStyle = event.detail.style)}></iledclock-clock-face-thumb>`)}
      </div>
      <div class="color-row" role="group" aria-label="Clock colour">
        ${CLOCK_COLORS.map((item) => html`<button type="button" class="swatch ${item.index === this._clockColor ? "selected" : ""}" style=${"background:rgb(" + quantizePreviewRgbLinear(item.rgb).join(",") + ")"} aria-label=${item.label} aria-pressed=${item.index === this._clockColor ? "true" : "false"} @click=${() => this._selectColor(item.index)}></button>`)}
      </div>
      <iledclock-segmented-picker group-label="Hour format" content-fit .options=${[{ value: "24", label: "24-hour" }, { value: "12", label: "12-hour" }]} .value=${this._hours24 ? "24" : "12"} @option-selected=${(event: CustomEvent<{ value: string }>) => (this._hours24 = event.detail.value === "24")}></iledclock-segmented-picker>
      <button type="button" class="toggle-row" role="switch" aria-checked=${this._showDate ? "true" : "false"} @click=${() => (this._showDate = !this._showDate)}><span>Show date instead of time</span><span class="switch ${this._showDate ? "on" : ""}"></span></button>
      <p class="hint">The clock can show a date program or a time face, but its firmware does not layer the date over a face.</p>
      <lu-pill-button variant="primary" label=${this._showDate ? "Show date" : "Show clock"} icon="mdi:television-play" ?disabled=${!this.entryId || this._busy !== null} ?loading=${this._busy === "show"} @lu-press=${this._showClock}></lu-pill-button>
    </div>`;
  }

  private _renderTextMode() {
    const spec = buildTextRenderSpec(this._text, hexToRgb(this._textColor), { effect: String(this._textEffect), speed: this._textSpeed });
    return html`<div class="panel-content">
      <label class="field"><span>Message</span><input class="text-input" type="text" maxlength="64" .value=${this._text} placeholder="Type a message" @input=${this._onTextChange}></label>
      <div class="color-row text-settings">
        <label class="field color-field"><span>Colour</span><input type="color" .value=${this._textColor} @input=${(event: Event) => { this._textColor = (event.target as HTMLInputElement).value; this._scheduleTextPreview(); }}></label>
        <label class="field effect-field"><span>Effect</span><select .value=${String(this._textEffect)} @change=${(event: Event) => { this._textEffect = Number((event.target as HTMLSelectElement).value); this._scheduleTextPreview(); }}>${TEXT_EFFECTS.map((effect) => html`<option value=${effect.mode}>${effect.label}</option>`)}</select></label>
      </div>
      <label class="field slider-field"><span>Speed <strong>${this._textSpeed}</strong></span><input type="range" min="0" max="255" .value=${String(this._textSpeed)} @input=${(event: Event) => { this._textSpeed = Number((event.target as HTMLInputElement).value); this._scheduleTextPreview(); }}></label>
      <div class="preview-wrap"><iledclock-led-preview context="thumb" .frames=${this._textFrames} .playing=${false} label="Text preview"></iledclock-led-preview>${this._textLoading ? html`<span class="preview-state" role="status">Updating preview…</span>` : nothing}</div>
      <lu-pill-button variant="primary" label="Show text" icon="mdi:send" ?disabled=${!spec || !this.entryId || this._busy !== null} ?loading=${this._busy === "show"} @lu-press=${this._showText}></lu-pill-button>
    </div>`;
  }

  private _renderDesignTile(design: StoredDesign) {
    const frames = designToFrames(design);
    return html`<iledclock-art-tile item-id=${design.id} aspect="design" title=${design.name} subtitle=${design.kind === "animation" ? "Animated design" : "Saved design"} .frames=${frames} .delays=${design.delays} @tile-selected=${this._selectDesign}></iledclock-art-tile>`;
  }

  private _renderDesignRow(title: string, designs: StoredDesign[]) {
    if (!designs.length) return nothing;
    return html`<section class="design-row"><h3>${title}</h3><div class="designs">${designs.map((design) => this._renderDesignTile(design))}</div></section>`;
  }

  private _renderArtMode() {
    const favorites = this._favoriteDesigns();
    const recent = this._recentDesigns();
    const selected = this._designs?.find((design) => design.id === this._selectedDesignId);
    return html`<div class="panel-content">
      ${this._designsLoading ? html`<p class="hint" role="status">Loading saved designs…</p>` : nothing}
      ${this._designsError ? html`<lu-error message=${this._designsError} @retry=${() => void this._loadDesigns()}></lu-error>` : nothing}
      ${this._renderDesignRow("Favorites", favorites)}
      ${this._renderDesignRow("Recent designs", recent)}
      ${!this._designsLoading && !this._designsError && !recent.length ? html`<p class="hint">No saved designs yet. Create one in Pixel Studio.</p>` : nothing}
      <div class="button-row">
        <lu-pill-button variant="primary" label="Show on clock" icon="mdi:television-play" ?disabled=${!selected || !this.entryId || this._busy !== null} ?loading=${this._busy === "show"} @lu-press=${() => selected && this._showDesign(selected)}></lu-pill-button>
        <button type="button" class="library-link" @click=${this._openLibrary}>Open Library</button>
      </div>
    </div>`;
  }

  private _renderTimerMode() {
    const countdown = this.state?.countdown;
    const stopwatch = this.state?.stopwatch;
    const running = this._timerType === "countdown" ? Boolean(countdown?.running) : Boolean(stopwatch?.running);
    const display = this._timerType === "countdown" ? countdown : stopwatch;
    const hh = display?.hours ?? (this._timerType === "countdown" ? Math.floor(this._timerMinutes / 60) : 0);
    const mm = display?.minutes ?? (this._timerType === "countdown" ? this._timerMinutes % 60 : 0);
    const ss = display?.seconds ?? 0;
    return html`<div class="panel-content">
      <iledclock-segmented-picker group-label="Timer type" content-fit .options=${TIMER_OPTIONS} .value=${this._timerType} @option-selected=${(event: CustomEvent<{ value: string }>) => (this._timerType = event.detail.value as "countdown" | "stopwatch")}></iledclock-segmented-picker>
      ${this._timerType === "countdown" ? html`<div class="preset-row" aria-label="Countdown presets">${TIMER_PRESETS.map((minutes) => html`<button type="button" class="preset ${minutes === this._timerMinutes ? "selected" : ""}" aria-pressed=${minutes === this._timerMinutes ? "true" : "false"} @click=${() => (this._timerMinutes = minutes)}>${minutes} min</button>`)}</div>
        <div class="custom-time"><span class="field-title">Custom duration · minutes</span><iledclock-stepper label="minutes" min="1" max="1439" step="1" .value=${this._timerMinutes} @value-selected=${(event: CustomEvent<{ value: number }>) => (this._timerMinutes = event.detail.value)}></iledclock-stepper></div>` : nothing}
      <p class="timer-readout" aria-label=${(this._timerType === "countdown" ? "Countdown" : "Stopwatch") + " time"}>${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}</p>
      <div class="button-row">
        <button type="button" class="secondary-button" ?disabled=${!this.entryId || this._busy !== null} @click=${this._resetTimer}>Reset</button>
        <lu-pill-button variant="primary" label=${running ? "Pause" : (this._timerType === "countdown" ? "Start timer" : "Start stopwatch")} icon=${running ? "mdi:pause" : "mdi:play"} ?disabled=${!this.entryId || this._busy !== null} ?loading=${this._busy !== null} @lu-press=${this._toggleTimer}></lu-pill-button>
      </div>
    </div>`;
  }

  private _renderScoreMode() {
    const score = this.state?.scoreboard;
    const running = Boolean(score?.running);
    return html`<div class="panel-content">
      <div class="scoreboard">
        ${this._renderScoreSide("home", this._homeName, score?.home ?? 0)}
        <span class="versus" aria-hidden="true">–</span>
        ${this._renderScoreSide("away", this._awayName, score?.away ?? 0)}
      </div>
      <p class="hint local-names">Team names are control labels; the clock displays Home and Away.</p>
      <p class="timer-readout small">${String(score?.minutes ?? 0).padStart(2, "0")}:${String(score?.seconds ?? 0).padStart(2, "0")}</p>
      <div class="button-row">
        <iledclock-hold-button label="Hold to reset scoreboard" complete-label="Scoreboard reset" ?disabled=${!this.entryId || this._busy !== null} @confirmed=${this._resetScore}></iledclock-hold-button>
        <lu-pill-button variant="primary" label=${running ? "Pause scoreboard" : "Start scoreboard"} icon=${running ? "mdi:pause" : "mdi:play"} ?disabled=${!this.entryId || this._busy !== null} @lu-press=${() => void this._command("scoreboard_run", { start: !running })}></lu-pill-button>
      </div>
    </div>`;
  }

  private _renderScoreSide(side: "home" | "away", name: string, value: number) {
    return html`<div class="score-side">
      <label class="name-field"><span>Team name</span><input type="text" maxlength="16" .value=${name} @input=${(event: Event) => { const value = (event.target as HTMLInputElement).value; if (side === "home") this._homeName = value; else this._awayName = value; }}></label>
      <strong class="score-value">${value}</strong>
      <div class="score-stepper"><button type="button" aria-label=${"Decrease " + name + " score"} ?disabled=${value <= 0 || this._busy !== null} @click=${() => this._adjustScore(side, -1)}>−</button><button type="button" aria-label=${"Increase " + name + " score"} ?disabled=${value >= 999 || this._busy !== null} @click=${() => this._adjustScore(side, 1)}>+</button></div>
    </div>`;
  }

  render() {
    const modePanel = this._mode === "clock" ? this._renderClockMode() : this._mode === "text" ? this._renderTextMode() : this._mode === "art" ? this._renderArtMode() : this._mode === "timer" ? this._renderTimerMode() : this._renderScoreMode();
    return html`<section class="deck" aria-label="Clock controls">
      <header class="deck-heading"><div><h2>Choose a mode</h2><p>Set up what appears on your clock.</p></div></header>
      <div class="mode-tabs" role="tablist" aria-label="Mode">${MODE_OPTIONS.map((option, index) => html`<button type="button" class="mode-tab ${option.value === this._mode ? "selected" : ""}" role="tab" aria-selected=${option.value === this._mode ? "true" : "false"} tabindex=${option.value === this._mode ? "0" : "-1"} data-mode-index=${index} @click=${() => this._setMode(option.value)} @keydown=${(event: KeyboardEvent) => this._onModeKeydown(event, index)}>${option.label}</button>`)}</div>
      <label class="mode-select-label"><span class="visually-hidden">Choose a mode</span><select class="mode-select" aria-label="Choose a mode" .value=${this._mode} @change=${(event: Event) => this._setMode((event.target as HTMLSelectElement).value as Mode)}>${MODE_OPTIONS.map((option) => html`<option value=${option.value}>${option.label}</option>`)}</select></label>
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      <div class="mode-panel">${modePanel}</div>
    </section>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .deck { display: grid; gap: var(--lu-space-3); min-width: 0; padding: var(--lu-space-4); color: var(--lu-ink); background: var(--lu-card); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); box-shadow: var(--lu-highlight-rest); }
    .deck-heading h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); letter-spacing: -0.01em; }
    .deck-heading p { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .mode-tabs { display: flex; min-width: 0; gap: var(--lu-space-1); overflow-x: auto; padding: 2px; scrollbar-width: thin; }
    .mode-tab { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: var(--lu-glass-raised); font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .mode-tab.selected { border-color: var(--lu-accent); color: var(--lu-accent-ink); background: var(--lu-accent); }
    .mode-tab:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .mode-select-label { display: none; }
    .mode-select { box-sizing: border-box; width: 100%; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-card); font: 500 var(--lu-type-label)/1.2 var(--lu-font); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    :host([compact]) .mode-tabs { display: none; }
    :host([compact]) .mode-select-label { display: block; }
    .mode-panel, .panel-content { min-width: 0; }
    .panel-content { display: grid; gap: var(--lu-space-3); }
    .control-label { display: flex; align-items: baseline; justify-content: space-between; gap: var(--lu-space-2); }
    .control-label h3, .design-row h3 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-label)/1.3 var(--lu-font); }
    .control-label span, .hint { color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .faces { display: flex; gap: var(--lu-space-2); overflow-x: auto; padding: var(--lu-space-1) 2px var(--lu-space-2); scroll-snap-type: x proximity; scrollbar-width: thin; }
    iledclock-clock-face-thumb { scroll-snap-align: start; }
    .color-row { display: flex; align-items: end; flex-wrap: wrap; gap: var(--lu-space-2); }
    .swatch { flex: 0 0 var(--lu-target); width: var(--lu-target); height: var(--lu-target); border: 2px solid transparent; border-radius: var(--lu-radius-pill); cursor: pointer; }
    .swatch.selected { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .swatch:focus-visible, .preset:focus-visible, .secondary-button:focus-visible, .library-link:focus-visible, .score-stepper button:focus-visible, .toggle-row:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-3); min-height: var(--lu-target); padding: 0; border: 0; color: var(--lu-ink); background: transparent; text-align: left; font: 500 var(--lu-type-label)/1.3 var(--lu-font); cursor: pointer; }
    .switch { position: relative; flex: none; width: 48px; height: 28px; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); transition: background-color var(--lu-motion-label) var(--lu-ease); }
    .switch::after { position: absolute; inset: 4px auto auto 4px; width: 20px; height: 20px; border-radius: var(--lu-radius-pill); background: var(--lu-card); content: ""; transition: transform var(--lu-motion-label) var(--lu-ease); }
    .switch.on { background: var(--lu-accent); }
    .switch.on::after { transform: translateX(20px); }
    .hint { margin: 0; }
    .field { display: grid; gap: var(--lu-space-1); min-width: 0; color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.3 var(--lu-font); }
    .text-input, .field select, .name-field input { box-sizing: border-box; width: 100%; min-width: 0; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-card); font: 400 var(--lu-type-body)/1.3 var(--lu-font); }
    .text-settings { align-items: stretch; }
    .color-field { flex: 1 1 7rem; }
    .color-field input { width: 100%; min-height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-card); }
    .effect-field { flex: 2 1 9rem; }
    .slider-field input { width: 100%; accent-color: var(--lu-accent); }
    .slider-field strong { float: right; color: var(--lu-ink); font-variant-numeric: tabular-nums; }
    .preview-wrap { position: relative; min-width: 0; }
    .preview-state { position: absolute; right: var(--lu-space-2); bottom: var(--lu-space-2); padding: var(--lu-space-1) var(--lu-space-2); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: var(--lu-card); font: 400 var(--lu-type-caption)/1.2 var(--lu-font); }
    iledclock-led-preview { width: 100%; }
    .design-row { display: grid; gap: var(--lu-space-2); }
    .designs { display: grid; grid-auto-columns: minmax(112px, 1fr); grid-auto-flow: column; gap: var(--lu-space-3); overflow-x: auto; padding: 1px 2px var(--lu-space-2); scroll-snap-type: x proximity; }
    .designs iledclock-art-tile { width: 112px; scroll-snap-align: start; }
    .button-row { display: flex; flex-wrap: wrap; gap: var(--lu-space-2); align-items: center; }
    .button-row lu-pill-button { flex: 1 1 10rem; }
    .library-link, .secondary-button { display: inline-flex; align-items: center; justify-content: center; min-width: var(--lu-target); min-height: var(--lu-target); padding: 0 var(--lu-space-4); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: var(--lu-glass-raised); font: 500 var(--lu-type-label)/1.2 var(--lu-font); text-decoration: none; cursor: pointer; }
    .library-link { flex: 1 1 8rem; }
    .preset-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--lu-space-2); }
    .preset { min-width: 0; min-height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: var(--lu-glass-raised); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); cursor: pointer; }
    .preset.selected { border-color: var(--lu-accent); color: var(--lu-accent-ink); background: var(--lu-accent); }
    .custom-time { display: grid; grid-template-columns: minmax(0, 1fr) minmax(8rem, 1fr); align-items: center; gap: var(--lu-space-2); }
    .field-title { color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.3 var(--lu-font); }
    .timer-readout { margin: 0; color: var(--lu-ink); text-align: center; font: 400 var(--lu-type-display)/1.2 var(--lu-font); font-variant-numeric: tabular-nums; }
    .timer-readout.small { font-size: var(--lu-type-title); }
    .scoreboard { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: var(--lu-space-2); }
    .score-side { display: grid; min-width: 0; gap: var(--lu-space-2); justify-items: center; }
    .name-field { display: grid; gap: var(--lu-space-1); width: 100%; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.2 var(--lu-font); text-align: center; }
    .name-field input { min-height: var(--lu-target); padding: 0 var(--lu-space-2); text-align: center; }
    .score-value { color: var(--lu-ink); font: 500 var(--lu-type-title)/1.1 var(--lu-font); font-variant-numeric: tabular-nums; }
    .score-stepper { display: flex; gap: var(--lu-space-2); }
    .score-stepper button { min-width: var(--lu-target); min-height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: var(--lu-glass-raised); font: 500 var(--lu-type-title)/1 var(--lu-font); cursor: pointer; }
    .score-stepper button:disabled { opacity: .5; }
    .versus { color: var(--lu-ink-3); font: 400 var(--lu-type-title)/1 var(--lu-font); }
    .local-names { text-align: center; }
    iledclock-hold-button, .button-row iledclock-hold-button { flex: 1 1 10rem; min-width: 0; }
    .error { margin: 0; padding: var(--lu-space-2) var(--lu-space-3); border-radius: var(--lu-radius-control); color: var(--lu-danger); background: var(--lu-tile); font: 400 var(--lu-type-label)/1.4 var(--lu-font); }
    @container (max-width: 359px) { .deck { padding: var(--lu-space-3); } .custom-time { grid-template-columns: 1fr; } .preset-row { gap: var(--lu-space-1); } }
    @media (prefers-reduced-motion: reduce) { .switch, .switch::after { transition: none; } }
  `];
}

customElements.define("iledclock-mode-deck", IledclockModeDeck);

declare global { interface HTMLElementTagNameMap { "iledclock-mode-deck": IledclockModeDeck; } }
