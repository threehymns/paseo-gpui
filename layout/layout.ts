/**
 * Pane layout tree: split geometry for the workspace screen.
 *
 * The workspace screen can be divided into panes, each showing its own ordered
 * tabs (drawn from the workspace's #46 tab strip) with one focused tab. The
 * layout is a binary tree: group nodes split horizontally (left-right) or
 * vertically (top-bottom) with normalized sizes, leaf nodes hold tab
 * references. A single-pane workspace (the default) has no tree at all —
 * the layout is `null` until the user splits, at which point persistence
 * kicks in.
 *
 * All tree geometry lives in this pure reducer: initialState, an event union,
 * reduceLayout(state, event), and pure selectors. The hook only translates
 * user gestures (keyboard, pointer) into events and drives persistence via the
 * app-state store. No rendering tests; this module is testable in isolation.
 *
 * **Integration with #46 tabs:** the pane tree does NOT own tabs — the workspace
 * tab reducer (tabs/tabs.ts) does. Each leaf pane carries an ordered list of
 * `tabId` strings that are the same ids the #46 reducer produces. When a tab is
 * closed via #46, a `removeTab` event here cleans up references. When a pane is
 * split, the caller decides which tabIds to place in the new pane (typically
 * none — the new pane starts empty and the user moves tabs into it).
 */

// ---- types -----------------------------------------------------------------

export interface PaneLeaf {
  kind: 'leaf'
  id: string
  /** Ordered tab ids from the #46 tab model; the focused tab is tracked separately. */
  tabIds: string[]
  /** Which tab in this pane has focus; null when the pane has no tabs. */
  focusedTabId: string | null
}

export interface PaneGroup {
  kind: 'group'
  id: string
  /** The split axis: horizontal = left-right, vertical = top-bottom. */
  direction: 'horizontal' | 'vertical'
  /** Child nodes, left-to-right (horizontal) or top-to-bottom (vertical). */
  children: PaneNode[]
  /** Normalized sizes; same length as `children`, sums to ~1. */
  sizes: number[]
}

export type PaneNode = PaneLeaf | PaneGroup

export interface PaneLayout {
  root: PaneNode
  /** The pane currently receiving keyboard input. */
  activePaneId: string
}

/** null = default single-pane layout (not persisted until the user splits). */
export type PaneLayoutState = PaneLayout | null

// ---- state -----------------------------------------------------------------

let _paneSeq = 0
let _groupSeq = 0

function nextPaneId(): string {
  return `p${_paneSeq++}`
}

function nextGroupId(): string {
  return `g${_groupSeq++}`
}

export function resetIdCounter(): void {
  _paneSeq = 0
  _groupSeq = 0
}

export function leaf(tabIds: string[] = [], focusedTabId: string | null = null): PaneLeaf {
  return { kind: 'leaf', id: nextPaneId(), tabIds, focusedTabId }
}

/** The default state: a single empty leaf. */
export function initialLayout(): PaneLayoutState {
  return { root: leaf(), activePaneId: '' }
}

// ---- selectors --------------------------------------------------------------

/** Collects leaf nodes in depth-first order. */
export function paneLeaves(node: PaneNode): PaneLeaf[] {
  if (node.kind === 'leaf') return [node]
  return node.children.flatMap(paneLeaves)
}

/** Returns the leaf with the given id, or null. */
export function findPane(root: PaneNode, id: string): PaneLeaf | null {
  if (root.kind === 'leaf') return root.id === id ? root : null
  for (const child of root.children) {
    const found = findPane(child, id)
    if (found) return found
  }
  return null
}

/** The active leaf pane (the one the user is interacting with). */
export function activeLeaf(layout: PaneLayout): PaneLeaf | null {
  return findPane(layout.root, layout.activePaneId)
}

/** All pane ids in depth-first order. */
export function allPaneIds(root: PaneNode): string[] {
  if (root.kind === 'leaf') return [root.id]
  return root.children.flatMap(allPaneIds)
}

/** Ordered tab ids for a specific pane. */
export function paneTabIds(root: PaneNode, paneId: string): string[] {
  return findPane(root, paneId)?.tabIds ?? []
}

/** The focused tab id of the active pane, or null. */
export function activePaneTabId(layout: PaneLayout): string | null {
  return activeLeaf(layout)?.focusedTabId ?? null
}

// ---- tree helpers -----------------------------------------------------------

/** Normalize a sizes array so it sums to exactly 1. */
function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  if (total === 0) return sizes.map(() => 1 / sizes.length)
  return sizes.map((s) => s / total)
}

