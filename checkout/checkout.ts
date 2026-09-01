/**
 * Checkout status: where am I and how dirty is it, per workspace, live.
 *
 * One store feeds every git surface in this ticket and the ones after it.
 * It is filled exclusively by daemon truth — an initial getCheckoutStatus
 * fetch plus `checkout_status_update` pushes — and refetched only when an
 * action invalidates it. Nothing polls.
 *
 * The reducer is the whole store — the hook only translates SDK events into
 * CheckoutEvents and renders state into panel props, mirroring conversation
 * and permissions.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DaemonClient } from '@getpaseo/client/internal/daemon-client'
import { onInvalidate } from './invalidation'

// ---- daemon payloads --------------------------------------------------------
//
// The SDK infers these from @getpaseo/protocol; a local structural copy keeps
// this module (and its tests) decoupled from that package's internals while
// staying assignment-compatible with both the getCheckoutStatus response and
// the checkout_status_update push payload.

export type CheckoutErrorCode = 'NOT_GIT_REPO' | 'NOT_ALLOWED' | 'MERGE_CONFLICT' | 'UNKNOWN'

export interface CheckoutStatusPayload {
  cwd: string
  error: { code: CheckoutErrorCode; message: string } | null
  upstreamRef?: string | null
  isGit: boolean
  isPaseoOwnedWorktree: boolean
  repoRoot: string | null
  mainRepoRoot?: string | null
  currentBranch: string | null
  isDirty: boolean | null
  baseRef: string | null
  aheadBehind: { ahead: number; behind: number } | null
  hasRemote: boolean
  remoteUrl: string | null
}

// ---- folded status ----------------------------------------------------------

/** The panel-facing facts about one workspace's checkout, folded once at arrival. */
export interface RepoStatus {
  cwd: string
  isGit: boolean
  errorCode: CheckoutErrorCode | null
  errorMessage: string | null
  repoRoot: string | null
  /** Set when this checkout is a paseo-owned worktree of another repo. */
  mainRepoRoot: string | null
  isPaseoOwnedWorktree: boolean
  /** Checked-out branch; null means detached HEAD (or no repository). */
  branch: string | null
  dirty: boolean | null
  baseRef: string | null
  ahead: number | null
  behind: number | null
  hasRemote: boolean
  remoteUrl: string | null
  upstreamRef: string | null
}

export function foldCheckoutStatus(payload: CheckoutStatusPayload): RepoStatus {
  return {
    cwd: payload.cwd,
    isGit: payload.isGit,
    errorCode: payload.error?.code ?? null,
    errorMessage: payload.error?.message ?? null,
    repoRoot: payload.repoRoot,
    mainRepoRoot: payload.mainRepoRoot ?? null,
    isPaseoOwnedWorktree: payload.isPaseoOwnedWorktree,
    branch: payload.isGit ? payload.currentBranch : null,
    dirty: payload.isDirty,
    baseRef: payload.baseRef,
    ahead: payload.aheadBehind?.ahead ?? null,
    behind: payload.aheadBehind?.behind ?? null,
    hasRemote: payload.hasRemote,
    remoteUrl: payload.remoteUrl,
    upstreamRef: payload.upstreamRef ?? null,
  }
}

/** Detached HEAD reads as an unknown branch, never as a wrong name. */
export function branchLabel(status: RepoStatus): string {
  return status.branch ?? 'unknown'
}

/** Compact "↑n ↓m" summary; hides zero sides, null when level or unknown. */
export function formatAheadBehind(ahead: number | null, behind: number | null): string | null {
  const up = ahead == null || ahead <= 0 ? null : `↑${ahead}`
  const down = behind == null || behind <= 0 ? null : `↓${behind}`
  if (!up && !down) return null
  return [up, down].filter(Boolean).join(' ')
}

/** Repositories — not working directories — serialize mutations; root when known, cwd before that. */
export function repoKeyOf(status: RepoStatus): string {
  return status.repoRoot ?? status.cwd
}

// ---- response freshness -------------------------------------------------------

/**
 * Orders racing writes for one workspace's status. Fetches overlap — an
 * invalidation refetch can start while an earlier lookup is still in flight —
 * and daemon pushes land between them, so a response applies only while it is
 * still the freshest snapshot for its workspace; anything newer that left home
 * or arrived first retires it.
 */
export interface StatusFreshness {
  /** Records a fetch leaving; returns the token its response will be judged by. */
  issue(cwd: string): number
  /** A push arrived: every snapshot issued before it is obsolete. */
  recordPush(cwd: string): void
  /** Whether a response may still apply: nothing fresher has left or landed first. */
  canApply(cwd: string, token: number): boolean
}

export function createStatusFreshness(): StatusFreshness {
  const generation: Record<string, number> = {}
  const generationOf = (cwd: string) => generation[cwd] ?? 0
  return {
    issue(cwd) {
      generation[cwd] = generationOf(cwd) + 1
      return generation[cwd]
    },
    recordPush(cwd) {
      generation[cwd] = generationOf(cwd) + 1
    },
    canApply(cwd, token) {
      return generationOf(cwd) === token
    },
  }
}

// ---- store ------------------------------------------------------------------

export type CheckoutPhase = 'loading' | 'ready' | 'failed'

export interface CheckoutEntry {
  phase: CheckoutPhase
  status: RepoStatus | null
}

/**
 * Whether the panel offers its refresh affordance: a known git repo has
 * something to refresh, and a failed lookup deserves a retry — without one,
 * a failed first fetch would strand the workspace until restart, since no
 * other trigger ever reaches it.
 */
