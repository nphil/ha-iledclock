# Changelog

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
