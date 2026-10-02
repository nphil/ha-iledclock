import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { HomeAssistant, PlaylistItem, SmoothSetting, StoredDesign, ClockStateEnvelope } from "../types.ts";
import type { StudioRoute } from "../lib/route.ts";
import { designsDeleteRequest, designsListRequest, designsSaveRequest, designsSetPlaybackRequest, normalizePlaylist, playlistGetRequest, playlistSetRequest } from "../lib/ws-api.ts";
import { appendDesignsToRotation, cloneRotation, rotationIsDirty } from "../lib/library-state.ts";
import { GalleryImportCache } from "../lib/gallery-import-cache.ts";
import { showWithUndo } from "../lib/show-with-undo.ts";
import { contentClassOf } from "../lib/slots.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import type { LuToastRequest } from "./lu-toast.ts";
import "./iledclock-library-panel.ts";
import "./iledclock-playlist-editor.ts";
import "./iledclock-import-sheet.ts";
import "./iledclock-hold-button.ts";
import "./lu-chip.ts";
import "./lu-empty.ts";
import "./lu-error.ts";
import "./lu-skeleton.ts";

export class IledclockDestLibrary extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    route: { attribute: false },
    narrow: { type: Boolean },
    _designs: { state: true },
    _designsLoading: { state: true },
    _playlist: { state: true },
    _savedPlaylist: { state: true },
    _playlistLoading: { state: true },
    _error: { state: true },
    _playlistError: { state: true },
    _busy: { state: true },
    _maxItems: { state: true },
    _importOpen: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare route: StudioRoute;
  declare narrow: boolean;
  declare _designs: StoredDesign[];
  declare _designsLoading: boolean;
  declare _playlist: PlaylistItem[];
  declare _savedPlaylist: PlaylistItem[];
  declare _playlistLoading: boolean;
  declare _error: string | null;
  declare _playlistError: string | null;
  declare _busy: boolean;
  declare _maxItems: number;
  declare _importOpen: boolean;

  private _designRequestId = 0;
  private _playlistRequestId = 0;
  private _loadedEntryId: string | undefined;
  /** Newest speed/smooth save per design id; an older answer is ignored. */
  private _playbackSeq: Record<string, number> = {};
  private _loadedConnection: HomeAssistant["connection"] | undefined;

  constructor() {
    super();
    this.narrow = false;
    this.route = { destination: "library" };
    this._designs = [];
    this._designsLoading = false;
    this._playlist = [];
    this._savedPlaylist = [];
    this._playlistLoading = false;
    this._error = null;
    this._playlistError = null;
    this._busy = false;
    this._maxItems = 9;
    this._importOpen = false;
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size !== 1 || !changed.has("hass")) return true;
    const previous = changed.get("hass") as HomeAssistant | undefined;
    return !previous || previous.connection !== this.hass?.connection;
  }

  protected willUpdate(changed: PropertyValues): void {
    const entryChanged = this.entryId !== this._loadedEntryId;
    const connection = this.hass?.connection;
    const connectionChanged = connection !== this._loadedConnection;
    if (changed.has("entryId")) this._maxItems = 9;
    if (!entryChanged && !connectionChanged) return;

    this._loadedEntryId = this.entryId;
    this._loadedConnection = connection;
    if (entryChanged) {
      this._playlist = [];
      this._savedPlaylist = [];
    }
    if (this.entryId) {
      void this._loadAll(this.entryId);
      return;
    }
    this._designs = [];
    this._playlist = [];
    this._savedPlaylist = [];
    this._error = null;
    this._playlistError = null;
  }

  private async _loadAll(entryId: string): Promise<void> {
    await Promise.all([this._loadDesigns(entryId), this._loadPlaylist(entryId), this._loadCapabilities(entryId)]);
  }

  private async _loadDesigns(entryId: string): Promise<void> {
    const requestId = ++this._designRequestId;
    this._designsLoading = true;
    this._error = null;
    try {
      if (!this.hass?.callWS) throw new Error("Home Assistant connection is unavailable.");
      const designs = await this.hass.callWS<StoredDesign[]>(designsListRequest(entryId));
      if (requestId !== this._designRequestId || entryId !== this.entryId) return;
      if (!Array.isArray(designs)) throw new Error("The design list returned an unexpected response.");
      this._designs = designs;
    } catch (error) {
      if (requestId === this._designRequestId && entryId === this.entryId) this._error = error instanceof Error ? error.message : "Could not load saved designs.";
    } finally {
      if (requestId === this._designRequestId) this._designsLoading = false;
    }
  }

  private async _loadPlaylist(entryId: string): Promise<void> {
    if (entryId === this.entryId && rotationIsDirty(this._playlist, this._savedPlaylist)) return;
    const requestId = ++this._playlistRequestId;
    this._playlistLoading = true;
    this._playlistError = null;
    try {
      if (!this.hass?.callWS) throw new Error("Home Assistant connection is unavailable.");
      const result = await this.hass.callWS<{ playlist: PlaylistItem[] }>(playlistGetRequest(entryId));
      if (requestId !== this._playlistRequestId || entryId !== this.entryId) return;
      if (!result || !Array.isArray(result.playlist)) throw new Error("The rotation list returned an unexpected response.");
      if (rotationIsDirty(this._playlist, this._savedPlaylist)) return;
      this._playlist = cloneRotation(result.playlist);
      this._savedPlaylist = cloneRotation(result.playlist);
    } catch (error) {
      if (requestId === this._playlistRequestId && entryId === this.entryId) this._playlistError = error instanceof Error ? error.message : "Could not load the rotation.";
    } finally {
      if (requestId === this._playlistRequestId) this._playlistLoading = false;
    }
  }

  private async _loadCapabilities(entryId: string): Promise<void> {
    if (!this.hass?.callWS) return;
    try {
      const result = await this.hass.callWS<ClockStateEnvelope>({ type: "iledclock/state", entry_id: entryId });
      if (entryId === this.entryId && Number.isFinite(result.capabilities?.max_playlist_items)) this._maxItems = result.capabilities.max_playlist_items;
    } catch {
      // The device's documented fallback capacity is nine programs.
    }
  }

  private _toast(request: LuToastRequest): void {
    this.dispatchEvent(new CustomEvent<LuToastRequest>("lu-toast", { detail: request, bubbles: true, composed: true }));
  }

  private _onImportRequested = (): void => { this._importOpen = true; };
  private _onImportClosed = (): void => { this._importOpen = false; };
  private _retryDesigns = (): void => { if (this.entryId) void this._loadDesigns(this.entryId); };
  private _retryPlaylist = (): void => { if (this.entryId) void this._loadPlaylist(this.entryId); };

  private async _onRename(event: CustomEvent<{ id: string; name: string }>): Promise<void> {
    const entryId = this.entryId;
    const design = this._designs.find((item) => item.id === event.detail.id);
    const callWS = this.hass?.callWS?.bind(this.hass);
    if (!entryId || !design || !callWS || !event.detail.name.trim()) return;
    this._busy = true;
    try {
      await callWS(designsSaveRequest({ ...design, name: event.detail.name.trim(), updated: Date.now() }));
      await this._loadDesigns(entryId);
      this._toast({ message: "Design name updated", timeoutMs: 2500 });
    } catch (error) {
      this._toast({ message: `Couldn't rename the design: ${error instanceof Error ? error.message : "Please try again."}`, timeoutMs: 7000 });
    } finally {
      this._busy = false;
    }
  }

  private async _onDuplicate(event: CustomEvent<{ id: string }>): Promise<void> {
    const entryId = this.entryId;
    const design = this._designs.find((item) => item.id === event.detail.id);
    const callWS = this.hass?.callWS?.bind(this.hass);
    if (!entryId || !design || !callWS) return;
    this._busy = true;
    const now = Date.now();
    try {
      const duplicate: StoredDesign = {
        ...design,
        id: `local-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: `${design.name} copy`,
        frames: [...design.frames],
        delays: [...design.delays],
        tags: design.tags ? [...design.tags] : undefined,
        created: now,
        updated: now,
      };
      await callWS(designsSaveRequest(duplicate));
      await this._loadDesigns(entryId);
      this._toast({ message: `${duplicate.name} added to Library`, timeoutMs: 2500 });
    } catch (error) {
      this._toast({ message: `Couldn't duplicate the design: ${error instanceof Error ? error.message : "Please try again."}`, timeoutMs: 7000 });
    } finally {
      this._busy = false;
    }
  }

  /** The Speed slider settled on a value: store it on the design. Only speed, smooth and `updated`
   * change in the list; the frames stay the very same objects, so nothing reloads or flickers. */
  private async _onPlaybackRequested(event: CustomEvent<{ id: string; speed: number | null; smooth: SmoothSetting; failed?: () => void }>): Promise<void> {
    const { id, speed, smooth, failed } = event.detail;
    const callWS = this.hass?.callWS?.bind(this.hass);
    if (!callWS || !this._designs.some((item) => item.id === id)) return;
    const seq = (this._playbackSeq[id] ?? 0) + 1;
    this._playbackSeq[id] = seq;
    try {
      const result = await callWS<{ id: string; speed: number | null; smooth: SmoothSetting; updated: number }>(designsSetPlaybackRequest(id, { speed, smooth }));
      if (this._playbackSeq[id] !== seq) return;
      this._designs = this._designs.map((item) => (item.id === id ? { ...item, speed: result.speed, smooth: result.smooth, updated: result.updated } : item));
    } catch (error) {
      if (this._playbackSeq[id] !== seq) return;
      this._toast({ message: `Couldn't save the speed: ${error instanceof Error ? error.message : "Please try again."}`, timeoutMs: 7000 });
      failed?.();
    }
  }

  private async _deleteOne(id: string): Promise<void> {
    if (!this.hass?.callWS) return;
    this._busy = true;
    try {
      await this.hass.callWS(designsDeleteRequest(id));
      GalleryImportCache.clearAll();
      if (this.entryId) await this._loadDesigns(this.entryId);
      this._toast({ message: "Design deleted", timeoutMs: 2500 });
    } catch (error) {
      this._toast({ message: `Couldn't delete the design: ${error instanceof Error ? error.message : "Please try again."}`, timeoutMs: 7000 });
    } finally {
      this._busy = false;
    }
  }

  private _onDelete = (event: CustomEvent<{ id: string }>): void => { void this._deleteOne(event.detail.id); };

  private async _deleteMany(event: CustomEvent<{ ids: string[] }>): Promise<void> {
    if (!this.hass?.callWS || event.detail.ids.length === 0) return;
    this._busy = true;
    try {
      const results = await Promise.allSettled(event.detail.ids.map(async (id) => this.hass.callWS!(designsDeleteRequest(id))));
      const removed = results.filter((result) => result.status === "fulfilled").length;
      if (removed > 0) GalleryImportCache.clearAll();
      if (this.entryId) await this._loadDesigns(this.entryId);
      const failed = results.length - removed;
      this._toast({ message: failed ? `Deleted ${removed}; ${failed} couldn't be deleted.` : `${removed} designs deleted`, timeoutMs: failed ? 7000 : 3000 });
    } finally {
      this._busy = false;
    }
  }

  private _onDesignsDeleteRequested = (event: CustomEvent<{ ids: string[] }>): void => { void this._deleteMany(event); };

  private async _showDesign(event: CustomEvent<{ id: string; title: string }>): Promise<void> {
    if (!this.entryId || !this.hass) return;
    this._busy = true;
    await showWithUndo(this, this.hass, this.entryId, { design_id: event.detail.id }, event.detail.title, { contentClass: contentClassOf({ design_id: event.detail.id }, this._designs) });
    this._busy = false;
  }

  private _onDesignShowRequested = (event: CustomEvent<{ id: string; title: string }>): void => { void this._showDesign(event); };

  private _onAddDesigns = (event: CustomEvent<{ ids: string[] }>): void => {
    const before = this._playlist.length;
    this._playlist = appendDesignsToRotation(this._playlist, event.detail.ids, this._maxItems);
    const added = this._playlist.length - before;
    this._toast({ message: added > 0 ? `${added} ${added === 1 ? "design added" : "designs added"} to rotation` : "Rotation is full", timeoutMs: 3000 });
  };

  private _onPlaylistItemsChanged = (event: CustomEvent<{ items: PlaylistItem[] }>): void => {
    this._playlist = event.detail.items;
  };

  private async _applyPlaylist(): Promise<void> {
    if (!this.entryId || !this.hass?.callWS || this._playlist.length === 0) return;
    this._busy = true;
    try {
      const normalized = normalizePlaylist(this._playlist, this._maxItems);
      await this.hass.callWS(playlistSetRequest(this.entryId, normalized));
      this._playlist = cloneRotation(normalized);
      this._savedPlaylist = cloneRotation(normalized);
      this._toast({ message: "Rotation applied to the clock", timeoutMs: 3000 });
    } catch (error) {
      this._toast({ message: `Couldn't apply the rotation: ${error instanceof Error ? error.message : "Please try again."}`, timeoutMs: 8000 });
    } finally {
      this._busy = false;
    }
  }


  render() {
    if (!this.entryId) return html`<lu-empty title="Connect a clock to open your Library" message="Saved designs and rotations belong to an iLedClock device."></lu-empty>`;
    const dirty = rotationIsDirty(this._playlist, this._savedPlaylist);
    const enabled = this._savedPlaylist.length > 0;
    return html`<div class="destination">
      <iledclock-library-panel
        .hass=${this.hass}
        .entryId=${this.entryId}
        .route=${this.route}
        .designs=${this._designs}
        .loading=${this._designsLoading}
        .error=${this._error}
        ?disabled=${this._busy}
        @retry-designs=${this._retryDesigns}
        @import-requested=${this._onImportRequested}
        @design-rename-requested=${this._onRename}
        @design-duplicate-requested=${this._onDuplicate}
        @design-delete-requested=${this._onDelete}
        @design-playback-requested=${this._onPlaybackRequested}
        @designs-delete-requested=${this._onDesignsDeleteRequested}
        @design-show-requested=${this._onDesignShowRequested}
        @designs-add-to-rotation=${this._onAddDesigns}
      ></iledclock-library-panel>

      <section class="rotation lu-section-surface" aria-labelledby="rotation-title">
        <header class="rotation-header">
          <div><h2 id="rotation-title">Rotation</h2><p class="subtitle">Programs the clock shows in order</p></div>
          ${!this._playlistLoading && !this._playlistError ? html`<lu-chip .label=${enabled ? "On" : "Off"} .kind=${enabled ? "positive" : "neutral"}></lu-chip>` : nothing}
        </header>
        <div class="rotation-status" role="status">
          ${this._playlistError ? nothing : this._playlistLoading ? nothing : enabled
            ? html`<span>${this._savedPlaylist.length === 1 ? "One saved program; the clock keeps showing it." : `The clock cycles through ${this._savedPlaylist.length} saved programs.`}</span>`
            : html`<span>No saved programs; the clock uses its default display.</span>`}
          ${dirty ? html`<lu-chip label="Unsaved changes" kind="warning"></lu-chip>` : html`<span class="saved-label">${this._playlistLoading ? "Loading saved rotation…" : "Saved rotation"}</span>`}
        </div>
        ${this._playlistError ? html`<lu-error title="Couldn't load the rotation" .message=${this._playlistError} @retry=${this._retryPlaylist}></lu-error>`
          : this._playlistLoading ? html`<lu-skeleton variant="card" label="Loading rotation"></lu-skeleton>`
          : html`<iledclock-playlist-editor .items=${this._playlist} .maxItems=${this._maxItems} .designs=${this._designs} ?disabled=${this._busy} @items-changed=${this._onPlaylistItemsChanged}></iledclock-playlist-editor>`}
        <div class="apply-row">
          <iledclock-hold-button label="Hold to apply rotation" complete-label="Rotation applied" ?disabled=${this._busy || this._playlistLoading || Boolean(this._playlistError) || this._playlist.length === 0} @confirmed=${this._applyPlaylist}></iledclock-hold-button>
        </div>
      </section>
      <iledclock-import-sheet .hass=${this.hass} .entryId=${this.entryId} .open=${this._importOpen} @close-requested=${this._onImportClosed} @closed=${this._onImportClosed} @iledclock-designs-changed=${this._retryDesigns}></iledclock-import-sheet>
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .destination { display: grid; gap: var(--lu-space-4); min-width: 0; }
    .rotation { display: grid; gap: var(--lu-space-3); min-width: 0; padding: var(--lu-space-4); }
    .rotation-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--lu-space-2); }
    h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); }
    .subtitle { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .rotation-status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--lu-space-2); color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .saved-label { color: var(--lu-ink-3); }
    .apply-row { display: flex; justify-content: flex-end; }
    .apply-row iledclock-hold-button { width: min(100%, 24rem); }
    @container (max-width: 420px) { .rotation { padding: var(--lu-space-3); } .apply-row iledclock-hold-button { width: 100%; } }
  `];
}

customElements.define("iledclock-dest-library", IledclockDestLibrary);

declare global { interface HTMLElementTagNameMap { "iledclock-dest-library": IledclockDestLibrary; } }
