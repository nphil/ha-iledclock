import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./lu-chip.ts";

export class LuStatusSheet extends LitElement {
  static properties = {
    icon: { type: String },
    headline: { type: String },
    subline: { type: String },
    status: { type: String },
    statusKind: { type: String, attribute: "status-kind" },
  };

  declare icon: string;
  declare headline: string;
  declare subline: string;
  declare status: string;
  declare statusKind: "positive" | "warning" | "danger" | "info" | "live" | "neutral";

  constructor() {
    super();
    this.icon = "";
    this.headline = "";
    this.subline = "";
    this.status = "";
    this.statusKind = "neutral";
  }

  render() {
    return html`
      <section class="surface" aria-label=${this.headline || "Device status"}>
        <div class="hero"><slot name="hero"></slot></div>
        <div class="summary">
          <header>
            <div class="title-row">
              ${this.icon ? html`<ha-icon .icon=${this.icon} aria-hidden="true"></ha-icon>` : ""}
              <h1>${this.headline}</h1>
            </div>
            ${this.status ? html`<lu-chip label=${this.status} kind=${this.statusKind}></lu-chip>` : ""}
          </header>
          ${this.subline ? html`<p class="subline">${this.subline}</p>` : ""}
          <div class="details"><slot></slot></div>
          <div class="actions"><slot name="actions"></slot></div>
        </div>
      </section>
    `;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .surface { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--lu-space-4); padding: var(--lu-space-4); }
    .hero { min-width: 0; display: flex; justify-content: center; align-items: center; }
    .summary { min-width: 0; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--lu-space-3); }
    .title-row { display: flex; align-items: center; gap: var(--lu-space-2); min-width: 0; }
    .title-row ha-icon { color: var(--lu-ink-2); flex: none; }
    h1 { margin: 0; min-width: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); letter-spacing: -0.015em; overflow-wrap: anywhere; }
    .subline { color: var(--lu-ink-2); margin: var(--lu-space-2) 0 0; font: 400 var(--lu-type-body)/1.5 var(--lu-font); }
    .details:empty, .actions:empty { display: none; }
    .details { margin-top: var(--lu-space-4); color: var(--lu-ink-2); }
    .actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--lu-space-2); margin-top: var(--lu-space-4); }
    @container (min-width: 640px) {
      .surface { grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); align-items: center; padding: var(--lu-space-5); }
      .summary { padding: var(--lu-space-2) var(--lu-space-3); }
    }
  `];
}

customElements.define("lu-status-sheet", LuStatusSheet);

declare global { interface HTMLElementTagNameMap { "lu-status-sheet": LuStatusSheet; } }