/** Recursively search for a node by id. */
function findNode(node: PaneNode, id: string): PaneNode | null {
  if (node.kind === 'leaf') return node.id === id ? node : null
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

/** Find the direct parent group containing a child with exactly the given id. */
function findParent(node: PaneNode, childId: string): { group: PaneGroup; index: number } | null {
  if (node.kind === 'leaf') return null
  const direct = node.children.findIndex((child) => child.id === childId)
  if (direct >= 0) return { group: node, index: direct }
  for (const child of node.children) {
    const found = findParent(child, childId)
    if (found) return found
  }
  return null
}

/** Clone a pane node deeply enough for pure reducer use. */
function cloneNode(node: PaneNode): PaneNode {
  if (node.kind === 'leaf') {
    return { ...node, tabIds: [...node.tabIds] }
  }
  return {
    ...node,
    children: node.children.map(cloneNode),
    sizes: [...node.sizes],
  }
}

/** Split a leaf in the cloned tree into a group of two leaves. */
function splitLeafInPlace(
  root: PaneNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  newPane: PaneLeaf,
): PaneNode {
  const parent = findParent(root, targetId)
  const target = findPane(root, targetId)
  if (!target) return root

  const group: PaneGroup = {
    kind: 'group',
    id: nextGroupId(),
    direction,
    children: [{ ...target, tabIds: [...target.tabIds] }, newPane],
    sizes: [0.5, 0.5],
  }

  if (!parent) {
    // target is the root leaf
    return group
  }

  const { group: parentNode, index } = parent
  parentNode.children[index] = group
  parentNode.sizes[index] = parentNode.sizes[index]! / 2
  parentNode.sizes.splice(index + 1, 0, parentNode.sizes[index]!)
  return root
}

/** Collapse unnecessary single-child groups. */
function collapseGroups(node: PaneNode): PaneNode {
  if (node.kind === 'leaf') return node
  if (node.children.length === 1) return collapseGroups(node.children[0]!)
  node.children = node.children.map(collapseGroups)
  return node
}

// ---- validation (for persistence) -------------------------------------------

function validSizes(sizes: unknown): sizes is number[] {
  if (!Array.isArray(sizes)) return false
  return sizes.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0)
}

/** Deep-validates a pane node as read back from storage; undefined when stale. */
export function validatePaneNode(raw: unknown): PaneNode | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const node = raw as Record<string, unknown>
  if (node.kind === 'leaf') {
    if (!Array.isArray(node.tabIds) || !node.tabIds.every((t) => typeof t === 'string')) return undefined
    const focused = node.focusedTabId
    if (focused != null && typeof focused !== 'string') return undefined
    if (typeof node.id !== 'string') return undefined
    return {
      kind: 'leaf',
      id: node.id,
      tabIds: [...node.tabIds],
      focusedTabId: typeof focused === 'string' ? focused : null,
    }
  }
  if (node.kind === 'group') {
    if (node.direction !== 'horizontal' && node.direction !== 'vertical') return undefined
    if (!Array.isArray(node.children) || node.children.length < 2) return undefined
    if (!validSizes(node.sizes) || node.sizes.length !== node.children.length) return undefined
    if (typeof node.id !== 'string') return undefined
    const children: PaneNode[] = []
    for (const child of node.children) {
      const parsed = validatePaneNode(child)
      if (!parsed) return undefined
      children.push(parsed)
    }
    return { kind: 'group', id: node.id, direction: node.direction, children, sizes: [...node.sizes] }
  }
  return undefined
}

/** Deep-validates a persisted pane layout; undefined when stale. */
export function validatePaneLayout(raw: unknown): PaneLayout | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const root = validatePaneNode(value.root)
  if (!root) return undefined
  if (typeof value.activePaneId !== 'string') return undefined
  // The active pane must actually exist.
  if (!findPane(root, value.activePaneId)) return undefined
  return { root, activePaneId: value.activePaneId }
}

// ---- events ----------------------------------------------------------------

