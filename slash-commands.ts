/**
 * Slash commands: autocomplete over the daemon's command catalog.
 *
 * Typing `/` at line start, or after whitespace mid-line, opens a menu above
 * the composer. The pure functions here own every rule: where the token sits,
 * how queries rank (the protocol's tiered text matcher, no fuzzy), what a
 * pick splices into the draft, and which entries an inline menu may show
 * (skills only). The daemon fetch sits behind DaemonCommandsSeam so tests need
 * no connection; CommandCatalog adds the session/draft cache and retries, and
 * useSlashCommandMenu is the thin React adapter.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { compareMatchScores, scoreTextFields } from '@getpaseo/protocol/search/text-match'
import { errorMessage, splitModelValue } from './paseo'
import type { DraftConfig } from './draft-config'

export type SlashCommandKind = 'command' | 'skill'

export interface SlashCommand {
  name: string
  description: string
  argumentHint: string
  kind?: SlashCommandKind
}

export type SlashCommandPosition = 'start' | 'inline'

export interface SlashCommandRange {
  /** Index of the `/` itself. */
  start: number
  /** Caret index the query runs to. */
  end: number
  query: string
  position: SlashCommandPosition
}

// ---- token detection -------------------------------------------------------

/** A query stops at whitespace or any character that could be part of prose. */
const INVALID_SLASH_COMMAND_QUERY_CHARS = /[/\s\n\r\t"']/

/**
 * The slash token active at `cursorIndex`, if any: a `/` at line start or
 * preceded by whitespace whose text up to the caret is still a bare query.
 */
export function findActiveSlashCommand(input: { text: string; cursorIndex: number }): SlashCommandRange | null {
  const cursor = Math.max(0, Math.min(input.cursorIndex, input.text.length))
  const beforeCursor = input.text.slice(0, cursor)

  for (
    let slashIndex = beforeCursor.lastIndexOf('/');
    slashIndex >= 0;
    slashIndex = slashIndex === 0 ? -1 : beforeCursor.lastIndexOf('/', slashIndex - 1)
  ) {
    const previousCharacter = slashIndex > 0 ? input.text[slashIndex - 1] : ''
    if (previousCharacter && !/\s/.test(previousCharacter)) continue

    const query = beforeCursor.slice(slashIndex + 1)
    if (INVALID_SLASH_COMMAND_QUERY_CHARS.test(query)) continue

    return { start: slashIndex, end: cursor, query, position: slashIndex === 0 ? 'start' : 'inline' }
  }

  return null
}

// ---- filter and rank -------------------------------------------------------

/**
 * Rank commands for a query with the protocol's tiered matcher: every
 * whitespace-separated token must hit the name, scored by its best tier,
 * case-insensitively; ties break alphabetically. No fuzzy matching.
 */
export function filterAndRankCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) return [...commands]

  const scored: { command: SlashCommand; tier: number; offset: number; spread: number }[] = []
  for (const command of commands) {
    const score = scoreTextFields(normalizedQuery, [command.name])
    if (score) scored.push({ command, tier: score.tier, offset: score.offset, spread: score.spread ?? 0 })
  }
  scored.sort(
    (a, b) => compareMatchScores(a, b) || a.command.name.localeCompare(b.command.name),
  )
  return scored.map((entry) => entry.command)
}

/** Mid-line menus offer daemon skills only. */
export function filterInlineSkillCommands(commands: readonly SlashCommand[]): SlashCommand[] {
  return commands.filter((command) => command.kind === 'skill')
}

/** The pool a menu draws from: everything at token start, skills only inline. */
export function slashCommandMenuEntries(commands: readonly SlashCommand[], range: SlashCommandRange): SlashCommand[] {
  const pool = range.position === 'inline' ? filterInlineSkillCommands(commands) : commands
  return filterAndRankCommands(pool, range.query)
}

//---- selection --------------------------------------------------------------

/**
 * Highlight movement over display-ordered rows (best match last, nearest the
 * composer). Arrows wrap; an unset highlight enters from the nearest edge.
 */
export function nextSelectedIndex(current: number, itemCount: number, key: 'up' | 'down'): number {
  if (itemCount <= 0) return -1
  if (current < 0) return key === 'down' ? 0 : itemCount - 1
  const normalized = current % itemCount
  return key === 'down' ? (normalized + 1) % itemCount : (normalized - 1 + itemCount) % itemCount
}

// ---- replacement -----------------------------------------------------------

/**
 * Splice the picked command over the matched range. At end of text the insert
 * gains one trailing space; mid-line replacements keep surrounding words as
 * they are.
 */
export function applySlashCommandReplacement(input: { text: string; range: SlashCommandRange; commandName: string }): string {
  const before = input.text.slice(0, input.range.start)
  const after = input.text.slice(input.range.end)
  const replacement = `${before}/${input.commandName}${after}`
  return input.range.end === input.text.length ? `${replacement} ` : replacement
}

