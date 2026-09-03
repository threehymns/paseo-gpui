import { describe, expect, test } from 'bun:test'
import {
  WORKSPACE_STATUS_URGENCY,
  aggregateWorkspaceStatus,
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
  workspaceStatusGroups,
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

describe('aggregateWorkspaceStatus', () => {
  // The ticket's ordering string names a "working" bucket, but the workspace
  // descriptor's vocabulary is running | attention | needs_input | failed |
  // done — the urgency order below is defined over that vocabulary alone.
  test('the urgency order is the descriptor vocabulary, needs_input first', () => {
    expect(WORKSPACE_STATUS_URGENCY).toEqual(['needs_input', 'failed', 'running', 'attention', 'done'])
  })

  test('a single workspace aggregates to its own status', () => {
    expect(aggregateWorkspaceStatus([workspace({ status: 'attention' })])).toEqual({
      status: 'attention',
      count: 1,
    })
    expect(aggregateWorkspaceStatus([workspace({ status: 'done' })])).toEqual({ status: 'done', count: 1 })
  })

  test('an empty project aggregates to nothing', () => {
    expect(aggregateWorkspaceStatus([])).toBeNull()
  })

  test('the most urgent bucket wins across mixed statuses', () => {
    const mixed = [
      workspace({ id: 'a', status: 'done' }),
      workspace({ id: 'b', status: 'running' }),
      workspace({ id: 'c', status: 'needs_input' }),
      workspace({ id: 'd', status: 'attention' }),
      workspace({ id: 'e', status: 'failed' }),
    ]
    expect(aggregateWorkspaceStatus(mixed)).toEqual({ status: 'needs_input', count: 1 })
  })

  test('each adjacent pair of the order resolves toward the more urgent', () => {
    expect(aggregateWorkspaceStatus([
      workspace({ id: 'a', status: 'failed' }),
      workspace({ id: 'b', status: 'needs_input' }),
    ])).toMatchObject({ status: 'needs_input' })
    expect(aggregateWorkspaceStatus([
      workspace({ id: 'a', status: 'running' }),
      workspace({ id: 'b', status: 'failed' }),
    ])).toMatchObject({ status: 'failed' })
    expect(aggregateWorkspaceStatus([
      workspace({ id: 'a', status: 'attention' }),
      workspace({ id: 'b', status: 'running' }),
    ])).toMatchObject({ status: 'running' })
    expect(aggregateWorkspaceStatus([
      workspace({ id: 'a', status: 'done' }),
      workspace({ id: 'b', status: 'attention' }),
    ])).toMatchObject({ status: 'attention' })
  })

  test('equally urgent workspaces resolve by count, not by picking one', () => {
    const twoFailed = [
      workspace({ id: 'a', status: 'failed' }),
      workspace({ id: 'b', status: 'failed' }),
      workspace({ id: 'c', status: 'done' }),
      workspace({ id: 'd', status: 'done' }),
    ]
    expect(aggregateWorkspaceStatus(twoFailed)).toEqual({ status: 'failed', count: 2 })
  })

  test('the count covers only the winning bucket', () => {
    const mixed = [
      workspace({ id: 'a', status: 'needs_input' }),
      workspace({ id: 'b', status: 'needs_input' }),
      workspace({ id: 'c', status: 'running' }),
      workspace({ id: 'd', status: 'running' }),
      workspace({ id: 'e', status: 'running' }),
    ]
    expect(aggregateWorkspaceStatus(mixed)).toEqual({ status: 'needs_input', count: 2 })
  })

  test('a collapsed group aggregates over its visible members', () => {
    const store: WorkspaceStore = {
      workspaces: [
        workspace({ id: 'store-a', projectId: 'p-store', status: 'done', activityAt: '2026-08-24T10:00:00Z' }),
        workspace({ id: 'store-b', projectId: 'p-store', status: 'needs_input', activityAt: '2026-08-24T09:00:00Z' }),
        workspace({
          id: 'api-a',
          projectId: 'p-api',
          projectDisplayName: 'api',
          projectRootPath: '/home/me/dev/api',
          status: 'failed',
        }),
      ],
      emptyProjects: [],
    }
    const groups = workspaceProjectGroups(store, false)
    const storefront = groups.find((group) => group.projectId === 'p-store')!
    expect(aggregateWorkspaceStatus(storefront.workspaces)).toEqual({ status: 'needs_input', count: 1 })
    const api = groups.find((group) => group.projectId === 'p-api')!
    expect(aggregateWorkspaceStatus(api.workspaces)).toEqual({ status: 'failed', count: 1 })
  })

  test('an emptied project has no members, so no pill', () => {
    const groups = workspaceProjectGroups(
      { workspaces: [], emptyProjects: [emptyProject({ projectId: 'p1' })] },
      false,
    )
    expect(aggregateWorkspaceStatus(groups[0]!.workspaces)).toBeNull()
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

describe('workspaceStatusGroups', () => {
  test('groups by status in urgency order, rows recency-sorted, empties omitted', () => {
    const store: WorkspaceStore = {
      workspaces: [
        workspace({ id: 'a', status: 'done', activityAt: '2026-08-24T09:00:00Z' }),
        workspace({ id: 'b', status: 'running', activityAt: '2026-08-24T11:00:00Z' }),
        workspace({ id: 'c', status: 'needs_input', activityAt: '2026-08-24T10:00:00Z' }),
        workspace({ id: 'd', status: 'running', activityAt: '2026-08-24T12:00:00Z' }),
      ],
      emptyProjects: [],
    }
    const groups = workspaceStatusGroups(store, false)
    expect(groups.map((group) => group.status)).toEqual(['needs_input', 'running', 'done'])
    const running = groups.find((group) => group.status === 'running')!
    expect(running.label).toBe('Working')
    expect(running.workspaces.map((w) => w.id)).toEqual(['d', 'b'])
  })

  test('status mode applies the same AND filters as project mode', () => {
    const store: WorkspaceStore = {
      workspaces: [
        workspace({ id: 'keep', status: 'failed', projectId: 'p1', labels: ['bug'] }),
        workspace({ id: 'drop', status: 'done', projectId: 'p9', labels: ['bug'] }),
      ],
      emptyProjects: [],
    }
    const groups = workspaceStatusGroups(store, false, { hosts: [], projects: ['p1'], labels: ['bug'] })
    expect(groups.map((group) => group.status)).toEqual(['failed'])
  })
})

describe('filtered project groups', () => {
  test('an active project label filter hides non-matching workspaces and their projects', () => {
    const store: WorkspaceStore = {
      workspaces: [
        workspace({ id: 'a', projectId: 'p1', projectDisplayName: 'keep', labels: ['bug'] }),
        workspace({ id: 'b', projectId: 'p2', projectDisplayName: 'drop', labels: ['docs'] }),
        workspace({ id: 'c', projectId: 'p1', projectDisplayName: 'keep', labels: ['docs'] }),
      ],
      emptyProjects: [],
    }
    const groups = workspaceProjectGroups(store, false, { hosts: [], projects: [], labels: ['bug'] })
    expect(groups.map((group) => group.name)).toEqual(['keep'])
    expect(groups[0]!.workspaces.map((w) => w.id)).toEqual(['a'])
  })

  test('daemon-truly-empty projects still render under an active filter', () => {
    const store: WorkspaceStore = {
      workspaces: [workspace({ id: 'a', projectId: 'p1', projectDisplayName: 'zeta', labels: ['bug'] })],
      emptyProjects: [{ projectId: 'p-empty', projectDisplayName: 'alpha', projectRootPath: '/x', projectKind: 'git' }],
    }
    const groups = workspaceProjectGroups(store, false, { hosts: [], projects: [], labels: ['bug'] })
    expect(groups.map((group) => group.name)).toEqual(['zeta', 'alpha'])
  })

  test('no filter matches everything, preserving the existing order', () => {
    const store: WorkspaceStore = {
      workspaces: [
        workspace({ id: 'a', projectId: 'p1', projectDisplayName: 'zeta' }),
        workspace({ id: 'b', projectId: 'p0', projectDisplayName: 'api', activityAt: '2026-08-24T11:00:00Z' }),
      ],
      emptyProjects: [],
    }
    const groups = workspaceProjectGroups(store, false, { hosts: [], projects: [], labels: [] })
    expect(groups.map((group) => group.name)).toEqual(['api', 'zeta'])
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
