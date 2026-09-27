import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";

export class IledclockStepper extends LitElement {
  static properties = {
    value: { type: Number },
    min: { type: Number },
    max: { type: Number },
    step: { type: Number },
    disabled: { type: Boolean },
    label: { type: String },
  };

  declare value: number;
  declare min: number;
  declare max: number;
  declare step: number;
  declare disabled: boolean;
  declare label: string;

  constructor() {
    super();
    this.value = 0;
    this.min = 0;
    this.max = 100;
    this.step = 1;
    this.disabled = false;
    this.label = "value";
  }

  render() {
    return html`<div class="stepper" role="group" aria-label=${this.label}>
      <button type="button" class="step-btn" ?disabled=${this.disabled || this.value <= this.min} @click=${this._decrement} aria-label="Decrease ${this.label}">&minus;</button>
      <output class="value" aria-live="polite">${this.value}</output>
      <button type="button" class="step-btn" ?disabled=${this.disabled || this.value >= this.max} @click=${this._increment} aria-label="Increase ${this.label}">&plus;</button>
    </div>`;
  }

  private _decrement(): void { this._emit(Math.max(this.min, this.value - this.step)); }
  private _increment(): void { this._emit(Math.min(this.max, this.value + this.step)); }
  private _emit(value: number): void {
    if (value === this.value) return;
    this.dispatchEvent(new CustomEvent("value-selected", { detail: { value }, bubbles: true, composed: true }));
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; }
    .stepper { display: flex; align-items: center; justify-content: center; gap: var(--lu-space-3); }
    .step-btn { flex: none; width: var(--lu-target); height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: var(--lu-glass-raised); font: 500 var(--lu-type-title)/1 var(--lu-font); cursor: pointer; }
    .step-btn:disabled { opacity: 0.45; cursor: default; }
    .step-btn:active:not(:disabled) { transform: scale(0.97); }
    .step-btn:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .value { min-width: 2.2em; color: var(--lu-ink); text-align: center; font: 500 var(--lu-type-numeral)/1.2 var(--lu-font); font-variant-numeric: tabular-nums; }
  `];
}

customElements.define("iledclock-stepper", IledclockStepper);

declare global { interface HTMLElementTagNameMap { "iledclock-stepper": IledclockStepper; } }
