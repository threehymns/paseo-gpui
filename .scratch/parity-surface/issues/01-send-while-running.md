# 01: Send while running — steer, interrupt, and queue mechanics

**Parent:** paseo-gpui#34 (§1 Composer completion)

**What to build:** When the selected agent is mid-turn, the composer's send gesture gains meaning instead of blindly posting a new message. Enter steers: the text rides the agent's active turn rather than starting a fresh one. An interrupt gesture stops the current turn first, then delivers the text as a new user message. Cmd/Ctrl+Enter parks the text as a pending send rendered as a row above the composer, where it can be edited back into the input or fired immediately with "Send now". Idle/disconnected agents behave exactly as today. The intent decision is a pure function of (agent running?, gesture, configured behavior) so the whole matrix is bun-testable without a daemon; echo settlement of pending sends stays FIFO and unchanged.

Note: editing a queued row already exists — this ticket keeps that behavior and adds the steer/interrupt intents and explicit queue gesture around it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] With a running agent, Enter sends text as a steer attached to the active turn (not a fresh message); if the daemon client cannot ride the active turn, it degrades to a plain send without losing text
- [ ] Interrupt-and-send stops the running turn, then delivers the text; the interrupted turn shows its error/stopped state per existing timeline folding
- [ ] Cmd/Ctrl+Enter queues the text as a pending send shown above the composer with edit and "Send now" actions
- [ ] The intent decision function covers running/idle × Enter/Cmd-Enter/interrupt-gesture and is unit-tested
- [ ] Existing pending-send behavior (echo settlement FIFO, edit-pullback) still passes its tests
