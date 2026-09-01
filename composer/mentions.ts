/**
 * Mention autocomplete for the composer draft: `@` opens a workspace file
 * and directory completion fed by the daemon's listing.
 *
 * The pure surface below is the whole behavior contract — the hook only adds
 * debounced fetching, and the composer only adds rendering and key routing.
 * A picked mention rides inline in the sent draft as `@<workspace-relative
 * path>` (directories keep their trailing `/`), the form an agent resolves
 * against its working directory.
 *
 * There is no caret API on @gpuix textareas, so the active mention token is
 * the trailing whitespace-delimited word of the draft when it starts with a
 * valid `@` trigger; picking always replaces that token.
 */

import { useEffect, useRef, useState } from 'react'

export interface MentionEntry {
  /** Path relative to the agent's workspace (no leading './'). */
  path: string
  kind: 'file' | 'directory'
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** The live `@token` in the draft: the query typed so far and where it starts. */
export interface MentionToken {
  query: string
  start: number
}

/**
 * Finds the active mention token in draft text, or null. A token is the last
 * whitespace-delimited word when it begins with `@` at a word boundary;
 * everything after the `@`, slashes included, is the query.
 */
export function findMentionToken(value: string): MentionToken | null {
  const start = value.length === 0 ? -1 : Math.max(
    value.lastIndexOf(' '),
    value.lastIndexOf('\t'),
    value.lastIndexOf('\n'),
  ) + 1
  const word = value.slice(start)
  if (!word.startsWith('@')) return null
  return { query: word.slice(1), start }
}

/** Replaces the active token with `@path` (plus `/` for directories) and one space. */
export function insertMention(value: string, token: MentionToken, entry: MentionEntry): string {
  const suffix = entry.kind === 'directory' ? '/' : ''
  return `${value.slice(0, token.start)}@${entry.path}${suffix} `
}

/**
 * The mention text the agent resolves best: workspace-relative when the daemon
 * listed a path under its cwd; any other absolute path loses its leading slash
 * and still resolves against the workspace root. Relative input passes through.
 */
export function mentionTargetPath(path: string, cwd: string): string {
  if (!path.startsWith('/')) return path
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path.slice(1)
}

/** Match quality tiers: lower is better; -1 means no match at all. */
const TIER_BASENAME = 0
const TIER_BASENAME_PREFIX = 1
const TIER_SEGMENT_START = 2
const TIER_SUBSTRING = 3
const TIER_SUBSEQUENCE = 4

function matchTier(query: string, path: string): number {
  const haystack = path.toLowerCase()
  const needle = query.toLowerCase()
  if (needle.length === 0) return TIER_BASENAME
  const name = basename(haystack)
  if (name === needle) return TIER_BASENAME
  if (name.startsWith(needle)) return TIER_BASENAME_PREFIX
  if (haystack.split('/').some((segment) => segment.startsWith(needle))) return TIER_SEGMENT_START
  if (haystack.includes(needle)) return TIER_SUBSTRING
  let cursor = 0
  for (const char of needle) {
    cursor = haystack.indexOf(char, cursor)
    if (cursor < 0) return -1
    cursor++
  }
  return TIER_SUBSEQUENCE
}

/**
 * Filters and ranks entries for a mention query, best first. Quality tiers:
 * exact basename, basename prefix, path-segment prefix, substring, then fuzzy
 * subsequence. Ties keep directories above files, then alphabetical order.
 */
export function rankMentions(entries: MentionEntry[], query: string): MentionEntry[] {
  const scored: { entry: MentionEntry; tier: number }[] = []
  for (const entry of entries) {
    const tier = matchTier(query, entry.path)
    if (tier >= 0) scored.push({ entry, tier })
  }
  return scored
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === 'directory' ? -1 : 1) ||
        a.entry.path.localeCompare(b.entry.path),
    )
    .map(({ entry }) => entry)
}

/** The part of the daemon's directory-suggestions reply the list cares about. */
export interface DaemonSuggestionPayload {
  directories?: string[]
  entries?: { path: string; kind: 'file' | 'directory' }[] | null
  error?: string | null
}

/**
 * Maps a daemon suggestion reply into ranked-ready mention entries. A daemon
 * error degrades to an empty list — completion is best-effort by contract.
 */
export function toMentionEntries(payload: DaemonSuggestionPayload, cwd: string): MentionEntry[] {
  if (payload.error) return []
  if (payload.entries && payload.entries.length > 0) {
    return payload.entries.map((entry) => ({ path: mentionTargetPath(entry.path, cwd), kind: entry.kind }))
  }
  return (payload.directories ?? []).map((path) => ({ path: mentionTargetPath(path, cwd), kind: 'directory' as const }))
}

// ---- live completions -------------------------------------------------------

/** Where the hook fetches suggestions; null disables completion entirely. */
export interface MentionSource {
  /** Workspace the listing scopes to. */
  cwd: string
  fetch: (query: string) => Promise<MentionEntry[]>
}

/** Rows shown in the composer popup; ranking happens over a larger fetch. */
export const MENTION_LIMIT = 8

export interface MentionCompletions {
  token: MentionToken | null
  /** Ranked entries for the active query, capped at MENTION_LIMIT. */
  entries: MentionEntry[]
  open: boolean
  highlight: number
  moveHighlight: (delta: 1 | -1) => void
  dismiss: () => void
  /** Draft text with the active token replaced; null when no token is live. */
  draftFor: (entry: MentionEntry) => string | null
}

/**
 * Fetches and ranks suggestions for the draft's active mention token. Queries
 * are debounced, stale replies dropped, and errors or empty listings simply
 * close the list — typing is never blocked.
 */
export function useMentionCompletions(source: MentionSource | null, value: string): MentionCompletions {
  const token = findMentionToken(value)
  const [entries, setEntries] = useState<MentionEntry[]>([])
  const [highlight, setHighlight] = useState(0)
  /** Token start the list was dismissed for; typing a new `@` reopens it. */
  const [dismissedStart, setDismissedStart] = useState<number | null>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const requestRef = useRef(0)

  useEffect(() => {
    setHighlight(0)
    const src = sourceRef.current
    if (!token || !src) {
      if (!token) setDismissedStart(null)
      setEntries([])
      return
    }
    const id = ++requestRef.current
    const timer = setTimeout(() => {
      src.fetch(token.query).then(
        (result) => {
          if (requestRef.current === id) setEntries(rankMentions(result, token.query).slice(0, MENTION_LIMIT))
        },
        () => {
          if (requestRef.current === id) setEntries([])
        },
      )
    }, 80)
    return () => clearTimeout(timer)
  }, [token?.start, token?.query])

  return {
    token,
    entries,
    open: token != null && dismissedStart !== token.start && entries.length > 0,
    highlight,
    moveHighlight: (delta) =>
      setHighlight((current) => Math.min(Math.max(current + delta, 0), Math.max(entries.length - 1, 0))),
    dismiss: () => setDismissedStart(token?.start ?? null),
    draftFor: (entry) => (token ? insertMention(value, token, entry) : null),
  }
}
