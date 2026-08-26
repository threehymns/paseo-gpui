# 02: Send-behavior setting with permission upgrade rule

**Parent:** paseo-gpui#34 (§1 Composer completion)

**What to build:** A composer chip (segmented control) choosing the default send behavior while an agent runs: Steer | Interrupt | Queue. The chosen behavior feeds the pure intent decider from ticket 01 — Enter then steers, interrupts, or queues accordingly. When the agent is blocked on a permission card and the behavior is Queue, releasing the queued send upgrades to interrupt-and-send so the reply actually reaches the unblocked agent. Until the settings store lands (ticket 18) the choice lives for the session; ticket 18 wires persistence.

**Blocked by:** 01 (send-while-running)

**Status:** ready-for-agent

- [ ] Chip in the composer chips row offers Steer | Interrupt | Queue with the current choice highlighted
- [ ] Enter follows the chosen behavior for a running agent (steer / interrupt / queue), verified through the intent decider tests
- [ ] With Queue selected and a permission card outstanding, sending a queued message upgrades to interrupt-and-send
- [ ] The setting is read from the preferences store when present and falls back to session state otherwise
