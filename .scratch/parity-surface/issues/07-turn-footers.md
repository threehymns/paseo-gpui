# 07: Turn footers — elapsed ticker, worked-for, rich copy

**Parent:** paseo-gpui#34 (§2 Transcript polish)

**What to build:** Assistant turns gain a footer line. While the turn is working, elapsed time ticks each second. Once finished, it reads "Worked for {duration}", swapping to the completion timestamp on hover. A copy button copies the turn's markdown-rich content and flashes ✓ on success. Sealed reasoning durations ("Thought for 47s") are untouched — this ticket covers user-visible assistant turn duration and copying only.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Working assistant turn shows elapsed time updating every second
- [ ] Completed turn shows "Worked for {duration}"; hovering swaps to the absolute completion timestamp
- [ ] Copy button copies the turn's markdown and confirms with a brief ✓ flash
- [ ] Footer absent or inert for turns that produced nothing copyable
- [ ] Duration formatting (seconds/minutes/hours rounding) is a pure function under test
