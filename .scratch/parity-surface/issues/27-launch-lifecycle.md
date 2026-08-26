# 27: Launch lifecycle — splash, welcome, failure retry, quitting overlay

**Parent:** paseo-gpui#34 (§7 Auxiliary screens)

**What to build:** First-run and connection UX end to end. A startup splash shows while connecting to the daemon. With no daemon configured, a welcome screen offers Direct connection (host/port/password/SSL form), Paste pairing link (parses `#offer=` links), and Scan QR — QR deferred until a camera bridge exists, rendered disabled with an explanation. Managed-daemon startup failures get a dedicated screen with recent logs and Retry. Conversation-level connection failures gain an explicit retry affordance. Quitting shows a brief overlay while agents wind down. Each state is reachable in isolation via the connection reducer, so all paths are testable without real daemons.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Splash renders during connect and yields to the app or welcome screen on outcome
- [ ] Welcome direct-connect form validates input, attempts connection, and surfaces errors inline
- [ ] Paste-link parses offer payloads and pre-fills the form; malformed links rejected with feedback
- [ ] Scan QR visible but disabled with explanation until a camera bridge exists
- [ ] Daemon failure screen shows logs and Retry; retry recovers without relaunch when the daemon returns
- [ ] Conversation error state offers retry; quitting overlay appears during shutdown
