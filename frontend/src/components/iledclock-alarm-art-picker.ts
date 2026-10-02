import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { HomeAssistant, ReminderAttachment, StoredDesign } from "../types.ts";
import { designToFrames } from "../lib/design-codec.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { renderRequest } from "../lib/ws-api.ts";
import {
  REMINDER_TEXT_COLORS,
  TextArtCache,
  decodeRenderedFrames,
  designEligibility,
  designMeta,
  posterFrames,
  sameColor,
  textColorOf,
} from "../lib/reminders.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { radioTargetIndex } from "../lib/radio-keys.ts";
import { readableInk, rgbToCss } from "../lib/color.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-art-tile.ts";
import "./iledclock-led-preview.ts";

/** What the name looks like before the user has typed one. */
const SAMPLE_NAME = "Wake up";

interface Choice {
  /** `text` for "Name as text", otherwise the design id. */
  id: string;
  title: string;
  subtitle: string;
  design: StoredDesign | null;
  frames: PixelFrame[];
  delays: number[];
  ok: boolean;
  reason: string | null;
}

/** Library grid for the art an alarm shows and rings with: "Name as text" first, then every design that
 * fits. Single choice (a radio group); designs that cannot be used stay in the grid, dimmed, with one line
 * saying why. A large live LED preview shows the current choice. Emits `art-selected` with
 * `{attachment}`. */
