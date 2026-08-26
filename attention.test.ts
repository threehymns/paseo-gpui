import { describe, expect, test } from 'bun:test'
import {
  initialAttention,
  notificationTitle,
  NOTIFICATION_TITLES,
  outstandingNoticeFor,
  previewText,
  reduceAttention,
  attentionOf,
  type AttentionEvent,
} from './attention'

const SERVER = 'daemon-1'

let nextRaiseAt = 0

type RaisedEvent = Extract<AttentionEvent, { type: 'agentUpdated' }>

function raised(over: { agent?: Partial<RaisedEvent['agent']>; preview?: string | null } = {}): AttentionEvent {
  nextRaiseAt += 1
  const preview = over.preview === undefined ? 'All **done** — see [the diff](https://example.com).' : over.preview
  return {
    type: 'agentUpdated',
    agent: {
      id: 'agent-1',
      workspaceId: 'ws-1',
      requiresAttention: true,
      attentionReason: 'finished',
      attentionTimestamp: `2026-08-26T03:00:${String(nextRaiseAt).padStart(2, '0')}Z`,
      ...over.agent,
    },
    // null means the event carries no preview at all.
    ...(preview === null ? {} : { preview }),
  }
}

describe('notification decision', () => {
  test('an unfocused window delivers the notice to the outbox', () => {
    let state = reduceAttention(initialAttention(SERVER), { type: 'windowFocusChanged', focused: false })
    state = reduceAttention(state, raised())
    expect(state.outbox).toHaveLength(1)
    expect(state.outbox[0]?.payload.agentId).toBe('agent-1')
    expect(outstandingNoticeFor(state, 'agent-1')).toBeDefined()
  })

  test('a focused window looking at the same agent suppresses delivery', () => {
    let state = reduceAttention(initialAttention(SERVER), { type: 'focusedAgentChanged', agentId: 'agent-1' })
    state = reduceAttention(state, raised())
    expect(state.outbox).toEqual([])
    // Suppressed ≠ dropped: it is still outstanding in-app.
    expect(outstandingNoticeFor(state, 'agent-1')).toBeDefined()
  })

  test('a focused window on a different agent still delivers', () => {
    let state = reduceAttention(initialAttention(SERVER), { type: 'focusedAgentChanged', agentId: 'agent-other' })
    state = reduceAttention(state, raised())
    expect(state.outbox.map((notice) => notice.payload.agentId)).toEqual(['agent-1'])
  })
})

describe('priority superseding', () => {
  const unfocused = () => reduceAttention(initialAttention(SERVER), { type: 'windowFocusChanged', focused: false })

  test('error supersedes an outstanding permission notice and fires', () => {
    let state = unfocused()
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: 'permission' }, preview: null }))
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: 'error' }, preview: 'boom' }))
    expect(outstandingNoticeFor(state, 'agent-1')?.payload.reason).toBe('error')
    expect(state.outbox.map((notice) => notice.payload.reason)).toEqual(['permission', 'error'])
  })

  test('finished supersedes anything outstanding', () => {
    let state = unfocused()
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: 'error' } }))
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: 'finished' } }))
    expect(outstandingNoticeFor(state, 'agent-1')?.payload.reason).toBe('finished')
  })

  test('a lower-priority reason updates the badge but never replaces or re-pings', () => {
    let state = unfocused()
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: 'finished' } }))
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: 'permission' } }))
    // In-app truth follows the newest raise…
    expect(attentionOf(state, 'agent-1')).toBe('permission')
    // …but the outstanding ping stays at the higher priority.
    expect(outstandingNoticeFor(state, 'agent-1')?.payload.reason).toBe('finished')
    expect(state.outbox).toHaveLength(1)
  })

  test('an equal-priority raise refreshes the badge without a second ping', () => {
    let state = unfocused()
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: 'permission' } }))
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: 'permission' } }))
    expect(state.outbox).toHaveLength(1)
    expect(attentionOf(state, 'agent-1')).toBe('permission')
  })
})

