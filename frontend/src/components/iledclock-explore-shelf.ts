import { LitElement, css, html, nothing } from "lit";
import { exploreTileAspect, fitsClockExactly, type ExploreGalleryItem, type ExploreSource } from "../lib/gallery-explore-api.ts";
import type { GalleryShelfDescriptor, ShelfStatus } from "../lib/gallery-shelf-state.ts";
import { itemKey, tileMetaLine } from "../lib/gallery-browse-state.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-art-tile.ts";
import "./lu-error.ts";
import "./lu-icon-button.ts";
import "./lu-skeleton.ts";

export class IledclockExploreShelf extends LitElement {
  static properties = {
    shelf: { attribute: false },
    source: { attribute: false },
    sourceName: { type: String, attribute: "source-name" },
    items: { attribute: false },
    signedPaths: { attribute: false },
    status: { type: String },
    error: { type: String },
  };

  declare shelf: GalleryShelfDescriptor;
  declare source: ExploreSource | undefined;
  declare sourceName: string;
  declare items: readonly ExploreGalleryItem[];
  declare signedPaths: Readonly<Record<string, string>>;
  declare status: ShelfStatus;
  declare error: string | undefined;

  private _row: HTMLDivElement | null = null;

  constructor() {
    super();
    this.shelf = { id: "", title: "", source: "" };
    this.sourceName = "";
    this.items = [];
    this.signedPaths = {};
    this.status = "idle";
  }

  private _scroll(direction: -1 | 1): void {
    this._row?.scrollBy({ left: direction * Math.max(240, this._row.clientWidth * 0.72), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  private _open(item: ExploreGalleryItem): void {
    this.dispatchEvent(new CustomEvent("explore-item-open", { detail: { item, items: this.items }, bubbles: true, composed: true }));
  }

  private _seeAll(): void {
    this.dispatchEvent(new CustomEvent("explore-shelf-open", { detail: { shelf: this.shelf }, bubbles: true, composed: true }));
  }

  private _retry(): void {
    this.dispatchEvent(new CustomEvent("shelf-retry", { detail: { shelfId: this.shelf.id }, bubbles: true, composed: true }));
  }

  render() {
    const meta = (item: ExploreGalleryItem) => tileMetaLine(item);
    return html`<section class="shelf" aria-labelledby="shelf-title">
      <header class="heading">
        <div class="heading-copy">
          <h2 id="shelf-title">${this.shelf.title}</h2>
          <p>${this.sourceName}</p>
        </div>
        <button class="see-all" type="button" @click=${this._seeAll} aria-label=${`See all ${this.shelf.title}`}>
          See all <span aria-hidden="true">›</span>
        </button>
        <div class="arrows" aria-label=${`${this.shelf.title} scroll controls`}>
          <lu-icon-button icon="mdi:chevron-left" tooltip="Scroll left" aria-label=${`Scroll ${this.shelf.title} left`} @lu-press=${() => this._scroll(-1)}></lu-icon-button>
          <lu-icon-button icon="mdi:chevron-right" tooltip="Scroll right" aria-label=${`Scroll ${this.shelf.title} right`} @lu-press=${() => this._scroll(1)}></lu-icon-button>
        </div>
      </header>
      ${this.status === "loading" && this.items.length === 0
        ? html`<div class="rail skeleton-rail" aria-label=${`Loading ${this.shelf.title}`} aria-busy="true">
            ${Array.from({ length: 4 }, () => html`<div class="skeleton-card"><lu-skeleton variant="card" label="Loading artwork"></lu-skeleton></div>`)}
          </div>`
        : this.status === "error"
          ? html`<lu-error title="This shelf couldn’t load" .message=${this.error ?? "Try again in a moment."} retry-label="Retry shelf" @retry=${this._retry}></lu-error>`
          : this.items.length === 0
            ? html`<p class="empty">${this.status === "loading" ? "Looking for designs…" : "No designs here yet."}</p>`
            : html`<div class="rail" role="list" aria-label=${this.shelf.title}>
                ${this.items.map((item) => {
                  const size = `${item.width}×${item.height}`;
                  const exact = fitsClockExactly(item);
                  const noTitle = !item.title || /^Trending\s+\d+$/i.test(item.title);
                  const category = this.source?.categories?.find((entry) => entry.id === item.category)?.label;
                  return html`<div class="tile-wrap" role="listitem">
                    <iledclock-art-tile
                      .itemId=${itemKey(item)}
                      .imageUrl=${this.signedPaths[itemKey(item)] ?? ""}
                      .mediaPath=${item.media_path}
                      .pixelWidth=${item.width}
                      .pixelHeight=${item.height}
                      .aspect=${exploreTileAspect(item)}
                      .animated=${item.animated}
                      .title=${noTitle ? "" : item.title}
                      .subtitle=${noTitle ? "" : meta(item) ?? ""}
                      @tile-selected=${() => this._open(item)}
                    >
                      ${noTitle
                        ? category ? html`<span slot="badges" class="tile-badge">${category}</span>` : nothing
                        : html`${exact ? html`<span slot="badges" class="tile-badge exact">Fits exactly</span>` : nothing}
                            ${item.animated ? html`<span slot="badges" class="tile-badge">${item.frames && item.frames > 1 ? `${item.frames} frames` : "Animated"}</span>` : nothing}
                            <span slot="badges" class="tile-badge size">${size}</span>`}
                    </iledclock-art-tile>
                  </div>`;
                })}
              </div>`}
    </section>`;
  }

  protected updated(): void {
    this._row = this.renderRoot.querySelector<HTMLDivElement>(".rail:not(.skeleton-rail)");
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; color: var(--lu-ink); }
    .shelf { min-width: 0; }
    .heading { display: flex; align-items: center; gap: var(--lu-space-2); margin-bottom: var(--lu-space-3); }
    .heading-copy { min-width: 0; flex: 1; }
    h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); letter-spacing: -.01em; }
    .heading p { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .see-all { min-height: var(--lu-target, 48px); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-tile); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1 var(--lu-font); cursor: pointer; white-space: nowrap; }
    .see-all span { padding-left: var(--lu-space-1); color: var(--lu-accent); font-size: 20px; }
    .arrows { display: none; }
    .rail { display: flex; gap: var(--lu-space-3); min-width: 0; overflow-x: auto; padding: 2px 2px var(--lu-space-2); scroll-snap-type: x mandatory; overscroll-behavior-x: contain; scrollbar-width: thin; }
    .tile-wrap { flex: 0 0 clamp(148px, 18cqi, 224px); scroll-snap-align: start; }
    .empty { margin: 0; padding: var(--lu-space-3) 0; color: var(--lu-ink-3); font: 400 var(--lu-type-body)/1.4 var(--lu-font); }
    .skeleton-card { flex: 0 0 clamp(148px, 18cqi, 224px); aspect-ratio: 1.7; }
    .skeleton-card lu-skeleton { display: block; height: 100%; }
    @container (min-width: 720px) {
      .arrows { display: flex; gap: var(--lu-space-1); }
      .see-all { margin-left: auto; }
    }
    @media (prefers-reduced-motion: reduce) { .rail { scroll-behavior: auto; } }
  `];
}

customElements.define("iledclock-explore-shelf", IledclockExploreShelf);

declare global { interface HTMLElementTagNameMap { "iledclock-explore-shelf": IledclockExploreShelf; } }
