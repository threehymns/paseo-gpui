import { describe, expect, test } from 'bun:test'
import {
  agentsOfWorkspace,
  applyWorkspaceUpdate,
  initialWorkspaceStore,
  isArchivedWorkspace,
  mostRecentAgent,
  projectName,
  sortWorkspaces,
  visibleWorkspaces,
  workspaceDirectoryChoices,
  workspaceDirectory,
  workspaceDisplayName,
  workspaceProjectGroups,
  type WorkspaceStore,
} from './workspaces'
import { relativeTimeAt, sortAgents, type AgentEntry, type EmptyProjectDescriptor, type WorkspaceDescriptor } from '../daemon/paseo'

function workspace(over: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    id: over.id ?? 'w1',
    projectId: over.projectId ?? 'p1',
    projectDisplayName: over.projectDisplayName ?? 'storefront',
    projectRootPath: over.projectRootPath ?? '/home/me/dev/storefront',
    projectKind: 'git',
    workspaceKind: 'directory',
    name: over.name ?? 'storefront',
    archivingAt: null,
    status: 'running',
    statusEnteredAt: null,
    activityAt: over.activityAt ?? '2026-08-24T10:00:00Z',
    scripts: [],
    ...over,
  } as WorkspaceDescriptor
}

function emptyProject(over: Partial<EmptyProjectDescriptor>): EmptyProjectDescriptor {
  return {
    projectId: over.projectId ?? 'p1',
    projectDisplayName: over.projectDisplayName ?? 'storefront',
    projectRootPath: over.projectRootPath ?? '/home/me/dev/storefront',
    projectKind: 'git',
    ...over,
  } as EmptyProjectDescriptor
}

const upsert = (descriptor: WorkspaceDescriptor) => ({ kind: 'upsert' as const, workspace: descriptor })

describe('applyWorkspaceUpdate', () => {
  test('upserts add and replace by id, keeping recency order', () => {
    let store: WorkspaceStore = initialWorkspaceStore
    store = applyWorkspaceUpdate(store, upsert(workspace({ id: 'a', activityAt: '2026-08-24T10:00:00Z' })))
    store = applyWorkspaceUpdate(store, upsert(workspace({ id: 'b', activityAt: '2026-08-24T11:00:00Z' })))
    store = applyWorkspaceUpdate(store, upsert(workspace({ id: 'a', activityAt: '2026-08-24T12:00:00Z' })))
    expect(store.workspaces.map((w) => w.id)).toEqual(['a', 'b'])
  })

  test('an upsert pulls its project out of the emptied list', () => {
    const store = applyWorkspaceUpdate(
      { workspaces: [], emptyProjects: [emptyProject({ projectId: 'p1' })] },
      upsert(workspace({ projectId: 'p1' })),
    )
    expect(store.emptyProjects).toEqual([])
  })

  test('removes drop the workspace by id', () => {
    const store = applyWorkspaceUpdate(
      { workspaces: [workspace({ id: 'a' }), workspace({ id: 'b' })], emptyProjects: [] },
      { kind: 'remove', id: 'a' },
    )
    expect(store.workspaces.map((w) => w.id)).toEqual(['b'])
    expect(store.emptyProjects).toEqual([])
  })

  test('a remove carrying emptyProject keeps the project rendered with no rows', () => {
    const after = emptyProject({ projectId: 'p1', projectDisplayName: 'storefront' })
    const store = applyWorkspaceUpdate(
      { workspaces: [workspace({ id: 'a', projectId: 'p1' })], emptyProjects: [] },
      { kind: 'remove', id: 'a', emptyProject: after },
    )
    expect(store.workspaces).toEqual([])
    expect(store.emptyProjects.map((p) => p.projectId)).toEqual(['p1'])
  })

  test('emptied projects are keyed by project id, not duplicated', () => {
    const first = emptyProject({ projectId: 'p1', projectDisplayName: 'Old name' })
    const second = emptyProject({ projectId: 'p1', projectDisplayName: 'New name' })
    let store: WorkspaceStore = { workspaces: [], emptyProjects: [first] }
    store = applyWorkspaceUpdate(store, { kind: 'remove', id: 'gone', emptyProject: second })
    expect(store.emptyProjects).toHaveLength(1)
    expect(store.emptyProjects[0]!.projectDisplayName).toBe('New name')
  })

  test('a remove carrying removedProjectId erases the project and its remaining workspaces', () => {
    const store = applyWorkspaceUpdate(
      {
        workspaces: [workspace({ id: 'a', projectId: 'p1' }), workspace({ id: 'b', projectId: 'p2' })],
        emptyProjects: [emptyProject({ projectId: 'p1' }), emptyProject({ projectId: 'p9' })],
      },
      { kind: 'remove', id: 'a', removedProjectId: 'p1' },
    )
    // The explicit remove for 'a' already dropped it; the project sweep takes
    // care of any siblings whose own removes have not arrived yet.
    expect(store.workspaces.map((w) => w.id)).toEqual(['b'])
    expect(store.emptyProjects.map((p) => p.projectId)).toEqual(['p9'])
  })

  test('removes without project aftermath leave the emptied list untouched', () => {
    const emptied = emptyProject({ projectId: 'p7' })
    const store = applyWorkspaceUpdate(
      { workspaces: [workspace({ id: 'a' })], emptyProjects: [emptied] },
      { kind: 'remove', id: 'a' },
    )
    expect(store.workspaces).toEqual([])
    expect(store.emptyProjects).toEqual([emptied])
  })
})

