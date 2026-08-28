import { describe, expect, test } from 'bun:test'
import {
  closingTurn,
  initialSubagents,
  managedChildren,
  managedRow,
  mergeRows,
  mergeTimelinePage,
  providerSubagentsEnabled,
  providerRow,
  reduceSubagents,
  resolveSubagentText,
  selectTrackRows,
  subagentHasOlder,
  subagentLabel,
  subagentSubtitle,
  subagentTurns,
  summarizeRows,
  trackLabel,
  type ProviderSubagentDescriptorPayload,
  type SubagentTimeline,
} from './subagents'
import type { AgentEntry, TimelineItem } from './paseo'

// ---- fixtures ----------------------------------------------------------------

function descriptor(over: Partial<ProviderSubagentDescriptorPayload>): ProviderSubagentDescriptorPayload {
  return {
    id: over.id ?? 'sub-1',
    parentAgentId: over.parentAgentId ?? 'parent',
    provider: over.provider ?? 'claude-code',
    title: over.title ?? 'Explore',
    description: over.description ?? 'Find the failing test',
    status: over.status ?? 'running',
    createdAt: over.createdAt ?? '2026-08-24T10:00:00Z',
    updatedAt: over.updatedAt ?? '2026-08-24T10:05:00Z',
    toolCallId: over.toolCallId ?? null,
    ...(over.subtitle !== undefined ? { subtitle: over.subtitle } : {}),
  }
}

const assistant = (text: string) => ({ type: 'assistant_message' as const, text })
const user = (text: string) => ({ type: 'user_message' as const, text })

function page(over: {
  direction?: 'tail' | 'before' | 'after'
  epoch?: string
  reset?: boolean
  staleCursor?: boolean
  gap?: boolean
  hasOlder?: boolean
  rows?: { seq: number; timestamp?: string; item: TimelineItem }[]
  maxSeq?: number
}) {
  return {
    requestId: 'r',
    parentAgentId: 'parent',
    subagentId: 'sub-1',
    provider: 'claude-code',
    direction: over.direction ?? ('tail' as const),
    epoch: over.epoch ?? 'epoch-1',
    reset: over.reset ?? false,
    staleCursor: over.staleCursor ?? false,
    gap: over.gap ?? false,
    window: { minSeq: 1, maxSeq: over.maxSeq ?? 2, nextSeq: (over.maxSeq ?? 2) + 1 },
    hasOlder: over.hasOlder ?? false,
    hasNewer: false,
    rows: (over.rows ?? []).map((row) => ({ timestamp: '2026-08-24T10:00:00Z', ...row })),
    error: null,
  }
}

function agentEntry(over: Partial<AgentEntry>): AgentEntry {
  return {
    id: over.id ?? 'child',
    shortId: 'child',
    title: over.title ?? 'Child agent',
    provider: 'codex',
    model: null,
    status: over.status ?? 'idle',
    cwd: '/repo',
    createdAt: over.createdAt ?? '2026-08-24T09:00:00Z',
    updatedAt: over.createdAt ?? '2026-08-24T09:00:00Z',
    lastUserMessageAt: null,
    labels: over.labels ?? { 'paseo.parent-agent-id': 'parent' },
    ...over,
  } as AgentEntry
}

// ---- label fallback rules -----------------------------------------------------

describe('label rules', () => {
  test('description names the row, title falls back', () => {
    expect(subagentLabel({ title: 'Explore', description: 'Find the bug' })).toBe('Find the bug')
    expect(subagentLabel({ title: 'Explore', description: '   ' })).toBe('Explore')
    expect(subagentLabel({ title: null, description: null })).toBeNull()
  })

  test('a literal "New agent" is discarded as noise', () => {
    expect(resolveSubagentText('New agent')).toBeNull()
    expect(resolveSubagentText('  new AGENT ')).toBeNull()
    expect(resolveSubagentText('New agent for search')).toBe('New agent for search')
    expect(subagentLabel({ title: 'New agent', description: null })).toBeNull()
  })

  test('subtitle prefers the provider-owned string, else the type behind a task line', () => {
    expect(subagentSubtitle({ title: 'Explore', description: 'Task', subtitle: 'sonnet · fast' })).toBe('sonnet · fast')
    expect(subagentSubtitle({ title: 'Explore', description: 'Task', subtitle: null })).toBe('Explore')
    expect(subagentSubtitle({ title: 'Explore', description: null, subtitle: null })).toBeNull()
  })
})

