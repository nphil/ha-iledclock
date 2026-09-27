import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";

export type LuPillVariant = "primary" | "secondary" | "danger" | "quiet";

export class LuPillButton extends LitElement {
  static properties = {
    label: { type: String },
    ariaLabel: { type: String, attribute: "aria-label" },
    variant: { type: String, reflect: true },
    loading: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    icon: { type: String },
  };

  declare label: string;
  declare ariaLabel: string;
  declare variant: LuPillVariant;
  declare loading: boolean;
  declare disabled: boolean;
  declare icon: string;

  constructor() {
    super();
    this.label = "";
    this.ariaLabel = "";
    this.variant = "secondary";
    this.loading = false;
    this.disabled = false;
    this.icon = "";
  }

  private _press(): void {
    if (this.disabled || this.loading) return;
    this.dispatchEvent(new CustomEvent("lu-press", { bubbles: true, composed: true }));
  }

  render() {
    const inaccessibleName = this.ariaLabel || this.label;
    return html`<button class="button ${this.variant}" type="button" aria-label=${inaccessibleName} aria-busy=${this.loading ? "true" : "false"} ?disabled=${this.disabled || this.loading} @click=${this._press}>
      ${this.loading ? html`<span class="loader" aria-hidden="true"></span>` : this.icon ? html`<ha-icon .icon=${this.icon} aria-hidden="true"></ha-icon>` : ""}
      <span class="label"><slot>${this.label}</slot></span>
    </button>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: inline-flex; min-width: 0; }
    .button { display: inline-flex; justify-content: center; align-items: center; gap: var(--lu-space-2); min-width: var(--lu-target); min-height: var(--lu-target); padding: 0 var(--lu-space-5); border: 1px solid transparent; border-radius: var(--lu-radius-pill); font: 600 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; transition: transform var(--lu-motion-press) var(--lu-ease), background-color var(--lu-motion-label) var(--lu-ease); }
    .button:active:not(:disabled) { transform: scale(0.97); }
    .button:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .primary { color: var(--lu-accent-ink); background: var(--lu-accent); }
    .secondary { color: var(--lu-ink); background: var(--lu-glass-raised); border-color: var(--lu-edge-raised); box-shadow: var(--lu-highlight-rest); }
    .danger { color: var(--lu-danger); background: var(--lu-glass-raised); border-color: color-mix(in srgb, var(--lu-danger) 36%, var(--lu-edge)); }
    .quiet { color: var(--lu-ink-2); background: transparent; border-color: var(--lu-edge); }
    .button:disabled { opacity: 0.55; cursor: default; }
    .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .loader { width: var(--lu-space-3); height: var(--lu-space-3); border: 2px solid currentColor; border-right-color: transparent; border-radius: var(--lu-radius-pill); }
    @media (prefers-reduced-motion: reduce) { .button { transition-duration: var(--lu-motion-layer); } }
  `];
}

customElements.define("lu-pill-button", LuPillButton);

declare global { interface HTMLElementTagNameMap { "lu-pill-button": LuPillButton; } }
