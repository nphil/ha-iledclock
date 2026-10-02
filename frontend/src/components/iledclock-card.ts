import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { ClockStateEnvelope, HomeAssistant, IledclockCardConfig, SubscribeEvent, UploadProgressEvent } from "../types.ts";
import type { LuToastRequest } from "./lu-toast.ts";
import { resolveIledclockEntities, type IledclockEntities } from "../lib/resolve-entities.ts";
import { resolveEntryId } from "../lib/entry-id.ts";
import { brightnessToPercent, haBrightnessToPercent, percentToBrightness } from "../lib/brightness.ts";
import { descriptorPreviewKey, loadDescriptorPreview } from "../lib/descriptor-preview.ts";
import { primeSlotCapabilities } from "../lib/slots.ts";
import { createFrame, GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "../lib/grid.ts";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import "./iledclock-led-preview.ts";
import "./iledclock-mode-deck.ts";
import "./iledclock-settings-sheet.ts";
import "./iledclock-card-editor.ts";
import "./lu-icon-button.ts";
import "./lu-chip.ts";
import "./lu-toast.ts";
import "./iledclock-slot-tiles.ts";

interface CardDescriptor {
  kind: string;
  title?: string;
  shown_at?: string;
  design_id?: string;
  style?: number;
  color?: readonly number[];
  h24?: boolean;
  hours24?: boolean;
  background?: boolean;
  text?: string;
  speed?: number | null;
  smooth?: "on" | "off" | null;
  [key: string]: unknown;
  frames?: string[];
  delays?: number[];
}
interface CardEnvelope extends ClockStateEnvelope { now_showing?: CardDescriptor | null; history?: CardDescriptor[]; }
type CardUploadEvent = UploadProgressEvent & { upload?: { done: number; total: number } | null };
const EMPTY_FRAME = createFrame(GRID_WIDTH, GRID_HEIGHT);
const EMPTY_FRAMES: PixelFrame[] = [EMPTY_FRAME];

/** Lovelace card shell; mode controls live in the shared iledclock-mode-deck component. */
export class IledclockCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _entities: { state: true },
    _entryId: { state: true },
    _envelope: { state: true },
    _heroFrames: { state: true },
    _heroAvailable: { state: true },
    _heroDelays: { state: true },
    _heroApproximate: { state: true },
    _previewError: { state: true },
    _upload: { state: true },
    _settingsOpen: { state: true },
    _narrowCard: { state: true },
  };

  declare hass: HomeAssistant;
  declare _config: IledclockCardConfig | undefined;
  declare _entities: IledclockEntities;
  declare _entryId: string | undefined;
  declare _envelope: CardEnvelope | null;
  declare _heroFrames: PixelFrame[];
  declare _heroAvailable: boolean;
  declare _heroDelays: number[];
  declare _heroApproximate: boolean;
  declare _previewError: string | null;
  declare _upload: CardUploadEvent | null;
  declare _settingsOpen: boolean;
  declare _narrowCard: boolean;

  private _unsubscribe: (() => Promise<void>) | null = null;
  private _subscribedEntryId: string | undefined;
  private _previewKey = "";
  private _previewRevision = 0;
  private _connectionRevision = 0;
  private _resizeObserver: ResizeObserver | null = null;
  private _retryTimer: ReturnType<typeof setTimeout> | undefined;
  private _lastConnection: HomeAssistant["connection"] | undefined;
  private _cardWidth = 0;

  constructor() {
    super();
    this._entities = { deviceId: "", settingSwitches: [] };
    this._envelope = null;
    this._heroFrames = EMPTY_FRAMES;
    this._heroAvailable = false;
    this._heroDelays = [];
    this._heroApproximate = false;
    this._previewError = null;
    this._upload = null;
    this._settingsOpen = false;
    this._narrowCard = true;
  }

  setConfig(config: IledclockCardConfig): void {
    if (!config.device_id) throw new Error("iLedClock card: a device is required. Choose it in the card editor.");
    this._config = config;
  }

  getCardSize(): number { return 7; }

  static getStubConfig(hass: HomeAssistant): IledclockCardConfig {
    const entry = Object.values(hass.entities ?? {}).find((entity) => entity.platform === "iledclock");
    return { type: "custom:iledclock-card", device_id: entry?.device_id ?? "" };
  }

  static getConfigElement(): HTMLElement { return document.createElement("iledclock-card-editor"); }

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof ResizeObserver !== "undefined") this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      this._cardWidth = width;
      const narrow = this._cardWidth < 400;
      if (narrow !== this._narrowCard) this._narrowCard = narrow;
    });
    if (this._entryId && this._entryId !== this._subscribedEntryId) {
      this._subscribedEntryId = this._entryId;
      void this._connect(this._entryId);
    }
  }

  protected firstUpdated(): void {
    this._resizeObserver?.observe(this);
  }

  protected willUpdate(changed: PropertyValues): void {
    if (!(changed.has("hass") || changed.has("_config")) || !this.hass || !this._config?.device_id) return;
    const connectionChanged = changed.has("hass") && this.hass.connection !== this._lastConnection;
    if (changed.has("hass")) this._lastConnection = this.hass.connection;
    const deviceId = this._config.device_id;
    this._entities = resolveIledclockEntities(this.hass.entities, deviceId);
    const entryId = resolveEntryId(this.hass.devices, deviceId);
    const entryChanged = entryId !== this._entryId;
    this._entryId = entryId;
    if (!entryId) {
      if (entryChanged || connectionChanged) {
        this._subscribedEntryId = undefined;
        this._connectionRevision++;
        this._previewRevision++;
        clearTimeout(this._retryTimer);
        this._retryTimer = undefined;
        if (this._unsubscribe) void this._unsubscribe();
        this._unsubscribe = null;
        this._envelope = null;
        this._heroFrames = EMPTY_FRAMES;
        this._heroAvailable = false;
        this._heroDelays = [];
        this._heroApproximate = false;
        this._previewError = null;
        this._upload = null;
        this._previewKey = "";
      }
      return;
    }
    if (entryChanged || connectionChanged || entryId !== this._subscribedEntryId) {
      this._subscribedEntryId = entryId;
      void this._connect(entryId);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._connectionRevision++;
    this._previewRevision++;
    clearTimeout(this._retryTimer);
    this._retryTimer = undefined;
    this._subscribedEntryId = undefined;
    if (this._unsubscribe) void this._unsubscribe();
    this._unsubscribe = null;
  }

  private _connectionIsCurrent(entryId: string, revision: number): boolean {
    return entryId === this._entryId && revision === this._connectionRevision && this.isConnected;
  }

  private async _connect(entryId: string): Promise<void> {
    clearTimeout(this._retryTimer);
    this._retryTimer = undefined;
    if (this._unsubscribe) {
      void this._unsubscribe();
      this._unsubscribe = null;
    }
    const revision = ++this._connectionRevision;
    this._previewRevision++;
    this._envelope = null;
    this._heroFrames = EMPTY_FRAMES;
    this._heroAvailable = false;
    this._heroDelays = [];
    this._heroApproximate = false;
    this._previewError = null;
    this._upload = null;
    this._previewKey = "";
    if (!this.hass?.callWS) {
      this._subscribedEntryId = undefined;
      return;
    }

    const snapshot = this._loadSnapshot(entryId, revision);
    const subscribed = await this._subscribe(entryId, revision);
    const loaded = await snapshot;
    if (!loaded || !subscribed) this._scheduleRetry(entryId, revision, !loaded, !subscribed);
  }

  private async _loadSnapshot(entryId: string, revision: number): Promise<boolean> {
    if (!this.hass?.callWS || !this._connectionIsCurrent(entryId, revision)) return false;
    try {
      const envelope = await this.hass.callWS<CardEnvelope>({ type: "iledclock/state", entry_id: entryId });
      if (!this._connectionIsCurrent(entryId, revision)) return false;
      if (this._envelope === null) {
        this._envelope = envelope;
        primeSlotCapabilities(entryId, envelope.capabilities);
        void this._loadPreview(envelope.now_showing ?? null);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async _subscribe(entryId: string, revision: number): Promise<boolean> {
    const connection = this.hass?.connection;
    if (!connection || !this._connectionIsCurrent(entryId, revision)) return false;
    try {
      const unsubscribe = await connection.subscribeMessage<SubscribeEvent>((event) => {
        if (!this._connectionIsCurrent(entryId, revision)) return;
        if (event.type === "upload") {
          const upload = event as CardUploadEvent;
          this._upload = upload.upload === null || upload.state === "done" || upload.state === "error" ? null : upload;
          return;
        }
        const previous = descriptorPreviewKey(this._envelope?.now_showing);
        this._envelope = event as CardEnvelope;
        primeSlotCapabilities(entryId, this._envelope.capabilities);
        if (descriptorPreviewKey(this._envelope.now_showing) !== previous) void this._loadPreview(this._envelope.now_showing ?? null);
      }, { type: "iledclock/subscribe", entry_id: entryId });
      if (!this._connectionIsCurrent(entryId, revision) || connection !== this.hass?.connection) {
        void unsubscribe();
        return false;
      }
      this._unsubscribe = unsubscribe;
      return true;
    } catch {
      return false;
    }
  }

  private _scheduleRetry(entryId: string, revision: number, retrySnapshot: boolean, retrySubscription: boolean): void {
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = undefined;
      void (async () => {
        if (!this._connectionIsCurrent(entryId, revision)) return;
        let snapshotFailed = retrySnapshot;
        let subscriptionFailed = retrySubscription;
        if (snapshotFailed) snapshotFailed = !(await this._loadSnapshot(entryId, revision));
        if (subscriptionFailed && !this._unsubscribe) subscriptionFailed = !(await this._subscribe(entryId, revision));
        else subscriptionFailed = false;
        if (snapshotFailed || subscriptionFailed) this._scheduleRetry(entryId, revision, snapshotFailed, subscriptionFailed);
      })();
    }, 5000);
  }

  private async _loadPreview(descriptor: CardDescriptor | null): Promise<void> {
    const key = descriptorPreviewKey(descriptor);
    if (key === this._previewKey) return;
    this._previewKey = key;
    const revision = ++this._previewRevision;
    const entryId = this._entryId;
    if (!entryId || !this.hass?.callWS) return;
    this._heroAvailable = false;
    this._heroFrames = EMPTY_FRAMES;
    this._heroDelays = [];
    this._previewError = null;
    this._heroApproximate = false;
    if (!descriptor) return;
    try {
      const preview = await loadDescriptorPreview(this.hass, entryId, descriptor);
      if (revision === this._previewRevision) {
        this._heroApproximate = preview.approximate;
        this._heroFrames = preview.frames.length ? preview.frames : EMPTY_FRAMES;
        this._heroDelays = this._heroFrames.map((frame) => frame.durationMs);
        this._heroAvailable = preview.frames.length > 0;
      }
    } catch (error) {
      if (revision === this._previewRevision) this._previewError = error instanceof Error ? error.message : "Preview unavailable.";
    }
  }

  private _toggleDisplay(): void {
    const entityId = this._entities.display;
    if (!entityId) return;
    const isOn = this.hass.states[entityId]?.state === "on";
    void this.hass.callService("light", isOn ? "turn_off" : "turn_on", {}, { entity_id: entityId });
  }

  private _setBrightness(event: Event): void {
    const entityId = this._entities.display;
    if (!entityId) return;
    const percent = Number((event.target as HTMLInputElement).value);
    void this.hass.callService("light", "turn_on", { brightness: percentToBrightness(percent) }, { entity_id: entityId });
  }

  private _onToast = (event: CustomEvent<LuToastRequest>): void => {
    const toast = this.renderRoot.querySelector<HTMLElement & { enqueue?: (request: LuToastRequest) => void }>("lu-toast");
    if (event.detail && typeof event.detail.message === "string") toast?.enqueue?.(event.detail);
  };

  private _openSettings(): void { this._settingsOpen = true; }

  private _openStudio(): void {
    history.pushState(null, "", "/iledclock/now");
    window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
  }

  private _connectionLabel(): string {
    if (this._envelope) return this._envelope.connected ? "Connected" : "Out of range";
    const connected = this._entities.connected ? this.hass.states[this._entities.connected]?.state === "on" : undefined;
    return connected === undefined ? "Connecting" : connected ? "Connected" : "Out of range";
  }

  render() {
    if (!this._config) return nothing;
    const state = this._envelope?.state ?? null;
    const descriptor = this._envelope?.now_showing;
    const displayEntity = this._entities.display ? this.hass?.states[this._entities.display] : undefined;
    const displayBrightness = displayEntity?.attributes.brightness;
    const brightness = displayBrightness !== undefined ? haBrightnessToPercent(Number(displayBrightness)) : state ? brightnessToPercent(state.brightness) : null;
    const title = descriptor?.title || descriptor?.kind || "Showing something set before Pixel Studio 2";
    const connected = this._envelope?.connected ?? (this._entities.connected ? this.hass?.states[this._entities.connected]?.state === "on" : false);
    const uploadProgress = this._upload?.upload;
    const uploadPercent = uploadProgress && uploadProgress.total > 0 ? Math.max(0, Math.min(100, Math.round((uploadProgress.done / uploadProgress.total) * 100))) : null;
    const deviceName = this._config.name || (this.hass?.devices[this._config.device_id ?? ""]?.name_by_user || this.hass?.devices[this._config.device_id ?? ""]?.name) || "iLedClock";
    return html`<ha-card @lu-toast=${this._onToast}>
      <div class="card" aria-label=${deviceName}>
        <header class="card-heading"><h2>${deviceName}</h2><a href="/iledclock/now" @click=${(event: Event) => { event.preventDefault(); this._openStudio(); }}>Open Pixel Studio</a></header>
        <div class="layout">
          <div class="stage">
          <section class="hero-wrap" aria-label="Current clock display">
            ${this._heroAvailable ? html`<iledclock-led-preview context="hero" .maxPitch=${this._narrowCard ? 10 : undefined} .frames=${this._heroFrames} .delays=${this._heroDelays} .playing=${Boolean(state?.power && connected && !this._upload)} label=${title}></iledclock-led-preview>` : html`<div class="hero-placeholder" role="group" aria-label="Display preview unavailable"><span>No live preview is available yet.</span><button type="button" class="preview-link" @click=${this._openStudio}>Open Pixel Studio</button></div>`}
              <lu-chip label=${this._connectionLabel()} kind=${connected ? "positive" : "warning"} dot></lu-chip>
              ${this._upload ? html`<lu-chip label=${uploadPercent === null ? "Sending" : "Sending " + uploadPercent + "%"} kind="info" dot></lu-chip>` : nothing}
              <lu-chip label=${title} kind="neutral"></lu-chip>
            </div>
            ${this._heroApproximate ? html`<span class="approximate">Preview</span>` : nothing}
            ${this._previewError ? html`<span class="preview-error" role="status">${this._previewError}</span>` : nothing}
            ${this._entities.display ? html`<button type="button" class="power" aria-label=${displayEntity?.state === "on" ? "Turn display off" : "Turn display on"} aria-pressed=${displayEntity?.state === "on" ? "true" : "false"} @click=${this._toggleDisplay}><ha-icon icon="mdi:power"></ha-icon></button>` : nothing}
          </section>
          ${this._envelope?.slots ? html`<iledclock-slot-tiles .hass=${this.hass} .entryId=${this._entryId} .slots=${this._envelope.slots} .connected=${connected} .power=${state?.power}></iledclock-slot-tiles>` : nothing}
          </div>
          <div class="controls">
            <iledclock-mode-deck .hass=${this.hass} .entryId=${this._entryId} .state=${state} .capabilities=${this._envelope?.capabilities}></iledclock-mode-deck>
            <section class="brightness-control" aria-label="Brightness control">
              ${brightness !== null ? html`<label for="brightness">Brightness <strong>${brightness}%</strong></label><input id="brightness" type="range" min="1" max="100" .value=${String(brightness)} @change=${this._setBrightness}>` : html`<p class="brightness-hint">Brightness control is unavailable until device state is available.</p>`}
            </section>
          </div>
        </div>
      </div>
      <iledclock-settings-sheet .hass=${this.hass} .entities=${this._entities} .entryId=${this._entryId} .state=${state} ?open=${this._settingsOpen} section="display" @close-requested=${() => (this._settingsOpen = false)}></iledclock-settings-sheet>
      <lu-icon-button class="gear" icon="mdi:cog-outline" tooltip="Settings" aria-label="Clock settings" @lu-press=${this._openSettings}></lu-icon-button>
    </ha-card>
    <lu-toast></lu-toast>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    ha-card { position: relative; overflow: hidden; color: var(--lu-ink); }
    .card { display: grid; min-width: 0; gap: var(--lu-space-3); padding: var(--lu-space-3); }
    .card-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-2); min-width: 0; }
    .card-heading h2 { min-width: 0; margin: 0; overflow: hidden; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.2 var(--lu-font); text-overflow: ellipsis; white-space: nowrap; }
    .card-heading a { display: inline-flex; align-items: center; justify-content: center; flex: none; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: var(--lu-glass-raised); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); text-decoration: none; }
    .card-heading a:focus-visible, .power:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .layout { display: grid; min-width: 0; gap: var(--lu-space-3); }
    .stage { display: grid; min-width: 0; gap: var(--lu-space-3); }
    .hero-wrap { position: relative; min-width: 0; overflow: hidden; border-radius: var(--lu-radius-tile); background: #050607; }
    .hero-wrap iledclock-led-preview { width: 100%; }
    .hero-placeholder { display: grid; aspect-ratio: 2 / 1; place-content: center; justify-items: center; gap: var(--lu-space-3); padding: var(--lu-space-4); color: var(--lu-ink-2); background: var(--lu-glass-raised); text-align: center; font: 400 var(--lu-type-label)/1.4 var(--lu-font); }
    .preview-link { min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-accent); background: var(--lu-card); font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .preview-link:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .hero-chips { position: absolute; inset: var(--lu-space-2) var(--lu-space-2) auto; display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: var(--lu-space-1); pointer-events: none; }
    .hero-chips lu-chip { max-width: 80%; padding: 0 var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: color-mix(in srgb, var(--lu-card) 78%, transparent); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); pointer-events: auto; }
    .hero-chips lu-chip:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .approximate, .preview-error { position: absolute; left: var(--lu-space-2); bottom: var(--lu-space-2); max-width: calc(100% - var(--lu-space-4)); padding: var(--lu-space-1) var(--lu-space-2); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: color-mix(in srgb, var(--lu-card) 82%, transparent); font: 400 var(--lu-type-caption)/1.2 var(--lu-font); }
    .power { position: absolute; right: var(--lu-space-2); bottom: var(--lu-space-2); display: grid; place-items: center; min-width: var(--lu-target); min-height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: color-mix(in srgb, var(--lu-card) 82%, transparent); cursor: pointer; }
    .controls { display: grid; min-width: 0; gap: var(--lu-space-3); }
    .brightness-control { display: grid; gap: var(--lu-space-2); padding: var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); }
    .brightness-control label { display: flex; justify-content: space-between; color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.3 var(--lu-font); }
    .brightness-hint { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .brightness-control strong { color: var(--lu-ink); font-variant-numeric: tabular-nums; }
    .brightness-control input { width: 100%; min-height: var(--lu-target); margin: 0; accent-color: var(--lu-accent); }
    .gear { position: absolute; top: var(--lu-space-2); right: var(--lu-space-2); z-index: 2; }
    @container (max-width: 399px) { .card { padding: var(--lu-space-2); } .card-heading { padding-right: var(--lu-space-8); } }
    @container (min-width: 640px) { .layout { grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr); align-items: start; } }
  `];
}

customElements.define("iledclock-card", IledclockCard);

window.customCards = window.customCards || [];
window.customCards.push({ type: "iledclock-card", name: "iLedClock", description: "Control and preview an iLedClock 32x16 RGB BLE pixel clock." });

declare global {
  interface HTMLElementTagNameMap { "iledclock-card": IledclockCard; }
  interface Window { customCards?: Array<{ type: string; name: string; description: string }>; }
}
