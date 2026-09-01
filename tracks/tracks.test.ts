import { describe, expect, test } from 'bun:test'
import { applyTimelineItem, buildTurns, type TimelineEntry, type TimelineItem } from '../daemon/paseo'
import { changesTrack, tasksTrack } from './tracks'

const timed = (item: TimelineItem, at?: number): TimelineEntry => ({ item, at })

const todo = (items: { text: string; completed?: boolean; status?: string }[]): TimelineItem =>
  ({ type: 'todo', items }) as never

// ---- tasks pill ------------------------------------------------------------

describe('tasksTrack', () => {
  test('summarizes the latest todo snapshot and follows newer ones', () => {
    const turns = buildTurns([
      timed({ type: 'user_message', text: 'ship it' }),
      timed(todo([{ text: 'a', completed: true }, { text: 'b' }, { text: 'c' }])),
      timed({ type: 'assistant_message', text: 'working' }),
      timed(todo([
        { text: 'a', completed: true, status: 'completed' },
        { text: 'b' },
        { text: 'c' },
        { text: 'd' },
      ])),
    ])
    // The fold marks the first unfinished item active even without an explicit status.
    expect(tasksTrack(turns)).toEqual({ completed: 1, total: 4, active: 'b' })
  })

  test('a fully completed snapshot carries no active text', () => {
    const turns = buildTurns([
      timed(todo([
        { text: 'a', status: 'completed' },
        { text: 'b', completed: true },
      ])),
    ])
    expect(tasksTrack(turns)).toEqual({ completed: 2, total: 2 })
  })

  test('is null when the timeline has no todos', () => {
    const turns = buildTurns([timed({ type: 'user_message', text: 'hi' })])
    expect(tasksTrack(turns)).toBeNull()
    expect(tasksTrack(buildTurns([]))).toBeNull()
  })

  test('is null for an empty latest snapshot', () => {
    expect(tasksTrack(buildTurns([timed(todo([]))]))).toBeNull()
  })
})

// ---- diffstat pill ----------------------------------------------------------

const editCall = (over: {
  callId?: string
  unifiedDiff?: string
  oldString?: string
  newString?: string
  status?: 'running' | 'completed' | 'failed'
}): TimelineItem =>
  ({
    type: 'tool_call',
    callId: over.callId ?? 'e1',
    name: 'edit_file',
    detail: {
      type: 'edit',
      filePath: 'src/x.ts',
      ...(over.unifiedDiff ? { unifiedDiff: over.unifiedDiff } : {}),
      ...(over.oldString != null ? { oldString: over.oldString } : {}),
      ...(over.newString != null ? { newString: over.newString } : {}),
    },
    status: over.status ?? 'completed',
    error: null,
  }) as never

describe('changesTrack', () => {
  test('accumulates additions and deletions across edit turns', () => {
    const turns = buildTurns([
      timed({ type: 'user_message', text: 'refactor' }),
      timed(editCall({ callId: 'e1', unifiedDiff: '--- a/x\n+++ b/x\n@@ -1,1 +1,2 @@\n-old\n+new\n+newer' })),
      timed(editCall({ callId: 'e2', oldString: 'gone\n', newString: 'here\nstays\n' })),
    ])
    expect(changesTrack(turns)).toEqual({ additions: 4, deletions: 2 })
  })

  test('is null when no edit turn carries a patch', () => {
    const turns = buildTurns([
      timed(editCall({ callId: 'e1' })),
      timed({ type: 'tool_call', callId: 'c9', name: 'bash', detail: { type: 'shell', command: 'ls' }, status: 'completed', error: null } as never),
    ])
    expect(changesTrack(turns)).toBeNull()
    expect(changesTrack(buildTurns([]))).toBeNull()
  })

  test('a replaced call counts once, from its latest patch', () => {
    let turns = buildTurns([timed(editCall({ callId: 'e1', unifiedDiff: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b' }))])
    turns = applyTimelineItem(
      turns,
      editCall({ callId: 'e1', unifiedDiff: '--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n-a\n-b\n+x\n+y\n+z' }),
    )
    expect(changesTrack(turns)).toEqual({ additions: 3, deletions: 2 })
  })
})