// ---- status derivation ---------------------------------------------------------

describe('status derivation', () => {
  test('managed agents map onto provider vocabulary', () => {
    expect(managedRow(agentEntry({ status: 'running' })).status).toBe('running')
    expect(managedRow(agentEntry({ status: 'initializing' })).status).toBe('running')
    expect(managedRow(agentEntry({ status: 'error' })).status).toBe('failed')
    expect(managedRow(agentEntry({ status: 'idle' })).status).toBe('completed')
    expect(managedRow(agentEntry({ status: 'closed' })).status).toBe('completed')
  })

  test('failed subagents get attention marking; completed ones do not', () => {
    expect(providerRow(descriptor({ status: 'failed' })).requiresAttention).toBe(true)
    expect(providerRow(descriptor({ status: 'completed' })).requiresAttention).toBe(false)
    expect(providerRow(descriptor({ status: 'canceled' })).requiresAttention).toBe(false)
  })
})

// ---- track summary ---------------------------------------------------------------

describe('track summary', () => {
  const rows = [
    providerRow(descriptor({ id: 'a', status: 'running' })),
    providerRow(descriptor({ id: 'b', status: 'failed' })),
    providerRow(descriptor({ id: 'c', status: 'completed' })),
  ]

  test('total, working, failed, and awaiting count as disjoint buckets', () => {
    expect(summarizeRows(rows)).toEqual({ total: 3, running: 1, failed: 1, awaiting: 0 })
    expect(
      summarizeRows([
        managedRow(agentEntry({ status: 'idle', requiresAttention: true })),
        ...rows,
      ]),
    ).toEqual({ total: 4, running: 1, failed: 1, awaiting: 1 })
    // A failed row never double-counts into awaiting input.
    expect(summarizeRows([providerRow(descriptor({ status: 'failed' }))]).awaiting).toBe(0)
  })

  test('the pill line names one segment per present bucket', () => {
    expect(trackLabel(rows)).toBe('1 working · 1 failed')
    expect(trackLabel(rows.slice(0, 1))).toBe('1 working')
    expect(trackLabel([managedRow(agentEntry({ status: 'idle', requiresAttention: true }))])).toBe(
      '1 awaiting input',
    )
  })

  test('with no bucket present the pill falls back to a plain count', () => {
    expect(trackLabel([providerRow(descriptor({ id: 'z', status: 'completed' }))])).toBe('1 subagent')
    expect(trackLabel([])).toBe('0 subagents')
  })
})

// ---- listing: merge, update, remove ---------------------------------------------

describe('descriptor store', () => {
  test('listing replaces the parent set and drops removed timelines', () => {
    let state = reduceSubagents(initialSubagents, { type: 'upserted', subagent: descriptor({ id: 'old' }) })
    state = reduceSubagents(state, {
      type: 'timelinePage',
      page: page({ rows: [{ seq: 1, item: assistant('hi') }] }),
    })
    state = reduceSubagents(state, {
      type: 'listed',
      parentAgentId: 'parent',
      subagents: [descriptor({ id: 'new' })],
    })
    expect(Object.keys(state.descriptors)).toHaveLength(1)
    expect(state.descriptors['parent\0new']).toBeTruthy()
    // The removed sibling's timeline goes with it.
    expect(state.timelines['parent\0old']).toBeUndefined()
    expect(state.timelines['parent\0new']).toBeUndefined()
  })

  test('listing keeps other parents untouched', () => {
    let state = reduceSubagents(initialSubagents, { type: 'upserted', subagent: descriptor({ parentAgentId: 'other', id: 'x' }) })
    state = reduceSubagents(state, { type: 'listed', parentAgentId: 'parent', subagents: [] })
    expect(state.descriptors['other\0x']).toBeTruthy()
  })

  test('remove clears both descriptor and timeline', () => {
    let state = reduceSubagents(initialSubagents, { type: 'upserted', subagent: descriptor({}) })
    state = reduceSubagents(state, {
      type: 'timelinePage',
      page: page({ rows: [{ seq: 1, item: assistant('hi') }] }),
    })
    state = reduceSubagents(state, { type: 'removed', parentAgentId: 'parent', subagentId: 'sub-1' })
    expect(state.descriptors['parent\0sub-1']).toBeUndefined()
    expect(state.timelines['parent\0sub-1']).toBeUndefined()
    expect(state).toEqual(initialSubagents)
  })

  test('upsert updates status in place', () => {
    let state = reduceSubagents(initialSubagents, { type: 'upserted', subagent: descriptor({ status: 'running' }) })
    state = reduceSubagents(state, { type: 'upserted', subagent: descriptor({ status: 'completed' }) })
    expect(state.descriptors['parent\0sub-1']!.status).toBe('completed')
  })

  test('a re-listing refreshes changed descriptors even when the id set is unchanged', () => {
    let state = reduceSubagents(initialSubagents, {
      type: 'listed',
      parentAgentId: 'parent',
      subagents: [descriptor({ status: 'running' })],
    })
    state = reduceSubagents(state, {
      type: 'listed',
      parentAgentId: 'parent',
      subagents: [descriptor({ status: 'failed' })],
    })
    // Finishing is a status change, not a removal — the row must reflect it.
    expect(state.descriptors['parent\0sub-1']!.status).toBe('failed')
  })
})

