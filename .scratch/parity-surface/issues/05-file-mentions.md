# 05: @ file and directory mention autocomplete

**Parent:** paseo-gpui#34 (§1 Composer completion)

**What to build:** Typing `@` in the composer opens an inline autocomplete fed by the daemon's workspace file listing. The query filters and ranks files and directories under the agent's workspace; results distinguish files from directories; picking one inserts a mention token into the draft text, and sent messages carry the reference so the daemon can resolve it. Keyboard navigation (arrows, Enter to pick, Esc to dismiss) works without swallowing normal typing; the filter/rank function is pure and bun-tested.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Typing `@` opens the suggestion list scoped to the caret position; continuing to type narrows results
- [ ] Results mix files and directories with a visual distinction, ranked by match quality
- [ ] Picking a result inserts the mention into the draft; Esc dismisses without altering surrounding text
- [ ] Sent message content carries the mention in the form the daemon expects
- [ ] Filter/rank pure function unit-tested (empty query, no matches, directory vs file ranking)
- [ ] Graceful when the daemon listing is empty or errors: list closes, typing continues unaffected
