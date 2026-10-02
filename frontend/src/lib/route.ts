/** Home Assistant panel routes for Pixel Studio. Query parameters represent sheets so browser
 * Back closes a sheet before leaving its destination. */
export type StudioDestination = "now" | "create" | "explore" | "library" | "alarms";

export interface StudioRoute {
  destination: StudioDestination;
  item?: string;
  design?: string;
  /** The Alarms & reminders edit sheet: `new` for a blank form, otherwise the item's key. */
  alarm?: string;
}

const DESTINATIONS: readonly StudioDestination[] = ["now", "create", "explore", "library", "alarms"];
const BASE = "/iledclock";

export function parseStudioRoute(input: string | URL): StudioRoute {
  const url = input instanceof URL ? input : new URL(input, "http://home-assistant.local");
  const path = url.pathname.replace(/\/+$/, "") || BASE;
  const destinationPart = path === BASE ? "now" : path.startsWith(BASE + "/") ? path.slice(BASE.length + 1).split("/")[0] : "now";
  const destination = DESTINATIONS.includes(destinationPart as StudioDestination) ? destinationPart as StudioDestination : "now";
  const item = url.searchParams.get("item") || undefined;
  const design = url.searchParams.get("design") || undefined;
  const alarm = url.searchParams.get("alarm") || undefined;
  return { destination, ...(item ? { item } : {}), ...(design ? { design } : {}), ...(alarm ? { alarm } : {}) };
}

export function serializeStudioRoute(route: StudioRoute): string {
  const destination = DESTINATIONS.includes(route.destination) ? route.destination : "now";
  const query = new URLSearchParams();
  if (route.item) query.set("item", route.item);
  if (route.design) query.set("design", route.design);
  if (route.alarm) query.set("alarm", route.alarm);
  const suffix = query.toString();
  return BASE + "/" + destination + (suffix ? "?" + suffix : "");
}

/** Follow HA's panel-navigation convention so HA notices the history change and updates its
 * route state. */
export function navigateStudioRoute(route: StudioRoute, replace = false): void {
  const path = serializeStudioRoute(route);
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("location-changed"));
}
