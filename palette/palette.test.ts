import { describe, expect, test } from 'bun:test'
import type { RegisteredAction } from './actions'
import { clampSelection, flattenGroups, fuzzyScore, isPaletteToggle, moveSelection, searchActions } from './palette'

function action(overrides: Partial<RegisteredAction> & { id: string }): RegisteredAction {
  return { title: overrides.id, section: 'actions', run: () => {}, ...overrides }
}

describe('search actions', () => {
  const catalog: RegisteredAction[] = [
    action({ id: 'app.new-task', title: 'New Task', section: 'actions' }),
    action({ id: 'ws.paseo', title: 'paseo', section: 'workspaces', hint: '~/code/paseo' }),
    action({ id: 'agent.1', title: 'Fix flaky test', section: 'agents', keywords: 'paseo working' }),
    action({ id: 'agent.2', title: 'Write docs', section: 'agents', keywords: 'gpui done' }),
    action({ id: 'model.sonnet', title: 'Sonnet 4.6', section: 'model' }),
  ]

  test('an empty query lists everything grouped by fixed section order', () => {
    const groups = searchActions(catalog, '')
    expect(groups.map((g) => g.section)).toEqual(['actions', 'workspaces', 'agents', 'model'])
    expect(groups[0]!.label).toBe('Actions')
    expect(groups[0]!.items.map((m) => m.action.id)).toEqual(['app.new-task'])
    expect(groups[2]!.items.map((m) => m.action.id)).toEqual(['agent.1', 'agent.2'])
  })

  test('sections with no entries are dropped', () => {
    expect(searchActions([catalog[0]!], '').map((g) => g.section)).toEqual(['actions'])
  })

  test('a query keeps only fuzzy matches across sections', () => {
    const groups = searchActions(catalog, 'task')
    expect(groups.map((g) => g.section)).toEqual(['actions', 'agents'])
    expect(groups.flatMap((g) => g.items.map((m) => m.action.id))).toEqual(['app.new-task', 'agent.1'])
  })

  test('keywords extend the haystack beyond the title', () => {
    const groups = searchActions(catalog, 'gpui')
    expect(groups.map((g) => g.section)).toEqual(['agents'])
    expect(groups[0]!.items[0]!.action.id).toBe('agent.2')
  })

  test('matches rank best-first inside their section', () => {
    const ranked = searchActions(
      [
        action({ id: 'spread', title: 'restart agent task' }),
        action({ id: 'tight', title: 'Task' }),
      ],
      'task',
    )
    // "Task" matches tightly; "restart agent task" spreads the same letters out.
    expect(ranked[0]!.items.map((m) => m.action.id)).toEqual(['tight', 'spread'])
    expect(ranked[0]!.items[0]!.score).toBeGreaterThan(ranked[0]!.items[1]!.score)
  })

  test('disabled entries never surface', () => {
    const groups = searchActions(
      [action({ id: 'live', title: 'Live' }), action({ id: 'off', title: 'Task', enabled: false })],
      'task',
    )
    expect(groups).toEqual([])
    expect(searchActions([action({ id: 'off', title: 'Off', enabled: false })], '')).toEqual([])
  })
})

describe('selection math', () => {
  test('flattens groups into one navigable list', () => {
    const catalog = [
      action({ id: 'a', title: 'A' }),
      action({ id: 'b', title: 'B', section: 'agents' }),
      action({ id: 'c', title: 'C', section: 'model' }),
    ]
    expect(flattenGroups(searchActions(catalog, '')).map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })

  test('moving wraps around both ends of the list', () => {
    expect(moveSelection(3, 0, -1)).toBe(2)
    expect(moveSelection(3, 2, 1)).toBe(0)
    expect(moveSelection(3, 1, 1)).toBe(2)
  })

  test('there is nothing to select in an empty list', () => {
    expect(moveSelection(0, 0, 1)).toBe(-1)
    expect(clampSelection(5, 0)).toBe(-1)
  })

  test('clamping keeps a stale index valid as the list shrinks', () => {
    expect(clampSelection(1, 4)).toBe(1)
    expect(clampSelection(9, 4)).toBe(3)
    expect(clampSelection(-2, 4)).toBe(0)
  })
})

describe('palette toggle key', () => {
  const event = (overrides: { key?: string; modifiers?: Partial<{ shift: boolean; ctrl: boolean; alt: boolean; cmd: boolean }> }) => ({
    eventType: 'keyDown',
    ...overrides,
  })

  test('matches ⌘K and Ctrl+K', () => {
    expect(isPaletteToggle(event({ key: 'k', modifiers: { cmd: true } }))).toBe(true)
    expect(isPaletteToggle(event({ key: 'k', modifiers: { ctrl: true } }))).toBe(true)
  })

  test('ignores bare, shifted, alted, and unrelated keys', () => {
    expect(isPaletteToggle(event({ key: 'k' }))).toBe(false)
    expect(isPaletteToggle(event({ key: 'k', modifiers: { shift: true } }))).toBe(false)
    expect(isPaletteToggle(event({ key: 'k', modifiers: { alt: true, cmd: true } }))).toBe(false)
    expect(isPaletteToggle(event({ key: 's', modifiers: { cmd: true } }))).toBe(false)
    expect(isPaletteToggle(event({}))).toBe(false)
  })
})

/**
 * Scoring rules these expectations are worked out from:
 * +16 per matched char, +8 when adjacent to the previous match, +7 at a word
 * start (string start or right after a separator), −2 per skipped char.
 */
describe('fuzzy score', () => {
  test('rewards subsequence matches with word-start and gap penalties', () => {
    // n@0: 16+7 · t@4: 16+7−2·3
    expect(fuzzyScore('nt', 'New Task')).toBe(40)
    // t@4: 16+7 · a@5: 16+8
    expect(fuzzyScore('ta', 'new task')).toBe(47)
    expect(fuzzyScore('task', 'new task')).toBe(95)
  })

  test('is case-insensitive', () => {
    expect(fuzzyScore('NT', 'new task')).toBe(fuzzyScore('nt', 'new task'))
  })

  test('rejects non-matches and queries longer than the text', () => {
    expect(fuzzyScore('zx', 'new task')).toBeNull()
    expect(fuzzyScore('new tasks!', 'new task')).toBeNull()
  })

  test('empty query vacuously matches with a zero score', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  test('tighter matches outrank spread-out ones', () => {
    const tight = fuzzyScore('ask', 'ask to run')
    const spread = fuzzyScore('ask', 'a somewhat awkward setup')
    expect(tight).not.toBeNull()
    expect(spread).not.toBeNull()
    expect(tight! > spread!).toBe(true)
  })
})
