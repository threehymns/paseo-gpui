# 28: History screen

**Parent:** paseo-gpui#34 (§7 Auxiliary screens)

**What to build:** A history screen over the agent directory beyond the sidebar's buckets: a search field filtering by title/content, host filter chips (single host today, built multi-host-ready per tracker issue #4), date-bucket sections (Recent / Today / Yesterday / This week / This month / Older), load-more paging, and a truncation notice when the directory source caps results. Bucketing and filtering are pure functions tested against synthetic directories.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Search filters agents by title with debounce-free pure matching under test
- [ ] Date buckets group correctly across timezone-naive timestamps; empty buckets omitted
- [ ] Load more fetches additional pages; truncation notice appears when results are capped
- [ ] Host filter chips present and functional for the current single-host case
- [ ] Selecting an entry opens that agent's conversation as elsewhere in the app
