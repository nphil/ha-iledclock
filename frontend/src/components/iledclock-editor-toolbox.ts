import { LitElement, css, html } from "lit";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import { mdiIcon, type MdiIconName } from "../lib/mdi-icons.ts";
import "./lu-sheet.ts";

type EditorTool = "pen" | "eraser" | "fill" | "line" | "rectangle" | "ellipse" | "eyedropper" | "text" | "pan" | "shift";

interface ToolDefinition { tool: EditorTool; label: string; icon: MdiIconName; }

const PRIMARY_TOOLS: readonly ToolDefinition[] = [
  { tool: "pen", label: "Pen", icon: "pen" },
  { tool: "eraser", label: "Eraser", icon: "eraser" },
  { tool: "fill", label: "Fill", icon: "fill" },
  { tool: "line", label: "Line", icon: "line" },
  { tool: "rectangle", label: "Rectangle", icon: "rectangle" },
  { tool: "ellipse", label: "Ellipse", icon: "ellipse" },
];

const SECONDARY_TOOLS: readonly ToolDefinition[] = [
  { tool: "eyedropper", label: "Eyedropper", icon: "eyedropper" },
  { tool: "text", label: "Text stamp", icon: "textStamp" },
  { tool: "pan", label: "Move canvas", icon: "shift" },
  { tool: "shift", label: "Shift artwork", icon: "shift" },
];

export class IledclockEditorToolbox extends LitElement {
  static properties = {
    tool: { type: String },
    narrow: { type: Boolean, reflect: true },
    filled: { type: Boolean },
    wrap: { type: Boolean },
    activeColor: { attribute: false },
    _moreOpen: { state: true },
  };

  declare tool: EditorTool;
  declare narrow: boolean;
  declare filled: boolean;
  declare wrap: boolean;
  declare activeColor: readonly [number, number, number];
  declare _moreOpen: boolean;

  constructor() {
    super();
    this.tool = "pen";
    this.narrow = true;
    this.filled = false;
    this.wrap = false;
    this.activeColor = [255, 255, 255];
    this._moreOpen = false;
  }

