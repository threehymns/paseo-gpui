/**
 * Persisted app state: a small typed seam over keyed storage.
 *
 * State lives as a flat JSON map of key names to raw values. Callers declare
 * `StateKey`s — name, fallback, and how to recognize a current-shape value —
 * so unknown keys are never read and stale values fall back to defaults.
 * Nothing stored means defaults, which keeps first run unchanged.
 *
 * Pure logic is exported for tests; useAppState is the thin React adapter.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { useEffect, useState } from 'react'

export interface StateKey<T> {
  /** Stable name in storage; change it when the value's shape changes. */
  name: string
  /** The value when nothing is stored, or what's stored is stale. */
  fallback: T
  /** Returns the value only when `raw` has the current shape, else undefined. */
  validate: (raw: unknown) => T | undefined
}

/** Where the store reads and writes its raw key-value map. */
export interface StateStorage {
  readAll(): Record<string, unknown>
  writeAll(values: Record<string, unknown>): void
}

/**
 * One JSON file as the storage map. A missing, unreadable, or non-object file
 * reads as empty — every restart lands on defaults until something is written.
 */
export function fileStateStorage(filePath: string): StateStorage {
  return {
    readAll: () => {
      try {
        const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        return parsed as Record<string, unknown>
      } catch {
        return {}
      }
    },
    writeAll: (values) => {
      // Write beside the target, then swap it in whole: a crash mid-write
      // leaves the previous state file intact instead of half-written.
      const dir = path.dirname(filePath)
      const staged = path.join(dir, `.${path.basename(filePath)}.tmp`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(staged, JSON.stringify(values))
      renameSync(staged, filePath)
    },
  }
}

/** The state file's home next to the user's other config. */
export function defaultStatePath(): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config')
  return path.join(configHome, 'gpuix-chat', 'state.json')
}

export interface AppStore {
  get<T>(key: StateKey<T>): T
  set<T>(key: StateKey<T>, value: T): void
  subscribe(listener: () => void): () => void
}

/** An in-memory map; hand the same instance to two stores to simulate a restart. */
export function memoryStorage(): StateStorage {
  const values: Record<string, unknown> = {}
  return {
    readAll: () => ({ ...values }),
    writeAll: (next) => {
      for (const name of Object.keys(values)) delete values[name]
      Object.assign(values, next)
    },
  }
}

export function createAppStore(storage: StateStorage): AppStore {
  const values: Record<string, unknown> = { ...storage.readAll() }
  adoptLegacyKeys(values, storage)
  const listeners = new Set<() => void>()

  return {
    get(key) {
      return key.validate(values[key.name]) ?? key.fallback
    },
    set(key, value) {
      values[key.name] = value
      try {
        storage.writeAll({ ...values })
      } catch (err) {
        // The session keeps its in-memory value; surface why nothing persisted.
        console.error('Failed to persist app state:', err)
      }
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// ---- sidebar preferences ----------------------------------------------------

const GROUP_MODES = ['status', 'project'] as const

function oneOf<T extends string>(choices: readonly T[]) {
  return (raw: unknown): T | undefined =>
    choices.find((choice) => choice === raw)
}

/** How the agent directory arranges its groups; see statusGroups/projectGroups. */
export const directoryGrouping: StateKey<(typeof GROUP_MODES)[number]> = {
  name: 'directory.grouping',
  fallback: 'status',
  validate: oneOf(GROUP_MODES),
}

/**
 * Whether archived workspaces stay revealed in the sidebar. Lives on its own
 * key: `directory.showArchived` used to be the archived-AGENTS toggle, and
 * reusing it here let existing installs' stored value silently feed this
 * toggle instead (see keyMigrations).
 */
export const showArchivedWorkspaces: StateKey<boolean> = {
  name: 'directory.showArchivedWorkspaces',
  fallback: false,
  validate: (raw) => (typeof raw === 'boolean' ? raw : undefined),
}

/** Whether archived agents stay revealed in the sidebar. */
export const showArchivedAgents: StateKey<boolean> = {
  name: 'directory.showArchivedAgents',
  fallback: false,
  validate: (raw) => (typeof raw === 'boolean' ? raw : undefined),
}

// ---- storage-key migrations -------------------------------------------------
//
// One-time renames, applied when a store is created and persisted immediately,
// so existing installs keep their saved preference instead of it silently
// feeding a different toggle.

interface KeyMigration {
  from: string
  to: string
  validate: (raw: unknown) => unknown
}

function keyMigrations(): KeyMigration[] {
  return [
    {
      // `directory.showArchived` was the archived-AGENTS reveal toggle before
      // the archived-workspaces toggle needed its own key; the branch had
      // reassigned the old key to workspaces, which let existing installs'
      // stored agents preference silently drive the wrong toggle. The
      // migration adopts the stored boolean into the agents key and retires
      // the legacy key, so both toggles start from their own truth.
      from: 'directory.showArchived',
      to: showArchivedAgents.name,
      validate: (raw) => (typeof raw === 'boolean' ? raw : undefined),
    },
  ]
}

/** Applies every migration once; a first run has nothing to adopt. */
function adoptLegacyKeys(values: Record<string, unknown>, storage: StateStorage): void {
  let changed = false
  for (const migration of keyMigrations()) {
    // Skip when the target already holds a current-shape value: a later
    // install's own choice must never be overwritten by the legacy key.
    if (migration.validate(values[migration.to]) !== undefined) continue
    const adopted = migration.validate(values[migration.from])
    if (adopted === undefined) continue
    values[migration.to] = adopted
    delete values[migration.from]
    changed = true
  }
  if (!changed) return
  try {
    storage.writeAll({ ...values })
  } catch {
    // The in-memory adoption still holds for this session; the migration
    // simply retries on the next launch.
  }
}

// ---- React adapter ----------------------------------------------------------

/** Reads through the store and keeps following it; writes go straight back. */
export function useAppState<T>(store: AppStore, key: StateKey<T>): [T, (value: T) => void] {
  const [value, setValue] = useState(() => store.get(key))
  useEffect(() => {
    setValue(store.get(key))
    return store.subscribe(() => setValue(store.get(key)))
  }, [store, key])
  return [value, (next) => store.set(key, next)]
}
