/**
 * Agent conversation: one selected agent's transcript, streamed live.
 *
 * Owns the timeline lifecycle (refetch tail, then subscribe) and the pending
 * outbound sends. Optimistic user turns come from an insertion-ordered pending
 * queue; each server `user_message` echo settles the queue head that matches.
 *
 * The reducer is the whole implementation — the hook only translates SDK
 * events into ConversationEvents and renders state into turns.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaseoClient } from '@getpaseo/client'
import {
  applyTimelineItem,
  buildTurns,
  errorMessage,
  sealTrailingReasoning,
  type TimelineEntry,
  type TimelineItem,
  type Turn,
} from './paseo'

export type ConversationStatus = 'loading' | 'ready' | 'error'

export interface ConversationState {
  turns: Turn[]
  /** Optimistic user texts awaiting their server echo, oldest first. */
  pending: string[]
  status: ConversationStatus
  error: string | null
}

export type ConversationEvent =
  | { type: 'reset'; seedText?: string }
  | { type: 'loaded'; items: TimelineEntry[] }
  | { type: 'loadFailed'; error: unknown }
  | { type: 'timeline'; item: TimelineItem; at?: number }
  | { type: 'turnCompleted'; at?: number }
  | { type: 'turnFailed'; message: string }
  | { type: 'sendQueued'; text: string }
  | { type: 'sendFailed'; error: unknown }

export const initialConversation: ConversationState = {
  turns: [],
  pending: [],
  status: 'loading',
  error: null,
}

function popMatch(list: string[], text: string): string[] {
  const index = list.indexOf(text)
  if (index < 0) return list
  return [...list.slice(0, index), ...list.slice(index + 1)]
}

/** ISO stream/entry timestamp to epoch ms; undefined when absent or unparseable. */
function eventTime(timestamp?: string): number | undefined {
  if (!timestamp) return undefined
  const at = Date.parse(timestamp)
  return Number.isFinite(at) ? at : undefined
}

export function reduceConversation(state: ConversationState, event: ConversationEvent): ConversationState {
  switch (event.type) {
    case 'reset':
      return { ...initialConversation, pending: event.seedText ? [event.seedText] : [] }
    case 'loaded':
      return { ...state, turns: buildTurns(event.items), status: 'ready', error: null }
    case 'loadFailed':
      // e.g. the agent was archived while we were opening it.
      return { ...state, status: 'error', error: errorMessage(event.error) }
    case 'timeline': {
      const next = { ...state, turns: applyTimelineItem(state.turns, event.item, event.at) }
      if (event.item.type === 'user_message') {
        return { ...next, pending: popMatch(next.pending, event.item.text) }
      }
      return next
    }
    case 'turnCompleted':
      // Ends any still-open trailing thinking block with nothing after it.
      return { ...state, turns: sealTrailingReasoning(state.turns, event.at ?? Date.now()) }
    case 'turnFailed':
      return { ...state, turns: applyTimelineItem(state.turns, { type: 'error', message: event.message }) }
    case 'sendQueued':
      return { ...state, pending: [...state.pending, event.text] }
    case 'sendFailed':
      return {
        ...state,
        pending: state.pending.slice(0, -1),
        turns: applyTimelineItem(state.turns, { type: 'error', message: errorMessage(event.error) }),
      }
  }
}

/** Server truth plus optimistic pending sends, in order. */
export function visibleTurns(state: ConversationState): Turn[] {
  if (state.pending.length === 0) return state.turns
  return [
    ...state.turns,
    ...state.pending.map((text) => ({ kind: 'user', text }) as Turn),
  ]
}

export interface UseAgentConversationOptions {
  /** First prompt for a freshly created agent, shown until the daemon echoes it. */
  seedText?: string | null
  onSeedConsumed?: () => void
}

export function useAgentConversation(
  client: PaseoClient,
  agentId: string | null,
  options: UseAgentConversationOptions = {},
) {
  const [state, setState] = useState<ConversationState>(initialConversation)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const seededFor = useRef<string | null>(null)

  useEffect(() => {
    let disposed = false
    let unsub: (() => void) | undefined

    let seedText: string | undefined
    if (agentId && seededFor.current !== agentId && optionsRef.current.seedText) {
      seedText = optionsRef.current.seedText
      seededFor.current = agentId
      optionsRef.current.onSeedConsumed?.()
    }
    setState((prev) => reduceConversation(prev, { type: 'reset', seedText }))
    if (!agentId) return

    void (async () => {
      try {
        const handle = client.agents.ref(agentId)
        const page = await handle.timeline.refetch({ direction: 'tail', limit: 300 })
        if (disposed) return
        setState((prev) =>
          reduceConversation(prev, {
            type: 'loaded',
            items: page.entries.map((entry) => ({ item: entry.item, at: eventTime(entry.timestamp) })),
          }),
        )
        unsub = handle.timeline.subscribe(({ event, timestamp }) => {
          if (event.type === 'timeline') {
            setState((prev) => reduceConversation(prev, { type: 'timeline', item: event.item, at: eventTime(timestamp) }))
          } else if (event.type === 'turn_completed') {
            setState((prev) => reduceConversation(prev, { type: 'turnCompleted', at: eventTime(timestamp) }))
          } else if (event.type === 'turn_failed') {
            setState((prev) => reduceConversation(prev, { type: 'turnFailed', message: event.error }))
          }
        })
      } catch (err) {
        if (!disposed) setState((prev) => reduceConversation(prev, { type: 'loadFailed', error: err }))
      }
    })()

    return () => {
      disposed = true
      unsub?.()
    }
  }, [client, agentId])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || !agentId) return
      setState((prev) => reduceConversation(prev, { type: 'sendQueued', text }))
      try {
        await client.agents.ref(agentId).send(text)
      } catch (err) {
        setState((prev) => reduceConversation(prev, { type: 'sendFailed', error: err }))
      }
    },
    [client, agentId],
  )

  return { ...state, turns: visibleTurns(state), send }
}
