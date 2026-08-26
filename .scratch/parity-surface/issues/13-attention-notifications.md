# 13: Attention state machine and OS notifications

**Parent:** paseo-gpui#34 (§4 Notifications & attention)

**What to build:** One pure attention machine decides when the user's eye is needed and when the OS should say so. OS notifications fire only when the app window is unfocused or a different agent is focused. Titles are exactly "Agent needs permission", "Agent needs attention", or "Agent finished"; bodies are markdown-stripped previews truncated at 220 characters; each carries payload {serverId, workspaceId, agentId, reason} handed to a runtime notification bridge (interface defined here; delivery silently no-ops where no bridge exists). Attention priority is permission < error < finished for superseding an outstanding notice. In-app attention clears on composer focus/send/blur — except permission, which never auto-clears (the explicit mark-as-read menu item itself belongs to tracker issue #16). Clicking a notification deep-links to that agent via the routing payload.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Notification decision (fire/suppress) accounts for window focus and currently-focused agent
- [ ] Titles match the three exact strings by reason; body preview is markdown-stripped and truncated at 220 chars
- [ ] Payload contains serverId, workspaceId, agentId, reason and routes click-through to selecting that agent
- [ ] Priority ordering permission < error < finished governs replacement of an outstanding notification
- [ ] Attention clears on composer focus, send, and blur; permission reason never auto-clears
- [ ] Decision + truncation + stripping logic unit-tested without any OS dependency
