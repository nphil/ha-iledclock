/** Visual editor for the existing card options: device selection and optional display name. */
import { LitElement, css, html, nothing } from "lit";
import type { HomeAssistant, IledclockCardConfig } from "../types.ts";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";

interface SchemaField { name: string; required?: boolean; selector: Record<string, unknown>; }
const SCHEMA: SchemaField[] = [
  { name: "device_id", required: true, selector: { device: { filter: { integration: "iledclock" } } } },
  { name: "name", selector: { text: {} } },
];
const FIELD_LABELS: Record<string, string> = { device_id: "iLedClock device", name: "Name (optional)" };

export class IledclockCardEditor extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true } };
  declare hass: HomeAssistant;
  declare _config: IledclockCardConfig | undefined;

  setConfig(config: IledclockCardConfig): void { this._config = config; }

  render() {
    if (!this._config) return nothing;
    if (customElements.get("ha-form")) {
      return html`<ha-form .hass=${this.hass} .data=${this._config} .schema=${SCHEMA} .computeLabel=${this._computeLabel} @value-changed=${this._formValueChanged}></ha-form>`;
    }
    return this._renderFallback();
  }

  private _computeLabel = (field: SchemaField): string => FIELD_LABELS[field.name] ?? field.name;

  private _renderFallback() {
    const entities = Object.values(this.hass?.entities ?? {});
    const devices = Object.values(this.hass?.devices ?? {}).filter((device) => entities.some((entity) => entity.device_id === device.id && entity.platform === "iledclock"));
    return html`<section class="editor lu-section-surface" aria-label="iLedClock card options">
      <h2>iLedClock card</h2>
      <p>Choose the clock this card controls. The device's entities are resolved automatically.</p>
      <label><span>iLedClock device</span><select required .value=${this._config?.device_id ?? ""} @change=${(event: Event) => this._updateDeviceId((event.target as HTMLSelectElement).value)}><option value="">Choose a device…</option>${devices.map((device) => html`<option value=${device.id}>${device.name_by_user ?? device.name}</option>`)}</select></label>
      <label><span>Name (optional)</span><input type="text" .value=${this._config?.name ?? ""} @change=${(event: Event) => this._updateName((event.target as HTMLInputElement).value)}></label>
    </section>`;
  }

  private _updateDeviceId(value: string): void {
    if (!this._config) return;
    this._config = { ...this._config, device_id: value };
    this._fireConfigChanged();
  }

  private _updateName(value: string): void {
    if (!this._config) return;
    this._config = { ...this._config, name: value || undefined };
    this._fireConfigChanged();
  }

  private _formValueChanged(event: CustomEvent<{ value: IledclockCardConfig }>): void {
    this._config = event.detail.value;
    this._fireConfigChanged();
  }

  private _fireConfigChanged(): void {
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; color: var(--lu-ink); font-family: var(--lu-font); }
    .editor { display: grid; gap: var(--lu-space-3); padding: var(--lu-space-4); }
    h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); }
    p { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-body)/1.45 var(--lu-font); }
    label { display: grid; gap: var(--lu-space-2); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.3 var(--lu-font); }
    select, input { box-sizing: border-box; width: 100%; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-card); font: 400 var(--lu-type-body)/1.3 var(--lu-font); }
    select:focus-visible, input:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
  `];
}

customElements.define("iledclock-card-editor", IledclockCardEditor);

declare global { interface HTMLElementTagNameMap { "iledclock-card-editor": IledclockCardEditor; } }