describe('sortWorkspaces', () => {
  test('orders by most recent activity', () => {
    const sorted = sortWorkspaces([
      workspace({ id: 'old', activityAt: '2026-08-24T09:00:00Z' }),
      workspace({ id: 'new', activityAt: '2026-08-24T11:00:00Z' }),
    ])
    expect(sorted.map((w) => w.id)).toEqual(['new', 'old'])
  })

  test('pinned workspaces lead, most recently pinned first', () => {
    const sorted = sortWorkspaces([
      workspace({ id: 'plain-new', activityAt: '2026-08-24T12:00:00Z' }),
      workspace({ id: 'pin-old', pinnedAt: '2026-08-24T08:00:00Z' }),
      workspace({ id: 'pin-new', pinnedAt: '2026-08-24T10:00:00Z' }),
    ])
    expect(sorted.map((w) => w.id)).toEqual(['pin-new', 'pin-old', 'plain-new'])
  })

  test('descriptors without activity sink to the bottom', () => {
    const sorted = sortWorkspaces([
      workspace({ id: 'quiet', activityAt: null }),
      workspace({ id: 'busy', activityAt: '2026-08-24T10:00:00Z' }),
    ])
    expect(sorted.map((w) => w.id)).toEqual(['busy', 'quiet'])
  })

  test('sorting never mutates the input', () => {
    const list = [workspace({ id: 'a', activityAt: '2026-08-24T09:00:00Z' }), workspace({ id: 'b' })]
    sortWorkspaces(list)
    expect(list.map((w) => w.id)).toEqual(['a', 'b'])
  })
})

describe('view-model mapping', () => {
  test('workspaceDirectory prefers the workspace directory over the project root', () => {
    expect(workspaceDirectory(workspace({ workspaceDirectory: '/home/me/dev/storefront-wt' }))).toBe(
      '/home/me/dev/storefront-wt',
    )
    expect(workspaceDirectory(workspace({}))).toBe('/home/me/dev/storefront')
  })

  test('displayName uses the title override when set, else the name', () => {
    expect(workspaceDisplayName(workspace({ title: 'Fix login flow' }))).toBe('Fix login flow')
    expect(workspaceDisplayName(workspace({ title: '   ' }))).toBe('storefront')
    expect(workspaceDisplayName(workspace({ title: null }))).toBe('storefront')
  })

  test('projectName prefers a custom project name', () => {
    expect(projectName(workspace({ projectCustomName: 'My Shop' }))).toBe('My Shop')
    expect(projectName(workspace({ projectCustomName: null }))).toBe('storefront')
  })

  test('archiving is one-way and visibility follows the reveal toggle', () => {
    const list = [
      workspace({ id: 'live' }),
      workspace({ id: 'gone', archivingAt: '2026-08-24T09:00:00Z' }),
    ]
    expect(isArchivedWorkspace(list[1]!)).toBe(true)
    expect(visibleWorkspaces(list, false).map((w) => w.id)).toEqual(['live'])
    expect(visibleWorkspaces(list, true).map((w) => w.id)).toEqual(['live', 'gone'])
  })
})

