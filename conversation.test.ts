import { describe, expect, test } from 'bun:test'
import {
  initialConversation,
  reduceConversation,
  visibleTurns,
  type ConversationEvent,
  type ConversationState,
} from './conversation'
import type { TimelineItem } from './paseo'
import type { ImageAttachment } from './attachments'

const user = (text: string): TimelineItem => ({ type: 'user_message', text })
const assistant = (text: string): TimelineItem => ({ type: 'assistant_message', text })

const chip = (id: string): ImageAttachment => ({ id, name: `${id}.png`, mimeType: 'image/png', data: 'aGk=' })

function run(events: ConversationEvent[]): ConversationState {
  return events.reduce(reduceConversation, initialConversation)
}

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
      { type: 'loaded', items: [{ item: user('fix the bug') }, { item: assistant('On it.') }] },
    ])
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.turns).toHaveLength(2)
  })

  test('a matching daemon echo settles the pending head — FIFO, one per echo', () => {
    const state = run([
      { type: 'sendQueued', text: 'do it' },
      { type: 'sendQueued', text: 'do it' },
      { type: 'timeline', item: user('do it') },
      { type: 'timeline', item: user('do it') },
    ])
    expect(state.pending).toEqual([])
    // Both echoes landed as daemon truth.
    expect(state.turns.filter((turn) => turn.kind === 'user')).toHaveLength(2)
  })

  test('an unmatched echo leaves pending alone (no text-matching false positives)', () => {
    const state = run([
      { type: 'sendQueued', text: 'do it' },
      { type: 'timeline', item: user('something else entirely') },
    ])
    expect(state.pending.map((send) => send.text)).toEqual(['do it'])
  })

  test('the optimistic turn disappears once settled, not before', () => {
    const mid = run([
      { type: 'loaded', items: [{ item: assistant('hi') }] },
      { type: 'sendQueued', text: 'hello' },
    ])
    expect(visibleTurns(mid).at(-1)).toEqual({ kind: 'user', text: 'hello', queuedId: mid.pending[0]!.id })
    const settled = reduceConversation(mid, { type: 'timeline', item: user('hello') })
    expect(visibleTurns(settled).filter((turn) => turn.kind === 'user')).toHaveLength(1)
    expect(settled.pending).toEqual([])
  })

  test('queued sends carry their attachments until the echo settles them', () => {
    let state = run([
      { type: 'sendQueued', text: 'read this', images: [chip('a'), chip('b')] },
      { type: 'sendQueued', text: 'and this' },
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
      { type: 'sendQueued', text: 'same text' },
      { type: 'sendQueued', text: 'same text', images: [chip('a')] },
    ])
    const target = mid.pending[0]!
    const edited = reduceConversation(mid, { type: 'sendUnqueued', id: target.id })
    expect(edited.pending.map((send) => send.id)).toEqual([mid.pending[1]!.id])
    // Unqueueing an unknown id is a no-op.
    expect(reduceConversation(mid, { type: 'sendUnqueued', id: 'nope' })).toEqual(mid)
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
})