describe('gate changes release suppressed notices', () => {
  test('navigating away from the agent releases its suppressed notice', () => {
    let state = reduceAttention(initialAttention(SERVER), { type: 'focusedAgentChanged', agentId: 'agent-1' })
    state = reduceAttention(state, raised())
    expect(state.outbox).toEqual([])
    state = reduceAttention(state, { type: 'focusedAgentChanged', agentId: 'agent-2' })
    expect(state.outbox.map((notice) => notice.payload.agentId)).toEqual(['agent-1'])
  })

  test('blurring the window releases suppressed notices', () => {
    let state = reduceAttention(initialAttention(SERVER), { type: 'focusedAgentChanged', agentId: 'agent-1' })
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: 'error' } }))
    expect(state.outbox).toEqual([])
    state = reduceAttention(state, { type: 'windowFocusChanged', focused: false })
    expect(state.outbox).toHaveLength(1)
  })

  test('a delivered notice never fires twice as gates flap', () => {
    let state = reduceAttention(initialAttention(SERVER), { type: 'windowFocusChanged', focused: false })
    state = reduceAttention(state, raised())
    expect(state.outbox).toHaveLength(1)
    state = reduceAttention(state, { type: 'windowFocusChanged', focused: true })
    state = reduceAttention(state, { type: 'windowFocusChanged', focused: false })
    state = reduceAttention(state, { type: 'focusedAgentChanged', agentId: 'someone-else' })
    expect(state.outbox).toHaveLength(1)
  })
})

describe('clearing attention', () => {
  // No argument means a genuinely timestamp-less report.
  const raisedAt = (ts?: string) =>
    raised({
      agent: {
        id: 'agent-1',
        requiresAttention: true,
        attentionReason: 'error',
        attentionTimestamp: ts ?? null,
      },
    })
  const permissionAt = () =>
    raised({
      agent: {
        id: 'agent-1',
        workspaceId: 'ws-1',
        requiresAttention: true,
        attentionReason: 'permission',
        attentionTimestamp: null,
      },
    })

  test('engaging the composer clears in-app attention', () => {
    let state = reduceAttention(initialAttention(SERVER), raisedAt())
    expect(attentionOf(state, 'agent-1')).toBe('error')
    state = reduceAttention(state, { type: 'composerEngaged', agentId: 'agent-1' })
    expect(attentionOf(state, 'agent-1')).toBeNull()
    // The OS banner is moot once the user shows up.
    expect(outstandingNoticeFor(state, 'agent-1')).toBeUndefined()
  })

  test('permission attention survives composer engagement but its banner does not linger', () => {
    let state = reduceAttention(initialAttention(SERVER), permissionAt())
    state = reduceAttention(state, { type: 'composerEngaged', agentId: 'agent-1' })
    expect(attentionOf(state, 'agent-1')).toBe('permission')
    expect(outstandingNoticeFor(state, 'agent-1')).toBeUndefined()
  })

  test('engaging an unknown agent changes nothing', () => {
    const state = reduceAttention(initialAttention(SERVER), raisedAt())
    expect(reduceAttention(state, { type: 'composerEngaged', agentId: 'nope' })).toBe(state)
  })

  test('daemon truth clears attention and its notice together', () => {
    let state = reduceAttention(initialAttention(SERVER), raisedAt())
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: false, attentionReason: null } }))
    expect(attentionOf(state, 'agent-1')).toBeNull()
    expect(outstandingNoticeFor(state, 'agent-1')).toBeUndefined()
  })

  test('a stale directory echo never resurrects composer-cleared attention', () => {
    let state = reduceAttention(initialAttention(SERVER), raisedAt('2026-08-26T03:00:00Z'))
    state = reduceAttention(state, { type: 'composerEngaged', agentId: 'agent-1' })
    const before = state
    state = reduceAttention(state, raisedAt('2026-08-26T03:00:00Z'))
    expect(state).toBe(before)
    expect(attentionOf(state, 'agent-1')).toBeNull()
  })

  test('a newer timestamp is a fresh moment and re-raises', () => {
    let state = reduceAttention(initialAttention(SERVER), raisedAt('2026-08-26T03:00:00Z'))
    state = reduceAttention(state, { type: 'composerEngaged', agentId: 'agent-1' })
    state = reduceAttention(state, raisedAt('2026-08-26T03:05:00Z'))
    expect(attentionOf(state, 'agent-1')).toBe('error')
    expect(outstandingNoticeFor(state, 'agent-1')).toBeDefined()
  })

  test('timestamp-less repeats are echoes, not new moments', () => {
    let state = reduceAttention(initialAttention(SERVER), raisedAt())
    const before = state
    state = reduceAttention(state, raisedAt())
    expect(state).toBe(before)
  })

  test('after a daemon clear, attention rising again is genuinely new', () => {
    let state = reduceAttention(initialAttention(SERVER), raisedAt('2026-08-26T03:00:00Z'))
    state = reduceAttention(state, raised({ agent: { id: 'agent-1', requiresAttention: false, attentionReason: null } }))
    state = reduceAttention(state, raisedAt('2026-08-26T03:00:00Z'))
    expect(attentionOf(state, 'agent-1')).toBe('error')
  })

  test('an earlier or equal timestamp than one already acted on never re-raises', () => {
    let state = reduceAttention(initialAttention(SERVER), raisedAt('2026-08-26T05:00:00Z'))
    const before = state
    state = reduceAttention(state, raisedAt('2026-08-26T04:00:00Z'))
    expect(state).toBe(before)
  })
})

