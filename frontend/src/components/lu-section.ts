import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";

export class LuSection extends LitElement {
  static properties = {
    title: { type: String },
    icon: { type: String },
    description: { type: String },
  };

  declare title: string;
  declare icon: string;
  declare description: string;

  constructor() {
    super();
    this.title = "";
    this.icon = "";
    this.description = "";
  }

  render() {
    return html`
      <section class="surface" aria-label=${this.title}>
        <header class="heading">
          <div class="heading-main">
            <slot name="icon">${this.icon ? html`<ha-icon .icon=${this.icon} aria-hidden="true"></ha-icon>` : ""}</slot>
            <div class="heading-text">
              <h2>${this.title}</h2>
              ${this.description ? html`<p>${this.description}</p>` : ""}
            </div>
          </div>
          <slot name="trailing"></slot>
        </header>
        <div class="content"><slot></slot></div>
      </section>
    `;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .surface { padding: var(--lu-space-4); }
    .heading { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-3); margin-bottom: var(--lu-space-4); }
    .heading-main { display: flex; align-items: center; gap: var(--lu-space-3); min-width: 0; }
    .heading-main ha-icon, ::slotted([slot="icon"]) { color: var(--lu-ink-2); flex: none; }
    .heading-text { min-width: 0; }
    h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); letter-spacing: -0.01em; }
    p { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .content { min-width: 0; }
    @container (min-width: 720px) { .surface { padding: var(--lu-space-5); } }
  `];
}

customElements.define("lu-section", LuSection);

declare global { interface HTMLElementTagNameMap { "lu-section": LuSection; } }
