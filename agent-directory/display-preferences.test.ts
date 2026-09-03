import { describe, expect, test } from 'bun:test'
import {
  EMPTY_FILTERS,
  LABEL_PALETTE,
  UNLABELLED_LABEL,
  filtersHideEverything,
  hasActiveFilters,
  labelColor,
  workspaceHost,
  workspaceMatchesFilters,
  type WorkspaceFilters,
} from './display-preferences'
import type { WorkspaceDescriptor } from '../daemon/paseo'

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
    activityAt: '2026-08-24T10:00:00Z',
    scripts: [],
    ...over,
  } as WorkspaceDescriptor
}

const script = (hostname: string) => ({
  scriptName: 'dev',
  type: 'script' as const,
  hostname,
  port: 3000,
  proxyUrl: null,
  lifecycle: 'running' as const,
  health: 'healthy' as const,
  exitCode: null,
  terminalId: null,
})

const filters = (over: Partial<WorkspaceFilters>): WorkspaceFilters => ({ ...EMPTY_FILTERS, ...over })

describe('workspaceHost', () => {
  test('every script agreeing on one hostname resolves that host', () => {
    expect(workspaceHost(workspace({ scripts: [script('devbox'), script('devbox')] }))).toBe('devbox')
  })

  test('no scripts, or a split host, has no single host', () => {
    expect(workspaceHost(workspace({ scripts: [] }))).toBeNull()
    expect(workspaceHost(workspace({ scripts: [script('a'), script('b')] }))).toBeNull()
  })
})

describe('workspaceMatchesFilters', () => {
  test('empty filters match everything', () => {
    expect(workspaceMatchesFilters(workspace({}), EMPTY_FILTERS)).toBe(true)
  })

  test('host filter keeps only workspaces on a selected host', () => {
    const onBox = workspace({ id: 'a', scripts: [script('devbox')] })
    const split = workspace({ id: 'b', scripts: [script('x'), script('y')] })
    const f = filters({ hosts: ['devbox'] })
    expect(workspaceMatchesFilters(onBox, f)).toBe(true)
    expect(workspaceMatchesFilters(split, f)).toBe(false)
    expect(workspaceMatchesFilters(workspace({ scripts: [] }), f)).toBe(false)
  })

  test('project allowlist matches by project id', () => {
    const f = filters({ projects: ['p1'] })
    expect(workspaceMatchesFilters(workspace({ projectId: 'p1' }), f)).toBe(true)
    expect(workspaceMatchesFilters(workspace({ projectId: 'p2' }), f)).toBe(false)
  })

  test('label filter matches any selected label', () => {
    const buggy = workspace({ labels: ['bug', 'perf'] })
    const f = filters({ labels: ['bug'] })
    expect(workspaceMatchesFilters(buggy, f)).toBe(true)
    expect(workspaceMatchesFilters(workspace({ labels: ['docs'] }), f)).toBe(false)
  })

  test('Unlabelled matches workspaces with no labels at all, never labelled ones', () => {
    const f = filters({ labels: [UNLABELLED_LABEL] })
    expect(workspaceMatchesFilters(workspace({ labels: [] }), f)).toBe(true)
    expect(workspaceMatchesFilters(workspace({ labels: undefined }), f)).toBe(true)
    expect(workspaceMatchesFilters(workspace({ labels: ['bug'] }), f)).toBe(false)
  })

  test('dimensions compose with AND', () => {
    const target = workspace({ id: 'a', projectId: 'p1', labels: ['bug'], scripts: [script('devbox')] })
    expect(workspaceMatchesFilters(target, filters({ hosts: ['devbox'], projects: ['p1'], labels: ['bug'] }))).toBe(true)
    // Break one dimension and it falls out despite matching the others.
    expect(workspaceMatchesFilters(target, filters({ hosts: ['devbox'], projects: ['p2'], labels: ['bug'] }))).toBe(false)
    expect(workspaceMatchesFilters(target, filters({ hosts: ['other'], projects: ['p1'], labels: ['bug'] }))).toBe(false)
    expect(workspaceMatchesFilters(target, filters({ hosts: ['devbox'], projects: ['p1'], labels: ['docs'] }))).toBe(false)
  })
})

describe('hasActiveFilters / filtersHideEverything', () => {
  test('empty filters are inactive; any dimension makes them active', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasActiveFilters(filters({ hosts: ['devbox'] }))).toBe(true)
    expect(hasActiveFilters(filters({ projects: ['p1'] }))).toBe(true)
    expect(hasActiveFilters(filters({ labels: ['bug'] }))).toBe(true)
  })

  test('filters hide everything only when active and nothing matches', () => {
    const list = [workspace({ id: 'a', projectId: 'p1' })]
    expect(filtersHideEverything(filters({ projects: ['p9'] }), list)).toBe(true)
    expect(filtersHideEverything(filters({ projects: ['p1'] }), list)).toBe(false)
    expect(filtersHideEverything(EMPTY_FILTERS, list)).toBe(false)
  })
})

describe('labelColor', () => {
  test('is deterministic: the same name always maps to the same color', () => {
    expect(labelColor('bug')).toBe(labelColor('bug'))
  })

  test('only ever returns palette colors', () => {
    for (const name of ['bug', 'perf', 'docs', 'frontend', 'backlog', 'x', 'very-long-label-name']) {
      expect(LABEL_PALETTE).toContain(labelColor(name))
    }
  })

  test('different labels can collide but each keeps one color', () => {
    // The point is stability per label, not uniqueness across labels; assert
    // the mapping is a function (same label -> same color) rather than unique.
    const first = labelColor('alpha')
    const second = labelColor('alpha')
    expect(second).toBe(first)
  })
})
