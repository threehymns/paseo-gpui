# 11: Command palette and shared action registry

**Parent:** paseo-gpui#34 (§3 Command center & keyboard)

**What to build:** ⌘K / Ctrl+K opens a command palette overlay with placeholder "Search commands, files, workspaces, and agents..." and fuzzy-matched sections: Actions, Workspaces, Agents, plus contributed choices for model, thinking, and mode selection. A shared action registry module is born here — every palette entry is a registered action (id, title, section, run, enabled) so the keybinding layer (ticket 12), shortcuts dialog, and settings rebinding can consume the same catalog. The Files section waits until the daemon file-search seam from ticket 05 can be reused. "Open in side/focused pane" variants are out of scope until a pane concept exists (workspace-layer tracker issue #33). Palette navigation and match ranking are pure modules under test.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] ⌘K/Ctrl+K toggles the palette; Esc closes; typing filters across sections
- [ ] Sections Actions / Workspaces / Agents render from the registry; agents and workspaces reflect live directory state
- [ ] Contributed choices let the user switch model, thinking, and mode from the palette
- [ ] Action registry is exported for reuse by keyboard bindings and settings
- [ ] Fuzzy match + ranking + keyboard navigation unit-tested; no global key handlers leaked when closed
