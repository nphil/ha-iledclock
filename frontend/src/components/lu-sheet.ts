import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./lu-icon-button.ts";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function deepestActiveElement(): HTMLElement | null {
  let active: Element | null = document.activeElement;
  while (active instanceof HTMLElement && active.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
}

export class LuSheet extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    label: { type: String },
    closeOnScrim: { type: Boolean, attribute: "close-on-scrim" },
  };

  declare open: boolean;
  declare label: string;
  declare closeOnScrim: boolean;

  private _previousFocus: HTMLElement | null = null;
  private _dragStart: number | null = null;
  private _dragCurrent = 0;

  constructor() {
    super();
    this.open = false;
    this.label = "Dialog";
    this.closeOnScrim = true;
  }

  protected updated(changed: PropertyValues): void {
    if (!changed.has("open")) return;
    if (this.open) {
      this._previousFocus = deepestActiveElement();
      document.addEventListener("keydown", this._onKeydown, true);
      this.updateComplete.then(() => this._focusFirst());
    } else {
      document.removeEventListener("keydown", this._onKeydown, true);
      this._previousFocus?.focus();
      this._previousFocus = null;
      this._dragStart = null;
      this._dragCurrent = 0;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._onKeydown, true);
  }

  private _close(): void {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("closed", { bubbles: true, composed: true }));
  }

  private _onKeydown = (event: KeyboardEvent): void => {
    if (!this.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this._close();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = this.renderRoot.querySelector<HTMLElement>(".dialog");
    if (!dialog) return;
    const focusable = this._getFocusable(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = this._activeFocusable(focusable);
    const index = active ? focusable.indexOf(active) : -1;
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) {
      event.preventDefault();
      first.focus();
    }
  };

  private _getFocusable(dialog: HTMLElement): HTMLElement[] {
    const result: HTMLElement[] = [];
    const isVisible = (element: HTMLElement): boolean => element.getClientRects().length > 0;
    const visit = (node: Node): void => {
      if (node instanceof HTMLSlotElement) {
        const assigned = node.assignedNodes({ flatten: true });
        for (const child of assigned.length > 0 ? assigned : Array.from(node.childNodes)) visit(child);
        return;
      }
      if (node instanceof HTMLElement) {
        if (node.matches(FOCUSABLE) && isVisible(node)) result.push(node);
        const children = node.shadowRoot?.childNodes ?? node.childNodes;
        for (const child of Array.from(children)) visit(child);
        return;
      }
      for (const child of Array.from(node.childNodes)) visit(child);
    };
    for (const child of Array.from(dialog.childNodes)) visit(child);
    return result;
  }

  private _activeFocusable(focusable: HTMLElement[]): HTMLElement | null {
    let active: Element | null = document.activeElement;
    let match: HTMLElement | null = null;
    while (active instanceof HTMLElement) {
      if (focusable.includes(active)) match = active;
      active = active.shadowRoot?.activeElement ?? null;
    }
    return match;
  }

  private _focusFirst(): void {
    const dialog = this.renderRoot.querySelector<HTMLElement>(".dialog");
    const first = dialog ? this._getFocusable(dialog)[0] : undefined;
    (first ?? dialog)?.focus();
  }

  private _onScrim = (event: MouseEvent): void => {
    if (event.target === event.currentTarget && this.closeOnScrim) this._close();
  };

  private _onDragStart = (event: PointerEvent): void => {
    if (this.getBoundingClientRect().width >= 600) return;
    this._dragStart = event.clientY;
    this._dragCurrent = 0;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  private _onDragMove = (event: PointerEvent): void => {
    if (this._dragStart === null) return;
    this._dragCurrent = Math.max(0, event.clientY - this._dragStart);
    this.style.setProperty("--lu-sheet-drag", this._dragCurrent + "px");
  };

  private _onDragEnd = (): void => {
    if (this._dragStart === null) return;
    const shouldClose = this._dragCurrent > 80;
    this._dragStart = null;
    this._dragCurrent = 0;
    this.style.removeProperty("--lu-sheet-drag");
    if (shouldClose) this._close();
  };

  render() {
    if (!this.open) return nothing;
    return html`<div class="overlay" @click=${this._onScrim}>
      <section class="dialog" role="dialog" aria-modal="true" aria-label=${this.label} tabindex="-1">
        <button class="handle" type="button" aria-label="Drag down to close" @pointerdown=${this._onDragStart} @pointermove=${this._onDragMove} @pointerup=${this._onDragEnd} @pointercancel=${this._onDragEnd}><span></span></button>
        <header class="header"><slot name="header"></slot><lu-icon-button icon="mdi:close" tooltip="Close" aria-label="Close dialog" @lu-press=${this._close}></lu-icon-button></header>
        <div class="body"><slot></slot></div>
        <footer><slot name="footer"></slot></footer>
      </section>
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; container-type: inline-size; }
    :host(:not([open])) { display: none; }
    .overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end; justify-content: center; background: linear-gradient(180deg, var(--lu-scrim-top), var(--lu-scrim) 48%, var(--lu-scrim-bottom)); }
    .dialog { display: flex; flex-direction: column; width: 100%; max-height: 92%; overflow: hidden; background: var(--lu-card); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-sheet) var(--lu-radius-sheet) 0 0; box-shadow: var(--lu-highlight-rest), var(--lu-shadow-rest); transform: translateY(var(--lu-sheet-drag, 0)); transition: transform var(--lu-motion-layer) var(--lu-ease); }
    .handle { display: flex; justify-content: center; align-items: center; min-height: var(--lu-space-6); padding: var(--lu-space-2); border: 0; background: transparent; touch-action: none; }
    .handle span { display: block; width: var(--lu-space-8); height: var(--lu-space-1); border-radius: var(--lu-radius-pill); background: var(--lu-ink-3); }
    .header { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-3); padding: 0 var(--lu-space-4) var(--lu-space-3); }
    .body { min-height: 0; overflow: auto; padding: 0 var(--lu-space-4) var(--lu-space-4); overscroll-behavior: contain; }
    footer:empty { display: none; }
    footer { padding: var(--lu-space-3) var(--lu-space-4) calc(var(--lu-space-4) + env(safe-area-inset-bottom)); border-top: 1px solid var(--lu-edge); }
    @container (min-width: 600px) {
      .overlay { align-items: center; padding: var(--lu-space-4); }
      .dialog { width: min(100%, 560px); max-height: min(90%, 800px); border-radius: var(--lu-radius-sheet); }
      .handle { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .dialog { transition-duration: var(--lu-motion-layer); } }
  `];
}

customElements.define("lu-sheet", LuSheet);

declare global { interface HTMLElementTagNameMap { "lu-sheet": LuSheet; } }
