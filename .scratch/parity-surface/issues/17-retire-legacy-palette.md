# 17: Retire the legacy palette constants

**Parent:** paseo-gpui#34 (§6 Theming & i18n — contract half)

**What to build:** With every consumer migrated onto semantic tokens (ticket 16), delete the aliased legacy palette so exactly one way to name a color remains. Any straggler reference is a build error, which is the point: the token layer becomes the single source of truth going into settings-driven theming.

**Blocked by:** 16 (theme registry + consumer migration)

**Status:** ready-for-agent

- [ ] Legacy palette export removed; typecheck and tests green
- [ ] No remaining raw color literals in view components outside the token/theme definitions
- [ ] Grep-level check for removed symbol returns zero hits in app code
