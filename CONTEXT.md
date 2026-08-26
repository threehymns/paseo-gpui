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
The list of known agents, kept fresh by subscription updates, arranged in the
sidebar by status bucket (Needs input, Failed, Ready to review, Working,
Done) or by project, chosen in the sidebar's view menu. Archived agents stay
hidden behind the view menu's Show section and read dimmed when revealed;
archiving is one-way.
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
assistant delta, reasoning delta, tool call, todo snapshot, error).

**Turn**:
A transcript row produced by folding timeline items: user, assistant,
reasoning, tool, todo, or error. Streaming deltas merge into the previous turn
of their kind; tool calls replace by call id. A tool turn carries both a
flattened summary and the daemon's structured detail; its row expands in place
to show that detail, with expansion state kept by the row itself. An edit turn's
expansion shows its patch as a diff. A reasoning turn stays collapsed until
opened: while deltas stream it reads "Thinking…", and once anything proves
thinking has stopped (the next appended item or the turn's end) its length is
sealed from the delta timestamps and the row reads "Thought for <duration>".
_Avoid_: message, item

**Sealed**:
The frozen duration of a finished reasoning block, measured first-delta to
last-delta; quiet gaps before the next item do not count as thinking.
_Avoid_: closed, ended

**Transcript**:
The ordered turns shown for one agent, including optimistic sends not yet
echoed by the daemon.

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
to send follow-up prompts to the active one.

**Workspace**:
A directory an agent can run in, listed by the daemon. A **worktree** is a git
worktree variant of one.
