# 23: Agent profiles and metadata preferences

**Parent:** paseo-gpui#34 (§5 Settings)

**What to build:** Agent-profile CRUD in the Host group: named presets bundling provider, model, mode, thinking option, feature values, notes, icon, and ordering. Profiles appear as one-click starting points when creating an agent, seeding the draft config. Metadata preferences (auto vs manual titles, branch names, commit messages, PR drafts) persist and apply wherever the daemon accepts such hints. CRUD operations are pure reducer events over a profiles collection, unit-tested.

**Blocked by:** 18 (settings shell + store)

**Status:** ready-for-agent

- [ ] Create/edit/delete/reorder agent profiles with all fields; deletion asks nothing dramatic but cannot orphan an in-use draft
- [ ] New-agent flow can start from a profile, seeding draft config in one action
- [ ] Profile validation prevents empty provider/model combinations
- [ ] Metadata preferences persist and reach agent creation where the daemon supports hints
- [ ] Profiles reducer unit-tested (add/update/remove/reorder, invalid states rejected)
