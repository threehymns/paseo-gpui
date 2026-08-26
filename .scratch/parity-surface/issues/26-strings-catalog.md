# 26: Centralized strings catalog (i18n foundation)

**Parent:** paseo-gpui#34 (§6 Theming & i18n)

**What to build:** The i18n skeleton, English-first exactly like upstream's structure but without shipping other locales yet: a typed strings catalog module (key → English string, interpolation slots), a lookup helper, and one demonstrated migration — sidebar and composer strings move into the catalog as the pattern every future surface follows. The long tail of remaining inline strings is mechanical follow-up work, deliberately not this ticket.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Catalog module with typed keys, English values, and interpolation support
- [ ] Lookup falls back visibly (key name) rather than crashing on missing entries; unknown keys fail tests
- [ ] Sidebar and composer render exclusively from the catalog
- [ ] Locale literal currently hardcoded in date formatting flows through the catalog's locale setting
