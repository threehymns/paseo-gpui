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
  formatDuration,
  formatEditDiff,
  diffStats,
  reasoningLabel,
  sealTrailingReasoning,
  toolDetailParts,
  type AgentEntry,
  type ProviderEntry,
  type TimelineEntry,
  type TimelineItem,
  type ToolCallDetail,
} from './paseo'

const toolCall = (over: {
  callId?: string
  name?: string
  detail: unknown
  status?: 'running' | 'completed' | 'failed'
}): TimelineItem =>
  ({
    type: 'tool_call',
    callId: over.callId ?? 'c1',
    name: over.name ?? 'bash',
    detail: over.detail,
    status: over.status ?? 'running',
    error: null,
  }) as never

/** Wraps a bare item as a fetched/streamed entry so tests can control arrival times. */
const timed = (item: TimelineItem, at?: number): TimelineEntry => ({ item, at })

// ---- timeline mapping ------------------------------------------------------

describe('timeline mapping', () => {
  test('empty timeline builds no turns', () => {
    expect(buildTurns([])).toHaveLength(0)
  })

  test('streaming deltas merge into single turns', () => {
    const turns = buildTurns([
      timed({ type: 'user_message', text: 'fix the bug' }),
      timed({ type: 'assistant_message', text: 'Looking' }),
      timed({ type: 'assistant_message', text: ' into it.' }),
      timed(toolCall({ detail: { type: 'shell', command: 'npm test' } })),
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
    let turns = buildTurns([timed(toolCall({ detail: { type: 'shell', command: 'npm test' } }))])
    turns = applyTimelineItem(
      turns,
      toolCall({ detail: { type: 'shell', command: 'npm test', exitCode: 0 }, status: 'completed' }),
    )
    expect(turns).toHaveLength(1)
    expect((turns[0] as { status: string }).status).toBe('ok')
  })

  test('tool turns carry the structured detail alongside the flattened summary', () => {
    const turns = buildTurns([timed(toolCall({ detail: { type: 'shell', command: 'npm test' } }))])
    const tool = turns[0] as { kind: string; detail?: string; structured?: ToolCallDetail }
    expect(tool.kind).toBe('tool')
    expect(tool.detail).toBe('npm test')
    expect(tool.structured).toEqual({ type: 'shell', command: 'npm test' })
  })

  test('the structured detail survives replace-in-place streaming updates', () => {
    let turns = buildTurns([timed(toolCall({ detail: { type: 'shell', command: 'npm test' } }))])
    turns = applyTimelineItem(
      turns,
      toolCall({ detail: { type: 'shell', command: 'npm test', output: '3 passing\n', exitCode: 0 }, status: 'completed' }),
    )
    expect(turns).toHaveLength(1)
    const tool = turns[0] as {
      status: string
      detail?: string
      structured?: { type: string; command: string; output?: string; exitCode?: number }
    }
    expect(tool.status).toBe('ok')
    expect(tool.detail).toBe('npm test')
    expect(tool.structured).toEqual({ type: 'shell', command: 'npm test', output: '3 passing\n', exitCode: 0 })
  })

  test('edit tool calls carry the patch', () => {
    const turns = applyTimelineItem([], toolCall({
      callId: 'c2',
      name: 'edit_file',
      detail: { type: 'edit', filePath: 'src/x.ts', unifiedDiff: 'diff --git a/x b/x' },
      status: 'completed',
    }))
    expect((turns[0] as { patch?: string }).patch).toBe('diff --git a/x b/x')
  })

  test('edit tool calls synthesize unified diff from oldString and newString when unifiedDiff is absent', () => {
    const turns = applyTimelineItem([], toolCall({
      callId: 'c3',
      name: 'edit_file',
      detail: {
        type: 'edit',
        filePath: 'src/x.ts',
        oldString: 'const a = 1\n',
        newString: 'const a = 2\n',
      },
      status: 'completed',
    }))
    const turn = turns[0] as { patch?: string }
    expect(turn.patch).toBe('--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-const a = 1\n+const a = 2')
  })

  test('formatEditDiff handles multi-line edits, additions, and deletions', () => {
    expect(formatEditDiff('lib/util.ts', 'line1\nline2\n', 'line1\nline2-modified\nline3\n')).toBe(
      '--- a/lib/util.ts\n+++ b/lib/util.ts\n@@ -1,2 +1,3 @@\n-line1\n-line2\n+line1\n+line2-modified\n+line3',
    )
    expect(formatEditDiff('lib/new.ts', '', 'hello\nworld')).toBe(
      '--- a/lib/new.ts\n+++ b/lib/new.ts\n@@ -0,0 +1,2 @@\n+hello\n+world',
    )
    expect(formatEditDiff('lib/old.ts', 'bye\n', '')).toBe(
      '--- a/lib/old.ts\n+++ b/lib/old.ts\n@@ -1,1 +0,0 @@\n-bye',
    )
  })

  test('diffStats counts additions and deletions ignoring diff headers', () => {
    expect(diffStats(undefined)).toBeUndefined()
    expect(diffStats('')).toBeUndefined()
    expect(diffStats('--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n context line')).toBeUndefined()
    expect(diffStats('--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n-line1\n-line2\n+line1\n+line2-mod\n+line3')).toEqual({
      additions: 3,
      deletions: 2,
    })
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

// ---- reasoning timing -------------------------------------------------------

describe('reasoning timing', () => {
  test('formatDuration renders human-readable amounts', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(-5)).toBe('0s')
    expect(formatDuration(Number.NaN)).toBe('0s')
    expect(formatDuration(400)).toBe('0s')
    expect(formatDuration(5_000)).toBe('5s')
    expect(formatDuration(59_999)).toBe('59s')
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(3_600_000)).toBe('1h')
    expect(formatDuration(7_500_000)).toBe('2h 5m')
  })

  test('reasoningLabel shows live progress while open, then the frozen duration', () => {
    let turns = applyTimelineItem([], { type: 'reasoning', text: 'hmm' }, 1_000)
    const open = turns[0] as { kind: 'reasoning'; text: string; startedAt?: number; lastDeltaAt?: number; durationMs?: number }
    expect(open.startedAt).toBe(1_000)
    expect(open.durationMs).toBeUndefined()
    expect(reasoningLabel(open)).toBe('Thinking…')
    turns = applyTimelineItem(turns, { type: 'reasoning', text: '…' }, 6_000)
    // Sealing long after the last delta must not inflate the length.
    const sealed = sealTrailingReasoning(turns, 99_999)[0] as { kind: 'reasoning'; text: string; durationMs?: number }
    expect(sealed.durationMs).toBe(5_000)
    expect(reasoningLabel(sealed)).toBe('Thought for 5s')
  })

  test('deltas merge keeping the first timestamp and advancing the last', () => {
    let turns = applyTimelineItem([], { type: 'reasoning', text: 'a' }, 1_000)
    turns = applyTimelineItem(turns, { type: 'reasoning', text: 'b' }, 1_400)
    turns = applyTimelineItem(turns, { type: 'reasoning', text: 'c' }, 2_000)
    const turn = turns[0] as { kind: string; text: string; startedAt?: number; lastDeltaAt?: number }
    expect(turn.text).toBe('abc')
    expect(turn.startedAt).toBe(1_000)
    expect(turn.lastDeltaAt).toBe(2_000)
  })

  test('the next appended item seals the trailing block at its last delta, not the item time', () => {
    const turns = buildTurns([
      timed({ type: 'reasoning', text: 'thinking' }, 1_000),
      timed({ type: 'reasoning', text: ' more' }, 4_000),
      // A long pause before anything else arrives must not count as thinking.
      timed({ type: 'user_message', text: 'go on' }, 60_000),
      timed({ type: 'assistant_message', text: 'ok' }, 61_000),
    ])
    const thinking = turns[0] as { kind: string; durationMs?: number }
    expect(thinking.kind).toBe('reasoning')
    expect(thinking.durationMs).toBe(3_000)
    expect(reasoningLabel(turns[0] as never)).toBe('Thought for 3s')
  })

  test('fetched history folds to sealed durations from entry timestamps', () => {
    const turns = buildTurns([
      timed(toolCall({ detail: { type: 'shell', command: 'ls' } }), 1_000),
      timed({ type: 'reasoning', text: 'reading output' }, 2_000),
      timed({ type: 'reasoning', text: '…' }, 5_500),
      timed({ type: 'assistant_message', text: 'Here is what I found.' }, 6_000),
    ])
    const tool = turns[0] as { kind: string }
    const thinking = turns[1] as { kind: string; durationMs?: number }
    expect(tool.kind).toBe('tool')
    expect(thinking.kind).toBe('reasoning')
    expect(thinking.durationMs).toBe(3_500)
  })

  test('replace-in-place updates do not seal a trailing block started after that call', () => {
    let turns = buildTurns([
      timed(toolCall({ callId: 'c1', detail: { type: 'shell', command: 'npm test' }, status: 'running' }), 1_000),
      timed({ type: 'reasoning', text: 'watching tests' }, 2_000),
    ])
    turns = applyTimelineItem(
      turns,
      toolCall({ callId: 'c1', detail: { type: 'shell', command: 'npm test', exitCode: 0 }, status: 'completed' }),
      9_000,
    )
    const thinking = turns[1] as { kind: string; durationMs?: number }
    expect(thinking.kind).toBe('reasoning')
    expect(thinking.durationMs).toBeUndefined()
    expect(reasoningLabel(thinking as never)).toBe('Thinking…')
  })

  test('reasoning after an interleaved tool call starts a fresh block', () => {
    const turns = buildTurns([
      timed({ type: 'reasoning', text: 'first' }, 1_000),
      timed({ type: 'reasoning', text: ' run' }, 1_800),
      timed({ type: 'assistant_message', text: 'partial' }, 2_000),
      timed({ type: 'reasoning', text: 'second run' }, 10_000),
      timed({ type: 'assistant_message', text: '!done' }, 12_000),
    ])
    const blocks = turns.filter((t) => t.kind === 'reasoning') as { kind: string; text: string; durationMs?: number }[]
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.kind).toBe('reasoning')
    expect(blocks[0]?.text).toBe('first run')
    expect(blocks[0]?.durationMs).toBe(800)
    expect(blocks[1]?.text).toBe('second run')
    // A block from a single delta measures zero — nothing elapsed between its start and end.
    expect(blocks[1]?.durationMs).toBe(0)
  })

  test('sealing is idempotent and skips non-reasoning tails', () => {
    const turns = buildTurns([
      timed({ type: 'reasoning', text: 'done' }, 1_000),
      timed({ type: 'assistant_message', text: 'answer' }, 3_000),
    ])
    expect(sealTrailingReasoning(turns, 99_999)).toEqual(turns)
    const sealed = sealTrailingReasoning(buildTurns([timed({ type: 'reasoning', text: 'x' }, 1_000)]), 4_000)
    expect(sealTrailingReasoning(sealed, 99_999)).toEqual(sealed)
  })
})

// ---- expanded tool detail ---------------------------------------------------

describe('tool detail parts', () => {
  test('shell shows output then exit code, colored by success', () => {
    const ok = toolDetailParts({ type: 'shell', command: 'npm test', output: '3 passing\n', exitCode: 0 })
    expect(ok).toEqual([
      { type: 'log', text: '3 passing' },
      { type: 'meta', text: 'exit 0', tone: 'ok' },
    ])
    expect(toolDetailParts({ type: 'shell', command: 'rm -rf /', output: 'nope', exitCode: 1 })).toEqual([
      { type: 'log', text: 'nope' },
      { type: 'meta', text: 'exit 1', tone: 'danger' },
    ])
  })

  test('shell with neither output nor exit code is not expandable', () => {
    expect(toolDetailParts({ type: 'shell', command: 'npm test' })).toEqual([])
    expect(toolDetailParts({ type: 'shell', command: 'npm test', output: '   ', exitCode: null })).toEqual([])
  })

  test('search shows match/file counts and result paths', () => {
    const parts = toolDetailParts({
      type: 'search',
      query: 'useReducer',
      numMatches: 1,
      numFiles: 2,
      filePaths: ['src/a.ts', 'src/b.ts'],
    })
    expect(parts).toEqual([
      { type: 'meta', text: '1 match in 2 files' },
      { type: 'log', label: 'paths', text: 'src/a.ts\nsrc/b.ts' },
    ])
    expect(
      toolDetailParts({ type: 'search', query: 'q', numMatches: 5 })[0],
    ).toEqual({ type: 'meta', text: '5 matches' })
    expect(
      toolDetailParts({ type: 'search', query: 'q', numFiles: 3 })[0],
    ).toEqual({ type: 'meta', text: '3 files' })
  })

  test('web search shows results as paths', () => {
    const parts = toolDetailParts({
      type: 'search',
      query: 'gpui',
      toolName: 'web_search',
      numMatches: 2,
      webResults: [
        { title: 'GPUI docs', url: 'https://example.com/gpui' },
        { title: 'https://plain.url', url: 'https://plain.url' },
      ],
    })
    expect(parts).toEqual([
      { type: 'meta', text: '2 results' },
      {
        type: 'log',
        label: 'results',
        text: 'GPUI docs\n  https://example.com/gpui\nhttps://plain.url',
      },
    ])
  })

  test('fetch shows status code and result text', () => {
    expect(toolDetailParts({ type: 'fetch', url: 'https://x.dev', code: 200, codeText: 'OK', result: '<html>' })).toEqual([
      { type: 'meta', text: '200 OK', tone: 'ok' },
      { type: 'log', text: '<html>' },
    ])
    expect(toolDetailParts({ type: 'fetch', url: 'https://x.dev', code: 404 })[0]).toEqual({
      type: 'meta',
      text: '404',
      tone: 'danger',
    })
    expect(toolDetailParts({ type: 'fetch', url: 'https://x.dev', result: 'body' })).toEqual([
      { type: 'log', text: 'body' },
    ])
  })

  test('worktree setup renders each step with its log', () => {
    const parts = toolDetailParts({
      type: 'worktree_setup',
      worktreePath: '/wt',
      branchName: 'feature',
      log: '',
      commands: [
        { index: 1, command: 'bun install', cwd: '/wt', log: 'installed 156 packages', status: 'completed', exitCode: 0 },
        { index: 2, command: 'bun test', cwd: '/wt', log: '', status: 'failed', exitCode: 1 },
        { index: 3, command: 'bun lint', cwd: '/wt', log: 'linting…', status: 'running', exitCode: null },
      ],
    })
    expect(parts).toEqual([
      { type: 'meta', text: '✓ bun install', tone: 'ok' },
      { type: 'log', text: 'installed 156 packages' },
      { type: 'meta', text: '✗ bun test (exit 1)', tone: 'danger' },
      { type: 'meta', text: '• bun lint' },
      { type: 'log', text: 'linting…' },
    ])
  })

  test('worktree setup without steps falls back to its raw log', () => {
    expect(
      toolDetailParts({ type: 'worktree_setup', worktreePath: '/wt', branchName: 'b', log: 'did things', commands: [] }),
    ).toEqual([{ type: 'log', text: 'did things' }])
  })

  test('sub-agent shows its step log followed by action summaries', () => {
    const parts = toolDetailParts({
      type: 'sub_agent',
      subAgentType: 'explore',
      description: 'find callers',
      childSessionId: 's1',
      log: 'reading src/x.ts\nreading src/y.ts',
      actions: [
        { index: 1, toolName: 'read', summary: 'src/x.ts' },
        { index: 2, toolName: 'grep' },
      ],
    })
    expect(parts).toEqual([
      { type: 'log', text: 'reading src/x.ts\nreading src/y.ts' },
      { type: 'meta', text: 'read: src/x.ts' },
      { type: 'meta', text: 'grep' },
    ])
  })

  test('kinds without a structured detail view are not expandable', () => {
    expect(toolDetailParts({ type: 'read', filePath: 'a.ts' })).toEqual([])
    expect(toolDetailParts({ type: 'write', filePath: 'a.ts' })).toEqual([])
    expect(toolDetailParts({ type: 'edit', filePath: 'a.ts', unifiedDiff: 'diff' })).toEqual([])
    expect(toolDetailParts({ type: 'plan', text: 'the plan' })).toEqual([])
    expect(toolDetailParts({ type: 'plain_text', text: 'hi' })).toEqual([])
    expect(toolDetailParts({ type: 'unknown', input: {}, output: {} })).toEqual([])
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
