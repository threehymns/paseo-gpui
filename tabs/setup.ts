/**
 * Workspace setup progress: the bootstrap commands a fresh worktree runs
 * (checkout, install, env) while its first agent starts.
 *
 * One store per app, keyed by workspaceId, fed exclusively by daemon truth:
 * `workspace_setup_progress` pushes plus a `fetchWorkspaceSetupStatus` snapshot
 * for reattach/initial state. The reducer is the whole store — the hook only
 * translates daemon events and drives the reattach fetch, mirroring checkout.
 * Non-worktree agents never emit progress, so they never write here.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DaemonClient } from '@getpaseo/client/internal/daemon-client'
import { createStatusFreshness } from '../checkout/checkout'

export type SetupStatus = 'running' | 'completed' | 'failed'

export interface SetupCommandStep {
  index: number
  command: string
  cwd: string
  log: string
  status: SetupStatus
  exitCode: number | null
}

/** The structured worktree-setup detail, identical on pushes and snapshots. */
export interface WorktreeSetupDetail {
  type: 'worktree_setup'
  worktreePath: string
  branchName: string
  log: string
  commands: SetupCommandStep[]
  truncated?: boolean
}

/** One workspace's folded setup progress, as the daemon last reported it. */
export interface SetupSnapshot {
  status: SetupStatus
  detail: WorktreeSetupDetail
  error: string | null
}

/** Per-workspace setup progress; absent means the daemon has reported none. */
export interface SetupState {
  entries: Record<string, SetupSnapshot>
}

export const initialSetupState: SetupState = { entries: {} }

export type SetupEvent =
  | { type: 'reset' }
  | {
      type: 'progressArrived'
      workspaceId: string
      status: SetupStatus
      detail: WorktreeSetupDetail
      error: string | null
    }

export function reduceSetup(state: SetupState, event: SetupEvent): SetupState {
  switch (event.type) {
    case 'reset':
      return initialSetupState
    case 'progressArrived':
      // A push or snapshot carries the full fold for its workspace; the newest
      // report simply replaces the prior one, never stacking.
      return {
        entries: {
          ...state.entries,
          [event.workspaceId]: { status: event.status, detail: event.detail, error: event.error },
        },
      }
  }
}

export function selectSetup(state: SetupState, workspaceId: string): SetupSnapshot | null {
  return state.entries[workspaceId] ?? null
}

/** True once the workspace's setup reported success; drives the tab's hand-off. */
export function setupSucceeded(snapshot: SetupSnapshot | null): boolean {
  return snapshot?.status === 'completed'
}

// ---- live hook ---------------------------------------------------------------

/** Local structural copy of the push/snapshot payload, decoupled from protocol. */
interface SetupPushPayload {
  workspaceId: string
  status: SetupStatus
  detail: WorktreeSetupDetail
  error: string | null
}

/**
 * Subscribes once to every workspace's setup progress and streams it into the
 * store; `refresh` seeds a workspace's reattach snapshot. A fetch response is
 * judged by the same freshness guard as checkout, so it can never overwrite a
 * newer push that landed while the request was in flight.
 */
export function useWorkspaceSetup(daemon: DaemonClient): {
  state: SetupState
  refresh: (workspaceId: string) => void
} {
  const [state, setState] = useState<SetupState>(initialSetupState)
  const disposedRef = useRef(false)
  const freshness = useRef(createStatusFreshness())

  const refresh = useCallback(
    (workspaceId: string) => {
      const token = freshness.current.issue(workspaceId)
      void daemon
        .fetchWorkspaceSetupStatus(workspaceId)
        .then((payload) => {
          const snapshot = payload.snapshot
          if (!snapshot || disposedRef.current || !freshness.current.canApply(workspaceId, token)) return
          const folded = snapshot as unknown as Omit<SetupPushPayload, 'workspaceId'>
          setState((prev) =>
            reduceSetup(prev, {
              type: 'progressArrived',
              workspaceId,
              status: folded.status,
              detail: folded.detail,
              error: folded.error,
            }),
          )
        })
        .catch(() => {})
    },
    [daemon],
  )

  useEffect(() => {
    disposedRef.current = false
    const unsub = daemon.on('workspace_setup_progress', (message) => {
      freshness.current.recordPush(message.workspaceId)
      const payload = message.payload as unknown as SetupPushPayload
      setState((prev) =>
        reduceSetup(prev, {
          type: 'progressArrived',
          workspaceId: payload.workspaceId,
          status: payload.status,
          detail: payload.detail,
          error: payload.error,
        }),
      )
    })
    return () => {
      disposedRef.current = true
      unsub()
    }
  }, [daemon])

  return { state, refresh }
}
