# 18: Settings screen shell and persisted preferences store

**Parent:** paseo-gpui#34 (§5 Settings)

**What to build:** The dead settings button comes alive: a settings screen with a left rail organized into App and Host groups, reachable from the sidebar and ⌘,. Beneath it lands the missing foundation — a typed persisted-preferences store (load/save through the runtime storage bridge, defaults, pure reducer + thin adapter per house pattern). First real preferences migrate into it and wire through immediately: always-expand-reasoning (transcript honors it at once) and tool detail level Summary|Full detail (consumed fully by ticket 25); the General group also carries language selector (English-only initially), default send behavior segmented control bound to ticket 02's setting, service URL opening ask|in-app|external, and terminal scrollback stepper (consumed later by the terminals tracker issue #6). Sidebar view preferences (archived visibility, grouping mode) move into persistence as the demonstration. Diagnostics group collects a report (versions, connection state, recent errors) with copy-to-clipboard; About shows app/daemon versions and release channel Stable|Beta.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Settings screen opens from the sidebar button and ⌘, with App + Host rail groups
- [ ] Preferences store persists across relaunch; typed schema with defaults; corrupt storage falls back to defaults
- [ ] Always-expand-reasoning toggle takes effect on the transcript immediately
- [ ] Tool detail level selector persists and feeds transcript state (full folding behavior arrives in 25)
- [ ] Send-behavior control reads/writes the same key ticket 02 uses
- [ ] Diagnostics report copies to clipboard; About lists versions and channel
- [ ] Store reducer unit-tested (set/unset/reset, migration of unknown keys)
