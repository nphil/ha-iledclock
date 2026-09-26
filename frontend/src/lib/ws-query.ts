/** A minimal reactive WS query: one `hass.callWS` call with loading/data/error state, a manual
 * `refresh()`, and `sync()` to call from a component's `willUpdate` -- refetches when a caller-
 * built watch key changes (including the very first call). Each component owns one instance per
 * query as a private field; this is not a cross-component cache.
 */

export interface WsQueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

const INITIAL_STATE: WsQueryState<never> = { data: null, error: null, loading: false };

export class WsQuery<T> {
  private _lastWatched: string | null = null;
  private _requestId = 0;
  private _state: WsQueryState<T> = INITIAL_STATE;
  private readonly _onChange: () => void;

  constructor(onChange: () => void) {
    this._onChange = onChange;
  }

  get state(): WsQueryState<T> {
    return this._state;
  }

  /** Call every `willUpdate`. `watchKey` encodes every entity this query cares about; a change
   * refetches, an unchanged key is a no-op so a query never re-runs on every unrelated render. */
  sync(watchKey: string, run: () => Promise<T>): void {
    if (watchKey === this._lastWatched) return;
    this._lastWatched = watchKey;
    this.refresh(run);
  }

  /** Force a refetch regardless of the watch key -- a manual retry/refresh action. */
  refresh(run: () => Promise<T>): void {
    const requestId = ++this._requestId;
    this._state = { ...this._state, loading: true, error: null };
    this._onChange();
    run().then(
      (data) => {
        if (requestId !== this._requestId) return; // superseded by a newer request
        this._state = { data, error: null, loading: false };
        this._onChange();
      },
      (err: unknown) => {
        if (requestId !== this._requestId) return;
        this._state = { ...this._state, error: describeWsError(err), loading: false };
        this._onChange();
      },
    );
  }

  /** Optimistically rewrites cached `data` in place, without touching `loading`/`error` or
   * starting a new request -- for a mutation whose own response already tells the caller the new
   * truth, so the UI reflects it before the next push/refetch lands. A no-op while there is no
   * data yet to patch. */
  patch(updater: (data: T) => T): void {
    if (this._state.data === null) return;
    this._state = { ...this._state, data: updater(this._state.data) };
    this._onChange();
  }

  /** Directly install a value as the query's data -- for a push subscription
   * (`iledclock/subscribe`) feeding this query instead of a request/response round-trip. */
  set(data: T): void {
    this._state = { data, error: null, loading: false };
    this._onChange();
  }
}

export function watchKey(states: Record<string, { state: string }>, entityIds: Array<string | undefined>): string {
  return entityIds
    .filter((id): id is string => Boolean(id))
    .map((id) => `${id}=${states[id]?.state ?? ""}`)
    .join("|");
}

export function describeWsError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = err.message;
    if (typeof message === "string" && message) return message;
  }
  return "Something went wrong.";
}
