# 06: Tracks row above the composer

**Parent:** paseo-gpui#34 (§1 Composer completion)

**What to build:** A compact row above the composer surfacing live work at a glance: a Tasks pill summarizing the latest todo snapshot on the timeline; a Subagents pill showing running/finished subagent counts with detach-to-view and archive-finished actions; a DiffStat pill showing +adds/−dels accumulated from edit turns that would open the Changes surface — rendered only when such a surface exists (it lands with tracker issue #3), hidden otherwise. All pills derive from timeline folding already owned by the transcript layer; derivation functions are pure and tested against fixture timelines.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Tasks pill reflects the most recent todo snapshot item and updates as new snapshots arrive
- [ ] Subagents pill shows counts by state; finished subagents can be archived; an active subagent can be detached for focused viewing
- [ ] DiffStat pill shows correct add/delete totals from edit turns and opens the Changes surface when available
- [ ] DiffStat pill hidden when no changes surface exists rather than rendering dead
- [ ] Pill derivations unit-tested with synthetic timelines (no todos, mixed subagent states, multiple edits)