describe('workspaceProjectGroups', () => {
  test('groups by project, most recently active project first, rows recency-sorted', () => {
    const store: WorkspaceStore = {
      workspaces: [
        workspace({ id: 'store-main', projectId: 'p-store', projectDisplayName: 'storefront', activityAt: '2026-08-24T10:00:00Z' }),
        workspace({
          id: 'api-main',
          projectId: 'p-api',
          projectDisplayName: 'api',
          projectRootPath: '/home/me/dev/api',
          activityAt: '2026-08-24T11:30:00Z',
        }),
        workspace({ id: 'store-wt', projectId: 'p-store', projectDisplayName: 'storefront', activityAt: '2026-08-24T09:00:00Z' }),
      ],
      emptyProjects: [],
    }
    const groups = workspaceProjectGroups(store, false)
    expect(groups.map((group) => group.projectId)).toEqual(['p-api', 'p-store'])
    expect(groups[1]!.workspaces.map((w) => w.id)).toEqual(['store-main', 'store-wt'])
    expect(groups[1]!.name).toBe('storefront')
    expect(groups[1]!.rootPath).toBe('/home/me/dev/storefront')
  })

  test('projects with no workspaces still render, trailing in name order', () => {
    const store: WorkspaceStore = {
      workspaces: [workspace({ id: 'zeta-ws', projectId: 'p-zeta', projectDisplayName: 'zeta' })],
      emptyProjects: [
        emptyProject({ projectId: 'p-alpha', projectDisplayName: 'alpha' }),
        emptyProject({ projectId: 'p-mid', projectDisplayName: 'mid' }),
      ],
    }
    const groups = workspaceProjectGroups(store, false)
    expect(groups.map((group) => group.name)).toEqual(['zeta', 'alpha', 'mid'])
    expect(groups[1]!.workspaces).toEqual([])
  })

  test('archived rows stay hidden until revealed; an all-archived project disappears', () => {
    const store: WorkspaceStore = {
      workspaces: [
        workspace({ id: 'live', projectId: 'p-live', projectDisplayName: 'live', activityAt: '2026-08-24T10:00:00Z' }),
        workspace({
          id: 'gone',
          projectId: 'p-gone',
          projectDisplayName: 'gone',
          archivingAt: '2026-08-24T09:00:00Z',
          activityAt: '2026-08-24T09:00:00Z',
        }),
      ],
      emptyProjects: [],
    }
    expect(workspaceProjectGroups(store, false).map((group) => group.name)).toEqual(['live'])
    const revealed = workspaceProjectGroups(store, true)
    expect(revealed.map((group) => group.name)).toEqual(['live', 'gone'])
    expect(revealed[1]!.workspaces.map((w) => w.id)).toEqual(['gone'])
  })

  test('group names honor a custom project name on any descriptor', () => {
    const store: WorkspaceStore = {
      workspaces: [workspace({ projectCustomName: 'Checkout Flow' })],
      emptyProjects: [],
    }
    expect(workspaceProjectGroups(store, false)[0]!.name).toBe('Checkout Flow')
  })
})

describe('workspaceDirectoryChoices', () => {
  test('collects workspace directories and emptied project roots, deduplicated', () => {
    const store: WorkspaceStore = {
      workspaces: [
        workspace({ id: 'a', workspaceDirectory: '/home/me/dev/storefront' }),
        workspace({ id: 'b', projectRootPath: '/home/me/dev/api', workspaceDirectory: '/home/me/dev/api' }),
        workspace({ id: 'c', workspaceDirectory: undefined, projectRootPath: '/home/me/dev/storefront' }),
      ],
      emptyProjects: [emptyProject({ projectId: 'p9', projectRootPath: '/home/me/dev/api' })],
    }
    expect(workspaceDirectoryChoices(store)).toEqual([
      '/home/me/dev/storefront',
      '/home/me/dev/api',
    ])
  })

  test('an empty store offers no directories', () => {
    expect(workspaceDirectoryChoices(initialWorkspaceStore)).toEqual([])
  })
})

describe('opening a workspace', () => {
  const descriptor = workspace({ id: 'w1', workspaceDirectory: '/home/me/dev/storefront-wt' })

  const agent = (over: Partial<AgentEntry>): AgentEntry =>
    ({
      id: over.id ?? 'a1',
      cwd: over.cwd ?? '/home/me/dev/storefront-wt',
      updatedAt: over.updatedAt ?? '2026-08-24T10:00:00Z',
      lastUserMessageAt: null,
      ...over,
    }) as AgentEntry

  test('agents match by workspaceId, falling back to their working directory', () => {
    const agents = [
      agent({ id: 'linked', workspaceId: 'w1', cwd: '/elsewhere' }),
      agent({ id: 'legacy' }),
      agent({ id: 'other-workspace', workspaceId: 'w2', cwd: '/another/project' }),
      agent({ id: 'unrelated', cwd: '/somewhere/else' }),
    ]
    expect(agentsOfWorkspace(agents, descriptor).map((entry) => entry.id)).toEqual(['linked', 'legacy'])
  })

  test('the shown timeline is the workspace’s most recently active agent', () => {
    const agents = [
      agent({ id: 'older', updatedAt: '2026-08-24T09:00:00Z' }),
      agent({ id: 'newer', updatedAt: '2026-08-24T11:00:00Z' }),
    ]
    expect(mostRecentAgent(agents)?.id).toBe('newer')
    expect(mostRecentAgent([])).toBeNull()
    expect(mostRecentAgent([agent({ id: 'only' })])?.id).toBe('only')
  })

  test('mostRecentAgent agrees with the directory ordering', () => {
    const agents = [
      agent({ id: 'b', lastUserMessageAt: '2026-08-24T12:00:00Z' }),
      agent({ id: 'a', updatedAt: '2026-08-24T13:00:00Z' }),
    ]
    expect(mostRecentAgent(agents)?.id).toBe(sortAgents(agents)[0]!.id)
  })
})

describe('relativeTimeAt', () => {
  test('produces known shapes', () => {
    expect(relativeTimeAt(Date.now())).toMatch(/^now|\d+[mhd]|\w{3} \d{1,2}$/)
  })
})
