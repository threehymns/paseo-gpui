/**
 * Pending permissions: one agent's outstanding requests, settled live.
 *
 * Entries are {agentId, requestId, request} keyed by agent+request, fed by the
 * daemon's permission_requested / permission_resolved stream messages. Nothing
 * polls: a request appears when asked for and leaves when resolved — whether
 * that resolution came from our respond call or another client.
 *
 * The reducer is the whole store — the hook only translates SDK events into
 * PermissionEvents and drives the wait-based respond call.
 */

import { useCallback, useEffect, useState } from 'react'
import type { PaseoClient } from '@getpaseo/client'
import type { DaemonClient } from '@getpaseo/client/internal/daemon-client'
import type { PermissionRequest, PermissionResponse } from './paseo'

export interface PermissionEntry {
  agentId: string
  requestId: string
  request: PermissionRequest
}

export interface PermissionsState {
  entries: PermissionEntry[]
  /** agent+request keys with an in-flight respond call, per card. */
  responding: string[]
}

export function permissionKey(agentId: string, requestId: string): string {
  return `${agentId}:${requestId}`
}

export const initialPermissions: PermissionsState = {
  entries: [],
  responding: [],
}

export type PermissionsEvent =
  | { type: 'reset' }
  /** Daemon truth for one agent's still-pending set (e.g. on reattach). */
  | { type: 'seeded'; agentId: string; requests: PermissionRequest[] }
  | { type: 'requested'; agentId: string; request: PermissionRequest }
  | { type: 'resolved'; agentId: string; requestId: string }
  | { type: 'respondStarted'; agentId: string; requestId: string }
  | { type: 'respondFailed'; agentId: string; requestId: string }

function upsertEntry(entries: PermissionEntry[], entry: PermissionEntry): PermissionEntry[] {
  const index = entries.findIndex(
    (candidate) => candidate.agentId === entry.agentId && candidate.requestId === entry.requestId,
  )
  if (index < 0) return [...entries, entry]
  return [...entries.slice(0, index), entry, ...entries.slice(index + 1)]
}

function removeKey(list: string[], key: string): string[] {
  const index = list.indexOf(key)
  if (index < 0) return list
  return [...list.slice(0, index), ...list.slice(index + 1)]
}

export function reducePermissions(state: PermissionsState, event: PermissionsEvent): PermissionsState {
  switch (event.type) {
    case 'reset':
      return initialPermissions
    case 'seeded': {
      // Reconcile against daemon truth (the snapshot's still-pending set)
      // without clobbering requests that landed live after we subscribed but
      // before this seed dispatched. Stale in-flight keys never survive a
      // reattach.
      const responding = state.responding.filter((key) => !key.startsWith(`${event.agentId}:`))
      const entries = event.requests.reduce(
        (acc, request) => upsertEntry(acc, { agentId: event.agentId, requestId: request.id, request }),
        state.entries,
      )
      return { entries, responding }
    }
    case 'requested':
      return {
        ...state,
        entries: upsertEntry(state.entries, {
          agentId: event.agentId,
          requestId: event.request.id,
          request: event.request,
        }),
      }
    case 'resolved': {
      const key = permissionKey(event.agentId, event.requestId)
      const entries = state.entries.filter(
        (entry) => !(entry.agentId === event.agentId && entry.requestId === event.requestId),
      )
      if (entries.length === state.entries.length && !state.responding.includes(key)) return state
      return { entries, responding: removeKey(state.responding, key) }
    }
    case 'respondStarted': {
      const key = permissionKey(event.agentId, event.requestId)
      if (state.responding.includes(key)) return state
      return { ...state, responding: [...state.responding, key] }
    }
    case 'respondFailed':
      // The card stays pending so the request can be answered again.
      return {
        ...state,
        responding: removeKey(state.responding, permissionKey(event.agentId, event.requestId)),
      }
  }
}

/** Only the active agent's pending requests render. */
export function visiblePermissions(state: PermissionsState, agentId: string | null): PermissionEntry[] {
  if (!agentId) return []
  return state.entries.filter((entry) => entry.agentId === agentId)
}

export function isResponding(state: PermissionsState, agentId: string, requestId: string): boolean {
  return state.responding.includes(permissionKey(agentId, requestId))
}

/** Allow/deny payloads that prefer the daemon-suggested action when offered. */
export function allowResponse(request: PermissionRequest): PermissionResponse {
  const action = request.actions?.find((candidate) => candidate.behavior === 'allow')
  return { behavior: 'allow', ...(action ? { selectedActionId: action.id } : {}) }
}

export function denyResponse(request: PermissionRequest): PermissionResponse {
  const action = request.actions?.find((candidate) => candidate.behavior === 'deny')
  return { behavior: 'deny', ...(action ? { selectedActionId: action.id } : {}) }
}

export function useAgentPermissions(client: PaseoClient, daemon: DaemonClient, agentId: string | null) {
  const [state, setState] = useState<PermissionsState>(initialPermissions)
  useEffect(() => {
    setState((prev) => reducePermissions(prev, { type: 'reset' }))
    if (!agentId) return

    let disposed = false
    let unsub: (() => void) | undefined

    void (async () => {
      try {
        const handle = client.agents.ref(agentId)
        // Subscribe first so live requests/resolutions flow even if the
        // best-effort seed below fails.
        unsub = handle.timeline.subscribe(({ event }) => {
          if (event.type === 'permission_requested') {
            setState((prev) => reducePermissions(prev, { type: 'requested', agentId, request: event.request }))
          } else if (event.type === 'permission_resolved') {
            setState((prev) =>
              reducePermissions(prev, { type: 'resolved', agentId, requestId: event.requestId }),
            )
          }
        })
        const snap = await handle.refresh()
        if (disposed) return
        setState((prev) =>
          reducePermissions(prev, {
            type: 'seeded',
            agentId,
            requests: snap?.agent?.pendingPermissions ?? [],
          }),
        )
      } catch {
        // Seeding is best-effort; live stream events still drive the store.
      }
    })()

    return () => {
      disposed = true
      unsub?.()
    }
  }, [client, agentId])

  const respond = useCallback(
    async (request: PermissionRequest, response: PermissionResponse) => {
      if (!agentId) return
      setState((prev) => reducePermissions(prev, { type: 'respondStarted', agentId, requestId: request.id }))
      try {
        await daemon.respondToPermissionAndWait(agentId, request.id, response)
        // The daemon also broadcasts resolution over the stream; settling here
        // keeps the card deterministic even if that broadcast races us.
        setState((prev) => reducePermissions(prev, { type: 'resolved', agentId, requestId: request.id }))
      } catch {
        setState((prev) =>
          reducePermissions(prev, { type: 'respondFailed', agentId, requestId: request.id }),
        )
      }
    },
    [daemon, agentId],
  )

  const pending = visiblePermissions(state, agentId)
  const cards = pending.map((entry) => ({ entry, responding: isResponding(state, entry.agentId, entry.requestId) }))
  return { ...state, pending, cards, respond }
}
