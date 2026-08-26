/**
 * Attention: one pure machine deciding when the user's eye is needed and when
 * the OS should say so.
 *
 * The daemon stays the sole source of truth: an agent's snapshot carries
 * `requiresAttention` with a reason (permission | error | finished) and an
 * `attentionTimestamp`. Directory updates fold through `reduceAttention`,
 * which raises in-app attention and OS notices, supersedes outstanding notices
 * by priority (permission < error < finished), and clears on composer
 * engagement — permission never auto-clears.
 *
 * OS delivery sits behind the NotificationBridge seam; where no bridge exists,
 * delivery silently no-ops. The reducer is the whole implementation — the hook
 * only translates directory changes into events and drains the outbox.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { displayName, type AgentEntry } from './paseo'

export type AttentionReason = 'permission' | 'error' | 'finished'

/** Exact OS notification titles, by reason. */
export const NOTIFICATION_TITLES: Record<AttentionReason, string> = {
  permission: 'Agent needs permission',
  error: 'Agent needs attention',
  finished: 'Agent finished',
}

export function notificationTitle(reason: AttentionReason): string {
  return NOTIFICATION_TITLES[reason]
}

/** Hard cap for notification bodies, per spec. */
export const PREVIEW_MAX_CHARS = 220

/**
 * Markdown-stripped single-line preview of a message, truncated at exactly
 * PREVIEW_MAX_CHARS. Keeps words (link labels, image alt text, code bodies);
 * drops syntax (fences, emphasis markers, list bullets, rules, tags).
 */
