import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import { describeSmooth, isSpeedKey, paceCaption, showStrobeCaution, snapSpeed, speedLabel, speedValueText, steppedSpeed } from "../lib/playback.ts";
import type { PlaybackSession, PlaybackState } from "../lib/playback-session.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./lu-pill-button.ts";

/** `detail` of `playback-input` (every drag step) and `playback-commit` (release, key, switch, reset). */
export type PlaybackEventDetail = PlaybackState;

/** The Speed slider plus the Smooth motion switch for one `PlaybackSession`. It owns no playback state:
 * every change goes to the session, and the session's `onChange` re-renders it. Renders nothing for a
 * single picture (`session.hasMotion === false`). */
export class IledclockPlaybackControl extends LitElement {
  static properties = {
    session: { attribute: false },
    label: { type: String },
    disabled: { type: Boolean, reflect: true },
    _announcement: { state: true },
  };

  declare session: PlaybackSession | null;
  declare label: string;
  declare disabled: boolean;
  declare _announcement: string;

  private readonly _rangeRef = createRef<HTMLInputElement>();
  private _unsubscribe: (() => void) | null = null;
  private _subscribed: PlaybackSession | null = null;
  /** A drag moved the slider and has not been committed yet. */
  private _uncommitted = false;

  constructor() {
    super();
    this.session = null;
    this.label = "Speed";
    this.disabled = false;
    this._announcement = "";
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._subscribe();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._subscribed = null;
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("session")) this._subscribe();
  }

  private _subscribe(): void {
    if (this._subscribed === this.session && this._unsubscribe) return;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._subscribed = this.session;
    this._uncommitted = false;
    if (this.session) this._unsubscribe = this.session.subscribe(() => this.requestUpdate());
  }

  private _emit(type: "playback-input" | "playback-commit"): void {
    const session = this.session;
    if (!session) return;
    this.dispatchEvent(new CustomEvent<PlaybackEventDetail>(type, { detail: session.state, bubbles: true, composed: true }));
  }

  /** The slider value that shows `speed`: the Original marker for null. */
  private _position(speed: number | null, session: PlaybackSession): number {
    return speed === null ? session.originalSpeed : speed;
  }

  private _onInput = (event: Event): void => {
    const session = this.session;
    const range = event.target as HTMLInputElement;
    if (!session || this.disabled) return;
    const speed = snapSpeed(Number(range.value), session.originalSpeed);
    // Show the snap right away: Lit only rewrites the DOM value when the bound value changes.
    range.value = String(this._position(speed, session));
    this._uncommitted = true;
    session.setState({ speed });
    this._emit("playback-input");
  };

  /** Release, blur or a native change after a drag: the user has settled on this value. */
  private _commitDrag = (): void => {
    if (!this._uncommitted || !this.session) return;
    this._uncommitted = false;
    this.session.setState({}, { commit: true });
    this._announce();
    this._emit("playback-commit");
  };

  private _onKeyDown = (event: KeyboardEvent): void => {
    const session = this.session;
    if (!session || this.disabled || event.altKey || event.ctrlKey || event.metaKey || !isSpeedKey(event.key)) return;
    event.preventDefault();
    const speed = steppedSpeed(session.speed, event.key, session.originalSpeed);
    const range = this._rangeRef.value;
    if (range) range.value = String(this._position(speed, session));
    this._uncommitted = false;
    session.setState({ speed }, { commit: true });
    this._announce();
    this._emit("playback-input");
    this._emit("playback-commit");
  };

  private _toggleSmooth = (): void => {
    const session = this.session;
    if (!session || this.disabled) return;
    const next = session.smooth === "off" ? "on" : "off";
    session.setState({ smooth: next }, { commit: true });
    this._emit("playback-input");
    this._emit("playback-commit");
  };

  private _reset = (): void => {
    const session = this.session;
    if (!session || this.disabled) return;
    this._uncommitted = false;
    session.reset();
    this._announce();
    this._emit("playback-commit");
  };

  /** Tell screen readers what a committed change did (not on every drag step). */
  private _announce(): void {
    const session = this.session;
    if (!session) return;
    const caption = paceCaption(session.speed, session.authoredFrames, session.nativeFps);
    this._announcement = caption ? `${speedLabel(session.speed)}. ${caption}` : speedLabel(session.speed);
  }

  render() {
    const session = this.session;
    if (!session || !session.hasMotion) return nothing;
    const speed = session.speed;
    const position = this._position(speed, session);
    const original = session.originalSpeed;
    const caption = paceCaption(speed, session.authoredFrames, session.nativeFps);
    const smooth = describeSmooth(session.info, session.smooth);
    const smoothDisabled = this.disabled || smooth.disabled;
    return html`<section class="speed" aria-busy=${session.loading ? "true" : "false"}>
      <div class="head">
        <label class="heading" id="speed-label" for="speed-range">${this.label}</label>
        <span class="value" aria-hidden="true">${speedLabel(speed)}</span>
      </div>
      <div class="slider" style="--p: ${position}; --o: ${original}">
        <input
          id="speed-range"
          class="range"
          type="range"
          min="0"
          max="100"
          step="any"
          .value=${String(position)}
          ?disabled=${this.disabled}
          aria-labelledby="speed-label"
          aria-valuetext=${speedValueText(speed, session.authoredFrames, session.nativeFps)}
          ${ref(this._rangeRef)}
          @input=${this._onInput}
          @change=${this._commitDrag}
          @pointerup=${this._commitDrag}
          @blur=${this._commitDrag}
          @keydown=${this._onKeyDown}
        />
        <span class="tick" aria-hidden="true"></span>
        <span class="tick-label" aria-hidden="true">Original</span>
      </div>
      ${caption ? html`<p class="caption">${caption}</p>` : nothing}
      ${session.error ? html`<p class="error" role="alert">${session.error}</p>` : nothing}
      ${showStrobeCaution(speed) ? html`<p class="caution" role="note">Very fast playback can look like strobing on high-contrast art.</p>` : nothing}
      <div class="live" role="status" aria-live="polite" aria-atomic="true">${this._announcement}</div>
      ${speed !== null
        ? html`<div class="reset"><lu-pill-button variant="quiet" label="Reset to Original" ?disabled=${this.disabled} @lu-press=${this._reset}></lu-pill-button></div>`
        : nothing}
      <button
        class="smooth-row"
        type="button"
        role="switch"
        aria-checked=${smooth.checked ? "true" : "false"}
        aria-labelledby="smooth-label"
        aria-describedby="smooth-status"
        ?disabled=${smoothDisabled}
        @click=${this._toggleSmooth}
      >
        <span class="smooth-text">
          <span class="smooth-label" id="smooth-label">Smooth motion</span>
          <span class="smooth-status" id="smooth-status">${smooth.text}</span>
        </span>
        <span class="switch ${smooth.checked ? "on" : ""}" aria-hidden="true"><span></span></span>
      </button>
    </section>`;
  }

  static styles = [
    TOKENS_CSS,
    css`
      :host { display: block; min-width: 0; container-type: inline-size; color: var(--lu-ink); font-family: var(--lu-font); }
      :host([hidden]) { display: none; }
      .speed { position: relative; display: flex; flex-direction: column; gap: var(--lu-space-2); min-width: 0; }
      .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--lu-space-3); min-width: 0; }
      .heading { font: 600 var(--lu-type-label) / 1.3 var(--lu-font); color: var(--lu-ink); }
      .value { font: 600 var(--lu-type-numeral) / 1.2 var(--lu-font); font-variant-numeric: tabular-nums; color: var(--lu-ink); text-align: right; }

      .slider {
        --thumb: 28px;
        --track: 6px;
        --thumb-x: calc(var(--p) * 1% + (0.5 - var(--p) / 100) * var(--thumb));
        --tick-x: calc(var(--o) * 1% + (0.5 - var(--o) / 100) * var(--thumb));
        position: relative;
        padding-bottom: var(--lu-space-5);
      }
      .range {
        -webkit-appearance: none;
        appearance: none;
        display: block;
        width: 100%;
        height: var(--lu-target);
        margin: 0;
        padding: 0;
        position: relative;
        z-index: 1;
        background: transparent;
        cursor: pointer;
        touch-action: pan-y;
        outline: none;
      }
      .range:disabled { cursor: default; opacity: 0.55; }
      .range::-webkit-slider-runnable-track {
        height: var(--track);
        border-radius: var(--lu-radius-pill);
        background: linear-gradient(to right, var(--lu-accent) 0, var(--lu-accent) var(--thumb-x), var(--lu-track-off) var(--thumb-x), var(--lu-track-off) 100%);
      }
      .range::-moz-range-track {
        height: var(--track);
        border-radius: var(--lu-radius-pill);
        background: linear-gradient(to right, var(--lu-accent) 0, var(--lu-accent) var(--thumb-x), var(--lu-track-off) var(--thumb-x), var(--lu-track-off) 100%);
      }
      .range::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        box-sizing: border-box;
        width: var(--thumb);
        height: var(--thumb);
        margin-top: calc((var(--track) - var(--thumb)) / 2);
        border: 3px solid var(--lu-card);
        border-radius: 50%;
        background: var(--lu-accent);
        box-shadow: var(--lu-shadow-pressed);
      }
      .range::-moz-range-thumb {
        box-sizing: border-box;
        width: var(--thumb);
        height: var(--thumb);
        border: 3px solid var(--lu-card);
        border-radius: 50%;
        background: var(--lu-accent);
        box-shadow: var(--lu-shadow-pressed);
      }
      .range:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
      .range:focus-visible::-moz-range-thumb { outline: 2px solid var(--lu-accent); outline-offset: 2px; }

      /* The Original tick: same offset formula as the thumb, so it sits exactly under the thumb centre at that value. */
      .tick {
        position: absolute;
        top: calc((var(--lu-target) - var(--track)) / 2 - var(--lu-space-2));
        left: var(--tick-x);
        width: 2px;
        height: calc(var(--track) + var(--lu-space-4));
        margin-left: -1px;
        border-radius: 1px;
        background: var(--lu-ink-2);
        pointer-events: none;
      }
      .tick-label {
        --label-half: 30px;
        position: absolute;
        top: calc(var(--lu-target) - var(--lu-space-2));
        left: clamp(var(--label-half), var(--tick-x), calc(100% - var(--label-half)));
        transform: translateX(-50%);
        font: 500 var(--lu-type-caption) / 1.2 var(--lu-font);
        color: var(--lu-ink-2);
        pointer-events: none;
        white-space: nowrap;
      }

      .caption { margin: 0; font: 400 var(--lu-type-label) / 1.4 var(--lu-font); color: var(--lu-ink-2); font-variant-numeric: tabular-nums; }
      .error { margin: 0; font: 500 var(--lu-type-label) / 1.4 var(--lu-font); color: var(--lu-danger); }
      .caution { margin: 0; padding-left: var(--lu-space-3); border-left: 3px solid var(--lu-warning); font: 400 var(--lu-type-caption) / 1.4 var(--lu-font); color: var(--lu-ink-2); }
      .live { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
      .reset { display: flex; }

      .smooth-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--lu-space-3);
        width: 100%;
        min-height: var(--lu-target);
        margin: var(--lu-space-1) 0 0;
        padding: var(--lu-space-2) 0;
        border: 0;
        border-top: 1px solid var(--lu-edge);
        background: transparent;
        color: var(--lu-ink);
        text-align: left;
        font: inherit;
        cursor: pointer;
      }
      .smooth-row:disabled { opacity: 0.55; cursor: default; }
      .smooth-row:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; border-radius: var(--lu-radius-control); }
      .smooth-text { display: flex; flex-direction: column; gap: var(--lu-space-1); min-width: 0; }
      .smooth-label { font: 600 var(--lu-type-label) / 1.3 var(--lu-font); }
      .smooth-status { font: 400 var(--lu-type-caption) / 1.4 var(--lu-font); color: var(--lu-ink-2); overflow-wrap: anywhere; }
      .switch { display: grid; align-items: center; justify-content: start; width: 42px; height: 26px; padding: 2px; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); }
      .switch.on { justify-content: end; background: var(--lu-accent); }
      .switch span { width: 22px; height: 22px; border-radius: 50%; background: var(--lu-card); box-shadow: var(--lu-shadow-pressed); }

      @container (max-width: 359px) {
        .head { flex-wrap: wrap; }
        .value { font-size: var(--lu-type-title); }
        .reset lu-pill-button { width: 100%; }
        .smooth-row { gap: var(--lu-space-2); }
      }
      @media (prefers-reduced-motion: reduce) {
        * { transition: none !important; animation: none !important; }
      }
    `,
  ];
}

customElements.define("iledclock-playback-control", IledclockPlaybackControl);

declare global { interface HTMLElementTagNameMap { "iledclock-playback-control": IledclockPlaybackControl; } }
