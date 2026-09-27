import { navigateStudioRoute } from "../lib/route.ts";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { ClockStateEnvelope, HomeAssistant, RenderResult, StoredDesign, UploadProgressEvent } from "../types.ts";
import type { StudioRoute } from "../lib/route.ts";
import { designToFrames } from "../lib/design-codec.ts";
import { brightnessToPercent, percentToWireBrightness } from "../lib/brightness.ts";
import { clockFacePreviewFrames } from "../lib/clock-faces.ts";
import { createFrame, GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "../lib/grid.ts";
import { renderRequest, commandRequest, designsListRequest } from "../lib/ws-api.ts";
import { showItemFromDescriptor, type ShowHistoryDescriptor } from "../lib/studio-history.ts";
import { showWithUndo } from "../lib/show-with-undo.ts";

import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import "./iledclock-led-preview.ts";
import "./lu-empty.ts";
import "./lu-error.ts";
import "./lu-skeleton.ts";
import "./lu-status-sheet.ts";
import "./lu-section.ts";
import "./lu-pill-button.ts";
import "./iledclock-mode-deck.ts";

interface NowDescriptor extends ShowHistoryDescriptor {
  style?: number;
  color?: readonly number[];
  hours24?: boolean;
  h24?: boolean;
  text?: string;
  speed?: number;
  effect?: string;
  frames?: string[];
  delays?: number[];
}
interface NowEnvelope extends ClockStateEnvelope {
  now_showing?: NowDescriptor | null;
  history?: NowDescriptor[];
}
type NowSubscribeEvent = (NowEnvelope & { type?: undefined }) | (UploadProgressEvent & { upload?: { done: number; total: number } | null });
const EMPTY_FRAME = createFrame(GRID_WIDTH, GRID_HEIGHT);
const EMPTY_FRAMES: PixelFrame[] = [EMPTY_FRAME];

function decodeFrames(result: Pick<RenderResult, "frames" | "delays">): PixelFrame[] {
  return result.frames.map((encoded, index) => {
    const binary = atob(encoded);
    const pixels = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 3);
    for (let byte = 0; byte < Math.min(binary.length, pixels.length); byte++) pixels[byte] = binary.charCodeAt(byte);
    return { width: GRID_WIDTH, height: GRID_HEIGHT, pixels, durationMs: result.delays[index] ?? 100 };
  });
}

function descriptorKey(descriptor: NowDescriptor | null | undefined): string {
  if (!descriptor) return "empty";
  return [descriptor.kind, descriptor.shown_at ?? "", descriptor.design_id ?? "", descriptor.style ?? "", descriptor.text ?? "", descriptor.speed ?? "", JSON.stringify(descriptor.color ?? null), descriptor.h24 ?? "", descriptor.hours24 ?? "", descriptor.effect ?? "", descriptor.frames?.length ?? 0].join("|");
}

function timeRange(state: ClockStateEnvelope["state"] | null): string {
  const night = state?.night_mode;
  if (!night?.enabled) return "Night mode off";
  const start = String(night.start_h).padStart(2, "0") + ":" + String(night.start_m).padStart(2, "0");
  const end = String(night.end_h).padStart(2, "0") + ":" + String(night.end_m).padStart(2, "0");
  return "Night mode " + start + "–" + end;
}

function historyUnavailable(item: NowDescriptor): string | null {
  if (item.unavailable) return typeof item.reason === "string" ? item.reason : "This item is no longer available.";
  return showItemFromDescriptor(item) ? null : "This item cannot be shown again.";
}

