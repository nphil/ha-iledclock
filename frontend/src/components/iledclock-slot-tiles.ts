import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { HomeAssistant, SlotId, SlotRecord, SlotsState } from "../types.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { descriptorPreviewKey, descriptorPreviewPlan, loadDescriptorPreview, type PreviewDescriptor } from "../lib/descriptor-preview.ts";
import { SLOT_IDS, keyedSlot, setSlotChoice, slotChoices, slotLabel, slotRecordCaption, switchScreenBlockReason } from "../lib/slots.ts";
import { switchScreenRequest } from "../lib/ws-api.ts";
import { posterFrameIndex } from "../lib/tile-policy.ts";
import { mdiIcon, type MdiIconName } from "../lib/mdi-icons.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-led-preview.ts";
import "./lu-pill-button.ts";

/** How often "Sent 5 min ago" is refreshed while the tiles are on screen. */
const CLOCK_TICK_MS = 60_000;

type TilePreview =
  | { state: "empty" }
  | { state: "loading"; key: string }
  | { state: "ready"; key: string; frames: PixelFrame[]; poster: PixelFrame[] }
  | { state: "unavailable"; key: string; reason: string }
  | { state: "error"; key: string; message: string };

/** The glyph that stands in for a page the clock draws with its own fonts. */
const KIND_ICONS: Readonly<Record<string, MdiIconName>> = {
  clock: "clock",
  temperature: "thermometer",
  humidity: "humidity",
  timer: "countdown",
  scoreboard: "scoreboard",
};

/** The clock's two screens behind its power button: what Home Assistant last sent to each, and where the next show goes.
 *
 * The clock cannot report its screens, so each tile is a record of what was SENT (picture rendered by the server from the
 * stored descriptor, title, "Sent 5 min ago"), and "Last sent" marks the screen written most recently (writing a screen
 * also shows it). The tiles never claim to know which screen the clock is showing: the power button is invisible to Home
 * Assistant. The tiles are also a radio group for the TARGET, the screen the next show is written to (the same remembered
 * choice as every A | B control).
 *
 * Properties: `.hass`, `.entryId`, `.slots` (`SlotsState` from the state envelope; nothing is drawn without it). */
