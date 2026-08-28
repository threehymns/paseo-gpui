/**
 * Subagents: the store of record at the seam between daemon transport and UI.
 *
 * Rows come in two kinds. Managed ones are real child agents carrying a
 * parent agent id in their `paseo.parent-agent-id` label; they come from the
 * agent directory. Provider ones arrive as provider-owned descriptors pushed
 * by the daemon (`agent.provider_subagents.*`) and carry their own timeline.
 *
 * The reducer is the whole store — the hook only translates daemon messages
 * into SubagentsEvents, same split as conversation.ts and permissions.ts.
 * Presentation consumes the pure projections: selectTrackRows feeds the
 * tracks row's pill and panel, and an opened provider timeline renders
 * through subagentTurns. Timeline turns fold through the existing buildTurns
 * logic; terminal descriptor statuses synthesize one closing turn so
 * failed/canceled reads like any other ending without new reducer work.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DaemonClient, ProviderSubagentTimelinePayload } from '@getpaseo/client/internal/daemon-client'
import type {
  ProviderSubagentDescriptorPayload,
  SessionOutboundMessage,
} from '@getpaseo/protocol/messages'
import { getParentAgentIdFromLabels } from '@getpaseo/protocol/agent-labels'
import { buildTurns, type AgentEntry, type TimelineItem, type Turn } from './paseo'
import { C } from './theme'

export type { ProviderSubagentDescriptorPayload }

/** One provider subagent's lifecycle as the daemon reports it. */
export type SubagentStatus = 'running' | 'completed' | 'failed' | 'canceled'

/**
 * One track row. Managed agents map onto provider vocabulary: running or
 * initializing children count as running, errored ones as failed, everything
 * else as completed.
 */
export interface SubagentRow {
  kind: 'managed' | 'provider'
  id: string
  parentAgentId: string
  provider: string
  title: string | null
  description: string | null
  /** Provider-owned context; displayed verbatim, never parsed. */
  subtitle: string | null
  status: SubagentStatus
  requiresAttention: boolean
  createdAt: number
}

// ---- labels -----------------------------------------------------------------

/**
 * Trims provider-owned text for display. A literal "New agent" title is
 * placeholder noise from providers that do not name tasks, so it reads as
 * absent.
 */
export function resolveSubagentText(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const normalized = text.trim()
  if (!normalized || normalized.toLowerCase() === 'new agent') return null
  return normalized
}

/** The task names the row when present; the subagent type is the fallback. */
export function subagentLabel(
  row: Pick<SubagentRow, 'title' | 'description'> | null | undefined,
): string | null {
  if (!row) return null
  return resolveSubagentText(row.description) ?? resolveSubagentText(row.title)
}

/** Secondary line: provider subtitle first, else the type when a task names the row. */
export function subagentSubtitle(
  row: Pick<SubagentRow, 'title' | 'description' | 'subtitle'> | null | undefined,
): string | null {
  if (!row) return null
  const subtitle = resolveSubagentText(row.subtitle)
  if (subtitle) return subtitle
  const description = resolveSubagentText(row.description)
  return description ? resolveSubagentText(row.title) : null
}

// ---- rows -------------------------------------------------------------------

function managedStatus(status: AgentEntry['status']): SubagentStatus {
  switch (status) {
    case 'running':
    case 'initializing':
      return 'running'
    case 'error':
      return 'failed'
    default:
      return 'completed'
  }
}

export function managedRow(entry: AgentEntry): SubagentRow {
  return {
    kind: 'managed',
    id: entry.id,
    parentAgentId: getParentAgentIdFromLabels(entry.labels) ?? '',
    provider: entry.provider,
    title: entry.title,
    description: null,
    subtitle: null,
    status: managedStatus(entry.status),
    requiresAttention: entry.requiresAttention ?? false,
    createdAt: Date.parse(entry.createdAt),
  }
}

export function providerRow(descriptor: ProviderSubagentDescriptorPayload): SubagentRow {
  return {
    kind: 'provider',
    id: descriptor.id,
    parentAgentId: descriptor.parentAgentId,
    provider: descriptor.provider,
    title: descriptor.title,
    description: descriptor.description,
    subtitle: descriptor.subtitle ?? null,
    status: descriptor.status,
    requiresAttention: descriptor.status === 'failed',
    createdAt: Date.parse(descriptor.createdAt),
  }
}

/** Directory entries that are unarchived children of one parent. */
export function managedChildren(agents: AgentEntry[], parentAgentId: string | null): AgentEntry[] {
  if (!parentAgentId) return []
  return agents.filter(
    (entry) =>
      !entry.archivedAt && getParentAgentIdFromLabels(entry.labels) === parentAgentId,
  )
}

