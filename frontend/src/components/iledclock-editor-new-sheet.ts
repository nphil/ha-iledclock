import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import { GENERATIVE_PRESETS } from "../lib/generative-presets.ts";
import { base64ToFrame } from "../lib/design-codec.ts";
import { GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "../lib/grid.ts";
import { renderRequest } from "../lib/ws-api.ts";
import type { HomeAssistant, RenderResult } from "../types.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import "./lu-sheet.ts";
import "./iledclock-led-preview.ts";
import "./lu-skeleton.ts";

export type NewDesignOption = "blank" | "text" | "effect" | "import" | "explore" | "clock-art";

function renderedFrames(result: RenderResult): PixelFrame[] {
  return result.frames.map((encoded, index) => base64ToFrame(encoded, GRID_WIDTH, GRID_HEIGHT, result.delays[index] ?? 100));
}

export class IledclockEditorNewSheet extends LitElement {
  static properties = {
    open: { type: Boolean },
    hass: { attribute: false },
    entryId: { attribute: false },
    _seconds: { state: true },
    _previews: { state: true },
    _previewLoading: { state: true },
    _previewError: { state: true },
  };

  declare open: boolean;
  declare hass: HomeAssistant | undefined;
  declare entryId: string | undefined;
  declare _seconds: number;
  declare _previews: Record<string, PixelFrame[]>;
  declare _previewLoading: boolean;
  declare _previewError: boolean;
  private _previewRun = 0;

  constructor() {
    super();
    this.open = false;
    this._seconds = 8;
    this._previews = {};
    this._previewLoading = false;
    this._previewError = false;
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("open") && this.open) void this._loadPreviews();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._previewRun++;
  }

  private async _loadPreviews(): Promise<void> {
    const callWS = this.hass?.callWS?.bind(this.hass);
    const entryId = this.entryId;
    const run = ++this._previewRun;
    if (!callWS || !entryId) return;
    this._previewLoading = true;
    this._previewError = false;
    const previews: Record<string, PixelFrame[]> = {};
    await Promise.all(GENERATIVE_PRESETS.map(async (preset) => {
      try {
        const result = await callWS<RenderResult>(renderRequest(entryId, { type: "generative", kind: preset.kind, seconds: 2, seed: 17 }));
        if (run === this._previewRun) previews[preset.kind] = renderedFrames(result);
      } catch {
        if (run === this._previewRun) this._previewError = true;
      }
    }));
    if (run !== this._previewRun) return;
    this._previews = previews;
    this.dispatchEvent(new CustomEvent("effect-previews-ready", { detail: { previews }, bubbles: true, composed: true }));
    this._previewLoading = false;
  }

  private _choose(option: NewDesignOption): void {
    this.dispatchEvent(new CustomEvent("new-option-selected", { detail: { option, seconds: this._seconds }, bubbles: true, composed: true }));
  }

  private _step(delta: number): void { this._seconds = Math.max(2, Math.min(16, this._seconds + delta)); }

  private _effectTile(preset: (typeof GENERATIVE_PRESETS)[number]) {
    const frames = this._previews[preset.kind] ?? [];
    return html`<button type="button" class="effect-tile" @click=${() => this._choose("effect")} aria-label=${`${preset.label}: ${preset.hint}`}>
      ${frames.length ? html`<iledclock-led-preview .frames=${frames} .delays=${frames.map((frame) => frame.durationMs)} context="thumb" max-pitch="3" playing label=${`${preset.label} animation preview`}></iledclock-led-preview>` : html`<div class="preview-placeholder" role="img" aria-label=${this._previewLoading ? `${preset.label} preview loading` : `${preset.label} preview unavailable`}>${this._previewLoading ? html`<lu-skeleton variant="card" height="3rem" label=${`Loading ${preset.label} preview`}></lu-skeleton>` : mdiIcon("generative")}</div>`}
      <span class="tile-copy"><strong>${preset.label}</strong><small>${preset.hint}</small></span>
    </button>`;
  }

  render() {
    const blank = [{ width: GRID_WIDTH, height: GRID_HEIGHT, pixels: new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 3), durationMs: 100 } as PixelFrame];
    return html`<lu-sheet .open=${this.open} label="New design" @closed=${() => { this.open = false; this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true })); }}>
      <div class="sheet-content">
        <p class="intro">Choose a starting point. Your current drawing stays safe until you replace it.</p>
        <label class="duration"><span>Effect duration</span><span class="stepper"><button type="button" aria-label="Shorter duration" ?disabled=${this._seconds <= 2} @click=${() => this._step(-1)}>−</button><output>${this._seconds} s</output><button type="button" aria-label="Longer duration" ?disabled=${this._seconds >= 16} @click=${() => this._step(1)}>+</button></span></label>
        <div class="start-grid">
          <button type="button" class="start-tile" @click=${() => this._choose("blank")}><div class="blank-preview"><iledclock-led-preview .frames=${blank} context="thumb" max-pitch="3" .playing=${false} label="Blank LED canvas"></iledclock-led-preview></div><span class="tile-copy"><strong>Blank</strong><small>Start with an empty 32 × 16 canvas.</small></span></button>
          <button type="button" class="start-tile" @click=${() => this._choose("text")}><div class="icon-preview">${mdiIcon("textStamp")}</div><span class="tile-copy"><strong>Text</strong><small>Make a message, then stamp or animate it.</small></span></button>
          <button type="button" class="start-tile" @click=${() => this._choose("effect")}><div class="icon-preview">${mdiIcon("generative")}</div><span class="tile-copy"><strong>Effect</strong><small>Build a 2–16 second animation.</small></span></button>
          <button type="button" class="start-tile" @click=${() => this._choose("import")}><div class="icon-preview">${mdiIcon("image")}</div><span class="tile-copy"><strong>Import file</strong><small>Adapt an image or animation for the clock.</small></span></button>
          <button type="button" class="start-tile" @click=${() => this._choose("explore")}><div class="icon-preview">${mdiIcon("library")}</div><span class="tile-copy"><strong>From Explore</strong><small>Browse artwork and open it in the editor.</small></span></button>
          <button type="button" class="start-tile" @click=${() => this._choose("clock-art")}><div class="icon-preview clock-preview">${mdiIcon("clock")}</div><span class="tile-copy"><strong>Art + clock</strong><small>Keep the right half clear for the live clock.</small></span></button>
        </div>
        <section class="effect-previews" aria-labelledby="effect-previews-heading"><div class="effect-heading"><h3 id="effect-previews-heading">Effect previews</h3>${this._previewLoading ? html`<span class="hint" role="status">Preparing previews…</span>` : this._previewError ? html`<span class="hint" role="status">Some previews are unavailable.</span>` : nothing}</div><div class="effect-grid">${GENERATIVE_PRESETS.map((preset) => this._effectTile(preset))}</div></section>
      </div>
    </lu-sheet>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; }
    .sheet-content { display: grid; gap: var(--lu-space-4); }
    .intro { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-body)/1.45 var(--lu-font); }
    .duration { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-3); min-height: var(--lu-target); color: var(--lu-ink); font: 500 var(--lu-type-label)/1.2 var(--lu-font); }
    .stepper { display: inline-flex; align-items: center; gap: var(--lu-space-2); font-variant-numeric: tabular-nums; }
    .stepper button { width: var(--lu-target); height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-tile); color: var(--lu-ink); font-size: var(--lu-type-title); cursor: pointer; }
    .stepper output { min-width: 3ch; text-align: center; color: var(--lu-ink); }
    .start-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--lu-space-2); }
    .start-tile, .effect-tile { display: grid; grid-template-rows: auto 1fr; min-width: 0; min-height: 132px; padding: var(--lu-space-2); gap: var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); background: var(--lu-tile); color: var(--lu-ink); text-align: left; cursor: pointer; }
    .start-tile:hover, .effect-tile:hover, .start-tile:focus-visible, .effect-tile:focus-visible { background: var(--lu-glass-raised); outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .blank-preview, .icon-preview, .preview-placeholder { display: grid; place-items: center; min-height: 64px; border-radius: var(--lu-radius-control); background: var(--lu-card); color: var(--lu-accent); }
    .icon-preview { font-size: var(--lu-type-display); }
    .clock-preview { color: var(--lu-ink-2); }
    .tile-copy { display: grid; gap: var(--lu-space-1); }
    .tile-copy strong { color: var(--lu-ink); font: 600 var(--lu-type-label)/1.2 var(--lu-font); }
    .tile-copy small { color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.35 var(--lu-font); }
    .effect-previews { display: grid; gap: var(--lu-space-2); }
    .effect-heading { display: flex; align-items: baseline; justify-content: space-between; gap: var(--lu-space-2); }
    .effect-heading h3 { margin: 0; color: var(--lu-ink-2); font: 600 var(--lu-type-label)/1.2 var(--lu-font); }
    .hint { color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .effect-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--lu-space-2); }
    .effect-tile { min-height: 112px; }
    iledclock-led-preview { display: block; width: 100%; aspect-ratio: 2 / 1; overflow: hidden; border-radius: var(--lu-radius-control); }
    @container (max-width: 380px) { .start-grid, .effect-grid { grid-template-columns: 1fr; } .start-tile { grid-template-columns: 4.5rem minmax(0, 1fr); grid-template-rows: auto; min-height: 80px; align-items: center; } .start-tile .icon-preview, .start-tile .blank-preview { min-height: 64px; } }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  `];
}

customElements.define("iledclock-editor-new-sheet", IledclockEditorNewSheet);

declare global { interface HTMLElementTagNameMap { "iledclock-editor-new-sheet": IledclockEditorNewSheet; } }
