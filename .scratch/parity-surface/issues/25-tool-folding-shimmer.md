# 25: Tool-call summary folding and loading shimmer

**Parent:** paseo-gpui#34 (§2 Transcript polish)

**What to build:** A summary folding mode for the transcript: consecutive tool turns fold into a single badge row — "edited N file(s), ran N command(s)…" — expandable in place to the full sequence, honoring the tool detail level preference (Summary | Full detail) from the settings store. Loading tool and thinking rows shimmer across their label span so in-flight work reads as alive rather than blank. Folding is pure turn-list derivation, unit-tested over streamed timelines where calls replace by call id mid-fold.

**Blocked by:** 18 (settings shell + store for tool detail level)

**Status:** ready-for-agent

- [ ] Consecutive tool turns collapse into one summary badge with accurate counts
- [ ] Expanding the badge reveals the full ordered sequence; expansion survives streaming replaces
- [ ] Tool detail level Summary|Full switches default folding behavior live
- [ ] Loading tool/thinking rows shimmer while pending and settle to normal rendering on completion
- [ ] Fold derivation pure function unit-tested (mixed kinds interrupt runs, replace-by-id, single-item runs)
