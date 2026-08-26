# 14: Attention badges — dock count and header badge

**Parent:** paseo-gpui#34 (§4 Notifications & attention)

**What to build:** Surfaces that summarize outstanding attention: the dock badge shows the count of agents in attention, needs-input, or failed states across the directory (set through the runtime bridge from ticket 13; absent bridge means no-op); the header gains a small icon badge component mirroring the same count so the state is visible inside the window too. Count derivation from directory state is pure and tested.

**Blocked by:** 13 (attention state machine)

**Status:** ready-for-agent

- [ ] Dock badge count equals agents needing attention across all statuses (attention / needs input / failed)
- [ ] Header icon badge mirrors the same count and hides at zero
- [ ] Badge updates reactively as directory subscriptions change state
- [ ] Count derivation unit-tested over mixed directory snapshots
