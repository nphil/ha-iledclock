import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveIledclockEntities } from "../../frontend/src/lib/resolve-entities.ts";
import type { EntityRegistryEntry } from "../../frontend/src/types.ts";

const DEVICE = "device-1";

function entry(entityId: string, overrides: Partial<EntityRegistryEntry> = {}): EntityRegistryEntry {
  return { entity_id: entityId, device_id: DEVICE, ...overrides };
}

test("resolves primary entities by their Contract C id suffix", () => {
  const entities: Record<string, EntityRegistryEntry> = {
    "light.plant_room_display": entry("light.plant_room_display"),
    "text.plant_room_message": entry("text.plant_room_message"),
    "image.plant_room_display": entry("image.plant_room_display"),
    "binary_sensor.plant_room_connected": entry("binary_sensor.plant_room_connected"),
  };
  const resolved = resolveIledclockEntities(entities, DEVICE);
  assert.equal(resolved.display, "light.plant_room_display");
  assert.equal(resolved.message, "text.plant_room_message");
  assert.equal(resolved.preview, "image.plant_room_display");
  assert.equal(resolved.connected, "binary_sensor.plant_room_connected");
});

test("translation_key matches even when the entity_id has been renamed by the user", () => {
  const entities: Record<string, EntityRegistryEntry> = {
    "light.kitchen_clock": entry("light.kitchen_clock", { translation_key: "display" }),
  };
  const resolved = resolveIledclockEntities(entities, DEVICE);
  assert.equal(resolved.display, "light.kitchen_clock");
});

test("entities for a different device are ignored", () => {
  const entities: Record<string, EntityRegistryEntry> = {
    "light.other_display": entry("light.other_display", { device_id: "device-2" }),
  };
  const resolved = resolveIledclockEntities(entities, DEVICE);
  assert.equal(resolved.display, undefined);
});

test("disabled registry entries are skipped entirely", () => {
  const entities: Record<string, EntityRegistryEntry> = {
    "number.clock_volume": entry("number.clock_volume", { disabled_by: "integration" }),
  };
  const resolved = resolveIledclockEntities(entities, DEVICE);
  assert.equal(resolved.volumeNumber, undefined);
});

test("night_mode switch resolves to its own role, not the generic bucket", () => {
  const entities: Record<string, EntityRegistryEntry> = {
    "switch.clock_night_mode": entry("switch.clock_night_mode"),
  };
  const resolved = resolveIledclockEntities(entities, DEVICE);
  assert.equal(resolved.nightModeSwitch, "switch.clock_night_mode");
  assert.equal(resolved.settingSwitches.length, 0);
});

test("every other switch on the device buckets generically, sorted by display name", () => {
  const entities: Record<string, EntityRegistryEntry> = {
    "switch.clock_remote_enable": entry("switch.clock_remote_enable", { name: "Remote enable" }),
    "switch.clock_show_device_id": entry("switch.clock_show_device_id", { original_name: "Show device ID" }),
  };
  const resolved = resolveIledclockEntities(entities, DEVICE);
  assert.equal(resolved.settingSwitches.length, 2);
  assert.deepEqual(resolved.settingSwitches.map((s) => s.name), ["Remote enable", "Show device ID"]);
});

test("a switch with neither a friendly name nor original_name falls back to a titlecased suffix word", () => {
  const entities: Record<string, EntityRegistryEntry> = {
    "switch.clock_beacon": entry("switch.clock_beacon"),
  };
  const resolved = resolveIledclockEntities(entities, DEVICE);
  assert.equal(resolved.settingSwitches[0]!.name, "Beacon");
});

test("an entity id suffix must be an exact suffix match, not merely contained", () => {
  const entities: Record<string, EntityRegistryEntry> = {
    // "predisplayed" ends with "displayed", not "_display" -- must not false-positive match display.
    "light.predisplayed": entry("light.predisplayed"),
  };
  const resolved = resolveIledclockEntities(entities, DEVICE);
  assert.equal(resolved.display, undefined);
});
