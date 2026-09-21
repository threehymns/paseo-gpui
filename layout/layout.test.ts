import { describe, expect, test } from 'bun:test'
import {
  allPaneIds,
  activeLeaf,
  findPane,
  initialLayout,
  leaf,
  paneLeaves,
  reduceLayout,
  resetIdCounter,
  type PaneEvent,
} from './layout'

/** Reduce events from the initial state with a fresh id counter. */
function run(events: PaneEvent[]) {
  resetIdCounter()
  return events.reduce(reduceLayout, initialLayout())
}

describe('pane layout reducer', () => {
  test('initial state is a single empty leaf with no active pane', () => {
    resetIdCounter()
    const state = initialLayout()
    expect(state!.root.kind).toBe('leaf')
    expect(paneLeaves(state!.root)).toHaveLength(1)
    expect(state!.activePaneId).toBe('')
    expect(paneLeaves(state!.root)[0]!.tabIds).toEqual([])
  })

  test('reset returns the empty single leaf', () => {
    resetIdCounter()
    const split = run([{ type: 'splitRight', paneId: 'p0' }])
    expect(split!.root.kind).not.toBe('leaf')
    const reset = reduceLayout(split, { type: 'reset' })
    expect(reset!.root.kind).toBe('leaf')
    expect(paneLeaves(reset!.root)).toHaveLength(1)
  })

  test('splitRight divides a single leaf into two panes side by side', () => {
    resetIdCounter()
    const state = run([{ type: 'splitRight', paneId: 'p0' }])
    const root = state!.root
    expect(root.kind).toBe('group')
    if (root.kind === 'group') {
      expect(root.direction).toBe('horizontal')
      expect(root.children).toHaveLength(2)
      expect(root.sizes).toEqual([0.5, 0.5])
    }
    expect(paneLeaves(state!.root).map((l) => l.id)).toEqual(['p0', 'p1'])
    // The new pane gets focus.
    expect(state!.activePaneId).toBe('p1')
  })

  test('splitDown divides a single leaf into two panes stacked', () => {
    resetIdCounter()
    const state = run([{ type: 'splitDown', paneId: 'p0' }])
    const root = state!.root
    expect(root.kind).toBe('group')
    if (root.kind === 'group') {
      expect(root.direction).toBe('vertical')
      expect(root.children).toHaveLength(2)
    }
  })

  test('splitting a leaf within a group keeps the group structure intact', () => {
    resetIdCounter()
    const split = run([{ type: 'splitRight', paneId: 'p0' }])
    // Split p0 again (it is still the left child).
    const state = reduceLayout(split, { type: 'splitRight', paneId: 'p0' })
    const leaves = paneLeaves(state!.root)
    expect(leaves.map((l) => l.id)).toEqual(['p0', 'p2', 'p1'])
    expect(state!.activePaneId).toBe('p2')
  })

  test('split is a no-op for an unknown pane id', () => {
    resetIdCounter()
    const before = initialLayout()
    const state = reduceLayout(before, { type: 'splitRight', paneId: 'nope' })
    // The unknown split leaves the state untouched (same object) and single-leaf.
    expect(state).toBe(before)
    expect(paneLeaves(state!.root)).toHaveLength(1)
  })

  test('assignTab places a tab into the active pane and focuses it', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' }, // active = p1
      { type: 'assignTab', tabId: 't0' }, // goes into p1 (active)
    ])
    expect(findPane(state!.root, 'p1')!.tabIds).toEqual(['t0'])
    expect(findPane(state!.root, 'p1')!.focusedTabId).toBe('t0')
    expect(state!.activePaneId).toBe('p1')
  })

  test('assignTab to a named pane (not the active one)', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' }, // p0, p1; active=p1
      { type: 'assignTab', tabId: 't0', paneId: 'p0' },
    ])
    expect(findPane(state!.root, 'p0')!.tabIds).toEqual(['t0'])
    expect(findPane(state!.root, 'p1')!.tabIds).toEqual([])
    expect(state!.activePaneId).toBe('p0')
  })

  test('moving a tab across panes reorders correctly', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' }, // p0, p1; active p1
      { type: 'assignTab', tabId: 't0', paneId: 'p0' },
      { type: 'assignTab', tabId: 't1', paneId: 'p0' },
      { type: 'focusPane', paneId: 'p0' },
    ])
    expect(findPane(state!.root, 'p0')!.tabIds).toEqual(['t0', 't1'])
    // Move t0 from p0 to p1.
    const moved = reduceLayout(state, { type: 'moveTab', tabId: 't0', fromPaneId: 'p0', toPaneId: 'p1', index: 0 })
    expect(findPane(moved!.root, 'p0')!.tabIds).toEqual(['t1'])
    expect(findPane(moved!.root, 'p1')!.tabIds).toEqual(['t0'])
    expect(findPane(moved!.root, 'p1')!.focusedTabId).toBe('t0')
    expect(moved!.activePaneId).toBe('p1')
  })

  test('moveTab preserves a source-focused hand-off when the moved tab was focused', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' },
      { type: 'assignTab', tabId: 't0', paneId: 'p0' },
      { type: 'assignTab', tabId: 't1', paneId: 'p0' },
      { type: 'assignTab', tabId: 't2', paneId: 'p0' },
      { type: 'focusPane', paneId: 'p0' },
    ])
    // p0 focus on t2 (last assigned).
    expect(findPane(state!.root, 'p0')!.focusedTabId).toBe('t2')
    const moved = reduceLayout(state, { type: 'moveTab', tabId: 't2', fromPaneId: 'p0', toPaneId: 'p1', index: 0 })
    // Source focus falls to the first remaining.
    expect(findPane(moved!.root, 'p0')!.focusedTabId).toBe('t0')
    expect(findPane(moved!.root, 'p1')!.focusedTabId).toBe('t2')
  })

  test('moveTab is ignored for an absent tab or unknown pane', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' },
      { type: 'moveTab', tabId: 'nope', fromPaneId: 'p0', toPaneId: 'p1' },
    ])
    expect(findPane(state!.root, 'p0')!.tabIds).toEqual([])
    expect(findPane(state!.root, 'p1')!.tabIds).toEqual([])
  })

  test('focusPane sets the active pane', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' }, // active p1
      { type: 'focusPane', paneId: 'p0' },
    ])
    expect(state!.activePaneId).toBe('p0')
  })

  test('focusTab focuses a tab within its pane and activates the pane', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' },
      { type: 'assignTab', tabId: 't0', paneId: 'p0' },
      { type: 'assignTab', tabId: 't1', paneId: 'p0' },
      { type: 'focusPane', paneId: 'p1' }, // active elsewhere
      { type: 'focusTab', paneId: 'p0', tabId: 't0' },
    ])
    expect(findPane(state!.root, 'p0')!.focusedTabId).toBe('t0')
    expect(state!.activePaneId).toBe('p0')
  })

  test('focusNextPane / focusPrevPane cycle in both directions', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' }, // p0,p1; active=p1
      { type: 'focusPane', paneId: 'p0' }, // active=p0
      { type: 'splitDown', paneId: 'p1' }, // p0,p1,p2; active=p2
    ])
    const leaves = paneLeaves(state!.root)
    expect(leaves.map((l) => l.id)).toEqual(['p0', 'p1', 'p2'])
    expect(state!.activePaneId).toBe('p2')
    expect(reduceLayout(state, { type: 'focusNextPane' })!.activePaneId).toBe('p0')
    const next2 = reduceLayout(reduceLayout(state, { type: 'focusNextPane' }), { type: 'focusNextPane' })
    expect(next2!.activePaneId).toBe('p1')
    // Prev wraps p2 -> p1.
    expect(reduceLayout(state, { type: 'focusPrevPane' })!.activePaneId).toBe('p1')
    const prev2 = reduceLayout(reduceLayout(state, { type: 'focusPrevPane' }), { type: 'focusPrevPane' })
    expect(prev2!.activePaneId).toBe('p0')
  })

  test('focus cycle is inert with a single pane', () => {
    resetIdCounter()
    const state = initialLayout()
    expect(reduceLayout(state, { type: 'focusNextPane' })).toBe(state)
    expect(reduceLayout(state, { type: 'focusPrevPane' })).toBe(state)
  })

  test('focusNextTab / focusPrevTab cycle within the active pane', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' },
      { type: 'assignTab', tabId: 't0', paneId: 'p1' },
      { type: 'assignTab', tabId: 't1', paneId: 'p1' },
      { type: 'assignTab', tabId: 't2', paneId: 'p1' },
    ])
    expect(findPane(state!.root, 'p1')!.tabIds).toEqual(['t0', 't1', 't2'])
    expect(findPane(state!.root, 'p1')!.focusedTabId).toBe('t2')
    const next = reduceLayout(state, { type: 'focusNextTab' })
    expect(findPane(next!.root, 'p1')!.focusedTabId).toBe('t0')
    const next2 = reduceLayout(next, { type: 'focusNextTab' })
    expect(findPane(next2!.root, 'p1')!.focusedTabId).toBe('t1')
    const next3 = reduceLayout(next2, { type: 'focusNextTab' })
    expect(findPane(next3!.root, 'p1')!.focusedTabId).toBe('t2')
    const prev = reduceLayout(state, { type: 'focusPrevTab' })
    expect(findPane(prev!.root, 'p1')!.focusedTabId).toBe('t1')
  })

  test('removeTab removes a tab from the tree and collapses an emptied pane', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' }, // p0, p1
      { type: 'assignTab', tabId: 't0', paneId: 'p0' },
      { type: 'assignTab', tabId: 't1', paneId: 'p1' },
    ])
    // Remove t1 (last tab of p1 -> p1 empties and the workspace collapses to a
    // single pane, which returns null for the default non-persisted layout).
    const removed = reduceLayout(state, { type: 'removeTab', tabId: 't1' })
    expect(removed).toBeNull()
  })

  test('closing tabs down to nothing never strands an empty root pane', () => {
    resetIdCounter()
    // Three panes, each with one tab. Remove all tabs: each emptied pane gets
    // folded until a single leaf remains, then null.
    let state = run([
      { type: 'splitRight', paneId: 'p0' }, // p0,p1
      { type: 'assignTab', tabId: 't0', paneId: 'p0' },
      { type: 'assignTab', tabId: 't1', paneId: 'p1' },
    ])
    state = reduceLayout(state!, { type: 'splitDown', paneId: 'p1' }) // p0,p1,p2
    state = reduceLayout(state!, { type: 'assignTab', tabId: 't2', paneId: 'p2' })
    expect(paneLeaves(state!.root)).toHaveLength(3)
    state = reduceLayout(state!, { type: 'removeTab', tabId: 't0' })
    state = reduceLayout(state!, { type: 'removeTab', tabId: 't1' })
    state = reduceLayout(state!, { type: 'removeTab', tabId: 't2' })
    expect(state).toBeNull()
  })

  test('removeTab keeps a non-empty pane and collapses only the emptied sibling', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' }, // p0,p1
      { type: 'assignTab', tabId: 't0', paneId: 'p0' },
      { type: 'assignTab', tabId: 't1', paneId: 'p0' },
      { type: 'assignTab', tabId: 't2', paneId: 'p1' },
      { type: 'splitDown', paneId: 'p0' }, // p0,p2,p1
      { type: 'assignTab', tabId: 't3', paneId: 'p2' },
    ])
    // Structure: horizontal[p0,p1] where p1 was replaced... actually p0 split.
    // Just verify removing t2 (only tab in p1) collapses p1 but leaves the rest.
    const removed = reduceLayout(state!, { type: 'removeTab', tabId: 't2' })
    expect(removed).not.toBeNull()
    const ids = paneLeaves(removed!.root).map((l) => l.id)
    expect(ids).toContain('p0')
    expect(ids).toContain('p2')
  })

  test('closePane removes a pane and collapses its siblings', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' }, // p0,p1
      { type: 'assignTab', tabId: 't0', paneId: 'p0' },
      { type: 'assignTab', tabId: 't1', paneId: 'p1' },
      { type: 'splitDown', paneId: 'p1' }, // p0,p1,p2
      { type: 'assignTab', tabId: 't2', paneId: 'p2' },
    ])
    expect(paneLeaves(state!.root).map((l) => l.id)).toEqual(['p0', 'p1', 'p2'])
    // Close the middle pane p1, which holds t1.
    const closed = reduceLayout(state!, { type: 'closePane', paneId: 'p1' })
    expect(closed).not.toBeNull()
    // Now p0,p2 remain in a group.
    expect(paneLeaves(closed!.root).map((l) => l.id)).toEqual(['p0', 'p2'])
    expect(findPane(closed!.root, 'p0')!.tabIds).toEqual(['t0'])
    expect(findPane(closed!.root, 'p2')!.tabIds).toEqual(['t2'])
  })

  test('closePane on the only pane returns the default null layout', () => {
    resetIdCounter()
    expect(reduceLayout(initialLayout(), { type: 'closePane', paneId: 'p0' })).toBeNull()
  })

  test('reorderTab moves a tab within its pane', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' },
      { type: 'assignTab', tabId: 't0', paneId: 'p1' },
      { type: 'assignTab', tabId: 't1', paneId: 'p1' },
      { type: 'assignTab', tabId: 't2', paneId: 'p1' },
    ])
    expect(findPane(state!.root, 'p1')!.tabIds).toEqual(['t0', 't1', 't2'])
    const reordered = reduceLayout(state!, { type: 'reorderTab', paneId: 'p1', tabId: 't2', toIndex: 0 })
    expect(findPane(reordered!.root, 'p1')!.tabIds).toEqual(['t2', 't0', 't1'])
  })

  test('degenerate: deep nesting does not lose panes', () => {
    resetIdCounter()
    let state = run([
      { type: 'splitRight', paneId: 'p0' },
      { type: 'splitDown', paneId: 'p1' },
      { type: 'splitRight', paneId: 'p2' },
      { type: 'splitDown', paneId: 'p3' },
    ])
    expect(paneLeaves(state!.root)).toHaveLength(5)
    // Each split targets the previously-created leaf; all five survive.
    expect(paneLeaves(state!.root).map((l) => l.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    // Focus cycles stably across all panes.
    let current = state
    for (let i = 0; i < 6; i++) {
      current = reduceLayout(current!, { type: 'focusNextPane' })
    }
    expect(current!.activePaneId).toBe('p0')
  })

  test('paneLeaves and allPaneIds agree on depth-first order', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' },
      { type: 'splitDown', paneId: 'p1' },
    ])
    expect(paneLeaves(state!.root).map((l) => l.id)).toEqual(allPaneIds(state!.root))
  })

  test('activeLeaf reflects the active pane', () => {
    resetIdCounter()
    const state = run([
      { type: 'splitRight', paneId: 'p0' },
      { type: 'assignTab', tabId: 't0', paneId: 'p0' },
      { type: 'focusTab', paneId: 'p0', tabId: 't0' },
    ])
    expect(activeLeaf(state!)!.id).toBe('p0')
    expect(state!.activePaneId).toBe('p0')
  })

  test('leaf() factory produces a pane leaf with the right shape', () => {
    resetIdCounter()
    const l = leaf(['t0'], 't0')
    expect(l).toEqual({ kind: 'leaf', id: 'p0', tabIds: ['t0'], focusedTabId: 't0' })
  })
})
