import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";

export interface SegmentOption { value: string; label: string; }

export class IledclockSegmentedPicker extends LitElement {
  static properties = {
    value: { type: String },
    options: { attribute: false },
    groupLabel: { type: String, attribute: "group-label" },
    disabled: { type: Boolean },
    contentFit: { type: Boolean, attribute: "content-fit" },
  };

  declare value: string;
  declare options: SegmentOption[];
  declare groupLabel: string;
  declare disabled: boolean;
  declare contentFit: boolean;

  constructor() {
    super();
    this.value = "";
    this.options = [];
    this.groupLabel = "Options";
    this.disabled = false;
    this.contentFit = false;
  }

  render() {
    return html`<div class="picker">
      <div class="segments" role="radiogroup" aria-label=${this.groupLabel}>
        ${this.options.map((option) => html`<button type="button" role="radio" aria-checked=${option.value === this.value ? "true" : "false"} class="segment ${option.value === this.value ? "selected" : ""}" ?disabled=${this.disabled} @click=${() => this._select(option.value)}><span class="segment-label">${option.label}</span></button>`)}
      </div>
      <select class="compact" aria-label=${this.groupLabel} .value=${this.value} ?disabled=${this.disabled} @change=${(event: Event) => this._select((event.target as HTMLSelectElement).value)}>
        ${this.options.map((option) => html`<option value=${option.value} ?selected=${option.value === this.value}>${option.label}</option>`)}
      </select>
    </div>`;
  }

  private _select(value: string): void {
    if (this.disabled || value === this.value) return;
    this.dispatchEvent(new CustomEvent("option-selected", { detail: { value }, bubbles: true, composed: true }));
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .segments { display: flex; gap: var(--lu-space-2); min-width: 0; }
    .segment { display: flex; align-items: center; justify-content: center; flex: 1 1 0; min-width: var(--lu-target); min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: var(--lu-glass-raised); font: 500 var(--iledclock-segment-size, var(--lu-type-label))/1.2 var(--lu-font); cursor: pointer; }
    .segment-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .segment.selected { color: var(--lu-accent-ink); background: var(--lu-accent); border-color: transparent; box-shadow: var(--lu-highlight-raised); }
    .segment:active:not(:disabled) { transform: scale(0.97); }
    .segment:disabled, .compact:disabled { opacity: 0.5; cursor: default; }
    .segment:focus-visible, .compact:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .compact { display: none; width: 100%; min-height: var(--lu-target); padding: 0 var(--lu-space-4); color: var(--lu-ink); background: var(--lu-card); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); font: 500 var(--lu-type-label)/1.2 var(--lu-font); }
    :host([content-fit]) .segments { flex-wrap: wrap; }
    :host([content-fit]) .segment { flex: 1 0 auto; min-width: 0; }
    @container (max-width: 359px) { .segments { display: none; } .compact { display: block; } }
    @media (prefers-reduced-motion: reduce) { .segment { transition: none; } }
  `];
}

customElements.define("iledclock-segmented-picker", IledclockSegmentedPicker);

declare global { interface HTMLElementTagNameMap { "iledclock-segmented-picker": IledclockSegmentedPicker; } }
