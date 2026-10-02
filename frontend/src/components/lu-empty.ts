import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./lu-pill-button.ts";

export class LuEmpty extends LitElement {
  static properties = {
    title: { type: String },
    message: { type: String },
    actionLabel: { type: String, attribute: "action-label" },
    actionVariant: { type: String, attribute: "action-variant" },
    icon: { type: String },
  };

  declare title: string;
  declare message: string;
  declare actionLabel: string;
  declare actionVariant: "primary" | "secondary";
  declare icon: string;

  constructor() {
    super();
    this.title = "Nothing here yet";
    this.message = "Choose an action to get started.";
    this.actionLabel = "";
    this.actionVariant = "secondary";
    this.icon = "";
  }

  private _act(): void {
    this.dispatchEvent(new CustomEvent("empty-action", { bubbles: true, composed: true }));
  }

  render() {
    return html`<div class="empty" role="status">
      ${this.icon ? html`<ha-icon .icon=${this.icon} aria-hidden="true"></ha-icon>` : ""}
      <h2>${this.title}</h2>
      <p>${this.message}<slot></slot></p>
      ${this.actionLabel ? html`<lu-pill-button variant=${this.actionVariant} .label=${this.actionLabel} @lu-press=${this._act}></lu-pill-button>` : ""}
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; }
    .empty { display: grid; justify-items: center; gap: var(--lu-space-2); padding: var(--lu-space-7) var(--lu-space-4); text-align: center; color: var(--lu-ink-2); }
    ha-icon { color: var(--lu-ink-3); }
    h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.3 var(--lu-font); }
    p { margin: 0; max-width: 42ch; font: 400 var(--lu-type-body)/1.5 var(--lu-font); }
  `];
}

customElements.define("lu-empty", LuEmpty);

declare global { interface HTMLElementTagNameMap { "lu-empty": LuEmpty; } }