export function canRefresh(entry: CheckoutEntry | undefined): boolean {
  return entry?.status?.isGit === true || entry?.phase === 'failed'
}

export interface CheckoutState {
  /** Folded status per workspace directory; absent means never queried. */
  entries: Record<string, CheckoutEntry>
}

export const initialCheckout: CheckoutState = {
  entries: {},
}

export type CheckoutEvent =
  | { type: 'reset' }
  | { type: 'fetchStarted'; cwd: string }
  | { type: 'statusArrived'; payload: CheckoutStatusPayload }
  | { type: 'fetchFailed'; cwd: string }

export function reduceCheckout(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  switch (event.type) {
    case 'reset':
      return initialCheckout
    case 'fetchStarted': {
      // Known truth stays on screen until fresh truth arrives; only unknown
      // workspaces flip to loading so switching agents does not flicker.
      if (state.entries[event.cwd]) return state
      return { entries: { ...state.entries, [event.cwd]: { phase: 'loading', status: null } } }
    }
    case 'statusArrived':
      return {
        entries: {
          ...state.entries,
          [event.payload.cwd]: { phase: 'ready', status: foldCheckoutStatus(event.payload) },
        },
      }
    case 'fetchFailed':
      // Keep last-known status visible, flagged as failed; a workspace with no
      // truth yet just fails so the next trigger can retry it cleanly.
      return {
        entries: {
          ...state.entries,
          [event.cwd]: { phase: 'failed', status: state.entries[event.cwd]?.status ?? null },
        },
      }
  }
}

// ---- capability gate --------------------------------------------------------

type ServerInfo = NonNullable<ReturnType<DaemonClient['getLastServerInfoMessage']>>

/** Feature flags the daemon advertised in its server_info hello. */
export type DaemonFeatures = ServerInfo['features']

/**
 * The daemon feature flag gating the whole checkout surface. The daemon's own
 * list has no dedicated status flag; `checkoutRefresh` is the one that proves
 * the checkout subsystem exists. A missing flag hides the panel entirely.
 */
export const CHECKOUT_FEATURE_FLAG = 'checkoutRefresh' as const

export function checkoutEnabled(features: DaemonFeatures | null | undefined): boolean {
  return features?.[CHECKOUT_FEATURE_FLAG] === true
}

/** Tracks the daemon's server_info features, including across reconnects. */
export function useDaemonFeatures(daemon: DaemonClient): DaemonFeatures | null {
  const [features, setFeatures] = useState<DaemonFeatures | null>(
    () => daemon.getLastServerInfoMessage()?.features ?? null,
  )
  useEffect(() => {
    // Adopt whatever arrived before we subscribed, then track updates.
    setFeatures(daemon.getLastServerInfoMessage()?.features ?? null)
    return daemon.on('status', (message) => {
      if (message.payload.status === 'server_info') {
        setFeatures(daemon.getLastServerInfoMessage()?.features ?? null)
      }
    })
  }, [daemon])
  return features
}

// ---- live hook ---------------------------------------------------------------

export function useCheckoutStatus(
  daemon: DaemonClient,
  cwd: string | null,
): { state: CheckoutState; retry: (target: string) => void } {
  const [state, setState] = useState<CheckoutState>(initialCheckout)
  const stateRef = useRef(state)
  stateRef.current = state
  const disposedRef = useRef(false)
  const freshness = useRef(createStatusFreshness())

  const fetchOne = useCallback(
    (target: string) => {
      // A response applies only while nothing fresher left home or landed
      // first — a superseded snapshot never overwrites newer daemon truth.
      const token = freshness.current.issue(target)
      void daemon
        .getCheckoutStatus(target)
        .then((payload) => {
          if (disposedRef.current || !freshness.current.canApply(target, token)) return
          setState((prev) => reduceCheckout(prev, { type: 'statusArrived', payload }))
        })
        .catch(() => {
          if (disposedRef.current || !freshness.current.canApply(target, token)) return
          setState((prev) => reduceCheckout(prev, { type: 'fetchFailed', cwd: target }))
        })
    },
    [daemon],
  )

  useEffect(() => {
    disposedRef.current = false

    setState((prev) => reduceCheckout(prev, { type: 'reset' }))

    // Pushes are the only writer on the happy path; each carries a full fold.
    const unsubPush = daemon.on('checkout_status_update', (message) => {
      freshness.current.recordPush(message.payload.cwd)
      setState((prev) => reduceCheckout(prev, { type: 'statusArrived', payload: message.payload }))
    })

    // Actions broadcast here when they change repository truth; refetch then.
    const unsubInvalidate = onInvalidate(() => {
      for (const target of Object.keys(stateRef.current.entries)) fetchOne(target)
    })

    return () => {
      disposedRef.current = true
      unsubPush()
      unsubInvalidate()
    }
  }, [daemon, fetchOne])

  // First look at a workspace comes from one explicit fetch, deduped by the SDK.
  useEffect(() => {
    if (!cwd || state.entries[cwd]) return
    setState((prev) => reduceCheckout(prev, { type: 'fetchStarted', cwd }))
    fetchOne(cwd)
  }, [cwd, state.entries, fetchOne])

  // A failed lookup with no retained truth has no other trigger — the panel
  // hides its queue button and the first-look effect skips known entries — so
  // the retry affordance re-runs the fetch directly.
  const retry = useCallback((target: string) => fetchOne(target), [fetchOne])

  return { state, retry }
}
