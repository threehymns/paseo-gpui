import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_META_CONFIG,
  META_TEXT_MAX,
  truncateMetaText,
  workspaceMetaLine,
  workspaceRowTitle,
  type WorkspaceMetaConfig,
} from './workspace-meta'
import type { WorkspaceDescriptor } from '../daemon/paseo'

/** Canonical minimal descriptor builder; runtime fields arrive via `over`. */
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

const git = (over: Partial<NonNullable<WorkspaceDescriptor['gitRuntime']>>) =>
  ({ currentBranch: 'fix-auth', ...over }) as NonNullable<WorkspaceDescriptor['gitRuntime']>

const pr = (over: Partial<NonNullable<NonNullable<WorkspaceDescriptor['githubRuntime']>['pullRequest']>>) =>
  ({
    number: 42,
    url: 'https://github.com/me/storefront/pull/42',
    title: 'Fix auth',
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: 'fix-auth',
    isMerged: false,
    ...over,
  }) as NonNullable<NonNullable<WorkspaceDescriptor['githubRuntime']>['pullRequest']>

const check = (status: 'success' | 'pending' | 'failure' | 'skipped' | 'cancelled') => ({
  name: `check-${status}`,
  status,
  url: null,
})

const service = (
  over: Partial<{ lifecycle: 'running' | 'stopped'; health: 'healthy' | 'unhealthy' | null; type: 'script' | 'service'; hostname: string }>,
) => ({
  scriptName: 'dev',
  type: 'service' as const,
  hostname: 'devbox',
  port: 3000,
  proxyUrl: null,
  lifecycle: 'running' as const,
  health: 'healthy' as const,
  exitCode: null,
  terminalId: null,
  ...over,
})

const withSlots = (slots: Partial<WorkspaceMetaConfig['slots']>): WorkspaceMetaConfig => ({
  ...DEFAULT_META_CONFIG,
  slots: { ...DEFAULT_META_CONFIG.slots, ...slots },
})

describe('branch slot', () => {
  test('renders the current branch with dirty and ahead-behind indicators', () => {
    const line = workspaceMetaLine(workspace({ gitRuntime: git({ isDirty: true, aheadBehind: { ahead: 1, behind: 2 } }) }))
    expect(line.items[0]).toEqual({ kind: 'branch', text: 'fix-auth', tone: 'neutral', dirty: true, aheadBehind: '↑1 ↓2' })
  })

  test('hides zero sides of ahead-behind', () => {
    const line = workspaceMetaLine(workspace({ gitRuntime: git({ aheadBehind: { ahead: 0, behind: 3 } }) }))
    expect(line.items[0]).toMatchObject({ aheadBehind: '↓3' })
  })

  test('a clean synced branch shows no indicators', () => {
    const line = workspaceMetaLine(workspace({ gitRuntime: git() }))
    expect(line.items[0]).toEqual({ kind: 'branch', text: 'fix-auth', tone: 'neutral', dirty: false, aheadBehind: null })
  })

  test('missing gitRuntime or an unknown branch renders nothing', () => {
    expect(workspaceMetaLine(workspace({ gitRuntime: null })).items).toEqual([])
    expect(workspaceMetaLine(workspace({ gitRuntime: git({ currentBranch: null }) })).items).toEqual([])
    expect(workspaceMetaLine(workspace({ gitRuntime: git({ currentBranch: '   ' }) })).items).toEqual([])
  })

  test('a runaway branch name truncates with an ellipsis at the cap', () => {
    const branch = 'fix/very-long-descriptive-branch-name-here'
    const line = workspaceMetaLine(workspace({ gitRuntime: git({ currentBranch: branch }) }))
    expect(line.items[0]).toMatchObject({ text: `${branch.slice(0, META_TEXT_MAX)}…` })
  })
})

describe('pull request slot', () => {
  test('renders number and state from githubRuntime', () => {
    const line = workspaceMetaLine(workspace({ githubRuntime: { pullRequest: pr() } }))
    expect(line.items[0]).toEqual({ kind: 'pullRequest', text: '#42', detail: 'open', tone: 'neutral' })
  })

  test('a merged PR reads merged in the ok tone; draft beats a plain state', () => {
    const merged = workspaceMetaLine(workspace({ githubRuntime: { pullRequest: pr({ isMerged: true }) } }))
    expect(merged.items[0]).toMatchObject({ detail: 'merged', tone: 'ok' })
    const draft = workspaceMetaLine(workspace({ githubRuntime: { pullRequest: pr({ isDraft: true }) } }))
    expect(draft.items[0]).toMatchObject({ detail: 'draft', tone: 'neutral' })
  })

  test('state text lowercases whatever casing the daemon sends', () => {
    const line = workspaceMetaLine(workspace({ githubRuntime: { pullRequest: pr({ state: 'CLOSED' }) } }))
    expect(line.items[0]).toMatchObject({ detail: 'closed' })
  })

  test('a PR without a number still carries its state', () => {
    const line = workspaceMetaLine(workspace({ githubRuntime: { pullRequest: pr({ number: undefined }) } }))
    expect(line.items[0]).toEqual({ kind: 'pullRequest', text: 'open', detail: null, tone: 'neutral' })
  })

  test('no githubRuntime or no pullRequest renders nothing, never a placeholder', () => {
    expect(workspaceMetaLine(workspace({ githubRuntime: null })).items).toEqual([])
    expect(workspaceMetaLine(workspace({ githubRuntime: { pullRequest: null } })).items).toEqual([])
  })
})

