import { describe, expect, test } from 'bun:test'
import {
  ACTION_FLASH_MS,
  initialCheckoutActions,
  reduceCheckoutActions,
  type CheckoutAction,
} from './checkout-actions'

const action = (id: string, verb = id): CheckoutAction => ({ id, verb, label: `${verb} done` })

function run(events: Parameters<typeof reduceCheckoutActions>[1][], initial = initialCheckoutActions) {
  return events.reduce(reduceCheckoutActions, initial)
}

describe('per-repository action queue', () => {
  test('the first action starts immediately', () => {
    const state = run([
      { type: 'enqueued', repoKey: '/repo', action: action('a1') },
    ])
    expect(state.repos['/repo']?.running).toEqual(action('a1'))
    expect(state.repos['/repo']?.queued).toEqual([])
  })

  test('two rapid actions serialize: the second waits for the first', () => {
    const state = run([
      { type: 'enqueued', repoKey: '/repo', action: action('a1', 'refresh') },
      { type: 'enqueued', repoKey: '/repo', action: action('a2', 'push') },
    ])
    expect(state.repos['/repo']?.running).toEqual(action('a1', 'refresh'))
    expect(state.repos['/repo']?.queued).toEqual([action('a2', 'push')])
  })

  test('settling the running action promotes the next and flashes the finisher', () => {
    let state = run([
      { type: 'enqueued', repoKey: '/repo', action: action('a1') },
      { type: 'enqueued', repoKey: '/repo', action: action('a2') },
    ])
    state = reduceCheckoutActions(state, { type: 'settled', repoKey: '/repo', actionId: 'a1', ok: true })
    // The second action is now running; the first is on screen as a flash.
    expect(state.repos['/repo']?.running).toEqual(action('a2'))
    expect(state.repos['/repo']?.queued).toEqual([])
    expect(state.repos['/repo']?.flash).toEqual({ action: action('a1'), ok: true })

    // Each serialized action ends in its own short success flash.
    state = reduceCheckoutActions(state, { type: 'settled', repoKey: '/repo', actionId: 'a2', ok: true })
    expect(state.repos['/repo']?.running).toBeNull()
    expect(state.repos['/repo']?.flash).toEqual({ action: action('a2'), ok: true })
  })

  test('a failed action still promotes the queue and flashes with its error', () => {
    let state = run([
      { type: 'enqueued', repoKey: '/repo', action: action('a1') },
      { type: 'enqueued', repoKey: '/repo', action: action('a2') },
    ])
    state = reduceCheckoutActions(state, {
      type: 'settled',
      repoKey: '/repo',
      actionId: 'a1',
      ok: false,
      error: 'daemon refused',
    })
    expect(state.repos['/repo']?.running).toEqual(action('a2'))
    expect(state.repos['/repo']?.flash).toEqual({ action: action('a1'), ok: false, error: 'daemon refused' })
  })

  test('different repositories queue independently', () => {
    const state = run([
      { type: 'enqueued', repoKey: '/repo-a', action: action('a1') },
      { type: 'enqueued', repoKey: '/repo-b', action: action('b1') },
    ])
    expect(state.repos['/repo-a']?.running).toEqual(action('a1'))
    expect(state.repos['/repo-b']?.running).toEqual(action('b1'))
  })

  test('flash expiry clears only the matching flash; a newer completion wins', () => {
    let state = run([
      { type: 'enqueued', repoKey: '/repo', action: action('a1') },
      { type: 'settled', repoKey: '/repo', actionId: 'a1', ok: true },
    ])
    // A stale timer for an already-replaced flash must not clear the new one.
    state = reduceCheckoutActions(state, { type: 'flashExpired', repoKey: '/repo', actionId: 'a0' })
    expect(state.repos['/repo']?.flash).toEqual({ action: action('a1'), ok: true })
    state = reduceCheckoutActions(state, { type: 'flashExpired', repoKey: '/repo', actionId: 'a1' })
    expect(state.repos['/repo']?.flash).toBeNull()
  })

  test('a flash timer firing after reset does not resurrect a cleared repository', () => {
    let state = run([
      { type: 'enqueued', repoKey: '/repo', action: action('a1') },
      { type: 'settled', repoKey: '/repo', actionId: 'a1', ok: true },
      { type: 'reset' },
    ])
    state = reduceCheckoutActions(state, { type: 'flashExpired', repoKey: '/repo', actionId: 'a1' })
    expect(state.repos).toEqual({})
  })

  test('settling an unknown or queued id is a no-op', () => {
    const mid = run([
      { type: 'enqueued', repoKey: '/repo', action: action('a1') },
      { type: 'enqueued', repoKey: '/repo', action: action('a2') },
    ])
    expect(reduceCheckoutActions(mid, { type: 'settled', repoKey: '/repo', actionId: 'nope', ok: true })).toEqual(mid)
    expect(reduceCheckoutActions(mid, { type: 'settled', repoKey: '/repo', actionId: 'a2', ok: true })).toEqual(mid)
  })

  test('reset clears every queue', () => {
    const state = run([
      { type: 'enqueued', repoKey: '/repo', action: action('a1') },
      { type: 'reset' },
    ])
    expect(state.repos).toEqual({})
  })

  test('the flash window is short — measured in seconds, not minutes', () => {
    expect(ACTION_FLASH_MS).toBeLessThanOrEqual(5_000)
    expect(ACTION_FLASH_MS).toBeGreaterThanOrEqual(500)
  })
})
