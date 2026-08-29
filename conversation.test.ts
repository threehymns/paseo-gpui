import { describe, expect, test } from 'bun:test'
import {
  initialConversation,
  reduceConversation,
  visibleTurns,
  type ConversationEvent,
  type ConversationState,
} from './conversation'
import type { TimelineEntry, TimelineItem } from './paseo'

const user = (text: string): TimelineItem => ({ type: 'user_message', text })
const assistant = (text: string, messageId?: string): TimelineItem =>
  messageId ? { type: 'assistant_message', text, messageId } : { type: 'assistant_message', text }
const reasoning = (text: string): TimelineItem => ({ type: 'reasoning', text })

function run(events: ConversationEvent[]): ConversationState {
  return events.reduce(reduceConversation, initialConversation)
}

const at = (item: TimelineItem, ms: number): TimelineEntry => ({ item, at: ms })

type CursorOpts = { hasOlder?: boolean; oldestCursor?: { epoch: string; seq: number } | null }

const page = (items: TimelineEntry[], opts: CursorOpts = {}) => ({
  items,
  hasOlder: opts.hasOlder ?? false,
  oldestCursor: opts.oldestCursor ?? null,
})

const loadedPage = (items: TimelineEntry[], opts: CursorOpts = {}): ConversationEvent => ({
  type: 'loaded',
  page: page(items, opts),
})