// ---- timeline paging contract ----------------------------------------------------

describe('timeline paging', () => {
  test('tail fetch seeds the window tail-first and records hasOlder', () => {
    const next = mergeTimelinePage(undefined, page({
      hasOlder: true,
      rows: [
        { seq: 2, item: user('task') },
        { seq: 3, item: assistant('latest') },
      ],
      maxSeq: 3,
    }))
    expect(next!.epoch).toBe('epoch-1')
    expect(subagentTurns({ descriptors: {}, timelines: { 'parent\0sub-1': next! } }, 'parent', 'sub-1')).toHaveLength(2)
    expect(next!.hasOlder).toBe(true)
  })

  test('older pages union in via the epoch-and-seq cursor', () => {
    const existing: SubagentTimeline = {
      epoch: 'epoch-1',
      items: { 5: assistant('five'), 6: assistant('six') },
      lastSeq: 6,
      hasOlder: true,
    }
    const next = mergeTimelinePage(existing, page({
      direction: 'before',
      hasOlder: false,
      rows: [{ seq: 4, item: assistant('four') }],
    }))
    expect(Object.keys(next!.items).map(Number)).toEqual([4, 5, 6])
    expect(next!.hasOlder).toBe(false)
    expect(next!.lastSeq).toBe(6)
  })

  test('reset replaces the window instead of merging', () => {
    const existing: SubagentTimeline = { epoch: 'epoch-1', items: { 1: assistant('stale') }, lastSeq: 1, hasOlder: true }
    const next = mergeTimelinePage(existing, page({
      reset: true,
      epoch: 'epoch-2',
      rows: [{ seq: 9, item: assistant('fresh') }],
      maxSeq: 9,
    }))
    expect(next!.items).toEqual({ 9: assistant('fresh') })
    expect(next!.lastSeq).toBe(9)
  })

  test('a stale cursor invalidates the retained window too', () => {
    const existing: SubagentTimeline = { epoch: 'epoch-1', items: { 4: assistant('kept?') }, lastSeq: 4, hasOlder: true }
    const next = mergeTimelinePage(existing, page({
      direction: 'before',
      staleCursor: true,
      rows: [{ seq: 1, item: assistant('only this') }],
      maxSeq: 1,
    }))
    expect(Object.keys(next!.items)).toEqual(['1'])
  })

  test('an epoch change starts a new generation regardless of flags', () => {
    const existing: SubagentTimeline = { epoch: 'epoch-1', items: { 1: assistant('old gen') }, lastSeq: 1, hasOlder: true }
    const next = mergeTimelinePage(existing, page({ epoch: 'epoch-2', rows: [{ seq: 1, item: assistant('new gen') }], maxSeq: 1 }))
    expect(next!.items).toEqual({ 1: assistant('new gen') })
  })

  test('a gap on a tail fetch replaces newer rows it cannot attach to', () => {
    const existing: SubagentTimeline = { epoch: 'epoch-1', items: { 7: assistant('pushed ahead') }, lastSeq: 7, hasOlder: true }
    const next = mergeTimelinePage(existing, page({
      gap: true,
      rows: [{ seq: 2, item: assistant('window') }],
      maxSeq: 2,
    }))
    expect(Object.keys(next!.items)).toEqual(['2'])
  })

  test('tail pages backfill contiguous pushed rows beyond the fetched window', () => {
    const existing: SubagentTimeline = {
      epoch: 'epoch-1',
      items: { 8: assistant('pushed eight'), 10: assistant('pushed ten — noncontiguous') },
      lastSeq: 10,
      hasOlder: true,
    }
    const next = mergeTimelinePage(existing, page({
      rows: [
        { seq: 6, item: assistant('fetched six') },
        { seq: 7, item: assistant('fetched seven') },
      ],
      maxSeq: 7,
    }))
    expect(Object.keys(next!.items).map(Number)).toEqual([6, 7, 8])
    expect(next!.lastSeq).toBe(8)
  })

  test('live pushes stream in order and stale sequence numbers drop', () => {
    let state = reduceSubagents(initialSubagents, {
      type: 'timelinePush',
      push: { kind: 'timeline', parentAgentId: 'parent', subagentId: 'sub-1', provider: 'c', item: assistant('one'), timestamp: 't', seq: 1, epoch: 'e' },
    })
    state = reduceSubagents(state, {
      type: 'timelinePush',
      push: { kind: 'timeline', parentAgentId: 'parent', subagentId: 'sub-1', provider: 'c', item: assistant('two'), timestamp: 't', seq: 2, epoch: 'e' },
    })
    state = reduceSubagents(state, {
      type: 'timelinePush',
      push: { kind: 'timeline', parentAgentId: 'parent', subagentId: 'sub-1', provider: 'c', item: assistant('stale replay'), timestamp: 't', seq: 2, epoch: 'e' },
    })
    // Consecutive deltas merge (existing folding), and the stale replay at seq 2
    // contributes nothing extra.
    expect(subagentTurns(state, 'parent', 'sub-1')).toEqual([
      { kind: 'assistant', source: 'onetwo', messageId: undefined },
    ])
  })

  test('pushes from a different epoch are dropped until a fresh page arrives', () => {
    let state = reduceSubagents(initialSubagents, {
      type: 'timelinePush',
      push: { kind: 'timeline', parentAgentId: 'parent', subagentId: 'sub-1', provider: 'c', item: assistant('v1'), timestamp: 't', seq: 3, epoch: 'epoch-1' },
    })
    state = reduceSubagents(state, {
      type: 'timelinePush',
      push: { kind: 'timeline', parentAgentId: 'parent', subagentId: 'sub-1', provider: 'c', item: assistant('v2-gen'), timestamp: 't', seq: 4, epoch: 'epoch-2' },
    })
    expect(subagentTurns(state, 'parent', 'sub-1')).toEqual([{ kind: 'assistant', source: 'v1', messageId: undefined }])
    // A page from the new epoch re-syncs.
    state = reduceSubagents(state, { type: 'timelinePage', page: page({ epoch: 'epoch-2', rows: [{ seq: 4, item: assistant('v2-page') }], maxSeq: 4 }) })
    expect(subagentTurns(state, 'parent', 'sub-1')).toEqual([{ kind: 'assistant', source: 'v2-page', messageId: undefined }])
    expect(subagentHasOlder(state, 'parent', 'sub-1')).toBe(false)
  })
})

