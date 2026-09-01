import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createAppStore,
  directoryGrouping,
  fileStateStorage,
  memoryStorage,
  showArchivedAgents,
  showArchivedWorkspaces,
} from './app-state'

describe('app-state store', () => {
  test('first run yields defaults when nothing is stored', () => {
    const store = createAppStore(memoryStorage())
    expect(store.get(directoryGrouping)).toBe('status')
    expect(store.get(showArchivedWorkspaces)).toBe(false)
  })

  test('a written value reads back until overwritten', () => {
    const store = createAppStore(memoryStorage())
    store.set(directoryGrouping, 'project')
    expect(store.get(directoryGrouping)).toBe('project')
    store.set(directoryGrouping, 'status')
    expect(store.get(directoryGrouping)).toBe('status')
    store.set(showArchivedWorkspaces, true)
    expect(store.get(showArchivedWorkspaces)).toBe(true)
  })

  test('stale values from older versions fall back to defaults', () => {
    const stale = {
      readAll: () => ({
        'directory.grouping': 'alphabetical',
        'directory.showArchived': 'yes',
        'removed.preference': { nested: true },
      }),
      writeAll: () => {},
    }
    const store = createAppStore(stale)
    expect(store.get(directoryGrouping)).toBe('status')
    expect(store.get(showArchivedWorkspaces)).toBe(false)
  })

  test('choices survive a restart: a fresh store over the same storage reads them', () => {
    const storage = memoryStorage()
    createAppStore(storage).set(directoryGrouping, 'project')
    const reopened = createAppStore(storage)
    expect(reopened.get(directoryGrouping)).toBe('project')
  })

  describe('legacy key migration', () => {
    test('a stored archived-AGENTS value moves to showArchivedAgents, not the workspaces toggle', () => {
      const storage = memoryStorage()
      storage.writeAll({ 'directory.showArchived': true })
      const store = createAppStore(storage)
      expect(store.get(showArchivedAgents)).toBe(true)
      // The legacy key is retired, so the workspaces toggle starts at its own
      // default instead of inheriting the old agents value.
      expect(store.get(showArchivedWorkspaces)).toBe(false)
    })

    test('the migration persists, so a restart keeps it and never re-reads the legacy key', () => {
      const storage = memoryStorage()
      storage.writeAll({ 'directory.showArchived': true })
      createAppStore(storage)
      expect(storage.readAll()).toEqual({ 'directory.showArchivedAgents': true })
    })

    test('an existing showArchivedAgents value wins over the legacy key', () => {
      const storage = memoryStorage()
      storage.writeAll({ 'directory.showArchived': true, 'directory.showArchivedAgents': false })
      const store = createAppStore(storage)
      expect(store.get(showArchivedAgents)).toBe(false)
      // Nothing was adopted, so the legacy key survives untouched.
      expect(storage.readAll()['directory.showArchived']).toBe(true)
    })

    test('the workspaces toggle reads its own key, untouched by the migration', () => {
      const storage = memoryStorage()
      storage.writeAll({ 'directory.showArchived': true, 'directory.showArchivedWorkspaces': true })
      const store = createAppStore(storage)
      expect(store.get(showArchivedAgents)).toBe(true)
      expect(store.get(showArchivedWorkspaces)).toBe(true)
    })

    test('a non-boolean legacy value is never adopted', () => {
      const storage = memoryStorage()
      storage.writeAll({ 'directory.showArchived': 'yes' })
      const store = createAppStore(storage)
      expect(store.get(showArchivedAgents)).toBe(false)
      expect(storage.readAll()['directory.showArchived']).toBe('yes')
    })

    test('a first run with no stored state migrates nothing', () => {
      const storage = memoryStorage()
      const store = createAppStore(storage)
      expect(store.get(showArchivedAgents)).toBe(false)
      expect(storage.readAll()).toEqual({})
    })
  })
})

describe('file-backed storage', () => {
  let dir: string
  const statePath = (name: string) => path.join(dir, name)

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'app-state-test-'))
  })

  test('a written file reads back in a fresh store, as a restart would', () => {
    const file = statePath('state.json')
    createAppStore(fileStateStorage(file)).set(showArchivedWorkspaces, true)
    expect(createAppStore(fileStateStorage(file)).get(showArchivedWorkspaces)).toBe(true)
  })

  test('a missing file means first run', () => {
    const store = createAppStore(fileStateStorage(statePath('never-written.json')))
    expect(store.get(directoryGrouping)).toBe('status')
    expect(store.get(showArchivedWorkspaces)).toBe(false)
  })

  test('an unreadable or non-object file falls back to defaults', () => {
    for (const contents of ['{not json', '"just a string"', '[1, 2]', 'null']) {
      const file = statePath(`corrupt-${contents.length}-${contents.charCodeAt(1)}.json`)
      writeFileSync(file, contents)
      const store = createAppStore(fileStateStorage(file))
      expect(store.get(directoryGrouping)).toBe('status')
      expect(store.get(showArchivedWorkspaces)).toBe(false)
    }
  })

  test('writing into a missing directory creates it', () => {
    const file = statePath('nested' + path.sep + 'deeper' + path.sep + 'state.json')
    createAppStore(fileStateStorage(file)).set(directoryGrouping, 'project')
    expect(createAppStore(fileStateStorage(file)).get(directoryGrouping)).toBe('project')
  })

  test('a failed write leaves the last persisted file usable', () => {
    const good = createAppStore(fileStateStorage(statePath('good.json')))
    good.set(directoryGrouping, 'project')

    // A directory sitting where the file belongs makes every write fail.
    mkdirSync(statePath('blocked.json'))
    const blocked = createAppStore(fileStateStorage(statePath('blocked.json')))
    blocked.set(showArchivedWorkspaces, true)
    expect(blocked.get(showArchivedWorkspaces)).toBe(true)

    const reopened = createAppStore(fileStateStorage(statePath('good.json')))
    expect(reopened.get(directoryGrouping)).toBe('project')
    expect(reopened.get(showArchivedWorkspaces)).toBe(false)
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
})
