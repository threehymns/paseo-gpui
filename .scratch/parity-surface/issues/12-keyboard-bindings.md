# 12: Keybinding engine, default bindings, shortcuts dialog, focus mode

**Parent:** paseo-gpui#34 (§3 Command center & keyboard)

**What to build:** A keybinding engine binds keys to the action registry from ticket 11. It supports multi-chord sequences with a 1.5s timeout, respects text-input focus (composer-scoped actions only while typing), and ships a default catalog covering the actions that exist today: new agent (⌘N), archive agent (⌘⇧⌫), focus composer (⌘L), toggle sidebar (⌘B), open settings (⌘,), interrupt running turn (Esc), cycle send behavior (Shift+Tab), toggle command palette (⌘K), shortcuts dialog (?), and focus mode (⌘⇧F) which hides sidebar and chrome for distraction-free reading. A shortcuts dialog lists current bindings grouped like upstream's catalog; bindings tied to surfaces that don't exist yet (tabs, splits, files/terminals/changes) are deliberately omitted — they arrive with their owning tickets. Theme cycling (⌘Alt+T) is wired by the theme registry ticket.

**Blocked by:** 01 (interrupt gesture), 11 (action registry)

**Status:** ready-for-agent

- [ ] Engine parses single keys and chord sequences with 1.5s sequence timeout; pending-chord state is cancelable
- [ ] All listed default bindings fire their registry actions; unbound keys pass through untouched
- [ ] Typing in the composer does not trigger non-composer-scoped bindings; Shift+Tab and Esc still work there per spec
- [ ] Focus mode hides sidebar and chrome and restores via the same binding
- [ ] Shortcuts dialog renders the live binding table grouped by area
- [ ] Binding parser/matcher is a pure module under test (modifiers, platform meta/ctrl, chords, conflicts)
