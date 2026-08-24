import { describe, expect, test } from 'bun:test'
import {
  initialDraftConfig,
  syncDraftConfig,
  defaultThinkingId,
  defaultModeId,
  type DraftConfig,
} from './draft-config'
import type { ProviderEntry } from './paseo'

const providers = [
  {
    provider: 'claude-code',
    label: 'Claude Code',
    status: 'ready',
    enabled: true,
    defaultModeId: 'plan',
    models: [
      {
        id: 'sonnet-4.6',
        label: 'Sonnet 4.6',
        isDefault: true,
        defaultThinkingOptionId: 'high',
        thinkingOptions: [
          { id: 'low', label: 'Low' },
          { id: 'high', label: 'High', isDefault: true },
        ],
      },
      { id: 'opus-4.6', label: 'Opus 4.6', thinkingOptions: [{ id: 'low', label: 'Low' }] },
    ],
    modes: [
      { id: 'plan', label: 'Plan' },
      { id: 'default', label: 'Default' },
    ],
  },
  { provider: 'codex', status: 'unavailable', enabled: true, models: [] },
] as unknown as ProviderEntry[]

describe('composer defaults', () => {
  test('initial config picks the catalog-default model and its defaults', () => {
    const config = initialDraftConfig(providers)
    expect(config.modelValue).toBe('claude-code/sonnet-4.6')
    expect(config.thinkingId).toBe('high')
    expect(config.modeId).toBe('plan')
  })

  test('empty catalog yields an empty model with null extras', () => {
    const config = initialDraftConfig([])
    expect(config).toEqual({ modelValue: '', thinkingId: null, modeId: null })
  })

  test('sync keeps a still-valid selection untouched', () => {
    const prev: DraftConfig = { modelValue: 'claude-code/opus-4.6', thinkingId: null, modeId: null }
    expect(syncDraftConfig(prev, providers)).toEqual(prev)
  })

  test('sync falls back to catalog defaults when the model vanished', () => {
    const prev: DraftConfig = { modelValue: 'gone/model-x', thinkingId: 'low', modeId: 'plan' }
    expect(syncDraftConfig(prev, providers)).toEqual(initialDraftConfig(providers))
  })

  test('sync falls back when the catalog is empty', () => {
    const prev: DraftConfig = { modelValue: 'claude-code/opus-4.6', thinkingId: 'low', modeId: 'plan' }
    expect(syncDraftConfig(prev, [])).toEqual({ modelValue: '', thinkingId: null, modeId: null })
  })

  test('thinking defaults prefer explicit > flagged > first option', () => {
    const opus = providers[0]!.models![1]!
    expect(defaultThinkingId(opus)).toBe('low')
    expect(defaultThinkingId(undefined)).toBeNull()
    expect(defaultModeId(undefined)).toBeNull()
    const fallback = { ...providers[0], defaultModeId: undefined } as unknown as ProviderEntry
    expect(defaultModeId(fallback)).toBe('plan') // modes[0]
  })
})
