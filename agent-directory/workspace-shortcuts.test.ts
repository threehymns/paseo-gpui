import { describe, expect, test } from 'bun:test'
import { applyWorkspaceUpdate, initialWorkspaceStore, workspaceProjectGroups, workspaceStatusGroups, type WorkspaceStore } from './workspaces'
import type { WorkspaceDescriptor } from '../daemon/paseo'
import { workspace } from './test-support'
import { EMPTY_FILTERS, type WorkspaceFilters } from './display-preferences'
import {
  isJumpShortcut,
  isNextWorkspace,
  isPrevWorkspace,
  moveWorkspace,
  prevNextWorkspaceTarget,
  visibleWorkspaceIds,
  type WalkSection,
} from './workspace-shortcuts'

function storeWith(...descriptors: WorkspaceDescriptor[]): WorkspaceStore {
  let store: WorkspaceStore = initialWorkspaceStore
  for (const descriptor of descriptors) {
    store = applyWorkspaceUpdate(store, { kind: 'upsert', workspace: descriptor })
  }
  return store
}

function section(key: string, ...rows: string[]): WalkSection {
  return { key, name: key, workspaces: rows.map((id) => ({ id })) }
}

describe('visibleWorkspaceIds', () => {
  test('walks sections in order, skipping collapsed ones', () => {
    const sections = [section('p1', 'a', 'b'), section('p2', 'c'), section('p3', 'd', 'e')]
    expect(visibleWorkspaceIds(sections, new Set())).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(visibleWorkspaceIds(sections, new Set(['p2']))).toEqual(['a', 'b', 'd', 'e'])
    expect(visibleWorkspaceIds(sections, new Set(['p1', 'p3']))).toEqual(['c'])
    expect(visibleWorkspaceIds(sections, new Set(['p1', 'p2', 'p3']))).toEqual([])
  })

  test('collapsed keys that match no section are ignored', () => {
    expect(visibleWorkspaceIds([section('a', 'x')], new Set(['nope']))).toEqual(['x'])
  })

  test('empty sections contribute nothing', () => {
    expect(visibleWorkspaceIds([section('a'), section('b', 'x')], new Set())).toEqual(['x'])
  })
})

describe('visibleWorkspaceIds over sidebar-shaped sections', () => {
  const ws = storeWith(
    workspace({ id: 'a', projectId: 'p1', status: 'running', activityAt: '2026-08-24T10:00:00Z' }),
    workspace({ id: 'b', projectId: 'p1', status: 'failed', pinnedAt: '2026-08-24T09:00:00Z', activityAt: '2026-08-24T11:00:00Z' }),
    workspace({ id: 'c', projectId: 'p2', status: 'done', activityAt: '2026-08-24T12:00:00Z' }),
  )
  const filters: WorkspaceFilters = EMPTY_FILTERS

  // The Sidebar builds its sections the same way (project or status grouping),
  // so these compose the group ordering + filters into the walk-order seam.
  const projectSections = (store: WorkspaceStore, f: WorkspaceFilters): WalkSection[] =>
    workspaceProjectGroups(store, false, f).map((group) => ({
      key: group.projectId,
      name: group.name,
      workspaces: group.workspaces,
    }))
  const statusSections = (store: WorkspaceStore, f: WorkspaceFilters): WalkSection[] =>
    workspaceStatusGroups(store, false, f).map((group) => ({
      key: group.status,
      name: group.label,
      workspaces: group.workspaces,
    }))

  test('project grouping places pinned rows first within their section', () => {
    // p2 (c, 12:00) is the most-active project so walks first; inside p1, b is
    // pinned ahead of a.
    expect(visibleWorkspaceIds(projectSections(ws, filters), new Set())).toEqual(['c', 'b', 'a'])
  })

  test('collapsing a project drops its rows from the walk order', () => {
    expect(visibleWorkspaceIds(projectSections(ws, filters), new Set(['p1']))).toEqual(['c'])
  })

  test('status grouping orders by urgency', () => {
    // failed(b) before running(a) before done(c).
    expect(visibleWorkspaceIds(statusSections(ws, filters), new Set())).toEqual(['b', 'a', 'c'])
  })

  test('a collapsed status group drops its rows', () => {
    // 'failed' bucket holds only b.
    expect(visibleWorkspaceIds(statusSections(ws, filters), new Set(['failed']))).toEqual(['a', 'c'])
  })

  test('filters narrow the walk order in project mode from the sidebar inputs', () => {
    const projectFilter: WorkspaceFilters = { hosts: [], projects: ['p2'], labels: [] }
    expect(visibleWorkspaceIds(projectSections(ws, projectFilter), new Set())).toEqual(['c'])
  })

  test('all groups filtered out yields an empty order', () => {
    const emptyFilter: WorkspaceFilters = { hosts: [], projects: ['nope'], labels: [] }
    expect(visibleWorkspaceIds(projectSections(ws, emptyFilter), new Set())).toEqual([])
  })
})

