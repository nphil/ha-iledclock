/** Everything secondary lives here, behind the hero's gear: night mode, alarms, timer switches,
 * reminders (view + delete only -- the vendor protocol never recovered a create/edit opcode for
 * them), rotation, volume, colour speed, password, and every other device toggle the firmware
 * reports (0x1e settings not covered by a dedicated control). A controlled overlay: the parent
 * (the card) owns `open`, this only ever asks to close, exactly like the reference Kibble
 * settings dialog this project's conventions come from.
 */

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { AlarmItem, ClockState, HomeAssistant, ReminderItem, TimerSwitchItem } from "../types.ts";
import type { IledclockEntities } from "../lib/resolve-entities.ts";
import { commandRequest } from "../lib/ws-api.ts";
import { DAY_LABELS, isRepeatDayOn, repeatSummary, toggleRepeatDay } from "../lib/repeat-days.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { describeWsError } from "../lib/ws-query.ts";
import "./iledclock-hold-button.ts";
import "./iledclock-segmented-picker.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";

interface NumberAttrs {
  value: number;
  min: number;
  max: number;
  step: number;
}

function numberAttrs(hass: HomeAssistant, entityId: string | undefined): NumberAttrs | null {
  if (!entityId) return null;
  const state = hass.states[entityId];
  if (!state) return null;
  const value = Number(state.state);
  if (Number.isNaN(value)) return null;
  return { value, min: Number(state.attributes.min ?? 0), max: Number(state.attributes.max ?? 100), step: Number(state.attributes.step ?? 1) };
}

let nextLocalId = -1;

export class IledclockSettingsSheet extends LitElement {
  static properties = {
    hass: { attribute: false },
    entities: { attribute: false },
    entryId: { attribute: false },
    state: { attribute: false },
    open: { type: Boolean, reflect: true },
    _password: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };

  declare hass: HomeAssistant;
  declare entities: IledclockEntities;
  declare entryId: string | undefined;
  declare state: ClockState | null;
  declare open: boolean;
  declare _password: string;
  declare _busy: string | null;
  declare _error: string | null;

