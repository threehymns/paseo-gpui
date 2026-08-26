# 24: Usage page

**Parent:** paseo-gpui#34 (§5 Settings)

**What to build:** A Usage page in the App group reusing the aggregation built for the context-window meter (ticket 03): per-provider token usage and session cost over time, with totals. Read-only reporting; no settings here beyond range selection.

**Blocked by:** 03 (context meter usage aggregation), 18 (settings shell)

**Status:** ready-for-agent

- [ ] Per-provider usage table renders tokens and cost from the same data source as the meter
- [ ] Totals row sums correctly across providers
- [ ] Empty state when no usage recorded; no crash on partial provider data
- [ ] Aggregation logic shared with ticket 03 rather than duplicated (single pure module)
