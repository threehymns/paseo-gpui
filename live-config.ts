/**
 * Live config chips: the model/thinking/mode triple plus provider feature
 * toggles for the active agent.
 *
 * Chip changes on a running agent go straight to the daemon's setters,
 * mirroring the pending-send pattern in conversation.ts: an applied value is
 * held optimistically, a successful setter keeps the hold until the daemon's
 * agent_update echo confirms it (then `synced` dissolves it), and a rejected
 * setter drops the hold so the chips fall back to daemon truth.
 *
 * Provider notices returned by setters (e.g. a mode change with side effects)
 * render inline above the composer; any next change or agent switch clears
 * them. Draft-config semantics remain authoritative only for new agents.
 *
 * The reducer and projections are the whole logic — the hook only translates
 * setter results into LiveConfigEvents and guards against agent switches.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DaemonClient } from '@getpaseo/client/internal/daemon-client'
import { errorMessage, splitModelValue, type AgentEntry } from './paseo'

type SetAgentMode = DaemonClient['setAgentMode']
/** A provider notice returned by a config setter. */
export type ProviderNotice = NonNullable<Awaited<ReturnType<SetAgentMode>>>

export type ConfigField = 'model' | 'thinking' | 'mode'

/** Daemon-truth chip values, projected from one agent snapshot. */
export interface DaemonTruth {
  modelValue: string | null
  thinkingId: string | null
  modeId: string | null
  /** Live values per exposed provider feature, keyed by feature id. */
  features: Record<string, unknown>
}

export interface LiveConfigState {
  /** Optimistically applied values holding until their daemon echo lands. */
  holds: Partial<Record<ConfigField, string>>
  /** Same optimistic hold for On/Off feature toggles, keyed by feature id. */
  featureHolds: Record<string, unknown>
  notice: ProviderNotice | null
}

export const initialLiveConfig: LiveConfigState = { holds: {}, featureHolds: {}, notice: null }

export type LiveConfigEvent =
  | { type: 'reset' }
  | { type: 'applied'; field: ConfigField; value: string }
  | { type: 'applyDone'; field: ConfigField; notice: ProviderNotice | null }
  | { type: 'applyFailed'; field: ConfigField; error: unknown }
  | { type: 'featureApplied'; id: string; value: unknown }
  | { type: 'featureFailed'; id: string; error: unknown }
  | { type: 'synced'; truth: DaemonTruth }

function dropHold(holds: LiveConfigState['holds'], field: ConfigField): LiveConfigState['holds'] {
  if (!(field in holds)) return holds
  const next = { ...holds }
  delete next[field]
  return next
}

export function reduceLiveConfig(state: LiveConfigState, event: LiveConfigEvent): LiveConfigState {
  switch (event.type) {
    case 'reset':
      return initialLiveConfig
    case 'applied':
      return { ...state, holds: { ...state.holds, [event.field]: event.value }, notice: null }
    case 'applyDone':
      return {
        ...state,
        // A settle without a notice must not erase earlier feedback.
        notice: event.notice ?? state.notice,
      }
    case 'applyFailed':
      return {
        ...state,
        holds: dropHold(state.holds, event.field),
        notice: { type: 'error', message: errorMessage(event.error) },
      }
    case 'featureApplied':
      return { ...state, featureHolds: { ...state.featureHolds, [event.id]: event.value }, notice: null }
    case 'featureFailed': {
      const featureHolds = { ...state.featureHolds }
      delete featureHolds[event.id]
      return { ...state, featureHolds, notice: { type: 'error', message: errorMessage(event.error) } }
    }
    case 'synced': {
      const matches = (field: ConfigField, truthValue: string | null): boolean => {
        const held = state.holds[field]
        return held !== undefined && held === truthValue
      }
      let holds = state.holds
      if (matches('model', event.truth.modelValue)) holds = dropHold(holds, 'model')
      if (matches('thinking', event.truth.thinkingId)) holds = dropHold(holds, 'thinking')
      if (matches('mode', event.truth.modeId)) holds = dropHold(holds, 'mode')
      let featureHolds = state.featureHolds
      for (const [id, held] of Object.entries(state.featureHolds)) {
        if (event.truth.features[id] === held) {
          if (featureHolds === state.featureHolds) featureHolds = { ...featureHolds }
          delete featureHolds[id]
        }
      }
      return holds === state.holds && featureHolds === state.featureHolds
        ? state
        : { ...state, holds, featureHolds }
    }
  }
}

