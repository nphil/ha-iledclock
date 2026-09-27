import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { ClockStateEnvelope, DeviceRegistryEntry, EntityRegistryEntry, HomeAssistant, UploadProgressEvent } from "../types.ts";
import type { StudioDestination, StudioRoute } from "../lib/route.ts";
import { navigateStudioRoute, parseStudioRoute } from "../lib/route.ts";
import { resolveEntryId } from "../lib/entry-id.ts";
import type { LuToastRequest } from "./lu-toast.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./lu-nav.ts";
import "./lu-icon-button.ts";
import "./lu-toast.ts";

interface StudioDeviceOption { deviceId: string; entryId?: string; name: string; }
interface StudioState extends ClockStateEnvelope { now_showing?: { kind: string; title?: string } | null; }
type StudioSubscribeEvent = (StudioState & { type?: undefined }) | (UploadProgressEvent & { upload?: { done: number; total: number } | null });

const NAV_OPTIONS = [
  { value: "now", label: "Now", icon: "mdi:television-play" },
  { value: "create", label: "Create", icon: "mdi:draw" },
  { value: "explore", label: "Explore", icon: "mdi:compass-outline" },
  { value: "library", label: "Library", icon: "mdi:view-grid-outline" },
] as const;

export class IledclockAppShell extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    route: { attribute: false },
    narrow: { type: Boolean },
    deviceId: { attribute: false },
    _status: { state: true },
    _upload: { state: true },
    _mobile: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare route: StudioRoute;
  declare narrow: boolean;
  declare deviceId: string | undefined;
  declare _status: StudioState | null;
  declare _upload: (UploadProgressEvent & { upload?: { done: number; total: number } | null }) | null;
  declare _mobile: boolean;

  private _unsubscribe: (() => Promise<void>) | null = null;
  private _subscribedEntryId: string | undefined;
  private _statusRevision = 0;
  private _lastConnection: HomeAssistant["connection"] | undefined;
  private _resizeObserver: ResizeObserver | null = null;

  constructor() {
    super();
    this.route = typeof window === "undefined" ? { destination: "now" } : parseStudioRoute(window.location.href);
    this.narrow = false;
    this._mobile = false;
    this._status = null;
    this._upload = null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this._onLocationChanged);
    window.addEventListener("location-changed", this._onLocationChanged);
    this.addEventListener("lu-toast", this._onToast as EventListener);
    this.addEventListener("iledclock-open-design", this._onOpenDesign as EventListener);
    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver((entries) => {
        const mobile = (entries[0]?.contentRect.width ?? 0) < 720;
        this.toggleAttribute("mobile", mobile);
        if (mobile !== this._mobile) this._mobile = mobile;
      });
      this._resizeObserver.observe(this);
    }
    this._lastConnection = this.hass?.connection;
    if (this.hass && this.entryId) void this._loadStatus();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("popstate", this._onLocationChanged);
    window.removeEventListener("location-changed", this._onLocationChanged);
    this.removeEventListener("lu-toast", this._onToast as EventListener);
    this.removeEventListener("iledclock-open-design", this._onOpenDesign as EventListener);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._statusRevision++;
    this._subscribedEntryId = undefined;
    if (this._unsubscribe) {
      void this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  protected willUpdate(changed: PropertyValues): void {
    const entryChanged = changed.has("entryId") && this.entryId !== this._subscribedEntryId;
    const connectionChanged = changed.has("hass") && this.hass?.connection !== this._lastConnection;
    if (changed.has("hass")) this._lastConnection = this.hass?.connection;
    if (this.hass && (entryChanged || connectionChanged)) void this._loadStatus();
  }

  private _devices(): StudioDeviceOption[] {
    if (!this.hass) return [];
    const entries = Object.values(this.hass.entities).filter((entity: EntityRegistryEntry) => entity.platform === "iledclock" && entity.device_id);
    const ids = new Set(entries.map((entity) => entity.device_id).filter((id): id is string => Boolean(id)));
    return [...ids].map((deviceId) => {
      const device: DeviceRegistryEntry | undefined = this.hass.devices[deviceId];
      return { deviceId, entryId: resolveEntryId(this.hass.devices, deviceId), name: device?.name_by_user || device?.name || "iLedClock" };
    });
  }

  private async _loadStatus(): Promise<void> {
    const revision = ++this._statusRevision;
    const entryId = this.entryId;
    const connection = this.hass?.connection;
    if (this._unsubscribe) {
      void this._unsubscribe();
      this._unsubscribe = null;
    }
    this._subscribedEntryId = entryId;
    this._status = null;
    this._upload = null;
    if (!entryId || !this.hass.callWS) return;
    const isCurrent = (): boolean => this.isConnected && revision === this._statusRevision && entryId === this.entryId && connection === this.hass?.connection;
    try {
      const status = await this.hass.callWS<StudioState>({ type: "iledclock/state", entry_id: entryId });
      if (!isCurrent()) return;
      this._status = status;
      this._notifyClockStatus(status);
      if (connection) {
        const unsubscribe = await connection.subscribeMessage<StudioSubscribeEvent>((event) => {
          if (!isCurrent()) return;
          if (event.type === "upload") {
            this._upload = event.upload === null || event.state === "done" || event.state === "error" ? null : event;
          } else {
            this._status = event;
            this._notifyClockStatus(event);
          }
        }, { type: "iledclock/subscribe", entry_id: entryId });
        if (!isCurrent()) {
          void unsubscribe();
          return;
        }
        this._unsubscribe = unsubscribe;
      }
    } catch {
      if (isCurrent()) this._status = null;
    }
  }

  private _notifyClockStatus(status: StudioState): void {
    this.dispatchEvent(new CustomEvent("clock-status", { detail: status, bubbles: true, composed: true }));
  }

  private _onLocationChanged = (): void => {
    const next = parseStudioRoute(window.location.href);
    if (next.destination === this.route.destination && next.item === this.route.item && next.design === this.route.design) return;
    this._setRoute(next, false);
  };

  private _setRoute(route: StudioRoute, push: boolean): void {
    this.route = route;
    if (push) navigateStudioRoute(route);
    this.dispatchEvent(new CustomEvent("route-changed", { detail: { route }, bubbles: true, composed: true }));
  }

  private _onDestinationSelected = (event: CustomEvent<{ value: string }>): void => {
    const destination = event.detail.value as StudioDestination;
    if (destination !== "now" && destination !== "create" && destination !== "explore" && destination !== "library") return;
    this._setRoute({ destination }, true);
  };

  private _onDeviceSelected = (event: Event): void => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    this.dispatchEvent(new CustomEvent("device-selected", { detail: { deviceId: value }, bubbles: true, composed: true }));
  };

  private _onMenu = (): void => {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
  };

  private _openSettings = (): void => {
    this.dispatchEvent(new CustomEvent("settings-requested", { bubbles: true, composed: true }));
  };

  private _openNow = (): void => this._setRoute({ destination: "now" }, true);

  private _onToast = (event: CustomEvent<LuToastRequest>): void => {
    const toast = this.renderRoot.querySelector<HTMLElement & { enqueue?: (request: LuToastRequest) => void }>("lu-toast");
    if (event.detail && typeof event.detail.message === "string") toast?.enqueue?.(event.detail);
  };

  private _onOpenDesign = (event: CustomEvent<{ design_id?: string }>): void => {
    const design = event.detail?.design_id;
    if (design) this._setRoute({ destination: "create", design }, true);
  };

  private _statusLabel(): string {
    if (this._upload) {
      const upload = this._upload.upload;
      return upload && upload.total > 0 ? "Sending " + Math.round((upload.done / upload.total) * 100) + "%" : "Sending";
    }
    if (!this._status) return this.entryId ? "Connecting" : "No clock";
    return this._status.connected ? "Connected" : "Out of range";
  }

  render() {
    const devices = this._devices();
    const statusClass = this._status?.connected ? "positive" : this._status ? "warning" : "neutral";
    return html`<div class="shell">
      <header class="app-bar">
        ${this.narrow ? html`<lu-icon-button icon="mdi:menu" tooltip="Show sidebar" aria-label="Show sidebar" @lu-press=${this._onMenu}></lu-icon-button>` : nothing}
        <h1>Pixel Studio</h1>
        <button type="button" class="clock-chip ${statusClass}" aria-label=${"Clock status: " + this._statusLabel()} @click=${this._openNow}><span class="dot"></span><span class="status-label">${this._statusLabel()}</span></button>
        ${devices.length > 1 ? html`<select class="device-picker" aria-label="Choose iLedClock" .value=${this.deviceId ?? devices[0]?.deviceId ?? ""} @change=${this._onDeviceSelected}>${devices.map((device) => html`<option value=${device.deviceId}>${device.name}</option>`)}</select>` : nothing}
        <lu-icon-button icon="mdi:cog-outline" tooltip="Settings" aria-label="Settings" @lu-press=${this._openSettings}></lu-icon-button>
      </header>
      <lu-nav ?mobile=${this._mobile} .options=${NAV_OPTIONS} .value=${this.route.destination} @destination-selected=${this._onDestinationSelected}></lu-nav>
      <main class="content"><slot></slot></main>
      <lu-toast ?mobile=${this._mobile}></lu-toast>
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-height: 100%; color: var(--lu-ink); font-family: var(--lu-font); container-type: inline-size; }
    .shell { display: flex; min-height: 100%; flex-direction: column; }
    .app-bar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: var(--lu-space-2); min-height: var(--header-height, 56px); padding: 0 var(--lu-space-3); color: var(--app-header-text-color, var(--lu-ink)); background: var(--app-header-background-color, var(--lu-card)); border-bottom: 1px solid var(--lu-edge); }
    h1 { flex: 1 1 auto; min-width: 0; margin: 0; overflow: hidden; color: inherit; font: 600 var(--lu-type-title)/1.2 var(--lu-font); letter-spacing: -0.015em; text-overflow: ellipsis; white-space: nowrap; }
    .clock-chip { display: inline-flex; flex: none; align-items: center; justify-content: center; gap: var(--lu-space-2); min-width: var(--lu-target); min-height: var(--lu-target); padding: 0 var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: var(--lu-tile); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); cursor: pointer; }
    .clock-chip.positive .dot { background: var(--lu-positive); }
    .clock-chip.warning .dot { background: var(--lu-warning); }
    .dot { width: var(--lu-space-2); height: var(--lu-space-2); flex: none; border-radius: var(--lu-radius-pill); background: var(--lu-ink-3); }
    .status-label { overflow: hidden; max-width: 10ch; text-overflow: ellipsis; white-space: nowrap; }
    .device-picker { flex: 0 1 9rem; min-width: var(--lu-target); max-width: 9rem; height: var(--lu-target); padding: 0 var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-card); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .content { width: min(100%, 1200px); box-sizing: border-box; margin: 0 auto; padding: var(--lu-space-4) var(--lu-space-4) var(--lu-space-6); }
    @container (min-width: 720px) { .content { padding: var(--lu-space-5) var(--lu-space-6) var(--lu-space-6); } }
    :host([mobile]) .content { padding-bottom: calc(64px + var(--lu-space-4) + env(safe-area-inset-bottom)); }
    :host([mobile]) .app-bar { gap: var(--lu-space-1); padding-inline: var(--lu-space-2); }
    :host([mobile]) .status-label { max-width: 8ch; }
    :host([mobile]) .device-picker { max-width: 5rem; }
  `];
}

customElements.define("iledclock-app-shell", IledclockAppShell);

declare global { interface HTMLElementTagNameMap { "iledclock-app-shell": IledclockAppShell; } }
