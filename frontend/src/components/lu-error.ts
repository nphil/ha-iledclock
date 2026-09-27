import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./lu-pill-button.ts";

export class LuError extends LitElement {
  static properties = {
    title: { type: String },
    message: { type: String },
    retryLabel: { type: String, attribute: "retry-label" },
    busy: { type: Boolean },
  };

  declare title: string;
  declare message: string;
  declare retryLabel: string;
  declare busy: boolean;

  constructor() {
    super();
    this.title = "Something went wrong";
    this.message = "This information could not be loaded.";
    this.retryLabel = "Retry";
    this.busy = false;
  }

  private _retry(): void {
    this.dispatchEvent(new CustomEvent("retry", { bubbles: true, composed: true }));
  }

  render() {
    return html`<div class="error" role="alert">
      <div class="copy"><h2>${this.title}</h2><p>${this.message}</p></div>
      <lu-pill-button variant="secondary" .label=${this.retryLabel} ?loading=${this.busy} ?disabled=${this.busy} @lu-press=${this._retry}></lu-pill-button>
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .error { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-4); padding: var(--lu-space-4); border: 1px solid color-mix(in srgb, var(--lu-danger) 32%, var(--lu-edge)); border-radius: var(--lu-radius-tile); }
    .copy { min-width: 0; }
    h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-label)/1.3 var(--lu-font); }
    p { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); }
    @container (max-width: 400px) { .error { align-items: flex-start; flex-direction: column; } }
  `];
}

customElements.define("lu-error", LuError);

declare global { interface HTMLElementTagNameMap { "lu-error": LuError; } }