/** Managed and provider rows merged in creation order (oldest first). */
export function mergeRows(managed: SubagentRow[], provider: SubagentRow[]): SubagentRow[] {
  return [...managed, ...provider].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

/** Bucket counts the pill summarizes: total, plus one count per status bucket. */
export function summarizeRows(rows: SubagentRow[]): {
  total: number
  running: number
  failed: number
  awaiting: number
} {
  let running = 0
  let failed = 0
  let awaiting = 0
  for (const row of rows) {
    // Buckets are disjoint and ranked: failed first, then attention, then work.
    if (row.status === 'failed') failed += 1
    else if (row.requiresAttention) awaiting += 1
    else if (row.status === 'running') running += 1
  }
  return { total: rows.length, running, failed, awaiting }
}

/** Pill text, e.g. "2 working · 1 failed · 1 awaiting input", or "N subagents". */
export function trackLabel(rows: SubagentRow[]): string {
  const { total, running, failed, awaiting } = summarizeRows(rows)
  const parts: string[] = []
  if (running > 0) parts.push(`${running} working`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (awaiting > 0) parts.push(`${awaiting} awaiting input`)
  return parts.length > 0 ? parts.join(' · ') : `${total} subagent${total === 1 ? '' : 's'}`
}

// ---- state ------------------------------------------------------------------

export function subagentKey(parentAgentId: string, subagentId: string): string {
  return `${parentAgentId}\0${subagentId}`
}

/** One opened subagent timeline: a seq-keyed window plus paging cursor. */
export interface SubagentTimeline {
  epoch: string | null
  items: Record<number, TimelineItem>
  lastSeq: number
  hasOlder: boolean
}

export interface SubagentsState {
  /** Provider descriptors by `parent\0subagent` key. */
  descriptors: Record<string, ProviderSubagentDescriptorPayload>
  /** Timelines retained per key, whether or not they are open. */
  timelines: Record<string, SubagentTimeline>
}

export const initialSubagents: SubagentsState = { descriptors: {}, timelines: {} }

type ProviderSubagentPush = Extract<
  SessionOutboundMessage,
  { type: 'agent.provider_subagents.update' }
>['payload']

export type SubagentsEvent =
  | { type: 'listed'; parentAgentId: string; subagents: ProviderSubagentDescriptorPayload[] }
  | { type: 'upserted'; subagent: ProviderSubagentDescriptorPayload }
  | { type: 'removed'; parentAgentId: string; subagentId: string }
  /** A list/tail/older RPC response. */
  | { type: 'timelinePage'; page: ProviderSubagentTimelinePayload }
  /** A live `agent.provider_subagents.update` timeline push. */
  | { type: 'timelinePush'; push: Extract<ProviderSubagentPush, { kind: 'timeline' }> }

const emptyTimeline: SubagentTimeline = { epoch: null, items: {}, lastSeq: 0, hasOlder: false }

function index(items: Record<number, TimelineItem>): number[] {
  return Object.keys(items)
    .map(Number)
    .sort((a, b) => a - b)
}

/**
 * Folds an RPC response into the retained window.
 *
 * - `reset`, a stale cursor, or an unknown epoch invalidates what we held:
 *   the response becomes the whole window.
 * - A tail response always carries the newest window; held rows beyond its
 *   right edge survive only when contiguous (pushes that raced the fetch).
 * - A `gap` on a tail fetch means the page does not attach to newer rows we
 *   kept, so it replaces them instead. On a `before` page a gap cannot be
 *   bridged either way, so the page unions in rather than discarding the
 *   live tail we already hold.
 */
export function mergeTimelinePage(
  existing: SubagentTimeline | undefined,
  page: ProviderSubagentTimelinePayload,
): SubagentTimeline | null {
  if (!page.provider) return null
  const rows: Record<number, TimelineItem> = {}
  for (const row of page.rows) rows[row.seq] = row.item

  const epochChanged = existing != null && existing.epoch != null && existing.epoch !== page.epoch
  const fresh =
    existing == null ||
    page.reset ||
    page.staleCursor ||
    epochChanged ||
    (page.direction === 'tail' && page.gap)

  if (fresh) {
    const seqs = Object.keys(rows).map(Number)
    return {
      epoch: page.epoch,
      items: rows,
      lastSeq: seqs.length > 0 ? Math.max(...seqs) : page.window.maxSeq,
      hasOlder: page.hasOlder,
    }
  }

  if (page.direction !== 'tail') {
    const items = { ...existing!.items, ...rows }
    return { ...existing!, items, hasOlder: page.hasOlder }
  }

  let nextSeq = page.rows.length > 0 ? Math.max(...page.rows.map((row) => row.seq)) + 1 : page.window.maxSeq + 1
  const merged = { ...rows }
  for (const seq of index(existing!.items)) {
    if (seq < nextSeq) continue
    if (seq !== nextSeq) break
    merged[seq] = existing!.items[seq]!
    nextSeq += 1
  }
  return {
    epoch: page.epoch,
    items: merged,
    lastSeq: nextSeq - 1,
    hasOlder: page.hasOlder,
  }
}

function applyTimelinePush(
  existing: SubagentTimeline | undefined,
  push: Extract<ProviderSubagentPush, { kind: 'timeline' }>,
): SubagentTimeline | null {
  // A push from another generation is stale; the next open re-fetches.
  if (existing?.epoch != null && existing.epoch !== push.epoch) return null
  if (existing != null && push.seq <= existing.lastSeq) return null
  const base = existing ?? emptyTimeline
  return {
    epoch: push.epoch,
    items: { ...base.items, [push.seq]: push.item },
    lastSeq: Math.max(base.lastSeq, push.seq),
    hasOlder: base.hasOlder,
  }
}

export function reduceSubagents(state: SubagentsState, event: SubagentsEvent): SubagentsState {
  switch (event.type) {
    case 'listed': {
      // The listing is daemon truth for this parent: descriptors it no longer
      // reports leave the track, and their timelines go with them.
      const prefix = `${event.parentAgentId}\0`
      const descriptors: SubagentsState['descriptors'] = {}
      for (const [key, descriptor] of Object.entries(state.descriptors)) {
        if (!key.startsWith(prefix)) descriptors[key] = descriptor
      }
      for (const subagent of event.subagents) {
        descriptors[subagentKey(event.parentAgentId, subagent.id)] = subagent
      }
      const timelines: SubagentsState['timelines'] = {}
      for (const [key, timeline] of Object.entries(state.timelines)) {
        if (descriptors[key]) timelines[key] = timeline
      }
      const descriptorsChanged =
        Object.keys(descriptors).length !== Object.keys(state.descriptors).length ||
        Object.entries(descriptors).some(([key, descriptor]) => state.descriptors[key] !== descriptor)
      const timelinesChanged = Object.keys(timelines).length !== Object.keys(state.timelines).length
      if (!descriptorsChanged && !timelinesChanged) return state
      return { descriptors, timelines }
    }
    case 'upserted': {
      const key = subagentKey(event.subagent.parentAgentId, event.subagent.id)
      if (state.descriptors[key] === event.subagent) return state
      return { ...state, descriptors: { ...state.descriptors, [key]: event.subagent } }
    }
    case 'removed': {
      const key = subagentKey(event.parentAgentId, event.subagentId)
      if (!state.descriptors[key] && !state.timelines[key]) return state
      const descriptors = { ...state.descriptors }
      delete descriptors[key]
      const timelines = { ...state.timelines }
      delete timelines[key]
      return { descriptors, timelines }
    }
    case 'timelinePage': {
      const key = subagentKey(event.page.parentAgentId, event.page.subagentId)
      const next = mergeTimelinePage(state.timelines[key], event.page)
      if (!next) return state
      return { ...state, timelines: { ...state.timelines, [key]: next } }
    }
    case 'timelinePush': {
      const key = subagentKey(event.push.parentAgentId, event.push.subagentId)
      const next = applyTimelinePush(state.timelines[key], event.push)
      if (!next) return state
      return { ...state, timelines: { ...state.timelines, [key]: next } }
    }
  }
}

// ---- projections ------------------------------------------------------------

/** Closing turn synthesized from a terminal descriptor so endings always render. */
export function closingTurn(status: SubagentStatus): Turn | null {
  if (status === 'failed') return { kind: 'error', text: 'Subagent failed' }
  if (status === 'canceled') return { kind: 'error', text: 'Subagent canceled' }
  return null
}

/** Turns for one provider subagent: folded rows plus the closing turn. */
export function subagentTurns(
  state: SubagentsState,
  parentAgentId: string,
  subagentId: string,
): Turn[] {
  const timeline = state.timelines[subagentKey(parentAgentId, subagentId)]
  const descriptor = state.descriptors[subagentKey(parentAgentId, subagentId)]
  const entries = timeline
    ? index(timeline.items).map((seq) => ({ item: timeline.items[seq]! }))
    : []
  const turns = buildTurns(entries)
  const closing = descriptor ? closingTurn(descriptor.status) : null
  return closing ? [...turns, closing] : turns
}

export function subagentHasOlder(
  state: SubagentsState,
  parentAgentId: string,
  subagentId: string,
): boolean {
  return state.timelines[subagentKey(parentAgentId, subagentId)]?.hasOlder ?? false
}

/** Every track row for one parent: directory children plus listed descriptors. */
export function selectTrackRows(
  state: SubagentsState,
  agents: AgentEntry[],
  parentAgentId: string | null,
  providerEnabled: boolean,
): SubagentRow[] {
  if (!parentAgentId) return []
  const managed = managedChildren(agents, parentAgentId).map(managedRow)
  const provider = providerEnabled
    ? Object.entries(state.descriptors)
        .filter(([key]) => key.startsWith(`${parentAgentId}\0`))
        .map(([, descriptor]) => providerRow(descriptor))
    : []
  return mergeRows(managed, provider)
}

// ---- presentation -----------------------------------------------------------

/** The dot color a row earns: failed draws the eye, running is live, the rest are settled. */
export function subagentRowColor(row: Pick<SubagentRow, 'status' | 'requiresAttention'>): string {
  if (row.requiresAttention || row.status === 'failed') return C.danger
  if (row.status === 'running') return C.running
  return row.status === 'canceled' ? C.ghost : C.ok
}

// ---- hook -------------------------------------------------------------------

type DaemonFeatures = NonNullable<ReturnType<DaemonClient['getLastServerInfoMessage']>>['features']

export function providerSubagentsEnabled(features: DaemonFeatures | undefined | null): boolean {
  return features?.providerSubagents === true
}

const TIMELINE_PAGE_SIZE = 100

export function useSubagents(daemon: DaemonClient, activeAgentId: string | null) {
  const [state, setState] = useState<SubagentsState>(initialSubagents)
  const [enabled, setEnabled] = useState(() => providerSubagentsEnabled(daemon.getLastServerInfoMessage()?.features))
  const [loadingOlder, setLoadingOlder] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state

  // Live pushes flow for every subscribed parent; the flag tracks server_info.
  useEffect(() => {
    const offUpdate = daemon.on('agent.provider_subagents.update', ({ payload }) => {
      if (payload.kind === 'upsert') {
        setState((prev) => reduceSubagents(prev, { type: 'upserted', subagent: payload.subagent }))
      } else if (payload.kind === 'remove') {
        setState((prev) =>
          reduceSubagents(prev, {
            type: 'removed',
            parentAgentId: payload.parentAgentId,
            subagentId: payload.subagentId,
          }),
        )
      } else {
        setState((prev) => reduceSubagents(prev, { type: 'timelinePush', push: payload }))
      }
    })
    const offEvent = daemon.on((event) => {
      if (event.type === 'status' && event.payload.status === 'server_info') {
        setEnabled(providerSubagentsEnabled(daemon.getLastServerInfoMessage()?.features))
      }
    })
    return () => {
      offUpdate()
      offEvent()
    }
  }, [daemon])

  // The listing pulls once per focused parent; upsert/remove pushes keep it fresh.
  useEffect(() => {
    if (!enabled || !activeAgentId) return
    let cancelled = false
    void daemon
      .listProviderSubagents(activeAgentId)
      .then((payload) => {
        if (!cancelled) {
          setState((prev) =>
            reduceSubagents(prev, { type: 'listed', parentAgentId: activeAgentId, subagents: payload.subagents }),
          )
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [daemon, enabled, activeAgentId])

  /** Tail-loads one subagent's timeline so it can render before its first push. */
  const openTimeline = useCallback(
    (parentAgentId: string, subagentId: string) => {
      void daemon
        .fetchProviderSubagentTimeline(parentAgentId, subagentId, { direction: 'tail', limit: TIMELINE_PAGE_SIZE })
        .then((page) => setState((prev) => reduceSubagents(prev, { type: 'timelinePage', page })))
        .catch(() => undefined)
    },
    [daemon],
  )

  /** Pages one older window in via the epoch-and-seq cursor. No-op while loading or caught up. */
  const loadOlder = useCallback(
    (parentAgentId: string, subagentId: string) => {
      const timeline = stateRef.current.timelines[subagentKey(parentAgentId, subagentId)]
      const firstSeq = timeline ? Math.min(...index(timeline.items), Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
      if (
        loadingOlder ||
        !timeline?.hasOlder ||
        !timeline.epoch ||
        !Number.isFinite(firstSeq)
      ) {
        return
      }
      setLoadingOlder(true)
      void daemon
        .fetchProviderSubagentTimeline(parentAgentId, subagentId, {
          direction: 'before',
          cursor: { epoch: timeline.epoch, seq: firstSeq },
          limit: TIMELINE_PAGE_SIZE,
        })
        .then((page) => setState((prev) => reduceSubagents(prev, { type: 'timelinePage', page })))
        .catch(() => undefined)
        .finally(() => setLoadingOlder(false))
    },
    [daemon, loadingOlder],
  )

  return { state, enabled, loadingOlder, openTimeline, loadOlder }
}
