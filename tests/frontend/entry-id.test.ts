import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEntryId } from "../../frontend/src/lib/entry-id.ts";
import type { DeviceRegistryEntry } from "../../frontend/src/types.ts";

const DEVICES: Record<string, DeviceRegistryEntry> = {
  "device-1": { id: "device-1", name: "Plant Room Clock", config_entry_id: "entry-1" },
  "device-2": { id: "device-2", name: "Kitchen Clock", config_entry_id: "entry-2" },
};

test("a device resolves to the config entry id Home Assistant gives it", () => {
  assert.equal(resolveEntryId(DEVICES, "device-1"), "entry-1");
  assert.equal(resolveEntryId(DEVICES, "device-2"), "entry-2");
});

test("a device that is not in the registry, or no device at all, resolves to nothing", () => {
  assert.equal(resolveEntryId(DEVICES, "device-3"), undefined);
  assert.equal(resolveEntryId(DEVICES, undefined), undefined);
  assert.equal(resolveEntryId(DEVICES, ""), undefined);
});
