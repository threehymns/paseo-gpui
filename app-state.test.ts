import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createAppStore,
  directoryGrouping,
  fileStateStorage,
  memoryStorage,
  showArchivedAgents,
  showArchivedWorkspaces,
  workspaceFilters,
  workspaceMetaConfig,
  workspacePanes,
} from './app-state'
import type { PaneLayout } from './layout/layout'

describe('app-state store', () => {
  test('first run yields defaults when nothing is stored', () => {
    const store = createAppStore(memoryStorage())
    expect(store.get(directoryGrouping)).toBe('status')
    expect(store.get(showArchivedWorkspaces)).toBe(false)
  })

  test('a written value reads back until overwritten', () => {
    const store = createAppStore(memoryStorage())
    store.set(directoryGrouping, 'project')
    expect(store.get(directoryGrouping)).toBe('project')
    store.set(directoryGrouping, 'status')
    expect(store.get(directoryGrouping)).toBe('status')
    store.set(showArchivedWorkspaces, true)
    expect(store.get(showArchivedWorkspaces)).toBe(true)
  })

  test('stale values from older versions fall back to defaults', () => {
    const stale = {
      readAll: () => ({
        'directory.grouping': 'alphabetical',
        'directory.showArchived': 'yes',
        'removed.preference': { nested: true },
      }),
      writeAll: () => {},
    }
    const store = createAppStore(stale)
    expect(store.get(directoryGrouping)).toBe('status')
    expect(store.get(showArchivedWorkspaces)).toBe(false)
  })

  test('choices survive a restart: a fresh store over the same storage reads them', () => {
    const storage = memoryStorage()
    createAppStore(storage).set(directoryGrouping, 'project')
    const reopened = createAppStore(storage)
    expect(reopened.get(directoryGrouping)).toBe('project')
  })

  test('the meta config and filters persist and read back their full shape', () => {
    const storage = memoryStorage()
    const meta = {
      slots: { branch: false, project: true, host: false, pullRequest: true, services: false, labels: true },
      checksMode: 'iconOnly' as const,
      trailing: 'activity' as const,
      titleSource: 'branch' as const,
    }
    const filters = { hosts: ['devbox'], projects: ['p1'], labels: ['bug', '*unlabelled*'] }
    const store = createAppStore(storage)
    store.set(workspaceMetaConfig, meta)
    store.set(workspaceFilters, filters)
    const reopened = createAppStore(storage)
    expect(reopened.get(workspaceMetaConfig)).toEqual(meta)
    expect(reopened.get(workspaceFilters)).toEqual(filters)
  })

  test('a stale meta config or filter shape falls back to defaults', () => {
    const stale = {
      readAll: () => ({
        'workspace.meta': { slots: { branch: 'yes' }, checksMode: 'weird', trailing: 'diffStat', titleSource: 'title' },
        'workspace.filters': { hosts: 'devbox', projects: {}, labels: [1] },
      }),
      writeAll: () => {},
    }
    const store = createAppStore(stale)
    expect(store.get(workspaceMetaConfig)).toEqual(workspaceMetaConfig.fallback)
    expect(store.get(workspaceFilters)).toEqual(workspaceFilters.fallback)
  })
})

