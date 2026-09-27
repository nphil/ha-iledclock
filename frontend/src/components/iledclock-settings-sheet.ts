import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { AlarmItem, ClockState, HomeAssistant, ReminderItem, TimerSwitchItem } from "../types.ts";
import type { IledclockEntities } from "../lib/resolve-entities.ts";
import { haBrightnessToPercent, percentToBrightness } from "../lib/brightness.ts";
import { commandRequest } from "../lib/ws-api.ts";
import { DAY_LABELS, isRepeatDayOn, repeatSummary, toggleRepeatDay } from "../lib/repeat-days.ts";
import { describeWsError } from "../lib/ws-query.ts";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import "./lu-sheet.ts";
import "./iledclock-hold-button.ts";
import "./iledclock-segmented-picker.ts";
import "./lu-pill-button.ts";

interface NumberAttrs { value: number; min: number; max: number; step: number; }
function numberAttrs(hass: HomeAssistant, entityId: string | undefined): NumberAttrs | null {
  if (!entityId) return null;
  const state = hass.states[entityId];
  if (!state) return null;
  const value = Number(state.state);
  if (!Number.isFinite(value)) return null;
  return { value, min: Number(state.attributes.min ?? 0), max: Number(state.attributes.max ?? 100), step: Number(state.attributes.step ?? 1) };
}

let nextLocalId = -1;

/** Shared HA-theme settings sheet for the Now destination and Lovelace card. */
export class IledclockSettingsSheet extends LitElement {
  static properties = {
    hass: { attribute: false },
    entities: { attribute: false },
    entryId: { attribute: false },
    state: { attribute: false },
    open: { type: Boolean, reflect: true },
    section: { type: String },
    _password: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };

  declare hass: HomeAssistant;
  declare entities: IledclockEntities;
  declare entryId: string | undefined;
  declare state: ClockState | null;
  declare open: boolean;
  declare section: string;
  declare _password: string;
  declare _busy: string | null;
  declare _error: string | null;

  constructor() {
    super();
    this.state = null;
    this.open = false;
    this.section = "night-mode";
    this._password = "";
    this._busy = null;
    this._error = null;
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("open") && this.open) this._error = null;
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

  private _setNumberEntity(entityId: string, value: number): void {
    void this.hass.callService("number", "set_value", { value }, { entity_id: entityId });
  }

  private _toggleSwitch(entityId: string): void {
    void this.hass.callService("switch", "toggle", {}, { entity_id: entityId });
  }

  private _setDisplayBrightness(event: Event): void {
    const percent = Number((event.target as HTMLInputElement).value);
    if (this.entities.display) void this.hass.callService("light", "turn_on", { brightness: percentToBrightness(percent) }, { entity_id: this.entities.display });
  }

  private _toggleDisplay(): void {
    const entity = this.entities.display;
    if (!entity) return;
    const isOn = this.hass.states[entity]?.state === "on";
    void this.hass.callService("light", isOn ? "turn_off" : "turn_on", {}, { entity_id: entity });
  }

  private _setRotate(event: Event): void {
    void this._command("rotate", { mode: Number((event.target as HTMLSelectElement).value) });
  }

  private _setNightMode(patch: Partial<NonNullable<ClockState["night_mode"]>>): void {
    const current = this.state?.night_mode;
    if (!current) return;
    // Named fields are part of the websocket contract; backend owns protocol byte ordering.
    void this._command("night_mode_set", {
      enabled: current.enabled,
      start_h: current.start_h,
      start_m: current.start_m,
      end_h: current.end_h,
      end_m: current.end_m,
      device_off: current.device_off,
      brightness: current.brightness,
      voice: current.voice,
      wake_minutes: current.wake_minutes,
      voice_sensitivity: current.voice_sensitivity,
      ...patch,
    });
  }