export class IledclockSlotTiles extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    slots: { attribute: false },
    connected: { type: Boolean },
    power: { attribute: false },
    _switching: { state: true },
    _target: { state: true },
    _previews: { state: true },
    _focusPlaying: { state: true },
    _now: { state: true },
  };

  declare hass: HomeAssistant | undefined;
  declare entryId: string | undefined;
  declare slots: SlotsState | undefined;
  /** The clock is in Bluetooth range (the Switch screen button needs it). Unknown counts as in range. */
  declare connected: boolean;
  /** The display is on (`state.power`); unknown counts as on. */
  declare power: boolean | undefined;
  declare _switching: boolean;
  declare _target: SlotId;
  declare _previews: Record<SlotId, TilePreview>;
  declare _focusPlaying: SlotId | null;
  declare _now: number;

  private _unsubscribe: (() => void) | null = null;
  private _observer: IntersectionObserver | null = null;
  private _ticker: number | undefined;
  private _boundEntry: string | undefined;

  constructor() {
    super();
    this._target = "a";
    this.connected = true;
    this.power = undefined;
    this._switching = false;
    this._previews = { a: { state: "empty" }, b: { state: "empty" } };
    this._focusPlaying = null;
    this._now = Date.now();
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._unsubscribe = slotChoices.subscribe((change) => {
      if (change.entryId === this.entryId) this._target = change.slot;
    });
    if (this.entryId) this._target = slotChoices.get(this.entryId);
    if (typeof IntersectionObserver !== "undefined") {
      this._observer = new IntersectionObserver((entries) => this._setVisible(entries[0]?.isIntersecting ?? false));
      this._observer.observe(this);
    } else this._setVisible(true);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._observer?.disconnect();
    this._observer = null;
    this._setVisible(false);
  }

  /** The relative times only need a tick while someone can see them. */
  private _setVisible(visible: boolean): void {
    window.clearInterval(this._ticker);
    this._ticker = undefined;
    if (!visible) return;
    this._now = Date.now();
    this._ticker = window.setInterval(() => (this._now = Date.now()), CLOCK_TICK_MS);
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("entryId") && this.entryId !== this._boundEntry) {
      this._boundEntry = this.entryId;
      this._target = this.entryId ? slotChoices.get(this.entryId) : "a";
      this._previews = { a: { state: "empty" }, b: { state: "empty" } };
    }
    if (changed.has("slots") || changed.has("entryId")) for (const slot of SLOT_IDS) this._syncPreview(slot);
  }

  private _setPreview(slot: SlotId, preview: TilePreview): void {
    this._previews = { ...this._previews, [slot]: preview };
  }

  /** Draw the descriptor of what was sent to `slot`, once per distinct picture. */
  private _syncPreview(slot: SlotId): void {
    const record = this.slots?.[slot] ?? null;
    if (!record) {
      if (this._previews[slot].state !== "empty") this._setPreview(slot, { state: "empty" });
      return;
    }
    const descriptor = record.descriptor as PreviewDescriptor | null;
    const key = descriptor ? `${this.entryId ?? ""}|${descriptorPreviewKey(descriptor)}` : "no-descriptor";
    const current = this._previews[slot];
    if ("key" in current && current.key === key) return;
    if (!descriptor) {
      this._setPreview(slot, { state: "unavailable", key, reason: "There is no preview for this one." });
      return;
    }
    const plan = descriptorPreviewPlan(descriptor);
    if (plan.type === "none") {
      this._setPreview(slot, { state: "unavailable", key, reason: plan.reason });
      return;
    }
    const entryId = this.entryId;
    if (!entryId || !this.hass) {
      this._setPreview(slot, { state: "unavailable", key, reason: "Preview unavailable." });
      return;
    }
    this._setPreview(slot, { state: "loading", key });
    loadDescriptorPreview(this.hass, entryId, descriptor).then(
      (preview) => {
        const poster = preview.frames[posterFrameIndex(preview.frames)];
        if (this._previews[slot].state === "loading" && (this._previews[slot] as { key: string }).key === key) {
          this._setPreview(slot, { state: "ready", key, frames: preview.frames, poster: poster ? [poster] : preview.frames });
        }
      },
      (error: unknown) => {
        if (this._previews[slot].state === "loading" && (this._previews[slot] as { key: string }).key === key) {
          this._setPreview(slot, { state: "error", key, message: error instanceof Error ? error.message : "Preview unavailable." });
        }
      },
    );
  }

  private _select(slot: SlotId): void {
    if (!this.entryId || slot === this._target) return;
    setSlotChoice(this.entryId, slot);
  }

  private _toast(message: string): void {
    this.dispatchEvent(new CustomEvent("lu-toast", { detail: { message, timeoutMs: 5000 }, bubbles: true, composed: true }));
  }

  /** Presses the clock's power key once from Home Assistant. It is a toggle and nothing comes back, so this never touches
   * the highlighted target and never says which screen is showing. */
  private async _switchScreen(): Promise<void> {
    if (!this.entryId || !this.hass?.callWS || this._switching) return;
    this._switching = true;
    try {
      await this.hass.callWS(switchScreenRequest(this.entryId));
      this._toast("Switched. Press again to go back.");
    } catch (error) {
      this._toast(`Couldn't switch the screen: ${error instanceof Error ? error.message : (error as { message?: string })?.message ?? "the clock did not answer"}`);
    } finally {
      this._switching = false;
    }
  }

  private _onKeydown(event: KeyboardEvent): void {
    const next = keyedSlot(event, this._target, SLOT_IDS);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    this._select(next);
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLButtonElement>(`[data-slot="${next}"]`)?.focus());
  }

  private _onFocus(event: FocusEvent, slot: SlotId): void {
    if ((event.currentTarget as HTMLElement).matches(":focus-visible")) this._focusPlaying = slot;
  }

  private _renderPlate(slot: SlotId, record: SlotRecord | null) {
    const preview = this._previews[slot];
    const title = record?.title ?? "";
    if (!record) return html`<div class="plate placeholder"><span>Nothing sent from Home Assistant yet</span></div>`;
    if (preview.state === "ready") {
      const playing = this._focusPlaying === slot && preview.frames.length > 1;
      return html`<iledclock-led-preview class="plate-preview" context="tile" .frames=${playing ? preview.frames : preview.poster} .playing=${playing} label=${`${slotLabel(slot)}: ${title}`}></iledclock-led-preview>`;
    }
    if (preview.state === "loading") return html`<div class="plate loading" role="status" aria-label="Loading preview"></div>`;
    const kind = record.descriptor?.kind ?? "";
    const icon = KIND_ICONS[kind];
    const text = preview.state === "unavailable" ? preview.reason : preview.state === "error" ? "Preview unavailable." : "";
    return html`<div class="plate placeholder">${icon ? html`<span class="glyph">${mdiIcon(icon)}</span>` : nothing}<span>${text}</span></div>`;
  }

  private _renderTile(slot: SlotId) {
    const record = this.slots?.[slot] ?? null;
    const selected = this._target === slot;
    const lastSent = this.slots?.last_written === slot;
    const locale = this.hass?.locale?.language ?? this.hass?.language;
    const caption = record ? slotRecordCaption(record, this._now, locale) : "";
    const spoken = [slotLabel(slot), record ? record.title : "nothing sent from Home Assistant yet", caption.toLowerCase(), lastSent ? "last sent" : ""].filter(Boolean).join(", ");
    return html`<button type="button" role="radio" class="tile ${selected ? "selected" : ""}" data-slot=${slot} aria-checked=${selected ? "true" : "false"} aria-label=${spoken}
      tabindex=${selected ? "0" : "-1"} @click=${() => this._select(slot)} @pointerenter=${(event: PointerEvent) => event.pointerType === "mouse" && (this._focusPlaying = slot)} @pointerleave=${() => (this._focusPlaying = null)}
      @focus=${(event: FocusEvent) => this._onFocus(event, slot)} @blur=${() => (this._focusPlaying = null)}>
      <span class="plate-wrap" aria-hidden="true">
        ${this._renderPlate(slot, record)}
        ${selected ? html`<span class="check">${mdiIcon("check")}</span>` : nothing}
      </span>
      <span class="meta" aria-hidden="true">
        <span class="name">${slotLabel(slot)}</span>
        ${lastSent ? html`<span class="marker">Last sent</span>` : nothing}
      </span>
      ${record ? html`<span class="title" aria-hidden="true">${record.title}</span><span class="caption" aria-hidden="true">${caption}</span>` : nothing}
    </button>`;
  }

  render() {
    if (!this.slots) return nothing;
    const switchBlock = switchScreenBlockReason({ connected: this.connected, power: this.power });
    return html`<div class="tiles" role="radiogroup" aria-label="Where the next show goes" @keydown=${this._onKeydown}>${SLOT_IDS.map((slot) => this._renderTile(slot))}</div>
      <p class="target" role="status">Next show goes to screen ${this._target.toUpperCase()}.</p>
      <div class="hint-row"><p class="hint">Press the clock's power button to switch.</p>
        <lu-pill-button variant="quiet" icon="mdi:swap-horizontal" label="Switch screen" ?loading=${this._switching} ?disabled=${switchBlock !== null} @lu-press=${this._switchScreen}></lu-pill-button></div>
      ${switchBlock ? html`<p class="hint" id="switch-note">${switchBlock}</p>` : nothing}`;
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--lu-space-3); min-width: 0; }
    .tile { box-sizing: border-box; display: grid; align-content: start; gap: var(--lu-space-1); min-width: 0; padding: var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); color: var(--lu-ink); background: transparent; text-align: left; font: 400 var(--lu-type-label)/1.3 var(--lu-font); cursor: pointer; transition: background-color var(--lu-motion-label) var(--lu-ease); }
    @media (hover: hover) { .tile:hover { background: var(--lu-tile); } }
    .tile.selected { border-color: var(--lu-accent); background: var(--lu-accent-soft); box-shadow: inset 0 0 0 1px var(--lu-accent); }
    .tile:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .plate-wrap { position: relative; display: block; min-width: 0; margin-bottom: var(--lu-space-1); }
    .plate-preview { width: 100%; }
    .plate { box-sizing: border-box; display: grid; place-items: center; align-content: center; gap: var(--lu-space-1); width: 100%; aspect-ratio: 2 / 1; padding: var(--lu-space-2); border-radius: var(--lu-radius-control); text-align: center; font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .plate.placeholder { border: 1px dashed var(--lu-edge-raised); color: var(--lu-ink-2); background: var(--lu-tile); }
    .plate.loading { background: var(--lu-tile); }
    .glyph { display: inline-grid; font-size: var(--lu-space-6); color: var(--lu-ink-2); }
    .check { position: absolute; top: var(--lu-space-1); right: var(--lu-space-1); display: grid; place-items: center; width: var(--lu-space-5); height: var(--lu-space-5); border-radius: var(--lu-radius-pill); color: var(--lu-accent-ink); background: var(--lu-accent); font-size: var(--lu-type-label); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--lu-space-1) var(--lu-space-2); min-width: 0; }
    .name { font: 600 var(--lu-type-label)/1.3 var(--lu-font); }
    .marker { padding: 0 var(--lu-space-2); border: 1px solid var(--lu-edge-raised); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.5 var(--lu-font); white-space: nowrap; }
    .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .caption { color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .target { margin: var(--lu-space-3) 0 0; color: var(--lu-ink); font: 500 var(--lu-type-label)/1.4 var(--lu-font); }
    .hint { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .hint-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--lu-space-2); }
    @container (max-width: 279px) { .tiles { grid-template-columns: minmax(0, 1fr); } }
    @media (prefers-reduced-motion: reduce) { .tile { transition: none; } }
  `];
}

customElements.define("iledclock-slot-tiles", IledclockSlotTiles);

declare global { interface HTMLElementTagNameMap { "iledclock-slot-tiles": IledclockSlotTiles; } }
