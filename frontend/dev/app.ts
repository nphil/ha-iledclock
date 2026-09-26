/** Dev harness bootstrap. Mounts one real `iledclock-card` and one real `iledclock-studio-panel`
 * element, side by side, against a single mocked `hass` -- so a manual click-through in a real
 * browser exercises the full Contract D flow (every `iledclock/*` WS command, every native HA
 * entity service call) end to end, not a one-shot static render. `onChange` re-assigns a *new*
 * top-level `hass` reference to both elements after every mutation (real Home Assistant always
 * hands a card a new `hass` object on every state change), which is what makes a plain
 * `willUpdate(changed) { changed.has("hass") }` check work as a change signal in Lit components.
 *
 * `iledclock-card`/`iledclock-studio-panel` are built by sibling tasks and do not exist in this
 * checkout yet (see the shared task context) -- this file is written against their documented
 * tag names and config shape regardless, importing `../src/main.ts` for side-effect element
 * registration exactly like the shipped bundle does. Until those land, `customElements.define`
 * never fires for either tag, so the two containers below stay empty (an undefined custom
 * element renders as an empty, un-upgraded `HTMLElement`) and `whenRendered` falls through its
 * own timeout instead of hanging forever -- `window.__iledclockReady` still gets set so a
 * screenshot/poll script never blocks on work that hasn't landed yet. The panel is mounted with
 * a `device-id` prop (mirroring the card's own `config.device_id`) rather than a config object,
 * per the task's own "either is fine, pick the safer guess" allowance.
 */

import "../src/main.ts";
import type { IledclockCardConfig } from "../src/types.ts";
import { createMockHass, DEVICE_ID } from "./mock-hass.ts";

declare global {
  interface Window {
    __iledclockReady?: boolean;
  }
}

interface HassAwareElement extends HTMLElement {
  hass?: unknown;
  updateComplete?: Promise<unknown>;
}

const RENDER_TIMEOUT_MS = 5000;

async function whenRendered(tag: string, el: HassAwareElement): Promise<void> {
  await Promise.race([customElements.whenDefined(tag), new Promise<void>((resolve) => setTimeout(resolve, RENDER_TIMEOUT_MS))]);
  if (customElements.get(tag)) await el.updateComplete?.catch(() => undefined);
}

async function main(): Promise<void> {
  const cardContainer = document.getElementById("card-container");
  const panelContainer = document.getElementById("panel-container");
  if (!cardContainer || !panelContainer) throw new Error("dev harness: missing mount container");

  const card = document.createElement("iledclock-card") as HassAwareElement & { setConfig?: (config: IledclockCardConfig) => void };
  const panel = document.createElement("iledclock-studio-panel") as HassAwareElement & { deviceId?: string; narrow?: boolean };

  const hass = createMockHass(() => {
    const fresh = { ...hass };
    card.hass = fresh;
    panel.hass = fresh;
  });

  card.setConfig?.({ type: "custom:iledclock-card", device_id: DEVICE_ID, name: "Plant Room Clock" });
  card.hass = hass;
  panel.deviceId = DEVICE_ID;
  panel.narrow = false;
  panel.hass = hass;

  cardContainer.appendChild(card);
  panelContainer.appendChild(panel);

  await Promise.all([whenRendered("iledclock-card", card), whenRendered("iledclock-studio-panel", panel)]);
  window.__iledclockReady = true;
}

void main();