describe('checks', () => {
  test('icon+text default shows passed/total from the individual runs', () => {
    const line = workspaceMetaLine(
      workspace({ githubRuntime: { pullRequest: pr({ checks: [check('success'), check('success'), check('failure')], checksStatus: 'failure' }) } }),
    )
    expect(line.checks).toEqual({ status: 'failure', label: '2/3' })
  })

  test('skipped runs count as passed; cancelled does not', () => {
    const line = workspaceMetaLine(
      workspace({ githubRuntime: { pullRequest: pr({ checks: [check('success'), check('skipped'), check('cancelled')], checksStatus: 'success' }) } }),
    )
    expect(line.checks).toEqual({ status: 'success', label: '2/3' })
  })

  test('checksStatus wins over the runs when supplied; otherwise derive worst-of', () => {
    const supplied = workspaceMetaLine(
      workspace({ githubRuntime: { pullRequest: pr({ checks: [check('success')], checksStatus: 'pending' }) } }),
    )
    expect(supplied.checks).toMatchObject({ status: 'pending' })
    const derived = workspaceMetaLine(workspace({ githubRuntime: { pullRequest: pr({ checks: [check('pending'), check('success')] }) } }))
    expect(derived.checks).toMatchObject({ status: 'pending' })
    const clean = workspaceMetaLine(workspace({ githubRuntime: { pullRequest: pr({ checks: [check('success'), check('success')] }) } }))
    expect(clean.checks).toMatchObject({ status: 'success' })
  })

  test('no runs and no status, or checksStatus none, renders nothing', () => {
    expect(workspaceMetaLine(workspace({ githubRuntime: { pullRequest: pr({ checks: [] }) } })).checks).toBeNull()
    const none = workspaceMetaLine(
      workspace({ githubRuntime: { pullRequest: pr({ checks: [check('success')], checksStatus: 'none' }) } }),
    )
    expect(none.checks).toBeNull()
  })

  test('icon-only mode drops the label; hidden mode drops the checks entirely', () => {
    const descriptor = workspace({ githubRuntime: { pullRequest: pr({ checks: [check('success'), check('failure')] }) } })
    expect(workspaceMetaLine(descriptor, { ...DEFAULT_META_CONFIG, checksMode: 'iconOnly' }).checks).toEqual({ status: 'failure', label: null })
    expect(workspaceMetaLine(descriptor, { ...DEFAULT_META_CONFIG, checksMode: 'hidden' }).checks).toBeNull()
  })

  test('checks answer to their own toggle and render even with the PR slot off', () => {
    const descriptor = workspace({ githubRuntime: { pullRequest: pr({ checks: [check('success')] }) } })
    expect(workspaceMetaLine(descriptor, withSlots({ pullRequest: false })).checks).toEqual({ status: 'success', label: '1/1' })
  })
})

describe('services slot', () => {
  test('shows running/total of daemon-typed services', () => {
    const line = workspaceMetaLine(
      workspace({ scripts: [service({ scriptName: 'api' }), service({ scriptName: 'web' }), service({ scriptName: 'db', lifecycle: 'stopped' })] }),
    )
    expect(line.items[0]).toEqual({ kind: 'services', text: '2/3', tone: 'neutral' })
  })

  test('all running reads ok; one unhealthy reads danger', () => {
    const healthy = workspaceMetaLine(workspace({ scripts: [service({}), service({})] }))
    expect(healthy.items[0]).toMatchObject({ tone: 'ok' })
    const sick = workspaceMetaLine(workspace({ scripts: [service({}), service({ health: 'unhealthy' })] }))
    expect(sick.items[0]).toMatchObject({ tone: 'danger' })
  })

  test('scripts typed as scripts are not services', () => {
    const line = workspaceMetaLine(workspace({ scripts: [service({ type: 'script' })] }))
    expect(line.items).toEqual([])
  })

  test('no scripts renders nothing', () => {
    expect(workspaceMetaLine(workspace({ scripts: [] })).items).toEqual([])
  })
})

