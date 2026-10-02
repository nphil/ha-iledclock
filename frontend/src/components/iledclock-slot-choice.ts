import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { Capabilities, ContentClass, HomeAssistant, SlotId } from "../types.ts";
import { SLOT_IDS, cachedSlotCapabilities, effectiveSlot, keyedSlot, loadSlotCapabilities, setSlotChoice, slotAllowance, slotChoices, slotLabel } from "../lib/slots.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";

/** A failed capability read is tried again on a later `hass` update, but not more often than this. */
const CAPABILITY_RETRY_MS = 5000;

/** The compact "Screen  A | B" choice that sits next to every "Show on clock" action.
 *
 * It shows the screen a Show will write to RIGHT NOW: the remembered choice for this clock (shared with every other
 * control and with the screen tiles), unless the content cannot go on screen B, in which case it shows A, greys B and
 * says why in one line underneath (linked with `aria-describedby`). The remembered choice itself is only changed by
 * tapping an available segment, so B comes back by itself for the next clock face. While B is remembered and the clock's
 * reply about what B takes is still out, neither segment is selected: a Show waits for that same reply.
 *
 * Properties: `.hass`, `.entryId`, `content-class` (a `ContentClass`, default "art"), optional `.capabilities` (the live
 * state's capabilities; without them the clock's are looked up once and cached), `label` (default "Screen"),
 * `disabled`. Emits `slot-selected` ({slot}) after the user changes the choice. */
