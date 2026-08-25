import { describe, expect, test } from 'bun:test'
import {
  applyTimelineItem,
  buildTurns,
  applyAgentUpdate,
  sortAgents,
  displayName,
  groupLabel,
  relativeTime,
  defaultModelValue,
  modelChoices,
  findModel,
  splitModelValue,
  basename,
  type AgentEntry,
  type ProviderEntry,
} from './paseo'

// ---- timeline mapping ------------------------------------------------------

describe('timeline mapping', () => {
  test('empty timeline builds no turns', () => {
    expect(buildTurns([])).toHaveLength(0)
  })

  test('streaming deltas merge into single turns', () => {
    const turns = buildTurns([
      { type: 'user_message', text: 'fix the bug' },
      { type: 'assistant_message', text: 'Looking' },
      { type: 'assistant_message', text: ' into it.' },
      {
        type: 'tool_call',
        callId: 'c1',
        name: 'bash',
        detail: { type: 'shell', command: 'npm test' },
        status: 'running',
        error: null,
      } as never,
    ])
    expect(turns).toHaveLength(3)
    expect(turns[0]).toEqual({ kind: 'user', text: 'fix the bug' })
    expect(turns[1]!.kind).toBe('assistant')
    expect((turns[1] as { source: string }).source).toBe('Looking into it.')
    const tool = turns[2] as { kind: string; status: string; title: string; detail?: string }
    expect(tool.kind).toBe('tool')
    expect(tool.status).toBe('running')
    expect(tool.title).toBe('Bash')
    expect(tool.detail).toBe('npm test')
  })

  test('tool updates replace in place by callId', () => {
    let turns = buildTurns([
      {
        type: 'tool_call',
        callId: 'c1',
        name: 'bash',
        detail: { type: 'shell', command: 'npm test' },
        status: 'running',
        error: null,
      } as never,
    ])
    turns = applyTimelineItem(turns, {
      type: 'tool_call',
      callId: 'c1',
      name: 'bash',
      detail: { type: 'shell', command: 'npm test', exitCode: 0 },
      status: 'completed',
      error: null,
    } as never)
    expect(turns).toHaveLength(1)
    expect((turns[0] as { status: string }).status).toBe('ok')
  })

  test('edit tool calls carry the patch', () => {
    const turns = applyTimelineItem([], {
      type: 'tool_call',
      callId: 'c2',
      name: 'edit_file',
      detail: { type: 'edit', filePath: 'src/x.ts', unifiedDiff: 'diff --git a/x b/x' },
      status: 'completed',
      error: null,
    } as never)
    expect((turns[0] as { patch?: string }).patch).toBe('diff --git a/x b/x')
  })

  test('todo snapshots replace rather than append', () => {
    let turns = applyTimelineItem([], { type: 'todo', items: [{ text: 'a', completed: false }] })
    turns = applyTimelineItem(turns, { type: 'todo', items: [{ text: 'a', completed: true }] })
    expect(turns.filter((t) => t.kind === 'todo')).toHaveLength(1)
  })

  test('errors become error turns', () => {
    const turns = applyTimelineItem([], { type: 'error', message: 'boom' })
    expect(turns[turns.length - 1]!.kind).toBe('error')
  })
})

// ---- agent directory -------------------------------------------------------

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

describe('agent directory', () => {
  const list = [entry({ id: 'b', updatedAt: '2026-08-24T11:00:00Z' }), entry({ id: 'a' })]

  test('sortAgents orders by recent activity', () => {
    expect(sortAgents(list)[0]!.id).toBe('b')
  })

  test('displayName prefers title over directory basename', () => {
    expect(displayName(entry({ title: 'Fix login' }))).toBe('Fix login')
    expect(displayName(entry({}))).toBe('storefront')
  })

  test('applyAgentUpdate upserts and removes by id', () => {
    const upserted = applyAgentUpdate(list, {
      kind: 'upsert',
      agent: entry({ id: 'c', updatedAt: '2026-08-24T12:00:00Z' }),
    })
    expect(upserted).toHaveLength(3)
    expect(upserted[0]!.id).toBe('c')
    const removed = applyAgentUpdate(upserted, { kind: 'remove', agentId: 'c' })
    expect(removed).toHaveLength(2)
  })

  test('groupLabel and relativeTime produce known shapes', () => {
    expect(['Today', 'Yesterday', 'Previous 7 Days', 'Earlier']).toContain(groupLabel(list[0]!))
    expect(relativeTime(list[0]!)).toMatch(/^now|\d+[mhd]|\w{3} \d{1,2}$/)
  })
})

// ---- provider catalog ------------------------------------------------------

const providers = [
  {
    provider: 'claude-code',
    label: 'Claude Code',
    status: 'ready',
    enabled: true,
    models: [
      { id: 'sonnet-4.6', label: 'Sonnet 4.6', isDefault: true },
      { id: 'opus-4.6', label: 'Opus 4.6' },
    ],
    modes: [{ id: 'default', label: 'Default' }],
  },
  { provider: 'codex', status: 'unavailable', enabled: true, models: [] },
] as unknown as ProviderEntry[]

describe('provider catalog', () => {
  test('defaultModelValue picks the ready default model', () => {
    expect(defaultModelValue(providers)).toBe('claude-code/sonnet-4.6')
  })

  test('modelChoices lists selectable models from ready providers', () => {
    expect(modelChoices(providers).map((choice) => choice.value)).toEqual([
      'claude-code/sonnet-4.6',
      'claude-code/opus-4.6',
    ])
  })

  test('findModel resolves value back to entry and model', () => {
    expect(findModel(providers, 'claude-code/opus-4.6').model?.id).toBe('opus-4.6')
  })

  test('splitModelValue separates provider from plain model id', () => {
    expect(splitModelValue('claude-code/opus-4.6')).toEqual({
      provider: 'claude-code',
      modelId: 'opus-4.6',
    })
    expect(splitModelValue('').provider).toBe('')
    expect(splitModelValue('').modelId).toBe('')
  })

  test('basename takes the last path segment', () => {
    expect(basename('/home/me/dev/storefront')).toBe('storefront')
  })
})