describe('project, host, and labels slots', () => {
  test('project shows the custom name when the user set one', () => {
    const line = workspaceMetaLine(
      workspace({ projectDisplayName: 'storefront', projectCustomName: 'Shop' }),
      withSlots({ project: true }),
    )
    expect(line.items[0]).toEqual({ kind: 'project', text: 'Shop', tone: 'neutral' })
  })

  test('host renders only when every script agrees on one hostname', () => {
    const one = workspaceMetaLine(workspace({ scripts: [service({}), service({ hostname: 'devbox' })] }), withSlots({ host: true }))
    expect(one.items[0]).toMatchObject({ kind: 'host', text: 'devbox' })
    const split = workspaceMetaLine(workspace({ scripts: [service({}), service({ hostname: 'other' })] }), withSlots({ host: true }))
    expect(split.items.some((item) => item.kind === 'host')).toBe(false)
    const none = workspaceMetaLine(workspace({ scripts: [] }), withSlots({ host: true }))
    expect(none.items.some((item) => item.kind === 'host')).toBe(false)
  })

  test('labels default hidden; enabled they join, truncate, and skip empties', () => {
    expect(workspaceMetaLine(workspace({ labels: ['bug', 'perf'] })).items).toEqual([])
    const line = workspaceMetaLine(workspace({ labels: ['bug', 'perf'] }), withSlots({ labels: true }))
    expect(line.items[0]).toEqual({ kind: 'labels', text: 'bug, perf', tone: 'neutral' })
    expect(workspaceMetaLine(workspace({ labels: [] }), withSlots({ labels: true })).items).toEqual([])
  })

  test('items render in fixed slot order regardless of data order', () => {
    const line = workspaceMetaLine(
      workspace({
        labels: ['bug'],
        scripts: [service({})],
        gitRuntime: git(),
        githubRuntime: { pullRequest: pr() },
      }),
      withSlots({ project: true, host: true, labels: true }),
    )
    expect(line.items.map((item) => item.kind)).toEqual(['branch', 'project', 'host', 'pullRequest', 'services', 'labels'])
  })
})

describe('trailing slot', () => {
  test('diff stat is the default and passes the raw numbers through', () => {
    const line = workspaceMetaLine(workspace({ diffStat: { additions: 12, deletions: 3 } }))
    expect(line.trailing).toEqual({ kind: 'diffStat', additions: 12, deletions: 3 })
  })

  test('a null diffStat or a zeroed one renders nothing', () => {
    expect(workspaceMetaLine(workspace({ diffStat: null })).trailing).toBeNull()
    expect(workspaceMetaLine(workspace({ diffStat: { additions: 0, deletions: 0 } })).trailing).toBeNull()
  })

  test('the activity alternative resolves the epoch timestamp of last activity', () => {
    const config = { ...DEFAULT_META_CONFIG, trailing: 'activity' as const }
    const line = workspaceMetaLine(workspace({ activityAt: '2026-08-24T10:00:00Z' }), config)
    expect(line.trailing).toEqual({ kind: 'activity', at: Date.parse('2026-08-24T10:00:00Z') })
  })

  test('a workspace with no activity renders no activity trailing', () => {
    const config = { ...DEFAULT_META_CONFIG, trailing: 'activity' as const }
    expect(workspaceMetaLine(workspace({ activityAt: null }), config).trailing).toBeNull()
  })
})

describe('title', () => {
  test('an explicit override wins over the derived name', () => {
    expect(workspaceRowTitle(workspace({ title: 'My Workspace', name: 'storefront' }))).toBe('My Workspace')
    expect(workspaceRowTitle(workspace({ name: 'storefront' }))).toBe('storefront')
  })

  test('the branch-name source swaps in the current branch when known', () => {
    const config = { ...DEFAULT_META_CONFIG, titleSource: 'branch' as const }
    expect(workspaceRowTitle(workspace({ gitRuntime: git() }), config)).toBe('fix-auth')
    expect(workspaceRowTitle(workspace({ name: 'storefront' }), config)).toBe('storefront')
  })
})

describe('graceful degradation', () => {
  test('a bare descriptor resolves an empty line with no placeholders', () => {
    expect(workspaceMetaLine(workspace({}))).toEqual({ items: [], checks: null, trailing: null })
  })
})

describe('truncateMetaText', () => {
  test('keeps the cap plus an ellipsis; short text passes through', () => {
    expect(truncateMetaText('abcdefgh', 4)).toBe('abcd…')
    expect(truncateMetaText('abc', 4)).toBe('abc')
    expect(truncateMetaText('abcdefgh', META_TEXT_MAX)).toBe('abcdefgh')
  })
})
