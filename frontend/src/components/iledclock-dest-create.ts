import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import type { HomeAssistant, RenderResult, RenderSpec, StoredDesign } from "../types.ts";
import type { StudioRoute } from "../lib/route.ts";
import { navigateStudioRoute } from "../lib/route.ts";
import { GRID_HEIGHT, GRID_WIDTH, cloneFrame, createFrame, framesEqual, setPixelMut, type PixelFrame } from "../lib/grid.ts";
import { CLOCK_REGION_TAG, clockRegionForDesign, designHasClockRegion, isEditablePixel } from "../lib/clock-region.ts";
import { base64ToFrame, designToFrames, framesToDesign } from "../lib/design-codec.ts";
import { historyInit, historyPush, historyRedo, historyUndo, type History } from "../lib/undo-stack.ts";
import { GENERATIVE_PRESETS } from "../lib/generative-presets.ts";
import { buildTextRenderSpec, designsListRequest, designsSaveRequest, renderRequest } from "../lib/ws-api.ts";
import { hexToRgb, type RGB } from "../lib/color.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { clearEditorDraft, editorStateFingerprint, isEditorDraftDirty, makeEditorDraft, readEditorDraft, writeEditorDraft } from "../lib/draft-store.ts";
import { setFrameDelay } from "../lib/timeline.ts";
import { showWithUndo } from "../lib/show-with-undo.ts";
import { encodeAnimationGif } from "../lib/editor-export.ts";
import type { NewDesignOption } from "./iledclock-editor-new-sheet.ts";
import "./iledclock-pixel-editor.ts";
import "./iledclock-frame-timeline.ts";
import "./iledclock-import-sheet.ts";
import "./iledclock-editor-inspector.ts";
import "./iledclock-editor-color-sheet.ts";
import "./iledclock-editor-new-sheet.ts";
import "./iledclock-editor-effects-sheet.ts";
import "./iledclock-editor-text-sheet.ts";
import "./lu-pill-button.ts";
import "./lu-icon-button.ts";
import "./lu-chip.ts";
import "./lu-section.ts";
import "./lu-error.ts";
import "./lu-sheet.ts";
import "./iledclock-hold-button.ts";

const NEW_DESIGN_NAME = "Untitled design";
const AUTOSAVE_DELAY_MS = 400;
const MAX_RECENT_COLORS = 10;
const EMPTY_FRAME = createFrame(GRID_WIDTH, GRID_HEIGHT);

type SaveState = "saved" | "draft" | "unsaved";
type TextStamp = { text: string; color: RGB } | null;
type ReplaceAction = () => void | Promise<void>;

function newDesignId(): string {
  return "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}


function isSameFrames(left: readonly PixelFrame[], right: readonly PixelFrame[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] === right[index]) continue;
    if (!framesEqual(left[index]!, right[index]!)) return false;
  }
  return true;
}

