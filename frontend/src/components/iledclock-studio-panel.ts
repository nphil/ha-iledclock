/** The Pixel Studio sidebar panel: full pixel-art editor, frame timeline, generative presets,
 * design library, playlist editor, and the online Gallery (browse/import from LaMetric/AWTRIX/
 * Divoom, owned by GalleryUI), composed around the shared
 * `iledclock-pixel-editor`/`iledclock-frame-timeline`/`iledclock-library-panel`/
 * `iledclock-playlist-editor`/`iledclock-gallery-browser`/`iledclock-import-sheet` widgets.
 * Registered by the integration via `panel_custom` (element `iledclock-studio-panel`, url_path
 * `iledclock`) -- HA hands this element `hass` and `narrow` directly; its own app bar shows a
 * menu button firing `hass-toggle-menu` only while `narrow`, per Contract E. A top-level
 * "Editor | Gallery" nav switches the body between the editor workspace and
 * `iledclock-gallery-browser`; both Gallery and the Import sheet report back via bubbling
 * `iledclock-designs-changed` (reload the library) and `iledclock-open-design {design_id}`
 * (load that design and switch back to Editor) -- this panel never builds its own second
 * image/GIF/URL importer, per the Gallery contract (docs/GALLERY.md).
 */

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { TOKENS_CSS } from "../styles/tokens.ts";
import type { ClockStateEnvelope, HomeAssistant, PlaylistItem, RenderSpec, StoredDesign, SubscribeEvent, UploadProgressEvent } from "../types.ts";
import { resolveEntryId } from "../lib/entry-id.ts";
import { createFrame, GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "../lib/grid.ts";
import { designToFrames, framesToDesign } from "../lib/design-codec.ts";
import { historyInit, historyPush, historyRedo, historyUndo, type History } from "../lib/undo-stack.ts";
import { GENERATIVE_PRESETS } from "../lib/generative-presets.ts";
import {
  commandRequest,
  designsDeleteRequest,
  designsListRequest,
  designsSaveRequest,
  normalizePlaylist,
  playlistGetRequest,
  playlistSetRequest,
  renderRequest,
  showRequest,
} from "../lib/ws-api.ts";
import { hexToRgb, type RGB } from "../lib/color.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import "./iledclock-matrix-canvas.ts";
import "./iledclock-hold-button.ts";
import "./iledclock-segmented-picker.ts";
import "./iledclock-pixel-editor.ts";
import "./iledclock-frame-timeline.ts";
import "./iledclock-library-panel.ts";
import "./iledclock-playlist-editor.ts";
import "./iledclock-gallery-browser.ts";
import "./iledclock-import-sheet.ts";

const MAX_RECENT_COLORS = 10;
const NEW_DESIGN_NAME = "Untitled design";

function newDesignId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}


