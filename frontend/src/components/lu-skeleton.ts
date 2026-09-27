import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";

export class LuSkeleton extends LitElement {
  static properties = {
    variant: { type: String, reflect: true },
    width: { type: String },
    height: { type: String },
    label: { type: String },
  };

  declare variant: "line" | "card" | "circle";
  declare width: string;
  declare height: string;
  declare label: string;

  constructor() {
    super();
    this.variant = "line";
    this.width = "100%";
    this.height = "var(--lu-space-3)";
    this.label = "Loading";
  }

  render() {
    return html`<div class="skeleton ${this.variant}" role="status" aria-label=${this.label} style=${`--skeleton-width:${this.width};--skeleton-height:${this.height}`}><span></span></div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; }
    .skeleton { width: var(--skeleton-width); height: var(--skeleton-height); overflow: hidden; border-radius: var(--lu-radius-control); background: var(--lu-tile); }
    .skeleton span { display: block; width: 100%; height: 100%; background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
    .card { border-radius: var(--lu-radius-card); min-height: var(--lu-space-8); }
    .circle { width: var(--skeleton-height); border-radius: var(--lu-radius-pill); }
    @media (prefers-reduced-motion: no-preference) { .skeleton span { animation: lu-skeleton var(--lu-motion-scroll) ease-in-out infinite alternate; } }
    @keyframes lu-skeleton { from { opacity: 0.45; } to { opacity: 0.85; } }
  `];
}

customElements.define("lu-skeleton", LuSkeleton);

declare global { interface HTMLElementTagNameMap { "lu-skeleton": LuSkeleton; } }
