import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { ClockStateEnvelope, HomeAssistant, ManagedReminder, ReminderCapabilities, ReminderItem, ReminderList, StoredDesign, UploadProgressEvent } from "../types.ts";
import { navigateStudioRoute, type StudioRoute } from "../lib/route.ts";
import { designToFrames } from "../lib/design-codec.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { designsListRequest, reminderDeleteRequest, reminderResendRequest, reminderSetEnabledRequest, renderRequest } from "../lib/ws-api.ts";
import {
  posterFrames,
  TextArtCache,
  addBlockedReason,
  foreignRepeatSummary,
  formatClockTime,
  friendlyReminderError,
  repeatSummary,
  resolveReminderCapabilities,
  slotChip,
  sortReminders,
  statusView,
  textColorOf,
  timeLocaleFromHass,
  uploadPercent,
  usesSlotsText,
  wallClockNow,
  type StatusTone,
  type TimeLocale,
} from "../lib/reminders.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import type { LuToastRequest } from "./lu-toast.ts";
import "./iledclock-alarm-sheet.ts";
import "./iledclock-hold-button.ts";
import "./iledclock-led-preview.ts";
import "./lu-chip.ts";
import "./lu-empty.ts";
import "./lu-error.ts";
import "./lu-pill-button.ts";
import "./lu-skeleton.ts";

type AlarmsUpload = (UploadProgressEvent & { upload?: { done: number; total: number } | null }) | null;
type AlarmsEnvelope = ClockStateEnvelope;
type AlarmsSubscribeEvent = (AlarmsEnvelope & { type?: undefined }) | (UploadProgressEvent & { upload?: { done: number; total: number } | null });

const TICK_MS = 30_000;

/** "Alarms & reminders": named alarms and reminders that live on the clock's own reminder slots, so they keep
 * ringing when Home Assistant is off. The list, the clock-slot chip and the recovery buttons are here; the
 * edit form is `iledclock-alarm-sheet`, the art choice `iledclock-alarm-art-picker`, the rules `lib/reminders.ts`. */