export type PaneEvent =
  | { type: 'reset' }
  /** Split a pane's right half. */
  | { type: 'splitRight'; paneId: string; newPaneId?: string }
  /** Split a pane's bottom half. */
  | { type: 'splitDown'; paneId: string; newPaneId?: string }
  /** Close an entire pane (redistributes size to siblings). */
  | { type: 'closePane'; paneId: string }
  /** Move a tab from one pane to another (inserts at a position). */
  | { type: 'moveTab'; tabId: string; fromPaneId: string; toPaneId: string; index?: number }
  /** Ensure a tab exists in a pane (default the active pane), focusing it; used when a tab opens. */
  | { type: 'assignTab'; tabId: string; paneId?: string }
  /** Focus a pane. */
  | { type: 'focusPane'; paneId: string }
  /** Focus a tab within its pane. */
  | { type: 'focusTab'; paneId: string; tabId: string }
  /** Cycle focus to the next pane (wrapping). */
  | { type: 'focusNextPane' }
  /** Cycle focus to the previous pane (wrapping). */
  | { type: 'focusPrevPane' }
  /** Cycle focus to the next tab in the active pane (wrapping). */
  | { type: 'focusNextTab' }
  /** Cycle focus to the previous tab in the active pane (wrapping). */
  | { type: 'focusPrevTab' }
  /** A tab was closed via #46; clean up references. */
  | { type: 'removeTab'; tabId: string }
  /** Reorder a tab within its pane. */
  | { type: 'reorderTab'; paneId: string; tabId: string; toIndex: number }

// ---- reducer ---------------------------------------------------------------