describe('agent conversation', () => {
  test('reset seeds the pending queue for a freshly created agent', () => {
    const state = run([{ type: 'reset', seedText: 'fix the bug' }])
    expect(state.pending).toEqual(['fix the bug'])
    expect(visibleTurns(state)).toEqual([{ kind: 'user', text: 'fix the bug' }])
  })

  test('loaded replaces turns and marks ready', () => {
    const state = run([
      { type: 'reset', seedText: 'fix the bug' },
      loadedPage([{ item: user('fix the bug') }, { item: assistant('On it.') }]),
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
      loadedPage([{ item: assistant('hi') }]),
      { type: 'sendQueued', text: 'hello' },
    ])
    expect(visibleTurns(mid).at(-1)).toEqual({ kind: 'user', text: 'hello' })
    const settled = reduceConversation(mid, { type: 'timeline', item: user('hello') })
    expect(visibleTurns(settled).filter((turn) => turn.kind === 'user')).toHaveLength(1)
    expect(settled.pending).toEqual([])
  })

  test('sendFailed drops the queued send and surfaces an error turn', () => {
    const state = run([
      loadedPage([]),
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
    const recovered = reduceConversation(state, loadedPage([{ item: assistant('back') }]))
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
})

describe('history paging', () => {
  const cursor = (seq: number) => ({ epoch: 'e1', seq })

  const appendPage = (items: TimelineEntry[], opts: CursorOpts = {}): ConversationEvent => ({
    type: 'historyAppended',
    page: page(items, opts),
  })

  test('an appended page lands before existing turns in original order', () => {
    const state = run([
      loadedPage([at(user('later question'), 200)], { hasOlder: true, oldestCursor: cursor(10) }),
      appendPage([at(user('earlier question'), 90), at(assistant('earlier answer'), 100)]),
    ])
    expect(state.turns.map((turn) => turn.kind)).toEqual(['user', 'assistant', 'user'])
    expect(state.turns[0]).toEqual({ kind: 'user', text: 'earlier question' })
    expect((state.turns[1] as { source: string }).source).toBe('earlier answer')
    expect(state.turns[2]).toEqual({ kind: 'user', text: 'later question' })
  })

  test('appended pages accumulate in order until history is exhausted', () => {
    let state = run([
      loadedPage([at(user('p3'), 300)], { hasOlder: true, oldestCursor: cursor(30) }),
    ])
    state = reduceConversation(state, appendPage([at(user('p2'), 200)], { hasOlder: true, oldestCursor: cursor(20) }))
    expect(state.hasOlder).toBe(true)
    expect(state.oldestCursor).toEqual(cursor(20))
    state = reduceConversation(state, appendPage([at(user('p1'), 100)], { hasOlder: false, oldestCursor: cursor(10) }))
    const texts = state.turns.map((turn) => (turn.kind === 'user' ? turn.text : ''))
    expect(texts).toEqual(['p1', 'p2', 'p3'])
    // Exhausted: the flag flips off and the stored cursor is the oldest page's.
    expect(state.hasOlder).toBe(false)
    expect(state.oldestCursor).toEqual(cursor(10))
  })

  test('a page without a cursor stops paging instead of wedging on a dead cursor', () => {
    let state = run([loadedPage([at(user('q'), 200)], { hasOlder: true, oldestCursor: cursor(10) })])
    // The daemon claimed more history but handed back no way to reach it.
    state = reduceConversation(state, appendPage([at(user('old'), 100)], { hasOlder: true, oldestCursor: null }))
    expect(state.hasOlder).toBe(false)
    expect(state.oldestCursor).toEqual(cursor(10))
  })

  test('an empty page ends paging instead of looping on the same cursor', () => {
    let state = run([loadedPage([at(user('q'), 200)], { hasOlder: true, oldestCursor: cursor(10) })])
    state = reduceConversation(
      state,
      appendPage([], { hasOlder: true, oldestCursor: cursor(5) }),
    )
    expect(state.hasOlder).toBe(false)
    expect(state.oldestCursor).toEqual(cursor(5))
  })

  test('streaming merges survive across a paged load', () => {
    let state = run([loadedPage([at(user('q'), 200)], { hasOlder: true, oldestCursor: cursor(10) })])
    state = reduceConversation(state, { type: 'timeline', item: assistant('Hel'), at: 210 })
    state = reduceConversation(state, { type: 'timeline', item: assistant('lo there'), at: 220 })
    state = reduceConversation(state, appendPage([at(user('older q'), 80), at(assistant('older '), 90)]))
    expect(state.turns.map((turn) => turn.kind)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect((state.turns[3] as { source: string }).source).toBe('Hello there')
    // The streamed deltas were captured, so a later prepend still sees them.
    state = reduceConversation(state, appendPage([at(user('oldest'), 50)]))
    expect((state.turns[4] as { source: string }).source).toBe('Hello there')
  })

  test('a page ending mid-message continues into the matching assistant turn', () => {
    const state = run([
      loadedPage([at(assistant('world', 'm1'), 200)]),
      appendPage([at(user('q'), 90), at(assistant('hello ', 'm1'), 100)]),
    ])
    expect(state.turns).toHaveLength(2)
    expect(state.turns[0]).toEqual({ kind: 'user', text: 'q' })
    expect((state.turns[1] as { source: string }).source).toBe('hello world')
  })

  test('reasoning continuing across the boundary stays one open block timed from its start', () => {
    let state = run([
      loadedPage([at(reasoning('definitely'), 500)], { hasOlder: true, oldestCursor: cursor(10) }),
    ])
    state = reduceConversation(state, { type: 'timeline', item: reasoning(' maybe'), at: 600 })
    state = reduceConversation(state, appendPage([at(reasoning('hmm '), 400)]))
    expect(state.turns).toHaveLength(1)
    const thinking = state.turns[0] as { kind: string; text: string; startedAt?: number; durationMs?: number }
    expect(thinking.text).toBe('hmm definitely maybe')
    expect(thinking.startedAt).toBe(400)
    expect(thinking.durationMs).toBeUndefined()
  })

  test('tool lifecycle spanning the boundary folds to one replaced turn', () => {
    const running = (status: 'running' | 'completed'): TimelineItem =>
      ({
        type: 'tool_call',
        callId: 'c1',
        name: 'bash',
        detail: { type: 'shell', command: 'npm test' },
        status,
        error: null,
      }) as never
    const state = run([
      loadedPage([at(running('completed'), 200)]),
      appendPage([at(user('run tests'), 90), at(running('running'), 100)]),
    ])
    expect(state.turns).toHaveLength(2)
    const tool = state.turns[1] as { kind: string; status: string }
    expect(tool.status).toBe('ok')
  })

  test('loadingHistory toggles while a page is in flight and clears on failure', () => {
    let state = run([loadedPage([at(user('q'), 1)], { hasOlder: true, oldestCursor: cursor(5) })])
    state = reduceConversation(state, { type: 'historyStarted' })
    expect(state.loadingHistory).toBe(true)
    state = reduceConversation(state, { type: 'historyFailed' })
    expect(state.loadingHistory).toBe(false)
    expect(state.status).toBe('ready')
    state = reduceConversation(state, { type: 'historyStarted' })
    state = reduceConversation(
      state,
      appendPage([at(user('old'), 0)], { hasOlder: false, oldestCursor: cursor(1) }),
    )
    expect(state.loadingHistory).toBe(false)
    expect(state.hasOlder).toBe(false)
  })

  test('a fresh load replaces paged history with daemon truth', () => {
    let state = run([loadedPage([at(user('q'), 200)])])
    state = reduceConversation(state, appendPage([at(user('old'), 100)], { hasOlder: true, oldestCursor: cursor(5) }))
    expect(state.hasOlder).toBe(true)
    state = reduceConversation(state, loadedPage([at(user('fresh'), 300)]))
    expect(state.entries.map((entry) => entry.item)).toEqual([user('fresh')])
    expect(state.hasOlder).toBe(false)
    expect(state.oldestCursor).toBeNull()
    expect(state.loadingHistory).toBe(false)
  })

  test('a load claiming older history without a cursor cannot page', () => {
    const state = run([
      loadedPage([at(user('q'), 200)], { hasOlder: true, oldestCursor: null }),
    ])
    expect(state.hasOlder).toBe(false)
    expect(state.oldestCursor).toBeNull()
  })

  test('pending sends stay optimistic across a paged load', () => {
    let state = run([loadedPage([at(assistant('hi'), 100)])])
    state = reduceConversation(state, { type: 'sendQueued', text: 'hello' })
    state = reduceConversation(state, appendPage([at(user('early'), 50)], { hasOlder: true }))
    const visible = visibleTurns(state)
    expect(visible.at(-1)).toEqual({ kind: 'user', text: 'hello' })
    expect(visible.filter((turn) => turn.kind === 'user')).toHaveLength(2)
  })

  test('a turn_completed-sealed trailing reasoning tail is not resurrected open by a re-fold', () => {
    let state = run([
      loadedPage([at(reasoning('thinking'), 400), at(assistant('answer'), 500)], {
        hasOlder: true,
        oldestCursor: cursor(10),
      }),
    ])
    // The turn ends on reasoning; turn_completed (not a timeline entry) seals it.
    state = reduceConversation(state, { type: 'timeline', item: reasoning(' tail'), at: 600 })
    state = reduceConversation(state, { type: 'turnCompleted', at: 700 })
    const before = state.turns.at(-1) as { kind: string; durationMs?: number }
    expect(before.kind).toBe('reasoning')
    expect(before.durationMs).toBeDefined()
    // Prepending a page re-folds entries; the seal must carry across.
    state = reduceConversation(state, appendPage([at(user('older'), 50)]))
    const after = state.turns.at(-1) as { kind: string; durationMs?: number }
    expect(after.kind).toBe('reasoning')
    expect(after.durationMs).toBe(before.durationMs)
  })

  test('a turn_failed error card survives a history-page re-fold', () => {
    let state = run([loadedPage([at(user('q'), 200)], { hasOlder: true, oldestCursor: cursor(10) })])
    state = reduceConversation(state, { type: 'turnFailed', message: 'model overloaded' })
    expect(state.turns.at(-1)).toEqual({ kind: 'error', text: 'model overloaded' })
    state = reduceConversation(state, appendPage([at(user('older'), 50)]))
    expect(state.turns.at(-1)).toEqual({ kind: 'error', text: 'model overloaded' })
  })
})
