import { describe, expect, test } from 'bun:test'
import {
  initialDraftConfig,
  syncDraftConfig,
  defaultThinkingId,
  defaultModeId,
  reduceDraftConfig,
  type DraftConfig,
} from './draft-config'
import type { ProviderEntry, ProviderFeature } from '../daemon/paseo'

const featureCatalog: ProviderFeature[] = [
  { type: 'toggle', id: 'memory', label: 'Memory', value: true },
  { type: 'toggle', id: 'webSearch', label: 'Web search', value: false },
]

function draft(overrides: Partial<DraftConfig>): DraftConfig {
  return { modelValue: 'claude-code/sonnet-4.6', thinkingId: 'high', modeId: 'plan', featureValues: {}, ...overrides }
}

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
    expect(config).toEqual({ modelValue: '', thinkingId: null, modeId: null, featureValues: {} })
  })

  test('sync keeps a still-valid selection untouched', () => {
    const prev: DraftConfig = { modelValue: 'claude-code/opus-4.6', thinkingId: null, modeId: null, featureValues: {} }
    expect(syncDraftConfig(prev, providers)).toEqual(prev)
  })

  test('sync falls back to catalog defaults when the model vanished', () => {
    const prev: DraftConfig = { modelValue: 'gone/model-x', thinkingId: 'low', modeId: 'plan', featureValues: {} }
    expect(syncDraftConfig(prev, providers)).toEqual(initialDraftConfig(providers))
  })

  test('sync falls back when the catalog is empty', () => {
    const prev: DraftConfig = { modelValue: 'claude-code/opus-4.6', thinkingId: 'low', modeId: 'plan', featureValues: { memory: true } }
    expect(syncDraftConfig(prev, [])).toEqual({ modelValue: '', thinkingId: null, modeId: null, featureValues: {} })
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

describe('draft feature toggles', () => {
  test('featureSet flips one toggle and leaves the rest of the draft alone', () => {
    const prev = draft({ featureValues: { memory: true, webSearch: false } })
    const next = reduceDraftConfig(prev, { type: 'featureSet', id: 'webSearch', value: true }, providers)
    expect(next).toEqual(draft({ featureValues: { memory: true, webSearch: true } }))
    expect(prev.featureValues).toEqual({ memory: true, webSearch: false }) // pure
  })

  test('picking a model resets dependent picks and drops held features', () => {
    const prev = draft({
      modelValue: 'claude-code/sonnet-4.6',
      thinkingId: 'low',
      modeId: 'default',
      featureValues: { memory: false },
    })
    const next = reduceDraftConfig(prev, { type: 'model', modelValue: 'claude-code/opus-4.6' }, providers)
    expect(next.modelValue).toBe('claude-code/opus-4.6')
    expect(next.thinkingId).toBe('low') // opus's catalog default
    expect(next.modeId).toBe('plan') // provider default
    expect(next.featureValues).toEqual({})
  })

  test('featuresSynced adopts catalog defaults for untouched ids', () => {
    const next = reduceDraftConfig(draft({}), { type: 'featuresSynced', features: featureCatalog }, providers)
    expect(next.featureValues).toEqual({ memory: true, webSearch: false })
  })

  test('featuresSynced keeps user values for ids the catalog still exposes and drops vanished ones', () => {
    const prev = draft({ featureValues: { memory: false, stale: true } })
    const next = reduceDraftConfig(prev, { type: 'featuresSynced', features: featureCatalog }, providers)
    expect(next.featureValues).toEqual({ memory: false, webSearch: false })
  })

  test('featuresSynced ignores select features; only On/Off toggles enter the draft', () => {
    const mixed: ProviderFeature[] = [
      ...featureCatalog,
      { type: 'select', id: 'style', label: 'Style', value: 'fast', options: [] },
    ]
    const next = reduceDraftConfig(draft({}), { type: 'featuresSynced', features: mixed }, providers)
    expect(next.featureValues).toEqual({ memory: true, webSearch: false })
  })

  test('thinking and mode events preserve held feature values', () => {
    const prev = draft({ featureValues: { memory: true } })
    const next = reduceDraftConfig(prev, { type: 'mode', modeId: 'default' }, providers)
    expect(next.modeId).toBe('default')
    expect(next.featureValues).toEqual({ memory: true })
  })
})
