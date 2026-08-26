import { describe, expect, test } from 'bun:test'
import {
  initialConversation,
  reduceConversation,
  visibleTurns,
  type ConversationEvent,
  type ConversationState,
} from './conversation'
import type { TimelineItem } from './paseo'

const user = (text: string): TimelineItem => ({ type: 'user_message', text })
const assistant = (text: string): TimelineItem => ({ type: 'assistant_message', text })

function run(events: ConversationEvent[]): ConversationState {
  return events.reduce(reduceConversation, initialConversation)
}

describe('agent conversation', () => {
  test('reset seeds the pending queue for a freshly created agent', () => {
    const state = run([{ type: 'reset', seedText: 'fix the bug' }])
    expect(state.pending).toEqual(['fix the bug'])
    expect(visibleTurns(state)).toEqual([{ kind: 'user', text: 'fix the bug' }])
  })

  test('loaded replaces turns and marks ready', () => {
    const state = run([
      { type: 'reset', seedText: 'fix the bug' },
      { type: 'loaded', items: [{ item: user('fix the bug') }, { item: assistant('On it.') }] },
    ])
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.turns).toHaveLength(2)
  })

  test('a matching server echo settles the pending head — FIFO, one per echo', () => {
    const state = run([
      { type: 'sendQueued', text: 'do it' },
      { type: 'sendQueued', text: 'do it' },
      { type: 'timeline', item: user('do it') },
      { type: 'timeline', item: user('do it') },
    ])
    expect(state.pending).toEqual([])
    // Both echoes landed as server truth.
    expect(state.turns.filter((turn) => turn.kind === 'user')).toHaveLength(2)
  })

  test('an unmatched echo leaves pending alone (no text-matching false positives)', () => {
    const state = run([
      { type: 'sendQueued', text: 'do it' },
      { type: 'timeline', item: user('something else entirely') },
    ])
    expect(state.pending).toEqual(['do it'])
  })

  test('the optimistic turn disappears once settled, not before', () => {
    const mid = run([
      { type: 'loaded', items: [{ item: assistant('hi') }] },
      { type: 'sendQueued', text: 'hello' },
    ])
    expect(visibleTurns(mid).at(-1)).toEqual({ kind: 'user', text: 'hello' })
    const settled = reduceConversation(mid, { type: 'timeline', item: user('hello') })
    expect(visibleTurns(settled).filter((turn) => turn.kind === 'user')).toHaveLength(1)
    expect(settled.pending).toEqual([])
  })

  test('sendFailed drops the queued send and surfaces an error turn', () => {
    const state = run([
      { type: 'loaded', items: [] },
      { type: 'sendQueued', text: 'hello' },
      { type: 'sendFailed', error: new Error('daemon went away') },
    ])
    expect(state.pending).toEqual([])
    expect(state.turns.at(-1)!.kind).toBe('error')
    expect((state.turns.at(-1) as { text: string }).text).toContain('daemon went away')
  })

  test('turnFailed becomes an error turn in the transcript', () => {
    const state = run([{ type: 'turnFailed', message: 'model overloaded' }])
    expect((state.turns[0] as { text?: string }).text).toBe('model overloaded')
  })

  test('turnCompleted seals a trailing thinking block so its label freezes', () => {
    let state = reduceConversation(initialConversation, { type: 'timeline', item: { type: 'reasoning', text: 'hmm' } })
    expect(state.turns[0]?.kind).toBe('reasoning')
    expect(state.turns[0] && 'durationMs' in state.turns[0] ? state.turns[0].durationMs : undefined).toBeUndefined()
    state = reduceConversation(state, { type: 'turnCompleted' })
    const thinking = state.turns[0] as { kind: string; durationMs?: number }
    expect(thinking.kind).toBe('reasoning')
    expect(typeof thinking.durationMs).toBe('number')
    expect(state.turns).toHaveLength(1)
  })

  test('loadFailed marks the conversation errored instead of hanging on loading', () => {
    const state = run([{ type: 'loadFailed', error: new Error('archived') }])
    expect(state.status).toBe('error')
    expect(state.error).toBe('archived')
    // A later successful load recovers it.
    const recovered = reduceConversation(state, { type: 'loaded', items: [{ item: assistant('back') }] })
    expect(recovered.status).toBe('ready')
    expect(recovered.error).toBeNull()
  })

  test('timeline items fold through unchanged semantics (tool replace-by-callId)', () => {
    let state = initialConversation
    state = reduceConversation(state, {
      type: 'timeline',
      item: {
        type: 'tool_call',
        callId: 'c1',
        name: 'bash',
        detail: { type: 'shell', command: 'ls' },
        status: 'running',
        error: null,
      } as never,
    })
    state = reduceConversation(state, {
      type: 'timeline',
      item: {
        type: 'tool_call',
        callId: 'c1',
        name: 'bash',
        detail: { type: 'shell', command: 'ls' },
        status: 'completed',
        error: null,
      } as never,
    })
    expect(state.turns).toHaveLength(1)
  })

  test('compaction items fold into a single divider turn, replacing prior state', () => {
    let state = run([
      { type: 'loaded', items: [{ item: assistant('Working on it.') }] },
      { type: 'timeline', item: { type: 'compaction', status: 'loading' } as never },
      { type: 'timeline', item: { type: 'compaction', status: 'completed', trigger: 'auto' } as never },
    ])
    const dividers = state.turns.filter((turn) => turn.kind === 'compaction')
    expect(dividers).toHaveLength(1)
    expect(dividers[0]).toEqual({ kind: 'compaction', status: 'completed', trigger: 'auto' })
    // The assistant turn before it is untouched.
    expect(state.turns[0]!.kind).toBe('assistant')
  })

  test('usage_updated lands on the newest assistant turn as a footer summary', () => {
    let state = run([
      {
        type: 'loaded',
        items: [
          { item: { type: 'assistant_message', text: 'first', messageId: 'm1' } },
          { item: { type: 'assistant_message', text: 'second', messageId: 'm2' } },
        ],
      },
      { type: 'usageUpdated', usage: { inputTokens: 100, outputTokens: 20, totalCostUsd: 0.01 } },
    ])
    expect(state.turns).toHaveLength(2)
    expect((state.turns[1] as { usage?: unknown }).usage).toEqual({ totalTokens: 120, costUsd: 0.01 })
    expect((state.turns[0] as { usage?: unknown }).usage).toBeUndefined()
  })

  test('turnCompleted attaches its usage and still seals trailing thinking', () => {
    let state = reduceConversation(initialConversation, { type: 'timeline', item: { type: 'reasoning', text: 'hmm' } })
    state = reduceConversation(state, {
      type: 'turnCompleted',
      usage: { outputTokens: 7 },
    })
    const thinking = state.turns[0] as { kind: string; durationMs?: number }
    expect(thinking.kind).toBe('reasoning')
    expect(typeof thinking.durationMs).toBe('number')
    // No assistant turn to attach to; nothing invented.
    expect(state.turns).toHaveLength(1)
  })

  test('turnCompleted usage attaches after an assistant turn followed by tool rows', () => {
    let state = run([
      { type: 'timeline', item: assistant('running checks') },
      {
        type: 'timeline',
        item: {
          type: 'tool_call',
          callId: 'c1',
          name: 'bash',
          detail: { type: 'shell', command: 'npm test' },
          status: 'completed',
          error: null,
        } as never,
      },
      { type: 'turnCompleted', usage: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 2 } },
    ])
    expect((state.turns[0] as { usage?: unknown }).usage).toEqual({ totalTokens: 17 })
  })

  test('usage events without any token or cost data change nothing', () => {
    const state = run([
      { type: 'timeline', item: assistant('hello') },
      { type: 'usageUpdated', usage: {} },
    ])
    expect((state.turns[0] as { usage?: unknown }).usage).toBeUndefined()
  })
})
