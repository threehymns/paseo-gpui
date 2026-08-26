/**
 * Pure palette machinery: fuzzy matching, ranking into sections, and
 * keyboard-navigation math. No React and no daemon access — the view adapter
 * (palette-view.tsx) wires this to the registry and the overlay.
 */

import { ACTION_SECTIONS, SECTION_LABELS, type ActionSection, type RegisteredAction } from './actions'

/**
 * Scores `query` as a case-insensitive subsequence of `text`, or null when it
 * does not match. +16 per matched char, +8 when adjacent to the previous
 * match, +7 at a word start (string start or right after a separator), −2 per
 * skipped char — so tighter matches outrank spread-out ones.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length > text.length) return null
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let prev = -2
  for (let qi = 0; qi < q.length; qi++) {
    const index = t.indexOf(q[qi]!, prev + 1)
    if (index < 0) return null
    score += 16
    if (index === prev + 1) score += 8
    if (index === 0 || isSeparator(t[index - 1]!)) score += 7
    if (prev >= 0) score -= 2 * (index - prev - 1)
    prev = index
  }
  return score
}

function isSeparator(ch: string): boolean {
  return ch === ' ' || ch === '-' || ch === '_' || ch === '/' || ch === '.'
}

/** The haystack an action is matched against: its title plus any keywords. */
export function searchableText(action: RegisteredAction): string {
  return action.keywords ? `${action.title} ${action.keywords}` : action.title
}

export interface MatchedAction {
  action: RegisteredAction
  score: number
}

export interface MatchGroup {
  section: ActionSection
  label: string
  items: MatchedAction[]
}

/**
 * Filters the catalog for the palette: an empty query lists every enabled
 * action in registration order; otherwise fuzzy matches rank best-first
 * inside their section. Empty sections never appear.
 */
export function searchActions(actions: RegisteredAction[], query: string): MatchGroup[] {
  const candidates = actions.filter((action) => action.enabled !== false)
  const trimmed = query.trim()
  const groups: MatchGroup[] = []
  for (const section of ACTION_SECTIONS) {
    const inSection = candidates.filter((action) => action.section === section)
    if (inSection.length === 0) continue
    const items = trimmed
      ? inSection.flatMap((action) => {
          const score = fuzzyScore(trimmed, searchableText(action))
          return score == null ? [] : [{ action, score }]
        })
      : inSection.map((action) => ({ action, score: 0 }))
    items.sort((a, b) => b.score - a.score)
    if (items.length > 0) groups.push({ section, label: SECTION_LABELS[section], items })
  }
  return groups
}

/** One flat navigable list over the grouped matches, sections in order. */
export function flattenGroups(groups: MatchGroup[]): RegisteredAction[] {
  return groups.flatMap((group) => group.items.map((match) => match.action))
}

/** Moves the selection by `delta` rows with wrap-around at both ends. */
export function moveSelection(count: number, index: number, delta: number): number {
  if (count <= 0) return -1
  return (((index + delta) % count) + count) % count
}

/** Keeps a possibly stale selection inside a shrunk or grown list. */
export function clampSelection(index: number, count: number): number {
  if (count <= 0) return -1
  return Math.min(Math.max(index, 0), count - 1)
}

export interface KeyEventLike {
  key?: string
  modifiers?: { cmd?: boolean; ctrl?: boolean; alt?: boolean }
}

/** True for the palette's open/close chord: ⌘K on macOS, Ctrl+K elsewhere. */
export function isPaletteToggle(event: KeyEventLike): boolean {
  if (event.key !== 'k') return false
  const { modifiers } = event
  if (!modifiers || !(modifiers.cmd || modifiers.ctrl)) return false
  return !modifiers.alt
}
