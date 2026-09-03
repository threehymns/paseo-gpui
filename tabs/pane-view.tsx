/**
 * Pane split-tree rendering for the workspace screen (#48).
 *
 * Renders a pane layout (a binary tree of horizontal/vertical groups over
 * leaves holding ordered tabs) into nested flex regions, each leaf showing its
 * own tab strip and focused tab's content. The tree geometry itself lives in
 * the pure reducer (layout/layout.ts); this component only lays out nodes along
 * their axis using the normalized sizes and hands each leaf's content to a
 * render prop so the caller (chat.tsx) keeps the hide-not-unmount
 * AgentTabPanels and decides draft/empty-pane content.
 *
 * When the layout is null the workspace falls back to a single implicit pane:
 * all of the #46 workspace's tabs, focusing the #46 active draft/agent (handled
 * by the caller, which renders a plain TabStrip + panel in that case).
 */

import React from 'react'
import { C } from '../chrome/theme'
import { TabStrip } from './tab-strip'
import type { PaneGroup, PaneLayout, PaneNode } from '../layout/layout'
import type { TabDescriptor } from './tabs'

/** The splitter bar's thickness along the split axis. */
export const SPLITTER = 5

/** The per-tab strip decoration the caller supplies (labels, dots, attention). */
export interface PaneStripMeta {
  labelFor: (tab: TabDescriptor) => string
  dotColorFor?: (tab: TabDescriptor) => string | null
  attentionFor?: (tab: TabDescriptor) => boolean
}

interface PaneSplitProps {
  layout: PaneLayout
  tabs: TabDescriptor[]
  meta: PaneStripMeta
  /**
   * Renders one pane's content below its tab strip: the focused tab's panel
   * (an AgentTabPanel), a draft center message, or an empty-pane hint.
   */
  renderPane: (paneId: string, tabIds: string[], focusedTabId: string | null) => React.ReactNode
  onSelectTab: (paneId: string, tabId: string) => void
  onCloseTab: (paneId: string, tabId: string) => void
  onCloseOthers: (paneId: string, tabId: string) => void
  onNewDraft: (paneId: string) => void
}

/** Bar between panes along a split axis. */
function SplitDivider({ direction }: { direction: 'horizontal' | 'vertical' }) {
  return (
    <div
      style={{
        flexShrink: 0,
        ...(direction === 'horizontal'
          ? { width: SPLITTER, height: '100%' }
          : { width: '100%', height: SPLITTER }),
        backgroundColor: C.border,
      }}
    />
  )
}

/** A leaf pane: its tab strip (ordered subset) plus focused tab's content. */
function PaneLeafBody({
  pane,
  tabs,
  meta,
  renderPane,
  onSelectTab,
  onCloseTab,
  onCloseOthers,
  onNewDraft,
}: {
  pane: { id: string; tabIds: string[]; focusedTabId: string | null }
  tabs: TabDescriptor[]
  meta: PaneStripMeta
  renderPane: PaneSplitProps['renderPane']
  onSelectTab: PaneSplitProps['onSelectTab']
  onCloseTab: PaneSplitProps['onCloseTab']
  onCloseOthers: PaneSplitProps['onCloseOthers']
  onNewDraft: PaneSplitProps['onNewDraft']
}) {
  const paneTabs = pane.tabIds
    .map((id) => tabs.find((tab) => tab.id === id))
    .filter((tab): tab is TabDescriptor => Boolean(tab))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      <TabStrip
        tabs={paneTabs}
        activeTabId={pane.focusedTabId}
        labelFor={meta.labelFor}
        dotColorFor={meta.dotColorFor}
        attentionFor={meta.attentionFor}
        onSelect={(tabId) => onSelectTab(pane.id, tabId)}
        onClose={(tabId) => onCloseTab(pane.id, tabId)}
        onCloseOthers={(tabId) => onCloseOthers(pane.id, tabId)}
        onNewDraft={() => onNewDraft(pane.id)}
      />
      {renderPane(pane.id, pane.tabIds, pane.focusedTabId)}
    </div>
  )
}

/** Recursively lays out a group's children along its axis with the split bars. */
function PaneGroupBody({
  node,
  tabs,
  meta,
  renderPane,
  onSelectTab,
  onCloseTab,
  onCloseOthers,
  onNewDraft,
}: {
  node: PaneGroup
  tabs: TabDescriptor[]
  meta: PaneStripMeta
  renderPane: PaneSplitProps['renderPane']
  onSelectTab: PaneSplitProps['onSelectTab']
  onCloseTab: PaneSplitProps['onCloseTab']
  onCloseOthers: PaneSplitProps['onCloseOthers']
  onNewDraft: PaneSplitProps['onNewDraft']
}) {
  const row = node.direction === 'horizontal'
  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        ...(row ? { flexDirection: 'row' } : { flexDirection: 'column' }),
      }}
    >
      <PaneSubtree
        node={node.children[0]!}
        size={node.sizes[0] ?? 0.5}
        tabs={tabs}
        meta={meta}
        renderPane={renderPane}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onCloseOthers={onCloseOthers}
        onNewDraft={onNewDraft}
      />
      <SplitDivider direction={node.direction} />
      <PaneSubtree
        node={node.children[1]!}
        size={node.sizes[1] ?? 0.5}
        tabs={tabs}
        meta={meta}
        renderPane={renderPane}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onCloseOthers={onCloseOthers}
        onNewDraft={onNewDraft}
      />
    </div>
  )
}

/** One subtree rendered at a flex fraction of its parent. */
function PaneSubtree({
  node,
  size,
  tabs,
  meta,
  renderPane,
  onSelectTab,
  onCloseTab,
  onCloseOthers,
  onNewDraft,
}: {
  node: PaneNode
  size: number
  tabs: TabDescriptor[]
  meta: PaneStripMeta
  renderPane: PaneSplitProps['renderPane']
  onSelectTab: PaneSplitProps['onSelectTab']
  onCloseTab: PaneSplitProps['onCloseTab']
  onCloseOthers: PaneSplitProps['onCloseOthers']
  onNewDraft: PaneSplitProps['onNewDraft']
}) {
  const style = {
    display: 'flex',
    flexGrow: size,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  } as React.CSSProperties
  if (node.kind === 'leaf') {
    return (
      <div style={style}>
        <PaneLeafBody
          pane={{ id: node.id, tabIds: node.tabIds, focusedTabId: node.focusedTabId }}
          tabs={tabs}
          meta={meta}
          renderPane={renderPane}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          onCloseOthers={onCloseOthers}
          onNewDraft={onNewDraft}
        />
      </div>
    )
  }
  return (
    <div style={style}>
      <PaneGroupBody
        node={node}
        tabs={tabs}
        meta={meta}
        renderPane={renderPane}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onCloseOthers={onCloseOthers}
        onNewDraft={onNewDraft}
      />
    </div>
  )
}

/** Renders a persisted multi-pane layout; see module docstring for the null contract. */
export function PaneSplit(props: PaneSplitProps) {
  const { layout, tabs, meta, renderPane, onSelectTab, onCloseTab, onCloseOthers, onNewDraft } = props
  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'row' }}>
      <PaneSubtree
        node={layout.root}
        size={1}
        tabs={tabs}
        meta={meta}
        renderPane={renderPane}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onCloseOthers={onCloseOthers}
        onNewDraft={onNewDraft}
      />
    </div>
  )
}
