import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";

export type LuChipKind = "positive" | "warning" | "danger" | "info" | "live" | "neutral";

export class LuChip extends LitElement {
  static properties = {
    label: { type: String },
    kind: { type: String, reflect: true },
    dot: { type: Boolean },
  };

  declare label: string;
  declare kind: LuChipKind;
  declare dot: boolean;

  constructor() {
    super();
    this.label = "";
    this.kind = "neutral";
    this.dot = true;
  }

  render() {
    return html`<span class="chip" role="status">
      ${this.dot ? html`<span class="dot" aria-hidden="true"></span>` : ""}
      <slot>${this.label}</slot>
    </span>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: inline-flex; min-width: 0; }
    .chip { display: inline-flex; align-items: center; gap: var(--lu-space-2); min-height: var(--lu-target); padding: 0 var(--lu-space-3); color: var(--lu-ink-2); background: var(--lu-tile); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); white-space: nowrap; }
    .dot { width: var(--lu-space-2); height: var(--lu-space-2); border-radius: var(--lu-radius-pill); background: var(--lu-ink-3); flex: none; }
    :host([kind="positive"]) .dot { background: var(--lu-positive); }
    :host([kind="warning"]) .dot { background: var(--lu-warning); }
    :host([kind="danger"]) .dot { background: var(--lu-danger); }
    :host([kind="info"]) .dot { background: var(--lu-info); }
    :host([kind="live"]) .dot { background: var(--lu-live); }
  `];
}

customElements.define("lu-chip", LuChip);

declare global { interface HTMLElementTagNameMap { "lu-chip": LuChip; } }
