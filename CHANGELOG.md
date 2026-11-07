# Changelog

## 0.3.10 - 2026-11-07

Housekeeping so the integration keeps working on Home Assistant 2026.11 and the releases after it.
Nothing changes in how the clock behaves.

- Needs Home Assistant 2026.10 or newer (it was 2026.6): the services now look up a clock's device
  with the helper Home Assistant added for it, because the old way (reading a device's list of
  config entries) is deprecated and is removed in 2027.10. A service call that names a device that
  is gone, or whose clock is not set up, is still refused with the same "unknown device" message.
- The Studio panel and the card find the clock's config entry through the device's single
  `config_entry_id` instead of the deprecated `config_entries` list (removed in 2027.8).
- The preview image entity now says it can be renamed in place. From 2026.11 Home Assistant renames
  an entity (Settings → Entities) without removing and adding it again, but only for entities that
  opt in; this one now does, so a rename no longer re-runs its start-up.
- The integration lists a category (Lighting → LED strips & controllers) for the Marketplace that
  replaces HACS in 2026.11.
- The tests for the integration now run on Home Assistant's own test harness (`pytest-homeassistant`,
  the old `pytest-homeassistant-custom-component` no longer works from 2026.11), and a weekly GitHub
  check runs them against the newest stable and the newest beta Home Assistant, so a release that
  breaks the integration shows up about a week before it reaches the house.

## 0.3.9 - 2026-10-09

- The clock now frees itself from a "ghost link". If a Bluetooth proxy glitches, its radio can keep
  the clock's connection after the proxy itself has forgotten it. The clock then thinks it is still
  connected and stops advertising, so nothing can reach it (this lasted 22 hours on another device in
  the house on 2026-10-08). Now, if the clock has not been heard for 3 minutes after its link ended,
  the next connection attempt asks the proxy that last carried the link to drop its connections one at
  a time, until the clock is heard again. If it stays silent (for example, unplugged), it tries again
  after 30 minutes, 2 hours, then every 6 hours.
- This needs a proxy with the `force_disconnect_handle` action (the house proxy firmware). Other
  proxies are left alone. A healthy device on the same proxy may drop for a few seconds and reconnect
  while this runs.
- The integration's diagnostics show `ghost_links_freed` and `last_ghost_try`.
- The **Connected** sensor now has link attributes the RF dashboard reads: `hold` (the link is kept
  open), `drops_1h` (unexpected link drops in the last hour), `proxy` (the proxy carrying the link, empty
  while disconnected), `preferred_proxy` and `via_preferred_proxy` (this integration has no preferred
  proxy, so they stay empty).
