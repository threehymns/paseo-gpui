# 08: Scroll detach, floating jump button, prompt outline rail

**Parent:** paseo-gpui#34 (§2 Transcript polish)

**What to build:** Scrolling up through the transcript detaches auto-follow: streaming new turns no longer yanks the view down, and a floating scroll-to-bottom button appears. Clicking it (or scrolling back to the bottom) re-attaches following. Along the right edge, a prompt outline rail renders one tick per user turn; hovering a tick previews the prompt text; clicking jumps to it. This gives the transcript real scroll-position awareness (today auto-scroll always wins) while silent top pagination itself stays owned by tracker issue #20.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Auto-follow disengages when the user scrolls up; incoming turns do not move the viewport
- [ ] Floating scroll-to-bottom button appears when detached and disappears when re-attached
- [ ] Re-attach via button click or manual scroll to bottom resumes following
- [ ] Outline rail shows one tick per user turn with hover preview and click-to-jump
- [ ] Detach/attach state machine is a pure reducer under test (scroll events, new-turn-while-detached, re-anchor)