export class IledclockDestAlarms extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    route: { attribute: false },
    narrow: { type: Boolean },
    _envelope: { state: true },
    _designs: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _upload: { state: true },
    _pending: { state: true },
    _now: { state: true },
    _textTick: { state: true },
    _hoverKey: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare route: StudioRoute;
  declare narrow: boolean;
  declare _envelope: AlarmsEnvelope | null;
  /** null until the Library has loaded (an empty array is a Library with no designs). */
  declare _designs: StoredDesign[] | null;
  declare _loading: boolean;
  declare _error: string | null;
  declare _upload: AlarmsUpload;
  /** Per item key (or `foreign:<id>`): what is being sent right now, in words. */
  declare _pending: Record<string, string>;
  declare _now: number;
  declare _textTick: number;
  declare _hoverKey: string | null;

  private _unsubscribe: (() => Promise<void>) | null = null;
  private _lastEntryId: string | undefined;
  private _lastConnection: HomeAssistant["connection"] | undefined;
  private _revision = 0;
  private _designsRevision = 0;
  private _routeSeen = false;
  private _wasActive = false;
  private _missingNotified = "";
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _textRequested = new Set<string>();
  private _textArt: TextArtCache;
  private readonly _frameCache = new Map<string, PixelFrame[]>();

  constructor() {
    super();
    this.narrow = false;
    this.route = { destination: "alarms" };
    this._envelope = null;
    this._designs = null;
    this._loading = false;
    this._error = null;
    this._upload = null;
    this._pending = {};
    this._now = Date.now();
    this._textTick = 0;
    this._hoverKey = null;
    this._textArt = this._newTextArt();
  }

  // ---- lifecycle -------------------------------------------------------------------------------------

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this._syncClock);
    if (this.entryId && this.entryId === this._lastEntryId && !this._unsubscribe) {
      this._lastConnection = this.hass?.connection;
      void this._load(this.entryId);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this._syncClock);
    if (this._unsubscribe) void this._unsubscribe();
    this._unsubscribe = null;
    this._revision++;
    this._upload = null;
    this._syncClock();
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size !== 1 || !changed.has("hass")) return true;
    const previous = changed.get("hass") as HomeAssistant | undefined;
    return !previous || previous.connection !== this.hass?.connection;
  }

  protected willUpdate(changed: PropertyValues): void {
    const entryChanged = changed.has("entryId") && this.entryId !== this._lastEntryId;
    const connection = this.hass?.connection;
    const connectionChanged = changed.has("hass") && connection !== this._lastConnection;
    if (entryChanged) this._textArt = this._newTextArt();
    if (entryChanged || connectionChanged) {
      this._lastEntryId = this.entryId;
      this._lastConnection = connection;
      void this._load(this.entryId);
    }
    if (changed.has("route")) this._onRoute();
    this._requestTextArt();
  }

  protected updated(): void {
    this._syncClock();
    this._closeVanishedSheet();
  }

  private get _active(): boolean {
    return this.route?.destination === "alarms";
  }

  /** Becoming the visible destination: look at the Library again (art may have been added) and
   * put the plain Alarms route behind a direct link so Back closes the sheet first. */
  private _onRoute(): void {
    if (!this._routeSeen) {
      this._routeSeen = true;
      if (this._active && this.route.alarm) {
        navigateStudioRoute({ destination: "alarms" }, true);
        navigateStudioRoute(this.route, false);
      }
    }
    if (this._active && !this._wasActive && this.entryId && this._designs !== null) void this._loadDesigns(this.entryId);
    this._wasActive = this._active;
  }

  private _syncClock = (): void => {
    const wanted = this.isConnected && this._active && document.visibilityState === "visible";
    if (wanted && this._timer === undefined) {
      this._now = Date.now();
      this._timer = setInterval(() => { this._now = Date.now(); }, TICK_MS);
    } else if (!wanted && this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  };

  private _newTextArt(): TextArtCache {
    return new TextArtCache((name, color) => {
      const entryId = this.entryId;
      if (!entryId || !this.hass?.callWS) return Promise.reject(new Error("Home Assistant connection is unavailable."));
      return this.hass.callWS<{ frames: string[]; delays: number[] }>(renderRequest(entryId, { type: "text", text: name, font: "5x7", color }));
    });
  }

  // ---- data ------------------------------------------------------------------------------------------

  private async _load(entryId: string | undefined): Promise<void> {
    if (this._unsubscribe) {
      void this._unsubscribe();
      this._unsubscribe = null;
    }
    const revision = ++this._revision;
    this._envelope = null;
    this._error = null;
    this._upload = null;
    this._pending = {};
    this._designs = null;
    this._textRequested = new Set();
    this._loading = false;
    if (!entryId || !this.hass?.callWS) return;
    this._loading = true;
    void this._loadDesigns(entryId);
    try {
      const envelope = await this.hass.callWS<AlarmsEnvelope>({ type: "iledclock/state", entry_id: entryId });
      if (entryId !== this.entryId || revision !== this._revision) return;
      this._envelope = envelope;
      if (this.hass.connection) {
        const unsubscribe = await this.hass.connection.subscribeMessage<AlarmsSubscribeEvent>((event) => {
          if (entryId !== this.entryId || revision !== this._revision) return;
          if (event.type === "upload") {
            this._upload = event.upload === null || event.state === "done" || event.state === "error" ? null : event;
            return;
          }
          this._envelope = event;
        }, { type: "iledclock/subscribe", entry_id: entryId });
        if (entryId !== this.entryId || revision !== this._revision || !this.isConnected) {
          void unsubscribe();
          return;
        }
        this._unsubscribe = unsubscribe;
      }
    } catch (error) {
      if (entryId === this.entryId && revision === this._revision) this._error = friendlyReminderError(error);
    } finally {
      if (entryId === this.entryId && revision === this._revision) this._loading = false;
    }
  }

  private async _loadDesigns(entryId: string): Promise<void> {
    const revision = ++this._designsRevision;
    if (!this.hass?.callWS) return;
    try {
      const designs = await this.hass.callWS<StoredDesign[]>(designsListRequest(entryId));
      if (revision !== this._designsRevision || entryId !== this.entryId) return;
      this._designs = Array.isArray(designs) ? designs : [];
    } catch {
      // The list still works without art thumbnails; the sheet falls back to its own message.
      if (revision === this._designsRevision && entryId === this.entryId && this._designs === null) this._designs = [];
    }
  }

  private get _list(): ReminderList | null {
    return this._envelope?.reminder_list ?? null;
  }

  private get _caps(): ReminderCapabilities {
    return resolveReminderCapabilities(this._envelope?.capabilities?.reminders);
  }

  /** Write one item the server just answered with into the list at once; the state push confirms it. */
  private _applyItem(item: ManagedReminder | null | undefined): void {
    const envelope = this._envelope;
    const list = envelope?.reminder_list;
    if (!envelope || !list || !item) return;
    const exists = list.items.some((entry) => entry.key === item.key);
    const items = exists ? list.items.map((entry) => (entry.key === item.key ? item : entry)) : [...list.items, item];
    this._envelope = { ...envelope, reminder_list: { ...list, items } };
  }

  private _removeItem(key: string): void {
    const envelope = this._envelope;
    const list = envelope?.reminder_list;
    if (!envelope || !list) return;
    this._envelope = { ...envelope, reminder_list: { ...list, items: list.items.filter((entry) => entry.key !== key) } };
  }

  private _toast(request: LuToastRequest): void {
    this.dispatchEvent(new CustomEvent<LuToastRequest>("lu-toast", { detail: request, bubbles: true, composed: true }));
  }

  private _setPending(key: string, label: string | null): void {
    const next = { ...this._pending };
    if (label === null) delete next[key];
    else next[key] = label;
    this._pending = next;
  }

  // ---- art for the rows ------------------------------------------------------------------------------------

  /** Ask for the drawn name of every row that shows its name as text (cached, a couple at a time). */
  private _requestTextArt(): void {
    for (const item of this._list?.items ?? []) {
      if (item.attachment.kind !== "text") continue;
      const color = textColorOf(item.attachment);
      const key = color.join(",") + "|" + item.name;
      if (this._textRequested.has(key)) continue;
      this._textRequested.add(key);
      if (this._textArt.peek(item.name, color)) continue;
      this._textArt.load(item.name, color).then(
        () => { this._textTick++; },
        () => { this._textRequested.delete(key); },
      );
    }
  }

  private _framesFor(item: ManagedReminder): PixelFrame[] | null {
    if (item.attachment.kind === "design") {
      const designId = item.attachment.design_id;
      const design = this._designs?.find((candidate) => candidate.id === designId);
      if (!design) return null;
      const key = design.id + "|" + design.updated;
      let frames = this._frameCache.get(key);
      if (!frames) {
        frames = designToFrames(design);
        this._frameCache.set(key, frames);
      }
      return frames;
    }
    return this._textArt.peek(item.name, textColorOf(item.attachment)) ?? null;
  }

  // ---- actions ---------------------------------------------------------------------------------------------

  private _openAlarm(key: string): void {
    navigateStudioRoute({ destination: "alarms", alarm: key });
  }

  private _closeSheet = (): void => {
    if (this.route.alarm) window.history.back();
  };

  /** A link to an alarm that is gone (deleted elsewhere): close its sheet instead of showing nothing. */
  private _closeVanishedSheet(): void {
    const key = this._active ? this.route.alarm : undefined;
    if (!key || key === "new" || !this._list) return;
    if (this._list.items.some((item) => item.key === key)) return;
    if (this._missingNotified === key) return;
    this._missingNotified = key;
    navigateStudioRoute({ destination: "alarms" }, true);
    this._toast({ message: "That alarm isn't there any more.", timeoutMs: 4000 });
  }

  /** Is a request that was started for this clock and this load still the one the screen shows? False once the user
   * switched clocks or the view reloaded: its answer belongs to something that is gone. */
  private _current(entryId: string, revision: number): boolean {
    return entryId === this.entryId && revision === this._revision;
  }

  private async _toggle(item: ManagedReminder): Promise<void> {
    if (this._pending[item.key] || !this.entryId || !this.hass?.callWS) return;
    const entryId = this.entryId;
    const revision = this._revision;
    const next = !item.enabled;
    this._setPending(item.key, next ? "Switching on…" : "Switching off…");
    try {
      const result = await this.hass.callWS<{ item?: ManagedReminder }>(reminderSetEnabledRequest(entryId, item.key, next));
      if (this._current(entryId, revision)) this._applyItem(result?.item);
    } catch (error) {
      if (this._current(entryId, revision)) this._toast({ message: "Couldn't switch " + item.name + (next ? " on" : " off") + ": " + friendlyReminderError(error), timeoutMs: 8000 });
    } finally {
      if (this._current(entryId, revision)) this._setPending(item.key, null);
    }
  }

  private async _resend(item: ManagedReminder): Promise<void> {
    if (this._pending[item.key] || !this.entryId || !this.hass?.callWS) return;
    const entryId = this.entryId;
    const revision = this._revision;
    this._setPending(item.key, "Sending to the clock…");
    try {
      const result = await this.hass.callWS<{ item?: ManagedReminder }>(reminderResendRequest(entryId, item.key));
      if (!this._current(entryId, revision)) return;
      this._applyItem(result?.item);
      this._toast({ message: item.name + " is on the clock again.", timeoutMs: 3500 });
    } catch (error) {
      if (this._current(entryId, revision)) this._toast({ message: "Couldn't send " + item.name + ": " + friendlyReminderError(error), timeoutMs: 8000 });
    } finally {
      if (this._current(entryId, revision)) this._setPending(item.key, null);
    }
  }

  private async _deleteForeign(item: ReminderItem): Promise<void> {
    const key = "foreign:" + item.id;
    if (this._pending[key] || !this.entryId || !this.hass?.callWS) return;
    const entryId = this.entryId;
    const revision = this._revision;
    this._setPending(key, "Deleting…");
    try {
      await this.hass.callWS(reminderDeleteRequest(entryId, { id: item.id }));
      if (this._current(entryId, revision)) this._toast({ message: "Deleted " + (item.content || "the reminder") + " from the clock.", timeoutMs: 3500 });
    } catch (error) {
      if (this._current(entryId, revision)) this._toast({ message: "Couldn't delete it: " + friendlyReminderError(error), timeoutMs: 8000 });
    } finally {
      if (this._current(entryId, revision)) this._setPending(key, null);
    }
  }

  private _onSaved = (event: CustomEvent<{ item: ManagedReminder | null; created: boolean }>): void => {
    const { item, created } = event.detail;
    this._applyItem(item);
    // A new item now has a key: keep the address bar (and Back) pointing at it.
    if (item && created && this.route.alarm === "new") navigateStudioRoute({ destination: "alarms", alarm: item.key }, true);
  };

  private _onDeleted = (event: CustomEvent<{ key: string; name: string }>): void => {
    this._removeItem(event.detail.key);
    this._toast({ message: "Deleted " + (event.detail.name || "the alarm") + ".", timeoutMs: 3500 });
    this._closeSheet();
  };

  private _retry = (): void => { void this._load(this.entryId); };

  private _setHover(key: string | null): void {
    if (key !== null && !window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    this._hoverKey = key;
  }

  // ---- rendering -------------------------------------------------------------------------------------------

  private _stateIcon(tone: StatusTone): TemplateResult | typeof nothing {
    if (tone === "warn" || tone === "error") return html`<span class="state-icon ${tone}">${mdiIcon("close")}</span>`;
    if (tone === "ok") return html`<span class="state-icon ok">${mdiIcon("check")}</span>`;
    return nothing;
  }

  private _renderThumb(item: ManagedReminder) {
    const frames = this._framesFor(item);
    if (!frames || frames.length === 0) return html`<span class="thumb-blank">${mdiIcon(item.attachment.kind === "text" ? "text" : "image")}</span>`;
    const playing = this._hoverKey === item.key && frames.length > 1;
    return html`<iledclock-led-preview context="thumb" max-pitch="2" .frames=${playing ? frames : posterFrames(frames)} .delays=${playing ? frames.map((frame) => frame.durationMs) : [frames[0]!.durationMs]} ?playing=${playing}></iledclock-led-preview>`;
  }

  private _renderRow(item: ManagedReminder, now: Date, tl: TimeLocale, outOfRange: boolean): TemplateResult {
    const time = formatClockTime(item.hour, item.minute, tl);
    const summary = repeatSummary(item, tl);
    const status = statusView(item, now, tl);
    const uses = usesSlotsText(item);
    const pending = this._pending[item.key];
    const percent = pending ? uploadPercent(this._upload) : null;
    const stateText = pending ? pending + (percent !== null ? " " + percent + "%" : "") : status.text;
    const tone: StatusTone = pending ? "info" : status.tone;
    const meta = uses ? summary + " · " + uses : summary;
    return html`<li class="row ${item.enabled ? "" : "off"}">
      <button type="button" class="row-main" aria-haspopup="dialog" aria-label=${"Edit " + item.name + ". " + time.text + ". " + meta + ". " + stateText} @click=${() => this._openAlarm(item.key)} @pointerenter=${() => this._setHover(item.key)} @pointerleave=${() => this._setHover(null)} @focus=${() => this._setHover(item.key)} @blur=${() => this._setHover(null)}>
        <span class="row-text">
          <span class="row-time">${time.periodFirst && time.period ? html`<span class="period first">${time.period}</span>` : nothing}<span class="clock">${time.main}</span>${!time.periodFirst && time.period ? html`<span class="period">${time.period}</span>` : nothing}</span>
          <span class="row-name">${item.kind === "reminder" ? mdiIcon("reminder") : mdiIcon("alarm")}<span class="name-text">${item.name}</span></span>
          <span class="row-meta">${meta}</span>
          <span class="row-state ${tone}">${pending ? nothing : this._stateIcon(tone)}<span>${stateText}</span></span>
        </span>
        <span class="row-thumb" aria-hidden="true">${this._renderThumb(item)}</span>
      </button>
      <button type="button" role="switch" class="row-switch" aria-checked=${item.enabled ? "true" : "false"} aria-label=${item.name + ", " + time.text} ?disabled=${outOfRange} aria-disabled=${pending ? "true" : nothing} aria-busy=${pending ? "true" : "false"} @click=${() => void this._toggle(item)}><span class="switch ${item.enabled ? "on" : ""}" aria-hidden="true"></span></button>
      ${status.action && !pending ? html`<div class="row-fix"><lu-pill-button variant="quiet" .label=${status.actionLabel} aria-label=${status.actionLabel + " " + item.name + " to the clock"} ?disabled=${outOfRange} @lu-press=${() => void this._resend(item)}></lu-pill-button></div>` : nothing}
    </li>`;
  }

  private _renderForeign(list: ReminderList, tl: TimeLocale, outOfRange: boolean): TemplateResult | typeof nothing {
    if (list.foreign.length === 0) return nothing;
    return html`<section class="sheet" aria-labelledby="foreign-title">
      <header class="block-head"><div><h2 id="foreign-title">On the clock only</h2><p>Made with the clock's own app. Home Assistant can't edit these, but you can delete them.</p></div></header>
      <ul class="rows foreign">
        ${list.foreign.map((item) => {
          const time = formatClockTime(item.hour, item.minute, tl);
          const key = "foreign:" + item.id;
          const pending = this._pending[key];
          return html`<li class="row foreign-row">
            <div class="row-text">
              <span class="row-time"><span class="clock">${time.main}</span>${time.period ? html`<span class="period">${time.period}</span>` : nothing}</span>
              <span class="row-name">${mdiIcon("reminder")}<span class="name-text">${item.content || "Untitled reminder"}</span></span>
              <span class="row-meta">${foreignRepeatSummary(item, tl)}</span>
            </div>
            <div class="foreign-action"><iledclock-hold-button label=${"Hold to delete"} complete-label="Deleted" danger ?disabled=${Boolean(pending) || outOfRange} @confirmed=${() => void this._deleteForeign(item)}></iledclock-hold-button></div>
          </li>`;
        })}
      </ul>
    </section>`;
  }

  private _renderHeader(list: ReminderList | null, addReason: string | null, outOfRange: boolean, showAdd: boolean) {
    const chip = list ? slotChip(list) : null;
    const percent = uploadPercent(this._upload);
    return html`<header class="head sheet">
      <div class="head-main">
        <span class="head-icon" aria-hidden="true">${mdiIcon("alarm")}</span>
        <div class="head-text">
          <h1 id="alarms-title">Alarms &amp; reminders</h1>
          <p>Each one is stored on the clock, so it keeps ringing even when Home Assistant is off.</p>
        </div>
      </div>
      <div class="head-actions">
        ${chip ? html`<lu-chip .label=${chip.label} .kind=${chip.kind}></lu-chip>` : nothing}
        ${showAdd ? html`<lu-pill-button variant="primary" label="Add alarm" icon="mdi:plus" ?disabled=${Boolean(addReason) || !list || outOfRange} @lu-press=${() => this._openAlarm("new")}></lu-pill-button>` : nothing}
      </div>
      ${addReason && showAdd ? html`<p class="note warn" role="status">${addReason}</p>` : nothing}
      ${outOfRange ? html`<p class="note warn" role="status">The clock is out of range, so alarms can't be changed right now. The list shows what's saved here.</p>` : nothing}
      ${list && list.synced_at === null && !outOfRange ? html`<p class="note" role="status">The clock hasn't been read yet, so the slot count is what's saved here.</p>` : nothing}
      ${this._upload ? html`<p class="note" role="status">Sending to the clock${percent !== null ? "… " + percent + "%" : "…"}</p>${percent !== null ? html`<div class="progress" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${percent}><span style=${"width:" + percent + "%"}></span></div>` : nothing}` : nothing}
    </header>`;
  }

  private _renderBody(list: ReminderList, now: Date, tl: TimeLocale, outOfRange: boolean) {
    const items = sortReminders(list.items, now);
    if (items.length === 0) {
      return html`<section class="sheet" aria-labelledby="alarms-title">
        <lu-empty icon="mdi:alarm" title="No alarms yet" message="Add an alarm or reminder with a name and a picture. It's stored on the clock, so it still rings when Home Assistant is off." action-label="Add alarm" action-variant="primary" @empty-action=${() => this._openAlarm("new")}></lu-empty>
      </section>`;
    }
    return html`<section class="sheet" aria-label="Your alarms and reminders">
      <ul class="rows">${repeat(items, (item) => item.key, (item) => this._renderRow(item, now, tl, outOfRange))}</ul>
    </section>`;
  }

  render() {
    if (!this.entryId) return html`<lu-empty title="No clock connected" message="Add an iLedClock to manage its alarms and reminders."></lu-empty>`;
    if (this._loading && !this._envelope) return html`<div class="destination" role="status" aria-busy="true"><lu-skeleton variant="card" height="7rem" label="Loading alarms"></lu-skeleton><lu-skeleton variant="card" height="14rem" label="Loading alarms"></lu-skeleton></div>`;
    if (this._error && !this._envelope) return html`<lu-error title="Couldn't load your alarms" .message=${this._error} @retry=${this._retry}></lu-error>`;
    const envelope = this._envelope;
    const list = this._list;
    const connected = Boolean(envelope?.connected);
    const now = wallClockNow(this.hass?.config?.time_zone, this._now);
    const tl = timeLocaleFromHass(this.hass);
    if (!list) {
      return html`<div class="destination">
        ${this._renderHeader(null, null, false, false)}
        ${connected
          ? html`<div class="sheet" role="status" aria-busy="true"><lu-skeleton variant="card" height="10rem" label="Reading alarms from the clock"></lu-skeleton></div>`
          : html`<lu-error title="The clock hasn't been read yet" message="Pixel Studio reads the clock's alarms once before it can show them. Move the clock closer, then try again." retry-label="Try again" @retry=${this._retry}></lu-error>`}
      </div>`;
    }
    const outOfRange = !connected;
    const addReason = addBlockedReason(list);
    const sheetKey = this._active ? this.route.alarm : undefined;
    const editing = sheetKey && sheetKey !== "new" ? (list.items.find((item) => item.key === sheetKey) ?? null) : null;
    const sheetOpen = Boolean(sheetKey) && (sheetKey === "new" || editing !== null);
    return html`<div class="destination">
      ${this._renderHeader(list, addReason, outOfRange, list.items.length > 0)}
      ${this._renderBody(list, now, tl, outOfRange)}
      ${this._renderForeign(list, tl, outOfRange)}
      <iledclock-alarm-sheet .hass=${this.hass} .entryId=${this.entryId} .open=${sheetOpen} .item=${editing} .list=${list} .capabilities=${this._caps} .designs=${this._designs} .textArt=${this._textArt} .upload=${this._upload} .connected=${connected} @alarm-saved=${this._onSaved} @alarm-deleted=${this._onDeleted} @close-requested=${this._closeSheet}></iledclock-alarm-sheet>
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .destination { display: grid; gap: var(--lu-space-4); min-width: 0; }
    .sheet { min-width: 0; background: var(--lu-card); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); box-shadow: var(--lu-highlight-rest), var(--lu-shadow-rest); }
    .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--lu-space-3) var(--lu-space-4); padding: var(--lu-space-4); }
    .head-main { display: flex; flex: 1 1 18rem; align-items: center; gap: var(--lu-space-3); min-width: 0; }
    .head-icon { display: grid; flex: none; place-items: center; width: var(--lu-target); height: var(--lu-target); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: var(--lu-tile); }
    .head-icon svg { width: var(--lu-space-6); height: var(--lu-space-6); }
    .head-text { min-width: 0; }
    h1, h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); letter-spacing: -0.01em; }
    .head-text p, .block-head p { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); }
    .head-actions { display: flex; flex: 0 1 auto; flex-wrap: wrap; align-items: center; gap: var(--lu-space-2); min-width: 0; }
    .note { flex: 1 1 100%; margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); }
    .note.warn { color: var(--lu-ink); font-weight: 500; }
    .progress { flex: 1 1 100%; height: var(--lu-space-1); overflow: hidden; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); }
    .progress span { display: block; height: 100%; border-radius: inherit; background: var(--lu-accent); transition: width var(--lu-motion-label) var(--lu-ease); }
    .rows { margin: 0; padding: var(--lu-space-2); list-style: none; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; border-bottom: 1px solid var(--lu-edge); }
    .row:last-child { border-bottom: 0; }
    .row-main { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: var(--lu-space-3); min-width: 0; min-height: calc(var(--lu-target) + var(--lu-space-6)); padding: var(--lu-space-3) var(--lu-space-3); border: 0; border-radius: var(--lu-radius-row); color: var(--lu-ink); background: transparent; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .row-main:hover { background: var(--lu-tile); }
    .row-main:active { background: var(--lu-glass-raised); transition: none; }
    .row-main:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: -2px; }
    .row-text { display: grid; gap: var(--lu-space-1); min-width: 0; }
    .row-time { display: flex; align-items: baseline; gap: var(--lu-space-1); color: var(--lu-ink); }
    .clock { font: 500 var(--lu-type-display)/1 var(--lu-font); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .period { color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1 var(--lu-font); }
    .row.off .clock { color: var(--lu-ink-2); }
    .row-name { display: flex; align-items: center; gap: var(--lu-space-2); min-width: 0; color: var(--lu-ink); font: 600 var(--lu-type-body)/1.3 var(--lu-font); }
    .row-name svg { flex: none; width: var(--lu-space-4); height: var(--lu-space-4); color: var(--lu-ink-2); }
    .name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-meta { color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .row-state { display: flex; align-items: flex-start; gap: var(--lu-space-2); color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); overflow-wrap: anywhere; }
    .row-state.warn, .row-state.error { color: var(--lu-ink); font-weight: 500; }
    .state-icon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--lu-space-4); height: var(--lu-space-4); margin-top: 1px; border-radius: var(--lu-radius-pill); color: var(--lu-accent-ink); }
    .state-icon svg { width: var(--lu-space-3); height: var(--lu-space-3); }
    .state-icon.ok { background: var(--lu-positive); }
    .state-icon.warn { background: var(--lu-warning); }
    .state-icon.error { background: var(--lu-danger); }
    .row-thumb { display: grid; place-items: center; align-self: start; width: calc(var(--lu-space-8) * 2 - var(--lu-space-2)); aspect-ratio: 2 / 1; overflow: hidden; border-radius: var(--lu-radius-control); background: #050607; color: var(--lu-ink-3); }
    .row-thumb iledclock-led-preview { border-radius: var(--lu-radius-control); }
    .row.off .row-thumb { opacity: .55; }
    .thumb-blank svg { width: var(--lu-space-5); height: var(--lu-space-5); }
    .row-switch { display: grid; place-items: center; width: var(--lu-target); height: var(--lu-target); margin: var(--lu-space-2) var(--lu-space-2) 0 var(--lu-space-1); padding: 0; border: 0; background: transparent; cursor: pointer; }
    .row-switch:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: -2px; border-radius: var(--lu-radius-control); }
    .row-switch:disabled, .row-switch[aria-disabled="true"] { cursor: default; }
    .switch { position: relative; flex: none; width: 48px; height: 28px; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); transition: background-color var(--lu-motion-label) var(--lu-ease); }
    .switch::after { position: absolute; top: 4px; left: 4px; width: 20px; height: 20px; border-radius: var(--lu-radius-pill); background: var(--lu-card); content: ""; transition: transform var(--lu-motion-label) var(--lu-ease); }
    .switch.on { background: var(--lu-accent); }
    .switch.on::after { transform: translateX(20px); }
    .row-switch:disabled .switch, .row-switch[aria-disabled="true"] .switch { opacity: .6; }
    .row-fix { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: var(--lu-space-2); padding: 0 var(--lu-space-3) var(--lu-space-3); }
    .block-head { padding: var(--lu-space-4) var(--lu-space-4) 0; }
    .foreign-row { grid-template-columns: minmax(0, 1fr) minmax(0, 11rem); gap: var(--lu-space-3); padding: var(--lu-space-3) var(--lu-space-3); }
    .foreign-row .row-text { gap: var(--lu-space-1); }
    .foreign-action { min-width: 0; }
    .destination > lu-skeleton { display: block; }
    @container (min-width: 46rem) {
      .rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr)); gap: var(--lu-space-2); padding: var(--lu-space-3); }
      .row, .row:last-child { border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-row); }
    }
    @container (max-width: 520px) {
      .foreign-row { grid-template-columns: minmax(0, 1fr); }
      .row-main { gap: var(--lu-space-2); padding-inline: var(--lu-space-2); }
      .head { padding: var(--lu-space-3); }
    }
    @media (prefers-reduced-motion: reduce) { .switch, .switch::after, .progress span { transition: none; } }
  `];
}

customElements.define("iledclock-dest-alarms", IledclockDestAlarms);

declare global { interface HTMLElementTagNameMap { "iledclock-dest-alarms": IledclockDestAlarms; } }
