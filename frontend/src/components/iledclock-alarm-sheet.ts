import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import type { HomeAssistant, ManagedReminder, ReminderAttachment, ReminderCapabilities, ReminderList, ReminderRepeat, StoredDesign, UploadProgressEvent } from "../types.ts";
import { designToFrames } from "../lib/design-codec.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { DAY_LABELS } from "../lib/repeat-days.ts";
import { radioTargetIndex } from "../lib/radio-keys.ts";
import { reminderDeleteRequest, reminderSetRequest } from "../lib/ws-api.ts";
import {
  DAY_FULL_NAMES,
  REMINDER_TEXT_COLORS,
  TextArtCache,
  blankForm,
  changeRepeat,
  daysInMonth,
  describeNextRing,
  designEligibility,
  designMeta,
  durationLabel,
  editingRecord,
  formFromItem,
  formSchedule,
  formToInput,
  formsEqual,
  friendlyReminderError,
  isoDateOf,
  monthName,
  nextMonthlyDate,
  nextOccurrenceDate,
  nextRing,
  nextYearlyDate,
  normalizeDays,
  ordinal,
  parseIsoDate,
  parseTimeValue,
  repeatLabel,
  posterFrames,
  repeatUsesDate,
  resolveReminderCapabilities,
  sameColor,
  savedStatusText,
  slotsNeeded,
  slotsNoteText,
  textColorOf,
  timeLocaleFromHass,
  uploadPercent,
  validateForm,
  wallClockNow,
  type AlarmForm,
  type FormErrors,
  type FormField,
  type StatusTone,
} from "../lib/reminders.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./lu-sheet.ts";
import "./lu-pill-button.ts";
import "./lu-icon-button.ts";
import "./lu-sheet.ts";
import "./iledclock-hold-button.ts";
import "./iledclock-led-preview.ts";
import "./iledclock-alarm-art-picker.ts";

/** Fields whose problem is shown as soon as it exists; name and time wait until the user has been there or
 * pressed Save, so a brand-new form does not open in the red. */
const SHOW_AT_ONCE: ReadonlySet<FormField> = new Set<FormField>(["repeat", "days", "date", "duration", "attachment", "slots"]);

const SAMPLE_NAME = "Wake up";

type SheetUpload = (UploadProgressEvent & { upload?: { done: number; total: number } | null }) | null;

/** The edit sheet for one alarm or reminder (new or existing). Saves through `iledclock/command reminder_set`
 * itself so it can keep the form, show what the clock said, and never lose what was typed. Events (bubbling,
 * composed): `alarm-saved` `{item, created}`, `alarm-deleted` `{key, name}`, `close-requested`. */