export function previewText(markdown: string): string {
  const text = (markdown ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^```.*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ')
    .replace(/^\s{0,3}>\s?/gm, ' ')
    .replace(/^\s*([-+*]|\d+[.)])\s+/gm, ' ')
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    // Underscore emphasis follows CommonMark's intraword rule: snake_case
    // identifiers keep their underscores; only boundary-delimited _spans_
    // strip.
    .replace(/(?<!\w)__([^_]+?)__(?!\w)/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > PREVIEW_MAX_CHARS ? text.slice(0, PREVIEW_MAX_CHARS) : text
}

// ---- machine ----------------------------------------------------------------

/** Routing identity carried by every notice; clicking one selects the agent. */
export interface AttentionPayload {
  serverId: string
  workspaceId: string | null
  agentId: string
  reason: AttentionReason
}

/** A ready-to-show OS notification. */
export interface AttentionNotice {
  payload: AttentionPayload
  title: string
  body: string
}

/**
 * The seam where notices reach the OS. Where no bridge exists, delivery
 * silently no-ops; clicking a notification deep-links via its payload.
 */
export interface NotificationBridge {
  show(notice: AttentionNotice): void
}

/** The attention-relevant shape of a daemon agent snapshot. */
export interface AgentAttentionReport {
  id: string
  workspaceId?: string | null
  requiresAttention?: boolean | null
  attentionReason?: AttentionReason | null
  attentionTimestamp?: string | null
}

export interface AttentionState {
  serverId: string
  /** In-app attention per agent — the user's eye goes here first. */
  attention: Record<string, { reason: AttentionReason; workspaceId: string | null }>
  /** One outstanding OS notice per agent, replaced only by higher priority. */
  notices: Record<string, { notice: AttentionNotice; delivered: boolean }>
  /** Last raise token acted on per agent; stale echoes never re-raise. */
  tokens: Record<string, string>
  /** Notices handed to the bridge since last drained, oldest first. */
  outbox: AttentionNotice[]
  /**
   * Whether the app window currently has focus. @gpuix ships no window-focus
   * event yet (its focus props are per-element only), so nothing feeds this
   * today: it stays true and the fire gate degrades to different-agent-only.
   * When a runtime focus source lands, dispatch `windowFocusChanged` from it.
   */
  windowFocused: boolean
  /** The agent whose conversation is on screen, if any. */
  focusedAgentId: string | null
}

export function initialAttention(serverId: string): AttentionState {
  return {
    serverId,
    attention: {},
    notices: {},
    tokens: {},
    outbox: [],
    windowFocused: true,
    focusedAgentId: null,
  }
}

export type AttentionEvent =
  | {
      type: 'agentUpdated'
      agent: AgentAttentionReport
      /** Raw markdown for the body preview; falls back to empty. */
      preview?: string
    }
  /** Composer focus, send, or blur on the given conversation. */
  | { type: 'composerEngaged'; agentId: string }
  /** The agent vanished from the daemon's directory (deleted). */
  | { type: 'agentRemoved'; agentId: string }
  /** The bridge has taken everything queued; safe to queue again. */
  | { type: 'drained' }
  | { type: 'windowFocusChanged'; focused: boolean }
  | { type: 'focusedAgentChanged'; agentId: string | null }

export function attentionOf(state: AttentionState, agentId: string): AttentionReason | null {
  return state.attention[agentId]?.reason ?? null
}

export function outstandingNoticeFor(state: AttentionState, agentId: string): AttentionNotice | undefined {
  return state.notices[agentId]?.notice
}

function buildNotice(serverId: string, report: AgentAttentionReport, preview?: string): AttentionNotice {
  const reason = report.attentionReason!
  return {
    payload: {
      serverId,
      workspaceId: report.workspaceId ?? null,
      agentId: report.id,
      reason,
    },
    title: notificationTitle(reason),
    body: previewText(preview ?? ''),
  }
}

/** Priority ordering for superseding an outstanding notice. */
const PRIORITY: Record<AttentionReason, number> = { permission: 0, error: 1, finished: 2 }

/**
 * The OS should say so only when the eye cannot already be on the agent:
 * the window is unfocused, or a different agent is on screen.
 */
function qualifies(notice: AttentionNotice, state: AttentionState): boolean {
  return !state.windowFocused || state.focusedAgentId !== notice.payload.agentId
}

/** Delivers every outstanding-but-undelivered notice the gates now allow. */
function releaseQualified(state: AttentionState): AttentionState {
  const outbox = state.outbox.slice()
  const notices: AttentionState['notices'] = { ...state.notices }
  let changed = false
  for (const [agentId, slot] of Object.entries(notices)) {
    if (!slot.delivered && qualifies(slot.notice, state)) {
      outbox.push(slot.notice)
      notices[agentId] = { ...slot, delivered: true }
      changed = true
    }
  }
  return changed ? { ...state, outbox, notices } : state
}

export function reduceAttention(state: AttentionState, event: AttentionEvent): AttentionState {
  switch (event.type) {
    case 'composerEngaged': {
      const entry = state.attention[event.agentId]
      const notice = state.notices[event.agentId]
      if (!entry && !notice) return state
      const attention = { ...state.attention }
      const notices = { ...state.notices }
      // The OS banner is moot the moment the user engages this conversation.
      delete notices[event.agentId]
      // Permission never auto-clears; only an explicit mark-as-read does.
      if (entry && entry.reason !== 'permission') delete attention[event.agentId]
      return { ...state, attention, notices }
    }
    case 'agentRemoved': {
      if (!state.attention[event.agentId] && !state.notices[event.agentId]) return state
      const attention = { ...state.attention }
      const notices = { ...state.notices }
      const tokens = { ...state.tokens }
      delete attention[event.agentId]
      delete notices[event.agentId]
      delete tokens[event.agentId]
      return { ...state, attention, notices, tokens }
    }
    case 'drained':
      return state.outbox.length === 0 ? state : { ...state, outbox: [] }
    case 'windowFocusChanged': {
      if (state.windowFocused === event.focused) return state
      return releaseQualified({ ...state, windowFocused: event.focused })
    }
    case 'focusedAgentChanged': {
      if (state.focusedAgentId === event.agentId) return state
      return releaseQualified({ ...state, focusedAgentId: event.agentId })
    }
    case 'agentUpdated': {
      const { agent } = event
      if (!agent.requiresAttention || !agent.attentionReason) {
        // Daemon truth: attention is over for this agent.
        if (!state.attention[agent.id] && !state.notices[agent.id] && state.tokens[agent.id] === undefined) {
          return state
        }
        const attention = { ...state.attention }
        const notices = { ...state.notices }
        const tokens = { ...state.tokens }
        delete attention[agent.id]
        delete notices[agent.id]
        // With truth cleared, a later rise — even the same timestamp — is new.
        delete tokens[agent.id]
        return { ...state, attention, notices, tokens }
      }
      // A raise is new when we have never acted on one, or its timestamp is
      // strictly newer than the last one acted on (ISO stamps compare
      // lexicographically). Echoes and out-of-order older stamps never
      // resurrect attention the user already dismissed.
      const prior = state.tokens[agent.id]
      const stamp = agent.attentionTimestamp
      if (prior != null && !(stamp != null && (prior === 'raised' || stamp > prior))) return state
      const token = stamp ?? 'raised'
      const reason = agent.attentionReason
      const existing = state.notices[agent.id]
      // A higher-priority reason supersedes; equal or lower leaves the ping alone.
      const supersede = !existing || PRIORITY[reason] > PRIORITY[existing.notice.payload.reason]
      let next: AttentionState = {
        ...state,
        attention: {
          ...state.attention,
          [agent.id]: { reason, workspaceId: agent.workspaceId ?? null },
        },
        tokens: { ...state.tokens, [agent.id]: token },
      }
      if (supersede) {
        const notice = buildNotice(next.serverId, agent, event.preview)
        next = { ...next, notices: { ...next.notices, [agent.id]: { notice, delivered: false } } }
        next = releaseQualified(next)
      }
      return next
    }
  }
}

// ---- hook -------------------------------------------------------------------

export interface UseAttentionOptions {
  /** The live agent directory, already maintained by the daemon subscription. */
  agents: AgentEntry[]
  /** The agent whose conversation is on screen. */
  activeId: string | null
  /** Stable identity of the daemon connection; rides in every payload. */
  serverId: string
  /**
   * Where notices meet the OS. @gpuix ships no notifier yet, so ChatApp passes
   * none and delivery silently no-ops; when a runtime bridge lands, clicking a
   * notification deep-links by re-selecting notice.payload.agentId.
   */
  bridge?: NotificationBridge | null
}

/**
 * Folds the agent directory into the attention machine and drains its outbox
 * into the bridge. The reducer stays the whole implementation; this only
 * translates directory changes into events.
 */
export function useAttention({ agents, activeId, serverId, bridge }: UseAttentionOptions) {
  const [state, setState] = useState<AttentionState>(() => initialAttention(serverId))

  // Directory truth in: removals, raises (preview falls back to the display
  // name — richer bodies need timeline data background agents don't fetch).
  // Echo updates are absorbed inside the reducer without disturbing identity.
  const prevRef = useRef<AgentEntry[]>([])
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = agents
    setState((current) => {
      let next = current
      for (const entry of prev) {
        if (!agents.some((candidate) => candidate.id === entry.id)) {
          next = reduceAttention(next, { type: 'agentRemoved', agentId: entry.id })
        }
      }
      for (const agent of agents) {
        next = reduceAttention(next, { type: 'agentUpdated', agent, preview: displayName(agent) })
      }
      return next
    })
  }, [agents])

  useEffect(() => {
    setState((current) => reduceAttention(current, { type: 'focusedAgentChanged', agentId: activeId }))
  }, [activeId])

  // Hand queued notices to the bridge — silently nowhere when none exists —
  // then drain either way so the queue cannot grow unbounded.
  const outbox = state.outbox
  useEffect(() => {
    if (outbox.length === 0) return
    if (bridge) for (const notice of outbox) bridge.show(notice)
    setState((current) => reduceAttention(current, { type: 'drained' }))
  }, [outbox, bridge])

  const engageComposer = useCallback((agentId: string | null) => {
    if (!agentId) return
    setState((current) => reduceAttention(current, { type: 'composerEngaged', agentId }))
  }, [])

  return { state, engageComposer }
}