  private _send(name: string, detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _select(tool: EditorTool): void {
    this._send("editor-tool-selected", { tool });
    this._moreOpen = false;
  }

  private _renderTool(definition: ToolDefinition) {
    return html`<button type="button" class="tool ${this.tool === definition.tool ? "selected" : ""}" aria-label=${definition.label} title=${definition.label} aria-pressed=${String(this.tool === definition.tool)} @click=${() => this._select(definition.tool)}>${mdiIcon(definition.icon)}<span>${definition.label}</span></button>`;
  }

  private _renderMirror(axis: "horizontal" | "vertical") {
    const label = axis === "horizontal" ? "Mirror horizontal" : "Mirror vertical";
    return html`<button type="button" class="tool" aria-label=${label} title=${label} @click=${() => { this._send("editor-mirror-requested", { axis }); this._moreOpen = false; }}>${mdiIcon(axis === "horizontal" ? "flipH" : "flipV")}<span>${label}</span></button>`;
  }

  private _toggleFilled(): void { this._send("editor-filled-changed", { filled: !this.filled }); }
  private _toggleWrap(): void { this._send("editor-wrap-changed", { wrap: !this.wrap }); }

  render() {
    return html`
      <nav class="rail" aria-label="Drawing tools">
        <div class="tool-group" role="group" aria-label="Draw">${this._renderTool(PRIMARY_TOOLS[0]!)}${this._renderTool(PRIMARY_TOOLS[1]!)}${this._renderTool(PRIMARY_TOOLS[2]!)}${this._renderTool(SECONDARY_TOOLS[0]!)}${this._renderTool(SECONDARY_TOOLS[1]!)}</div>
        <div class="tool-group" role="group" aria-label="Shape">${this._renderTool(PRIMARY_TOOLS[3]!)}${this._renderTool(PRIMARY_TOOLS[4]!)}${this._renderTool(PRIMARY_TOOLS[5]!)}<button type="button" class="tool ${this.filled ? "selected" : ""}" aria-label=${this.filled ? "Use outline shapes" : "Use filled shapes"} aria-pressed=${String(this.filled)} @click=${this._toggleFilled}>${mdiIcon("check")}<span>${this.filled ? "Filled" : "Outline"}</span></button></div>
        <div class="tool-group" role="group" aria-label="Transform">${this._renderTool(SECONDARY_TOOLS[2]!)}${this._renderTool(SECONDARY_TOOLS[3]!)}${this._renderMirror("horizontal")}${this._renderMirror("vertical")}</div>
        <button type="button" class="tool wrap-toggle ${this.wrap ? "selected" : ""}" aria-pressed=${String(this.wrap)} @click=${this._toggleWrap} aria-label=${this.wrap ? "Disable wrap" : "Enable wrap"}><span class="wrap-mark">↻</span><span>Wrap</span></button>
      </nav>
      <div class="dock" aria-label="Drawing tools">
        ${PRIMARY_TOOLS.map((definition) => html`<button type="button" class="dock-tool ${this.tool === definition.tool ? "selected" : ""}" aria-label=${definition.label} title=${definition.label} aria-pressed=${String(this.tool === definition.tool)} @click=${() => this._select(definition.tool)}>${mdiIcon(definition.icon)}</button>`)}
        <button type="button" class="dock-color" aria-label="Choose drawing colour" title="Choose drawing colour" style=${`--swatch: rgb(${this.activeColor.join(",")})`} @click=${() => this._send("editor-color-requested")}></button>
        <button type="button" class="dock-tool" aria-label="More tools" aria-expanded=${String(this._moreOpen)} @click=${() => (this._moreOpen = true)}>${mdiIcon("menu")}</button>
      </div>
      <lu-sheet .open=${this._moreOpen} label="More drawing tools" @closed=${() => (this._moreOpen = false)}>
        <div class="more-grid" role="group" aria-label="More drawing tools">
          ${SECONDARY_TOOLS.map((definition) => this._renderTool(definition))}
          ${this._renderMirror("horizontal")}${this._renderMirror("vertical")}
          <button type="button" class="tool ${this.filled ? "selected" : ""}" aria-pressed=${String(this.filled)} @click=${this._toggleFilled}>${mdiIcon("check")}<span>${this.filled ? "Filled shapes" : "Outline shapes"}</span></button>
          <button type="button" class="tool ${this.wrap ? "selected" : ""}" aria-pressed=${String(this.wrap)} @click=${this._toggleWrap}><span class="wrap-mark">↻</span><span>${this.wrap ? "Wrap on" : "Wrap off"}</span></button>
        </div>
      </lu-sheet>
    `;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; }
    .rail { display: flex; flex-direction: column; align-items: center; gap: var(--lu-space-3); }
    .tool-group { display: flex; flex-direction: column; align-items: center; gap: var(--lu-space-1); padding: var(--lu-space-1); border-radius: var(--lu-radius-card); background: var(--lu-tile); }
    .tool, .dock-tool, .dock-color { display: inline-flex; align-items: center; justify-content: center; gap: var(--lu-space-2); min-width: var(--lu-target); min-height: var(--lu-target); border: 1px solid transparent; border-radius: var(--lu-radius-control); background: transparent; color: var(--lu-ink); cursor: pointer; font: 500 var(--lu-type-label)/1.2 var(--lu-font); }
    .tool { width: var(--lu-target); padding: var(--lu-space-1); flex-direction: column; font-size: var(--lu-type-caption); }
    .tool span:not(.wrap-mark) { max-width: 5rem; text-align: center; }
    .tool.selected, .dock-tool.selected { color: var(--lu-accent); background: var(--lu-accent-soft); border-color: var(--lu-edge-raised); }
    .wrap-toggle { width: auto; min-width: 64px; }
    .wrap-mark { font-size: var(--lu-type-numeral); }
    .dock { display: none; min-width: 0; gap: var(--lu-space-1); overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: thin; padding: var(--lu-space-1) 0; }
    .dock-tool, .dock-color { flex: 0 0 var(--lu-target); border-radius: var(--lu-radius-control); }
    .dock-color { position: relative; border: 1px solid var(--lu-edge); background: var(--swatch); }
    .dock-color:after { content: ""; position: absolute; inset: 6px; border: 2px solid color-mix(in srgb, var(--lu-ink) 42%, transparent); border-radius: var(--lu-radius-control); }
    .more-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--lu-space-2); }
    :host([narrow]) .rail { display: none; }
    :host([narrow]) .dock { display: flex; }
    button:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  `];
}

customElements.define("iledclock-editor-toolbox", IledclockEditorToolbox);

declare global { interface HTMLElementTagNameMap { "iledclock-editor-toolbox": IledclockEditorToolbox; } }