  constructor() {
    super();
    this.state = null;
    this.open = false;
    this._password = "";
    this._busy = null;
    this._error = null;
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("open") && this.open) this._error = null;
  }

  private async _command(command: string, params: Record<string, unknown>): Promise<void> {
    if (!this.entryId || !this.hass.callWS) return;
    this._busy = command;
    this._error = null;
    try {
      await this.hass.callWS(commandRequest(this.entryId, command, params));
    } catch (err) {
      this._error = describeWsError(err);
    } finally {
      this._busy = null;
      this.requestUpdate();
    }
  }

  private _setNumberEntity(entityId: string, value: number): void {
    void this.hass.callService("number", "set_value", { value }, { entity_id: entityId });
  }

  private _selectOption(entityId: string, option: string): void {
    void this.hass.callService("select", "select_option", { option }, { entity_id: entityId });
  }

  private _toggleSwitch(entityId: string): void {
    void this.hass.callService("switch", "toggle", {}, { entity_id: entityId });
  }

  private _pressButton(entityId: string): void {
    void this.hass.callService("button", "press", {}, { entity_id: entityId });
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true }));
  }

  private _onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") this._close();
  }

  render() {
    if (!this.open) return nothing;
    return html`
      <div class="backdrop" @click=${this._close}></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Clock settings" @keydown=${this._onKeydown}>
        <header>
          <h2>Settings</h2>
          <button type="button" class="icon-button" @click=${this._close} aria-label="Close">${mdiIcon("close")}</button>
        </header>
        <div class="body">
          ${this._error ? html`<p class="error">${this._error}</p>` : nothing}
          ${this._renderNightMode()}
          ${this._renderAlarms()}
          ${this._renderTimerSwitches()}
          ${this._renderReminders()}
          ${this._renderDeviceSection()}
          ${this._renderPassword()}
          ${this.entities.deviceId
            ? html`<button type="button" class="link-row" @click=${this._openDevicePage}>Open device page ${mdiIcon("chevronRight")}</button>`
            : nothing}
        </div>
      </div>
    `;
  }

  private _renderNightMode() {
    const nm = this.state?.night_mode ?? { enabled: false, start_h: 22, start_m: 0, end_h: 7, end_m: 0, device_off: false, brightness: 20, wake_minutes: 5, voice: false, voice_sensitivity: 3 };
    const startTime = `${String(nm.start_h).padStart(2, "0")}:${String(nm.start_m).padStart(2, "0")}`;
    const endTime = `${String(nm.end_h).padStart(2, "0")}:${String(nm.end_m).padStart(2, "0")}`;
    const set = (patch: Partial<typeof nm>) => this._command("night_mode_set", { ...nm, ...patch });
    return html`
      <section>
        <h3>Night mode</h3>
        <button type="button" class="toggle-row" @click=${() => set({ enabled: !nm.enabled })}>
          <span class="toggle-icon">${mdiIcon("nightMode")}</span>
          <span class="toggle-label">Enabled</span>
          ${this._renderPill(nm.enabled)}
        </button>
        ${nm.enabled
          ? html`
              <div class="row two-up">
                <label>Starts<input type="time" .value=${startTime} @change=${(e: Event) => this._applyTime(e, (h, m) => set({ start_h: h, start_m: m }))} /></label>
                <label>Ends<input type="time" .value=${endTime} @change=${(e: Event) => this._applyTime(e, (h, m) => set({ end_h: h, end_m: m }))} /></label>
              </div>
              <button type="button" class="toggle-row" @click=${() => set({ device_off: !nm.device_off })}>
                <span class="toggle-label">Turn display off</span>
                ${this._renderPill(nm.device_off)}
              </button>
              ${nm.device_off
                ? nothing
                : html`<label class="field">Brightness during night mode ${this._renderStepperInline(nm.brightness, 1, 100, 5, (v) => set({ brightness: v }))}</label>`}
              <label class="field">Wake for ${nm.wake_minutes} min on motion ${this._renderStepperInline(nm.wake_minutes, 0, 60, 1, (v) => set({ wake_minutes: v }))}</label>
              <button type="button" class="toggle-row" @click=${() => set({ voice: !nm.voice })}>
                <span class="toggle-label">Wake on voice</span>
                ${this._renderPill(nm.voice)}
              </button>
              ${nm.voice ? html`<label class="field">Voice sensitivity ${this._renderStepperInline(nm.voice_sensitivity, 1, 5, 1, (v) => set({ voice_sensitivity: v }))}</label>` : nothing}
            `
          : nothing}
      </section>
    `;
  }

  private _applyTime(event: Event, apply: (h: number, m: number) => void): void {
    const value = (event.target as HTMLInputElement).value; // "HH:MM"
    const [h, m] = value.split(":").map(Number);
    if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
    apply(h, m);
  }

  private _renderPill(on: boolean) {
    return html`<span class="toggle-pill ${on ? "on" : ""}"><span class="toggle-knob"></span></span>`;
  }

  private _renderStepperInline(value: number, min: number, max: number, step: number, onChange: (value: number) => void) {
    return html`
      <span class="inline-stepper">
        <button type="button" class="step-btn small" ?disabled=${value <= min} @click=${() => onChange(Math.max(min, value - step))}>&minus;</button>
        <span class="step-value">${value}</span>
        <button type="button" class="step-btn small" ?disabled=${value >= max} @click=${() => onChange(Math.min(max, value + step))}>&plus;</button>
      </span>
    `;
  }

  private _renderAlarms() {
    const alarms = this.state?.alarms ?? [];
    const save = (items: AlarmItem[]) => this._command("alarms_set", { items });
    return html`
      <section>
        <h3>Alarms</h3>
        ${alarms.length === 0 ? html`<p class="hint">No alarms set.</p>` : nothing}
        ${alarms.map((alarm) => this._renderAlarmRow(alarm, alarms, save))}
        <button type="button" class="add-row" @click=${() => save([...alarms, { id: nextLocalId--, hour: 7, minute: 0, enabled: true, repeat: 0 }])}>
          ${mdiIcon("plus")} Add alarm
        </button>
      </section>
    `;
  }

  private _renderAlarmRow(alarm: AlarmItem, alarms: AlarmItem[], save: (items: AlarmItem[]) => void) {
    const time = `${String(alarm.hour).padStart(2, "0")}:${String(alarm.minute).padStart(2, "0")}`;
    const patch = (next: Partial<AlarmItem>) => save(alarms.map((a) => (a.id === alarm.id ? { ...a, ...next } : a)));
    return html`
      <div class="entry-row">
        <input
          type="time"
          .value=${time}
          @change=${(e: Event) => this._applyTime(e, (h, m) => patch({ hour: h, minute: m }))}
        />
        ${this._renderRepeatChips(alarm.repeat, (repeat) => patch({ repeat }))}
        <button type="button" class="mini-toggle ${alarm.enabled ? "on" : ""}" @click=${() => patch({ enabled: !alarm.enabled })} aria-label="Enabled">
          ${mdiIcon("check")}
        </button>
        <button type="button" class="icon-button" @click=${() => save(alarms.filter((a) => a.id !== alarm.id))} aria-label="Delete alarm">${mdiIcon("delete")}</button>
      </div>
    `;
  }

  private _renderRepeatChips(repeat: number, onChange: (repeat: number) => void) {
    return html`
      <span class="repeat-chips" title=${repeatSummary(repeat)}>
        ${DAY_LABELS.map(
          (label, i) => html`<button type="button" class="day-chip ${isRepeatDayOn(repeat, i) ? "on" : ""}" @click=${() => onChange(toggleRepeatDay(repeat, i))}>${label}</button>`,
        )}
      </span>
    `;
  }

  private _renderTimerSwitches() {
    const items = this.state?.timer_switches ?? [];
    const save = (next: TimerSwitchItem[]) => this._command("timer_switch_set", { items: next });
    return html`
      <section>
        <h3>Timer switches</h3>
        <p class="hint">Turns the display on or off automatically.</p>
        ${items.length === 0 ? html`<p class="hint">None set.</p>` : nothing}
        ${items.map((item) => {
          const time = `${String(item.hour).padStart(2, "0")}:${String(item.minute).padStart(2, "0")}`;
          const patch = (next: Partial<TimerSwitchItem>) => save(items.map((i) => (i.index === item.index ? { ...i, ...next } : i)));
          return html`
            <div class="entry-row">
              <input type="time" .value=${time} @change=${(e: Event) => this._applyTime(e, (h, m) => patch({ hour: h, minute: m }))} />
              <iledclock-segmented-picker
                group-label="Action"
                content-fit
                .options=${[
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]}
                .value=${item.on ? "on" : "off"}
                @option-selected=${(e: CustomEvent<{ value: string }>) => patch({ on: e.detail.value === "on" })}
              ></iledclock-segmented-picker>
              ${this._renderRepeatChips(item.repeat, (repeat) => patch({ repeat }))}
              <button type="button" class="mini-toggle ${item.enabled ? "on" : ""}" @click=${() => patch({ enabled: !item.enabled })} aria-label="Enabled">${mdiIcon("check")}</button>
              <button type="button" class="icon-button" @click=${() => save(items.filter((i) => i.index !== item.index))} aria-label="Delete">${mdiIcon("delete")}</button>
            </div>
          `;
        })}
        ${items.length < 4
          ? html`<button type="button" class="add-row" @click=${() => {
              const usedIndexes = new Set(items.map((i) => i.index));
              let index = 0;
              while (usedIndexes.has(index)) index++;
              save([...items, { index, hour: 22, minute: 0, on: false, enabled: true, repeat: 0 }]);
            }}>${mdiIcon("plus")} Add timer switch</button>`
          : nothing}
      </section>
    `;
  }

  private _renderReminders() {
    const reminders = this.state?.reminders ?? [];
    if (reminders.length === 0) return nothing;
    return html`
      <section>
        <h3>Reminders</h3>
        <p class="hint">Created from the clock itself; delete them here.</p>
        ${reminders.map((reminder: ReminderItem) => html`
          <div class="entry-row">
            <span class="reminder-content">${reminder.content || "(untitled)"}</span>
            <span class="reminder-time">${String(reminder.hour).padStart(2, "0")}:${String(reminder.minute).padStart(2, "0")}</span>
            <button type="button" class="icon-button" @click=${() => this._command("reminder_delete", { id: reminder.id })} aria-label="Delete reminder">${mdiIcon("delete")}</button>
          </div>
        `)}
      </section>
    `;
  }

  private _renderDeviceSection() {
    const rotationEntity = this.entities.rotationSelect;
    const rotationState = rotationEntity ? this.hass.states[rotationEntity] : undefined;
    const volumeAttrs = numberAttrs(this.hass, this.entities.volumeNumber);
    const speedAttrs = numberAttrs(this.hass, this.entities.colorSpeedNumber);
    if (!rotationEntity && !volumeAttrs && !speedAttrs && this.entities.settingSwitches.length === 0) return nothing;
    return html`
      <section>
        <h3>Device</h3>
        ${rotationEntity && rotationState
          ? html`
              <label class="field">
                Rotation
                <select @change=${(e: Event) => this._selectOption(rotationEntity, (e.target as HTMLSelectElement).value)}>
                  ${((rotationState.attributes.options as string[] | undefined) ?? []).map(
                    (option) => html`<option value=${option} ?selected=${option === rotationState.state}>${option}</option>`,
                  )}
                </select>
              </label>
            `
          : nothing}
        ${volumeAttrs
          ? html`<label class="field">Volume ${this._renderStepperInline(volumeAttrs.value, volumeAttrs.min, volumeAttrs.max, volumeAttrs.step, (v) => this._setNumberEntity(this.entities.volumeNumber!, v))}</label>`
          : nothing}
        ${speedAttrs
          ? html`<label class="field">Colour speed ${this._renderStepperInline(speedAttrs.value, speedAttrs.min, speedAttrs.max, speedAttrs.step, (v) => this._setNumberEntity(this.entities.colorSpeedNumber!, v))}</label>`
          : nothing}
        ${this.entities.settingSwitches.map((sw) => {
          const on = this.hass.states[sw.entityId]?.state === "on";
          return html`
            <button type="button" class="toggle-row" @click=${() => this._toggleSwitch(sw.entityId)}>
              <span class="toggle-label">${sw.name}</span>
              ${this._renderPill(on)}
            </button>
          `;
        })}
        ${this.entities.syncTimeButton
          ? html`<button type="button" class="cloud-toggle" @click=${() => this._pressButton(this.entities.syncTimeButton!)}>Sync time now</button>`
          : nothing}
      </section>
    `;
  }

  private _renderPassword() {
    return html`
      <section>
        <h3>Password</h3>
        <p class="hint">Required by the clock before it accepts any command -- keep it in sync here if you change it on the device itself.</p>
        <input type="password" class="password-input" .value=${this._password} placeholder="New password" @input=${(e: Event) => (this._password = (e.target as HTMLInputElement).value)} />
        <iledclock-hold-button
          label="Hold to set password"
          complete-label="Password set"
          ?disabled=${this._password.length === 0 || this._busy === "set_password"}
          @confirmed=${this._setPassword}
        ></iledclock-hold-button>
      </section>
    `;
  }

  private async _setPassword(): Promise<void> {
    const password = this._password;
    await this._command("set_password", { password });
    if (!this._error) this._password = "";
  }

  private _openDevicePage(): void {
    history.pushState(null, "", `/config/devices/device/${this.entities.deviceId}`);
    window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
    this._close();
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host(:not([open])) {
      display: none;
    }
    :host {
      position: fixed;
      inset: 0;
      z-index: 100;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
    }
    .panel {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: min(420px, 100vw);
      background: var(--lu-card);
      color: var(--lu-ink);
      box-shadow: var(--lu-shadow-raised);
      border-left: 1px solid var(--lu-edge);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid var(--divider-color);
      position: sticky;
      top: 0;
      background: inherit;
      z-index: 1;
    }
    h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
    }
    .icon-button {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--primary-text-color);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .icon-button:hover {
      background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    }
    .body {
      padding: 8px 16px 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    section {
      padding: 12px 0;
      border-bottom: 1px solid var(--divider-color);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    section:last-of-type {
      border-bottom: none;
    }
    h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .error {
      margin: 0;
      font-size: 13px;
      color: var(--lu-danger);
    }
    .row.two-up {
      display: flex;
      gap: 12px;
    }
    .row.two-up label {
      flex: 1;
    }
    label.field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 14px;
      gap: 12px;
    }
    label.field input,
    label.field select,
    .row.two-up input {
      margin-top: 4px;
      width: 100%;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 10px;
      box-sizing: border-box;
      font-size: 14px;
    }
    .row.two-up label {
      display: flex;
      flex-direction: column;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    select {
      appearance: auto;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      padding: 6px 0;
      min-height: var(--lu-target, 48px);
      color: var(--primary-text-color);
      cursor: pointer;
      text-align: left;
      font-size: 14px;
    }
    .toggle-icon {
      display: inline-flex;
      color: var(--secondary-text-color);
    }
    .toggle-label {
      flex: 1;
    }
    .toggle-pill {
      flex: none;
      width: 40px;
      height: 24px;
      border-radius: var(--lu-radius-pill);
      background: color-mix(in srgb, var(--primary-text-color) 20%, transparent);
      position: relative;
      transition: background 0.15s ease;
    }
    .toggle-pill.on {
      background: var(--lu-accent);
    }
    .toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.15s ease;
    }
    .toggle-pill.on .toggle-knob {
      transform: translateX(16px);
    }
    .inline-stepper {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .step-btn.small {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 16px;
      cursor: pointer;
    }
    .step-btn.small:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .step-value {
      min-width: 2em;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .entry-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .entry-row input[type="time"] {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 8px;
    }
    iledclock-segmented-picker {
      width: 100px;
    }
    .repeat-chips {
      display: inline-flex;
      gap: 3px;
    }
    .day-chip {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: none;
      background: color-mix(in srgb, var(--primary-text-color) 10%, transparent);
      color: var(--primary-text-color);
      font-size: 11px;
      cursor: pointer;
    }
    .day-chip.on {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
    }
    .mini-toggle {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid var(--divider-color);
      background: transparent;
      color: transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .mini-toggle.on {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      border-color: transparent;
    }
    .add-row {
      display: flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: 1px dashed var(--divider-color);
      border-radius: var(--lu-radius-control);
      min-height: var(--lu-target, 48px);
      color: var(--primary-text-color);
      cursor: pointer;
      justify-content: center;
      font-size: 14px;
    }
    .reminder-content {
      flex: 1;
      font-size: 14px;
    }
    .reminder-time {
      font-variant-numeric: tabular-nums;
      color: var(--secondary-text-color);
      font-size: 13px;
    }
    .password-input {
      width: 100%;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 12px;
      box-sizing: border-box;
      font-size: 14px;
    }
    .cloud-toggle {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--primary-text-color);
      cursor: pointer;
      font-size: 14px;
    }
    .link-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: none;
      border: none;
      min-height: var(--lu-target, 48px);
      color: var(--primary-text-color);
      cursor: pointer;
      font-size: 14px;
      padding: 8px 0;
    }
  `,
  ];
}

customElements.define("iledclock-settings-sheet", IledclockSettingsSheet);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-settings-sheet": IledclockSettingsSheet;
  }
}