// ---- terminal-turn synthesis ------------------------------------------------------

describe('terminal turns', () => {
  test('failed becomes a failed turn, canceled a canceled turn, completed nothing', () => {
    expect(closingTurn('failed')).toEqual({ kind: 'error', text: 'Subagent failed' })
    expect(closingTurn('canceled')).toEqual({ kind: 'error', text: 'Subagent canceled' })
    expect(closingTurn('completed')).toBeNull()
    expect(closingTurn('running')).toBeNull()
  })

  test('the closing turn appends after streamed rows so folding works unchanged', () => {
    let state = reduceSubagents(initialSubagents, { type: 'upserted', subagent: descriptor({ status: 'failed' }) })
    state = reduceSubagents(state, {
      type: 'timelinePage',
      page: page({ rows: [{ seq: 1, item: assistant('partial work') }] }),
    })
    const turns = subagentTurns(state, 'parent', 'sub-1')
    expect(turns).toHaveLength(2)
    expect(turns[0]).toEqual({ kind: 'assistant', source: 'partial work', messageId: undefined })
    expect(turns[1]).toEqual({ kind: 'error', text: 'Subagent failed' })
  })

  test('terminal synthesis is stable across repeated projections and late pages', () => {
    let state = reduceSubagents(initialSubagents, { type: 'upserted', subagent: descriptor({ status: 'canceled' }) })
    const once = subagentTurns(state, 'parent', 'sub-1')
    expect(subagentTurns(state, 'parent', 'sub-1')).toEqual(once)
    state = reduceSubagents(state, { type: 'timelinePage', page: page({ rows: [{ seq: 1, item: assistant('work so far') }] }) })
    const turns = subagentTurns(state, 'parent', 'sub-1')
    expect(turns.at(-1)).toEqual({ kind: 'error', text: 'Subagent canceled' })
    expect(turns.filter((turn) => turn.kind === 'error')).toHaveLength(1)
  })

  test('a terminal descriptor renders its closing turn even with no timeline yet', () => {
    const state = reduceSubagents(initialSubagents, { type: 'upserted', subagent: descriptor({ status: 'failed' }) })
    expect(subagentTurns(state, 'parent', 'sub-1')).toEqual([{ kind: 'error', text: 'Subagent failed' }])
  })
})

