# 15: Semantic token expansion of the theme layer

**Parent:** paseo-gpui#34 (§6 Theming & i18n — prefactor, expand half)

**What to build:** Re-express today's single hardcoded dark palette as semantic tokens built from base scales: surfaces 0–4, foreground ramp, border/accent/primary/destructive, status band, diff add/delete colors, terminal ANSI placeholders, and syntax palettes — exactly the upstream shape. The renderer chat theme derives from these tokens, and the legacy constant palette becomes a thin alias onto them. This is a wide refactor done expand-first: zero consumer changes, zero visual change, everything byte-identical — it exists so theme registration (16), consumer migration, and legacy deletion can each land green.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Base scales defined per upstream shape (surfaces, foreground ramp, border/accent/primary/destructive, status band, diff colors, terminal ANSI, syntax palettes)
- [ ] Derived semantic tokens reproduce every color in use today with identical values
- [ ] Chat renderer theme derives from tokens; legacy palette aliases onto tokens
- [ ] Visual output unchanged (snapshot/golden test over token values)
- [ ] Derivation functions unit-tested (no hand-copied hex between layers)
