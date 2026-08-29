# gpuix-chat

A desktop chat client rendered on the GPU (`@gpuix/react`), viewed over a live
Paseo daemon. The vocabulary follows Paseo's own terms.

## Language

**Daemon**:
The Paseo process the app connects to over WebSocket; the sole source of truth.
_Avoid_: server, backend, API

**Agent**:
A running (or finished) Paseo agent working in a workspace directory. One agent
owns one conversation timeline.

**Agent directory**:
The known agents, kept fresh by subscription updates. The sidebar stops
listing them directly: it renders collapsible project groups, one row per
workspace, and opening a workspace shows that workspace's conversation.
_Avoid_: session list, conversation list

**Subagent**:
A child agent working inside a parent agent's task, one row in the subagent
panel. Two kinds share that panel and its projections.

**Managed subagent**:
A real child agent found via its `paseo.parent-agent-id` label in the agent
directory; archived ones are excluded. Opening one is ordinary conversation
navigation.
_Avoid_: child session, spawned agent

**Provider subagent**:
A provider-owned descriptor pushed by the daemon (`agent.provider_subagents.*`)
with a timeline fetched and streamed separately. Opening one swaps the
transcript area for a read-only view.

**Timeline item**:
One event on an agent's timeline as the daemon emits it (user message,
assistant delta, reasoning delta, tool call, todo snapshot, compaction,
error).

**Turn**:
A transcript row produced by folding timeline items: user, assistant,
reasoning, tool, compaction, todo, error, or canceled. Streaming deltas merge into the
previous turn of their kind; tool calls replace by call id; a compaction item
replaces the prior compaction state rather than stacking. A tool turn carries
both a flattened summary and the daemon's structured detail; its row expands in
place to show that detail, with expansion state kept by the row itself. An edit
turn's expansion shows its patch as a diff. A reasoning turn stays collapsed
until opened: while deltas stream it reads "Thinking…", and once anything
proves thinking has stopped (the next appended item or the turn's end) its
length is sealed from the delta timestamps and the row reads "Thought for
<duration>".
An assistant turn carries its own span: it starts at its first delta, and once
anything proves it finished (the next appended item or turn completion) it is
sealed at that moment — never at whenever sealing happens to run. Its footer
ticks elapsed time each second while working, reads "Worked for <duration>"
when done (swapping to the completion clock time on hover), and offers copying
its markdown with a brief ✓ flash; turns with nothing copyable show no copy
affordance.
_Avoid_: message, item

**Compaction divider**:
The quiet rule–label–rule separator a compaction turn renders ("Context
compacted…", spinner while compacting). It explains apparent memory loss; it is
not an error or a chat message.

**Usage footer**:
The lightweight line under the newest assistant turn — tokens, plus cost when
the daemon provides it — fed by `usage_updated` and `turn_completed` usage.
_Avoid_: meter, chart

**Sealed**:
The frozen duration of a finished reasoning block, measured first-delta to
last-delta; quiet gaps before the next item do not count as thinking.
_Avoid_: closed, ended

**Transcript**:
The ordered turns shown for one agent, including optimistic sends not yet
echoed by the daemon.

**Following**:
The attached scroll state in which incoming turns pull the transcript to its
tail. Scrolling up **detaches** it: streaming no longer moves the viewport and
a floating jump button appears. Jumping (button click) or wheeling down until
the list pins at its end re-attaches.
_Avoid_: auto-scroll, stick-to-bottom

**Outline rail**:
The tick strip along the transcript's right edge, one tick per user turn;
hovering previews the prompt, clicking scrolls that row into view.
_Avoid_: minimap, scrollbar

**Pending send**:
A user text queued optimistically before the daemon echoes it back. Echoes
settle the queue head that matches, first-in-first-out.
_Avoid_: seed, echo buffer

**Conversation**:
Everything seen for one selected agent: its transcript plus connection state
(loading, ready, error). Attaching to a freshly created agent seeds the first
pending send from the prompt.

**Provider catalog**:
The daemon's providers and their models, modes, and thinking options;
only ready providers are selectable.

**Draft config**:
The model/thinking/mode triple a new agent will start with. It tracks catalog
defaults until the user overrides it; picking a model resets thinking and mode.
_Avoid_: settings, preferences

**Composer**:
The draft input area with its config chips, used both to create an agent and
to send follow-up prompts to the active one. Engaging it — focus, send, or
blur — is the user showing up in that conversation.

**Attention**:
The per-agent flag that the user's eye is needed, mirrored from the daemon's
`requiresAttention` with reason permission, error, or finished. Engaging the
composer clears it, except permission, which never auto-clears (the explicit
mark-as-read menu item belongs to tracker issue #16).

**Notice**:
One ready-to-show OS notification built from a raise: exact title by reason
("Agent needs permission", "Agent needs attention", "Agent finished"), a
markdown-stripped body truncated at 220 characters, and routing payload
{serverId, workspaceId, agentId, reason}. The OS says so only when the window
is unfocused or a different agent is focused; a higher-priority reason —
permission < error < finished — supersedes an outstanding notice. Delivery
goes through a runtime notification bridge and silently no-ops where none
exists; clicking one deep-links by selecting its agent.

**Context meter**:
The ring right of the composer's input row showing how much of the selected
model's context window the conversation uses. Fed by the daemon's usage
reporting — live stream events first, the agent directory snapshot until one
lands — and hidden entirely when no usable usage exists. Its fraction,
threshold tone, and hover lines come from one pure projection.
_Avoid_: token counter, usage widget

**Tracks row**:
A compact row above the composer surfacing live work as pills, each folded
from the transcript's turns. The **Tasks pill** summarizes the latest todo
snapshot (completed of total, plus the in-progress item). The **Subagents
pill** counts subagent calls by state and offers detach-to-view for a running
one and archive-finished for completed ones. The **DiffStat pill** shows the
adds/deletes accumulated across edit turns and opens the Changes surface —
rendered only while that surface exists, hidden otherwise. A pill with
nothing to say is never rendered.
_Avoid_: status bar, toolbar

**Workspace**:
A directory an agent can run in, listed by the daemon. A **worktree** is a git
worktree variant of one. Workspace descriptors are first-class app state: a
store fed by a single subscribed `workspaces.list({ subscribe })` call, written
only by the daemon's update stream (upserts, removes, emptied and removed
projects). Opening a workspace shows its most recently active agent's
timeline; a workspace with no agents falls back to the composer's new-task
state seeded to that workspace's directory.