export class IledclockSlotChoice extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    contentClass: { type: String, attribute: "content-class" },
    capabilities: { attribute: false },
    label: { type: String },
    disabled: { type: Boolean, reflect: true },
    _remembered: { state: true },
    _loaded: { state: true },
    _checking: { state: true },
  };

  declare hass: HomeAssistant | undefined;
  declare entryId: string | undefined;
  declare contentClass: ContentClass;
  declare capabilities: Capabilities | null | undefined;
  declare label: string;
  declare disabled: boolean;
  declare _remembered: SlotId;
  declare _loaded: Capabilities | null;
  declare _checking: boolean;

  private _unsubscribe: (() => void) | null = null;
  private _lastAttempt = 0;
  private _boundEntry: string | undefined;
  /** Which capability request owns `_checking`: bumped when the clock changes, so an answer for the previous clock is ignored. */
  private _capabilityRequest = 0;

  constructor() {
    super();
    this.contentClass = "art";
    this.label = "Screen";
    this.disabled = false;
    this._remembered = "a";
    this._loaded = null;
    this._checking = false;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._unsubscribe = slotChoices.subscribe((change) => {
      if (change.entryId === this.entryId) this._remembered = change.slot;
    });
    if (this.entryId) this._remembered = slotChoices.get(this.entryId);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("entryId") && this.entryId !== this._boundEntry) {
      this._boundEntry = this.entryId;
      this._remembered = this.entryId ? slotChoices.get(this.entryId) : "a";
      this._loaded = this.entryId ? cachedSlotCapabilities(this.entryId) : null;
      this._lastAttempt = 0;
      // A request for the previous clock may still be out: its answer is ignored, and it must not keep this clock's own from starting.
      this._capabilityRequest++;
      this._checking = false;
    }
    if (this.entryId && this.hass && !this.capabilities?.slots && !this._loaded && !this._checking && Date.now() - this._lastAttempt >= CAPABILITY_RETRY_MS) {
      void this._loadCapabilities(this.entryId);
    }
  }

  private async _loadCapabilities(entryId: string): Promise<void> {
    const request = ++this._capabilityRequest;
    this._checking = true;
    this._lastAttempt = Date.now();
    const loaded = await loadSlotCapabilities(this.hass, entryId);
    if (request !== this._capabilityRequest) return;
    this._loaded = loaded;
    this._checking = false;
  }

  private _knownCapabilities(): Capabilities | null {
    return this.capabilities?.slots ? this.capabilities : this._loaded;
  }

  private _allowance(slot: SlotId) {
    return slotAllowance(slot, this.contentClass, this._knownCapabilities());
  }

  /** The screen a Show goes to now: the remembered choice when B takes this content, B for a date page (the clock always files
   * it there), else A. The remembered choice itself is never rewritten by this. */
  private _effective(): SlotId {
    return this.entryId ? effectiveSlot(this.entryId, this.contentClass, this._knownCapabilities()) : "a";
  }

  /** Screen B is remembered but what it takes is not known yet (the clock's reply is still out). Neither screen can truthfully be shown
   * as where a Show goes, and a Show waits for the same reply, so for that moment nothing is selected. */
  private _undecided(): boolean {
    return this._checking && !this._knownCapabilities() && this._remembered === "b" && this.contentClass !== "date";
  }

  private _choose(slot: SlotId): void {
    if (!this.entryId || this.disabled || (slot === this._effective() && !this._undecided()) || !this._allowance(slot).ok) return;
    setSlotChoice(this.entryId, slot);
    this.dispatchEvent(new CustomEvent("slot-selected", { detail: { slot }, bubbles: true, composed: true }));
  }

  private _onKeydown(event: KeyboardEvent): void {
    const target = keyedSlot(event, this._effective(), SLOT_IDS.filter((slot) => this._allowance(slot).ok));
    if (!target) return;
    event.preventDefault();
    // Handled here: the arrow keys must not also reach a parent that uses them (the Explore sheet's previous / next artwork).
    event.stopPropagation();
    this._choose(target);
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLButtonElement>(`[data-slot="${target}"]`)?.focus());
  }

  render() {
    const effective = this._undecided() ? null : this._effective();
    const loading = this._checking && !this._knownCapabilities();
    const inactive = this.disabled || !this.entryId;
    const blockedSlot = SLOT_IDS.find((slot) => !this._allowance(slot).ok);
    const reason = blockedSlot && !(loading && blockedSlot === "b") ? this._allowance(blockedSlot).reason : null;
    return html`<div class="choice">
      <div class="row">
        <span class="label" id="slot-label">${this.label}</span>
        <div class="segments" role="radiogroup" aria-labelledby="slot-label" aria-busy=${loading ? "true" : "false"} @keydown=${this._onKeydown}>
          ${SLOT_IDS.map((slot) => {
            const blocked = !this._allowance(slot).ok && !(loading && slot === "b");
            return html`<button type="button" role="radio" class="segment ${slot === effective ? "selected" : ""} ${blocked ? "blocked" : ""}" data-slot=${slot}
              aria-checked=${slot === effective ? "true" : "false"} aria-disabled=${blocked || inactive ? "true" : "false"} aria-label=${slotLabel(slot)}
              aria-describedby=${blocked && reason ? "slot-reason" : nothing} @click=${() => this._choose(slot)}>${slot.toUpperCase()}</button>`;
          })}
        </div>
      </div>
      ${reason ? html`<p class="reason" id="slot-reason">${reason}</p>` : nothing}
    </div>`;
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; min-width: 0; }
    .choice { display: grid; gap: var(--lu-space-1); min-width: 0; }
    .row { display: flex; align-items: center; gap: var(--lu-space-3); min-width: 0; }
    .label { color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.2 var(--lu-font); }
    .segments { display: inline-flex; border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-tile); }
    .segment { box-sizing: border-box; min-width: var(--lu-target); min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 0; border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: transparent; font: 600 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; transition: background-color var(--lu-motion-label) var(--lu-ease), color var(--lu-motion-label) var(--lu-ease); }
    .segment.selected { color: var(--lu-accent-ink); background: var(--lu-accent); box-shadow: var(--lu-highlight-raised); }
    .segment.blocked { color: var(--lu-ink-3); cursor: not-allowed; }
    .segment:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .reason { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.35 var(--lu-font); }
    @media (prefers-reduced-motion: reduce) { .segment { transition: none; } }
  `];
}

customElements.define("iledclock-slot-choice", IledclockSlotChoice);

declare global { interface HTMLElementTagNameMap { "iledclock-slot-choice": IledclockSlotChoice; } }
