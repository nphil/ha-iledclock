import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";

export interface LuNavOption { value: string; label: string; icon: string; }

export class LuNav extends LitElement {
  static properties = {
    value: { type: String },
    options: { attribute: false },
    label: { type: String },
  };

  declare value: string;
  declare options: LuNavOption[];
  declare label: string;

  constructor() {
    super();
    this.value = "now";
    this.options = [];
    this.label = "Studio sections";
  }

  private _select(value: string): void {
    if (value === this.value) return;
    this.dispatchEvent(new CustomEvent("destination-selected", { detail: { value }, bubbles: true, composed: true }));
  }

  private _onKeydown(event: KeyboardEvent, index: number): void {
    const last = this.options.length - 1;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % this.options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + last) % this.options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    const option = this.options[next];
    if (!option) return;
    this._select(option.value);
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus());
  }

  render() {
    return html`<nav aria-label=${this.label}>
      <div class="tabs" role="tablist" aria-label=${this.label}>${this.options.map((option, index) => html`
        <button type="button" role="tab" class="nav-item ${option.value === this.value ? "selected" : ""}" aria-selected=${option.value === this.value ? "true" : "false"} tabindex=${option.value === this.value ? "0" : "-1"} data-index=${index} @click=${() => this._select(option.value)} @keydown=${(event: KeyboardEvent) => this._onKeydown(event, index)}>
          <ha-icon .icon=${option.icon} aria-hidden="true"></ha-icon><span>${option.label}</span>
        </button>`)}
      </div>
    </nav>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; width: 100%; z-index: 2; }
    nav { display: flex; justify-content: flex-start; min-width: 0; }
    .tabs { position: sticky; top: 0; z-index: 2; display: inline-flex; gap: var(--lu-space-1); padding: var(--lu-space-1); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-card); }
    .nav-item { display: inline-flex; align-items: center; justify-content: center; gap: var(--lu-space-2); min-width: var(--lu-target); min-height: var(--lu-target); padding: 0 var(--lu-space-4); border: 0; border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: transparent; font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .nav-item ha-icon { flex: none; }
    .nav-item.selected { color: var(--lu-accent-ink); background: var(--lu-accent); }
    .nav-item:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    :host([mobile]) nav { justify-content: stretch; }
    :host([mobile]) .tabs { position: fixed; top: auto; left: 0; right: 0; bottom: 0; z-index: 100; display: grid; height: calc(64px + env(safe-area-inset-bottom)); box-sizing: border-box; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); width: auto; gap: var(--lu-space-1); padding: var(--lu-space-1) var(--lu-space-2) calc(var(--lu-space-1) + env(safe-area-inset-bottom)); border: 0; border-top: 1px solid var(--lu-edge); border-radius: 0; background: color-mix(in srgb, var(--lu-card) 88%, transparent); backdrop-filter: blur(var(--lu-blur)) saturate(1.2); }
    :host([mobile]) .nav-item { flex-direction: column; gap: var(--lu-space-1); min-height: 48px; padding: var(--lu-space-1); font-size: var(--lu-type-caption); }
    :host([mobile]) .nav-item span { overflow: hidden; max-width: 100%; text-overflow: ellipsis; white-space: nowrap; }
    @media (prefers-reduced-motion: reduce) { .nav-item { transition: none; } }
  `];
}

customElements.define("lu-nav", LuNav);

declare global { interface HTMLElementTagNameMap { "lu-nav": LuNav; } }