export class IledclockDestNow extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    route: { attribute: false },
    narrow: { type: Boolean },
    _envelope: { state: true },
    _frames: { state: true },
    _delays: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _previewLoading: { state: true },
    _previewAvailable: { state: true },
    _previewError: { state: true },
    _upload: { state: true },
    _busy: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare route: StudioRoute;
  declare narrow: boolean;
  declare _envelope: NowEnvelope | null;
  declare _frames: PixelFrame[];
  declare _delays: number[];
  declare _loading: boolean;
  declare _error: string | null;
  declare _previewLoading: boolean;
  declare _previewAvailable: boolean;
  declare _previewError: string | null;
  declare _upload: (UploadProgressEvent & { upload?: { done: number; total: number } | null }) | null;
  declare _busy: string | null;

  private _unsubscribe: (() => Promise<void>) | null = null;
  private _lastEntryId: string | undefined;
  private _lastConnection: HomeAssistant["connection"] | undefined;
  private _previewRevision = 0;
  private _subscriptionRevision = 0;
  private _previewKey = "";

  constructor() {
    super();
    this.narrow = false;
    this._envelope = null;
    this._frames = [];
    this._delays = [];
    this._loading = false;
    this._error = null;
    this._previewLoading = false;
    this._previewAvailable = false;
    this._previewError = null;
    this._upload = null;
    this._busy = null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.entryId && this.entryId === this._lastEntryId && !this._unsubscribe) {
      this._lastConnection = this.hass?.connection;
      void this._load(this.entryId);
    }
  }

  protected willUpdate(changed: PropertyValues): void {
    const entryChanged = changed.has("entryId") && this.entryId !== this._lastEntryId;
    const connection = this.hass?.connection;
    const connectionChanged = changed.has("hass") && connection !== this._lastConnection;
    if (entryChanged || connectionChanged) {
      this._lastEntryId = this.entryId;
      this._lastConnection = connection;
      void this._load(this.entryId);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._unsubscribe) void this._unsubscribe();
    this._unsubscribe = null;
    this._subscriptionRevision++;
    this._previewRevision++;
    this._upload = null;
  }

  private _setFrames(frames: PixelFrame[]): void {
    this._frames = frames.length ? frames : EMPTY_FRAMES;
    this._delays = this._frames.map((frame) => frame.durationMs);
  }

  private async _load(entryId: string | undefined): Promise<void> {
    if (this._unsubscribe) {
      void this._unsubscribe();
      this._unsubscribe = null;
    }
    const revision = ++this._previewRevision;
    const subscriptionRevision = ++this._subscriptionRevision;
    this._loading = false;
    this._envelope = null;
    this._setFrames(EMPTY_FRAMES);
    this._previewKey = "";
    this._error = null;
    this._previewError = null;
    this._previewAvailable = false;
    this._previewLoading = false;
    this._upload = null;
    if (!entryId || !this.hass?.callWS) return;
    this._loading = true;
    try {
      const envelope = await this.hass.callWS<NowEnvelope>({ type: "iledclock/state", entry_id: entryId });
      if (entryId !== this.entryId || revision !== this._previewRevision) return;
      this._envelope = envelope;
      if (this.hass.connection) {
        const unsubscribe = await this.hass.connection.subscribeMessage<NowSubscribeEvent>((event) => {
          if (entryId !== this.entryId || subscriptionRevision !== this._subscriptionRevision) return;
          if (event.type === "upload") {
            this._upload = event.upload === null || event.state === "done" || event.state === "error" ? null : event;
            return;
          }
          const previous = descriptorKey(this._envelope?.now_showing);
          this._envelope = event;
          if (descriptorKey(event.now_showing) !== previous) void this._loadPreview(event.now_showing ?? null);
        }, { type: "iledclock/subscribe", entry_id: entryId });
        if (entryId !== this.entryId || subscriptionRevision !== this._subscriptionRevision || revision !== this._previewRevision || !this.isConnected) {
          void unsubscribe();
          return;
        }
        this._unsubscribe = unsubscribe;
      }
      await this._loadPreview(envelope.now_showing ?? null);
    } catch (error) {
      if (entryId === this.entryId) this._error = error instanceof Error ? error.message : "Could not load clock status.";
    } finally {
      if (entryId === this.entryId) this._loading = false;
    }
  }

  private async _loadPreview(descriptor: NowDescriptor | null): Promise<void> {
    const key = descriptorKey(descriptor);
    if (key === this._previewKey) return;
    this._previewKey = key;
    const revision = ++this._previewRevision;
    const entryId = this.entryId;
    this._previewError = null;
    this._previewAvailable = false;
    if (!descriptor || !entryId || !this.hass?.callWS) {
      this._setFrames(EMPTY_FRAMES);
      this._previewLoading = false;
      return;
    }
    this._previewLoading = true;
    try {
      let frames: PixelFrame[];
      if (descriptor.kind === "design" && descriptor.design_id) {
        const designs = await this.hass.callWS<StoredDesign[]>(designsListRequest(entryId));
        if (revision !== this._previewRevision) return;
        const design = designs.find((item) => item.id === descriptor.design_id);
        if (!design) throw new Error("This saved design is no longer in the library.");
        frames = designToFrames(design);
      } else if (descriptor.kind === "clock") {
        const style = Number(descriptor.style) || 1;
        const color = Array.isArray(descriptor.color) && descriptor.color.length >= 3 ? descriptor.color.slice(0, 3).map(Number) as [number, number, number] : [255, 255, 255] as [number, number, number];
        const hours24 = descriptor.h24 ?? descriptor.hours24 !== false;
        const result = await this.hass.callWS<RenderResult>(renderRequest(entryId, { type: "clock", style, color, h24: hours24 }));
        frames = result.approximate ? clockFacePreviewFrames(style, color, hours24) : decodeFrames(result);
      } else if (descriptor.kind === "image" && Array.isArray(descriptor.frames) && descriptor.frames.length > 0) {
        frames = decodeFrames({ frames: descriptor.frames, delays: descriptor.delays ?? [] });
      } else if (descriptor.kind === "text" && typeof descriptor.text === "string") {
        const color = Array.isArray(descriptor.color) && descriptor.color.length >= 3 ? descriptor.color.slice(0, 3).map(Number) as [number, number, number] : [255, 255, 255] as [number, number, number];
        const result = await this.hass.callWS<RenderResult>(renderRequest(entryId, { type: "text", text: descriptor.text, color, speed: typeof descriptor.speed === "number" ? descriptor.speed : 128 }));
        frames = decodeFrames(result);
      } else {
        throw new Error("A live preview is not available for this item.");
      }
      if (revision === this._previewRevision) {
        this._setFrames(frames);
        this._previewAvailable = frames.length > 0;
      }
    } catch (error) {
      if (revision === this._previewRevision) this._previewError = error instanceof Error ? error.message : "Preview unavailable.";
    } finally {
      if (revision === this._previewRevision) this._previewLoading = false;
    }
  }

  private async _showAgain(descriptor: NowDescriptor): Promise<void> {
    const item = showItemFromDescriptor(descriptor);
    if (!item || !this.entryId) return;
    await showWithUndo(this, this.hass, this.entryId, item as never, descriptor.title || descriptor.kind);
  }

  private async _runCommand(command: string, params: Record<string, unknown>): Promise<void> {
    if (!this.entryId || !this.hass?.callWS || this._busy) return;
    this._busy = command;
    try {
      await this.hass.callWS(commandRequest(this.entryId, command, params));
    } catch (error) {
      this.dispatchEvent(new CustomEvent("lu-toast", { detail: { message: error instanceof Error ? error.message : "The clock could not be updated." }, bubbles: true, composed: true }));
    } finally {
      this._busy = null;
    }
  }

  private _setBrightness(event: Event): void { void this._runCommand("brightness", { value: percentToWireBrightness(Number((event.target as HTMLInputElement).value)) }); }
  private _toggleDisplay(): void { void this._runCommand("power", { on: !this._envelope?.state.power }); }
  private _openLibrary(): void { navigateStudioRoute({ destination: "library" }); }
  private _openNightMode(): void { this.dispatchEvent(new CustomEvent("settings-requested", { detail: { section: "night-mode" }, bubbles: true, composed: true })); }

  private _headline(): string {
    const descriptor = this._envelope?.now_showing;
    if (descriptor?.title) return "Showing " + descriptor.title;
    if (descriptor?.kind) return "Showing " + descriptor.kind;
    return "Showing something set before Pixel Studio 2";
  }

  private _subline(): string {
    const state = this._envelope?.state;
    if (!state) return "Waiting for clock status.";
    const connected = this._envelope?.connected ? "Connected" : "Out of range";
    const brightness = "Brightness " + brightnessToPercent(state.brightness) + "%";
    const power = state.power ? "Display on" : "Display off";
    return connected + " · " + brightness + " · " + power + " · " + timeRange(state);
  }

  private _historyReason(item: NowDescriptor): string | null { return historyUnavailable(item); }

  render() {
    if (!this.entryId) return html`<lu-empty title="No clock connected" message="Add an iLedClock to see what it is showing."></lu-empty>`;
    if (this._loading) return html`<div class="loading"><lu-skeleton variant="card" height="16rem"></lu-skeleton><lu-skeleton width="40%" height="var(--lu-space-4)"></lu-skeleton></div>`;
    if (this._error) return html`<lu-error message=${this._error} @retry=${() => void this._load(this.entryId)}></lu-error>`;
    const envelope = this._envelope;
    const state = envelope?.state ?? null;
    const connected = Boolean(envelope?.connected);
    const progress = this._upload?.upload;
    const percent = progress && progress.total > 0 ? Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100))) : null;
    const frames = this._frames.length ? this._frames : EMPTY_FRAMES;
    
    const history = envelope?.history?.slice(0, 8) ?? [];
    return html`<div class="destination">
      <lu-status-sheet icon="mdi:television-play" headline=${this._headline()} subline=${this._subline()}>
        <div slot="hero" class="hero-preview ${connected ? "" : "offline"}">${this._previewAvailable ? html`<iledclock-led-preview context="hero" .frames=${frames} .delays=${this._delays} .playing=${Boolean(state?.power && connected && !this._upload)} label="Current clock display"></iledclock-led-preview>` : html`<div class="hero-placeholder" role="img" aria-label=${this._headline()}><span>No live preview is available yet.</span><lu-pill-button variant="primary" label="Show a design" icon="mdi:view-grid-outline" @lu-press=${this._openLibrary}></lu-pill-button></div>`}</div>
        ${!connected ? html`<p class="state-note" role="status">Clock is out of range. The dimmed image is the last known display.</p>` : nothing}
        ${this._previewLoading ? html`<p class="state-note" role="status">Updating the display preview…</p>` : nothing}
        ${this._previewError ? html`<p class="state-note" role="status">${this._previewError}</p>` : nothing}
        ${this._upload ? html`<p class="upload" role="status">Sending program to the clock${percent !== null ? "… " + percent + "%" : "…"}</p>${percent !== null ? html`<div class="progress" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${percent}><span style=${"width:" + percent + "%"}></span></div>` : nothing}` : nothing}
      </lu-status-sheet>
      <iledclock-mode-deck .hass=${this.hass} .entryId=${this.entryId} .state=${state}></iledclock-mode-deck>
      <lu-section title="Quick controls" icon="mdi:tune-variant">
        ${state ? html`<div class="quick-controls">
          <label class="field"><span>Brightness <strong>${brightnessToPercent(state.brightness)}%</strong></span><input type="range" min="5" max="100" .value=${String(brightnessToPercent(state.brightness))} ?disabled=${!connected || this._busy !== null} @input=${this._setBrightness} aria-label="Display brightness"></label>
          <button type="button" class="quick-row" role="switch" aria-checked=${state.power ? "true" : "false"} ?disabled=${!connected || this._busy !== null} @click=${this._toggleDisplay}><span>Display</span><span class="row-value">${state.power ? "On" : "Off"}</span><span class="switch ${state.power ? "on" : ""}" aria-hidden="true"></span></button>
          <button type="button" class="night-row" @click=${this._openLibrary}><span><strong>Rotation</strong><small>Designs the clock cycles through · edit in Library</small></span><ha-icon icon="mdi:chevron-right"></ha-icon></button>
          <button type="button" class="night-row" @click=${this._openNightMode}><span><strong>Night mode</strong><small>${timeRange(state)}</small></span><ha-icon icon="mdi:chevron-right"></ha-icon></button>
          ${!connected ? html`<p class="state-note">Controls are unavailable while the clock is out of range.</p>` : nothing}
        </div>` : html`<p class="state-note">Clock controls will appear when status is available.</p>`}
      </lu-section>
      ${history.length ? html`<lu-section title="Recently shown" icon="mdi:history"><div class="history-list">${history.map((item) => {
        const reason = this._historyReason(item);
        return html`<button type="button" class="history-item" aria-label=${reason ? (item.title || item.kind) + ": " + reason : "Show again " + (item.title || item.kind)} ?disabled=${Boolean(reason)} title=${reason ?? ""} @click=${() => void this._showAgain(item)}><span class="history-title">${item.title || item.kind}</span><span class="history-kind">${reason || item.kind}</span></button>`;
      })}</div></lu-section>` : nothing}
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .destination { display: grid; gap: var(--lu-space-4); min-width: 0; }
    .loading { display: grid; gap: var(--lu-space-3); }
    .hero-preview { width: 100%; max-width: 384px; }
    .hero-preview.offline { opacity: .56; filter: grayscale(.45) brightness(.72); }
    .hero-preview iledclock-led-preview { width: 100%; }
    .hero-placeholder { display: grid; aspect-ratio: 2 / 1; place-content: center; justify-items: center; gap: var(--lu-space-3); padding: var(--lu-space-4); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); color: var(--lu-ink-2); background: var(--lu-glass-raised); text-align: center; font: 400 var(--lu-type-label)/1.4 var(--lu-font); }
    .state-note { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); }
    .upload { margin: var(--lu-space-3) 0 var(--lu-space-1); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.4 var(--lu-font); }
    .progress { height: var(--lu-space-1); overflow: hidden; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); }
    .progress span { display: block; height: 100%; border-radius: inherit; background: var(--lu-accent); transition: width var(--lu-motion-label) var(--lu-ease); }
    .quick-controls { display: grid; gap: var(--lu-space-2); }
    .field { display: grid; gap: var(--lu-space-2); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.3 var(--lu-font); }
    .field span { display: flex; justify-content: space-between; }
    .field strong { color: var(--lu-ink); font-variant-numeric: tabular-nums; }
    .field input[type="range"] { width: 100%; min-height: var(--lu-target); margin: 0; accent-color: var(--lu-accent); }
    .quick-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--lu-space-3); min-height: var(--lu-target); padding: 0; border: 0; border-bottom: 1px solid var(--lu-edge); color: var(--lu-ink); background: transparent; text-align: left; font: 500 var(--lu-type-label)/1.3 var(--lu-font); cursor: pointer; }
    .quick-row:disabled { opacity: .55; cursor: default; }
    .row-value { color: var(--lu-ink-2); font-weight: 400; }
    .switch { position: relative; width: 48px; height: 28px; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); transition: background-color var(--lu-motion-label) var(--lu-ease); }
    .switch::after { position: absolute; inset: 4px auto auto 4px; width: 20px; height: 20px; border-radius: var(--lu-radius-pill); background: var(--lu-card); content: ""; transition: transform var(--lu-motion-label) var(--lu-ease); }
    .switch.on { background: var(--lu-accent); }
    .switch.on::after { transform: translateX(20px); }
    .text-link { justify-self: start; min-height: var(--lu-target); padding: 0 var(--lu-space-2); border: 0; border-radius: var(--lu-radius-control); color: var(--lu-accent); background: transparent; font: 500 var(--lu-type-label)/1.2 var(--lu-font); text-decoration: underline; cursor: pointer; }
    .night-row { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-3); min-height: var(--lu-target); padding: var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-row); color: var(--lu-ink); background: var(--lu-glass-raised); text-align: left; cursor: pointer; }
    .night-row span { display: grid; gap: var(--lu-space-1); }
    .night-row strong { font: 500 var(--lu-type-label)/1.3 var(--lu-font); }
    .night-row small { color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .night-row ha-icon { color: var(--lu-ink-3); }
    .history-list { display: flex; gap: var(--lu-space-2); overflow-x: auto; padding-bottom: var(--lu-space-1); }
    .history-item { display: flex; flex: 0 0 min(12rem, 70vw); min-width: 0; min-height: var(--lu-target); flex-direction: column; justify-content: center; gap: var(--lu-space-1); padding: var(--lu-space-2) var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); color: var(--lu-ink); background: var(--lu-glass-raised); text-align: left; cursor: pointer; }
    .history-item:disabled { opacity: .55; cursor: not-allowed; }
    .history-item:focus-visible, .quick-row:focus-visible, .night-row:focus-visible, .text-link:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .history-title { overflow: hidden; font: 500 var(--lu-type-label)/1.3 var(--lu-font); text-overflow: ellipsis; white-space: nowrap; }
    .history-kind { color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); text-transform: capitalize; }
    @media (prefers-reduced-motion: reduce) { .progress span, .switch, .switch::after { transition: none; } }
  `];
}

customElements.define("iledclock-dest-now", IledclockDestNow);

declare global { interface HTMLElementTagNameMap { "iledclock-dest-now": IledclockDestNow; } }
