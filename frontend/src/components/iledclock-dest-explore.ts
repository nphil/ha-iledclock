import { LitElement, css, html } from "lit";
import type { HomeAssistant } from "../types.ts";
import type { StudioRoute } from "../lib/route.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-explore-browser.ts";
import "./lu-empty.ts";

export class IledclockDestExplore extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    route: { attribute: false },
    narrow: { type: Boolean },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare route: StudioRoute;
  declare narrow: boolean;

  constructor() {
    super();
    this.narrow = false;
  }

  render() {
    return html`<main class="destination" aria-label="Explore pixel art">
      ${this.entryId
        ? html`<iledclock-explore-browser .hass=${this.hass} .entryId=${this.entryId} .route=${this.route}></iledclock-explore-browser>`
        : html`<lu-empty title="Connect a clock to browse" message="The gallery needs an iLedClock integration entry before it can load sources."></lu-empty>`}
    </main>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; height: 100%; container-type: inline-size; }
    .destination { display: block; height: 100%; min-width: 0; }
  `];
}

customElements.define("iledclock-dest-explore", IledclockDestExplore);

declare global { interface HTMLElementTagNameMap { "iledclock-dest-explore": IledclockDestExplore; } }
