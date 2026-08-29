import { describe, expect, test } from 'bun:test'
import {
  initialConversation,
  reduceConversation,
  visibleTurns,
  type ConversationEvent,
  type ConversationState,
} from './conversation'
import type { TimelineEntry, TimelineItem } from './paseo'
import type { ImageAttachment } from './attachments'

const user = (text: string): TimelineItem => ({ type: 'user_message', text })
const assistant = (text: string, messageId?: string): TimelineItem =>
  messageId ? { type: 'assistant_message', text, messageId } : { type: 'assistant_message', text }
const reasoning = (text: string): TimelineItem => ({ type: 'reasoning', text })

const chip = (id: string): ImageAttachment => ({ id, name: `${id}.png`, mimeType: 'image/png', data: 'aGk=' })

let idCounter = 0
const newId = () => `id-${++idCounter}`

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
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]!.text).toBe('fix the bug')
    expect(state.pending[0]!.images).toEqual([])
    expect(state.pending[0]!.id).toBeTruthy()
    expect(visibleTurns(state)).toEqual([
      { kind: 'user', text: 'fix the bug', queuedId: state.pending[0]!.id },
    ])
  })

  test('reset seeds staged chips alongside the first prompt', () => {
    const state = run([{ type: 'reset', seedText: 'what is this?', seedImages: [chip('a')] }])
    expect(state.pending[0]!.images).toEqual([chip('a')])
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

  test('a matching daemon echo settles the pending head — FIFO, one per echo', () => {
    const state = run([
      { type: 'sendQueued', id: newId(), text: 'do it' },
      { type: 'sendQueued', id: newId(), text: 'do it' },
      { type: 'timeline', item: user('do it') },
      { type: 'timeline', item: user('do it') },
    ])
    expect(state.pending).toEqual([])
    // Both echoes landed as daemon truth.
    expect(state.turns.filter((turn) => turn.kind === 'user')).toHaveLength(2)
  })

  test('an unmatched echo leaves pending alone (no text-matching false positives)', () => {
    const state = run([
      { type: 'sendQueued', id: newId(), text: 'do it' },
      { type: 'timeline', item: user('something else entirely') },
    ])
    expect(state.pending.map((send) => send.text)).toEqual(['do it'])
  })

  test('the optimistic turn disappears once settled, not before', () => {
    const mid = run([
      loadedPage([{ item: assistant('hi') }]),
      { type: 'sendQueued', id: newId(), text: 'hello' },
    ])
    expect(visibleTurns(mid).at(-1)).toEqual({ kind: 'user', text: 'hello', queuedId: mid.pending[0]!.id })
    const settled = reduceConversation(mid, { type: 'timeline', item: user('hello') })
    expect(visibleTurns(settled).filter((turn) => turn.kind === 'user')).toHaveLength(1)
    expect(settled.pending).toEqual([])
  })

  test('queued sends carry their attachments until the echo settles them', () => {
    let state = run([
      { type: 'sendQueued', id: newId(), text: 'read this', images: [chip('a'), chip('b')] },
      { type: 'sendQueued', id: newId(), text: 'and this' },
    ])
    expect(state.pending.map((send) => [send.text, send.images])).toEqual([
      ['read this', [chip('a'), chip('b')]],
      ['and this', []],
    ])
    state = reduceConversation(state, { type: 'timeline', item: user('read this') })
    // Only the matching send settles; its chips go with it.
    expect(state.pending.map((send) => send.text)).toEqual(['and this'])
  })

  test('unqueue pulls a queued send back out by id, however many share its text', () => {
    const mid = run([
      { type: 'sendQueued', id: newId(), text: 'same text' },
      { type: 'sendQueued', id: newId(), text: 'same text', images: [chip('a')] },
    ])
    const target = mid.pending[0]!
    const edited = reduceConversation(mid, { type: 'sendUnqueued', id: target.id })
    expect(edited.pending.map((send) => send.id)).toEqual([mid.pending[1]!.id])
    // Unqueueing an unknown id is a no-op.
    expect(reduceConversation(mid, { type: 'sendUnqueued', id: 'nope' })).toEqual(mid)
  })

  test('sendFailed drops the queued send and surfaces an error turn', () => {
    const queuedId = newId()
    const state = run([
      loadedPage([]),
      { type: 'sendQueued', id: queuedId, text: 'hello' },
      { type: 'sendFailed', error: new Error('daemon went away'), id: queuedId },
    ])
    expect(state.pending).toEqual([])
    expect(state.turns.at(-1)!.kind).toBe('error')
    expect((state.turns.at(-1) as { text: string }).text).toContain('daemon went away')
  })

  test('parking queues the text unsent; it stays out of the transcript', () => {
    const state = run([
      loadedPage([{ item: assistant('working…') }]),
      { type: 'sendParked', id: 'p1', text: 'hold this' },
    ])
    expect(state.pending).toEqual([{ id: 'p1', text: 'hold this', images: [], sent: false }])
    // Not yet handed to the daemon, so no optimistic transcript row either.
    expect(visibleTurns(state)).toHaveLength(1)
  })

  test('parking keeps staged chips riding along', () => {
    const state = run([{ type: 'sendParked', id: 'p1', text: 'look', images: [chip('a')] }])
    expect(state.pending[0]!.images).toEqual([chip('a')])
  })

  test('reset preserves parked sends across agent switches', () => {
    const state = run([
      { type: 'sendParked', id: 'p1', text: 'parked text' },
      { type: 'reset', seedText: 'new seed' },
    ])
    expect(state.pending.map((p) => p.text)).toEqual(['parked text', 'new seed'])
    expect(state.pending[0]!.sent).toBe(false)
    expect(state.pending[1]!.sent).toBe(true)
  })

  test('an echo settles the first in-flight match, never a parked send sharing its text', () => {
    const state = run([
      { type: 'sendParked', id: 'p1', text: 'do it' },
      { type: 'sendQueued', id: 'q1', text: 'do it' },
      { type: 'timeline', item: user('do it') },
    ])
    // The parked twin survives; only the handed-off copy settled.
    expect(state.pending.map((send) => send.id)).toEqual(['p1'])
  })

  test('settlement stays FIFO among in-flight sends even with parked ones between them', () => {
    let state = run([
      { type: 'sendQueued', id: 'q1', text: 'first' },
      { type: 'sendParked', id: 'p1', text: 'parked between' },
      { type: 'sendQueued', id: 'q2', text: 'second' },
      { type: 'timeline', item: user('first') },
    ])
    expect(state.pending.map((send) => send.id)).toEqual(['p1', 'q2'])
    state = reduceConversation(state, { type: 'timeline', item: user('second') })
    expect(state.pending.map((send) => send.id)).toEqual(['p1'])
  })

  test('releasing a parked send hands it to the daemon as an in-flight transcript row', () => {
    const state = run([
      loadedPage([{ item: assistant('working…') }]),
      { type: 'sendParked', id: 'p1', text: 'hold this' },
      { type: 'sendReleased', id: 'p1' },
    ])
    expect(state.pending).toEqual([{ id: 'p1', text: 'hold this', images: [], sent: true }])
    expect(visibleTurns(state).at(-1)).toEqual({ kind: 'user', text: 'hold this', queuedId: 'p1' })
  })

  test('releasing keeps its place among in-flight sends and settles FIFO from there', () => {
    let state = run([
      { type: 'sendQueued', id: 'q1', text: 'first' },
      { type: 'sendParked', id: 'p1', text: 'parked' },
      { type: 'sendReleased', id: 'p1' },
      { type: 'timeline', item: user('first') },
      { type: 'timeline', item: user('parked') },
    ])
    expect(state.pending).toEqual([])
  })

  test('edit-pullback works on a parked send too', () => {
    const state = run([
      { type: 'sendParked', id: 'p1', text: 'draft idea' },
      { type: 'sendUnqueued', id: 'p1' },
    ])
    expect(state.pending).toEqual([])
    expect(visibleTurns(state)).toHaveLength(0)
  })

  test('a failed release drops only its own send; parked siblings survive', () => {
    const state = run([
      { type: 'sendParked', id: 'p1', text: 'still parked' },
      { type: 'sendParked', id: 'p2', text: 'fired too soon' },
      { type: 'sendReleased', id: 'p2' },
      { type: 'sendFailed', error: new Error('daemon went away'), id: 'p2' },
    ])
    expect(state.pending.map((send) => send.id)).toEqual(['p1'])
    expect(state.turns.at(-1)!.kind).toBe('error')
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

  test('turnCompleted finishes a working assistant turn at the completion time', () => {
    let state = reduceConversation(
      initialConversation,
      { type: 'timeline', item: { type: 'assistant_message', text: 'hi' }, at: 1_000 },
    )
    state = reduceConversation(state, { type: 'timeline', item: { type: 'assistant_message', text: ' there' }, at: 2_500 })
    state = reduceConversation(state, { type: 'turnCompleted', at: 9_000 })
    const said = state.turns[0] as { kind: string; startedAt?: number; endedAt?: number }
    expect(said.kind).toBe('assistant')
    expect(said.startedAt).toBe(1_000)
    expect(said.endedAt).toBe(9_000)
  })

  test('turn_completed usage keeps the session usage fresh; reset clears it', () => {
    const usage = { contextWindowUsedTokens: 1200, contextWindowMaxTokens: 200_000 }
    let state = run([loadedPage([])])
    expect(state.usage).toBeNull()
    state = reduceConversation(state, { type: 'turnCompleted', at: 100, usage })
    expect(state.usage).toEqual(usage)
    // A later turn reports newer usage.
    const next = { ...usage, contextWindowUsedTokens: 4800, totalCostUsd: 0.09 }
    state = reduceConversation(state, { type: 'turnCompleted', at: 200, usage: next })
    expect(state.usage).toEqual(next)
    // A turn without usage leaves the last known value alone.
    expect(reduceConversation(state, { type: 'turnCompleted', at: 300 }).usage).toEqual(next)
    // Switching agents clears it.
    expect(reduceConversation(state, { type: 'reset' }).usage).toBeNull()
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

  test('turnCanceled folds to its own outcome, distinct from turnFailed', () => {
    const canceled = run([
      loadedPage([{ item: assistant('working…') }]),
      { type: 'turnCanceled', reason: 'user requested' },
    ])
    expect(canceled.turns).toHaveLength(2)
    expect((canceled.turns[1] as { kind: string; reason?: string }).kind).toBe('canceled')
    expect((canceled.turns[1] as { reason?: string }).reason).toBe('user requested')

    const failed = run([{ type: 'turnFailed', message: 'boom' }])
    expect(failed.turns[0]!.kind).toBe('error')
  })

  test('turnCanceled seals an open thinking block before landing', () => {
    let state = reduceConversation(initialConversation, { type: 'timeline', item: { type: 'reasoning', text: 'hmm' } })
    state = reduceConversation(state, { type: 'turnCanceled' })
    expect(state.turns).toHaveLength(2)
    expect(typeof (state.turns[0] as { durationMs?: number }).durationMs).toBe('number')
    expect(state.turns[1]!.kind).toBe('canceled')
  })

  test('a canceled tool call folds to its own status through the timeline path', () => {
    const state = run([
      {
        type: 'timeline',
        item: {
          type: 'tool_call',
          callId: 'c1',
          name: 'bash',
          detail: { type: 'shell', command: 'ls' },
          status: 'canceled',
          error: null,
        } as never,
      },
    ])
    expect((state.turns[0] as { kind: string; status: string }).status).toBe('canceled')
  })

  test('compaction items fold into a single divider turn, replacing prior state', () => {
    let state = run([
      loadedPage([{ item: assistant('Working on it.') }]),
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
      loadedPage([
        { item: { type: 'assistant_message', text: 'first', messageId: 'm1' } },
        { item: { type: 'assistant_message', text: 'second', messageId: 'm2' } },
      ]),
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
      loadedPage([{ item: assistant('running checks') }]),
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
      loadedPage([{ item: assistant('hello') }]),
      { type: 'usageUpdated', usage: {} },
    ])
    expect((state.turns[0] as { usage?: unknown }).usage).toBeUndefined()
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
    state = reduceConversation(state, { type: 'sendQueued', id: newId(), text: 'hello' })
    state = reduceConversation(state, appendPage([at(user('early'), 50)], { hasOlder: true }))
    const visible = visibleTurns(state)
    expect(visible.at(-1)).toEqual({ kind: 'user', text: 'hello', queuedId: expect.any(String) })
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
