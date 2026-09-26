/** A big +/- stepper for small bounded numeric choices (score points, alarm minutes) where a
 * full segmented row doesn't fit or doesn't make sense for an open range. Every target stays
 * >=48px.
 */

import { LitElement, css, html } from "lit";
import { TOKENS_CSS } from "../styles/tokens.ts";

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
    return html`
      <div class="stepper">
        <button type="button" class="step-btn" ?disabled=${this.disabled || this.value <= this.min} @click=${this._decrement} aria-label="Decrease ${this.label}">
          &minus;
        </button>
        <span class="value">${this.value}</span>
        <button type="button" class="step-btn" ?disabled=${this.disabled || this.value >= this.max} @click=${this._increment} aria-label="Increase ${this.label}">
          &plus;
        </button>
      </div>
    `;
  }

  private _decrement(): void {
    this._emit(Math.max(this.min, this.value - this.step));
  }

  private _increment(): void {
    this._emit(Math.min(this.max, this.value + this.step));
  }

  private _emit(value: number): void {
    if (value === this.value) return;
    this.dispatchEvent(new CustomEvent("value-selected", { detail: { value }, bubbles: true, composed: true }));
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host {
      display: block;
    }
    .stepper {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .step-btn {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: 50%;
      border: 2px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      flex: none;
    }
    .step-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .step-btn:active:not(:disabled) {
      transform: scale(0.97);
    }
    .step-btn:focus-visible {
      outline: 2px solid var(--lu-accent);
      outline-offset: 2px;
    }
    .value {
      min-width: 2.2em;
      text-align: center;
      font-size: 20px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--primary-text-color);
    }
    `,
  ];
}

customElements.define("iledclock-stepper", IledclockStepper);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-stepper": IledclockStepper;
  }
}