describe('pane layout persistence', () => {
  const wsKey = (host: string, ws: string) => `${host}::${ws}`

  test('defaults to an empty map on first run', () => {
    const store = createAppStore(memoryStorage())
    expect(store.get(workspacePanes)).toEqual({})
  })

  test('a pane layout persists and reads back its full shape', () => {
    const storage = memoryStorage()
    const layout: PaneLayout = {
      root: {
        kind: 'group',
        id: 'g0',
        direction: 'horizontal',
        children: [
          { kind: 'leaf', id: 'p0', tabIds: ['t0', 't1'], focusedTabId: 't1' },
          { kind: 'leaf', id: 'p1', tabIds: ['t2'], focusedTabId: 't2' },
        ],
        sizes: [0.6, 0.4],
      },
      activePaneId: 'p1',
    }
    const store = createAppStore(storage)
    store.set(workspacePanes, { [wsKey('devbox', 'ws1')]: layout })
    const reopened = createAppStore(storage)
    expect(reopened.get(workspacePanes)).toEqual({ [wsKey('devbox', 'ws1')]: layout })
  })

  test('layouts keyed by host+workspace are stored independently', () => {
    const storage = memoryStorage()
    const store = createAppStore(storage)
    const a: PaneLayout = { root: { kind: 'leaf', id: 'p0', tabIds: ['t0'], focusedTabId: 't0' }, activePaneId: 'p0' }
    const b: PaneLayout = {
      root: {
        kind: 'group',
        id: 'g0',
        direction: 'vertical',
        children: [
          { kind: 'leaf', id: 'p0', tabIds: ['t5'], focusedTabId: 't5' },
          { kind: 'leaf', id: 'p1', tabIds: ['t6'], focusedTabId: 't6' },
        ],
        sizes: [0.5, 0.5],
      },
      activePaneId: 'p1',
    }
    store.set(workspacePanes, {
      [wsKey('devbox', 'ws1')]: a,
      [wsKey('devbox', 'ws2')]: b,
      [wsKey('prod', 'ws1')]: b,
    })
    const reopened = createAppStore(storage)
    const map = reopened.get(workspacePanes)
    expect(map[wsKey('devbox', 'ws1')]).toEqual(a)
    expect(map[wsKey('devbox', 'ws2')]).toEqual(b)
    expect(map[wsKey('prod', 'ws1')]).toEqual(b)
  })

  test('a stale or malformed layout falls back to the empty map', () => {
    const stale = {
      readAll: () => ({
        'layout.panes': {
          'devbox::ws1': { root: { kind: 'leaf', id: 'p0', tabIds: [1], focusedTabId: 't0' }, activePaneId: 'nope' },
        },
      }),
      writeAll: () => {},
    }
    const store = createAppStore(stale)
    expect(store.get(workspacePanes)).toEqual({})
  })

  test('a group is rejected when its sizes do not match its children', () => {
    const stale = {
      readAll: () => ({
        'layout.panes': {
          'devbox::ws1': {
            root: {
              kind: 'group',
              id: 'g0',
              direction: 'horizontal',
              children: [
                { kind: 'leaf', id: 'p0', tabIds: [], focusedTabId: null },
                { kind: 'leaf', id: 'p1', tabIds: [], focusedTabId: null },
              ],
              sizes: [0.5],
            },
            activePaneId: 'p0',
          },
        },
      }),
      writeAll: () => {},
    }
    const store = createAppStore(stale)
    expect(store.get(workspacePanes)).toEqual({})
  })

  test('persisted layouts survive a restart over a shared in-memory storage', () => {
    const storage = memoryStorage()
    const layout: PaneLayout = {
      root: {
        kind: 'group',
        id: 'g0',
        direction: 'horizontal',
        children: [
          { kind: 'leaf', id: 'p0', tabIds: ['t0'], focusedTabId: 't0' },
          { kind: 'leaf', id: 'p1', tabIds: ['t1'], focusedTabId: 't1' },
        ],
        sizes: [0.5, 0.5],
      },
      activePaneId: 'p0',
    }
    createAppStore(storage).set(workspacePanes, { [wsKey('devbox', 'ws1')]: layout })
    const reopened = createAppStore(storage)
    expect(reopened.get(workspacePanes)[wsKey('devbox', 'ws1')]).toEqual(layout)
  })
})

describe('file-backed storage', () => {
  let dir: string
  const statePath = (name: string) => path.join(dir, name)

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'app-state-test-'))
  })

  test('a written file reads back in a fresh store, as a restart would', () => {
    const file = statePath('state.json')
    createAppStore(fileStateStorage(file)).set(showArchivedWorkspaces, true)
    expect(createAppStore(fileStateStorage(file)).get(showArchivedWorkspaces)).toBe(true)
  })

  test('a missing file means first run', () => {
    const store = createAppStore(fileStateStorage(statePath('never-written.json')))
    expect(store.get(directoryGrouping)).toBe('status')
    expect(store.get(showArchivedWorkspaces)).toBe(false)
  })

  test('an unreadable or non-object file falls back to defaults', () => {
    for (const contents of ['{not json', '"just a string"', '[1, 2]', 'null']) {
      const file = statePath(`corrupt-${contents.length}-${contents.charCodeAt(1)}.json`)
      writeFileSync(file, contents)
      const store = createAppStore(fileStateStorage(file))
      expect(store.get(directoryGrouping)).toBe('status')
      expect(store.get(showArchivedWorkspaces)).toBe(false)
    }
  })

  test('writing into a missing directory creates it', () => {
    const file = statePath('nested' + path.sep + 'deeper' + path.sep + 'state.json')
    createAppStore(fileStateStorage(file)).set(directoryGrouping, 'project')
    expect(createAppStore(fileStateStorage(file)).get(directoryGrouping)).toBe('project')
  })

  test('a failed write leaves the last persisted file usable', () => {
    const good = createAppStore(fileStateStorage(statePath('good.json')))
    good.set(directoryGrouping, 'project')

    // A directory sitting where the file belongs makes every write fail.
    mkdirSync(statePath('blocked.json'))
    const blocked = createAppStore(fileStateStorage(statePath('blocked.json')))
    blocked.set(showArchivedWorkspaces, true)
    expect(blocked.get(showArchivedWorkspaces)).toBe(true)

    const reopened = createAppStore(fileStateStorage(statePath('good.json')))
    expect(reopened.get(directoryGrouping)).toBe('project')
    expect(reopened.get(showArchivedWorkspaces)).toBe(false)
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
})