describe('outbox lifecycle', () => {
  test('draining hands the queue to the bridge and empties it', () => {
    let state = reduceAttention(initialAttention(SERVER), { type: 'windowFocusChanged', focused: false })
    state = reduceAttention(state, raised())
    expect(state.outbox).toHaveLength(1)
    state = reduceAttention(state, { type: 'drained' })
    expect(state.outbox).toEqual([])
    // Draining clears the queue, not the machine's memory of the notice.
    expect(outstandingNoticeFor(state, 'agent-1')).toBeDefined()
  })

  test('draining an empty outbox is a no-op', () => {
    const state = initialAttention(SERVER)
    expect(reduceAttention(state, { type: 'drained' })).toBe(state)
  })

  test('an agent vanishing from the directory drops its attention and notice', () => {
    let state = reduceAttention(initialAttention(SERVER), raised())
    state = reduceAttention(state, { type: 'agentRemoved', agentId: 'agent-1' })
    expect(attentionOf(state, 'agent-1')).toBeNull()
    expect(outstandingNoticeFor(state, 'agent-1')).toBeUndefined()
  })

  test('removing an unknown agent changes nothing', () => {
    const state = reduceAttention(initialAttention(SERVER), raised())
    expect(reduceAttention(state, { type: 'agentRemoved', agentId: 'ghost' })).toBe(state)
  })
})

describe('raising attention', () => {
  test('a directory update needing attention marks the agent and builds a notice', () => {
    const state = reduceAttention(initialAttention(SERVER), raised())
    expect(attentionOf(state, 'agent-1')).toBe('finished')
    const notice = outstandingNoticeFor(state, 'agent-1')
    expect(notice?.payload).toEqual({
      serverId: SERVER,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      reason: 'finished',
    })
    expect(notice?.title).toBe('Agent finished')
    expect(notice?.body).toBe('All done — see the diff.')
  })

  test('each reason raises its own title and preview body', () => {
    for (const reason of ['permission', 'error', 'finished'] as const) {
      const state = reduceAttention(
        initialAttention(SERVER),
        raised({ agent: { id: 'agent-1', requiresAttention: true, attentionReason: reason }, preview: `reason: ${reason}` }),
      )
      expect(outstandingNoticeFor(state, 'agent-1')?.title).toBe(notificationTitle(reason))
      expect(outstandingNoticeFor(state, 'agent-1')?.body).toBe(`reason: ${reason}`)
    }
  })

  test('a missing workspace id stays null in the payload; a missing preview yields an empty body', () => {
    const state = reduceAttention(initialAttention(SERVER), raised({ agent: { id: 'agent-2', workspaceId: null, requiresAttention: true, attentionReason: 'permission' }, preview: null }))
    expect(outstandingNoticeFor(state, 'agent-2')?.payload.workspaceId).toBeNull()
    expect(outstandingNoticeFor(state, 'agent-2')?.body).toBe('')
  })

  test('an agent not requiring attention never raises', () => {
    const state = reduceAttention(
      initialAttention(SERVER),
      raised({ agent: { id: 'agent-1', requiresAttention: false, attentionReason: null } }),
    )
    expect(attentionOf(state, 'agent-1')).toBeNull()
    expect(outstandingNoticeFor(state, 'agent-1')).toBeUndefined()
  })
})

