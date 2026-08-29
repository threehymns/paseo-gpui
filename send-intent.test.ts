import { describe, expect, test } from 'bun:test'
import { classifyEnter, resolveSendIntent, type SendGesture } from './send-intent'

describe('composer enter gestures', () => {
  test('bare Enter is the send gesture', () => {
    expect(classifyEnter(undefined)).toBe('send')
    expect(classifyEnter({})).toBe('send')
  })

  test('Cmd or Ctrl+Enter queues the text as a pending send', () => {
    expect(classifyEnter({ cmd: true })).toBe('queue')
    expect(classifyEnter({ ctrl: true })).toBe('queue')
  })

  test('Alt+Enter is the interrupt gesture', () => {
    expect(classifyEnter({ alt: true })).toBe('interrupt')
  })

  test('Shift+Enter belongs to the native editor, not to any gesture', () => {
    expect(classifyEnter({ shift: true })).toBeNull()
  })
})

describe('send intent matrix', () => {
  const cases: [boolean, SendGesture, string][] = [
    // Idle agents behave exactly as today: every gesture delivers fresh.
    [false, 'send', 'send'],
    [false, 'queue', 'send'],
    [false, 'interrupt', 'send'],
    // Mid-turn, the gesture decides.
    [true, 'send', 'steer'],
    [true, 'queue', 'queue'],
    [true, 'interrupt', 'interrupt'],
  ]
  for (const [running, gesture, expected] of cases) {
    test(`${running ? 'running' : 'idle'} agent + ${gesture} → ${expected}`, () => {
      expect(resolveSendIntent(running, gesture)).toEqual({ kind: expected })
    })
  }

  test('configured behavior overrides what Enter means mid-turn', () => {
    expect(resolveSendIntent(true, 'send', { enterWhileRunning: 'queue' })).toEqual({ kind: 'queue' })
    expect(resolveSendIntent(true, 'send', { enterWhileRunning: 'interrupt' })).toEqual({ kind: 'interrupt' })
    // The override is Enter's alone; explicit gestures keep their meaning.
    expect(resolveSendIntent(true, 'interrupt', { enterWhileRunning: 'queue' })).toEqual({ kind: 'interrupt' })
  })

  test('an idle agent ignores the configured override — it has no active turn', () => {
    expect(resolveSendIntent(false, 'send', { enterWhileRunning: 'interrupt' })).toEqual({ kind: 'send' })
  })
})
