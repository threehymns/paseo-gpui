/**
 * The per-repository action queue: the spine every git mutation hangs off.
 *
 * Repositories, not working directories, own the serialization — two rapid
 * actions on one repo run strictly in order (each ending in its own short
 * success flash), while different repos proceed independently. The reducer is
 * the whole visible model; the hook only chains promises so the daemon never
 * sees overlapping mutations and clears flashes on a timer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './paseo'
import { invalidate, ALL_INVALIDATION_TOPICS } from './invalidation'

export interface CheckoutAction {
  id: string
  /** Stable identity for busy checks and dedupe, e.g. 'refresh' or 'push'. */
  verb: string
  /** Past-tense text shown in the success flash, e.g. 'Refreshed'. */
  label: string
}

export interface ActionFlash {
  action: CheckoutAction
  ok: boolean
  error?: string
}

export interface RepoActionQueue {
  running: CheckoutAction | null
  queued: CheckoutAction[]
  /** The most recent settled action, still on screen until it expires. */
  flash: ActionFlash | null
}

export interface CheckoutActionsState {
  repos: Record<string, RepoActionQueue>
}

export const initialCheckoutActions: CheckoutActionsState = {
  repos: {},
}

/** How long a settled action's flash stays on screen. */
export const ACTION_FLASH_MS = 2_000

const emptyQueue: RepoActionQueue = { running: null, queued: [], flash: null }

export type CheckoutActionsEvent =
  | { type: 'reset' }
  | { type: 'enqueued'; repoKey: string; action: CheckoutAction }
  | { type: 'settled'; repoKey: string; actionId: string; ok: boolean; error?: string }
  | { type: 'flashExpired'; repoKey: string; actionId: string }

function withQueue(
  state: CheckoutActionsState,
  repoKey: string,
  fold: (queue: RepoActionQueue) => RepoActionQueue,
): CheckoutActionsState {
  return { repos: { ...state.repos, [repoKey]: fold(state.repos[repoKey] ?? emptyQueue) } }
}

export function reduceCheckoutActions(state: CheckoutActionsState, event: CheckoutActionsEvent): CheckoutActionsState {
  switch (event.type) {
    case 'reset':
      return initialCheckoutActions
    case 'enqueued':
      // Nothing running means the repo is idle and this starts at once;
      // otherwise it waits its turn behind everything already queued.
      return withQueue(state, event.repoKey, (queue) =>
        queue.running == null && queue.queued.length === 0
          ? { ...queue, running: event.action }
          : { ...queue, queued: [...queue.queued, event.action] },
      )
    case 'settled': {
      // Only the running action settles; unknown or still-queued ids are noise.
      const queue = state.repos[event.repoKey]
      const running = queue?.running
      if (!queue || running?.id !== event.actionId) return state
      const [next, ...rest] = queue.queued
      return withQueue(state, event.repoKey, () => ({
        running: next ?? null,
        queued: rest,
        flash: { action: running, ok: event.ok, ...(event.error ? { error: event.error } : {}) },
      }))
    }
    case 'flashExpired': {
      // Unknown repo (e.g. a timer firing after reset) must not resurrect a row.
      const queue = state.repos[event.repoKey]
      if (!queue || queue.flash?.action.id !== event.actionId) return state
      return withQueue(state, event.repoKey, (current) => ({ ...current, flash: null }))
    }
  }
}

/**
 * Runs repository mutations through their per-repo chain. Each completion
 * invalidates every git surface — status, diffs, PR status, commits, timeline
 * — which is what makes the status store refetch without polling.
 */
export function useCheckoutActions() {
  const [state, setState] = useState<CheckoutActionsState>(initialCheckoutActions)
  const chains = useRef<Record<string, Promise<unknown>>>({})

  useEffect(() => () => void setState(initialCheckoutActions), [])

  const run = useCallback(
    (repoKey: string, verb: string, label: string, fn: () => Promise<unknown>): Promise<boolean> => {
      const action: CheckoutAction = {
        id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
        verb,
        label,
      }
      setState((prev) => reduceCheckoutActions(prev, { type: 'enqueued', repoKey, action }))
      const prior = chains.current[repoKey] ?? Promise.resolve()
      const settle = prior.then(async () => {
        let ok = true
        let error: string | undefined
        try {
          await fn()
        } catch (err) {
          ok = false
          error = errorMessage(err)
        }
        if (ok) invalidate(...ALL_INVALIDATION_TOPICS)
        setState((prev) =>
          reduceCheckoutActions(prev, { type: 'settled', repoKey, actionId: action.id, ok, error }),
        )
        setTimeout(() => {
          setState((prev) => reduceCheckoutActions(prev, { type: 'flashExpired', repoKey, actionId: action.id }))
        }, ACTION_FLASH_MS)
        return ok
      })
      // The chain must survive rejections; callers get `settle` itself.
      chains.current[repoKey] = settle.catch(() => false)
      return settle
    },
    [],
  )

  return { state, run }
}
