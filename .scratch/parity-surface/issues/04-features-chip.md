# 04: Provider features chip

**Parent:** paseo-gpui#34 (§1 Composer completion)

**What to build:** A composer chip listing the selected provider's feature values (from the provider catalog) as On/Off toggles. Toggling updates the draft config that a newly created agent starts with, alongside the existing model/thinking/mode picks, respecting the established reset rules (changing model resets dependent choices to catalog defaults). Where the daemon supports changing features on a live agent, the chip mirrors today's optimistic-hold pattern: flip immediately, reconcile or revert on the daemon echo.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Chip renders only features the ready provider exposes, each with an On/Off toggle reflecting the draft config
- [ ] Toggling updates the draft config consumed by agent creation
- [ ] Model change resets feature toggles per catalog defaults, consistent with existing draft-config rules
- [ ] Draft-config reducer events for features are pure and unit-tested (set, reset-on-model-change, catalog default merge)
