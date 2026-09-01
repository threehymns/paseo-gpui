/**
 * Visited-agent history for the chrome's back/forward arrows.
 *
 * A small stack of agent ids with a cursor, the way a browser keeps visited
 * pages: opening an agent truncates any forward entries and appends; back and
 * forward only move the cursor. Pure logic, exported for tests; ChatApp is the
 * thin React adapter.
 */

/** How many visits the stack remembers before the oldest falls off. */
export const MAX_VISIT_HISTORY = 50

export interface VisitHistory {
  readonly stack: readonly string[]
  /** Cursor into `stack`; -1 means nothing visited yet. */
  readonly index: number
}

export const emptyVisitHistory: VisitHistory = { stack: [], index: -1 }

export function canGoBack(history: VisitHistory): boolean {
  return history.index > 0
}

export function canGoForward(history: VisitHistory): boolean {
  return history.index < history.stack.length - 1
}

/**
 * Records a visit. Revisiting the current entry is a no-op; otherwise the
 * forward entries die (there is no phantom future) and the visit is appended,
 * evicting the oldest visit once the cap is reached.
 */
export function visitAgent(history: VisitHistory, agentId: string): VisitHistory {
  if (history.stack[history.index] === agentId) return history
  const kept = history.stack.slice(0, history.index + 1)
  kept.push(agentId)
  const stack = kept.length > MAX_VISIT_HISTORY ? kept.slice(kept.length - MAX_VISIT_HISTORY) : kept
  return { stack, index: stack.length - 1 }
}

/** Moves the cursor back one visit; at the start edge the history is unchanged. */
export function goBack(history: VisitHistory): VisitHistory {
  return canGoBack(history) ? { ...history, index: history.index - 1 } : history
}

/** Moves the cursor forward one visit; at the end edge the history is unchanged. */
export function goForward(history: VisitHistory): VisitHistory {
  return canGoForward(history) ? { ...history, index: history.index + 1 } : history
}

/**
 * Drops the forward entries without moving: a fresh directory selection while
 * mid-stack leaves no phantom future behind it.
 */
export function truncateForward(history: VisitHistory): VisitHistory {
  if (!canGoForward(history)) return history
  return { stack: history.stack.slice(0, history.index + 1), index: history.index }
}