function safeFileName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "iledclock-design";
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class IledclockDestCreate extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    route: { attribute: false },
    narrow: { type: Boolean },
    _history: { state: true },
    _activeFrameIndex: { state: true },
    _activeColor: { state: true },
    _recentColors: { state: true },
    _wrap: { state: true },
    _designs: { state: true },
    _designsLoading: { state: true },
    _designName: { state: true },
    _currentDesignId: { state: true },
    _playing: { state: true },
    _newSheetOpen: { state: true },
    _importSheetOpen: { state: true },
    _colorSheetOpen: { state: true },
    _effectsSheetOpen: { state: true },
    _textSheetOpen: { state: true },
    _textSheetMode: { state: true },
    _replacementSheetOpen: { state: true },
    _overflowOpen: { state: true },
    _generativeSeconds: { state: true },
    _effectPreviews: { state: true },
    _stampText: { state: true },
    _brushSize: { state: true },
    _onionEnabled: { state: true },
    _clockRegion: { state: true },
    _wideLayout: { state: true },
    _saveState: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare route: StudioRoute;
  declare narrow: boolean;
  declare _history: History<PixelFrame[]>;
  declare _activeFrameIndex: number;
  declare _activeColor: RGB;
  declare _recentColors: RGB[];
  declare _wrap: boolean;
  declare _designs: StoredDesign[];
  declare _designsLoading: boolean;
  declare _designName: string;
  declare _currentDesignId: string | null;
  declare _playing: boolean;
  declare _newSheetOpen: boolean;
  declare _importSheetOpen: boolean;
  declare _colorSheetOpen: boolean;
  declare _effectsSheetOpen: boolean;
  declare _textSheetOpen: boolean;
  declare _textSheetMode: "stamp" | "new";
  declare _replacementSheetOpen: boolean;
  declare _overflowOpen: boolean;
  declare _generativeSeconds: number;
  declare _effectPreviews: Record<string, PixelFrame[]>;
  declare _stampText: TextStamp;
  declare _brushSize: number;
  declare _onionEnabled: boolean;
  declare _clockRegion: boolean;
  declare _wideLayout: boolean;
  declare _saveState: SaveState;
  declare _busy: "save" | "show" | "render" | "stamp" | null;
  declare _error: string | null;

  private _lastRouteDesign = "";
  private _openedEntryId: string | null = null;
  private _savedFingerprint = "";
  private _pendingReplacement: ReplaceAction | null = null;
  private _autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private _designLoadToken = 0;
  private _resizeObserver: ResizeObserver | null = null;
  private _retryAction: (() => void) | null = null;

  constructor() {
    super();
    const blank = [createFrame(GRID_WIDTH, GRID_HEIGHT)];
    this.narrow = false;
    this._history = historyInit(blank);
    this._activeFrameIndex = 0;
    this._activeColor = [255, 255, 255];
    this._recentColors = [];
    this._wrap = false;
    this._designs = [];
    this._designsLoading = false;
    this._designName = NEW_DESIGN_NAME;
    this._currentDesignId = null;
    this._playing = false;
    this._newSheetOpen = false;
    this._importSheetOpen = false;
    this._colorSheetOpen = false;
    this._effectsSheetOpen = false;
    this._textSheetOpen = false;
    this._textSheetMode = "stamp";
    this._replacementSheetOpen = false;
    this._overflowOpen = false;
    this._generativeSeconds = 8;
    this._effectPreviews = {};
    this._stampText = null;
    this._brushSize = 1;
    this._onionEnabled = true;
    this._clockRegion = false;
    this._wideLayout = false;
    this._saveState = "draft";
    this._busy = null;
    this._error = null;
    this._savedFingerprint = editorStateFingerprint({ name: this._designName, frames: blank, clockRegion: false });
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("iledclock-designs-changed", this._onDesignsChanged);
    this.addEventListener("iledclock-open-design", this._onOpenDesign as unknown as EventListener);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("iledclock-designs-changed", this._onDesignsChanged);
    this.removeEventListener("iledclock-open-design", this._onOpenDesign as unknown as EventListener);
    clearTimeout(this._autosaveTimer);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  protected firstUpdated(): void {
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? this.getBoundingClientRect().width;
      const wide = width >= 900;
      if (wide !== this._wideLayout) this._wideLayout = wide;
    });
    this._resizeObserver.observe(this);
    if (this.entryId) void this._openEntry(this.entryId);
    this._resolveRouteDesign();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("entryId") && this.entryId) void this._openEntry(this.entryId);
    if (changed.has("route")) this._resolveRouteDesign();
    if (changed.has("_history") || changed.has("_designName") || changed.has("_clockRegion")) this._scheduleDraftSave();
  }

  private get _frames(): PixelFrame[] { return this._history.present; }

  private get _activeFrame(): PixelFrame { return this._frames[this._activeFrameIndex] ?? this._frames[0] ?? EMPTY_FRAME; }

  private get _isDirty(): boolean {
    return editorStateFingerprint({ name: this._designName, frames: this._frames, clockRegion: this._clockRegion }) !== this._savedFingerprint;
  }

  private _storage() {
    try { return window.localStorage; } catch { return null; }
  }

  private _draftState() {
    return { name: this._designName, frames: this._frames, clockRegion: this._clockRegion, designId: this._currentDesignId };
  }

  private _openEntry(entryId: string): void {
    if (this._openedEntryId === entryId) return;
    this._flushDraftSave(this._openedEntryId);
    this._openedEntryId = entryId;
    const blank = [createFrame()];
    this._history = historyInit(blank);
    this._activeFrameIndex = 0;
    this._currentDesignId = null;
    this._designName = NEW_DESIGN_NAME;
    this._clockRegion = false;
    this._savedFingerprint = editorStateFingerprint({ name: NEW_DESIGN_NAME, frames: blank, clockRegion: false });
    this._saveState = "draft";
    this._playing = false;
    this._stampText = null;
    this._designs = [];
    this._designsLoading = false;
    this._error = null;
    this._retryAction = null;
    this._lastRouteDesign = "";
    this._restoreDraft(entryId);
    if (this.route?.design) this._resolveRouteDesign();
    else void this._loadDesigns(entryId);
  }

  private _flushDraftSave(entryId: string | null): void {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = undefined;
    if (!entryId || !this._isDirty) return;
    const storage = this._storage();
    if (storage) writeEditorDraft(storage, makeEditorDraft(entryId, this._draftState(), this._savedFingerprint));
  }

  private _restoreDraft(entryId: string): void {
    const storage = this._storage();
    if (!storage) return;
    const draft = readEditorDraft(storage, entryId);
    if (!draft) {
      clearEditorDraft(storage, entryId);
      return;
    }
    if (!isEditorDraftDirty(draft)) {
      clearEditorDraft(storage, entryId);
      return;
    }
    this._history = historyInit(draft.frames.slice());
    this._activeFrameIndex = 0;
    this._currentDesignId = draft.designId;
    this._designName = draft.name;
    this._clockRegion = draft.clockRegion;
    this._savedFingerprint = draft.savedFingerprint;
    this._saveState = "draft";
    this.dispatchEvent(new CustomEvent("lu-toast", {
      detail: {
        message: "Restored your unsaved drawing",
        actionLabel: "Discard",
        timeoutMs: 8000,
        action: () => void this._discardRestoredDraft(entryId),
      },
      bubbles: true,
      composed: true,
    }));
  }

  private async _discardRestoredDraft(entryId: string): Promise<void> {
    const storage = this._storage();
    if (storage) clearEditorDraft(storage, entryId);
    if (this._currentDesignId) {
      if (!this._designs.length) await this._loadDesigns(entryId);
      const saved = this._designs.find((design) => design.id === this._currentDesignId);
      if (saved) {
        this._applyDesign(saved);
        return;
      }
    }
    this._replaceDesign([createFrame()], NEW_DESIGN_NAME, false);
  }

  private _resolveRouteDesign(): void {
    const design = this.route?.design ?? "";
    if (!design) {
      this._lastRouteDesign = "";
      return;
    }
    if (design === this._lastRouteDesign) return;
    this._lastRouteDesign = design;
    void this._loadRouteDesign(design);
  }

  private async _loadRouteDesign(id: string): Promise<void> {
    const entryId = this.entryId;
    if (!entryId) return;
    if (this._currentDesignId === id) return;
    if (!this._designs.length) await this._loadDesigns(entryId);
    if (this.route?.design !== id) return;
    const design = this._designs.find((item) => item.id === id);
    if (!design) {
      this._error = "That design is no longer in the library.";
      this._retryAction = () => { this._designs = []; void this._loadRouteDesign(id); };
      return;
    }
    this._requestReplacement(() => this._applyDesign(design));
  }

  private async _loadDesigns(entryId: string): Promise<void> {
    const callWS = this.hass?.callWS?.bind(this.hass);
    if (!callWS) return;
    const token = ++this._designLoadToken;
    this._designsLoading = true;
    this._error = null;
    try {
      const designs = await callWS<StoredDesign[]>(designsListRequest(entryId));
      if (token !== this._designLoadToken || this.entryId !== entryId) return;
      this._designs = designs;
    } catch (error) {
      if (token !== this._designLoadToken || this.entryId !== entryId) return;
      this._error = error instanceof Error ? error.message : "Could not load the design library.";
      this._retryAction = () => { void this._loadDesigns(entryId); };
    } finally {
      if (token === this._designLoadToken && this.entryId === entryId) this._designsLoading = false;
    }
  }

  private _applyDesign(design: StoredDesign): void {
    const frames = designToFrames(design).slice(0, 64);
    this._history = historyInit(frames.length ? frames : [createFrame(design.width, design.height)]);
    this._activeFrameIndex = 0;
    this._currentDesignId = design.id;
    this._designName = design.name;
    this._clockRegion = designHasClockRegion(design);
    this._savedFingerprint = editorStateFingerprint({ name: this._designName, frames: this._frames, clockRegion: this._clockRegion });
    this._saveState = "saved";
    this._stampText = null;
    this._playing = false;
    const storage = this._storage();
    if (storage && this.entryId) clearEditorDraft(storage, this.entryId);
  }

  private _onDesignsChanged = (): void => { if (this.entryId) void this._loadDesigns(this.entryId); };

  private _onOpenDesign = async (event: CustomEvent<{ design_id: string }>): Promise<void> => {
    const id = event.detail?.design_id;
    const entryId = this.entryId;
    if (!id || !entryId) return;
    this._lastRouteDesign = id;
    if (!this._designs.length) await this._loadDesigns(entryId);
    const design = this._designs.find((item) => item.id === id);
    if (!design) return;
    if (this._currentDesignId === design.id) return;
    this._requestReplacement(() => this._applyDesign(design));
  };

  private _pushFrames(next: PixelFrame[]): void {
    if (isSameFrames(this._frames, next)) return;
    this._history = historyPush(this._history, next);
  }

  private _onFrameChanged = (event: CustomEvent<{ frame: PixelFrame }>): void => {
    const frames = this._frames.slice();
    frames[this._activeFrameIndex] = event.detail.frame;
    this._pushFrames(frames);
  };

  private _onFramesChanged = (event: CustomEvent<{ frames: PixelFrame[]; activeIndex?: number }>): void => {
    const frames = event.detail.frames.slice(0, 64);
    this._pushFrames(frames);
    this._activeFrameIndex = Math.max(0, Math.min(event.detail.activeIndex ?? this._activeFrameIndex, frames.length - 1));
  };

  private _onColorPicked = (event: CustomEvent<{ color: RGB }>): void => { this._rememberColor(event.detail.color); };

  private _rememberColor(color: RGB): void {
    this._activeColor = color;
    const key = color.join(",");
    this._recentColors = [color, ...this._recentColors.filter((recent) => recent.join(",") !== key)].slice(0, MAX_RECENT_COLORS);
  }

  private _onUndoRequested = (): void => {
    this._history = historyUndo(this._history);
    this._activeFrameIndex = Math.min(this._activeFrameIndex, this._frames.length - 1);
  };

  private _onRedoRequested = (): void => {
    this._history = historyRedo(this._history);
    this._activeFrameIndex = Math.min(this._activeFrameIndex, this._frames.length - 1);
  };

  private _onFrameSelected = (event: CustomEvent<{ index: number }>): void => {
    this._activeFrameIndex = event.detail.index;
  };

  private _onPlayToggled = (event: CustomEvent<{ playing: boolean }>): void => {
    this._playing = event.detail.playing;
  };

  private _onInspectorDelay = (event: CustomEvent<{ delayMs: number }>): void => {
    this._pushFrames(setFrameDelay(this._frames, this._activeFrameIndex, event.detail.delayMs));
  };

  private _onClockRegionChanged = (event: CustomEvent<{ enabled: boolean }>): void => {
    this._clockRegion = event.detail.enabled;
  };

  private _onOnionChanged = (event: CustomEvent<{ enabled: boolean }>): void => {
    this._onionEnabled = event.detail.enabled;
  };

  private _onBrushChanged = (event: CustomEvent<{ size: number }>): void => {
    this._brushSize = Math.max(1, Math.min(3, Math.round(event.detail.size)));
  };

  private _onWrapChanged = (event: CustomEvent<{ wrap: boolean }>): void => {
    this._wrap = event.detail.wrap;
  };

  private _scheduleDraftSave(): void {
    clearTimeout(this._autosaveTimer);
    const entryId = this.entryId;
    if (!entryId) return;
    if (!this._isDirty) {
      const storage = this._storage();
      if (storage) clearEditorDraft(storage, entryId);
      this._saveState = this._currentDesignId ? "saved" : "draft";
      return;
    }
    this._saveState = "unsaved";
    const draft = makeEditorDraft(entryId, this._draftState(), this._savedFingerprint);
    this._autosaveTimer = setTimeout(() => {
      const storage = this._storage();
      this._saveState = storage && writeEditorDraft(storage, draft) ? "draft" : "unsaved";
    }, AUTOSAVE_DELAY_MS);
  }

  private _replaceDesign(frames: PixelFrame[], name: string, clockRegion = false): void {
    const blank = [createFrame(frames[0]?.width ?? GRID_WIDTH, frames[0]?.height ?? GRID_HEIGHT)];
    this._history = historyInit(frames.length ? frames : blank);
    this._activeFrameIndex = 0;
    this._currentDesignId = null;
    this._designName = name;
    this._clockRegion = clockRegion;
    this._savedFingerprint = editorStateFingerprint({ name, frames: blank, clockRegion });
    this._saveState = "unsaved";
    this._playing = false;
    this._stampText = null;
  }

  private _requestReplacement(action: ReplaceAction): void {
    if (!this._isDirty) {
      void action();
      return;
    }
    this._pendingReplacement = action;
    this._replacementSheetOpen = true;
  }

  private _keepEditing = (): void => {
    this._pendingReplacement = null;
    this._replacementSheetOpen = false;
  };

  private async _saveBeforeReplacement(): Promise<void> {
    const action = this._pendingReplacement;
    this._pendingReplacement = null;
    this._replacementSheetOpen = false;
    this._busy = "save";
    const saved = await this._saveDesign();
    this._busy = null;
    if (saved && action) await action();
  }

  private async _discardAndReplace(): Promise<void> {
    const action = this._pendingReplacement;
    this._pendingReplacement = null;
    this._replacementSheetOpen = false;
    const storage = this._storage();
    if (storage && this.entryId) clearEditorDraft(storage, this.entryId);
    if (action) await action();
  }

  private async _saveDesign(): Promise<{ id: string; name: string } | null> {
    const entryId = this.entryId;
    const callWS = this.hass?.callWS?.bind(this.hass);
    if (!entryId || !callWS) return null;
    const frames = this._frames.slice();
    const name = this._designName.trim() || NEW_DESIGN_NAME;
    const clockRegion = this._clockRegion;
    const fingerprint = editorStateFingerprint({ name, frames, clockRegion });
    const now = Date.now();
    const existing = this._currentDesignId ? this._designs.find((design) => design.id === this._currentDesignId) : undefined;
    const tags = (existing?.tags ?? []).filter((tag) => tag !== CLOCK_REGION_TAG && tag !== "with-clock" && tag !== "clock_region");
    if (clockRegion) tags.push(CLOCK_REGION_TAG);
    const design = framesToDesign(frames, {
      id: this._currentDesignId ?? newDesignId(),
      name,
      kind: frames.length > 1 ? "animation" : "image",
      created: existing?.created ?? now,
      updated: now,
      tags,
    });
    design.clock_region = clockRegionForDesign(clockRegion);
    try {
      const result = await callWS<{ id: string }>(designsSaveRequest(design));
      const id = result.id || design.id;
      this._currentDesignId = id;
      this._savedFingerprint = fingerprint;
      void this._loadDesigns(entryId);
      if (editorStateFingerprint({ name: this._designName.trim() || NEW_DESIGN_NAME, frames: this._frames, clockRegion: this._clockRegion }) === fingerprint) {
        this._designName = name;
        const storage = this._storage();
        if (storage) clearEditorDraft(storage, entryId);
        this._saveState = "saved";
      } else {
        this._scheduleDraftSave();
      }
      this._error = null;
      return { id, name };
    } catch (error) {
      this._error = error instanceof Error ? error.message : "Could not save the design.";
      this._retryAction = () => { void this._saveClick(); };
      this._saveState = "unsaved";
      this._scheduleDraftSave();
      return null;
    }
  }

  private _saveClick = async (): Promise<void> => {
    if (this._busy) return;
    this._busy = "save";
    this._error = null;
    await this._saveDesign();
    this._busy = null;
  };

  private _showClick = async (): Promise<void> => {
    if (!this.entryId || this._busy) return;
    this._busy = "show";
    this._error = null;
    try {
      const saved = await this._saveDesign();
      if (saved) await showWithUndo(this, this.hass, this.entryId, { design_id: saved.id }, saved.name);
    } finally {
      this._busy = null;
    }
  };

  private async _renderInto(spec: RenderSpec, name: string, clockRegion = false): Promise<void> {
    const entryId = this.entryId;
    const callWS = this.hass?.callWS?.bind(this.hass);
    if (!entryId || !callWS) return;
    this._busy = "render";
    this._error = null;
    try {
      const result = await callWS<RenderResult>(renderRequest(entryId, spec));
      const frames = result.frames.slice(0, 64).map((encoded, index) => base64ToFrame(encoded, GRID_WIDTH, GRID_HEIGHT, result.delays[index] ?? 100));
      if (frames.length) this._replaceDesign(frames, name, clockRegion);
    } catch (error) {
      this._error = error instanceof Error ? error.message : "Could not generate the design.";
      this._retryAction = () => { void this._renderInto(spec, name, clockRegion); };
      this._scheduleDraftSave();
    } finally {
      this._busy = null;
    }
  }

  private _onNewOption = (event: CustomEvent<{ option: NewDesignOption; seconds: number }>): void => {
    const { option, seconds } = event.detail;
    this._newSheetOpen = false;
    if (option === "blank") this._requestReplacement(() => this._replaceDesign([createFrame()], NEW_DESIGN_NAME));
    else if (option === "clock-art") this._requestReplacement(() => this._replaceDesign([createFrame()], NEW_DESIGN_NAME, true));
    else if (option === "text") {
      this._textSheetMode = "new";
      this._textSheetOpen = true;
    } else if (option === "effect") {
      this._generativeSeconds = seconds;
      this._effectsSheetOpen = true;
    } else if (option === "import") this._importSheetOpen = true;
    else if (option === "explore") navigateStudioRoute({ destination: "explore" });
  };

  private _onEffectPreviewReady = (event: CustomEvent<{ previews: Record<string, PixelFrame[]> }>): void => {
    this._effectPreviews = event.detail.previews;
  };

  private _onEffectSelected = (event: CustomEvent<{ kind: string; seconds: number }>): void => {
    const preset = GENERATIVE_PRESETS.find((item) => item.kind === event.detail.kind);
    const name = preset?.label ?? "Generative";
    this._effectsSheetOpen = false;
    this._requestReplacement(() => this._renderInto({ type: "generative", kind: event.detail.kind, seconds: event.detail.seconds }, name));
  };

  private _openTextSheet(mode: "stamp" | "new"): void {
    this._textSheetMode = mode;
    this._textSheetOpen = true;
    this._overflowOpen = false;
  }

  private _onTextConfigRequested = (): void => this._openTextSheet("stamp");

  private _onTextReady = (event: CustomEvent<{ text: string; color: RGB; mode: "stamp" | "new" }>): void => {
    const { text, color, mode } = event.detail;
    this._textSheetOpen = false;
    if (mode === "stamp") {
      this._stampText = { text, color };
      this._rememberColor(color);
      return;
    }
    const spec = buildTextRenderSpec(text, color);
    if (spec) this._requestReplacement(() => this._renderInto(spec, `Text · ${text.slice(0, 24)}`));
  };

  private _onTextPlaceRequested = async (event: CustomEvent<{ x: number; y: number }>): Promise<void> => {
    const stamp = this._stampText;
    const entryId = this.entryId;
    const callWS = this.hass?.callWS?.bind(this.hass);
    if (!stamp || !entryId || !callWS || this._busy) return;
    const spec = buildTextRenderSpec(stamp.text, stamp.color);
    if (!spec) return;
    this._busy = "stamp";
    try {
      const rendered = await callWS<RenderResult>(renderRequest(entryId, spec));
      const encoded = rendered.frames[0];
      if (!encoded) return;
      const stampFrame = base64ToFrame(encoded, GRID_WIDTH, GRID_HEIGHT, rendered.delays[0] ?? 100);
      const next = cloneFrame(this._activeFrame);
      for (let sy = 0; sy < stampFrame.height; sy++) {
        for (let sx = 0; sx < stampFrame.width; sx++) {
          const offset = (sy * stampFrame.width + sx) * 3;
          const color: RGB = [stampFrame.pixels[offset]!, stampFrame.pixels[offset + 1]!, stampFrame.pixels[offset + 2]!];
          if (color[0] === 0 && color[1] === 0 && color[2] === 0) continue;
          const x = event.detail.x + sx - Math.floor(stampFrame.width / 2);
          const y = event.detail.y + sy - Math.floor(stampFrame.height / 2);
          if (!isEditablePixel(x, GRID_WIDTH, this._clockRegion)) continue;
          setPixelMut(next, x, y, color);
        }
      }
      this._onFrameChanged({ detail: { frame: next } } as CustomEvent<{ frame: PixelFrame }>);
    } catch (error) {
      this._error = error instanceof Error ? error.message : "Could not stamp the text.";
      this._retryAction = () => { void this._onTextPlaceRequested(event); };
    } finally {
      this._busy = null;
    }
  };

  private _duplicate = (): void => {
    this._overflowOpen = false;
    const newName = `${this._designName.trim() || NEW_DESIGN_NAME} copy`;
    const blank = [createFrame(this._frames[0]?.width ?? GRID_WIDTH, this._frames[0]?.height ?? GRID_HEIGHT)];
    this._currentDesignId = null;
    this._designName = newName;
    this._savedFingerprint = editorStateFingerprint({ name: newName, frames: blank, clockRegion: this._clockRegion });
    this._saveState = "unsaved";
  };

  private _clearCanvas = (): void => {
    this._overflowOpen = false;
    const blank = createFrame(this._activeFrame.width, this._activeFrame.height, [0, 0, 0], this._activeFrame.durationMs);
    this._pushFrames([blank]);
    this._activeFrameIndex = 0;
    this._playing = false;
  };

  private async _exportPng(): Promise<void> {
    this._overflowOpen = false;
    const frame = this._activeFrame;
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (!context) {
      this._error = "PNG export is unavailable in this browser.";
      return;
    }
    const image = context.createImageData(frame.width, frame.height);
    for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
      const source = pixel * 3;
      const target = pixel * 4;
      image.data[target] = frame.pixels[source]!;
      image.data[target + 1] = frame.pixels[source + 1]!;
      image.data[target + 2] = frame.pixels[source + 2]!;
      image.data[target + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      this._error = "Could not create a PNG file.";
      return;
    }
    downloadBlob(blob, `${safeFileName(this._designName)}.png`);
  }

  private _exportGif = (): void => {
    this._overflowOpen = false;
    try {
      const bytes = encodeAnimationGif(this._frames);
      downloadBlob(new Blob([bytes], { type: "image/gif" }), `${safeFileName(this._designName)}.gif`);
    } catch (error) {
      this._error = error instanceof Error ? error.message : "Could not create a GIF file.";
    }
  };

  private _openNew = (): void => { this._overflowOpen = false; this._newSheetOpen = true; };
  private _openImport = (): void => { this._overflowOpen = false; this._importSheetOpen = true; };
  private _openEffects = (): void => { this._overflowOpen = false; this._effectsSheetOpen = true; };
  private _onImportClosed = (): void => { this._importSheetOpen = false; };
  private _onColorClose = (): void => { this._colorSheetOpen = false; };
  private _onNewClose = (): void => { this._newSheetOpen = false; };
  private _onEffectsClose = (): void => { this._effectsSheetOpen = false; };
  private _onTextClose = (): void => { this._textSheetOpen = false; };
  private _onReplacementClose = (): void => { this._replacementSheetOpen = false; this._pendingReplacement = null; };

  private _onRetry = (): void => { this._error = null; this._retryAction?.(); };

  private _scheduleMenuAction(action: () => void): void {
    this._overflowOpen = false;
    action();
  }


  private _statusLabel(): string {
    if (this._saveState === "saved") return "Saved to library";
    if (this._saveState === "draft") return "Draft saved";
    return "Unsaved";
  }

  render() {
    const frames = this._frames;
    const previousFrame = this._onionEnabled && this._activeFrameIndex > 0 ? frames[this._activeFrameIndex - 1] ?? null : null;
    return html`<div class="destination" aria-label="Create a pixel design">
      ${this._error ? html`<lu-error message=${this._error} retry-label="Retry" @retry=${this._onRetry}></lu-error>` : nothing}
      <header class="editor-header">
        <div class="identity-row">
          <label class="name-field"><span>Design name</span><input type="text" aria-label="Design name" maxlength="80" .value=${this._designName} @input=${(event: Event) => { this._designName = (event.target as HTMLInputElement).value; }}></label>
          <lu-chip class="save-chip" label=${this._statusLabel()} kind=${this._saveState === "saved" ? "positive" : this._saveState === "draft" ? "neutral" : "warning"}></lu-chip>
          <div class="icon-actions" role="group" aria-label="Edit history">
            <lu-icon-button icon="mdi:undo" tooltip="Undo" aria-label="Undo" ?disabled=${this._history.past.length === 0 || this._busy === "render"} @lu-press=${this._onUndoRequested}></lu-icon-button>
            <lu-icon-button icon="mdi:redo" tooltip="Redo" aria-label="Redo" ?disabled=${this._history.future.length === 0 || this._busy === "render"} @lu-press=${this._onRedoRequested}></lu-icon-button>
          </div>
          <div class="overflow-wrap">
            <button type="button" class="overflow-button" aria-label="More editor actions" aria-expanded=${String(this._overflowOpen)} @click=${() => (this._overflowOpen = !this._overflowOpen)}>${mdiIcon("menu")}</button>
            ${this._overflowOpen ? html`<div class="overflow-menu" role="menu" aria-label="Editor actions">
              <button type="button" role="menuitem" class="menu-action" @click=${this._openNew}>${mdiIcon("plus")}<span>New…</span></button>
              <button type="button" role="menuitem" class="menu-action" @click=${() => this._scheduleMenuAction(this._duplicate)}>${mdiIcon("duplicate")}<span>Duplicate</span></button>
              <button type="button" role="menuitem" class="menu-action" @click=${this._openImport}>${mdiIcon("image")}<span>Import file…</span></button>
              <button type="button" role="menuitem" class="menu-action" @click=${() => this._scheduleMenuAction(() => this._openTextSheet("stamp"))}>${mdiIcon("textStamp")}<span>Text stamp…</span></button>
              <button type="button" role="menuitem" class="menu-action" @click=${this._openEffects}>${mdiIcon("generative")}<span>Effects…</span></button>
              <iledclock-hold-button class="clear-hold" label="Hold to clear canvas" complete-label="Canvas cleared" ?disabled=${this._busy !== null} @confirmed=${this._clearCanvas}></iledclock-hold-button>
              <button type="button" role="menuitem" class="menu-action" @click=${this._exportPng}>${mdiIcon("image")}<span>Export PNG</span></button>
              <button type="button" role="menuitem" class="menu-action" @click=${this._exportGif}>${mdiIcon("gif")}<span>Export GIF</span></button>
            </div>` : nothing}
          </div>
        </div>
        <div class="primary-actions">
          <lu-pill-button variant="secondary" label="Save" icon="mdi:content-save" ?loading=${this._busy === "save"} ?disabled=${!this.entryId || this._busy !== null} @lu-press=${this._saveClick}></lu-pill-button>
          <lu-pill-button variant="primary" label="Show on clock" icon="mdi:television-play" ?loading=${this._busy === "show"} ?disabled=${!this.entryId || this._busy !== null} @lu-press=${this._showClick}></lu-pill-button>
        </div>
      </header>
      <div class="workspace">
        ${this.entryId ? html`<div class="editor-center">
          <iledclock-pixel-editor .frame=${this._activeFrame} .onionSkin=${previousFrame} .wrap=${this._wrap} .activeColor=${this._activeColor} .recentColors=${this._recentColors} .brushSize=${this._brushSize} .clockRegion=${this._clockRegion} .stampText=${this._stampText} .narrow=${!this._wideLayout} .disabled=${this._busy === "render" || this._busy === "stamp"} @frame-changed=${this._onFrameChanged} @color-picked=${this._onColorPicked} @color-requested=${() => (this._colorSheetOpen = true)} @text-config-requested=${this._onTextConfigRequested} @text-place-requested=${this._onTextPlaceRequested} @wrap-changed=${this._onWrapChanged} @undo-requested=${this._onUndoRequested} @redo-requested=${this._onRedoRequested}></iledclock-pixel-editor>
          <lu-section class="timeline-section" title="Frames" icon="mdi:animation" description=${`${frames.length} frame${frames.length === 1 ? "" : "s"} · max 64`}>
            <iledclock-frame-timeline .frames=${frames} .activeIndex=${this._activeFrameIndex} .playing=${this._playing} @frames-changed=${this._onFramesChanged} @frame-selected=${this._onFrameSelected} @play-toggled=${this._onPlayToggled}></iledclock-frame-timeline>
          </lu-section>
        </div>` : html`<lu-empty title="Clock not found" message="Connect an iLedClock to create and save designs."></lu-empty>`}
        <iledclock-editor-inspector class="inspector" .activeColor=${this._activeColor} .recentColors=${this._recentColors} .brushSize=${this._brushSize} .onionSkin=${this._onionEnabled} .frameDelay=${this._activeFrame.durationMs} .clockRegion=${this._clockRegion} @inspector-color-picked=${this._onColorPicked} @inspector-color-requested=${() => (this._colorSheetOpen = true)} @inspector-brush-changed=${this._onBrushChanged} @inspector-delay-changed=${this._onInspectorDelay} @inspector-onion-changed=${this._onOnionChanged} @inspector-clock-region-changed=${this._onClockRegionChanged}></iledclock-editor-inspector>
      </div>
      <iledclock-editor-color-sheet .open=${this._colorSheetOpen} .color=${this._activeColor} .recent=${this._recentColors} @color-selected=${this._onColorPicked} @close-requested=${this._onColorClose} @closed=${this._onColorClose}></iledclock-editor-color-sheet>
      <iledclock-editor-new-sheet .open=${this._newSheetOpen} .hass=${this.hass} .entryId=${this.entryId} @new-option-selected=${this._onNewOption} @effect-previews-ready=${this._onEffectPreviewReady} @close-requested=${this._onNewClose} @closed=${this._onNewClose}></iledclock-editor-new-sheet>
      <iledclock-editor-effects-sheet .open=${this._effectsSheetOpen} .durationSeconds=${this._generativeSeconds} .previews=${this._effectPreviews} @effect-selected=${this._onEffectSelected} @close-requested=${this._onEffectsClose} @closed=${this._onEffectsClose}></iledclock-editor-effects-sheet>
      <iledclock-editor-text-sheet .open=${this._textSheetOpen} .mode=${this._textSheetMode} .color=${this._activeColor} @text-ready=${this._onTextReady} @close-requested=${this._onTextClose} @closed=${this._onTextClose}></iledclock-editor-text-sheet>
      <iledclock-import-sheet .hass=${this.hass} .entryId=${this.entryId} .open=${this._importSheetOpen} @close-requested=${this._onImportClosed} @closed=${this._onImportClosed}></iledclock-import-sheet>
      <lu-sheet .open=${this._replacementSheetOpen} label="Replace the current drawing" ?close-on-scrim=${false} @closed=${this._onReplacementClose}>
        <div class="replace-copy"><h2>Replace this drawing?</h2><p>Your current work is not saved to the library yet.</p></div>
        <div class="replace-actions"><button type="button" class="replace-button" @click=${this._keepEditing}>Keep editing</button><button type="button" class="replace-button" ?disabled=${!this.entryId || this._busy !== null} @click=${this._saveBeforeReplacement}>Save first</button><iledclock-hold-button class="replace-discard" label="Hold to discard" complete-label="Discarded" danger ?disabled=${this._busy !== null} @confirmed=${this._discardAndReplace}></iledclock-hold-button></div>
      </lu-sheet>
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .destination { display: grid; gap: var(--lu-space-4); min-width: 0; width: 100%; }
    .editor-header { display: grid; gap: var(--lu-space-3); min-width: 0; }
    .identity-row { display: flex; align-items: center; gap: var(--lu-space-2); min-width: 0; flex-wrap: wrap; }
    .name-field { display: grid; gap: var(--lu-space-1); flex: 1 1 14rem; min-width: 9rem; max-width: 28rem; color: var(--lu-ink-3); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .name-field input { width: 100%; min-width: 0; min-height: var(--lu-target); box-sizing: border-box; padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-card); color: var(--lu-ink); font: 500 var(--lu-type-body)/1.2 var(--lu-font); }
    .save-chip { flex: none; }
    .icon-actions { display: inline-flex; gap: var(--lu-space-1); }
    .overflow-wrap { position: relative; flex: none; }
    .overflow-button { display: inline-flex; align-items: center; justify-content: center; width: var(--lu-target); height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-tile); color: var(--lu-ink); cursor: pointer; }
    .overflow-menu { position: absolute; z-index: 20; inset-block-start: calc(100% + var(--lu-space-1)); inset-inline-end: 0; display: grid; gap: var(--lu-space-1); width: min(18rem, calc(100vw - 2rem)); max-height: min(70vh, 34rem); overflow: auto; padding: var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); background: var(--lu-card); box-shadow: var(--lu-highlight-rest), var(--lu-shadow-rest); }
    .menu-action { display: flex; align-items: center; gap: var(--lu-space-2); min-height: var(--lu-target); padding: 0 var(--lu-space-2); border: 0; border-radius: var(--lu-radius-control); background: transparent; color: var(--lu-ink); text-align: left; font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .menu-action:hover, .menu-action:focus-visible { background: var(--lu-glass-raised); }
    .clear-hold { display: block; min-width: 0; }
    .primary-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--lu-space-2); min-width: 0; }
    .primary-actions lu-pill-button:last-child { min-width: min(100%, 13rem); }
    .workspace { display: grid; grid-template-columns: minmax(0, 1fr) 280px; align-items: start; gap: var(--lu-space-4); min-width: 0; }
    .editor-center { display: grid; align-content: start; gap: var(--lu-space-3); min-width: 0; }
    .timeline-section { min-width: 0; }
    .inspector { min-width: 0; }
    .replace-copy h2 { margin: 0 0 var(--lu-space-2); color: var(--lu-ink); font: 600 var(--lu-type-title)/1.2 var(--lu-font); }
    .replace-copy p { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-body)/1.45 var(--lu-font); }
    .replace-actions { display: grid; gap: var(--lu-space-2); padding-top: var(--lu-space-3); }
    .replace-button { min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-tile); color: var(--lu-ink); font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .replace-button:disabled { opacity: .45; cursor: default; }
    .replace-discard { display: block; width: 100%; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    @container (max-width: 899px) { .workspace { grid-template-columns: minmax(0, 1fr); } .inspector { display: none; } .editor-header { gap: var(--lu-space-2); } }
    @container (max-width: 380px) { .identity-row { gap: var(--lu-space-1); } .name-field { flex: 1 1 100%; max-width: none; } .primary-actions { justify-content: stretch; } .primary-actions lu-pill-button { flex: 1 1 0; min-width: 0 !important; } }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  `];
}

customElements.define("iledclock-dest-create", IledclockDestCreate);

declare global { interface HTMLElementTagNameMap { "iledclock-dest-create": IledclockDestCreate; } }
