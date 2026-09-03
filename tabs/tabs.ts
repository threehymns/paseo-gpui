/**
 * Workspace tab strip state.
 *
 * Opening a workspace lands on a tab strip instead of a single fixed view:
 * several agents from one workspace sit side by side as agent tabs, a draft
 * tab holds the composer and creates the agent only on first send. The
 * reducer is the whole decision — add, close, close-others, switch focus —
 * and the hook/component only translates app gestures and daemon results into
 * TabsEvents. Descriptors follow Paseo's own upstream shape (id, target,
 * createdAt, state) with the target union ahead of the current two targets so
 * later stages (setup, panes) can extend it without reshaping the reducer.
 */

/** A tab's kind. Read-only review targets and subagent/provider tabs are out
 *  of scope here; `setup` is anticipated by #47/#48 and holds no logic now. */
export type TabTarget = 'draft' | 'agent' | 'setup'

/** A draft tab's held folder picks: where a new agent would be created. */
export interface DraftTabState {
  cwd: string
  worktree: 'local' | 'worktree'
}

/** An agent tab: its conversation's owning agent. */
export interface AgentTabState {
  agentId: string
}

/** A setup tab (anticipated for #47): keyed by workspace, mirrors the daemon's
 *  workspace_setup progress feed. */
export interface SetupTabState {
  workspaceId: string
}

export type TabState = DraftTabState | AgentTabState | SetupTabState

export interface TabDescriptor {
  /** The tab's unique strip identity; not the same as a target's id. */
  id: string
  target: TabTarget
  createdAt: number
  state: TabState
}

export interface TabsState {
  /** Ordered left-to-right tabs; empty means the directory-level new task. */
  tabs: TabDescriptor[]
  /** The focused tab; null when there are no tabs (directory new-task state). */
  activeTabId: string | null
  /** Monotonic source of unique tab ids, so ids are deterministic and stable. */
  seq: number
}

export const initialTabs: TabsState = { tabs: [], activeTabId: null, seq: 0 }

/** The bare agent shape the reducer needs to build agent tabs from a workspace. */
export interface WorkspaceAgentInput {
  id: string
  createdAt: number
}

export type TabsEvent =
  /** New Task / directory-level reset: drop every tab. */
  | { type: 'reset' }
  /** Open a workspace: one agent tab per input (deduped), then a draft tab. */
  | { type: 'openWorkspace'; agents: WorkspaceAgentInput[]; cwd: string; now: number }
  /** Open/move focus to an agent, creating its tab when absent. */
  | { type: 'openAgent'; agentId: string; createdAt: number }
  /** Append a fresh draft tab. */
  | { type: 'openDraft'; cwd: string; now: number }
  /** A draft tab's first send created an agent: flip it to an agent tab. */
  | { type: 'draftSent'; tabId: string; agentId: string; createdAt: number }
  /** Toggle a draft tab's worktree choice (local directory vs new worktree). */
  | { type: 'setDraftWorktree'; tabId: string; worktree: 'local' | 'worktree' }
  /** Focus a tab. */
  | { type: 'select'; tabId: string }
  /** Close one tab; the focused-tab neighbor rule applies to avoid dead focus. */
  | { type: 'close'; tabId: string }
  /** Close every tab but one, focusing the survivor. */
  | { type: 'closeOthers'; tabId: string }

/** True when `state` describes an agent tab for `agentId`. */
function isAgentTab(tab: TabDescriptor, agentId: string): boolean {
  return tab.target === 'agent' && tab.state.agentId === agentId
}

/** Appends an agent tab; re-using an existing one for the same agent returns it unchanged. */
function upsertAgentTab(state: TabsState, agentId: string, createdAt: number): TabsState {
  const existing = state.tabs.find((tab) => isAgentTab(tab, agentId))
  if (existing) return state
  const id = `t${state.seq}`
  const tab: TabDescriptor = { id, target: 'agent', createdAt, state: { agentId } }
  return { tabs: [...state.tabs, tab], activeTabId: state.activeTabId, seq: state.seq + 1 }
}

/** Appends a draft tab and returns it (used by both openWorkspace and openDraft). */
function appendDraft(state: TabsState, cwd: string, now: number): TabsState {
  const id = `t${state.seq}`
  const tab: TabDescriptor = { id, target: 'draft', createdAt: now, state: { cwd, worktree: 'local' } }
  return { tabs: [...state.tabs, tab], activeTabId: state.activeTabId, seq: state.seq + 1 }
}

/**
 * Closing a tab focuses a deterministic neighbor, computed against the tabs
 * that remain: the tab just to the right of the closed slot when one exists
 * (the strip reads left-to-right), else the one to its left, else nothing —
 * the clean empty/new-task state.
 */
