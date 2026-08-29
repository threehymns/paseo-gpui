import { describe, expect, test } from 'bun:test'
import {
  displayConfig,
  initialLiveConfig,
  liveTruth,
  reduceLiveConfig,
  type DaemonTruth,
  type LiveConfigEvent,
  type LiveConfigState,
} from './live-config'
import type { AgentEntry } from './paseo'

const truth: DaemonTruth = {
  modelValue: 'claude-code/sonnet-4.6',
  thinkingId: 'high',
  modeId: 'plan',
  features: { memory: true },
}

function run(events: LiveConfigEvent[], start: LiveConfigState = initialLiveConfig): LiveConfigState {
  return events.reduce(reduceLiveConfig, start)
}

describe('live config chips', () => {
  test('an applied value holds immediately and beats daemon truth', () => {
    const state = run([{ type: 'applied', field: 'model', value: 'claude-code/opus-4.6' }])
    expect(displayConfig(state, truth)).toEqual({
      modelValue: 'claude-code/opus-4.6',
      thinkingId: 'high',
      modeId: 'plan',
      featureValues: { memory: true },
    })
  })

  test('with no holds the chips show daemon truth', () => {
    expect(displayConfig(initialLiveConfig, truth)).toEqual({
      modelValue: 'claude-code/sonnet-4.6',
      thinkingId: 'high',
      modeId: 'plan',
      featureValues: { memory: true },
    })
  })

  test('a rejected setter reverts to daemon-truth values', () => {
    const state = run([
      { type: 'applied', field: 'mode', value: 'default' },
      { type: 'applyFailed', field: 'mode', error: new Error('provider refused') },
    ])
    expect(displayConfig(state, truth).modeId).toBe('plan')
  })

  test('a rejection surfaces an inline error notice', () => {
    const state = run([
      { type: 'applied', field: 'mode', value: 'default' },
      { type: 'applyFailed', field: 'mode', error: new Error('provider refused') },
    ])
    expect(state.notice).toEqual({ type: 'error', message: 'provider refused' })
  })

  test('a settled hold survives until the daemon echo lands', () => {
    const state = run([
      { type: 'applied', field: 'thinking', value: 'low' },
      { type: 'applyDone', field: 'thinking', notice: null },
    ])
    // Echo not seen yet: the applied value still shows.
    expect(displayConfig(state, truth).thinkingId).toBe('low')
    const echoed = reduceLiveConfig(state, { type: 'synced', truth: { ...truth, thinkingId: 'low' } })
    // Echo matched: the hold dissolves back into daemon truth.
    expect(echoed.holds.thinking).toBeUndefined()
    expect(displayConfig(echoed, { ...truth, thinkingId: 'low' }).thinkingId).toBe('low')
  })

  test('synced only drops holds the echo actually confirmed', () => {
    const state = run([
      { type: 'applied', field: 'model', value: 'claude-code/opus-4.6' },
      { type: 'applied', field: 'mode', value: 'default' },
    ])
    // An unrelated broadcast (or a stale echo) must not dissolve holds.
    const synced = reduceLiveConfig(state, { type: 'synced', truth })
    expect(synced.holds.model).toBe('claude-code/opus-4.6')
    expect(synced.holds.mode).toBe('default')
  })

  test('a provider notice returned by a setter renders and clears on the next change', () => {
    const notice = { type: 'warning' as const, message: 'switching modes restarted the turn' }
    const noticed = run([
      { type: 'applied', field: 'mode', value: 'default' },
      { type: 'applyDone', field: 'mode', notice },
    ])
    expect(noticed.notice).toEqual(notice)
    const changed = reduceLiveConfig(noticed, { type: 'applied', field: 'model', value: 'x/y' })
    expect(changed.notice).toBeNull()
  })

  test('a settle without a notice leaves an earlier notice alone', () => {
    const notice = { type: 'info' as const, message: 'heads up' }
    const state = run([{ type: 'applyDone', field: 'mode', notice }])
    const again = reduceLiveConfig(state, { type: 'applyDone', field: 'model', notice: null })
    expect(again.notice).toEqual(notice)
  })

  test('reset clears holds and notices when the agent switches', () => {
    const state = run([
      { type: 'applied', field: 'model', value: 'claude-code/opus-4.6' },
      { type: 'applyDone', field: 'model', notice: { type: 'info', message: 'ok' } },
      { type: 'reset' },
    ])
    expect(state).toEqual(initialLiveConfig)
  })

  test('re-applying a field replaces its hold instead of stacking', () => {
    const state = run([
      { type: 'applied', field: 'model', value: 'a/one' },
      { type: 'applied', field: 'model', value: 'a/two' },
    ])
    expect(state.holds.model).toBe('a/two')
  })

  test('liveTruth projects an agent snapshot onto chip values', () => {
    const entry = {
      provider: 'codex',
      model: 'gpt-5.2',
      thinkingOptionId: null,
      currentModeId: 'work',
      features: [
        { type: 'toggle', id: 'memory', label: 'Memory', value: true },
        { type: 'toggle', id: 'webSearch', label: 'Web search', value: false },
      ],
    } as AgentEntry
    expect(liveTruth(entry)).toEqual({
      modelValue: 'codex/gpt-5.2',
      thinkingId: null,
      modeId: 'work',
      features: { memory: true, webSearch: false },
    })
  })
})

describe('live feature toggles', () => {
  test('a flipped toggle holds immediately and beats daemon truth', () => {
    const state = run([{ type: 'featureApplied', id: 'memory', value: false }])
    expect(state.featureHolds.memory).toBe(false)
    const shown = displayConfig(state, truth)
    expect(shown.featureValues.memory).toBe(false)
    expect(shown.modelValue).toBe('claude-code/sonnet-4.6') // other chips untouched
  })

  test('the daemon echo dissolves a matching feature hold', () => {
    const state = run([{ type: 'featureApplied', id: 'memory', value: false }])
    const echoed = reduceLiveConfig(state, { type: 'synced', truth: { ...truth, features: { memory: false } } })
    expect(echoed.featureHolds.memory).toBeUndefined()
    expect(displayConfig(echoed, { ...truth, features: { memory: false } }).featureValues.memory).toBe(false)
  })

  test('an unrelated broadcast leaves the feature hold in place', () => {
    const state = run([{ type: 'featureApplied', id: 'memory', value: false }])
    const synced = reduceLiveConfig(state, { type: 'synced', truth })
    expect(synced.featureHolds.memory).toBe(false)
  })

  test('a rejected feature change reverts to daemon truth and surfaces an error notice', () => {
    const state = run([
      { type: 'featureApplied', id: 'memory', value: false },
      { type: 'featureFailed', id: 'memory', error: new Error('provider refused') },
    ])
    expect(state.featureHolds.memory).toBeUndefined()
    expect(displayConfig(state, truth).featureValues.memory).toBe(true)
    expect(state.notice).toEqual({ type: 'error', message: 'provider refused' })
  })

  test('reset clears feature holds with the rest when the agent switches', () => {
    const state = run([
      { type: 'featureApplied', id: 'memory', value: false },
      { type: 'reset' },
    ])
    expect(state).toEqual(initialLiveConfig)
  })
})