describe('jump shortcut predicate', () => {
  const event = (overrides: {
    key?: string
    modifiers?: Partial<{ shift: boolean; ctrl: boolean; alt: boolean; cmd: boolean }>
  }) => ({ eventType: 'keyDown', ...overrides })

  test('matches ⌘1–9 and Ctrl+1–9', () => {
    expect(isJumpShortcut(event({ key: '1', modifiers: { cmd: true } }))).toBe(1)
    expect(isJumpShortcut(event({ key: '9', modifiers: { ctrl: true } }))).toBe(9)
    expect(isJumpShortcut(event({ key: '5', modifiers: { cmd: true } }))).toBe(5)
  })

  test('rejects zero, letters, and digits beyond nine', () => {
    expect(isJumpShortcut(event({ key: '0', modifiers: { cmd: true } }))).toBeNull()
    expect(isJumpShortcut(event({ key: 'k', modifiers: { cmd: true } }))).toBeNull()
  })

  test('requires cmd or ctrl and forbids alt/show, alt, and combined mods', () => {
    expect(isJumpShortcut(event({ key: '1' }))).toBeNull()
    expect(isJumpShortcut(event({ key: '1', modifiers: { alt: true, cmd: true } }))).toBeNull()
    expect(isJumpShortcut(event({ key: '1', modifiers: { shift: true, cmd: true } }))).toBeNull()
  })
})

describe('prev/next workspace predicates', () => {
  const event = (overrides: {
    key?: string
    modifiers?: Partial<{ shift: boolean; ctrl: boolean; alt: boolean; cmd: boolean }>
  }) => ({ eventType: 'keyDown', ...overrides })

  test('matches ⌘[ and Ctrl+[ for prev', () => {
    expect(isPrevWorkspace(event({ key: '[', modifiers: { cmd: true } }))).toBe(true)
    expect(isPrevWorkspace(event({ key: '[', modifiers: { ctrl: true } }))).toBe(true)
  })

  test('matches ⌘] and Ctrl+] for next', () => {
    expect(isNextWorkspace(event({ key: ']', modifiers: { cmd: true } }))).toBe(true)
    expect(isNextWorkspace(event({ key: ']', modifiers: { ctrl: true } }))).toBe(true)
  })

  test('requires the right key and forbids alt/shift', () => {
    expect(isPrevWorkspace(event({ key: ']', modifiers: { cmd: true } }))).toBe(false)
    expect(isNextWorkspace(event({ key: '[', modifiers: { cmd: true } }))).toBe(false)
    expect(isPrevWorkspace(event({ key: '[', modifiers: { alt: true, cmd: true } }))).toBe(false)
    expect(isPrevWorkspace(event({ key: '[', modifiers: { shift: true, cmd: true } }))).toBe(false)
  })
})

describe('moveWorkspace', () => {
  test('wraps around both ends', () => {
    expect(moveWorkspace(0, 3, -1)).toBe(2)
    expect(moveWorkspace(2, 3, 1)).toBe(0)
    expect(moveWorkspace(1, 3, 1)).toBe(2)
    expect(moveWorkspace(1, 3, -1)).toBe(0)
  })

  test('handles multi-step and empty lists', () => {
    expect(moveWorkspace(0, 3, 4)).toBe(1)
    expect(moveWorkspace(0, 0, 1)).toBe(-1)
  })
})

describe('prevNextWorkspaceTarget', () => {
  const order = ['a', 'b', 'c']

  test('wraps at both ends from a current selection', () => {
    expect(prevNextWorkspaceTarget(order, 'c', 1)).toBe(0)
    expect(prevNextWorkspaceTarget(order, 'a', -1)).toBe(2)
    expect(prevNextWorkspaceTarget(order, 'b', 1)).toBe(2)
    expect(prevNextWorkspaceTarget(order, 'b', -1)).toBe(0)
  })

  test('no selection starts at the top forward and bottom backward', () => {
    expect(prevNextWorkspaceTarget(order, null, 1)).toBe(0)
    expect(prevNextWorkspaceTarget(order, null, -1)).toBe(2)
  })

  test('a selection filtered out of the visible order counts as no selection', () => {
    expect(prevNextWorkspaceTarget(order, 'zz', 1)).toBe(0)
    expect(prevNextWorkspaceTarget(order, 'zz', -1)).toBe(2)
  })

  test('nothing visible yields -1', () => {
    expect(prevNextWorkspaceTarget([], null, 1)).toBe(-1)
  })
})
