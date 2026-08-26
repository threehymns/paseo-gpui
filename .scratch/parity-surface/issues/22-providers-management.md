# 22: Providers management screen

**Parent:** paseo-gpui#34 (§5 Settings)

**What to build:** The Host group's Providers screen over the existing provider catalog subscription: add a provider from the catalog, enable/disable providers, show each provider's status (Disabled / Loading / Error / Available / Not installed), manage models per provider including custom model ids, open per-provider diagnostics, and remove a provider behind a confirmation. Status transitions render reactively from catalog updates.

**Blocked by:** 18 (settings shell + store)

**Status:** ready-for-agent

- [ ] Provider list mirrors catalog state with correct status per provider
- [ ] Enable/disable toggles persist and gate provider availability in the composer's draft config picks
- [ ] Models manageable per provider including adding custom ids
- [ ] Provider diagnostics surface errors readable enough to act on
- [ ] Removal requires confirmation and cleans up dependent draft-config choices
- [ ] Adding a provider makes it selectable in the composer without restart
