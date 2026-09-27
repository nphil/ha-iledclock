/** Pure tile retry and animation-budget policy shared by Explore and Library tiles. */
export const TILE_AUTO_RETRY_DELAY_MS = 2000;
export const TILE_ANIMATION_LIMIT = 12;

/** Only the first failed request receives an automatic retry. Further attempts are explicit. */
export function tileAutoRetryDelay(failedAttempts: number): number | null {
  return failedAttempts < 1 ? TILE_AUTO_RETRY_DELAY_MS : null;
}

/** Add a deterministic cache-buster. nonce is injectable so retry behavior stays testable. */
export function tileRetryUrl(url: string, attempt: number, nonce: string | number): string {
  const hashAt = url.indexOf("#");
  const fragment = hashAt < 0 ? "" : url.slice(hashAt);
  const pathAndQuery = hashAt < 0 ? url : url.slice(0, hashAt);
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  return pathAndQuery + separator + "iledclock_retry=" + encodeURIComponent(String(attempt) + "-" + String(nonce)) + fragment;
}

/** Preserve registration order while admitting no more than limit simultaneously animated
 * candidates. Duplicate ids count only once. */
export function capAnimatingTiles(candidateIds: readonly string[], limit = TILE_ANIMATION_LIMIT): string[] {
  const max = Math.max(0, Math.floor(limit));
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const id of candidateIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (selected.length === max) break;
    selected.push(id);
  }
  return selected;
}

/** Observable, bounded global animation allocation used by art tiles. */
export class TileAnimationBudget {
  private readonly _visible = new Set<string>();
  private readonly _granted = new Set<string>();
  private readonly _listeners = new Map<string, (granted: boolean) => void>();

  register(id: string, listener: (granted: boolean) => void): void {
    this._listeners.set(id, listener);
    listener(this._granted.has(id));
  }

  unregister(id: string): void {
    this._visible.delete(id);
    this._listeners.delete(id);
    this._recalculate();
  }

  setVisible(id: string, visible: boolean): void {
    if (visible) this._visible.add(id);
    else this._visible.delete(id);
    this._recalculate();
  }

  private _recalculate(): void {
    const next = new Set(capAnimatingTiles([...this._visible]));
    for (const id of this._granted) {
      if (!next.has(id)) this._listeners.get(id)?.(false);
    }
    for (const id of next) {
      if (!this._granted.has(id)) this._listeners.get(id)?.(true);
    }
    this._granted.clear();
    for (const id of next) this._granted.add(id);
  }
}

export const tileAnimationBudget = new TileAnimationBudget();
