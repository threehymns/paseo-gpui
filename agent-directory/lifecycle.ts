/**
 * Agent directory lifecycle: archive, delete, and rename.
 *
 * Every mutation is a thin wrapper around the SDK client whose promise the UI
 * awaits for in-flight disabling; the directory itself is never written here.
 * Truth continues to arrive exclusively through the subscription path
 * (`applyAgentUpdate` already folds removals and archived snapshots), so a
 * settled wrapper only means the daemon accepted the call.
 */

import { isArchived, sortAgents, type AgentEntry } from '../daemon/paseo'

/** The slice of the daemon client the lifecycle wrappers need. */
export interface AgentLifecycleClient {
  archiveAgent(agentId: string): Promise<{ archivedAt: string }>
  deleteAgent(agentId: string): Promise<void>
  updateAgent(agentId: string, updates: { name?: string; labels?: Record<string, string> }): Promise<void>
}

export interface AgentLifecycle {
  /** Archives one agent; the subscription moves it out of the visible directory. */
  archive(agentId: string): Promise<{ archivedAt: string }>
  /** Deletes one agent outright; the subscription drops it once the daemon confirms. */
  remove(agentId: string): Promise<void>
  /** Renames one agent; the user-set name then outranks the auto-derived title. */
  rename(agentId: string, name: string): Promise<void>
}

/** Binds the three lifecycle mutations to one daemon client. */
export function agentLifecycle(client: AgentLifecycleClient): AgentLifecycle {
  return {
    archive: (agentId) => client.archiveAgent(agentId),
    remove: (agentId) => client.deleteAgent(agentId),
    rename: (agentId, name) => client.updateAgent(agentId, { name: name.trim() }),
  }
}

// ---- pure helpers ------------------------------------------------------------

/** The archived half of the directory, recency-sorted, for the reveal section. */
export function archivedAgents(entries: AgentEntry[]): AgentEntry[] {
  return sortAgents(entries.filter(isArchived))
}

/**
 * Settles a rename draft: the trimmed name, or null when the edit is empty or
 * unchanged — both mean cancel rather than a daemon call.
 */
export function normalizeRename(draft: string, current: string): string | null {
  const next = draft.trim()
  if (next.length === 0 || next === current) return null
  return next
}

/** True when any lifecycle action on this row is still in flight. */
export function rowActionInFlight(
  rows: readonly { id: string }[],
  id: string,
): boolean {
  return rows.some((row) => row.id === id)
}