/** What the chips display: optimistic holds win over daemon truth. */
export function displayConfig(
  state: LiveConfigState,
  truth: DaemonTruth,
): { modelValue: string; thinkingId: string | null; modeId: string | null; featureValues: Record<string, unknown> } {
  return {
    modelValue: state.holds.model ?? truth.modelValue ?? '',
    thinkingId: state.holds.thinking ?? truth.thinkingId ?? null,
    modeId: state.holds.mode ?? truth.modeId ?? null,
    featureValues: { ...truth.features, ...state.featureHolds },
  }
}

export function liveTruth(
  entry: Pick<AgentEntry, 'provider' | 'model' | 'thinkingOptionId' | 'currentModeId' | 'features'>,
): DaemonTruth {
  const features: Record<string, unknown> = {}
  for (const feature of entry.features ?? []) features[feature.id] = feature.value
  return {
    modelValue: entry.model ? `${entry.provider}/${entry.model}` : null,
    thinkingId: entry.thinkingOptionId ?? null,
    modeId: entry.currentModeId ?? null,
    features,
  }
}

/**
 * Optimistic chip application against one live agent. `truth` is that agent's
 * daemon-truth projection from the agent directory; it dissolves holds as the
 * daemon echoes applied values back.
 */
export function useLiveAgentConfig(daemon: DaemonClient, agentId: string | null, truth: DaemonTruth) {
  const [state, setState] = useState<LiveConfigState>(initialLiveConfig)
  const agentRef = useRef(agentId)
  agentRef.current = agentId

  // Effects run in declaration order: switching agents clears holds/notices
  // before the new agent's truth gets a chance to dissolve anything.
  useEffect(() => {
    setState((prev) => reduceLiveConfig(prev, { type: 'reset' }))
  }, [agentId])

  useEffect(() => {
    setState((prev) => reduceLiveConfig(prev, { type: 'synced', truth }))
  }, [truth])

  const apply = useCallback(
    async (field: ConfigField, value: string) => {
      if (!agentId) return
      setState((prev) => reduceLiveConfig(prev, { type: 'applied', field, value }))
      try {
        let notice: ProviderNotice | null = null
        if (field === 'model') {
          await daemon.setAgentModel(agentId, value === '' ? null : splitModelValue(value).modelId)
        } else if (field === 'thinking') {
          notice = await daemon.setAgentThinkingOption(agentId, value === '' ? null : value)
        } else {
          notice = await daemon.setAgentMode(agentId, value)
        }
        if (agentRef.current === agentId) {
          setState((prev) => reduceLiveConfig(prev, { type: 'applyDone', field, notice }))
        }
      } catch (err) {
        if (agentRef.current === agentId) {
          setState((prev) => reduceLiveConfig(prev, { type: 'applyFailed', field, error: err }))
        }
      }
    },
    [daemon, agentId],
  )

  /** Flips one On/Off feature toggle with the same optimistic-hold lifecycle. */
  const applyFeature = useCallback(
    async (id: string, value: unknown) => {
      if (!agentId) return
      setState((prev) => reduceLiveConfig(prev, { type: 'featureApplied', id, value }))
      try {
        await daemon.setAgentFeature(agentId, id, value)
      } catch (err) {
        if (agentRef.current === agentId) {
          setState((prev) => reduceLiveConfig(prev, { type: 'featureFailed', id, error: err }))
        }
      }
    },
    [daemon, agentId],
  )

  return {
    ...state,
    config: displayConfig(state, truth),
    setModel: (value: string) => void apply('model', value),
    setThinking: (value: string) => void apply('thinking', value),
    setMode: (value: string) => void apply('mode', value),
    setFeature: (id: string, value: unknown) => void applyFeature(id, value),
  }
}