describe('notification titles', () => {
  test('the three reasons map to their exact strings', () => {
    expect(NOTIFICATION_TITLES.permission).toBe('Agent needs permission')
    expect(NOTIFICATION_TITLES.error).toBe('Agent needs attention')
    expect(NOTIFICATION_TITLES.finished).toBe('Agent finished')
    expect(notificationTitle('permission')).toBe('Agent needs permission')
    expect(notificationTitle('error')).toBe('Agent needs attention')
    expect(notificationTitle('finished')).toBe('Agent finished')
  })
})

describe('preview bodies', () => {
  test('plain text passes through untouched', () => {
    expect(previewText('Fixed the login bug.')).toBe('Fixed the login bug.')
  })

  test('markdown syntax is stripped to plain words', () => {
    expect(previewText('## Ship it\n\n**Bold** and *italic* with `code`.')).toBe(
      'Ship it Bold and italic with code.',
    )
  })

  test('intraword underscores are identifiers, not emphasis', () => {
    expect(previewText('edited my_project_id today')).toBe('edited my_project_id today')
    expect(previewText('a__b__c stays whole')).toBe('a__b__c stays whole')
  })

  test('underscore emphasis still strips at word boundaries', () => {
    expect(previewText('_soft_ and __firm__')).toBe('soft and firm')
    expect(previewText('path (_relative_) here')).toBe('path (relative) here')
  })

  test('asterisk emphasis strips anywhere, as CommonMark allows', () => {
    expect(previewText('run a*b*c')).toBe('run abc')
  })

  test('strikethrough keeps its content', () => {
    expect(previewText('~~abandoned~~ done')).toBe('abandoned done')
  })

  test('links keep their label and drop the target', () => {
    expect(previewText('See [the docs](https://example.com/a) for details.')).toBe(
      'See the docs for details.',
    )
  })

  test('images keep their alt text', () => {
    expect(previewText('![screenshot](https://example.com/a.png) looks wrong')).toBe(
      'screenshot looks wrong',
    )
  })

  test('fenced code keeps its content but drops the fences', () => {
    expect(previewText('Ran:\n```ts\nbun test\n```')).toBe('Ran: bun test')
  })

  test('lists, quotes, and rules collapse into prose', () => {
    expect(previewText('- one\n- two\n> quoted\n---\n3. third').split(' ')).toEqual([
      'one',
      'two',
      'quoted',
      'third',
    ])
  })

  test('long previews truncate at exactly 220 characters', () => {
    const long = 'a'.repeat(500)
    const out = previewText(long)
    expect(out).toHaveLength(220)
    expect(previewText('b'.repeat(220))).toHaveLength(220)
    expect(previewText('c'.repeat(221))).toHaveLength(220)
  })

  test('whitespace collapses before measuring length', () => {
    const padded = `${'x '.repeat(150)}${'a'.repeat(300)}`
    expect(previewText(padded)).toHaveLength(220)
  })

  test('empty input yields an empty body', () => {
    expect(previewText('')).toBe('')
    expect(previewText('# \n---\n')).toBe('')
  })
})
