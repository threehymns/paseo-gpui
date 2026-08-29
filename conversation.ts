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
import type { PaseoAgentTimelineRefetchOptions, PaseoClient } from '@getpaseo/client'
import { newAttachmentId, toSendImages, type ImageAttachment } from './attachments'
import {
  applyTimelineItem,
  applyTurnCanceled,
  attachTurnUsage,
  buildTurns,
  errorMessage,
  sealTrailingTurns,
  type AgentUsage,
  type TimelineEntry,
  type TimelineItem,
  type Turn,
} from './paseo'

export type ConversationStatus = 'loading' | 'ready' | 'error'

/** Position of one fetched timeline window inside the daemon's history. */
export interface TimelineCursor {
  epoch: string
  seq: number
}

/** A user text queued optimistically before the daemon echoes it back. */
export interface PendingSend {
  id: string
  text: string
  /** Staged chips riding along; encoded as base64 pairs on the outgoing message. */
  images: ImageAttachment[]
}

export interface ConversationState {
  turns: Turn[]
  /** Optimistic sends awaiting their daemon echo, oldest first. */
  pending: PendingSend[]
  /** Latest session usage the daemon reported, if any; null until then. */
  usage: AgentUsage | null
  status: ConversationStatus
  error: string | null
  /**
   * Daemon truth, oldest first: every loaded page plus everything streamed
   * since. Turns project from this, so prepending a page re-folds without
   * disturbing streaming merges.
   */
  entries: TimelineEntry[]
  /** Cursor to fetch pages older than everything currently held; null when unknown. */
  oldestCursor: TimelineCursor | null
  hasOlder: boolean
  loadingHistory: boolean
}

/** One fetched stretch of timeline, ordered oldest first. */
export interface TimelinePage {
  items: TimelineEntry[]
  hasOlder: boolean
  /** Window start of this page; fetching `before` it yields the next older page. */
  oldestCursor: TimelineCursor | null
}

export type ConversationEvent =
  | { type: 'reset'; seedText?: string; seedImages?: ImageAttachment[] }
  | { type: 'loaded'; page: TimelinePage }
  | { type: 'historyStarted' }
  | { type: 'historyAppended'; page: TimelinePage }
  | { type: 'historyFailed' }
  | { type: 'loadFailed'; error: unknown }
  | { type: 'timeline'; item: TimelineItem; at?: number }
  | { type: 'turnCompleted'; at?: number; usage?: AgentUsage }
  // The daemon's agent_stream relay does not forward `usage_updated` yet;
  // this seam keeps mid-turn usage folding ready for when it does.
  | { type: 'usageUpdated'; usage: AgentUsage }
  | { type: 'turnFailed'; message: string }
  | { type: 'turnCanceled'; reason?: string; at?: number }
  | { type: 'sendQueued'; text: string; images?: ImageAttachment[] }
  | { type: 'sendFailed'; error: unknown }
  | { type: 'sendUnqueued'; id: string }

export const initialConversation: ConversationState = {
  turns: [],
  pending: [],
  usage: null,
  status: 'loading',
  error: null,
  entries: [],
  oldestCursor: null,
  hasOlder: false,
  loadingHistory: false,
}

function popMatch(list: PendingSend[], text: string): PendingSend[] {
  const index = list.findIndex((send) => send.text === text)
  if (index < 0) return list
  return [...list.slice(0, index), ...list.slice(index + 1)]
}

/** ISO stream/entry timestamp to epoch ms; undefined when absent or unparseable. */
function eventTime(timestamp?: string): number | undefined {
  if (!timestamp) return undefined
  const at = Date.parse(timestamp)
  return Number.isFinite(at) ? at : undefined
}

/**
 * Prepending a page re-folds turns from the entry list, but completion state
 * lives only in turns (a sealed reasoning block's duration, a finished
 * assistant turn's endedAt) — the daemon's turn_completed is not a timeline
 * entry, so the fold cannot reproduce it. The tail entry is unchanged by a
 * prepend, so carry the previous tail's seal onto the re-folded tail.
 */
function restoreTailSeal(previous: Turn[], reFolded: Turn[]): Turn[] {
  if (reFolded.length === 0) return reFolded
  const old = previous[previous.length - 1]
  const fresh = reFolded[reFolded.length - 1]
  if (!old || !fresh || old.kind !== fresh.kind) return reFolded
  if (old.kind === 'reasoning' && old.durationMs != null && fresh.durationMs == null) {
    return [...reFolded.slice(0, -1), { ...fresh, durationMs: old.durationMs }]
  }
  if (old.kind === 'assistant' && old.endedAt != null && fresh.endedAt == null) {
    return [...reFolded.slice(0, -1), { ...fresh, endedAt: old.endedAt }]
  }
  return reFolded
}