// ---- track selection ---------------------------------------------------------------

describe('track rows', () => {
  test('managed children come from directory labels and skip archived agents', () => {
    const agents = [
      agentEntry({ id: 'kid', createdAt: '2026-08-24T09:30:00Z' }),
      agentEntry({ id: 'archived', createdAt: '2026-08-24T09:20:00Z', archivedAt: '2026-08-24T09:40:00Z' }),
      agentEntry({ id: 'stranger', labels: {} }),
      agentEntry({ id: 'other-kid', labels: { 'paseo.parent-agent-id': 'someone-else' } }),
    ]
    expect(managedChildren(agents, 'parent').map((entry) => entry.id)).toEqual(['kid'])
    expect(selectTrackRows(initialSubagents, agents, 'parent', false).map((row) => row.kind)).toEqual([
      'managed',
    ])
  })

  test('managed and provider rows merge in creation order', () => {
    const state = reduceSubagents(initialSubagents, {
      type: 'listed',
      parentAgentId: 'parent',
      subagents: [descriptor({ id: 'p-late', createdAt: '2026-08-24T11:00:00Z' })],
    })
    const agents = [agentEntry({ id: 'kid', createdAt: '2026-08-24T12:00:00Z' }), agentEntry({ id: 'elder', createdAt: '2026-08-24T08:00:00Z' })]
    const rows = selectTrackRows(state, agents, 'parent', true)
    expect(rows.map((row) => row.id)).toEqual(['elder', 'p-late', 'kid'])
    expect(mergeRows([], [])).toEqual([])
  })

  test('no parent means no rows at all', () => {
    expect(selectTrackRows(initialSubagents, [agentEntry({})], null, false)).toEqual([])
  })

  test('provider rows are suppressed while the daemon flag is off', () => {
    const state = reduceSubagents(initialSubagents, {
      type: 'listed',
      parentAgentId: 'parent',
      subagents: [descriptor({ id: 'p-kid' })],
    })
    const agents = [agentEntry({ id: 'kid', labels: { 'paseo.parent-agent-id': 'parent' } })]
    expect(selectTrackRows(state, agents, 'parent', false).map((row) => row.kind)).toEqual(['managed'])
  })
})

// ---- feature flag -------------------------------------------------------------------

describe('feature gate', () => {
  test('gates strictly on the daemon providerSubagents flag', () => {
    expect(providerSubagentsEnabled({ providerSubagents: true })).toBe(true)
    expect(providerSubagentsEnabled({ providerSubagents: false })).toBe(false)
    expect(providerSubagentsEnabled(undefined)).toBe(false)
    expect(providerSubagentsEnabled(null)).toBe(false)
  })
})