export function reduceLayout(state: PaneLayoutState, event: PaneEvent): PaneLayoutState {
  switch (event.type) {
    case 'reset':
      return initialLayout()

    case 'splitRight': {
      const current = state ?? initialLayout()
      const target = findPane(current.root, event.paneId)
      if (!target) return state
      const newId = event.newPaneId ?? nextPaneId()
      const newPane: PaneLeaf = { kind: 'leaf', id: newId, tabIds: [], focusedTabId: null }
      const root = splitLeafInPlace(cloneNode(current.root), event.paneId, 'horizontal', newPane)
      return { root, activePaneId: newId }
    }

    case 'splitDown': {
      const current = state ?? initialLayout()
      const target = findPane(current.root, event.paneId)
      if (!target) return state
      const newId = event.newPaneId ?? nextPaneId()
      const newPane: PaneLeaf = { kind: 'leaf', id: newId, tabIds: [], focusedTabId: null }
      const root = splitLeafInPlace(cloneNode(current.root), event.paneId, 'vertical', newPane)
      return { root, activePaneId: newId }
    }

    case 'moveTab': {
      const current = state ?? initialLayout()
      const fromPane = findPane(current.root, event.fromPaneId)
      const toPane = findPane(current.root, event.toPaneId)
      if (!fromPane || !toPane) return current
      if (fromPane.tabIds.indexOf(event.tabId) < 0) return current
      const root = cloneNode(current.root)
      const src = findPane(root, event.fromPaneId)!
      const dst = findPane(root, event.toPaneId)!
      src.tabIds = src.tabIds.filter((id) => id !== event.tabId)
      if (src.focusedTabId === event.tabId) {
        src.focusedTabId = src.tabIds[0] ?? null
      }
      const insertAt = event.index ?? dst.tabIds.length
      dst.tabIds.splice(insertAt, 0, event.tabId)
      dst.focusedTabId = event.tabId
      return { root, activePaneId: event.toPaneId }
    }

    case 'assignTab': {
      const current = state ?? initialLayout()
      const pane = event.paneId ? findPane(current.root, event.paneId) : activeLeaf(current)
      if (!pane) return current
      const root = cloneNode(current.root)
      const target = event.paneId ? findPane(root, event.paneId)! : findPane(root, pane.id)!
      if (!target.tabIds.includes(event.tabId)) target.tabIds.push(event.tabId)
      target.focusedTabId = event.tabId
      return { root, activePaneId: target.id }
    }

    case 'focusPane': {
      const current = state ?? initialLayout()
      if (!findPane(current.root, event.paneId)) return current
      return { root: current.root, activePaneId: event.paneId }
    }

    case 'focusTab': {
      const current = state ?? initialLayout()
      const pane = findPane(current.root, event.paneId)
      if (!pane || !pane.tabIds.includes(event.tabId)) return current
      const root = cloneNode(current.root)
      findPane(root, event.paneId)!.focusedTabId = event.tabId
      return { root, activePaneId: event.paneId }
    }

    case 'focusNextPane': {
      const current = state ?? initialLayout()
      const leaves = paneLeaves(current.root)
      if (leaves.length <= 1) return current
      const idx = leaves.findIndex((l) => l.id === current.activePaneId)
      const next = (idx + 1) % leaves.length
      return { root: current.root, activePaneId: leaves[next]!.id }
    }

    case 'focusPrevPane': {
      const current = state ?? initialLayout()
      const leaves = paneLeaves(current.root)
      if (leaves.length <= 1) return current
      const idx = leaves.findIndex((l) => l.id === current.activePaneId)
      const prev = (idx - 1 + leaves.length) % leaves.length
      return { root: current.root, activePaneId: leaves[prev]!.id }
    }

    case 'focusNextTab': {
      const current = state ?? initialLayout()
      const pane = findPane(current.root, current.activePaneId)
      if (!pane || pane.tabIds.length <= 1) return current
      const idx = pane.tabIds.indexOf(pane.focusedTabId ?? '')
      const next = idx < 0 ? 0 : (idx + 1) % pane.tabIds.length
      const root = cloneNode(current.root)
      findPane(root, pane.id)!.focusedTabId = pane.tabIds[next]!
      return { root, activePaneId: pane.id }
    }

    case 'focusPrevTab': {
      const current = state ?? initialLayout()
      const pane = findPane(current.root, current.activePaneId)
      if (!pane || pane.tabIds.length <= 1) return current
      const idx = pane.tabIds.indexOf(pane.focusedTabId ?? '')
      const prev = idx <= 0 ? pane.tabIds.length - 1 : idx - 1
      const root = cloneNode(current.root)
      findPane(root, pane.id)!.focusedTabId = pane.tabIds[prev]!
      return { root, activePaneId: pane.id }
    }

    case 'removeTab': {
      const current = state ?? initialLayout()
      const leaves = paneLeaves(current.root)
      let changed = false
      const root = cloneNode(current.root)
      for (const leaf of leaves) {
        const rleaf = findPane(root, leaf.id)!
        const idx = rleaf.tabIds.indexOf(event.tabId)
        if (idx < 0) continue
        changed = true
        rleaf.tabIds.splice(idx, 1)
        if (rleaf.focusedTabId === event.tabId) {
          rleaf.focusedTabId = rleaf.tabIds[Math.min(idx, rleaf.tabIds.length - 1)] ?? null
        }
      }
      if (!changed) return state
      // Collapse any empty leaf panes (except if only one remains).
      let next = root
      let remaining = paneLeaves(next)
      while (remaining.length > 1) {
        const empty = remaining.find((l) => l.tabIds.length === 0)
        if (!empty) break
        const parent = findParent(next, empty.id)
        if (!parent) break
        parent.group.children.splice(parent.index, 1)
        parent.group.sizes.splice(parent.index, 1)
        parent.group.sizes = normalize(parent.group.sizes)
        next = collapseGroups(next)
        remaining = paneLeaves(next)
      }
      // If root collapsed to a single leaf, the workspace returns to the
      // default single tab strip (non-persisted).
      if (next.kind === 'leaf') return null
      // If the active pane was removed, fall back to the first leaf with tabs.
      const active = findPane(next, current.activePaneId)
      const activeId =
        active && active.tabIds.length > 0 ? active.id : paneLeaves(next).find((l) => l.tabIds.length > 0)?.id ?? paneLeaves(next)[0]!.id
      return { root: next, activePaneId: activeId }
    }

    case 'closePane': {
      const current = state ?? initialLayout()
      const leaves = paneLeaves(current.root)
      if (leaves.length <= 1) return null
      const target = findPane(current.root, event.paneId)
      if (!target) return state
      const root = cloneNode(current.root)
      const parent = findParent(root, event.paneId)
      if (!parent) return null
      const { group, index } = parent
      group.children.splice(index, 1)
      group.sizes.splice(index, 1)
      group.sizes = normalize(group.sizes)
      const cleaned = collapseGroups(root)
      if (cleaned.kind === 'leaf') return null
      const remaining = paneLeaves(cleaned)
      const activeStillExists = remaining.some((l) => l.id === current.activePaneId && l.tabIds.length > 0)
      const activeId = activeStillExists
        ? current.activePaneId
        : remaining.find((l) => l.tabIds.length > 0)?.id ?? remaining[0]!.id
      return { root: cleaned, activePaneId: activeId }
    }

    case 'reorderTab': {
      const current = state ?? initialLayout()
      const pane = findPane(current.root, event.paneId)
      if (!pane || !pane.tabIds.includes(event.tabId)) return current
      const root = cloneNode(current.root)
      const rleaf = findPane(root, event.paneId)!
      const fromIdx = rleaf.tabIds.indexOf(event.tabId)
      rleaf.tabIds.splice(fromIdx, 1)
      const toIdx = Math.min(event.toIndex, rleaf.tabIds.length)
      rleaf.tabIds.splice(toIdx, 0, event.tabId)
      return { root, activePaneId: current.activePaneId }
    }
  }
}