export function reduceConversation(state: ConversationState, event: ConversationEvent): ConversationState {
  switch (event.type) {
    case 'reset':
      return {
        ...initialConversation,
        pending: event.seedText
          ? [{ id: newAttachmentId(), text: event.seedText, images: event.seedImages ?? [] }]
          : [],
      }
    case 'loaded': {
      const { page } = event
      return {
        ...state,
        turns: buildTurns(page.items),
        entries: page.items,
        oldestCursor: page.oldestCursor,
        hasOlder: page.hasOlder && page.oldestCursor != null,
        loadingHistory: false,
        status: 'ready',
        error: null,
      }
    }
    case 'historyStarted':
      return state.loadingHistory ? state : { ...state, loadingHistory: true }
    case 'historyAppended': {
      // Older pages prepend to the entry list; turns re-fold from the whole
      // ordered truth so messages, reasoning blocks, and tool lifecycles that
      // straddle the page boundary merge exactly as they would have live.
      // Locally synthesized turns (send failures) are not daemon entries and
      // do not survive the re-fold.
      const { page } = event
      const entries = [...page.items, ...state.entries]
      const reFolded = buildTurns(entries)
      return {
        ...state,
        entries,
        // The tail entry is unchanged by a prepend; keep its completion state.
        turns: restoreTailSeal(state.turns, reFolded),
        // An empty page or a missing cursor means there is nothing reachable
        // to continue from — stop paging rather than wedge on a dead cursor.
        oldestCursor: page.oldestCursor ?? state.oldestCursor,
        hasOlder: page.hasOlder && page.items.length > 0 && page.oldestCursor != null,
        loadingHistory: false,
      }
    }
    case 'historyFailed':
      // A failed page fetch leaves history where it was; the next scroll-top
      // attempt retries.
      return state.loadingHistory ? { ...state, loadingHistory: false } : state
    case 'loadFailed':
      // e.g. the agent was archived while we were opening it.
      return { ...state, status: 'error', error: errorMessage(event.error) }
    case 'timeline': {
      const next = {
        ...state,
        entries: [...state.entries, { item: event.item, at: event.at }],
        turns: applyTimelineItem(state.turns, event.item, event.at),
      }
      if (event.item.type === 'user_message') {
        return { ...next, pending: popMatch(next.pending, event.item.text) }
      }
      return next
    }
    case 'turnCompleted': {
      // Ends any still-open trailing thinking block or assistant turn with
      // nothing after it, and files the turn's final usage onto its assistant turn.
      let turns = sealTrailingTurns(state.turns, event.at ?? Date.now())
      if (event.usage) turns = attachTurnUsage(turns, event.usage)
      return {
        ...state,
        turns,
        usage: event.usage ?? state.usage,
      }
    }
    case 'usageUpdated':
      // Mid-turn usage updates land on the newest assistant turn; the turn's
      // own completion overwrites it with the settled numbers.
      return { ...state, turns: attachTurnUsage(state.turns, event.usage) }
    case 'turnFailed':
      // Record the daemon-reported failure in the entry list too so it survives
      // a later history-page re-fold; only locally synthesized failures
      // (sendFailed) stay out of persistence.
      return {
        ...state,
        entries: [...state.entries, { item: { type: 'error', message: event.message } }],
        turns: applyTimelineItem(state.turns, { type: 'error', message: event.message }),
      }
    case 'turnCanceled':
      // Cancellation is its own outcome, not a failure — fold it as such.
      return { ...state, turns: applyTurnCanceled(state.turns, { at: event.at ?? Date.now(), reason: event.reason }) }
    case 'sendQueued':
      return {
        ...state,
        pending: [...state.pending, { id: newAttachmentId(), text: event.text, images: event.images ?? [] }],
      }
    case 'sendFailed':
      return {
        ...state,
        pending: state.pending.slice(0, -1),
        turns: applyTimelineItem(state.turns, { type: 'error', message: errorMessage(event.error) }),
      }
    case 'sendUnqueued':
      return { ...state, pending: state.pending.filter((send) => send.id !== event.id) }
  }
}

/** Daemon truth plus optimistic pending sends, in order. */
export function visibleTurns(state: ConversationState): Turn[] {
  if (state.pending.length === 0) return state.turns
  return [
    ...state.turns,
    ...state.pending.map((send) => ({ kind: 'user', text: send.text, queuedId: send.id }) as Turn),
  ]
}

