/** Resolve the Home Assistant config entry an iLedClock device belongs to. Each clock is its own
 * config entry (see the integration's `config_flow.py`, one entry per discovered BLE device), so
 * `config_entries[0]` *is* "the entry", not a simplification of a real multi-entry ambiguity --
 * there is exactly one entry to find. Every `iledclock/*` WebSocket call needs this `entry_id`.
 */

import type { DeviceRegistryEntry } from "../types.ts";

export function resolveEntryId(devices: Record<string, DeviceRegistryEntry>, deviceId: string | undefined): string | undefined {
  if (!deviceId) return undefined;
  return devices[deviceId]?.config_entries?.[0];
}
