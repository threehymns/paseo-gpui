/**
 * Composer defaults: the model/thinking/mode triple plus provider feature
 * toggles for a new agent.
 *
 * The invariants live here, not in the caller:
 * - modelValue must resolve to a selectable choice in the provider catalog,
 *   or it falls back to the catalog default;
 * - picking a model resets thinking and mode to that model's defaults and
 *   drops held features until the next catalog merge;
 * - merging a fetched feature catalog adopts its values as defaults while
 *   keeping user choices for ids the catalog still exposes.
 *
 * Pure functions are exported for tests; useDraftConfig is the thin React
 * adapter.
 */

import { useEffect, useState } from 'react'
import {
  defaultModelValue,
  findModel,
  type ProviderEntry,
  type ProviderFeature,
  type ProviderMode,
  type ProviderModel,
} from '../daemon/paseo'

export interface DraftConfig {
  modelValue: string
  thinkingId: string | null
  modeId: string | null
  /** On/Off values the created agent starts with; one entry per exposed toggle. */
  featureValues: Record<string, unknown>
}

/** The draft-config events; all handlers are pure. */
export type DraftConfigEvent =
  | { type: 'model'; modelValue: string }
  | { type: 'thinking'; thinkingId: string | null }
  | { type: 'mode'; modeId: string | null }
  | { type: 'featureSet'; id: string; value: unknown }
  | { type: 'featuresSynced'; features: ProviderFeature[] }

export function defaultThinkingId(model: ProviderModel | undefined): string | null {
  const options = model?.thinkingOptions ?? []
  return model?.defaultThinkingOptionId ?? options.find((option) => option.isDefault)?.id ?? options[0]?.id ?? null
}

export function defaultModeId(entry: ProviderEntry | undefined): string | null {
  return entry?.defaultModeId ?? entry?.modes?.[0]?.id ?? null
}

function defaultsFor(providers: ProviderEntry[], modelValue: string): Pick<DraftConfig, 'thinkingId' | 'modeId'> {
  const { entry, model } = findModel(providers, modelValue)
  return { thinkingId: defaultThinkingId(model), modeId: defaultModeId(entry) }
}

/** The config a fresh composer would send with this provider catalog. */
export function initialDraftConfig(providers: ProviderEntry[]): DraftConfig {
  const modelValue = defaultModelValue(providers) ?? ''
  return { modelValue, ...defaultsFor(providers, modelValue), featureValues: {} }
}

/**
 * Folds one draft-config event into the next state. `featuresSynced` merges a
 * freshly fetched feature catalog: its values become the defaults, previous
 * values survive only for ids the catalog still exposes.
 */
export function reduceDraftConfig(prev: DraftConfig, event: DraftConfigEvent, providers: ProviderEntry[]): DraftConfig {
  switch (event.type) {
    case 'model':
      return { modelValue: event.modelValue, ...defaultsFor(providers, event.modelValue), featureValues: {} }
    case 'thinking':
      return { ...prev, thinkingId: event.thinkingId }
    case 'mode':
      return { ...prev, modeId: event.modeId }
    case 'featureSet':
      return { ...prev, featureValues: { ...prev.featureValues, [event.id]: event.value } }
    case 'featuresSynced': {
      const merged: Record<string, unknown> = {}
      for (const feature of event.features) {
        if (feature.type === 'toggle') merged[feature.id] = feature.value
      }
      for (const [id, value] of Object.entries(prev.featureValues)) {
        if (id in merged) merged[id] = value
      }
      return { ...prev, featureValues: merged }
    }
  }
}

/**
 * Reconcile the draft after the provider catalog changes: keep the current
 * model while it still resolves; otherwise fall back to catalog defaults.
 */
export function syncDraftConfig(prev: DraftConfig, providers: ProviderEntry[]): DraftConfig {
  if (!prev.modelValue || !findModel(providers, prev.modelValue).choice) {
    return initialDraftConfig(providers)
  }
  return prev
}

export function useDraftConfig(providers: ProviderEntry[]) {
  const [config, setConfig] = useState<DraftConfig>({ modelValue: '', thinkingId: null, modeId: null, featureValues: {} })

  useEffect(() => {
    setConfig((prev) => syncDraftConfig(prev, providers))
  }, [providers])

  const setModel = (modelValue: string) => {
    setConfig((prev) => reduceDraftConfig(prev, { type: 'model', modelValue }, providers))
  }
  const setThinking = (thinkingId: string | null) => {
    setConfig((prev) => reduceDraftConfig(prev, { type: 'thinking', thinkingId }, providers))
  }
  const setMode = (modeId: string | null) => {
    setConfig((prev) => reduceDraftConfig(prev, { type: 'mode', modeId }, providers))
  }
  const setFeature = (id: string, value: unknown) => {
    setConfig((prev) => reduceDraftConfig(prev, { type: 'featureSet', id, value }, providers))
  }
  const syncFeatures = (features: ProviderFeature[]) => {
    setConfig((prev) => reduceDraftConfig(prev, { type: 'featuresSynced', features }, providers))
  }

  return { config, setModel, setThinking, setMode, setFeature, syncFeatures }
}

// Re-exported so view code doesn't import paseo types through two paths.
export type { ProviderEntry, ProviderMode, ProviderModel }
