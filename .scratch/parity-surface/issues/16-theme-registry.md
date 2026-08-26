# 16: Theme registry — light, dark variants, auto, switching

**Parent:** paseo-gpui#34 (§6 Theming & i18n)

**What to build:** A registry of complete themes built on the token layer: light, dark (current), auto (system-following), plus dark variants zinc, midnight, claude, ghostty, and pure black — registered in a fixed cycle order that ⌘Alt+T will walk (the binding itself lands with ticket 12's engine follow-up wiring). Switching applies live across every surface. As proof the tokens are complete, this ticket migrates all view consumers off the aliased legacy palette onto semantic tokens — chrome, composer, transcript, pickers, markdown — leaving nothing reading raw constants except the alias itself. Identity colors reuse the same base scales for hosts/labels. Persistence of the chosen theme arrives with the settings store (18); until then the choice lasts the session.

**Blocked by:** 15 (semantic tokens)

**Status:** ready-for-agent

- [ ] All listed themes render completely: no raw-hex leakage, every surface legible in light mode
- [ ] Auto follows the system appearance and tracks changes live
- [ ] Switching themes updates the running UI without restart
- [ ] Fixed cycle order exposed for the keyboard cycle binding
- [ ] Every former legacy-palette call site now consumes semantic tokens
- [ ] Each theme declares its full scale set; registry rejects incomplete definitions (tested)
