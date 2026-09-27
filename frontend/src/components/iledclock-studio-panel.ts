import { LitElement, css, html } from "lit";
import type { ClockState, ClockStateEnvelope, EntityRegistryEntry, HomeAssistant } from "../types.ts";
import type { StudioRoute } from "../lib/route.ts";
import { parseStudioRoute } from "../lib/route.ts";
import { resolveEntryId } from "../lib/entry-id.ts";
import { resolveIledclockEntities, type IledclockEntities } from "../lib/resolve-entities.ts";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import "./iledclock-app-shell.ts";
import "./iledclock-dest-now.ts";
import "./iledclock-dest-create.ts";
import "./iledclock-dest-explore.ts";
import "./iledclock-dest-library.ts";
import "./iledclock-settings-sheet.ts";

export class IledclockStudioPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    deviceId: { attribute: "device-id" },
    _selectedDeviceId: { state: true },
    _entryId: { state: true },
    _route: { state: true },
    _status: { state: true },
    _settingsOpen: { state: true },
  };

  declare hass: HomeAssistant;
  declare narrow: boolean;
  declare deviceId: string | undefined;
  declare _selectedDeviceId: string | undefined;
  declare _entryId: string | undefined;
  declare _route: StudioRoute;
  declare _status: ClockStateEnvelope | null;
  declare _settingsOpen: boolean;

  constructor() {
    super();
    this.narrow = false;
    this._selectedDeviceId = undefined;
    this._entryId = undefined;
    this._route = typeof window === "undefined" ? { destination: "now" } : parseStudioRoute(window.location.href);
    this._status = null;
    this._settingsOpen = false;
  }

  protected willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("hass") || changed.has("deviceId")) this._resolveDevice();
  }

  private _resolveDevice(): void {
    if (!this.hass) {
      this._entryId = undefined;
      return;
    }
    const deviceIds = [...new Set(Object.values(this.hass.entities)
      .filter((entity: EntityRegistryEntry) => entity.platform === "iledclock" && entity.device_id)
      .map((entity) => entity.device_id)
      .filter((id): id is string => Boolean(id)))];
    const requested = this.deviceId ?? this._selectedDeviceId;
    const selected = requested && deviceIds.includes(requested) ? requested : deviceIds[0];
    if (selected !== this._selectedDeviceId) this._selectedDeviceId = selected;
    this._entryId = resolveEntryId(this.hass.devices, selected);
  }

  private _onDeviceSelected = (event: CustomEvent<{ deviceId: string }>): void => {
    this._selectedDeviceId = event.detail.deviceId;
    this._entryId = resolveEntryId(this.hass.devices, this._selectedDeviceId);
    this._status = null;
  };

  private _onRouteChanged = (event: CustomEvent<{ route: StudioRoute }>): void => { this._route = event.detail.route; };

  private _onClockStatus = (event: CustomEvent<ClockStateEnvelope>): void => { this._status = event.detail; };

  private _openSettings = (event: CustomEvent<{ section?: string }>): void => {
    const settingsSheet = this.renderRoot.querySelector<HTMLElement & { section: string }>("iledclock-settings-sheet");
    if (settingsSheet) settingsSheet.section = event.detail?.section ?? "display";
    this._settingsOpen = true;
  };
  private _closeSettings = (): void => { this._settingsOpen = false; };

  private _entities(): IledclockEntities {
    return this._selectedDeviceId ? resolveIledclockEntities(this.hass.entities, this._selectedDeviceId) : { deviceId: "", settingSwitches: [] };
  }

  private _state(): ClockState | null { return this._status?.state ?? null; }

  render() {
    const route = this._route;
    const common = { hass: this.hass, entryId: this._entryId, route, narrow: this.narrow };
    return html`<iledclock-app-shell .hass=${this.hass} .entryId=${this._entryId} .deviceId=${this._selectedDeviceId} .route=${route} .narrow=${this.narrow} @route-changed=${this._onRouteChanged} @device-selected=${this._onDeviceSelected} @settings-requested=${this._openSettings} @clock-status=${this._onClockStatus}>
      <div class="destination" ?hidden=${route.destination !== "now"}><iledclock-dest-now .hass=${common.hass} .entryId=${common.entryId} .route=${common.route} .narrow=${common.narrow}></iledclock-dest-now></div>
      <div class="destination" ?hidden=${route.destination !== "create"}><iledclock-dest-create .hass=${common.hass} .entryId=${common.entryId} .route=${common.route} .narrow=${common.narrow}></iledclock-dest-create></div>
      <div class="destination" ?hidden=${route.destination !== "explore"}><iledclock-dest-explore .hass=${common.hass} .entryId=${common.entryId} .route=${common.route} .narrow=${common.narrow}></iledclock-dest-explore></div>
      <div class="destination" ?hidden=${route.destination !== "library"}><iledclock-dest-library .hass=${common.hass} .entryId=${common.entryId} .route=${common.route} .narrow=${common.narrow}></iledclock-dest-library></div>
      <iledclock-settings-sheet .hass=${this.hass} .entities=${this._entities()} .entryId=${this._entryId} .state=${this._state()} ?open=${this._settingsOpen} @close-requested=${this._closeSettings}></iledclock-settings-sheet>
    </iledclock-app-shell>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; width: 100%; min-height: 100%; color: var(--lu-ink); font-family: var(--lu-font); }
    .destination { display: block; min-width: 0; }
    .destination[hidden] { display: none; }
  `];
}

customElements.define("iledclock-studio-panel", IledclockStudioPanel);

declare global { interface HTMLElementTagNameMap { "iledclock-studio-panel": IledclockStudioPanel; } }
