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
import type { PaseoAgentSendOptions, PaseoClient } from '@getpaseo/client'
import { newAttachmentId, toSendImages, type ImageAttachment } from './attachments'
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

/** A user text queued optimistically before the daemon echoes it back. */
export interface PendingSend {
  id: string
  text: string
  /** Staged chips riding along; encoded as base64 pairs on the outgoing message. */
  images: ImageAttachment[]
  /** False while parked above the composer; true once handed to the daemon. */
  sent: boolean
}

export interface ConversationState {
  turns: Turn[]
  /** Optimistic sends awaiting their daemon echo, oldest first. */
  pending: PendingSend[]
  status: ConversationStatus
  error: string | null
}

export type ConversationEvent =
  | { type: 'reset'; seedText?: string; seedImages?: ImageAttachment[] }
  | { type: 'loaded'; items: TimelineEntry[] }
  | { type: 'loadFailed'; error: unknown }
  | { type: 'timeline'; item: TimelineItem; at?: number }
  | { type: 'turnCompleted'; at?: number }
  | { type: 'turnFailed'; message: string }
  | { type: 'sendQueued'; id: string; text: string; images?: ImageAttachment[] }
  | { type: 'sendParked'; id: string; text: string; images?: ImageAttachment[] }
  | { type: 'sendReleased'; id: string }
  | { type: 'sendFailed'; error: unknown; id?: string }
  | { type: 'sendUnqueued'; id: string }

export const initialConversation: ConversationState = {
  turns: [],
  pending: [],
  status: 'loading',
  error: null,
}

function popMatch(list: PendingSend[], text: string): PendingSend[] {
  // Only a send already handed to the daemon can settle; parked twins stay.
  const index = list.findIndex((send) => send.sent && send.text === text)
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
      return {
        ...initialConversation,
        pending: event.seedText
          ? [{ id: newAttachmentId(), text: event.seedText, images: event.seedImages ?? [], sent: true }]
          : [],
      }
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
      return {
        ...state,
        pending: [...state.pending, { id: event.id, text: event.text, images: event.images ?? [], sent: true }],
      }
    case 'sendParked':
      // Parked above the composer: queued for later, not yet handed to the daemon.
      return {
        ...state,
        pending: [...state.pending, { id: event.id, text: event.text, images: event.images ?? [], sent: false }],
      }
    case 'sendReleased':
      // "Send now": the parked send becomes an ordinary in-flight one, in place.
      return {
        ...state,
        pending: state.pending.map((send) => (send.id === event.id ? { ...send, sent: true } : send)),
      }
    case 'sendFailed':
      return {
        ...state,
        // The exact send that failed leaves the queue; siblings stay parked.
        pending: event.id ? state.pending.filter((send) => send.id !== event.id) : state.pending.slice(0, -1),
        turns: applyTimelineItem(state.turns, { type: 'error', message: errorMessage(event.error) }),
      }
    case 'sendUnqueued':
      return { ...state, pending: state.pending.filter((send) => send.id !== event.id) }
  }
}

/** Daemon truth plus optimistic sends already handed to the daemon, in order.
 *  Parked sends stay above the composer until released, so they render there,
 *  not as transcript rows. */
export function visibleTurns(state: ConversationState): Turn[] {
  const inflight = state.pending.filter((send) => send.sent)
  if (inflight.length === 0) return state.turns
  return [
    ...state.turns,
    ...inflight.map((send) => ({ kind: 'user', text: send.text, queuedId: send.id }) as Turn),
  ]
}

export interface UseAgentConversationOptions {
  /** First prompt for a freshly created agent, shown until the daemon echoes it. */
  seedText?: string | null
  /** Chips staged with the first prompt of a freshly created agent. */
  seedImages?: ImageAttachment[] | null
  onSeedConsumed?: () => void
}

/**
 * How a message treats the agent's active turn: `steer` rides it, `interrupt`
 * stops it first. Omitted means deliver as a fresh message.
 */
export type TurnBehavior = 'steer' | 'interrupt'

