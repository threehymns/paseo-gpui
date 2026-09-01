import { describe, expect, test } from 'bun:test'
import {
  agentLifecycle,
  archivedAgents,
  normalizeRename,
  rowActionInFlight,
  type AgentLifecycleClient,
} from './lifecycle'
import type { AgentEntry } from '../daemon/paseo'

function entry(over: Partial<AgentEntry>): AgentEntry {
  return {
    id: over.id ?? 'a1',
    shortId: 'a1',
    title: over.title ?? null,
    provider: 'codex',
    model: null,
    status: 'idle',
    cwd: '/home/me/dev/storefront',
    createdAt: '2026-08-24T10:00:00Z',
    updatedAt: over.updatedAt ?? '2026-08-24T10:00:00Z',
    lastUserMessageAt: over.lastUserMessageAt ?? null,
    labels: {},
    ...over,
  } as AgentEntry
}

/** Records every lifecycle call; archivedAt is handed back like the daemon's. */
function recordingClient(calls: string[]): AgentLifecycleClient {
  return {
    archiveAgent: async (agentId) => {
      calls.push(`archive:${agentId}`)
      return { archivedAt: '2026-08-24T09:00:00Z' }
    },
    deleteAgent: async (agentId) => {
      calls.push(`delete:${agentId}`)
    },
    updateAgent: async (agentId, updates) => {
      calls.push(`update:${agentId}:${JSON.stringify(updates)}`)
    },
  }
}

describe('agentLifecycle', () => {
  test('archive calls the SDK and resolves with its payload', async () => {
    const calls: string[] = []
    const lifecycle = agentLifecycle(recordingClient(calls))
    const result = await lifecycle.archive('a1')
    expect(result).toEqual({ archivedAt: '2026-08-24T09:00:00Z' })
    expect(calls).toEqual(['archive:a1'])
  })

  test('remove calls deleteAgent', async () => {
    const calls: string[] = []
    await agentLifecycle(recordingClient(calls)).remove('a1')
    expect(calls).toEqual(['delete:a1'])
  })

  test('rename goes through updateAgent({ name })', async () => {
    const calls: string[] = []
    await agentLifecycle(recordingClient(calls)).rename('a1', '  Fix login  ')
    expect(calls).toEqual(['update:a1:{"name":"Fix login"}'])
  })

  test('a rejected daemon call propagates to the awaiting UI', async () => {
    const lifecycle = agentLifecycle({
      archiveAgent: () => Promise.reject(new Error('nope')),
      deleteAgent: () => Promise.reject(new Error('nope')),
      updateAgent: () => Promise.reject(new Error('nope')),
    })
    await expect(lifecycle.archive('a1')).rejects.toThrow('nope')
    await expect(lifecycle.remove('a1')).rejects.toThrow('nope')
    await expect(lifecycle.rename('a1', 'x')).rejects.toThrow('nope')
  })
})

describe('archivedAgents', () => {
  test('keeps only archived agents, most recently active first', () => {
    const live = entry({ id: 'live' })
    const old = entry({ id: 'old', archivedAt: '2026-08-24T09:00:00Z', updatedAt: '2026-08-24T09:30:00Z' })
    const fresh = entry({ id: 'fresh', archivedAt: '2026-08-24T09:10:00Z', updatedAt: '2026-08-24T11:00:00Z' })
    expect(archivedAgents([fresh, live, old]).map((e) => e.id)).toEqual(['fresh', 'old'])
  })

  test('an unarchived directory yields nothing', () => {
    expect(archivedAgents([entry({ id: 'a' })])).toEqual([])
  })
})

describe('normalizeRename', () => {
  test('trims whitespace into the new name', () => {
    expect(normalizeRename('  Fix login  ', 'Old')).toBe('Fix login')
  })

  test('empty and unchanged drafts cancel instead of calling the daemon', () => {
    expect(normalizeRename('   ', 'Old')).toBeNull()
    expect(normalizeRename('Old', 'Old')).toBeNull()
    expect(normalizeRename('  Old ', 'Old')).toBeNull()
  })
})

describe('rowActionInFlight', () => {
  test('matches by row id regardless of verb', () => {
    const rows = [{ verb: 'archive' as const, id: 'a1' }]
    expect(rowActionInFlight(rows, 'a1')).toBe(true)
    expect(rowActionInFlight(rows, 'a2')).toBe(false)
    expect(rowActionInFlight([], 'a1')).toBe(false)
  })
})
