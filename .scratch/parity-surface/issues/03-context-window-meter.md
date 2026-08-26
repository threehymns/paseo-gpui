# 03: Context-window meter ring

**Parent:** paseo-gpui#34 (§1 Composer completion — lands the usage half referenced by tracker issue #19)

**What to build:** A ring right of the composer's input row showing how much of the model's context window the conversation uses, fed by the daemon's usage reporting for the selected model. Neutral below 70%, amber at ≥70%, red above 90%. Hovering shows "{{percentage}}% used", "{{used}} / {{max}} tokens", "Session cost $X.XX", plus a per-provider breakdown when the daemon reports more than one provider. Hidden entirely when no usage data exists yet. Formatting (fractions, thresholds, tooltip lines, cost rounding) is a pure module under bun test.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Ring renders used/max fraction from daemon usage data next to the input row and updates live as turns stream
- [ ] Threshold colors correct at <70 / ≥70 / >90 percent boundaries
- [ ] Tooltip shows percentage, raw token counts, and session cost exactly as specified
- [ ] Per-provider breakdown appears when multi-provider usage is reported
- [ ] Meter hidden when the daemon reports no usage; formatting functions unit-tested including edge cases (0, max exceeded, missing cost)
