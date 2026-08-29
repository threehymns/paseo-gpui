import { describe, expect, test } from 'bun:test'
import type { EventPayload } from '@gpuix/native'
import { createKeyRouter, type KeyEventHandler } from './global-events'

const keyDown = (overrides: Partial<EventPayload> = {}): EventPayload => ({
  elementId: 0,
  eventType: 'keyDown',
  key: 'k',
  modifiers: { shift: false, ctrl: false, alt: false, cmd: false },
  ...overrides,
})

describe('key router', () => {
  test('dispatches events to every subscriber', () => {
    const router = createKeyRouter()
    const seenA: unknown[] = []
    const seenB: unknown[] = []
    router.on((event) => seenA.push(event))
    router.on((event) => seenB.push(event))
    const event = keyDown()
    router.dispatch(event)
    expect(seenA).toEqual([event])
    expect(seenB).toEqual([event])
  })

  test('a disposed handler stops receiving events', () => {
    const router = createKeyRouter()
    const seen: unknown[] = []
    const dispose = router.on((event) => seen.push(event))
    dispose()
    router.dispatch(keyDown())
    expect(seen).toEqual([])
    expect(() => dispose()).not.toThrow()
  })

  test('unsubscribing mid-dispatch does not disturb the pass or later ones', () => {
    const router = createKeyRouter()
    const late: unknown[] = []
    let disposeLate: () => void = () => {}
    const firstCalls: number[] = []
    router.on(() => {
      firstCalls.push(1)
      disposeLate()
    })
    disposeLate = router.on((event) => late.push(event))
    router.dispatch(keyDown())
    expect(firstCalls).toEqual([1])
    expect(late).toEqual([])
    router.dispatch(keyDown())
    expect(firstCalls).toEqual([1, 1])
    expect(late).toEqual([])
  })
})