export function useAgentConversation(
  client: PaseoClient,
  agentId: string | null,
  options: UseAgentConversationOptions = {},
) {
  const [state, setState] = useState<ConversationState>(initialConversation)
  const stateRef = useRef(state)
  stateRef.current = state
  const optionsRef = useRef(options)
  optionsRef.current = options
  const seededFor = useRef<string | null>(null)

  useEffect(() => {
    let disposed = false
    let unsub: (() => void) | undefined

    let seedText: string | undefined
    let seedImages: ImageAttachment[] | undefined
    if (agentId && seededFor.current !== agentId && optionsRef.current.seedText) {
      seedText = optionsRef.current.seedText
      seedImages = optionsRef.current.seedImages ?? undefined
      seededFor.current = agentId
      optionsRef.current.onSeedConsumed?.()
    }
    setState((prev) => reduceConversation(prev, { type: 'reset', seedText, seedImages }))
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

  /** Hands one queued send to the daemon; resolves false after surfacing the failure. */
  const deliver = useCallback(
    async (id: string, text: string, images: ImageAttachment[], behavior?: TurnBehavior): Promise<boolean> => {
      if (!agentId) return false
      try {
        await deliverText(client, agentId, text, images, behavior)
        return true
      } catch (err) {
        setState((prev) => reduceConversation(prev, { type: 'sendFailed', error: err, id }))
        return false
      }
    },
    [client, agentId],
  )

  const send = useCallback(
    async (raw: string, images: ImageAttachment[] = [], behavior?: TurnBehavior): Promise<boolean> => {
      const text = raw.trim()
      if (!text || !agentId) return false
      const id = newAttachmentId()
      setState((prev) => reduceConversation(prev, { type: 'sendQueued', id, text, images }))
      return deliver(id, text, images, behavior)
    },
    [deliver, agentId],
  )

  /** Parks draft text above the composer without handing it to the daemon. */
  const park = useCallback(
    (raw: string, images: ImageAttachment[] = []) => {
      const text = raw.trim()
      if (!text || !agentId) return
      setState((prev) => reduceConversation(prev, { type: 'sendParked', id: newAttachmentId(), text, images }))
    },
    [agentId],
  )

  /** Fires a parked send now ("Send now"): it becomes an ordinary in-flight send. */
  const release = useCallback(
    async (id: string): Promise<boolean> => {
      const target = stateRef.current.pending.find((send) => send.id === id && !send.sent)
      if (!target || !agentId) return false
      setState((prev) => reduceConversation(prev, { type: 'sendReleased', id }))
      return deliver(id, target.text, target.images)
    },
    [deliver, agentId],
  )

  /** Pulls a queued or parked send back out of the queue by id. */
  const unqueue = useCallback(
    (id: string) => {
      if (!agentId) return
      setState((prev) => reduceConversation(prev, { type: 'sendUnqueued', id }))
    },
    [agentId],
  )

  return {
    ...state,
    turns: visibleTurns(state),
    /** Parked sends, oldest first — rendered above the composer. */
    parked: state.pending.filter((send) => !send.sent),
    send,
    park,
    release,
    unqueue,
  }
}

/** The SDK's send options plus the active-turn behavior it passes through to the daemon. */
type SendOptions = PaseoAgentSendOptions & { activeTurnBehavior?: TurnBehavior }

/**
 * One daemon delivery of `text`, optionally riding (`steer`) or stopping
 * (`interrupt`) the active turn. A behavior the client cannot apply degrades to
 * a plain send so the text is never lost.
 */
async function deliverText(
  client: PaseoClient,
  agentId: string,
  text: string,
  images: ImageAttachment[],
  behavior?: TurnBehavior,
): Promise<void> {
  const payload = toSendImages(images)
  const handle = client.agents.ref(agentId)
  const options: SendOptions | undefined = behavior ? { activeTurnBehavior: behavior } : undefined
  try {
    await handle.send(text, payload.length > 0 ? { ...options, images: payload } : options)
  } catch (err) {
    if (!behavior) throw err
    // The turn could not be ridden or stopped here; deliver plainly instead.
    await handle.send(text, payload.length > 0 ? { images: payload } : undefined)
  }
}
