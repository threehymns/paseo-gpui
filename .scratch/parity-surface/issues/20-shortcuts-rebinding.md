# 20: Shortcuts rebinding UI

**Parent:** paseo-gpui#34 (§3 Command center & keyboard, §5 Settings)

**What to build:** The Shortcuts group in settings gains desktop rebinding: clicking an action opens a capture modal that records the new binding (including multi-chord sequences), with per-action reset to default and conflict detection against existing bindings. Rebindings persist via the preferences store and take effect immediately in the keybinding engine.

**Blocked by:** 12 (keybinding engine), 18 (settings shell + store)

**Status:** ready-for-agent

- [ ] Capture modal records single-key and chord-sequence bindings reliably; Esc cancels without change
- [ ] Per-action reset restores the default catalog entry
- [ ] Conflicting bindings are flagged and cannot be saved without resolving
- [ ] Rebindings persist across relaunch and apply live
- [ ] Capture does not leak keystrokes into the underlying UI while open
