import { describe, expect, test } from 'bun:test'
import { initialFollow, reduceFollow, type FollowEvent } from './follow'

function run(events: FollowEvent[]) {
  return events.reduce(reduceFollow, initialFollow)
}

/** A wheel tick upward (deltaY negative), with the offset measured after it. */
const up = (offset: number | null = -4000): FollowEvent => ({ type: 'userScrolled', deltaY: -120, offset })
/** A wheel tick downward, with the offset measured after it. */
const down = (offset: number | null, deltaY = 120): FollowEvent => ({ type: 'userScrolled', deltaY, offset })

describe('transcript follow', () => {
  test('a fresh transcript follows its tail', () => {
    expect(initialFollow.following).toBe(true)
  })

  test('scrolling up detaches auto-follow', () => {
    const state = run([up()])
    expect(state.following).toBe(false)
  })

  test('detaching works even when the offset cannot be read', () => {
    const state = run([up(null)])
    expect(state.following).toBe(false)
  })

  test('scrolling down while attached stays attached', () => {
    const state = run([down(-6000)])
    expect(state.following).toBe(true)
  })

  test('incoming turns do not re-attach a detached transcript', () => {
    const state = run([up(), { type: 'turnsAppended' }, { type: 'turnsAppended' }])
    expect(state.following).toBe(false)
  })

  test('incoming turns leave an attached transcript attached', () => {
    const state = run([{ type: 'turnsAppended' }, { type: 'turnsAppended' }])
    expect(state.following).toBe(true)
  })

  test('the jump button re-attaches', () => {
    const state = run([up(), { type: 'jumpRequested' }])
    expect(state.following).toBe(true)
  })

  test('wheeling down while pinned at the bottom re-attaches', () => {
    // The last two ticks moved nothing: the list was already clamped at its end.
    const state = run([up(-3000), down(-5000), down(-5000)])
    expect(state.following).toBe(true)
  })

  test('wheeling down mid-transcript stays detached', () => {
    const state = run([up(-8000), down(-7000), down(-6000)])
    expect(state.following).toBe(false)
  })

  test('the tick that arrives at the bottom does not yet re-attach', () => {
    const state = run([up(-3000), down(-5000)])
    expect(state.following).toBe(false)
  })

  test('re-selecting an agent resets to attached', () => {
    const state = run([up(), { type: 'reset' }])
    expect(state.following).toBe(true)
  })
})
