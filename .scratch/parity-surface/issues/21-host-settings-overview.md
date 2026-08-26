# 21: Host settings overview — identity and daemon management

**Parent:** paseo-gpui#34 (§5 Settings)

**What to build:** The Host group's Overview screen for the connected daemon: rename the host, pick its identity color swatch (reusing identity colors), choose sidebar badge style (Name | Icon only | Hidden), and manage the daemon itself — restart, check for updates, and a log viewer. Also hosts the enable-Paseo-tools toggle, orchestration skills install entry, and a system prompt editor where the daemon accepts one. Built against the single connected daemon; multi-host rename/connection management stays owned by the multi-host tracker issue #4.

**Blocked by:** 18 (settings shell + store)

**Status:** ready-for-agent

- [ ] Host name, color, and badge style editable and reflected in the sidebar immediately
- [ ] Daemon restart and update-check actions work against the live daemon with clear failure feedback
- [ ] Log viewer shows recent daemon logs with refresh
- [ ] System prompt editor saves through the daemon where supported and disables cleanly where not
- [ ] All changes persist host-side via the daemon, not local-only