/** Retry cadence while the integration finishes starting after an HA restart (~60 s total). */
const CONNECT_RETRY_MS = 3000;
const CONNECT_RETRY_LIMIT = 20;
export class IledclockStudioPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    deviceId: { attribute: "device-id" },
    _entryId: { state: true },
    _envelope: { state: true },
    _history: { state: true },
    _activeFrameIndex: { state: true },
    _activeColor: { state: true },
    _recentColors: { state: true },
    _wrap: { state: true },
    _designs: { state: true },
    _designsLoading: { state: true },
    _designName: { state: true },
    _currentDesignId: { state: true },
    _playlist: { state: true },
    _playing: { state: true },
    _uploadProgress: { state: true },
    _nav: { state: true },
    _importSheetOpen: { state: true },
    _generativeKind: { state: true },
    _generativeSeconds: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };

  declare hass: HomeAssistant;
  declare narrow: boolean;
  declare deviceId: string | undefined;
  declare _entryId: string | undefined;
  declare _envelope: ClockStateEnvelope | null;
  declare _history: History<PixelFrame[]>;
  declare _activeFrameIndex: number;
  declare _activeColor: RGB;
  declare _recentColors: RGB[];
  declare _wrap: boolean;
  declare _designs: StoredDesign[];
  declare _designsLoading: boolean;
  declare _designName: string;
  declare _currentDesignId: string | null;
  declare _playlist: PlaylistItem[];
  declare _playing: boolean;
  declare _uploadProgress: UploadProgressEvent | null;
  declare _nav: "editor" | "gallery";
  declare _importSheetOpen: boolean;
  declare _generativeKind: string;
  declare _generativeSeconds: number;
  declare _busy: string | null;
  declare _error: string | null;

  private _unsubscribe: (() => Promise<void>) | null = null;
  private _lastEntryIdSubscribed: string | undefined;

  constructor() {
    super();
    this.narrow = false;
    this._envelope = null;
    this._history = historyInit([createFrame(GRID_WIDTH, GRID_HEIGHT)]);
    this._activeFrameIndex = 0;
    this._activeColor = [34, 225, 232];
    this._recentColors = [];
    this._wrap = false;
    this._designs = [];
    this._designsLoading = false;
    this._designName = NEW_DESIGN_NAME;
    this._currentDesignId = null;
    this._playlist = [];
    this._playing = false;
    this._uploadProgress = null;
    this._nav = "editor";
    this._importSheetOpen = false;
    this._generativeKind = GENERATIVE_PRESETS[0]!.kind;
    this._generativeSeconds = 8;
    this._busy = null;
    this._error = null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("iledclock-designs-changed", this._onGalleryDesignsChanged);
    this.addEventListener("iledclock-open-design", this._onGalleryOpenDesign as unknown as EventListener);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("iledclock-designs-changed", this._onGalleryDesignsChanged);
    this.removeEventListener("iledclock-open-design", this._onGalleryOpenDesign as unknown as EventListener);
    if (this._unsubscribe) void this._unsubscribe();
  }

  protected willUpdate(changed: PropertyValues): void {
    if (!changed.has("hass") && !changed.has("deviceId")) return;
    if (!this.hass) return;
    const deviceId = this.deviceId ?? this._autoDeviceId();
    const entryId = resolveEntryId(this.hass.devices, deviceId);
    this._entryId = entryId;
    if (entryId && entryId !== this._lastEntryIdSubscribed) {
      this._lastEntryIdSubscribed = entryId;
      void this._connect(entryId);
      void this._loadDesigns(entryId);
      void this._loadPlaylist(entryId);
    }
  }

  private _autoDeviceId(): string | undefined {
    const entities = Object.values(this.hass.entities ?? {});
    return entities.find((entity) => entity.platform === "iledclock")?.device_id ?? undefined;
  }

  private async _connect(entryId: string, attempt = 0): Promise<void> {
    if (this._unsubscribe) {
      void this._unsubscribe();
      this._unsubscribe = null;
    }
    if (!this.hass.callWS) return;
    try {
      this._envelope = await this.hass.callWS<ClockStateEnvelope>({ type: "iledclock/state", entry_id: entryId });
      if (this.hass.connection) {
        this._unsubscribe = await this.hass.connection.subscribeMessage<SubscribeEvent>((event) => {
          if (event.type === "upload") {
            this._uploadProgress = event;
            if (event.state === "done" || event.state === "error") setTimeout(() => (this._uploadProgress = null), 2500);
          } else {
            this._envelope = event;
          }
        }, { type: "iledclock/subscribe", entry_id: entryId });
      }
      if (attempt > 0) void this._loadPlaylist(entryId);
    } catch (err) {
      // Right after an HA restart this page reconnects before the clock integration has
      // finished starting, and the server answers `unknown_entry` ("not loaded yet"). That is
      // transient: retry for about a minute instead of leaving the studio without a clock.
      const code = (err as { code?: string } | null)?.code;
      if (code === "unknown_entry" && attempt < CONNECT_RETRY_LIMIT && this.isConnected) {
        setTimeout(() => void this._connect(entryId, attempt + 1), CONNECT_RETRY_MS);
      }
    }
  }

  private async _loadDesigns(entryId: string): Promise<void> {
    if (!this.hass.callWS) return;
    this._designsLoading = true;
    try {
      this._designs = await this.hass.callWS<StoredDesign[]>(designsListRequest(entryId));
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Could not load the design library.";
    } finally {
      this._designsLoading = false;
    }
  }

  private async _loadPlaylist(entryId: string): Promise<void> {
    if (!this.hass.callWS) return;
    try {
      const result = await this.hass.callWS<{ playlist: PlaylistItem[] }>(playlistGetRequest(entryId));
      this._playlist = result.playlist ?? [];
    } catch {
      this._playlist = [];
    }
  }

  // ---- frame editing ----

  private get _frames(): PixelFrame[] {
    return this._history.present;
  }

  private _pushFrames(next: PixelFrame[]): void {
    this._history = historyPush(this._history, next);
  }

  private _onFrameChanged = (event: CustomEvent<{ frame: PixelFrame }>): void => {
    const frames = this._frames.slice();
    frames[this._activeFrameIndex] = event.detail.frame;
    this._pushFrames(frames);
  };

  private _onColorPicked = (event: CustomEvent<{ color: RGB }>): void => {
    this._activeColor = event.detail.color;
    const key = event.detail.color.join(",");
    this._recentColors = [event.detail.color, ...this._recentColors.filter((c) => c.join(",") !== key)].slice(0, MAX_RECENT_COLORS);
  };

  private _onUndoRequested = (): void => {
    this._history = historyUndo(this._history);
    this._activeFrameIndex = Math.min(this._activeFrameIndex, this._frames.length - 1);
  };

  private _onRedoRequested = (): void => {
    this._history = historyRedo(this._history);
    this._activeFrameIndex = Math.min(this._activeFrameIndex, this._frames.length - 1);
  };

  private _onFramesChanged = (event: CustomEvent<{ frames: PixelFrame[] }>): void => {
    this._pushFrames(event.detail.frames);
    this._activeFrameIndex = Math.min(this._activeFrameIndex, event.detail.frames.length - 1);
  };

  private _onFrameSelected = (event: CustomEvent<{ index: number }>): void => {
    this._activeFrameIndex = event.detail.index;
  };

  private _onDelayChanged = (event: CustomEvent<{ index: number; delayMs: number }>): void => {
    const frames = this._frames.slice();
    const frame = frames[event.detail.index];
    if (!frame) return;
    frames[event.detail.index] = { ...frame, durationMs: event.detail.delayMs };
    this._pushFrames(frames);
  };

  private _onPlayToggled = (event: CustomEvent<{ playing: boolean }>): void => {
    this._playing = event.detail.playing;
  };

  private _replaceDesign(frames: PixelFrame[], name?: string): void {
    this._history = historyInit(frames);
    this._activeFrameIndex = 0;
    this._currentDesignId = null;
    if (name) this._designName = name;
  }

  // ---- import / generative ----

  private async _renderInto(spec: RenderSpec, name: string): Promise<void> {
    if (!this._entryId || !this.hass.callWS) return;
    this._busy = "render";
    this._error = null;
    try {
      const result = await this.hass.callWS<{ frames: string[]; delays: number[] }>(renderRequest(this._entryId, spec));
      const frames = result.frames.map((b64, i) => {
        const binary = atob(b64);
        const pixels = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 3);
        for (let i2 = 0; i2 < Math.min(binary.length, pixels.length); i2++) pixels[i2] = binary.charCodeAt(i2);
        return { width: GRID_WIDTH, height: GRID_HEIGHT, pixels, durationMs: result.delays[i] ?? 100 };
      });
      if (frames.length > 0) this._replaceDesign(frames, name);
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Import failed.";
    } finally {
      this._busy = null;
    }
  }

  private _runGenerative(): void {
    void this._renderInto({ type: "generative", kind: this._generativeKind, seconds: this._generativeSeconds }, GENERATIVE_PRESETS.find((p) => p.kind === this._generativeKind)?.label ?? "Generative");
  }

  // ---- gallery / import sheet ----

  /** Both `iledclock-gallery-browser` and `iledclock-import-sheet` (GalleryUI, docs/GALLERY.md)
   * fire this after a design lands in the library -- always re-fetch rather than trust any
   * local guess at the new list, since either "Save to library" (stays in Gallery) or "Show on
   * clock" (also fires `iledclock-open-design`) could have triggered it. */
  private _onGalleryDesignsChanged = (): void => {
    if (this._entryId) void this._loadDesigns(this._entryId);
  };

  /** Fired alongside `iledclock-designs-changed` by "Show on clock" (gallery item sheet) and by
   * both actions in the import sheet -- load the freshly-saved design into the editor and
   * return to the workspace. Re-fetches the design list first (rather than trusting
   * `this._designs`, which may not have been updated by the sibling event yet) so this never
   * races the reload. */
  private _onGalleryOpenDesign = async (event: CustomEvent<{ design_id: string }>): Promise<void> => {
    if (this._entryId) await this._loadDesigns(this._entryId);
    const design = this._designs.find((d) => d.id === event.detail.design_id);
    if (!design) return;
    this._history = historyInit(designToFrames(design));
    this._activeFrameIndex = 0;
    this._currentDesignId = design.id;
    this._designName = design.name;
    this._nav = "editor";
    this._importSheetOpen = false;
  };

  // ---- library ----

  private _onDesignSelected = (event: CustomEvent<{ id: string }>): void => {
    const design = this._designs.find((d) => d.id === event.detail.id);
    if (!design) return;
    this._history = historyInit(designToFrames(design));
    this._activeFrameIndex = 0;
    this._currentDesignId = design.id;
    this._designName = design.name;
  };

  private async _saveDesign(id: string | null, frames: PixelFrame[], name: string): Promise<string | null> {
    if (!this.hass.callWS) return null;
    const now = Date.now();
    const existing = id ? this._designs.find((d) => d.id === id) : undefined;
    const design = framesToDesign(frames, {
      id: id ?? newDesignId(),
      name,
      kind: frames.length > 1 ? "animation" : "image",
      created: existing?.created ?? now,
      updated: now,
      tags: existing?.tags,
    });
    try {
      const result = await this.hass.callWS<{ id: string }>(designsSaveRequest(design));
      if (this._entryId) void this._loadDesigns(this._entryId);
      return result.id;
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Save failed.";
      return null;
    }
  }

  private _onSaveClick = async (): Promise<void> => {
    this._busy = "save";
    const id = await this._saveDesign(this._currentDesignId, this._frames, this._designName);
    if (id) this._currentDesignId = id;
    this._busy = null;
  };

  private _onDesignRenameRequested = async (event: CustomEvent<{ id: string; name: string }>): Promise<void> => {
    const design = this._designs.find((d) => d.id === event.detail.id);
    if (!design) return;
    await this._saveDesign(design.id, designToFrames(design), event.detail.name);
  };

  private _onDesignDuplicateRequested = async (event: CustomEvent<{ id: string }>): Promise<void> => {
    const design = this._designs.find((d) => d.id === event.detail.id);
    if (!design) return;
    await this._saveDesign(null, designToFrames(design), `${design.name} copy`);
  };

  private _onDesignDeleteRequested = async (event: CustomEvent<{ id: string }>): Promise<void> => {
    if (!this.hass.callWS) return;
    try {
      await this.hass.callWS(designsDeleteRequest(event.detail.id));
      if (this._currentDesignId === event.detail.id) this._currentDesignId = null;
      if (this._entryId) void this._loadDesigns(this._entryId);
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Delete failed.";
    }
  };

  // ---- send / playlist ----

  private _onSendConfirmed = async (): Promise<void> => {
    if (!this._entryId || !this.hass.callWS) return;
    this._busy = "send";
    this._error = null;
    try {
      let id = this._currentDesignId;
      id = await this._saveDesign(id, this._frames, this._designName);
      if (!id) return;
      this._currentDesignId = id;
      await this.hass.callWS(showRequest(this._entryId, { design_id: id }));
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Send failed.";
    } finally {
      this._busy = null;
    }
  };

  private _onPlaylistItemsChanged = (event: CustomEvent<{ items: PlaylistItem[] }>): void => {
    this._playlist = event.detail.items;
  };

  private _onSavePlaylistConfirmed = async (): Promise<void> => {
    if (!this._entryId || !this.hass.callWS) return;
    this._busy = "playlist";
    this._error = null;
    try {
      const normalized = normalizePlaylist(this._playlist, this._envelope?.capabilities.max_playlist_items ?? 9);
      await this.hass.callWS(playlistSetRequest(this._entryId, normalized));
      this._playlist = normalized;
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Saving the playlist failed.";
    } finally {
      this._busy = null;
    }
  };

  private _toggleMenu(): void {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  render() {
    const frames = this._frames;
    const activeFrame = frames[this._activeFrameIndex] ?? frames[0]!;
    const previousFrame = this._activeFrameIndex > 0 ? frames[this._activeFrameIndex - 1] ?? null : null;
    return html`
      <div class="app-bar">
        ${this.narrow ? html`<button type="button" class="icon-button" @click=${() => this._toggleMenu()} aria-label="Show sidebar">${mdiIcon("menu")}</button>` : nothing}
        <h1>Pixel Studio</h1>
        <iledclock-segmented-picker
          class="nav-picker"
          group-label="Section"
          content-fit
          .options=${[
            { value: "editor", label: "Editor" },
            { value: "gallery", label: "Gallery" },
          ]}
          .value=${this._nav}
          @option-selected=${(e: CustomEvent<{ value: string }>) => (this._nav = e.detail.value as "editor" | "gallery")}
        ></iledclock-segmented-picker>
        ${this._uploadProgress ? html`<span class="upload-status">${this._renderUploadStatus(this._uploadProgress)}</span>` : nothing}
      </div>
      <div class="body">
        ${this._error ? html`<p class="error">${this._error}</p>` : nothing}
        ${this._nav === "gallery"
          ? html`<div class="gallery-view"><iledclock-gallery-browser .hass=${this.hass} .entryId=${this._entryId}></iledclock-gallery-browser></div>`
          : html`
              <div class="editor-column">
                <div class="name-row">
                  <input class="design-name" type="text" .value=${this._designName} @change=${(e: Event) => (this._designName = (e.target as HTMLInputElement).value)} placeholder="Design name" />
                  <button type="button" class="secondary-action" @click=${() => (this._importSheetOpen = true)}>${mdiIcon("image")} Import</button>
                </div>
                <iledclock-pixel-editor
                  .frame=${activeFrame}
                  .onionSkin=${previousFrame}
                  .wrap=${this._wrap}
                  .activeColor=${this._activeColor}
                  .recentColors=${this._recentColors}
                  .hass=${this.hass}
                  .entryId=${this._entryId}
                  @frame-changed=${this._onFrameChanged}
                  @color-picked=${this._onColorPicked}
                  @undo-requested=${this._onUndoRequested}
                  @redo-requested=${this._onRedoRequested}
                ></iledclock-pixel-editor>
                <iledclock-frame-timeline
                  .frames=${frames}
                  .activeIndex=${this._activeFrameIndex}
                  .playing=${this._playing}
                  @frames-changed=${this._onFramesChanged}
                  @frame-selected=${this._onFrameSelected}
                  @delay-changed=${this._onDelayChanged}
                  @play-toggled=${this._onPlayToggled}
                ></iledclock-frame-timeline>
                ${this._renderGenerativeSection()}
                <div class="button-row">
                  <button type="button" class="secondary-action" ?disabled=${this._busy === "save"} @click=${this._onSaveClick}>${mdiIcon("save")} Save</button>
                  <iledclock-hold-button label="Hold to send to clock" complete-label="Sent" ?disabled=${this._busy === "send" || !this._entryId} @confirmed=${this._onSendConfirmed}></iledclock-hold-button>
                </div>
              </div>
              <div class="side-column">
                <iledclock-library-panel
                  .designs=${this._designs}
                  .loading=${this._designsLoading}
                  @design-selected=${this._onDesignSelected}
                  @design-rename-requested=${this._onDesignRenameRequested}
                  @design-duplicate-requested=${this._onDesignDuplicateRequested}
                  @design-delete-requested=${this._onDesignDeleteRequested}
                ></iledclock-library-panel>
                <iledclock-playlist-editor
                  .items=${this._playlist}
                  .maxItems=${this._envelope?.capabilities.max_playlist_items ?? 9}
                  .designs=${this._designs}
                  @items-changed=${this._onPlaylistItemsChanged}
                ></iledclock-playlist-editor>
                <iledclock-hold-button
                  label="Hold to save playlist to clock"
                  complete-label="Saved"
                  danger
                  ?disabled=${this._busy === "playlist" || !this._entryId}
                  @confirmed=${this._onSavePlaylistConfirmed}
                ></iledclock-hold-button>
              </div>
            `}
      </div>
      <iledclock-import-sheet .hass=${this.hass} .entryId=${this._entryId} ?open=${this._importSheetOpen} @close-requested=${() => (this._importSheetOpen = false)}></iledclock-import-sheet>
    `;
  }

  private _renderUploadStatus(progress: UploadProgressEvent) {
    if (progress.state === "error") return `Upload failed${progress.error ? `: ${progress.error}` : ""}`;
    if (progress.state === "done") return "Upload complete";
    return `Uploading ${progress.program + 1}/${progress.programs} \u2013 chunk ${progress.chunk + 1}/${progress.chunks}`;
  }

  private _renderGenerativeSection() {
    return html`
      <div class="import-section">
        <div class="generative-row">
          <select class="generative-select" @change=${(e: Event) => (this._generativeKind = (e.target as HTMLSelectElement).value)}>
            ${GENERATIVE_PRESETS.map((preset) => html`<option value=${preset.kind} ?selected=${preset.kind === this._generativeKind}>${preset.label}</option>`)}
          </select>
          <button type="button" class="secondary-action" ?disabled=${this._busy === "render"} @click=${this._runGenerative}>${mdiIcon("generative")} Generate</button>
        </div>
      </div>
    `;
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host {
      display: block;
      height: 100vh;
      background: var(--primary-background-color);
      color: var(--lu-ink);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .app-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      height: 56px;
      flex: none;
      background: var(--app-header-background-color, var(--primary-background-color));
      border-bottom: 1px solid var(--divider-color);
    }
    .nav-picker {
      /* The picker is a size container (container-type: inline-size), so it has no intrinsic
         width: in this flex row it collapsed to 0 px beside the title. Give it a definite one. */
      flex: 0 0 220px;
      width: 220px;
    }
    h1 {
      font-size: 18px;
      font-weight: 700;
      margin: 0;
      flex: 1;
    }
    .icon-button {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--primary-text-color);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .upload-status {
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .body {
      flex: 1;
      overflow-y: auto;
      container-type: inline-size;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .error {
      margin: 0;
      color: var(--lu-danger);
      font-size: 13px;
    }
    .editor-column,
    .side-column {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .name-row {
      display: flex;
      gap: 8px;
    }
    .design-name {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 12px;
      font-size: 15px;
      font-weight: 600;
    }
    .gallery-view {
      min-height: 0;
      flex: 1;
    }
    .import-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border-radius: var(--lu-radius-tile);
      border: 1px solid var(--divider-color);
    }
    .generative-row {
      display: flex;
      gap: 8px;
    }
    .generative-select {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 10px;
    }
    .button-row {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .button-row iledclock-hold-button {
      flex: 1;
    }
    .secondary-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--primary-text-color);
      cursor: pointer;
      padding: 0 16px;
      font-size: 14px;
      font-weight: 600;
      transition: transform 90ms var(--lu-ease, ease);
    }
    .secondary-action:active:not(:disabled) {
      transform: scale(0.97);
    }
    .secondary-action:disabled {
      opacity: 0.5;
      cursor: default;
    }
    @container (min-width: 900px) {
      .body {
        flex-direction: row;
        align-items: flex-start;
      }
      .editor-column {
        flex: 1 1 62%;
      }
      .side-column {
        flex: 1 1 38%;
        position: sticky;
        top: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
        animation: none !important;
      }
    }
  `,
  ];
}

customElements.define("iledclock-studio-panel", IledclockStudioPanel);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-studio-panel": IledclockStudioPanel;
  }
}