/** Where the caret lands after a replacement: right after the inserted name/space. */
export function caretAfterReplacement(range: SlashCommandRange, textLength: number, commandNameLength: number): number {
  return range.start + 1 + commandNameLength + (range.end === textLength ? 1 : 0)
}

/**
 * Best-known caret after a plain edit: edits at the end of the text stay at
 * the end; elsewhere the caret holds its position, clamped to the new length.
 */
export function nextCaretAfterEdit(previousValue: string, nextValue: string, previousCaret: number): number {
  if (previousCaret >= previousValue.length) return nextValue.length
  return Math.max(0, Math.min(previousCaret, nextValue.length))
}

// ---- draft config ----------------------------------------------------------

/** What the composer knows about a not-yet-created agent. */
export interface DraftCommandsInput extends DraftConfig {
  cwd: string
}

/** Draft context for listCommands, mirroring the protocol's shape. */
export interface DraftCommandsConfig {
  provider: string
  cwd: string
  modeId?: string
  model?: string
  thinkingOptionId?: string
}

/**
 * Project draft chips onto a listCommands draftConfig. Returns null while
 * there is nothing resolvable to ask about (no provider model or no cwd).
 */
export function draftCommandsConfig(input: DraftCommandsInput | null | undefined): DraftCommandsConfig | null {
  if (!input) return null
  const provider = splitModelValue(input.modelValue).provider.trim()
  const cwd = input.cwd.trim()
  if (!provider || !cwd) return null
  const modeId = input.modeId?.trim() ?? ''
  const model = splitModelValue(input.modelValue).modelId.trim()
  const thinkingOptionId = input.thinkingId?.trim() ?? ''
  return {
    provider,
    cwd,
    ...(modeId ? { modeId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
  }
}

// ---- fetch seam, cache, retries ---------------------------------------------

export type ListCommandsResponse = { commands: SlashCommand[]; error?: string | null }

/** The slice of the daemon driver the menu needs. */
export interface DaemonCommandsSeam {
  listCommands(input: { agentId: string; draftConfig?: DraftCommandsConfig }): Promise<ListCommandsResponse>
}

export interface CommandsTarget {
  /** Empty string when asking on behalf of a draft. */
  agentId: string
  draft?: DraftCommandsConfig
}

/** What to list for: an active agent, or the draft config for a new one. Null when unresolvable. */
export function commandsTarget(agentId: string | null, draft: DraftCommandsInput | null | undefined): CommandsTarget | null {
  if (agentId) return { agentId }
  const draftConfig = draftCommandsConfig(draft)
  return draftConfig ? { agentId: '', draft: draftConfig } : null
}

export function commandsCacheKey(target: CommandsTarget): string {
  if (!target.draft) return `session:${target.agentId}`
  const d = target.draft
  const parts = [d.provider, d.cwd, d.modeId ?? '', d.model ?? '', d.thinkingOptionId ?? '']
  return `draft:${parts.join('|')}`
}

export const SESSION_COMMANDS_TTL_MS = 60_000

interface RetryOptions {
  attempts: number
  delayMs: (retryIndex: number) => number
}

/** Initial try plus three retries, matching paseo's own backoff ceiling. */
export const LIST_COMMANDS_ATTEMPTS = 4
export const commandRetryDelay = (retryIndex: number): number => Math.min(1000 * 2 ** retryIndex, 5000)

function normalizeCommands(commands: SlashCommand[]): SlashCommand[] {
  return commands
    .map((raw) => ({
      name: typeof raw.name === 'string' ? raw.name : '',
      description: typeof raw.description === 'string' ? raw.description : '',
      argumentHint: typeof raw.argumentHint === 'string' ? raw.argumentHint : '',
      kind: raw.kind === 'skill' ? ('skill' as const) : raw.kind === 'command' ? ('command' as const) : undefined,
    }))
    .filter((command) => command.name.length > 0)
}

export async function fetchCommands(
  seam: DaemonCommandsSeam,
  target: CommandsTarget,
  options?: Partial<RetryOptions>,
): Promise<SlashCommand[]> {
  const attempts = options?.attempts ?? LIST_COMMANDS_ATTEMPTS
  const delayMs = options?.delayMs ?? commandRetryDelay
  let lastError: unknown = new Error('listCommands did not run')
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0 && delayMs(attempt - 1) > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs(attempt - 1)))
    }
    try {
      const response = await seam.listCommands({ agentId: target.agentId, ...(target.draft ? { draftConfig: target.draft } : {}) })
      if (response.error) throw new Error(response.error)
      return normalizeCommands(response.commands ?? [])
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

interface CommandsCacheEntry {
  commands: SlashCommand[]
  fetchedAt: number
}

/**
 * Commands per session or draft context. Session results stay fresh for sixty
 * seconds; draft results never expire — the draft's provider set does not move
 * under it.
 */
export class CommandCatalog {
  private cache = new Map<string, CommandsCacheEntry>()

  constructor(readonly seam: DaemonCommandsSeam) {}

  async list(target: CommandsTarget, now: number = Date.now()): Promise<SlashCommand[]> {
    const key = commandsCacheKey(target)
    const ttl = target.draft ? Number.POSITIVE_INFINITY : SESSION_COMMANDS_TTL_MS
    const hit = this.cache.get(key)
    if (hit && now - hit.fetchedAt < ttl) return hit.commands
    const commands = await fetchCommands(this.seam, target)
    this.cache.set(key, { commands, fetchedAt: now })
    return commands
  }
}

// ---- hook -------------------------------------------------------------------

export interface SlashCommandMenuController {
  /** Something is on screen: rows, the empty state, or the error row. */
  visible: boolean
  error: string | null
  /** Display order, best match last so it sits nearest the composer. */
  rows: SlashCommand[]
  selectedIndex: number
  detail: SlashCommand | null
  /** Consume a keydown; true means the menu handled it and default edits must not run. */
  handleKey: (key: string) => boolean
  select: (index: number) => void
}

interface UseSlashCommandMenuInput {
  seam: DaemonCommandsSeam | null
  agentId: string | null
  draft: DraftCommandsInput | null | undefined
  text: string
  caret: number
  onTextChange: (next: string, nextCaret: number) => void
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; commands: SlashCommand[] }
  | { status: 'error'; error: string }

export function useSlashCommandMenu(input: UseSlashCommandMenuInput): SlashCommandMenuController {
  const { seam, text, caret } = input
  const catalogRef = useRef<CommandCatalog | null>(null)
  if (seam && (!catalogRef.current || catalogRef.current.seam !== seam)) {
    catalogRef.current = new CommandCatalog(seam)
  }

  const target = useMemo(() => commandsTarget(input.agentId, input.draft), [input.agentId, input.draft])
  const targetRef = useRef(target)
  targetRef.current = target
  const range = useMemo(() => findActiveSlashCommand({ text, cursorIndex: caret }), [text, caret])
  const cacheKey = range && target ? commandsCacheKey(target) : null

  const [load, setLoad] = useState<LoadState>({ status: 'idle' })
  useEffect(() => {
    const catalog = catalogRef.current
    if (!catalog || !cacheKey) return
    const currentTarget = targetRef.current
    if (!currentTarget) return
    let disposed = false
    setLoad({ status: 'loading' })
    catalog
      .list(currentTarget)
      .then((commands) => {
        if (!disposed) setLoad({ status: 'ready', commands })
      })
      .catch((err) => {
        if (!disposed) setLoad({ status: 'error', error: errorMessage(err) })
      })
    return () => {
      disposed = true
    }
  }, [cacheKey])

  // Escape hides the menu until the query moves again; a fresh query also
  // resets the highlight to the best match.
  const [dismissed, setDismissed] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const tokenKey = range ? `${range.start}:${range.query}` : null
  const previousTokenRef = useRef<string | null>(null)
  if (previousTokenRef.current !== tokenKey) {
    previousTokenRef.current = tokenKey
    setSelectedIndex(-1)
    if (dismissed) setDismissed(false)
  }

  // Ranked best-first, then flipped so the strongest match renders nearest the
  // composer (the menu grows upward).
  const ranked = useMemo(
    () => (range && load.status === 'ready' ? slashCommandMenuEntries(load.commands, range) : []),
    [range, load],
  )
  const rows = useMemo(() => [...ranked].reverse(), [ranked])

  // The menu shows once the catalog has answered: rows, or the empty/error
  // states. While the fetch is in flight there is nothing to show yet.
  const open = range != null && !dismissed
  const settled = load.status === 'ready' || load.status === 'error'
  const visible = open && target != null && seam != null && settled

  // -1 means "unset"; it resolves to the best match, nearest the composer.
  const resolvedIndex = selectedIndex >= 0 && selectedIndex < rows.length ? selectedIndex : rows.length - 1

  const acceptRow = (row: SlashCommand | undefined) => {
    if (!row || !range) return
    input.onTextChange(
      applySlashCommandReplacement({ text, range, commandName: row.name }),
      caretAfterReplacement(range, text.length, row.name.length),
    )
  }

  const handleKey = (key: string): boolean => {
    if (!visible) return false
    if (key === 'up' || key === 'down') {
      setSelectedIndex((current) => nextSelectedIndex(current, rows.length, key))
      return true
    }
    if (key === 'enter' || key === 'tab') {
      // Consumed even without a match: neither the error nor the empty state submits.
      if (rows.length > 0) acceptRow(rows[resolvedIndex])
      return true
    }
    if (key === 'escape') {
      setDismissed(true)
      if (range?.position === 'start') input.onTextChange('', 0)
      return true
    }
    return false
  }

  const select = (index: number) => {
    if (index >= 0 && index < rows.length) acceptRow(rows[index])
  }

  return {
    visible,
    error: load.status === 'error' ? load.error : null,
    rows,
    selectedIndex: resolvedIndex,
    detail: rows[resolvedIndex] ?? null,
    handleKey,
    select,
  }
}