export class IledclockAlarmArtPicker extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    designs: { attribute: false },
    value: { attribute: false },
    name: { type: String },
    maxFrames: { type: Number, attribute: "max-frames" },
    textArt: { attribute: false },
    disabled: { type: Boolean },
    _textTick: { state: true },
    _designPreview: { state: true },
    _previewError: { state: true },
  };

  declare hass: HomeAssistant | undefined;
  declare entryId: string | undefined;
  declare designs: StoredDesign[];
  declare value: ReminderAttachment;
  declare name: string;
  declare maxFrames: number;
  declare textArt: TextArtCache | null;
  declare disabled: boolean;
  declare _textTick: number;
  declare _designPreview: { id: string; frames: PixelFrame[]; delays: number[] } | null;
  declare _previewError: string | null;

  private _textKey = "";
  private _designKey = "";
  private _revision = 0;
  private _pendingSent = false;

  constructor() {
    super();
    this.designs = [];
    this.value = { kind: "text" };
    this.name = "";
    this.maxFrames = 40;
    this.textArt = null;
    this.disabled = false;
    this._textTick = 0;
    this._designPreview = null;
    this._previewError = null;
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("name") || changed.has("value") || changed.has("textArt")) this._ensureText();
    if (changed.has("value") || changed.has("entryId") || changed.has("hass") || changed.has("designs")) void this._loadDesignPreview();
  }

  /** Tells the sheet when the picture of the chosen design is still being drawn, so it can keep "Use this art"
   * off until what it shows is the chosen design's. */
  protected updated(): void {
    const pending = this._previewPending;
    if (pending === this._pendingSent) return;
    this._pendingSent = pending;
    this.dispatchEvent(new CustomEvent("art-preview-state", { detail: { pending }, bubbles: true, composed: true }));
  }

  private get _sampleName(): string {
    return this.name.trim() || SAMPLE_NAME;
  }

  /** Is the exact picture of the CHOSEN design still on its way? */
  private get _previewPending(): boolean {
    const value = this.value;
    if (value.kind !== "design" || this._previewError || !this.entryId || !this.hass?.callWS) return false;
    return this._designPreview?.id !== value.design_id;
  }

  /** Asks for the name drawn as the clock draws it, in the chosen colour (cached, shared with the list). The frames
   * are always looked up by name and colour when drawing, so another name's or colour's never show. */
  private _ensureText(): void {
    const cache = this.textArt;
    if (!cache) return;
    const color = textColorOf(this.value);
    const text = this._sampleName;
    const key = color.join(",") + "|" + text;
    if (key === this._textKey) return;
    this._textKey = key;
    if (cache.peek(text, color)) return;
    cache.load(text, color).then(
      () => { if (this._textKey === key) this._textTick++; },
      () => undefined,
    );
  }

  /** What the clock plays for the chosen design, from the same code the upload uses (speed, smoothing). */
  private async _loadDesignPreview(): Promise<void> {
    const value = this.value;
    if (value.kind !== "design" || !this.entryId || !this.hass?.callWS) {
      this._designKey = "";
      this._designPreview = null;
      this._previewError = null;
      return;
    }
    const stamp = this.designs.find((design) => design.id === value.design_id)?.updated;
    const key = this.entryId + "|" + value.design_id + "|" + stamp;
    if (key === this._designKey) return;
    this._designKey = key;
    const revision = ++this._revision;
    // Never leave the previous design's picture up while this one is drawn.
    this._designPreview = null;
    this._previewError = null;
    try {
      const result = await this.hass.callWS<{ frames: string[]; delays: number[] }>(renderRequest(this.entryId, { type: "design", design_id: value.design_id }));
      if (revision !== this._revision) return;
      this._designPreview = { id: value.design_id, frames: decodeRenderedFrames(result), delays: result.delays };
    } catch (error) {
      if (revision !== this._revision) return;
      this._previewError = error instanceof Error ? error.message : "Couldn't draw a preview.";
    }
  }

  private _choices(): Choice[] {
    const color = textColorOf(this.value);
    const textFrames = this.textArt?.peek(this._sampleName, color) ?? [];
    const choices: Choice[] = [{
      id: "text",
      title: "Name as text",
      subtitle: "Scrolls across the clock",
      design: null,
      frames: textFrames,
      delays: textFrames.map((frame) => frame.durationMs),
      ok: true,
      reason: null,
    }];
    for (const design of this.designs) {
      const verdict = designEligibility(design, this.maxFrames);
      const frames = designToFrames(design);
      choices.push({ id: design.id, title: design.name, subtitle: designMeta(design), design, frames, delays: design.delays, ok: verdict.ok, reason: verdict.reason });
    }
    return choices;
  }

  private _isSelected(choice: Choice): boolean {
    return choice.design ? this.value.kind === "design" && this.value.design_id === choice.id : this.value.kind === "text";
  }

  private _emit(attachment: ReminderAttachment): void {
    this.dispatchEvent(new CustomEvent("art-selected", { detail: { attachment }, bubbles: true, composed: true }));
  }

  private _choose(choice: Choice): void {
    if (this.disabled || !choice.ok) return;
    if (choice.design) this._emit({ kind: "design", design_id: choice.id });
    else this._emit(this.value.kind === "text" && this.value.color ? { kind: "text", color: this.value.color } : { kind: "text" });
  }

  private _chooseColor(rgb: readonly [number, number, number]): void {
    if (this.disabled) return;
    this._emit({ kind: "text", color: rgb });
  }

  /** Arrow keys move through a radio group and select as they go; disabled options are skipped. */
  private _moveInGroup(event: KeyboardEvent, group: HTMLElement | null, current: number, enabled: boolean[], pick: (index: number) => void): void {
    const target = radioTargetIndex(event.key, current, enabled);
    if (target === null) return;
    event.preventDefault();
    if (target === current) return;
    pick(target);
    void this.updateComplete.then(() => group?.querySelectorAll<HTMLElement>('[role="radio"]')[target]?.focus());
  }

  private _renderPreview(selected: Choice | undefined) {
    let frames: PixelFrame[] = [];
    let delays: number[] = [];
    let playing = false;
    if (this.value.kind === "design") {
      // Only the picture of THIS design, never the previous choice's: until its exact frames arrive, a still of its
      // own first picture stands in.
      const exact = this._designPreview?.id === this.value.design_id ? this._designPreview : null;
      frames = exact ? exact.frames : selected ? posterFrames(selected.frames) : [];
      delays = exact ? exact.delays : frames.map((frame) => frame.durationMs);
      playing = Boolean(exact) && frames.length > 1;
    } else {
      frames = this.textArt?.peek(this._sampleName, textColorOf(this.value)) ?? [];
      delays = frames.map((frame) => frame.durationMs);
      playing = frames.length > 1;
    }
    const caption = this.value.kind === "design"
      ? (selected ? selected.title + " · " + selected.subtitle : "This design isn't in your Library any more. Pick other art.")
      : "Name as text · draws " + (this.name.trim() ? "“" + this.name.trim() + "”" : "your alarm's name, like “" + SAMPLE_NAME + "”") + " in " + (REMINDER_TEXT_COLORS.find((entry) => sameColor(entry.rgb, textColorOf(this.value)))?.label.toLowerCase() ?? "your colour");
    return html`<div class="preview">
      <div class="hero">
        ${frames.length
          ? html`<iledclock-led-preview context="hero" .frames=${frames} .delays=${delays} ?playing=${playing} label="Preview of the art on the clock"></iledclock-led-preview>`
          : html`<div class="hero-empty" role="img" aria-label="No preview yet">${this.value.kind === "text" || this._previewPending ? "Drawing the preview…" : "No preview"}</div>`}
      </div>
      <p class="caption" role="status">${caption}</p>
      ${this._previewError ? html`<p class="caption error" role="alert">${this._previewError}</p>` : nothing}
    </div>`;
  }

  private _renderColors() {
    if (this.value.kind !== "text") return nothing;
    const current = textColorOf(this.value);
    const index = Math.max(0, REMINDER_TEXT_COLORS.findIndex((entry) => sameColor(entry.rgb, current)));
    return html`<div class="colors" role="radiogroup" aria-label="Text colour" @keydown=${(event: KeyboardEvent) => this._moveInGroup(event, event.currentTarget as HTMLElement, index, REMINDER_TEXT_COLORS.map(() => true), (next) => this._chooseColor(REMINDER_TEXT_COLORS[next]!.rgb))}>
      <span class="colors-label">Text colour</span>
      ${REMINDER_TEXT_COLORS.map((entry, position) => {
        const on = position === index;
        return html`<button type="button" role="radio" class="swatch ${on ? "on" : ""}" aria-checked=${on ? "true" : "false"} aria-label=${entry.label} tabindex=${on ? "0" : "-1"} ?disabled=${this.disabled} style=${"--swatch:" + rgbToCss(entry.rgb) + ";--swatch-ink:" + readableInk(entry.rgb)} @click=${() => this._chooseColor(entry.rgb)}><span class="swatch-fill"></span>${on ? mdiIcon("check") : nothing}</button>`;
      })}
    </div>`;
  }

  render() {
    const choices = this._choices();
    const selectedIndex = choices.findIndex((choice) => this._isSelected(choice));
    const selected = selectedIndex >= 0 ? choices[selectedIndex] : undefined;
    const tabStop = selectedIndex >= 0 ? selectedIndex : 0;
    const enabled = choices.map((choice) => choice.ok);
    return html`<div class="picker">
      ${this._renderPreview(selected)}
      ${this._renderColors()}
      <section aria-labelledby="art-heading">
        <h3 id="art-heading">Your Library</h3>
        <div class="grid" role="radiogroup" aria-label="Art for this alarm" @keydown=${(event: KeyboardEvent) => {
          const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]')];
          const current = items.indexOf(event.target as HTMLElement);
          if (current >= 0) this._moveInGroup(event, event.currentTarget as HTMLElement, current, enabled, (next) => this._choose(choices[next]!));
        }}>
          ${choices.map((choice, index) => {
            const on = this._isSelected(choice);
            const label = choice.title + ". " + choice.subtitle + (choice.reason ? ". Can't be used: " + choice.reason : "");
            return html`<div class="choice ${on ? "on" : ""} ${choice.ok ? "" : "off"}" role="radio" aria-checked=${on ? "true" : "false"} aria-disabled=${choice.ok ? "false" : "true"} aria-label=${label} tabindex=${index === tabStop && choice.ok ? "0" : "-1"} @click=${() => this._choose(choice)} @keydown=${(event: KeyboardEvent) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); this._choose(choice); } }}>
              <iledclock-art-tile inert aspect="design" item-id=${choice.id} title=${choice.title} subtitle=${choice.subtitle} .frames=${choice.frames} .delays=${choice.delays}>${on ? html`<span slot="badges" class="tile-badge play exact check">${mdiIcon("check")}</span>` : nothing}</iledclock-art-tile>
              ${choice.reason ? html`<span class="reason">${choice.reason}</span>` : nothing}
            </div>`;
          })}
        </div>
        ${this.designs.length === 0 ? html`<p class="hint">Designs you save in Create or Explore show up here. Until then the name is drawn as text.</p>` : nothing}
      </section>
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; }
    .picker { display: grid; gap: var(--lu-space-4); min-width: 0; }
    .preview { display: grid; gap: var(--lu-space-2); justify-items: center; }
    .hero { width: min(100%, 384px); }
    .hero iledclock-led-preview { width: 100%; }
    .hero-empty { display: grid; place-items: center; aspect-ratio: 2 / 1; width: 100%; border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); color: var(--lu-ink-2); background: var(--lu-tile); font: 400 var(--lu-type-label)/1.4 var(--lu-font); }
    .caption { margin: 0; max-width: 42ch; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); text-align: center; overflow-wrap: anywhere; }
    .caption.error { color: var(--lu-danger); }
    .colors { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0; }
    .colors-label { flex: 0 0 100%; color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.3 var(--lu-font); text-align: center; }
    .swatch { position: relative; display: grid; place-items: center; width: var(--lu-target); height: var(--lu-target); padding: 0; border: 0; background: transparent; cursor: pointer; }
    .swatch-fill { position: absolute; inset: var(--lu-space-2); border: 1px solid var(--lu-edge-raised); border-radius: var(--lu-radius-pill); background: var(--swatch); }
    .swatch svg { position: relative; width: var(--lu-space-4); height: var(--lu-space-4); color: var(--swatch-ink); }
    .swatch.on .swatch-fill { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .swatch:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: -2px; border-radius: var(--lu-radius-control); }
    .swatch:disabled { opacity: .5; cursor: default; }
    h3 { margin: 0 0 var(--lu-space-2); color: var(--lu-ink); font: 600 var(--lu-type-label)/1.3 var(--lu-font); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: var(--lu-space-2); }
    .choice { position: relative; display: flex; min-width: 0; flex-direction: column; gap: var(--lu-space-1); padding: var(--lu-space-1); border: 2px solid transparent; border-radius: var(--lu-radius-tile); cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .choice:hover { background: var(--lu-tile); }
    .choice:active { background: var(--lu-glass-raised); transition: none; }
    .choice.on { border-color: var(--lu-accent); background: var(--lu-accent-soft); }
    .choice:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .choice.off { cursor: not-allowed; }
    .choice.off:hover, .choice.off:active { background: transparent; }
    .choice.off iledclock-art-tile { opacity: .45; }
    .reason { padding: 0 var(--lu-space-1) var(--lu-space-1); color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.35 var(--lu-font); }
    .hint { margin: var(--lu-space-3) 0 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); }
  `];
}

customElements.define("iledclock-alarm-art-picker", IledclockAlarmArtPicker);

declare global { interface HTMLElementTagNameMap { "iledclock-alarm-art-picker": IledclockAlarmArtPicker; } }