function neighborOnClose(remaining: TabDescriptor[], closedIndex: number): string | null {
  if (closedIndex < remaining.length) return remaining[closedIndex]!.id
  if (closedIndex - 1 >= 0) return remaining[closedIndex - 1]!.id
  return null
}

export function reduceTabs(state: TabsState, event: TabsEvent): TabsState {
  switch (event.type) {
    case 'reset':
      return initialTabs

    case 'openWorkspace': {
      // Newest agent tab first, so the workspace opens onto its most recent
      // work; existing agent tabs are reused in place (no duplication), and a
      // trailing draft tab always offers a way to start something new.
      const agents = [...event.agents].sort((a, b) => b.createdAt - a.createdAt)
      let next = state
      for (const agent of agents) next = upsertAgentTab(next, agent.id, agent.createdAt)
      if (next.tabs.some((tab) => tab.target === 'draft')) {
        return { ...next, activeTabId: next.tabs[0]?.id ?? next.activeTabId }
      }
      next = appendDraft(next, event.cwd, event.now)
      return { ...next, activeTabId: next.tabs[0]?.id ?? next.activeTabId }
    }

    case 'openAgent': {
      const next = upsertAgentTab(state, event.agentId, event.createdAt)
      const tab = next.tabs.find((candidate) => isAgentTab(candidate, event.agentId))
      return { ...next, activeTabId: tab?.id ?? next.activeTabId }
    }

    case 'openDraft': {
      const next = appendDraft(state, event.cwd, event.now)
      return { ...next, activeTabId: next.tabs.at(-1)!.id }
    }

    case 'draftSent': {
      const tab = state.tabs.find((candidate) => candidate.id === event.tabId)
      if (!tab || tab.target !== 'draft') return state
      const flipped: TabDescriptor = {
        ...tab,
        target: 'agent',
        state: { agentId: event.agentId },
      }
      return {
        tabs: state.tabs.map((candidate) => (candidate.id === event.tabId ? flipped : candidate)),
        activeTabId: event.tabId,
        seq: state.seq,
      }
    }

    case 'select': {
      const present = state.tabs.some((tab) => tab.id === event.tabId)
      return present && state.activeTabId !== event.tabId ? { ...state, activeTabId: event.tabId } : state
    }

    case 'setDraftWorktree': {
      const tab = state.tabs.find((candidate) => candidate.id === event.tabId)
      if (!tab || tab.target !== 'draft' || tab.state.worktree === event.worktree) return state
      const tabs = state.tabs.map((candidate) => {
        if (candidate.id !== event.tabId || candidate.target !== 'draft') return candidate
        return { ...candidate, state: { ...candidate.state, worktree: event.worktree } }
      })
      return { tabs, activeTabId: state.activeTabId, seq: state.seq }
    }

    case 'close': {
      const closedIndex = state.tabs.findIndex((tab) => tab.id === event.tabId)
      if (closedIndex < 0) return state
      const tabs = state.tabs.filter((tab) => tab.id !== event.tabId)
      const active = state.activeTabId === event.tabId ? neighborOnClose(tabs, closedIndex) : state.activeTabId
      return { tabs, activeTabId: active, seq: state.seq }
    }

    case 'closeOthers': {
      const survivor = state.tabs.find((tab) => tab.id === event.tabId)
      if (!survivor || state.tabs.length === 1) return state
      return { tabs: [survivor], activeTabId: survivor.id, seq: state.seq }
    }
  }
}

// ---- selectors --------------------------------------------------------------

export function selectTabs(state: TabsState): TabDescriptor[] {
  return state.tabs
}

export function selectTab(state: TabsState, tabId: string): TabDescriptor | null {
  return state.tabs.find((tab) => tab.id === tabId) ?? null
}

export function selectActiveTab(state: TabsState): TabDescriptor | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null
}

/** The active agent tab's agent id, or null for a draft/no active tab. */
export function selectActiveAgentId(state: TabsState): string | null {
  const tab = selectActiveTab(state)
  return tab && tab.target === 'agent' ? tab.state.agentId : null
}

/** The active tab, narrowed to a draft tab's state when it is a draft. */
export function selectActiveDraft(state: TabsState): DraftTabState | null {
  const tab = selectActiveTab(state)
  return tab && tab.target === 'draft' ? tab.state : null
}

/** Whether `agentId` already has an open agent tab. */
export function hasAgentTab(state: TabsState, agentId: string): boolean {
  return state.tabs.some((tab) => isAgentTab(tab, agentId))
}
