import { describe, expect, test } from 'bun:test'
import {
  hasAgentTab,
  initialTabs,
  reduceTabs,
  selectActiveAgentId,
  selectActiveTab,
  selectTab,
  selectTabs,
  type TabsEvent,
  type TabsState,
} from './tabs'

function run(events: TabsEvent[]): TabsState {
  return events.reduce(reduceTabs, initialTabs)
}

const at = (id: string, createdAt: number) => ({ id, createdAt })

describe('workspace tabs', () => {
  test('initial state has no tabs and no active tab', () => {
    expect(initialTabs.tabs).toEqual([])
    expect(initialTabs.activeTabId).toBe(null)
    expect(selectActiveTab(initialTabs)).toBe(null)
    expect(selectActiveAgentId(initialTabs)).toBe(null)
  })

  test('reset drops every tab back to the directory new-task state', () => {
    const state = run([
      { type: 'openWorkspace', agents: [], cwd: '/ws', now: 100 },
      { type: 'reset' },
    ])
    expect(state.tabs).toEqual([])
    expect(state.activeTabId).toBe(null)
  })

  test('opening a workspace with no agents yields one focused draft tab', () => {
    const state = run([{ type: 'openWorkspace', agents: [], cwd: '/ws', now: 5 }])
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]!.target).toBe('draft')
    expect(state.tabs[0]!.state).toEqual({ cwd: '/ws', worktree: 'local' })
    expect(state.activeTabId).toBe(state.tabs[0]!.id)
  })

  test('opening a workspace with N agents shows N agent tabs plus a draft tab', () => {
    const state = run([
      {
        type: 'openWorkspace',
        agents: [at('a2', 200), at('a1', 100), at('a3', 300)],
        cwd: '/ws',
        now: 400,
      },
    ])
    // Newest agent first, then the trailing draft.
    expect(state.tabs.map((tab) => tab.target)).toEqual(['agent', 'agent', 'agent', 'draft'])
    expect(state.tabs.map((tab) => tab.target === 'agent' && tab.state.agentId)).toEqual([
      'a3',
      'a2',
      'a1',
      false,
    ])
    // Opens onto the most recent agent.
    expect(selectActiveAgentId(state)).toBe('a3')
    expect(state.activeTabId).toBe(state.tabs[0]!.id)
  })

  test('re-opening a workspace reuses existing agent tabs without duplicating', () => {
    const open = { type: 'openWorkspace', agents: [at('a1', 100)], cwd: '/ws', now: 200 } as TabsEvent
    const once = run([open])
    const twice = run([open, open])
    expect(twice.tabs.filter((tab) => tab.target === 'agent')).toHaveLength(1)
    // The draft tab is not duplicated either.
    expect(twice.tabs.filter((tab) => tab.target === 'draft')).toHaveLength(1)
    expect(twice.activeTabId).toBe(selectTab(once, once.tabs[0]!.id)!.id)
  })

  test('openDraft appends a draft tab and focuses it', () => {
    const state = run([
      { type: 'openDraft', cwd: '/ws', now: 10 },
      { type: 'openDraft', cwd: '/ws', now: 20 },
    ])
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs.every((tab) => tab.target === 'draft')).toBe(true)
    expect(state.activeTabId).toBe(state.tabs[1]!.id)
    // Unique ids.
    expect(new Set(state.tabs.map((tab) => tab.id)).size).toBe(2)
  })

  test('setDraftWorktree toggles a draft tab worktree choice in place', () => {
    const state = run([
      { type: 'openDraft', cwd: '/ws', now: 10 },
      { type: 'setDraftWorktree', tabId: 't0', worktree: 'worktree' },
    ])
    expect(state.tabs[0]!.target).toBe('draft')
    expect(state.tabs[0]!.state).toEqual({ cwd: '/ws', worktree: 'worktree' })
    // Focus is untouched, and re-setting the same value is inert.
    expect(state.activeTabId).toBe('t0')
    const same = run([
      { type: 'openDraft', cwd: '/ws', now: 10 },
      { type: 'setDraftWorktree', tabId: 't0', worktree: 'worktree' },
      { type: 'setDraftWorktree', tabId: 't0', worktree: 'worktree' },
    ])
    expect(same.tabs[0]!.state).toEqual({ cwd: '/ws', worktree: 'worktree' })
  })

  test('setDraftWorktree is ignored for an unknown or non-draft tab', () => {
    const state = run([
      { type: 'openAgent', agentId: 'a1', createdAt: 1 },
      { type: 'setDraftWorktree', tabId: 't0', worktree: 'worktree' },
      { type: 'setDraftWorktree', tabId: 'nope', worktree: 'worktree' },
    ])
    expect(state.tabs[0]!.target).toBe('agent')
    expect(state.tabs[0]!.state).toEqual({ agentId: 'a1' })
  })

  test('openAgent focuses an existing agent tab instead of duplicating it', () => {
    const state = run([
      { type: 'openWorkspace', agents: [at('a1', 100), at('a2', 200)], cwd: '/ws', now: 300 },
      { type: 'openAgent', agentId: 'a1', createdAt: 100 },
    ])
    expect(state.tabs.filter((tab) => tab.target === 'agent')).toHaveLength(2)
    expect(selectActiveAgentId(state)).toBe('a1')
  })

  test('openAgent creates a brand-new agent tab when none exists for it', () => {
    const state = run([{ type: 'openAgent', agentId: 'x', createdAt: 5 }])
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]!.target).toBe('agent')
    expect(state.tabs[0]!.state).toEqual({ agentId: 'x' })
    expect(selectActiveAgentId(state)).toBe('x')
  })

  test('draftSent flips the draft tab into an agent tab in place and focuses it', () => {
    const state = run([
      { type: 'openDraft', cwd: '/ws', now: 10 },
      { type: 'draftSent', tabId: 't0', agentId: 'new-agent', createdAt: 11 },
    ])
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]!.target).toBe('agent')
    expect(state.tabs[0]!.state).toEqual({ agentId: 'new-agent' })
    // The id survives the flip, so the strip does not jump.
    expect(state.tabs[0]!.id).toBe('t0')
    expect(state.activeTabId).toBe('t0')
    expect(selectActiveAgentId(state)).toBe('new-agent')
  })

  test('draftSent is ignored for a non-draft tab or an unknown tab', () => {
    const state = run([
      { type: 'openAgent', agentId: 'a1', createdAt: 1 },
      { type: 'draftSent', tabId: 't0', agentId: 'x', createdAt: 2 },
    ])
    expect(state.tabs[0]!.target).toBe('agent')
    expect(state.tabs[0]!.state).toEqual({ agentId: 'a1' })
  })

  test('select focuses a present tab and is inert for an absent one', () => {
    const state = run([
      { type: 'openWorkspace', agents: [at('a1', 10), at('a2', 20)], cwd: '/ws', now: 30 },
    ])
    const second = state.tabs[1]!
    const selected = run([
      { type: 'openWorkspace', agents: [at('a1', 10), at('a2', 20)], cwd: '/ws', now: 30 },
      { type: 'select', tabId: second.id },
    ])
    expect(selected.activeTabId).toBe(second.id)
    const absent = run([
      { type: 'openWorkspace', agents: [at('a1', 10)], cwd: '/ws', now: 30 },
      { type: 'select', tabId: 'nope' },
    ])
    expect(absent.activeTabId).toBe(absent.tabs[0]!.id)
  })

  test('closing a non-active tab leaves the focus untouched', () => {
    const state = run([
      { type: 'openWorkspace', agents: [at('a1', 10), at('a2', 20)], cwd: '/ws', now: 30 },
    ])
    const second = state.tabs[1]!
    const closed = reduceTabs(state, { type: 'close', tabId: second.id })
    expect(closed.tabs).toHaveLength(2)
    expect(closed.activeTabId).toBe(state.activeTabId)
  })

  test('closing the focused tab focuses the right-hand neighbor', () => {
    const state = run([
      { type: 'openWorkspace', agents: [at('a1', 10), at('a2', 20)], cwd: '/ws', now: 30 },
    ])
    const active = state.tabs[0]! // a2 (newest)
    const after = reduceTabs(state, { type: 'close', tabId: active.id })
    expect(after.activeTabId).toBe(state.tabs[1]!.id)
  })

  test('closing the focused last tab falls back to the left-hand neighbor', () => {
    const opened = run([
      { type: 'openWorkspace', agents: [at('a1', 10), at('a2', 20)], cwd: '/ws', now: 30 },
    ])
    const last = opened.tabs.at(-1)!
    const state = run([
      { type: 'openWorkspace', agents: [at('a1', 10), at('a2', 20)], cwd: '/ws', now: 30 },
      { type: 'select', tabId: last.id },
    ])
    const after = reduceTabs(state, { type: 'close', tabId: last.id })
    expect(after.activeTabId).toBe(state.tabs[state.tabs.length - 2]!.id)
  })

  test('closing the last remaining tab leaves a sane empty/new-task state', () => {
    const state = run([{ type: 'openDraft', cwd: '/ws', now: 10 }])
    const after = reduceTabs(state, { type: 'close', tabId: state.tabs[0]!.id })
    expect(after.tabs).toEqual([])
    expect(after.activeTabId).toBe(null)
    expect(selectActiveAgentId(after)).toBe(null)
  })

  test('closeOthers keeps only the survivor and focuses it', () => {
    const state = run([
      { type: 'openWorkspace', agents: [at('a1', 10), at('a2', 20)], cwd: '/ws', now: 30 },
    ])
    const survivor = state.tabs[1]!
    const after = reduceTabs(state, { type: 'closeOthers', tabId: survivor.id })
    expect(after.tabs).toHaveLength(1)
    expect(after.tabs[0]!.id).toBe(survivor.id)
    expect(after.activeTabId).toBe(survivor.id)
  })

  test('closeOthers is inert for a single tab or an unknown survivor', () => {
    const one = run([{ type: 'openDraft', cwd: '/ws', now: 1 }])
    expect(reduceTabs(one, { type: 'closeOthers', tabId: one.tabs[0]!.id })).toBe(one)
    const multi = run([
      { type: 'openWorkspace', agents: [at('a1', 10), at('a2', 20)], cwd: '/ws', now: 30 },
    ])
    expect(reduceTabs(multi, { type: 'closeOthers', tabId: 'nope' })).toBe(multi)
  })

  test('hasAgentTab reports whether an agent already owns a tab', () => {
    const state = run([{ type: 'openAgent', agentId: 'a1', createdAt: 5 }])
    expect(hasAgentTab(state, 'a1')).toBe(true)
    expect(hasAgentTab(state, 'a2')).toBe(false)
  })

  test('ids are deterministic and unique across mixed operations', () => {
    const state = run([
      { type: 'openWorkspace', agents: [at('a1', 10)], cwd: '/ws', now: 20 },
      { type: 'openDraft', cwd: '/ws', now: 30 },
      { type: 'openAgent', agentId: 'b1', createdAt: 40 },
    ])
    // openWorkspace: [agent(a1), draft], then another draft, then an agent.
    expect(state.tabs.map((tab) => tab.id)).toEqual(['t0', 't1', 't2', 't3'])
    expect(state.tabs.map((tab) => tab.target)).toEqual(['agent', 'draft', 'draft', 'agent'])
  })

  test('openSetup appends a setup tab keyed by workspace and focuses it', () => {
    const state = run([{ type: 'openSetup', workspaceId: 'ws1', agentId: 'a1', createdAt: 10 }])
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]!.target).toBe('setup')
    expect(state.tabs[0]!.state).toEqual({ workspaceId: 'ws1', agentId: 'a1' })
    expect(state.activeTabId).toBe(state.tabs[0]!.id)
  })

  test('openSetup reuses an existing setup tab for the same workspace', () => {
    const state = run([
      { type: 'openSetup', workspaceId: 'ws1', agentId: 'a1', createdAt: 10 },
      { type: 'openSetup', workspaceId: 'ws1', agentId: 'a2', createdAt: 20 },
    ])
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]!.state.agentId).toBe('a1')
    expect(state.activeTabId).toBe(state.tabs[0]!.id)
  })

  test('openSetup opens distinct tabs for distinct workspaces', () => {
    const state = run([
      { type: 'openSetup', workspaceId: 'ws1', agentId: 'a1', createdAt: 10 },
      { type: 'openSetup', workspaceId: 'ws2', agentId: 'a2', createdAt: 20 },
    ])
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs.map((tab) => (tab.target === 'setup' && tab.state.workspaceId) || null)).toEqual([
      'ws1',
      'ws2',
    ])
    expect(state.activeTabId).toBe(state.tabs[1]!.id)
  })

  test('closing a setup tab follows the neighbor rule and setup tabs select cleanly', () => {
    const state = run([
      { type: 'openWorkspace', agents: [at('a1', 10)], cwd: '/ws', now: 20 },
      { type: 'openSetup', workspaceId: 'ws1', agentId: 'a1', createdAt: 30 },
    ])
    expect(state.tabs.map((tab) => tab.target)).toEqual(['agent', 'draft', 'setup'])
    const afterClose = reduceTabs(state, { type: 'close', tabId: state.tabs[2]!.id })
    expect(afterClose.tabs.map((tab) => tab.target)).toEqual(['agent', 'draft'])
    expect(afterClose.activeTabId).toBe(afterClose.tabs[1]!.id)
  })

  test('selectTabs and selectTab project the ordered list and single lookups', () => {
    const state = run([{ type: 'openWorkspace', agents: [at('a1', 10)], cwd: '/ws', now: 20 }])
    expect(selectTabs(state)).toHaveLength(2)
    expect(selectTab(state, state.tabs[0]!.id)).toBe(state.tabs[0])
    expect(selectTab(state, 'missing')).toBe(null)
  })
})
