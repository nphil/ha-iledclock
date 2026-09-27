import { LitElement, css, html, nothing } from "lit";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import { GENERATIVE_PRESETS } from "../lib/generative-presets.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import "./lu-sheet.ts";
import "./iledclock-led-preview.ts";

export class IledclockEditorEffectsSheet extends LitElement {
  static properties = {
    open: { type: Boolean },
    durationSeconds: { type: Number, attribute: "duration-seconds" },
    previews: { attribute: false },
    _kind: { state: true },
  };

  declare open: boolean;
  declare durationSeconds: number;
  declare previews: Record<string, PixelFrame[]>;
  declare _kind: string;

  constructor() {
    super();
    this.open = false;
    this.durationSeconds = 8;
    this.previews = {};
    this._kind = GENERATIVE_PRESETS[0]!.kind;
  }

  private _step(delta: number): void { this.durationSeconds = Math.max(2, Math.min(16, this.durationSeconds + delta)); }

  private _generate(): void {
    this.dispatchEvent(new CustomEvent("effect-selected", { detail: { kind: this._kind, seconds: this.durationSeconds }, bubbles: true, composed: true }));
  }

  render() {
    const preset = GENERATIVE_PRESETS.find((item) => item.kind === this._kind) ?? GENERATIVE_PRESETS[0]!;
    const frames = this.previews[this._kind] ?? [];
    return html`<lu-sheet .open=${this.open} label="Create an effect" @closed=${() => { this.open = false; this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true })); }}>
      <div class="content">
        ${frames.length ? html`<iledclock-led-preview .frames=${frames} .delays=${frames.map((frame) => frame.durationMs)} context="thumb" max-pitch="3" playing label=${`${preset.label} preview`}></iledclock-led-preview>` : html`<div class="preview-placeholder" role="img" aria-label="Effect preview unavailable">${mdiIcon("generative")}<span>Preview unavailable</span></div>`}
        <div class="preset-list" role="group" aria-label="Generative effects">
          ${GENERATIVE_PRESETS.map((item) => html`<button type="button" class="preset ${item.kind === this._kind ? "selected" : ""}" aria-pressed=${String(item.kind === this._kind)} @click=${() => (this._kind = item.kind)}><span><strong>${item.label}</strong><small>${item.hint}</small></span>${mdiIcon("check")}</button>`)}
        </div>
        <label class="duration"><span>Animation duration</span><span class="stepper"><button type="button" aria-label="Shorter duration" ?disabled=${this.durationSeconds <= 2} @click=${() => this._step(-1)}>−</button><output>${this.durationSeconds} s</output><button type="button" aria-label="Longer duration" ?disabled=${this.durationSeconds >= 16} @click=${() => this._step(1)}>+</button></span></label>
        <p class="hint">The clock renders the full animation before it is added.</p>
      </div>
      <div slot="footer"><button type="button" class="generate" @click=${this._generate}><span>${mdiIcon("generative")}</span>Generate ${preset.label}</button></div>
    </lu-sheet>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; }
    .content { display: grid; gap: var(--lu-space-3); }
    iledclock-led-preview { display: block; width: 100%; aspect-ratio: 2 / 1; border-radius: var(--lu-radius-tile); overflow: hidden; }
    .preview-placeholder { display: flex; align-items: center; justify-content: center; gap: var(--lu-space-2); min-height: 7rem; border-radius: var(--lu-radius-tile); background: var(--lu-tile); color: var(--lu-ink-3); }
    .preset-list { display: grid; gap: var(--lu-space-1); }
    .preset { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-2); min-height: var(--lu-target); padding: var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-tile); color: var(--lu-ink); text-align: left; cursor: pointer; }
    .preset > span { display: grid; gap: var(--lu-space-1); }
    .preset strong { font: 500 var(--lu-type-label)/1.2 var(--lu-font); }
    .preset small { color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .preset > svg { opacity: 0; color: var(--lu-accent); }
    .preset.selected { border-color: var(--lu-accent); background: var(--lu-accent-soft); }
    .preset.selected > svg { opacity: 1; }
    .duration { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-2); min-height: var(--lu-target); color: var(--lu-ink); font: 500 var(--lu-type-label)/1.2 var(--lu-font); }
    .stepper { display: inline-flex; align-items: center; gap: var(--lu-space-2); font-variant-numeric: tabular-nums; }
    .stepper button { width: var(--lu-target); height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-tile); color: var(--lu-ink); font-size: var(--lu-type-title); cursor: pointer; }
    .stepper output { min-width: 3ch; text-align: center; }
    .hint { margin: 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .generate { display: flex; align-items: center; justify-content: center; gap: var(--lu-space-2); width: 100%; min-height: var(--lu-target); border: 0; border-radius: var(--lu-radius-pill); background: var(--lu-accent); color: var(--lu-accent-ink); font: 600 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  `];
}

customElements.define("iledclock-editor-effects-sheet", IledclockEditorEffectsSheet);

declare global { interface HTMLElementTagNameMap { "iledclock-editor-effects-sheet": IledclockEditorEffectsSheet; } }
