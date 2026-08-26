/**
 * Paseo daemon glue for the GPUIX chat client.
 *
 * The app is a view over a Paseo daemon (https://github.com/getpaseo/paseo).
 * This module owns the WebSocket client, the agent directory state helpers,
 * and the timeline -> transcript mapping. There is no mock data anywhere.
 *
 * Connection target comes from the environment:
 *   PASEO_URL       default ws://127.0.0.1:6767/ws
 *   PASEO_PASSWORD  set when the daemon requires a password
 */

import {
  createPaseoApi,
  type PaseoAgentListResult,
  type PaseoAgentStream,
  type PaseoAgentUpdate,
  type PaseoClient,
  type PaseoProviderSnapshotResult,
} from '@getpaseo/client'
import { DaemonClient } from '@getpaseo/client/internal/daemon-client'

export const DAEMON_URL = process.env.PASEO_URL ?? 'ws://127.0.0.1:6767/ws'
const DAEMON_PASSWORD = process.env.PASEO_PASSWORD

/**
 * The high-level client surface plus the low-level daemon driver it wraps.
 * The driver is needed for RPCs the SDK does not lift (permission responses).
 */
export interface DaemonSession {
  client: PaseoClient
  daemon: DaemonClient
}

export function createDaemonClient(): DaemonSession {
  const daemon = new DaemonClient({
    url: DAEMON_URL,
    clientId: `gpuix-chat-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    clientType: 'cli',
    ...(DAEMON_PASSWORD ? { password: DAEMON_PASSWORD } : {}),
    reconnect: { enabled: true },
  })
  const client: PaseoClient = {
    ...createPaseoApi(daemon),
    connect: () => daemon.connect(),
    close: () => daemon.close(),
    ensureConnected: () => daemon.ensureConnected(),
    getConnectionState: () => daemon.getConnectionState(),
  }
  return { client, daemon }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : JSON.stringify(err)
}

export type ConnStatus = 'connecting' | 'connected' | 'error'

// ---- shared SDK views ------------------------------------------------------

export type AgentDirectoryEntry = PaseoAgentListResult['entries'][number]
export type AgentEntry = AgentDirectoryEntry['agent']
export type ProviderEntry = PaseoProviderSnapshotResult['entries'][number]
export type ProviderModel = NonNullable<ProviderEntry['models']>[number]
export type ProviderMode = NonNullable<ProviderEntry['modes']>[number]

type StreamEvent = PaseoAgentStream['event']
export type TimelineItem = Extract<StreamEvent, { type: 'timeline' }>['item']
type ToolCallItem = Extract<TimelineItem, { type: 'tool_call' }>
export type ToolCallDetail = ToolCallItem['detail']

// ---- permissions ------------------------------------------------------------

export type PermissionRequestedEvent = Extract<StreamEvent, { type: 'permission_requested' }>
export type PermissionResolvedEvent = Extract<StreamEvent, { type: 'permission_resolved' }>
export type PermissionRequest = PermissionRequestedEvent['request']
export type PermissionKind = PermissionRequest['kind']
type RespondToPermissionAndWait = DaemonClient['respondToPermissionAndWait']
export type PermissionResponse = Parameters<RespondToPermissionAndWait>[2]

// ---- transcript turns ------------------------------------------------------

export type ToolName =
  | 'bash'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'fetch'
  | 'worktree'
  | 'subagent'
  | 'plan'
  | 'generic'

export type ToolStatus = 'running' | 'ok' | 'failed' | 'canceled'

export type ReasoningTurn = {
  kind: 'reasoning'
  text: string
  /** Epoch ms of the first delta; present only while the block is still open. */
  startedAt?: number
  /** Epoch ms of the most recent delta; present only while the block is still open. */
  lastDeltaAt?: number
  /** Frozen wall-clock length once thinking has ended; undefined while streaming. */
  durationMs?: number
}

export type Turn =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; source: string; messageId?: string }
  | ReasoningTurn
  | { kind: 'todo'; items: { text: string; completed: boolean; active: boolean }[] }
  | {
      kind: 'tool'
      callId: string
      tool: ToolName
      title: string
      detail?: string
      /** Structured detail from the daemon, expanded in place on activation. */
      structured?: ToolCallDetail
      patch?: string
      status: ToolStatus
    }
  | { kind: 'error'; text: string }
  | { kind: 'canceled'; reason?: string }

function splitLines(text: string): string[] {
  if (!text) return []
  const normalized = text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text
  return normalized === '' ? [''] : normalized.split(/\r?\n/)
}

/** Synthesizes a unified git patch for an edit replacement when the daemon omitted unifiedDiff. */
export function formatEditDiff(filePath: string, oldString: string, newString: string): string {
  const oldLines = splitLines(oldString)
  const newLines = splitLines(newString)
  const oldRange = oldLines.length === 0 ? '0,0' : `1,${oldLines.length}`
  const newRange = newLines.length === 0 ? '0,0' : `1,${newLines.length}`
  const header = `--- a/${filePath}\n+++ b/${filePath}\n@@ -${oldRange} +${newRange} @@`
  const deleted = oldLines.map((l) => `-${l}`)
  const added = newLines.map((l) => `+${l}`)
  return [header, ...deleted, ...added].join('\n')
}

export interface DiffStats {
  additions: number
  deletions: number
}

/** Counts additions and deletions across all hunks in a unified git patch. */
export function diffStats(patch: string | undefined): DiffStats | undefined {
  if (!patch) return undefined
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++
    }
  }
  return additions === 0 && deletions === 0 ? undefined : { additions, deletions }
}

function toolMeta(item: ToolCallItem): Pick<Turn & { kind: 'tool' }, 'tool' | 'title' | 'detail' | 'patch'> {
  const d: ToolCallDetail | undefined = item.detail
  switch (d?.type) {
    case 'shell':
      return { tool: 'bash', title: 'Bash', detail: d.command }
    case 'read':
      return { tool: 'read', title: 'Read', detail: d.filePath }
    case 'edit': {
      const patch =
        d.unifiedDiff ??
        (d.oldString != null || d.newString != null
          ? formatEditDiff(d.filePath, d.oldString ?? '', d.newString ?? '')
          : undefined)
      return { tool: 'edit', title: 'Edit', detail: d.filePath, patch }
    }
    case 'write':
      return { tool: 'write', title: 'Write', detail: d.filePath }
    case 'search':
      return {
        tool: 'search',
        title: d.toolName === 'web_search' ? 'Web search' : 'Search',
        detail: d.query,
      }
    case 'fetch':
      return { tool: 'fetch', title: 'Fetch', detail: d.url }
    case 'worktree_setup':
      return { tool: 'worktree', title: 'Worktree', detail: d.branchName }
    case 'sub_agent':
      return { tool: 'subagent', title: d.subAgentType ?? 'Agent', detail: d.description }
    case 'plan':
      return { tool: 'plan', title: 'Plan', detail: d.text }
    case 'plain_text':
      return { tool: 'generic', title: item.name, detail: d.text ?? d.label }
    default:
      return { tool: 'generic', title: item.name }
  }
}

function appendTurn(turns: Turn[], turn: Turn): Turn[] {
  return [...turns, turn]
}

/**
 * Freezes the wall-clock length of a still-streaming trailing reasoning block.
 * A reasoning block is open until any later timeline item (or turn end) proves
 * thinking has stopped; only the trailing block can be open. The length runs
 * from the first to the last delta — a quiet gap before the next item does not
 * count as thinking.
 */
export function sealTrailingReasoning(turns: Turn[], at: number): Turn[] {
  const last = turns[turns.length - 1]
  if (last?.kind !== 'reasoning' || last.durationMs != null) return turns
  const startedAt = last.startedAt ?? at
  const endedAt = last.lastDeltaAt ?? at
  const sealed: ReasoningTurn = { kind: 'reasoning', text: last.text, durationMs: Math.max(0, endedAt - startedAt) }
  return [...turns.slice(0, -1), sealed]
}

/** Human-readable wall-clock length, e.g. "47s", "1m 30s", "2h 5m". */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '0s'
  const totalSeconds = durationMs / 1000
  if (totalSeconds < 60) return `${Math.floor(totalSeconds)}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    const seconds = Math.floor(totalSeconds) % 60
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`
  }
  const hours = Math.floor(totalMinutes / 60)
  const remMinutes = totalMinutes % 60
  return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`
}

/** Collapsed-row label for a reasoning block: live progress until sealed, then its frozen duration. */
export function reasoningLabel(turn: ReasoningTurn): string {
  return turn.durationMs == null ? 'Thinking…' : `Thought for ${formatDuration(turn.durationMs)}`
}

/**
 * Folds the daemon's canceled-turn stream event into its own outcome,
 * sealing any still-open trailing thinking block first. Cancellation is kept
 * distinct from failures on purpose: nothing went wrong — the turn was stopped.
 */
export function applyTurnCanceled(turns: Turn[], options: { at?: number; reason?: string } = {}): Turn[] {
  return appendTurn(sealTrailingReasoning(turns, options.at ?? Date.now()), { kind: 'canceled', reason: options.reason })
}

// ---- expanded tool detail ---------------------------------------------------

/**
 * One rendered piece of an expanded tool row: a short status/count line
 * (`meta`) or a preformatted output/log block (`log`).
 */
export type ToolDetailPart =
  | { type: 'meta'; text: string; tone?: 'ok' | 'danger' }
  | { type: 'log'; label?: string; text: string }

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function searchCountMeta(d: Extract<ToolCallDetail, { type: 'search' }>): ToolDetailPart | null {
  if (d.toolName === 'web_search') {
    const count = d.webResults?.length ?? d.numMatches
    return count == null ? null : { type: 'meta', text: plural(count, 'result', 'results') }
  }
  if (d.numMatches != null && d.numFiles != null) {
    return { type: 'meta', text: `${plural(d.numMatches, 'match', 'matches')} in ${plural(d.numFiles, 'file', 'files')}` }
  }
  if (d.numMatches != null) return { type: 'meta', text: plural(d.numMatches, 'match', 'matches') }
  if (d.numFiles != null) return { type: 'meta', text: plural(d.numFiles, 'file', 'files') }
  return null
}

/** Maps a tool call's structured detail to the sections shown when its row expands. Empty means not expandable. */
export function toolDetailParts(detail: ToolCallDetail): ToolDetailPart[] {
  const parts: ToolDetailPart[] = []
  switch (detail.type) {
    case 'shell': {
      const output = detail.output?.trimEnd()
      if (output) parts.push({ type: 'log', text: output })
      if (detail.exitCode != null) {
        parts.push({ type: 'meta', text: `exit ${detail.exitCode}`, tone: detail.exitCode === 0 ? 'ok' : 'danger' })
      }
      return parts
    }
    case 'search': {
      const count = searchCountMeta(detail)
      if (count) parts.push(count)
      if (detail.toolName === 'web_search' && detail.webResults?.length) {
        parts.push({
          type: 'log',
          label: 'results',
          text: detail.webResults.map((r) => (r.title && r.title !== r.url ? `${r.title}\n  ${r.url}` : r.url)).join('\n'),
        })
      } else if (detail.filePaths?.length) {
        parts.push({ type: 'log', label: 'paths', text: detail.filePaths.join('\n') })
      }
      return parts
    }
    case 'fetch': {
      const statusText = [detail.code, detail.codeText].filter((v) => v != null).join(' ')
      if (statusText) {
        const ok = detail.code == null || (detail.code >= 200 && detail.code < 300)
        parts.push({ type: 'meta', text: statusText, tone: ok ? 'ok' : 'danger' })
      }
      const result = detail.result?.trimEnd()
      if (result) parts.push({ type: 'log', text: result })
      return parts
    }
    case 'worktree_setup': {
      for (const step of detail.commands) {
        const exitSuffix = step.status === 'failed' && step.exitCode != null ? ` (exit ${step.exitCode})` : ''
        const marker = step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : '•'
        const label = `${marker} ${step.command}${exitSuffix}`
        if (step.status === 'completed') parts.push({ type: 'meta', text: label, tone: 'ok' })
        else if (step.status === 'failed') parts.push({ type: 'meta', text: label, tone: 'danger' })
        else parts.push({ type: 'meta', text: label })
        const log = step.log.trimEnd()
        if (log) parts.push({ type: 'log', text: log })
      }
      if (parts.length === 0) {
        const log = detail.log.trimEnd()
        if (log) parts.push({ type: 'log', text: log })
      }
      return parts
    }
    case 'sub_agent': {
      const log = detail.log.trimEnd()
      if (log) parts.push({ type: 'log', text: log })
      for (const action of detail.actions ?? []) {
        parts.push({ type: 'meta', text: action.summary ? `${action.toolName}: ${action.summary}` : action.toolName })
      }
      return parts
    }
    default:
      return parts
  }
}

/** Folds a daemon tool-call status onto its transcript ToolStatus; cancellation stays its own outcome. */
const TOOL_STATUS_FOLD: Record<ToolCallItem['status'], ToolStatus> = {
  running: 'running',
  completed: 'ok',
  failed: 'failed',
  canceled: 'canceled',
}

/**
 * Folds one timeline item into the transcript. Streaming deltas merge into the
 * previous turn of their kind. `at` is the item's epoch-ms arrival time (live
 * event timestamp or fetched entry timestamp); it times reasoning blocks.
 *
 * Appended items seal the trailing open reasoning block — anything arriving
 * after it proves thinking has moved on. Items that replace an earlier turn
 * in place do not.
 */
export function applyTimelineItem(turns: Turn[], item: TimelineItem, at: number = Date.now()): Turn[] {
  switch (item.type) {
    case 'user_message':
      return appendTurn(sealTrailingReasoning(turns, at), { kind: 'user', text: item.text })
    case 'assistant_message': {
      const base = sealTrailingReasoning(turns, at)
      const last = base[base.length - 1]
      if (
        last?.kind === 'assistant' &&
        (item.messageId == null || last.messageId == null || last.messageId === item.messageId)
      ) {
        const merged: Turn = { kind: 'assistant', source: last.source + item.text, messageId: item.messageId ?? last.messageId }
        return [...base.slice(0, -1), merged]
      }
      return appendTurn(base, { kind: 'assistant', source: item.text, messageId: item.messageId })
    }
    case 'reasoning': {
      const last = turns[turns.length - 1]
      if (last?.kind === 'reasoning' && last.durationMs == null) {
        const merged: ReasoningTurn = {
          kind: 'reasoning',
          text: last.text + item.text,
          startedAt: last.startedAt ?? at,
          lastDeltaAt: at,
        }
        return [...turns.slice(0, -1), merged]
      }
      return appendTurn(turns, { kind: 'reasoning', text: item.text, startedAt: at, lastDeltaAt: at })
    }
    case 'tool_call': {
      const index = findLastIndex(turns, (t) => t.kind === 'tool' && t.callId === item.callId)
      const status: ToolStatus = TOOL_STATUS_FOLD[item.status]
      const next: Turn = { kind: 'tool', callId: item.callId, ...toolMeta(item), structured: item.detail, status }
      if (index >= 0) return [...turns.slice(0, index), next, ...turns.slice(index + 1)]
      return appendTurn(sealTrailingReasoning(turns, at), next)
    }
    case 'todo': {
      const items = item.items.map((task, i) => ({
        text: task.text,
        completed: task.completed || task.status === 'completed',
        active: task.status ? task.status === 'in_progress' : !task.completed && i === item.items.findIndex((t) => !t.completed),
      }))
      const base = sealTrailingReasoning(turns, at)
      const last = base[base.length - 1]
      if (last?.kind === 'todo') return [...base.slice(0, -1), { kind: 'todo', items }]
      return appendTurn(base, { kind: 'todo', items })
    }
    case 'error':
      return appendTurn(sealTrailingReasoning(turns, at), { kind: 'error', text: item.message })
    default:
      return turns
  }
}

export interface TimelineEntry {
  item: TimelineItem
  /** Epoch-ms arrival time used to time reasoning blocks; falls back to now. */
  at?: number
}

export function buildTurns(entries: TimelineEntry[]): Turn[] {
  return entries.reduce((turns, entry) => applyTimelineItem(turns, entry.item, entry.at), [] as Turn[])
}

// ---- permission cards -------------------------------------------------------

const KIND_LABELS: Record<PermissionKind, string> = {
  tool: 'Tool',
  plan: 'Plan',
  question: 'Question',
  mode: 'Mode',
  other: 'Permission',
}

export function permissionKindLabel(kind: PermissionKind): string {
  return KIND_LABELS[kind]
}

export interface PermissionDisplay {
  title: string
  detail?: string
}

/** One-line summary of what was requested, mirroring tool-call wording. */
export function permissionDisplay(request: PermissionRequest): PermissionDisplay {
  const title = request.title?.trim() || request.name
  const d = request.detail
  let detail: string | undefined
  if (d) {
    switch (d.type) {
      case 'shell':
        detail = d.command
        break
      case 'read':
      case 'edit':
      case 'write':
        detail = d.filePath
        break
      case 'search':
        detail = d.query
        break
      case 'fetch':
        detail = d.url
        break
      case 'worktree_setup':
        detail = d.branchName
        break
      case 'sub_agent':
        detail = d.description ?? d.subAgentType
        break
      case 'plan':
        detail = d.text
        break
      case 'plain_text':
        detail = d.text ?? d.label
        break
    }
  }
  return { title, detail: detail ?? request.description ?? undefined }
}

function findLastIndex<T>(list: T[], predicate: (value: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) {
    if (predicate(list[i]!)) return i
  }
  return -1
}

// ---- agent directory -------------------------------------------------------

export function activityAt(entry: AgentEntry): number {
  return Date.parse(entry.lastUserMessageAt ?? entry.updatedAt)
}

export function sortAgents(entries: AgentEntry[]): AgentEntry[] {
  return [...entries].sort((a, b) => activityAt(b) - activityAt(a))
}

export function applyAgentUpdate(entries: AgentEntry[], update: PaseoAgentUpdate): AgentEntry[] {
  if (update.kind === 'remove') {
    return entries.filter((entry) => entry.id !== update.agentId)
  }
  const rest = entries.filter((entry) => entry.id !== update.agent.id)
  return sortAgents([update.agent, ...rest])
}

export function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

export function displayName(entry: AgentEntry): string {
  const title = entry.title?.trim()
  if (title) return title
  return basename(entry.cwd)
}

// ---- sidebar status groups --------------------------------------------------
//
// The directory groups by state bucket rather than date, mirroring Paseo's own
// sidebar (packages/app, STATUS_BUCKET_ORDER): trouble first, then attention,
// then live work, then finished.

export type StatusBucket = 'needs_input' | 'failed' | 'review' | 'working' | 'done'

export const STATUS_BUCKETS: readonly StatusBucket[] = ['needs_input', 'failed', 'review', 'working', 'done']

export const STATUS_BUCKET_LABELS: Record<StatusBucket, string> = {
  needs_input: 'Needs input',
  failed: 'Failed',
  review: 'Ready to review',
  working: 'Working',
  done: 'Done',
}

/** Maps an agent's snapshot to its directory bucket. Attention outranks status. */
export function statusBucket(entry: AgentEntry): StatusBucket {
  if (entry.requiresAttention && entry.attentionReason === 'permission') return 'needs_input'
  if (entry.status === 'error') return 'failed'
  if (entry.requiresAttention && entry.attentionReason === 'finished') return 'review'
  if (entry.status === 'running' || entry.status === 'initializing') return 'working'
  return 'done'
}

/** True once the daemon has archived the agent; archiving is one-way. */
export function isArchived(entry: AgentEntry): boolean {
  return entry.archivedAt != null
}

/** Live agents only unless archived ones are revealed. */
export function visibleAgents(entries: AgentEntry[], showArchived: boolean): AgentEntry[] {
  return showArchived ? entries : entries.filter((entry) => !isArchived(entry))
}

/** Appends the trailing Archived group when one is revealed; both group modes share it. */
function withArchivedTail(
  groups: { name: string; items: AgentEntry[] }[],
  sorted: AgentEntry[],
  showArchived: boolean,
): { name: string; items: AgentEntry[] }[] {
  const archived = showArchived ? sorted.filter(isArchived) : []
  if (archived.length > 0) groups.push({ name: 'Archived', items: archived })
  return groups
}

/**
 * Folds the directory into labeled groups for the sidebar: non-empty status
 * buckets in Paseo's order, each recency-sorted, plus a trailing Archived
 * group when one is revealed.
 */
export function statusGroups(
  entries: AgentEntry[],
  showArchived: boolean,
): { name: string; items: AgentEntry[] }[] {
  const sorted = sortAgents(visibleAgents(entries, showArchived))
  const groups: { name: string; items: AgentEntry[] }[] = []
  for (const bucket of STATUS_BUCKETS) {
    const items = sorted.filter((entry) => !isArchived(entry) && statusBucket(entry) === bucket)
    if (items.length > 0) groups.push({ name: STATUS_BUCKET_LABELS[bucket], items })
  }
  return withArchivedTail(groups, sorted, showArchived)
}

/** How the sidebar arranges the directory, chosen in its view menu. */
export type DirectoryGroupMode = 'status' | 'project'

/**
 * Folds the directory into per-project groups named by working directory,
 * most recently active project first, plus the shared Archived tail.
 */
export function projectGroups(
  entries: AgentEntry[],
  showArchived: boolean,
): { name: string; items: AgentEntry[] }[] {
  const sorted = sortAgents(visibleAgents(entries, showArchived))
  const groups: { name: string; items: AgentEntry[] }[] = []
  for (const entry of sorted) {
    if (isArchived(entry)) continue
    const name = basename(entry.cwd)
    const last = groups[groups.length - 1]
    if (last && last.name === name) last.items.push(entry)
    else groups.push({ name, items: [entry] })
  }
  return withArchivedTail(groups, sorted, showArchived)
}

const DAY_MS = 86_400_000

export function relativeTime(entry: AgentEntry): string {
  const delta = Math.max(0, Date.now() - activityAt(entry))
  if (delta < 60_000) return 'now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`
  if (delta < DAY_MS) return `${Math.floor(delta / 3_600_000)}h`
  if (delta < 30 * DAY_MS) return `${Math.floor(delta / DAY_MS)}d`
  return new Date(activityAt(entry)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---- provider catalog ------------------------------------------------------

export interface ModelChoice {
  value: string
  provider: string
  providerLabel: string
  modelId: string
  label: string
}

export function readyProviders(entries: ProviderEntry[]): ProviderEntry[] {
  return entries.filter((entry) => entry.enabled !== false && entry.status === 'ready')
}

export function modelChoices(entries: ProviderEntry[]): ModelChoice[] {
  const out: ModelChoice[] = []
  for (const entry of readyProviders(entries)) {
    for (const model of entry.models ?? []) {
      if (model.isSelectable === false) continue
      out.push({
        value: `${entry.provider}/${model.id}`,
        provider: entry.provider,
        providerLabel: entry.label ?? entry.provider,
        modelId: model.id,
        label: model.label,
      })
    }
  }
  return out
}

/** Splits a `provider/model` chip value into its parts; empty for empty input. */
export function splitModelValue(value: string): { provider: string; modelId: string } {
  const slash = value.indexOf('/')
  if (slash < 0) return { provider: value, modelId: '' }
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) }
}

export function findModel(entries: ProviderEntry[], value: string | null): {
  choice: ModelChoice | undefined
  entry: ProviderEntry | undefined
  model: ProviderModel | undefined
} {
  if (!value) return { choice: undefined, entry: undefined, model: undefined }
  const { provider: providerId, modelId } = splitModelValue(value)
  const entry = entries.find((candidate) => candidate.provider === providerId)
  const model = entry?.models?.find((candidate) => candidate.id === modelId)
  const choice = modelChoices(entries).find((candidate) => candidate.value === value)
  return { choice, entry, model }
}

export function defaultModelValue(entries: ProviderEntry[]): string | null {
  for (const entry of readyProviders(entries)) {
    const models = entry.models ?? []
    const model = models.find((candidate) => candidate.isDefault) ?? models[0]
    if (model) return `${entry.provider}/${model.id}`
  }
  return null
}
