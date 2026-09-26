/** Pure entity-role resolution: turn "an iLedClock device_id" into the concrete entity_ids the
 * card and panel need, without the user ever typing an entity id. Matches on `translation_key`
 * first (the stable, name-independent identifier the integration assigns each entity role) and
 * falls back to an entity_id suffix, so this keeps working against an older registry snapshot or
 * a fixture that omits `translation_key` (same two-tier match as the reference Kibble card this
 * project's conventions come from). Disabled registry entries are skipped: they carry no live
 * state, so surfacing them would just produce a control that can never read or write anything.
 */

import type { EntityRegistryEntry } from "../types.ts";

export interface NamedSwitch {
  entityId: string;
  name: string;
}

export interface IledclockEntities {
  deviceId: string;
  /** `light.<name>_display`: power, brightness, rgb_color, effects = colour modes. */
  display?: string;
  /** `text.<name>_message`: shows a text program immediately. */
  message?: string;
  /** `image.<name>_display`: PNG preview of the program currently on the clock. */
  preview?: string;
  temperature?: string;
  humidity?: string;
  firmware?: string;
  programCount?: string;
  /** `binary_sensor.<name>_connected` (diagnostic, connectivity). */
  connected?: string;
  syncTimeButton?: string;
  rotationSelect?: string;
  /** `select.<name>_clock_face`: primary -- uploads a clock program with the chosen style. */
  clockFaceSelect?: string;
  volumeNumber?: string;
  colorSpeedNumber?: string;
  nightModeSwitch?: string;
  /** Every other `switch.*` on the device (one per 0x1e device setting) -- the settings sheet
   * lists these generically since their count and meaning is device-firmware-defined, not fixed
   * by this card's own contract. */
  settingSwitches: NamedSwitch[];
}

interface RoleRule {
  domain: string;
  translationKeys: string[];
  idSuffixes: string[];
}

type RuleRole = Exclude<keyof IledclockEntities, "deviceId" | "settingSwitches">;

const RULES: Record<RuleRole, RoleRule> = {
  display: { domain: "light", translationKeys: ["display"], idSuffixes: ["_display"] },
  message: { domain: "text", translationKeys: ["message"], idSuffixes: ["_message"] },
  preview: { domain: "image", translationKeys: ["display"], idSuffixes: ["_display"] },
  temperature: { domain: "sensor", translationKeys: ["temperature"], idSuffixes: ["_temperature"] },
  humidity: { domain: "sensor", translationKeys: ["humidity"], idSuffixes: ["_humidity"] },
  firmware: { domain: "sensor", translationKeys: ["firmware"], idSuffixes: ["_firmware"] },
  programCount: { domain: "sensor", translationKeys: ["program_count"], idSuffixes: ["_program_count"] },
  connected: { domain: "binary_sensor", translationKeys: ["connected"], idSuffixes: ["_connected"] },
  syncTimeButton: { domain: "button", translationKeys: ["sync_time"], idSuffixes: ["_sync_time"] },
  rotationSelect: { domain: "select", translationKeys: ["rotation"], idSuffixes: ["_rotation"] },
  clockFaceSelect: { domain: "select", translationKeys: ["clock_face"], idSuffixes: ["_clock_face"] },
  volumeNumber: { domain: "number", translationKeys: ["volume"], idSuffixes: ["_volume"] },
  colorSpeedNumber: { domain: "number", translationKeys: ["color_speed"], idSuffixes: ["_color_speed"] },
  nightModeSwitch: { domain: "switch", translationKeys: ["night_mode"], idSuffixes: ["_night_mode"] },
};

function domainOf(entityId: string): string {
  return entityId.slice(0, entityId.indexOf("."));
}

function objectIdOf(entityId: string): string {
  return entityId.slice(entityId.indexOf(".") + 1);
}

function matchesRule(entry: EntityRegistryEntry, rule: RoleRule): boolean {
  if (domainOf(entry.entity_id) !== rule.domain) return false;
  if (entry.translation_key && rule.translationKeys.includes(entry.translation_key)) return true;
  const objectId = objectIdOf(entry.entity_id);
  return rule.idSuffixes.some((suffix) => objectId.endsWith(suffix));
}

function switchDisplayName(entry: EntityRegistryEntry): string {
  const raw = entry.name ?? entry.original_name;
  if (raw) return raw;
  const lastWord = objectIdOf(entry.entity_id).split("_").filter(Boolean).pop();
  return lastWord ? lastWord[0]!.toUpperCase() + lastWord.slice(1) : "Setting";
}

export function resolveIledclockEntities(entities: Record<string, EntityRegistryEntry>, deviceId: string): IledclockEntities {
  const result: IledclockEntities = { deviceId, settingSwitches: [] };
  const forDevice = Object.values(entities).filter((entry) => entry.device_id === deviceId && !entry.disabled_by);

  for (const entry of forDevice) {
    let matched = false;
    for (const roleEntry of Object.entries(RULES) as Array<[RuleRole, RoleRule]>) {
      const [role, rule] = roleEntry;
      if (result[role]) continue;
      if (matchesRule(entry, rule)) {
        result[role] = entry.entity_id;
        matched = true;
        break;
      }
    }
    if (!matched && domainOf(entry.entity_id) === "switch") {
      result.settingSwitches.push({ entityId: entry.entity_id, name: switchDisplayName(entry) });
    }
  }

  result.settingSwitches.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