  private _applyTime(event: Event, apply: (hour: number, minute: number) => void): void {
    const [hour, minute] = (event.target as HTMLInputElement).value.split(":").map(Number);
    if (hour !== undefined && minute !== undefined && Number.isInteger(hour) && Number.isInteger(minute)) apply(hour, minute);
  }

  private _setAlarms(items: AlarmItem[]): void { void this._command("alarms_set", { items }); }
  private _setTimerSwitches(items: TimerSwitchItem[]): void { void this._command("timer_switch_set", { items }); }

  private _setTimeButton(): void {
    if (this.entities.syncTimeButton) void this.hass.callService("button", "press", {}, { entity_id: this.entities.syncTimeButton });
    else void this._command("sync_time");
  }

  private _setPassword = async (): Promise<void> => {
    const password = this._password;
    if (await this._command("set_password", { password })) this._password = "";
  };

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true }));
  }

  private _openIntegrationOptions(): void {
    const target = this.entryId
      ? "/config/integrations/integration/iledclock?config_entry=" + encodeURIComponent(this.entryId)
      : "/config/integrations/integration/iledclock";
    history.pushState(null, "", target);
    window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
    this._close();
  }

  private _renderToggle(label: string, checked: boolean, onClick: () => void, disabled = false) {
    return html`<button type="button" class="toggle-row" role="switch" aria-label=${label} aria-checked=${checked ? "true" : "false"} ?disabled=${disabled || this._busy !== null} @click=${onClick}><span>${label}</span><span class="switch ${checked ? "on" : ""}" aria-hidden="true"></span></button>`;
  }

  private _renderDisplay() {
    const displayId = this.entities.display;
    const lightState = displayId ? this.hass.states[displayId] : undefined;
    const isOn = lightState?.state === "on";
    const brightness = lightState ? haBrightnessToPercent(Number(lightState.attributes.brightness ?? 1)) : null;
    const rotate = this.state?.rotate ?? 0;
    return html`<details class="setting-section" name="settings" open=${this.section === "display" ? true : nothing}>
      <summary><span class="section-icon"><ha-icon icon="mdi:monitor-dashboard"></ha-icon></span><span class="section-title"><strong>Display</strong><small>Power, brightness and orientation</small></span><ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon></summary>
      <div class="section-body">
        ${displayId ? this._renderToggle("Display power", isOn, this._toggleDisplay) : html`<p class="hint">Display power is unavailable: no display light entity is registered.</p>`}
        ${brightness !== null ? html`<label class="field"><span>Brightness <strong>${brightness}%</strong></span><input type="range" min="5" max="100" .value=${String(brightness)} @input=${this._setDisplayBrightness} aria-label="Display brightness"></label>` : html`<p class="hint">Brightness is unavailable until the display entity is enabled.</p>`}
        <label class="field"><span>Screen rotation</span><select .value=${String(rotate)} ?disabled=${this._busy !== null} @change=${this._setRotate} aria-label="Screen rotation">${[0, 1, 2, 3].map((mode) => html`<option value=${mode}>${["Normal", "Rotate 90°", "Rotate 180°", "Rotate 270°"][mode]}</option>`)}</select></label>
        <p class="hint">12/24-hour format and date are set with the clock mode.</p>
      </div>
    </details>`;
  }

  private _renderNightMode() {
    const nm = this.state?.night_mode;
    if (!nm) return html`<details class="setting-section" name="settings" open><summary><span class="section-icon"><ha-icon icon="mdi:weather-night"></ha-icon></span><span class="section-title"><strong>Night mode</strong><small>Unavailable until the clock reports its settings</small></span><ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon></summary><div class="section-body"><p class="hint">Night-mode settings are not available while the clock is out of range or has not finished its first status refresh.</p></div></details>`;
    const time = (hour: number, minute: number) => String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
    return html`<details class="setting-section" name="settings" open>
      <summary><span class="section-icon"><ha-icon icon="mdi:weather-night"></ha-icon></span><span class="section-title"><strong>Night mode</strong><small>${time(nm.start_h, nm.start_m)}–${time(nm.end_h, nm.end_m)}</small></span><ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon></summary>
      <div class="section-body">
        ${this._renderToggle("Enabled", nm.enabled, () => this._setNightMode({ enabled: !nm.enabled }), this._busy !== null)}
        <div class="two-up"><label class="field"><span>Starts</span><input type="time" .value=${time(nm.start_h, nm.start_m)} ?disabled=${this._busy !== null} @change=${(event: Event) => this._applyTime(event, (h, m) => this._setNightMode({ start_h: h, start_m: m }))}></label><label class="field"><span>Ends</span><input type="time" .value=${time(nm.end_h, nm.end_m)} ?disabled=${this._busy !== null} @change=${(event: Event) => this._applyTime(event, (h, m) => this._setNightMode({ end_h: h, end_m: m }))}></label></div>
        ${this._renderToggle("Turn display off during night mode", nm.device_off, () => this._setNightMode({ device_off: !nm.device_off }), this._busy !== null)}
        ${!nm.device_off ? html`<label class="field"><span>Night brightness <strong>${nm.brightness}%</strong></span><input type="range" min="1" max="100" .value=${String(nm.brightness)} ?disabled=${this._busy !== null} @change=${(event: Event) => this._setNightMode({ brightness: Number((event.target as HTMLInputElement).value) })} aria-label="Night mode brightness"></label>` : nothing}
        <label class="field"><span>Wake for (minutes)</span><input type="number" min="0" max="60" .value=${String(nm.wake_minutes)} ?disabled=${this._busy !== null} @change=${(event: Event) => this._setNightMode({ wake_minutes: Math.max(0, Math.min(60, Number((event.target as HTMLInputElement).value))) })}></label>
        ${this._renderToggle("Wake on voice", nm.voice, () => this._setNightMode({ voice: !nm.voice }), this._busy !== null)}
        ${nm.voice ? html`<label class="field"><span>Voice sensitivity <strong>${nm.voice_sensitivity}</strong></span><input type="range" min="1" max="5" .value=${String(nm.voice_sensitivity)} ?disabled=${this._busy !== null} @change=${(event: Event) => this._setNightMode({ voice_sensitivity: Number((event.target as HTMLInputElement).value) })}></label>` : nothing}
      </div>
    </details>`;
  }

  private _renderTime() {
    return html`<details class="setting-section" name="settings" open=${this.section === "time" ? true : nothing}>
      <summary><span class="section-icon"><ha-icon icon="mdi:clock-check-outline"></ha-icon></span><span class="section-title"><strong>Time</strong><small>Synchronize the clock from Home Assistant</small></span><ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon></summary>
      <div class="section-body"><p class="hint">The clock uses Home Assistant's current time and timezone.</p><lu-pill-button variant="secondary" label="Sync time now" icon="mdi:sync" ?disabled=${!this.entryId || this._busy !== null} ?loading=${this._busy === "sync_time"} @lu-press=${this._setTimeButton}></lu-pill-button></div>
    </details>`;
  }

  private _renderSound() {
    const volume = numberAttrs(this.hass, this.entities.volumeNumber);
    const speed = numberAttrs(this.hass, this.entities.colorSpeedNumber);
    const settings = this.entities.settingSwitches;
    if (!volume && !speed && !settings.length) return nothing;
    return html`<details class="setting-section" name="settings" open=${this.section === "sound" ? true : nothing}>
      <summary><span class="section-icon"><ha-icon icon="mdi:volume-high"></ha-icon></span><span class="section-title"><strong>Sound & device</strong><small>Volume, voice wake and device options</small></span><ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon></summary>
      <div class="section-body">
        ${volume ? html`<label class="field"><span>Volume <strong>${volume.value}</strong></span><input type="range" min=${volume.min} max=${volume.max} step=${volume.step} .value=${String(volume.value)} @change=${(event: Event) => this._setNumberEntity(this.entities.volumeNumber!, Number((event.target as HTMLInputElement).value))}></label>` : html`<p class="hint">Volume control is not available on this device.</p>`}
        ${speed ? html`<label class="field"><span>Colour speed <strong>${speed.value}</strong></span><input type="range" min=${speed.min} max=${speed.max} step=${speed.step} .value=${String(speed.value)} @change=${(event: Event) => this._setNumberEntity(this.entities.colorSpeedNumber!, Number((event.target as HTMLInputElement).value))}></label>` : nothing}
        ${settings.map((item) => this._renderToggle(item.name, this.hass.states[item.entityId]?.state === "on", () => this._toggleSwitch(item.entityId)))}
        ${!volume && !settings.length ? html`<p class="hint">This clock does not expose sound controls.</p>` : nothing}
      </div>
    </details>`;
  }

  private _renderRepeat(repeat: number, onChange: (next: number) => void) {
    return html`<div class="repeat-row" role="group" aria-label=${"Repeats " + repeatSummary(repeat)}>${DAY_LABELS.map((label, index) => html`<button type="button" class="day ${isRepeatDayOn(repeat, index) ? "on" : ""}" aria-label=${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][index]} aria-pressed=${isRepeatDayOn(repeat, index) ? "true" : "false"} ?disabled=${this._busy !== null} @click=${() => onChange(toggleRepeatDay(repeat, index))}>${label}</button>`)}</div>`;
  }

  private _renderAlarms() {
    const alarms = this.state?.alarms ?? [];
    return html`<section class="list-block"><div class="list-heading"><h3>Alarms</h3><span>${alarms.length}/16</span></div>
      ${alarms.length ? alarms.map((alarm) => html`<div class="item-row"><label class="field"><span>Alarm time</span><input type="time" .value=${String(alarm.hour).padStart(2, "0") + ":" + String(alarm.minute).padStart(2, "0")} ?disabled=${this._busy !== null} @change=${(event: Event) => this._applyTime(event, (h, m) => this._setAlarms(alarms.map((item) => item.id === alarm.id ? { ...item, hour: h, minute: m } : item)))}></label>${this._renderRepeat(alarm.repeat, (repeat) => this._setAlarms(alarms.map((item) => item.id === alarm.id ? { ...item, repeat } : item)))}${this._renderToggle("Enabled", alarm.enabled, () => this._setAlarms(alarms.map((item) => item.id === alarm.id ? { ...item, enabled: !item.enabled } : item)))}<iledclock-hold-button label="Hold to delete alarm" complete-label="Alarm deleted" danger ?disabled=${this._busy !== null} @confirmed=${() => this._setAlarms(alarms.filter((item) => item.id !== alarm.id))}></iledclock-hold-button></div>`)
        : html`<p class="hint">No alarms are set.</p>`}
      <button type="button" class="add-button" ?disabled=${alarms.length >= 16 || this._busy !== null} @click=${() => this._setAlarms([...alarms, { id: nextLocalId--, hour: 7, minute: 0, enabled: true, repeat: 0 }])}>Add alarm</button>
    </section>`;
  }

  private _renderTimerSwitches() {
    const items = this.state?.timer_switches ?? [];
    return html`<section class="list-block"><div class="list-heading"><h3>Display schedule</h3><span>${items.length}/4</span></div><p class="hint">Turn the display on or off at a repeating time.</p>
      ${items.length ? items.map((item) => html`<div class="item-row"><label class="field"><span>Time</span><input type="time" .value=${String(item.hour).padStart(2, "0") + ":" + String(item.minute).padStart(2, "0")} ?disabled=${this._busy !== null} @change=${(event: Event) => this._applyTime(event, (h, m) => this._setTimerSwitches(items.map((current) => current.index === item.index ? { ...current, hour: h, minute: m } : current)))}></label><iledclock-segmented-picker group-label="Display action" content-fit .options=${[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} .value=${item.on ? "on" : "off"} .disabled=${this._busy !== null} @option-selected=${(event: CustomEvent<{ value: string }>) => this._setTimerSwitches(items.map((current) => current.index === item.index ? { ...current, on: event.detail.value === "on" } : current))}></iledclock-segmented-picker>${this._renderRepeat(item.repeat, (repeat) => this._setTimerSwitches(items.map((current) => current.index === item.index ? { ...current, repeat } : current)))}${this._renderToggle("Enabled", item.enabled, () => this._setTimerSwitches(items.map((current) => current.index === item.index ? { ...current, enabled: !current.enabled } : current)))}<button type="button" class="icon-action danger-text" aria-label="Delete display schedule" @click=${() => this._setTimerSwitches(items.filter((current) => current.index !== item.index))}><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`)
        : html`<p class="hint">No automatic display schedules are set.</p>`}
      ${items.length < 4 ? html`<button type="button" class="add-button" ?disabled=${this._busy !== null} @click=${() => { const used = new Set(items.map((item) => item.index)); let index = 0; while (used.has(index)) index++; this._setTimerSwitches([...items, { index, hour: 22, minute: 0, on: false, enabled: true, repeat: 0 }]); }}>Add display schedule</button>` : nothing}
    </section>`;
  }

  private _renderReminders() {
    const reminders = this.state?.reminders ?? [];
    return html`<section class="list-block"><div class="list-heading"><h3>Reminders</h3><span>${reminders.length}</span></div><p class="hint">Reminders can be created on the clock; this integration can remove them.</p>
      ${reminders.length ? reminders.map((item: ReminderItem) => html`<div class="reminder-row"><span>${item.content || "Untitled reminder"}<small>${String(item.hour).padStart(2, "0")}:${String(item.minute).padStart(2, "0")} · ${item.year}-${String(item.month).padStart(2, "0")}-${String(item.day).padStart(2, "0")}</small></span><iledclock-hold-button label="Hold to delete reminder" complete-label="Reminder deleted" danger ?disabled=${this._busy !== null} @confirmed=${() => void this._command("reminder_delete", { id: item.id })}></iledclock-hold-button></div>`) : html`<p class="hint">No reminders are stored on the clock.</p>`}
    </section>`;
  }

  private _renderAlarmsAndReminders() {
    return html`<details class="setting-section" name="settings" open=${this.section === "alarms" ? true : nothing}>
      <summary><span class="section-icon"><ha-icon icon="mdi:calendar-clock"></ha-icon></span><span class="section-title"><strong>Alarms & reminders</strong><small>${(this.state?.alarms.length ?? 0)} alarms · ${(this.state?.reminders.length ?? 0)} reminders</small></span><ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon></summary>
      <div class="section-body">${this._renderAlarms()}${this._renderTimerSwitches()}${this._renderReminders()}</div>
    </details>`;
  }

  private _renderAccounts() {
    return html`<details class="setting-section" name="settings" open=${this.section === "accounts" ? true : nothing}>
      <summary><span class="section-icon"><ha-icon icon="mdi:account-cog-outline"></ha-icon></span><span class="section-title"><strong>Accounts</strong><small>Divoom account status is managed in integration options</small></span><ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon></summary>
      <div class="section-body"><p class="hint">The clock status API does not report Divoom sign-in state. Review or update gallery credentials in the iLedClock integration options.</p><button type="button" class="add-button" @click=${this._openIntegrationOptions}>Open integration options</button></div>
    </details>`;
  }

  private _renderAbout() {
    const device = this.hass?.devices?.[this.entities.deviceId];
    const address = device?.identifiers?.find(([domain]) => domain === "iledclock")?.[1];
    const firmware = this.state?.firmware;
    return html`<details class="setting-section" name="settings" open=${this.section === "about" ? true : nothing}>
      <summary><span class="section-icon"><ha-icon icon="mdi:information-outline"></ha-icon></span><span class="section-title"><strong>About</strong><small>Clock and connection information</small></span><ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon></summary>
      <div class="section-body"><dl class="about-list"><div><dt>Device</dt><dd>${device?.name_by_user || device?.name || "iLedClock"}</dd></div><div><dt>Model</dt><dd>${device?.model || "Unknown"}</dd></div><div><dt>Firmware</dt><dd>${firmware == null ? "Unavailable" : String(firmware)}</dd></div><div><dt>BLE address</dt><dd>${address || "Not provided by Home Assistant"}</dd></div></dl>
        <p class="hint">The integration version is shown on its Home Assistant integration page.</p><button type="button" class="add-button" @click=${this._openIntegrationOptions}>Open integration page</button>
        <label class="field password-field"><span>Update the saved clock password</span><input type="password" autocomplete="new-password" .value=${this._password} placeholder="Clock password" @input=${(event: Event) => (this._password = (event.target as HTMLInputElement).value)}></label><p class="hint">Use this only after changing the password on the clock. The integration verifies the new password before saving.</p>
        <iledclock-hold-button label="Hold to update password" complete-label="Password updated" ?disabled=${this._password.length === 0 || this._busy !== null} @confirmed=${this._setPassword}></iledclock-hold-button>
      </div>
    </details>`;
  }

  render() {
    if (!this.open) return nothing;
    return html`<lu-sheet .open=${this.open} label="Clock settings" @closed=${this._close}>
      <div slot="header" class="sheet-heading"><div><h2>Clock settings</h2><p>Available controls depend on the clock and enabled entities.</p></div></div>
      <div class="sheet-content">
        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
        ${this._renderDisplay()}${this._renderNightMode()}${this._renderTime()}${this._renderSound()}${this._renderAlarmsAndReminders()}${this._renderAccounts()}${this._renderAbout()}
      </div>
    </lu-sheet>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; }
    .sheet-heading { display: grid; min-width: 0; gap: var(--lu-space-1); padding: 0; }
    .sheet-heading h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.2 var(--lu-font); }
    .sheet-heading p, .hint { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); }
    .sheet-content { display: grid; gap: var(--lu-space-3); padding-bottom: var(--lu-space-2); }
    .setting-section { min-width: 0; overflow: hidden; border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); background: transparent; }
    .setting-section > summary { display: flex; align-items: center; gap: var(--lu-space-3); min-height: var(--lu-target); padding: var(--lu-space-2) var(--lu-space-3); color: var(--lu-ink); cursor: pointer; list-style: none; }
    .setting-section > summary::-webkit-details-marker { display: none; }
    .section-icon { display: grid; place-items: center; width: var(--lu-target); height: var(--lu-target); flex: none; border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: var(--lu-tile); }
    .section-icon ha-icon { --mdc-icon-size: 22px; }
    .section-title { display: grid; flex: 1 1 auto; min-width: 0; gap: 2px; }
    .section-title strong { color: var(--lu-ink); font: 600 var(--lu-type-label)/1.25 var(--lu-font); }
    .section-title small { overflow: hidden; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.25 var(--lu-font); text-overflow: ellipsis; white-space: nowrap; }
    .chevron { flex: none; color: var(--lu-ink-3); transition: transform var(--lu-motion-label) var(--lu-ease); }
    details[open] > summary .chevron { transform: rotate(180deg); }
    .section-body { display: grid; gap: var(--lu-space-3); padding: 0 var(--lu-space-3) var(--lu-space-4); }
    .field { display: grid; gap: var(--lu-space-2); min-width: 0; color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.35 var(--lu-font); }
    .field > span { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-2); }
    .field strong { color: var(--lu-ink); font-variant-numeric: tabular-nums; }
    input[type="time"], input[type="number"], input[type="password"], select { box-sizing: border-box; width: 100%; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-card); font: 400 var(--lu-type-label)/1.3 var(--lu-font); }
    input[type="range"] { width: 100%; min-height: var(--lu-target); margin: 0; accent-color: var(--lu-accent); }
    .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-3); min-height: var(--lu-target); padding: 0; border: 0; color: var(--lu-ink); background: transparent; text-align: left; font: 500 var(--lu-type-label)/1.3 var(--lu-font); cursor: pointer; }
    .toggle-row:disabled { opacity: .55; cursor: default; }
    .switch { position: relative; flex: none; width: 48px; height: 28px; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); transition: background-color var(--lu-motion-label) var(--lu-ease); }
    .switch::after { position: absolute; top: 4px; left: 4px; width: 20px; height: 20px; border-radius: var(--lu-radius-pill); background: var(--lu-card); content: ""; transition: transform var(--lu-motion-label) var(--lu-ease); }
    .switch.on { background: var(--lu-accent); }
    .switch.on::after { transform: translateX(20px); }
    .two-up { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--lu-space-3); }
    .list-block { display: grid; gap: var(--lu-space-3); padding-top: var(--lu-space-2); border-top: 1px solid var(--lu-edge); }
    .list-heading { display: flex; align-items: baseline; justify-content: space-between; gap: var(--lu-space-2); }
    .list-heading h3 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-label)/1.3 var(--lu-font); }
    .list-heading span { color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); font-variant-numeric: tabular-nums; }
    .item-row { display: grid; min-width: 0; gap: var(--lu-space-2); padding: var(--lu-space-3) 0; border-bottom: 1px solid var(--lu-edge); }
    .item-row .toggle-row { border-top: 1px solid var(--lu-edge); }
    .repeat-row { display: flex; gap: var(--lu-space-1); overflow-x: auto; padding-bottom: var(--lu-space-1); }
    .day { flex: 0 0 var(--lu-target); min-width: var(--lu-target); min-height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: var(--lu-glass-raised); font: 500 var(--lu-type-caption)/1 var(--lu-font); cursor: pointer; }
    .day.on { border-color: var(--lu-accent); color: var(--lu-accent-ink); background: var(--lu-accent); }
    .add-button { min-height: var(--lu-target); padding: 0 var(--lu-space-4); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: var(--lu-glass-raised); font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .add-button:disabled { opacity: .5; cursor: default; }
    .reminder-row { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-2); min-height: var(--lu-target); }
    .reminder-row > span { display: grid; min-width: 0; gap: var(--lu-space-1); color: var(--lu-ink); font: 500 var(--lu-type-label)/1.3 var(--lu-font); }
    .reminder-row small { color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .about-list { display: grid; gap: var(--lu-space-2); margin: 0; }
    .about-list > div { display: flex; justify-content: space-between; gap: var(--lu-space-3); }
    .about-list dt { color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .about-list dd { margin: 0; color: var(--lu-ink); font: 500 var(--lu-type-caption)/1.4 var(--lu-font); text-align: right; overflow-wrap: anywhere; }
    .password-field { margin-top: var(--lu-space-2); }
    .error { margin: 0; padding: var(--lu-space-3); border: 1px solid color-mix(in srgb, var(--lu-danger) 36%, var(--lu-edge)); border-radius: var(--lu-radius-control); color: var(--lu-danger); background: var(--lu-tile); font: 400 var(--lu-type-label)/1.4 var(--lu-font); }
    .setting-section :focus-visible, .add-button:focus-visible, outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    @container (max-width: 359px) { .two-up { grid-template-columns: 1fr; } .item-row { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) { .switch, .switch::after, .chevron { transition: none; } }
  `];
}

customElements.define("iledclock-settings-sheet", IledclockSettingsSheet);

declare global { interface HTMLElementTagNameMap { "iledclock-settings-sheet": IledclockSettingsSheet; } }