export interface UseAgentConversationOptions {
  /** First prompt for a freshly created agent, shown until the daemon echoes it. */
  seedText?: string | null
  /** Chips staged with the first prompt of a freshly created agent. */
  seedImages?: ImageAttachment[] | null
  onSeedConsumed?: () => void
}

/** Entries fetched when the reader pages back through history. */
const PAGE_SIZE = 100
/** The initial tail window; unchanged from before paging existed. */
const TAIL_LIMIT = 300

function fetchTimelinePage(
  client: PaseoClient,
  agentId: string,
  options: PaseoAgentTimelineRefetchOptions,
): Promise<TimelinePage> {
  return client.agents.ref(agentId).timeline.refetch(options).then((page) => ({
    items: page.entries.map((entry) => ({ item: entry.item, at: eventTime(entry.timestamp) })),
    hasOlder: Boolean(page.hasOlder),
    oldestCursor: page.startCursor ?? null,
  }))
}

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
  // Bumped per agent/effect run so a late page fetch for a previous agent
  // cannot land in the new one's state.
  const generationRef = useRef(0)
  // Set synchronously (unlike the reducer's loadingHistory, which React
  // commits later) so two wheel ticks in one batch cannot double-fetch.
  const historyInFlight = useRef(false)

  useEffect(() => {
    const generation = ++generationRef.current
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
        const page = await fetchTimelinePage(client, agentId, { direction: 'tail', limit: TAIL_LIMIT })
        if (disposed || generation !== generationRef.current) return
        setState((prev) => reduceConversation(prev, { type: 'loaded', page }))
        unsub = client.agents.ref(agentId).timeline.subscribe(({ event, timestamp }) => {
          if (event.type === 'timeline') {
            setState((prev) => reduceConversation(prev, { type: 'timeline', item: event.item, at: eventTime(timestamp) }))
          } else if (event.type === 'turn_completed') {
            // Settled per-turn usage rides on turn completion; the daemon's
            // agent_stream relay does not forward mid-turn usage_updated.
            setState((prev) =>
              reduceConversation(prev, { type: 'turnCompleted', at: eventTime(timestamp), usage: event.usage }),
            )
          } else if (event.type === 'turn_failed') {
            setState((prev) => reduceConversation(prev, { type: 'turnFailed', message: event.error }))
          } else if (event.type === 'turn_canceled') {
            setState((prev) =>
              reduceConversation(prev, { type: 'turnCanceled', reason: event.reason, at: eventTime(timestamp) }),
            )
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

  /** Fetches the next older page once the transcript is scrolled to its top. */
  const loadHistory = useCallback(async () => {
    const current = stateRef.current
    if (
      historyInFlight.current ||
      !agentId ||
      !current.hasOlder ||
      !current.oldestCursor ||
      current.status !== 'ready'
    ) {
      return
    }
    const generation = generationRef.current
    historyInFlight.current = true
    setState((prev) => reduceConversation(prev, { type: 'historyStarted' }))
    try {
      const page = await fetchTimelinePage(client, agentId, {
        direction: 'before',
        cursor: current.oldestCursor,
        limit: PAGE_SIZE,
      })
      if (generation !== generationRef.current) return
      setState((prev) => reduceConversation(prev, { type: 'historyAppended', page }))
    } catch {
      // Leave history where it was; the next scroll-top retries.
      if (generation === generationRef.current) {
        setState((prev) => reduceConversation(prev, { type: 'historyFailed' }))
      }
    } finally {
      historyInFlight.current = false
    }
  }, [client, agentId])

  const send = useCallback(
    async (raw: string, images: ImageAttachment[] = []): Promise<boolean> => {
      const text = raw.trim()
      if (!text || !agentId) return false
      setState((prev) => reduceConversation(prev, { type: 'sendQueued', text, images }))
      try {
        const payload = toSendImages(images)
        await client.agents.ref(agentId).send(text, payload.length > 0 ? { images: payload } : undefined)
        return true
      } catch (err) {
        setState((prev) => reduceConversation(prev, { type: 'sendFailed', error: err }))
        return false
      }
    },
    [client, agentId],
  )

/** Pulls a queued send back out of the queue by id. */
  const unqueue = useCallback(
    (id: string) => {
      if (!agentId) return
      setState((prev) => reduceConversation(prev, { type: 'sendUnqueued', id }))
    },
    [agentId],
  )

  return { ...state, turns: visibleTurns(state), send, loadHistory, unqueue }
}
