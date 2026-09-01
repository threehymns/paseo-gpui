/**
 * Provider feature toggles for the composer.
 *
 * Drafts fetch their feature catalog over the daemon (`listProviderFeatures`);
 * live agents already carry theirs on the agent snapshot. This module hides
 * that split: `toggleFeatures` narrows any catalog to On/Off toggles, and
 * useProviderFeatures keeps the draft-side catalog fresh for the picked
 * provider and model, discarding responses that arrive after the target
 * changed.
 */

import { useEffect, useRef, useState } from 'react'
import type { DaemonClient } from '@getpaseo/client/internal/daemon-client'
import type { AgentFeature, ProviderFeatureToggle } from '../daemon/paseo'

/** On/Off toggles only; select features are out of scope for the chip. */
export function toggleFeatures(features: AgentFeature[] | undefined | null): ProviderFeatureToggle[] {
  return (features ?? []).filter((feature): feature is ProviderFeatureToggle => feature.type === 'toggle')
}

/**
 * The draft's feature descriptors for one provider/model target, empty until
 * the daemon answers. A response for a superseded target never lands.
 */
export function useProviderFeatures(
  daemon: DaemonClient | null,
  providerId: string | undefined,
  modelId: string | undefined,
): ProviderFeatureToggle[] {
  const [features, setFeatures] = useState<ProviderFeatureToggle[]>([])
  const fetchedRef = useRef('')

  useEffect(() => {
    const key = `${providerId ?? ''}/${modelId ?? ''}`
    if (!daemon || !providerId || fetchedRef.current === key) return
    fetchedRef.current = key
    let stale = false
    void daemon
      .listProviderFeatures({ provider: providerId, cwd: process.cwd(), ...(modelId ? { model: modelId } : {}) })
      .then((payload) => {
        if (!stale) setFeatures(payload.error ? [] : toggleFeatures(payload.features))
      })
      .catch(() => {
        if (!stale) {
          fetchedRef.current = ''
          setFeatures([])
        }
      })
    return () => {
      stale = true
    }
  }, [daemon, providerId, modelId])

  return features
}
