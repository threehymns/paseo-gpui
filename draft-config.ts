/**
 * Composer defaults: the model/thinking/mode triple for a new agent.
 *
 * The invariants live here, not in the caller:
 * - modelValue must resolve to a selectable choice in the provider catalog,
 *   or it falls back to the catalog default;
 * - picking a model resets thinking and mode to that model's defaults.
 *
 * Pure functions are exported for tests; useDraftConfig is the thin React
 * adapter.
 */

import { useEffect, useState } from 'react'
import {
  defaultModelValue,
  findModel,
  type ProviderEntry,
  type ProviderMode,
  type ProviderModel,
} from './paseo'

export interface DraftConfig {
  modelValue: string
  thinkingId: string | null
  modeId: string | null
}

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
  return { modelValue, ...defaultsFor(providers, modelValue) }
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
  const [config, setConfig] = useState<DraftConfig>({ modelValue: '', thinkingId: null, modeId: null })

  useEffect(() => {
    setConfig((prev) => syncDraftConfig(prev, providers))
  }, [providers])

  const setModel = (modelValue: string) => {
    setConfig({ modelValue, ...defaultsFor(providers, modelValue) })
  }
  const setThinking = (thinkingId: string | null) => {
    setConfig((prev) => ({ ...prev, thinkingId }))
  }
  const setMode = (modeId: string | null) => {
    setConfig((prev) => ({ ...prev, modeId }))
  }

  return { config, setModel, setThinking, setMode }
}

// Re-exported so view code doesn't import paseo types through two paths.
export type { ProviderEntry, ProviderMode, ProviderModel }