export class IledclockAlarmSheet extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    open: { type: Boolean, reflect: true },
    item: { attribute: false },
    list: { attribute: false },
    capabilities: { attribute: false },
    designs: { attribute: false },
    textArt: { attribute: false },
    upload: { attribute: false },
    connected: { type: Boolean },
    _form: { state: true },
    _initial: { state: true },
    _pane: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _savedItem: { state: true },
    _submitted: { state: true },
    _touched: { state: true },
    _now: { state: true },
    _textTick: { state: true },
    _artPending: { state: true },
  };

  declare hass: HomeAssistant | undefined;
  declare entryId: string | undefined;
  declare open: boolean;
  /** The item being edited; null for a new one. */
  declare item: ManagedReminder | null;
  declare list: ReminderList | null;
  declare capabilities: ReminderCapabilities | undefined;
  /** null until the Library has loaded. */
  declare designs: StoredDesign[] | null;
  declare textArt: TextArtCache | null;
  declare upload: SheetUpload;
  declare connected: boolean;
  declare _form: AlarmForm;
  declare _initial: AlarmForm;
  declare _pane: "form" | "art";
  declare _busy: "save" | "delete" | null;
  declare _error: string | null;
  declare _savedItem: ManagedReminder | null;
  declare _submitted: boolean;
  declare _touched: Partial<Record<FormField, boolean>>;
  declare _now: number;
  declare _textTick: number;
  declare _artPending: boolean;

  private _dateTouched = false;
  /** Bumped whenever an editing session starts or ends (the sheet opens, closes, or switches to another alarm or
   * clock). A save or delete started in an earlier session must not touch the form, the busy state or the events
   * of the current one. */
  private _session = 0;
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _textKey = "";
  private _designFrames: { key: string; frames: PixelFrame[] } | null = null;
  private readonly _artRow = createRef<HTMLButtonElement>();
  private readonly _body = createRef<HTMLElement>();

  constructor() {
    super();
    this.open = false;
    this.item = null;
    this.list = null;
    this.designs = null;
    this.textArt = null;
    this.upload = null;
    this.connected = true;
    this._now = Date.now();
    // A placeholder: `_begin()` builds the real form, on Home Assistant's clock, each time the sheet opens.
    this._form = blankForm(new Date(this._now));
    this._initial = this._form;
    this._pane = "form";
    this._busy = null;
    this._error = null;
    this._savedItem = null;
    this._submitted = false;
    this._touched = {};
    this._textTick = 0;
    this._artPending = false;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopClock();
    window.removeEventListener("keydown", this._onWindowKey, true);
  }

  // ---- lifecycle -------------------------------------------------------------------------------------

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("open") && !this.open) this._session++;
    if (changed.has("open") && this.open) this._begin();
    else if (this.open && changed.has("item") && (this.item?.key ?? undefined) !== this._form.key && this.item !== null) this._begin();
    else if (this.open && changed.has("entryId") && changed.get("entryId") !== undefined) this._begin();
    if (this.open) this._ensureText();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("open")) {
      if (this.open) this._startClock();
      else {
        this._stopClock();
        window.removeEventListener("keydown", this._onWindowKey, true);
      }
    }
    if (changed.has("_pane")) {
      window.removeEventListener("keydown", this._onWindowKey, true);
      if (this._pane === "art") window.addEventListener("keydown", this._onWindowKey, true);
      const body = this.renderRoot.querySelector("lu-sheet")?.shadowRoot?.querySelector<HTMLElement>(".body");
      if (body) body.scrollTop = 0;
    }
  }

  private _begin(): void {
    this._session++;
    this._now = Date.now();
    const opened = this.item;
    const form = opened ? formFromItem(opened) : blankForm(this._wallNow(), this._caps());
    this._form = form;
    this._initial = form;
    this._pane = "form";
    this._artPending = false;
    this._busy = null;
    this._error = null;
    this._savedItem = null;
    this._submitted = false;
    this._touched = {};
    this._dateTouched = Boolean(opened);
    this._textKey = "";
    // On a desktop the name is the first thing to type; on a phone the on-screen keyboard would cover the form.
    if (!opened && window.matchMedia?.("(pointer: fine)").matches) {
      void this.updateComplete.then(() => requestAnimationFrame(() => this.renderRoot.querySelector<HTMLInputElement>("#name")?.focus()));
    }
  }

  private _startClock(): void {
    this._stopClock();
    this._timer = setInterval(() => { this._now = Date.now(); }, 30_000);
  }

  private _stopClock(): void {
    clearInterval(this._timer);
    this._timer = undefined;
  }

  private _caps(): ReminderCapabilities {
    return resolveReminderCapabilities(this.capabilities);
  }

  /** Now on the wall clock of Home Assistant's time zone (what the clock is programmed in); see `wallClockNow`. */
  private _wallNow(instant: number = this._now): Date {
    return wallClockNow(this.hass?.config?.time_zone, instant);
  }

  /** The stored item this form edits: found by the form's key in the CURRENT list, so it is also found when the
   * sheet was opened as "new" and a first save stored the item although the clock failed. */
  private get _editing(): ManagedReminder | null {
    return editingRecord(this.list, this._form.key, this.item);
  }

  /** Is this save or delete still the one the sheet is showing? False once the sheet closed or opened another
   * alarm or clock. */
  private _isCurrent(session: number, entryId: string | undefined): boolean {
    return session === this._session && entryId === this.entryId;
  }

  private get _dirty(): boolean {
    return !formsEqual(this._form, this._initial);
  }

  /** Nothing to save: the form matches what was just saved, or an untouched item that needs no attention. */
  private get _isClean(): boolean {
    if (this._dirty) return false;
    if (this._savedItem) return true;
    const editing = this._editing;
    return editing !== null && (editing.status === "synced" || editing.status === "disabled" || editing.status === "done");
  }

  private _errors(instant: number = this._now): FormErrors {
    return validateForm(this._form, {
      now: this._wallNow(instant),
      capabilities: this._caps(),
      list: this.list,
      editing: this._editing,
      designs: this.designs ?? undefined,
    });
  }

  private _visible(errors: FormErrors): FormErrors {
    const shown: FormErrors = {};
    for (const field of Object.keys(errors) as FormField[]) {
      if (this._submitted || SHOW_AT_ONCE.has(field) || this._touched[field]) shown[field] = errors[field];
    }
    return shown;
  }

  // ---- text drawing for the art row ------------------------------------------------------------------------

  private get _artName(): string {
    return this._form.name.trim() || SAMPLE_NAME;
  }

  private _ensureText(): void {
    const cache = this.textArt;
    if (!cache || this._form.attachment.kind !== "text") return;
    const color = textColorOf(this._form.attachment);
    const text = this._artName;
    const key = color.join(",") + "|" + text;
    if (key === this._textKey) return;
    this._textKey = key;
    if (cache.peek(text, color)) return;
    cache.load(text, color).then(
      () => { if (this._textKey === key) this._textTick++; },
      () => undefined,
    );
  }

  private _designFramesFor(design: StoredDesign): PixelFrame[] {
    const key = design.id + "|" + design.updated;
    if (this._designFrames?.key !== key) this._designFrames = { key, frames: designToFrames(design) };
    return this._designFrames.frames;
  }

  // ---- editing ---------------------------------------------------------------------------------------------

  private _edit(patch: Partial<AlarmForm>, touched?: FormField): void {
    this._form = { ...this._form, ...patch };
    this._error = null;
    if (touched) this._touched = { ...this._touched, [touched]: true };
  }

  private _onName = (event: Event): void => {
    this._edit({ name: (event.target as HTMLInputElement).value });
  };

  private _onTime = (event: Event): void => {
    const time = (event.target as HTMLInputElement).value;
    const parsed = parseTimeValue(time);
    const patch: Partial<AlarmForm> = { time };
    if (this._form.repeat === "once" && !this._dateTouched && parsed) patch.date = nextOccurrenceDate(parsed, this._wallNow(Date.now()));
    this._edit(patch);
  };

  private _setRepeat(repeat: ReminderRepeat): void {
    if (repeat === this._form.repeat) return;
    this._form = changeRepeat(this._form, repeat, this._wallNow(Date.now()));
    this._error = null;
  }

  private _toggleDay(day: number): void {
    if (this._form.repeat === "weekly") {
      this._edit({ days: [day] });
      return;
    }
    const days = this._form.days.includes(day) ? this._form.days.filter((value) => value !== day) : [...this._form.days, day];
    this._edit({ days: normalizeDays(days) });
  }

  private _onDate = (event: Event): void => {
    this._dateTouched = true;
    this._edit({ date: (event.target as HTMLInputElement).value });
  };

  private _onMonthDay = (event: Event): void => {
    const time = parseTimeValue(this._form.time) ?? { hour: 0, minute: 0 };
    this._edit({ date: nextMonthlyDate(Number((event.target as HTMLSelectElement).value), time, this._wallNow(Date.now())) });
  };

  private _onYearDate = (part: "month" | "day") => (event: Event): void => {
    const time = parseTimeValue(this._form.time) ?? { hour: 0, minute: 0 };
    const current = parseIsoDate(this._form.date) ?? { year: 2001, month: 1, day: 1 };
    const value = Number((event.target as HTMLSelectElement).value);
    const month = part === "month" ? value : current.month;
    const day = part === "day" ? value : current.day;
    this._edit({ date: nextYearlyDate(month, day, time, this._wallNow(Date.now())) });
  };

  private _onRadioKey(event: KeyboardEvent, current: number, enabled: readonly boolean[], pick: (index: number) => void): void {
    const target = radioTargetIndex(event.key, current, enabled);
    if (target === null) return;
    event.preventDefault();
    if (target === current) return;
    pick(target);
    const group = event.currentTarget as HTMLElement;
    void this.updateComplete.then(() => group.querySelectorAll<HTMLElement>('[role="radio"]')[target]?.focus());
  }

  // ---- panes -----------------------------------------------------------------------------------------------

  private _openArt = (): void => {
    this._pane = "art";
    this._artPending = false;
    void this.updateComplete.then(() => requestAnimationFrame(() => this.renderRoot.querySelector<HTMLElement>('iledclock-alarm-art-picker')?.shadowRoot?.querySelector<HTMLElement>('.choice[tabindex="0"]')?.focus()));
  };

  private _closeArt = (): void => {
    this._pane = "form";
    this._artPending = false;
    void this.updateComplete.then(() => this._artRow.value?.focus());
  };

  /** Escape inside the art pane goes back to the form instead of closing the whole sheet. */
  private _onWindowKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this._pane !== "art") return;
    event.preventDefault();
    event.stopPropagation();
    this._closeArt();
  };

  private _onArtSelected = (event: CustomEvent<{ attachment: ReminderAttachment }>): void => {
    event.stopPropagation();
    this._edit({ attachment: event.detail.attachment }, "attachment");
  };

  /** The picker tells whether the preview of the chosen design is still being drawn. */
  private _onArtPreviewState = (event: CustomEvent<{ pending: boolean }>): void => {
    event.stopPropagation();
    this._artPending = event.detail.pending;
  };

  private _onClosed = (event: Event): void => {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true }));
  };

  // ---- save and delete ---------------------------------------------------------------------------------------

  private _focusFirstProblem(errors: FormErrors): void {
    const order: FormField[] = ["name", "time", "repeat", "days", "date", "duration", "attachment", "slots"];
    const field = order.find((name) => errors[name]);
    if (!field) return;
    void this.updateComplete.then(() => {
      const target = this.renderRoot.querySelector<HTMLElement>('[data-field="' + field + '"]');
      const control = target?.querySelector<HTMLElement>("input, select, button:not([disabled])");
      (control ?? target)?.focus();
      target?.scrollIntoView?.({ block: "center", behavior: "auto" });
    });
  }

  private _save = async (): Promise<void> => {
    if (this._busy || !this.entryId || !this.hass?.callWS) return;
    if (this._isClean) {
      this._requestClose();
      return;
    }
    if (!this.connected) return;
    this._submitted = true;
    const errors = this._errors(Date.now());
    if (Object.keys(errors).length > 0) {
      this._focusFirstProblem(errors);
      return;
    }
    this._busy = "save";
    this._error = null;
    this._savedItem = null;
    const entryId = this.entryId;
    const session = this._session;
    const knownKeys = new Set((this.list?.items ?? []).map((entry) => entry.key));
    const creating = !this._form.key;
    const updatedBefore = this._editing?.updated;
    try {
      const result = await this.hass.callWS<{ item?: ManagedReminder }>(reminderSetRequest(entryId, formToInput(this._form)));
      // The sheet may have closed, or opened another alarm or clock, while the clock was busy. This answer belongs
      // to a session that is gone: the list learns the result from the state push, and the form, the busy state
      // and the events of the current session stay untouched.
      if (!this._isCurrent(session, entryId)) return;
      const saved = result?.item ?? null;
      if (saved) {
        const form = formFromItem(saved);
        this._form = form;
        this._initial = form;
        this._savedItem = saved;
      } else {
        this._initial = this._form;
      }
      this._dateTouched = true;
      this._submitted = false;
      this.dispatchEvent(new CustomEvent("alarm-saved", { detail: { item: saved, created: creating }, bubbles: true, composed: true }));
    } catch (error) {
      if (!this._isCurrent(session, entryId)) return;
      const message = friendlyReminderError(error);
      const stored = await this._wasStored(knownKeys, updatedBefore, session, entryId);
      if (!this._isCurrent(session, entryId)) return;
      this._error = stored ? "Saved here, but not on the clock yet. " + message : message;
    } finally {
      if (this._isCurrent(session, entryId)) {
        this._busy = null;
        void this.updateComplete.then(() => requestAnimationFrame(() => this._refocusPrimary()));
      }
    }
  };

  /** After a failed save: did the server keep the definition anyway (it stores it before it writes the clock)?
   * A new item then shows up in the list under a key the form adopts, so the next Save edits it instead of
   * making a second copy; an existing one shows the failure in its `last_error` and a newer `updated` than it had
   * before this save (a refused edit leaves both as they were). Waits one turn so the state push that announces it
   * has reached `list`. */
  private async _wasStored(knownKeys: ReadonlySet<string>, updatedBefore: number | undefined, session: number, entryId: string | undefined): Promise<boolean> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await this.updateComplete;
    if (!this._isCurrent(session, entryId)) return false;
    const items = this.list?.items ?? [];
    const key = this._form.key;
    if (key) {
      const kept = items.find((entry) => entry.key === key);
      return Boolean(kept?.last_error) && kept?.updated !== updatedBefore;
    }
    const created = items.filter((entry) => !knownKeys.has(entry.key));
    if (created.length !== 1) return false;
    this._form = { ...this._form, key: created[0]!.key };
    this._initial = this._form;
    return true;
  }

  private _delete = async (): Promise<void> => {
    const key = this._form.key;
    if (!key || this._busy || !this.entryId || !this.hass?.callWS) return;
    this._busy = "delete";
    this._error = null;
    const entryId = this.entryId;
    const session = this._session;
    const name = this._form.name;
    try {
      await this.hass.callWS(reminderDeleteRequest(entryId, { key }));
      if (!this._isCurrent(session, entryId)) return;
      this.dispatchEvent(new CustomEvent("alarm-deleted", { detail: { key, name }, bubbles: true, composed: true }));
    } catch (error) {
      if (this._isCurrent(session, entryId)) this._error = friendlyReminderError(error);
    } finally {
      if (this._isCurrent(session, entryId)) {
        this._busy = null;
        void this.updateComplete.then(() => requestAnimationFrame(() => this._refocusPrimary()));
      }
    }
  };

  /** The Save button is disabled while it sends, which drops keyboard focus to the page; hand it back when the send ends. */
  private _refocusPrimary(): void {
    if (!this.open || this._pane !== "form") return;
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active && active !== document.body) return;
    this.renderRoot.querySelector("lu-pill-button[variant='primary']")?.shadowRoot?.querySelector("button")?.focus();
  }

  private _requestClose(): void {
    this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true }));
  }

  // ---- rendering -------------------------------------------------------------------------------------------

  private _title(): string {
    if (this._pane === "art") return "Choose art";
    const noun = this._form.kind === "reminder" ? "reminder" : "alarm";
    return this.item || this._form.key ? "Edit " + noun : "New " + noun;
  }

  private _footerStatus(): { tone: StatusTone; text: string; alert: boolean } {
    if (this._busy === "save") {
      const percent = uploadPercent(this.upload);
      return { tone: "info", text: "Sending to the clock…" + (percent !== null ? " " + percent + "%" : ""), alert: false };
    }
    if (this._busy === "delete") return { tone: "info", text: "Deleting…", alert: false };
    if (this._error) return { tone: "error", text: this._error, alert: true };
    if (this._savedItem && !this._dirty) return { ...savedStatusText(this._savedItem), alert: this._savedItem.status === "error" };
    const editing = this._editing;
    if (!this._dirty && editing && editing.status !== "disabled") {
      if (editing.status === "synced") return { tone: "ok", text: "On the clock · works without Home Assistant", alert: false };
      return { ...savedStatusText(editing), alert: false };
    }
    if (!this.connected) return { tone: "warn", text: "The clock is out of range. Move it closer, then save.", alert: false };
    return this._form.enabled
      ? { tone: "muted", text: "Saved on the clock, so it still rings without Home Assistant.", alert: false }
      : { tone: "muted", text: "Switched off: kept here, not on the clock.", alert: false };
  }

  /** A wrapping row of pills that behaves as one radio group (arrow keys, one tab stop). */
  private _renderChoice(labelId: string, options: ReadonlyArray<{ value: string; label: string }>, value: string, pick: (value: string) => void): TemplateResult {
    const current = options.findIndex((option) => option.value === value);
    return html`<div class="pills" role="radiogroup" aria-labelledby=${labelId} @keydown=${(event: KeyboardEvent) => this._onRadioKey(event, Math.max(current, 0), options.map(() => true), (next) => pick(options[next]!.value))}>
      ${options.map((option, index) => html`<button type="button" role="radio" class="pill" aria-checked=${index === current ? "true" : "false"} tabindex=${index === current || (current < 0 && index === 0) ? "0" : "-1"} @click=${() => pick(option.value)}>${option.label}</button>`)}
    </div>`;
  }

  private _renderDays(errors: FormErrors): TemplateResult | typeof nothing {
    const repeat = this._form.repeat;
    if (repeat !== "custom" && repeat !== "weekly") return nothing;
    const single = repeat === "weekly";
    const days = normalizeDays(this._form.days);
    const first = single ? Math.max(0, days[0] ?? 0) : -1;
    return html`<div class="days-block" data-field="days">
      <span class="label" id="days-label">${single ? "Repeats on" : "Days"}</span>
      <div class="days" role=${single ? "radiogroup" : "group"} aria-labelledby="days-label" @keydown=${single ? (event: KeyboardEvent) => this._onRadioKey(event, first, DAY_LABELS.map(() => true), (next) => this._toggleDay(next)) : nothing}>
        ${DAY_LABELS.map((label, day) => {
          const on = days.includes(day);
          return single
            ? html`<button type="button" role="radio" class="day" aria-checked=${on ? "true" : "false"} aria-label=${DAY_FULL_NAMES[day]} tabindex=${day === first ? "0" : "-1"} @click=${() => this._toggleDay(day)}><span>${label}</span></button>`
            : html`<button type="button" class="day" aria-pressed=${on ? "true" : "false"} aria-label=${DAY_FULL_NAMES[day]} @click=${() => this._toggleDay(day)}><span>${label}</span></button>`;
        })}
      </div>
      ${errors.days ? html`<p class="error" role="alert">${errors.days}</p>` : nothing}
    </div>`;
  }

  private _renderDate(errors: FormErrors): TemplateResult | typeof nothing {
    const repeat = this._form.repeat;
    if (!repeatUsesDate(repeat)) return nothing;
    const tl = timeLocaleFromHass(this.hass);
    const iso = parseIsoDate(this._form.date);
    const error = errors.date ? html`<p class="error" id="date-error" role="alert">${errors.date}</p>` : nothing;
    if (repeat === "once") {
      return html`<div class="field" data-field="date">
        <label for="date">Date</label>
        <input id="date" type="date" .value=${this._form.date} min=${isoDateOf(this._wallNow())} aria-invalid=${errors.date ? "true" : "false"} aria-describedby=${errors.date ? "date-error" : nothing} @input=${this._onDate}>
        ${error}
      </div>`;
    }
    if (repeat === "monthly") {
      const day = iso?.day ?? 1;
      return html`<div class="field" data-field="date">
        <label for="month-day">Day of the month</label>
        <select id="month-day" .value=${String(day)} @change=${this._onMonthDay}>${Array.from({ length: 28 }, (_, index) => index + 1).map((value) => html`<option value=${value} ?selected=${value === day}>${ordinal(value)}</option>`)}</select>
        <p class="hint">Days 29 to 31 aren't offered: not every month has them.</p>
        ${error}
      </div>`;
    }
    const month = iso?.month ?? 1;
    const day = iso?.day ?? 1;
    const dayCount = month === 2 ? 28 : daysInMonth(2001, month);
    return html`<div class="field" data-field="date">
      <span class="label" id="year-date-label">Day of the year</span>
      <div class="two-up" role="group" aria-labelledby="year-date-label">
        <select aria-label="Month" .value=${String(month)} @change=${this._onYearDate("month")}>${Array.from({ length: 12 }, (_, index) => index + 1).map((value) => html`<option value=${value} ?selected=${value === month}>${monthName(value, tl)}</option>`)}</select>
        <select aria-label="Day" .value=${String(Math.min(day, dayCount))} @change=${this._onYearDate("day")}>${Array.from({ length: dayCount }, (_, index) => index + 1).map((value) => html`<option value=${value} ?selected=${value === Math.min(day, dayCount)}>${value}</option>`)}</select>
      </div>
      ${error}
    </div>`;
  }

  private _artSummary(): { title: string; subtitle: string; frames: PixelFrame[]; problem: boolean } {
    const attachment = this._form.attachment;
    if (attachment.kind === "design") {
      const design = this.designs?.find((candidate) => candidate.id === attachment.design_id);
      if (!design) return { title: this.designs ? "Design not found" : "Design", subtitle: this.designs ? "It isn't in your Library any more" : "Loading your Library…", frames: [], problem: Boolean(this.designs) };
      const verdict = designEligibility(design, this._caps().max_frames);
      return { title: design.name, subtitle: verdict.ok ? designMeta(design) : (verdict.reason ?? designMeta(design)), frames: this._designFramesFor(design), problem: !verdict.ok };
    }
    const color = textColorOf(attachment);
    const colorName = REMINDER_TEXT_COLORS.find((entry) => sameColor(entry.rgb, color))?.label.toLowerCase() ?? "your colour";
    return { title: "Name as text", subtitle: "Draws the name in " + colorName, frames: this.textArt?.peek(this._artName, color) ?? [], problem: false };
  }

  private _renderForm(errors: FormErrors): TemplateResult {
    const caps = this._caps();
    const form = this._form;
    const busy = this._busy !== null;
    const tl = timeLocaleFromHass(this.hass);
    const now = this._wallNow();
    const schedule = formSchedule(form);
    const next = schedule ? nextRing(schedule, now) : null;
    const needed = slotsNeeded(form.repeat, form.days, caps.week_mask);
    const art = this._artSummary();
    const nameLength = form.name.length;
    const costNote = needed > 1
      ? slotsNoteText(needed) + (form.repeat === "weekdays" || form.repeat === "weekends" || form.repeat === "custom" ? ": the clock needs one slot for each day." : ".")
      : slotsNoteText(needed) + ".";
    return html`<fieldset class="form ${this.hass?.themes?.darkMode === true ? "scheme-dark" : "scheme-light"}" ?disabled=${busy}>
      <legend class="sr-only">${this._title()}</legend>

      <div class="field" data-field="name">
        <label for="name"><span>Name</span><span class="counter ${nameLength >= caps.name_max ? "full" : ""}" id="name-count">${nameLength}/${caps.name_max}</span></label>
        <input id="name" type="text" .value=${form.name} maxlength=${caps.name_max} autocomplete="off" enterkeyhint="done" placeholder=${form.kind === "reminder" ? "Take medicine" : SAMPLE_NAME} aria-invalid=${errors.name ? "true" : "false"} aria-describedby=${errors.name ? "name-error name-count" : "name-count"} @input=${this._onName} @blur=${() => { this._touched = { ...this._touched, name: true }; }} @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); void this._save(); } }}>
        ${errors.name ? html`<p class="error" id="name-error" role="alert">${errors.name}</p>` : nothing}
      </div>

      <div class="field">
        <span class="label" id="kind-label">Type</span>
        ${this._renderChoice("kind-label", [{ value: "alarm", label: "Alarm" }, { value: "reminder", label: "Reminder" }], form.kind, (value) => this._edit({ kind: value === "reminder" ? "reminder" : "alarm" }))}
        <p class="hint">Just a label for you. Both ring the same way on the clock.</p>
      </div>

      <div class="field" data-field="time">
        <label for="time">Time</label>
        <input id="time" class="time" type="time" step="60" .value=${form.time} aria-invalid=${errors.time ? "true" : "false"} aria-describedby=${errors.time ? "time-error" : nothing} @input=${this._onTime} @blur=${() => { this._touched = { ...this._touched, time: true }; }}>
        ${errors.time ? html`<p class="error" id="time-error" role="alert">${errors.time}</p>` : nothing}
      </div>

      <div class="field" data-field="repeat">
        <span class="label" id="repeat-label">Repeat</span>
        ${this._renderChoice("repeat-label", caps.repeats.map((repeat) => ({ value: repeat, label: repeatLabel(repeat) })), form.repeat, (value) => this._setRepeat(value as ReminderRepeat))}
        ${errors.repeat ? html`<p class="error" role="alert">${errors.repeat}</p>` : nothing}
        ${this._renderDays(errors)}
        ${this._renderDate(errors)}
        ${next ? html`<p class="next" role="status">${mdiIcon("alarm")}<span>${describeNextRing(next, now, tl)}</span></p>` : nothing}
        <p class="note ${errors.slots ? "blocked" : ""}" data-field="slots" role="status" aria-live="polite"><span class="note-icon" aria-hidden="true">${errors.slots ? mdiIcon("close") : mdiIcon("clock")}</span><span>${errors.slots ?? costNote}</span></p>
      </div>

      <div class="field" data-field="duration">
        <span class="label" id="duration-label">Rings for</span>
        ${this._renderChoice("duration-label", caps.durations.map((seconds) => ({ value: String(seconds), label: durationLabel(seconds) })), String(form.durationS), (value) => this._edit({ durationS: Number(value) }))}
        ${errors.duration ? html`<p class="error" role="alert">${errors.duration}</p>` : nothing}
      </div>

      <div class="field" data-field="attachment">
        <span class="label" id="art-label">Art</span>
        <button type="button" class="art-row ${art.problem ? "problem" : ""}" ${ref(this._artRow)} aria-labelledby="art-label art-title" aria-describedby="art-subtitle" @click=${this._openArt}>
          <span class="art-thumb" aria-hidden="true">${art.frames.length ? html`<iledclock-led-preview context="thumb" max-pitch="2" .frames=${posterFrames(art.frames)} .delays=${[art.frames[0]!.durationMs]} ?playing=${false}></iledclock-led-preview>` : html`<span class="art-blank">${mdiIcon("image")}</span>`}</span>
          <span class="art-text"><strong id="art-title">${art.title}</strong><small id="art-subtitle">${art.subtitle}</small></span>
          <span class="art-chevron" aria-hidden="true">${mdiIcon("chevronRight")}</span>
        </button>
        ${errors.attachment ? html`<p class="error" role="alert">${errors.attachment}</p>` : nothing}
      </div>

      <div class="field">
        <button type="button" class="toggle-row" role="switch" aria-checked=${form.enabled ? "true" : "false"} aria-labelledby="enabled-label" aria-describedby="enabled-hint" @click=${() => this._edit({ enabled: !form.enabled })}>
          <span class="toggle-text"><strong id="enabled-label">On</strong><small id="enabled-hint">${form.enabled ? "Stored on the clock and ringing." : "Kept here, but removed from the clock."}</small></span>
          <span class="switch ${form.enabled ? "on" : ""}" aria-hidden="true"></span>
        </button>
      </div>

      ${form.key ? html`<div class="field danger">
        <iledclock-hold-button label="Hold to delete" complete-label="Deleting…" danger ?disabled=${busy || !this.connected} @confirmed=${this._delete}></iledclock-hold-button>
        <p class="hint">Removes it from the clock and from Home Assistant.</p>
      </div>` : nothing}
    </fieldset>`;
  }

  private _renderFooter(errors: FormErrors): TemplateResult {
    const status = this._footerStatus();
    const percent = this._busy === "save" ? uploadPercent(this.upload) : null;
    if (this._pane === "art") {
      // "Use this art" waits for the preview of the CHOSEN design and stays off while that choice can't be used.
      const reason = errors.attachment ?? (this._artPending ? "Drawing the preview…" : null);
      return html`<div slot="footer" class="footer">
        ${reason ? html`<p class="status ${errors.attachment ? "error" : ""}" role="status">${reason}</p>` : html`<span class="spacer"></span>`}
        <lu-pill-button variant="primary" label="Use this art" ?disabled=${reason !== null} @lu-press=${this._closeArt}></lu-pill-button>
      </div>`;
    }
    const done = this._isClean;
    const label = done ? "Done" : this._form.enabled ? "Save to clock" : "Save";
    return html`<div slot="footer" class="footer">
      ${percent !== null ? html`<div class="progress" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${percent}><span style=${"width:" + percent + "%"}></span></div>` : nothing}
      <p class="status ${status.tone}" role=${status.alert ? "alert" : "status"}>${this._statusIcon(status.tone)}<span>${status.text}</span></p>
      <lu-pill-button variant="primary" .label=${this._busy === "save" ? "Sending…" : label} ?loading=${this._busy === "save"} ?disabled=${this._busy === "delete" || (Boolean(errors.slots) && !done) || (!this.connected && !done)} @lu-press=${this._save}></lu-pill-button>
    </div>`;
  }

  private _statusIcon(tone: StatusTone) {
    if (tone === "ok") return html`<span class="status-icon ok">${mdiIcon("check")}</span>`;
    if (tone === "error") return html`<span class="status-icon error">${mdiIcon("close")}</span>`;
    return nothing;
  }

  render() {
    const errors = this._visible(this._errors());
    const art = this._pane === "art";
    return html`<lu-sheet .open=${this.open} .label=${this._title()} .closeOnScrim=${!this._dirty && this._busy === null} @closed=${this._onClosed}>
      ${this.open ? html`
        <div slot="header" class="sheet-heading">
          ${art ? html`<lu-icon-button tooltip="Back to the alarm" aria-label="Back to the alarm" @lu-press=${this._closeArt}>${mdiIcon("chevronLeft")}</lu-icon-button>` : nothing}
          <div class="heading-text"><h2>${this._title()}</h2><p>${art ? "Shown on the clock when it rings." : "Stored on the clock, so it rings without Home Assistant."}</p></div>
        </div>
        <div class="body" ${ref(this._body)}>
          ${art
            ? html`<iledclock-alarm-art-picker .hass=${this.hass} .entryId=${this.entryId} .designs=${this.designs ?? []} .value=${this._form.attachment} .name=${this._form.name} .maxFrames=${this._caps().max_frames} .textArt=${this.textArt} ?disabled=${this._busy !== null} @art-selected=${this._onArtSelected} @art-preview-state=${this._onArtPreviewState}></iledclock-alarm-art-picker>`
            : this._renderForm(errors)}
        </div>
        ${this._renderFooter(errors)}` : nothing}
    </lu-sheet>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; }
    .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .sheet-heading { display: flex; align-items: center; gap: var(--lu-space-1); min-width: 0; }
    .heading-text { display: grid; min-width: 0; gap: var(--lu-space-1); }
    h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); }
    .heading-text p { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .sheet-heading lu-icon-button svg { width: var(--lu-space-6); height: var(--lu-space-6); }
    .body { display: contents; }
    .form { display: grid; gap: var(--lu-space-5); min-width: 0; margin: 0; padding: 0; border: 0; }
    .form.scheme-dark { color-scheme: dark; }
    .form.scheme-light { color-scheme: light; }
    .field { display: grid; gap: var(--lu-space-2); min-width: 0; }
    .label, label { display: flex; align-items: baseline; justify-content: space-between; gap: var(--lu-space-2); color: var(--lu-ink); font: 600 var(--lu-type-label)/1.3 var(--lu-font); }
    .counter { color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); font-variant-numeric: tabular-nums; }
    .counter.full { color: var(--lu-warning); }
    .hint { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); }
    .error { margin: 0; color: var(--lu-danger); font: 500 var(--lu-type-caption)/1.45 var(--lu-font); }
    input[type="text"], input[type="time"], input[type="date"], select { box-sizing: border-box; width: 100%; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge-raised); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-card); font: 400 var(--lu-type-body)/1.3 var(--lu-font); }
    input[aria-invalid="true"] { border-color: var(--lu-danger); }
    input.time { min-height: calc(var(--lu-target) + var(--lu-space-4)); font: 500 var(--lu-type-display)/1 var(--lu-font); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; text-align: center; }
    input:focus-visible, select:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    ::placeholder { color: var(--lu-ink-3); opacity: 1; }
    .two-up { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--lu-space-3); }
    .pills { display: flex; flex-wrap: wrap; gap: var(--lu-space-2); }
    .pill { min-width: var(--lu-target); min-height: var(--lu-target); padding: 0 var(--lu-space-4); border: 1px solid var(--lu-edge-raised); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: var(--lu-glass-raised); font: 500 var(--lu-type-label)/1 var(--lu-font); cursor: pointer; }
    .pill:active { transition: none; filter: none; background: var(--lu-tile); }
    .pill[aria-checked="true"] { border-color: transparent; color: var(--lu-accent-ink); background: var(--lu-accent); }
    .pill:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .days-block { display: grid; gap: var(--lu-space-1); }
    .days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .day { display: grid; place-items: center; min-height: var(--lu-target); padding: 0; border: 0; background: transparent; color: var(--lu-ink); cursor: pointer; }
    .day span { display: grid; place-items: center; width: var(--lu-space-8); height: var(--lu-space-8); border: 1px solid var(--lu-edge-raised); border-radius: var(--lu-radius-pill); background: var(--lu-glass-raised); font: 600 var(--lu-type-label)/1 var(--lu-font); }
    .day[aria-pressed="true"] span, .day[aria-checked="true"] span { border-color: transparent; color: var(--lu-accent-ink); background: var(--lu-accent); }
    .day:focus-visible { outline: none; }
    .day:focus-visible span { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .next { display: flex; align-items: center; gap: var(--lu-space-2); margin: 0; color: var(--lu-ink); font: 500 var(--lu-type-label)/1.4 var(--lu-font); }
    .next svg { flex: none; width: var(--lu-space-5); height: var(--lu-space-5); color: var(--lu-ink-2); }
    .note { display: flex; align-items: flex-start; gap: var(--lu-space-2); margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); }
    .note-icon { display: inline-flex; flex: none; }
    .note svg { width: var(--lu-space-4); height: var(--lu-space-4); margin-top: 1px; }
    .note.blocked { padding: var(--lu-space-3); border: 1px solid color-mix(in srgb, var(--lu-danger) 36%, var(--lu-edge)); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-tile); font-weight: 500; }
    .note.blocked svg { color: var(--lu-danger); }
    .art-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--lu-space-3); width: 100%; min-height: calc(var(--lu-target) + var(--lu-space-4)); padding: var(--lu-space-2) var(--lu-space-3); border: 1px solid var(--lu-edge-raised); border-radius: var(--lu-radius-row); color: var(--lu-ink); background: var(--lu-tile); text-align: left; cursor: pointer; }
    .art-row:hover { background: var(--lu-glass-raised); }
    .art-row:active { transition: none; background: var(--lu-glass-raised); }
    .art-row:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .art-row.problem { border-color: var(--lu-danger); }
    .art-thumb { display: grid; place-items: center; width: calc(var(--lu-space-8) * 2 - var(--lu-space-2)); aspect-ratio: 2 / 1; overflow: hidden; border-radius: var(--lu-radius-control); background: #050607; color: var(--lu-ink-3); }
    .art-thumb iledclock-led-preview { border-radius: var(--lu-radius-control); }
    .art-blank svg { width: var(--lu-space-5); height: var(--lu-space-5); }
    .art-text { display: grid; min-width: 0; gap: var(--lu-space-1); }
    .art-text strong { overflow: hidden; font: 600 var(--lu-type-label)/1.3 var(--lu-font); text-overflow: ellipsis; white-space: nowrap; }
    .art-text small { color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .art-chevron { display: inline-flex; color: var(--lu-ink-3); }
    .art-chevron svg { width: var(--lu-space-5); height: var(--lu-space-5); }
    .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-3); width: 100%; min-height: var(--lu-target); padding: var(--lu-space-2) 0; border: 0; color: var(--lu-ink); background: transparent; text-align: left; cursor: pointer; }
    .toggle-row:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; border-radius: var(--lu-radius-control); }
    .toggle-row:disabled { opacity: .55; cursor: default; }
    .toggle-text { display: grid; gap: var(--lu-space-1); }
    .toggle-text strong { font: 600 var(--lu-type-label)/1.3 var(--lu-font); }
    .toggle-text small { color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .switch { position: relative; flex: none; width: 48px; height: 28px; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); transition: background-color var(--lu-motion-label) var(--lu-ease); }
    .switch::after { position: absolute; top: 4px; left: 4px; width: 20px; height: 20px; border-radius: var(--lu-radius-pill); background: var(--lu-card); content: ""; transition: transform var(--lu-motion-label) var(--lu-ease); }
    .switch.on { background: var(--lu-accent); }
    .switch.on::after { transform: translateX(20px); }
    .danger { padding-top: var(--lu-space-2); border-top: 1px solid var(--lu-edge); }
    .footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--lu-space-3); min-width: 0; }
    .footer .spacer { flex: 1 1 auto; }
    .status { display: flex; flex: 1 1 12rem; align-items: flex-start; gap: var(--lu-space-2); min-width: 0; margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); overflow-wrap: anywhere; }
    .status.ok, .status.error, .status.warn { color: var(--lu-ink); font-weight: 500; }
    .status-icon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--lu-space-4); height: var(--lu-space-4); margin-top: 1px; border-radius: var(--lu-radius-pill); }
    .status-icon svg { width: var(--lu-space-3); height: var(--lu-space-3); }
    .status-icon.ok { color: var(--lu-accent-ink); background: var(--lu-positive); }
    .status-icon.error { color: var(--lu-accent-ink); background: var(--lu-danger); }
    .progress { flex: 0 0 100%; height: var(--lu-space-1); overflow: hidden; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); }
    .progress span { display: block; height: 100%; border-radius: inherit; background: var(--lu-accent); transition: width var(--lu-motion-label) var(--lu-ease); }
    @media (prefers-reduced-motion: reduce) { .switch, .switch::after, .progress span { transition: none; } }
  `];
}

customElements.define("iledclock-alarm-sheet", IledclockAlarmSheet);

declare global { interface HTMLElementTagNameMap { "iledclock-alarm-sheet": IledclockAlarmSheet; } }
