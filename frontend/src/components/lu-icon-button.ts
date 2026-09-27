import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";

export class LuIconButton extends LitElement {
  static properties = {
    icon: { type: String },
    tooltip: { type: String },
    ariaLabel: { type: String, attribute: "aria-label" },
    disabled: { type: Boolean, reflect: true },
  };

  declare icon: string;
  declare tooltip: string;
  declare ariaLabel: string;
  declare disabled: boolean;

  constructor() {
    super();
    this.icon = "";
    this.tooltip = "";
    this.ariaLabel = "";
    this.disabled = false;
  }

  private _press(): void {
    if (this.disabled) return;
    this.dispatchEvent(new CustomEvent("lu-press", { bubbles: true, composed: true }));
  }

  render() {
    const name = this.ariaLabel || this.tooltip;
    return html`<button type="button" class="button" aria-label=${name} title=${this.tooltip || name} ?disabled=${this.disabled} @click=${this._press}>
      <slot>${this.icon ? html`<ha-icon .icon=${this.icon} aria-hidden="true"></ha-icon>` : ""}</slot>
    </button>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: inline-flex; flex: none; }
    .button { display: inline-flex; align-items: center; justify-content: center; width: var(--lu-target); height: var(--lu-target); padding: 0; border: 1px solid transparent; border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: transparent; cursor: pointer; transition: transform var(--lu-motion-press) var(--lu-ease), background-color var(--lu-motion-focus) var(--lu-ease); }
    .button:hover:not(:disabled), .button:active:not(:disabled) { background: var(--lu-glass-raised); border-color: var(--lu-edge-raised); }
    .button:active:not(:disabled) { transform: scale(0.97); }
    .button:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .button:disabled { opacity: 0.5; cursor: default; }
    ::slotted(ha-icon), .button ha-icon { width: var(--lu-space-6); height: var(--lu-space-6); }
  `];
}

customElements.define("lu-icon-button", LuIconButton);

declare global { interface HTMLElementTagNameMap { "lu-icon-button": LuIconButton; } }
