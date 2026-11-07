/** Resolve the Home Assistant config entry an iLedClock device belongs to. Each clock is its own
 * config entry (see the integration's `config_flow.py`, one entry per discovered BLE device), and
 * Home Assistant 2026.8+ gives every device exactly one, as `config_entry_id` in the device
 * registry list the frontend receives. (The old `config_entries` array is deprecated, goes away
 * in 2027.8, and a child device never had it.) Every `iledclock/*` WebSocket call needs this
 * `entry_id`.
 */

import type { DeviceRegistryEntry } from "../types.ts";

export function resolveEntryId(devices: Record<string, DeviceRegistryEntry>, deviceId: string | undefined): string | undefined {
  if (!deviceId) return undefined;
  return devices[deviceId]?.config_entry_id;
}
