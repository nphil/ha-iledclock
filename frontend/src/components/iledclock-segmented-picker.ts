/** Horizontal segmented picker: the large mode pills (Clock | Text | Art | Timer | Score) and
 * every smaller in-mode choice (face categories, effect families) share this one component. No
 * local state -- the caller always owns `value` and supplies `options`, so the picker can never
 * drift from whatever entity or selection state it mirrors.
 */

import { LitElement, css, html } from "lit";
import { TOKENS_CSS } from "../styles/tokens.ts";

export interface SegmentOption {
  value: string;
  label: string;
}

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
    this.groupLabel = "";
    this.disabled = false;
    this.contentFit = false;
  }

  render() {
    return html`
      <div class="segments" role="radiogroup" aria-label=${this.groupLabel}>
        ${this.options.map(
          (option) => html`
            <button
              type="button"
              role="radio"
              aria-checked=${option.value === this.value}
              class="segment ${option.value === this.value ? "selected" : ""}"
              ?disabled=${this.disabled}
              @click=${() => this._select(option.value)}
            >
              <span class="segment-label">${option.label}</span>
            </button>
          `,
        )}
      </div>
    `;
  }

  private _select(value: string): void {
    if (this.disabled) return;
    this.dispatchEvent(new CustomEvent("option-selected", { detail: { value }, bubbles: true, composed: true }));
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host {
      display: block;
      container-type: inline-size;
    }
    .segments {
      display: flex;
      gap: 6px;
    }
    .segment {
      flex: 1 1 0;
      min-width: var(--lu-target, 48px);
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: none;
      background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      color: var(--primary-text-color);
      font-size: var(--iledclock-segment-size, 15px);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1.1;
      overflow: hidden;
      padding: 0 4px;
      box-sizing: border-box;
      transition: background-color 0.15s ease, color 0.15s ease, transform 0.08s ease;
    }
    :host([content-fit]) .segment {
      flex: 1 1 auto;
      min-width: 0;
      padding: 0 14px;
    }
    @container (max-width: 300px) {
      :host([content-fit]) .segment-label {
        font-size: 13px;
      }
    }
    .segment-label {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .segment:active:not(:disabled) {
      transform: scale(0.97);
    }
    .segment.selected {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .segment:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .segment:focus-visible {
      outline: 2px solid var(--lu-accent);
      outline-offset: 2px;
    }
    `,
  ];
}

customElements.define("iledclock-segmented-picker", IledclockSegmentedPicker);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-segmented-picker": IledclockSegmentedPicker;
  }
}
