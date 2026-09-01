/**
 * Tracks row derivations: compact summaries of live work, folded from the
 * transcript turns the transcript layer already owns.
 *
 * The subagents pill is deliberately absent here — it reads the subagent
 * store's `selectTrackRows` projection instead, never transcript turns.
 *
 * Each function is pure over `Turn[]` and returns null when there is nothing
 * to show — a hidden pill, never a dead one.
 */

import { diffStats, type DiffStats, type Turn } from '../daemon/paseo'

/** Summary of the latest todo snapshot on the timeline. */
export interface TasksTrack {
  completed: number
  total: number
  /** Text of the in-progress item, when the snapshot marks exactly one. */
  active?: string
}

function lastTodo(turns: Turn[]): Extract<Turn, { kind: 'todo' }> | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.kind === 'todo') return turn
  }
  return undefined
}

export function tasksTrack(turns: Turn[]): TasksTrack | null {
  const todo = lastTodo(turns)
  if (!todo || todo.items.length === 0) return null
  const active = todo.items.find((item) => item.active)
  return {
    completed: todo.items.filter((item) => item.completed).length,
    total: todo.items.length,
    ...(active ? { active: active.text } : {}),
  }
}

/** Adds and deletes accumulated across every edit turn that carries a patch. */
export function changesTrack(turns: Turn[]): DiffStats | null {
  let additions = 0
  let deletions = 0
  let any = false
  for (const turn of turns) {
    if (turn.kind !== 'tool' || turn.tool !== 'edit' || !turn.patch) continue
    const stats = diffStats(turn.patch)
    if (!stats) continue
    additions += stats.additions
    deletions += stats.deletions
    any = true
  }
  return any ? { additions, deletions } : null
}
