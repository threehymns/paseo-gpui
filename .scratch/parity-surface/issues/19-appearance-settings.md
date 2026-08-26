# 19: Appearance settings — theme grid, fonts, syntax theme

**Parent:** paseo-gpui#34 (§5 Settings §6 Theming)

**What to build:** The Appearance group in settings: a grid of registered themes from the theme registry with live preview on hover/selection; font preferences for ui/content/code families plus sizes, each applied globally with an inline live preview; and a syntax highlight theme picker drawn from the syntax palettes in the token layer. All choices persist through the preferences store.

**Blocked by:** 18 (settings shell + store), 16 (theme registry)

**Status:** ready-for-agent

- [ ] Theme grid renders all registered themes; selecting applies instantly and persists across relaunch
- [ ] Font family and size changes apply globally; preview pane reflects edits before commit
- [ ] Syntax theme picker switches code/diff highlighting live
- [ ] Invalid or missing persisted appearance values fall back to defaults without crashing
