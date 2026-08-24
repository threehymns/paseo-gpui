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
  createPaseoClient,
  type PaseoAgentListResult,
  type PaseoAgentStream,
  type PaseoAgentUpdate,
  type PaseoClient,
  type PaseoProviderSnapshotResult,
} from '@getpaseo/client'

export const DAEMON_URL = process.env.PASEO_URL ?? 'ws://127.0.0.1:6767/ws'
const DAEMON_PASSWORD = process.env.PASEO_PASSWORD

export function createDaemonClient(): PaseoClient {
  return createPaseoClient({
    url: DAEMON_URL,
    ...(DAEMON_PASSWORD ? { password: DAEMON_PASSWORD } : {}),
    reconnect: { enabled: true },
  })
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
type ToolDetail = ToolCallItem['detail']

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

export type ToolStatus = 'running' | 'ok' | 'failed'

export type Turn =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; source: string; messageId?: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'todo'; items: { text: string; completed: boolean; active: boolean }[] }
  | {
      kind: 'tool'
      callId: string
      tool: ToolName
      title: string
      detail?: string
      patch?: string
      status: ToolStatus
    }
  | { kind: 'error'; text: string }

function toolMeta(item: ToolCallItem): Pick<Turn & { kind: 'tool' }, 'tool' | 'title' | 'detail' | 'patch'> {
  const d: ToolDetail | undefined = item.detail
  switch (d?.type) {
    case 'shell':
      return { tool: 'bash', title: 'Bash', detail: d.command }
    case 'read':
      return { tool: 'read', title: 'Read', detail: d.filePath }
    case 'edit':
      return { tool: 'edit', title: 'Edit', detail: d.filePath, patch: d.unifiedDiff }
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

/** Folds one timeline item into the transcript. Streaming deltas merge into the previous turn of their kind. */
export function applyTimelineItem(turns: Turn[], item: TimelineItem): Turn[] {
  switch (item.type) {
    case 'user_message':
      return appendTurn(turns, { kind: 'user', text: item.text })
    case 'assistant_message': {
      const last = turns[turns.length - 1]
      if (
        last?.kind === 'assistant' &&
        (item.messageId == null || last.messageId == null || last.messageId === item.messageId)
      ) {
        const merged: Turn = { kind: 'assistant', source: last.source + item.text, messageId: item.messageId ?? last.messageId }
        return [...turns.slice(0, -1), merged]
      }
      return appendTurn(turns, { kind: 'assistant', source: item.text, messageId: item.messageId })
    }
    case 'reasoning': {
      const last = turns[turns.length - 1]
      if (last?.kind === 'reasoning') {
        return [...turns.slice(0, -1), { kind: 'reasoning', text: last.text + item.text }]
      }
      return appendTurn(turns, { kind: 'reasoning', text: item.text })
    }
    case 'tool_call': {
      const index = findLastIndex(turns, (t) => t.kind === 'tool' && t.callId === item.callId)
      const status: ToolStatus =
        item.status === 'running' ? 'running' : item.status === 'completed' ? 'ok' : 'failed'
      const next: Turn = { kind: 'tool', callId: item.callId, ...toolMeta(item), status }
      if (index >= 0) return [...turns.slice(0, index), next, ...turns.slice(index + 1)]
      return appendTurn(turns, next)
    }
    case 'todo': {
      const items = item.items.map((task, i) => ({
        text: task.text,
        completed: task.completed || task.status === 'completed',
        active: task.status ? task.status === 'in_progress' : !task.completed && i === item.items.findIndex((t) => !t.completed),
      }))
      const last = turns[turns.length - 1]
      if (last?.kind === 'todo') return [...turns.slice(0, -1), { kind: 'todo', items }]
      return appendTurn(turns, { kind: 'todo', items })
    }
    case 'error':
      return appendTurn(turns, { kind: 'error', text: item.message })
    default:
      return turns
  }
}

export function buildTurns(items: TimelineItem[]): Turn[] {
  return items.reduce(applyTimelineItem, [] as Turn[])
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

const DAY_MS = 86_400_000

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function groupLabel(entry: AgentEntry): string {
  const day = startOfDay(activityAt(entry))
  const today = startOfDay(Date.now())
  if (day === today) return 'Today'
  if (day === today - DAY_MS) return 'Yesterday'
  if (day > today - 7 * DAY_MS) return 'Previous 7 Days'
  return 'Earlier'
}

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

export function findModel(entries: ProviderEntry[], value: string | null): {
  choice: ModelChoice | undefined
  entry: ProviderEntry | undefined
  model: ProviderModel | undefined
} {
  if (!value) return { choice: undefined, entry: undefined, model: undefined }
  const slash = value.indexOf('/')
  const providerId = slash >= 0 ? value.slice(0, slash) : value
  const modelId = slash >= 0 ? value.slice(slash + 1) : ''
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
