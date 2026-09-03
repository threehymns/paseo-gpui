/**
 * Workspace jump shortcuts: visible walk-order computation and pure key
 * predicates. The walk-order function mirrors the Sidebar's render order —
 * collapsed sections are skipped so the keyboard handler targets only rows the
 * sidebar actually shows — and the key predicates and navigation math stay
 * unit-testable without the runtime, mirroring palette.ts's own predicate.
 */

// ---- row model ---------------------------------------------------------------

/** One section of the walk-order: matches SidebarGroup's shape. */
export interface WalkSection {
  key: string
  name: string
  /** Pre-sorted rows; collapsed sections have their rows skipped. */
  workspaces: readonly { id: string }[]
}

// ---- pure walk-order ---------------------------------------------------------

/**
 * The visible workspace ids in walk order: one id per rendered row, sections in
 * order, rows inside a section following the sidebar's own sort (pinned first,
 * then by activity). Collapsed sections are skipped entirely. Pure over the
 * section/row model, so every Sidebar input (grouping, filters, collapse) feeds
 * in already-shaped by the caller.
 */
export function visibleWorkspaceIds(
  sections: readonly WalkSection[],
  collapsedProjects: ReadonlySet<string>,
): string[] {
  const ids: string[] = []
  for (const section of sections) {
    if (collapsedProjects.has(section.key)) continue
    for (const row of section.workspaces) ids.push(row.id)
  }
  return ids
}

// ---- key predicates ----------------------------------------------------------

export interface KeyEventLike {
  key?: string
  modifiers?: { cmd?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }
}

/** Cmd/Ctrl + digit 1–9 without alt or shift. */
export function isJumpShortcut(event: KeyEventLike): number | null {
  if (event.modifiers?.alt || event.modifiers?.shift) return null
  if (!(event.modifiers?.cmd || event.modifiers?.ctrl)) return null
  const digit = parseInt(event.key ?? '', 10)
  if (digit >= 1 && digit <= 9) return digit
  return null
}

/** Cmd/Ctrl + [ (next = ], prev = [ ) without alt or shift. */
export function isPrevWorkspace(event: KeyEventLike): boolean {
  if (event.modifiers?.alt || event.modifiers?.shift) return false
  if (!(event.modifiers?.cmd || event.modifiers?.ctrl)) return false
  return event.key === '['
}

export function isNextWorkspace(event: KeyEventLike): boolean {
  if (event.modifiers?.alt || event.modifiers?.shift) return false
  if (!(event.modifiers?.cmd || event.modifiers?.ctrl)) return false
  return event.key === ']'
}

// ---- navigation math ---------------------------------------------------------

/** Circular delta over the walk order, reusing the palette's wrap formula. */
export function moveWorkspace(currentIndex: number, count: number, delta: number): number {
  if (count <= 0) return -1
  return (((currentIndex + delta) % count) + count) % count
}

/**
 * The walk-order target for a prev/next gesture given the current selection.
 * With no selection (or a selection filtered out of the visible order), next
 * lands at the top and prev at the bottom; otherwise it wraps circularly.
 * Returns -1 only when nothing is visible.
 */
export function prevNextWorkspaceTarget(
  order: readonly string[],
  currentId: string | null,
  delta: 1 | -1,
): number {
  const count = order.length
  if (count <= 0) return -1
  const index = order.indexOf(currentId ?? '')
  if (index < 0) return delta < 0 ? count - 1 : 0
  return moveWorkspace(index, count, delta)
}
