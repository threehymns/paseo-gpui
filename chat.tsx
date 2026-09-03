/**
 * A Paseo client, rendered natively on the GPU.
 *
 * Layout, palette, and chrome follow https://github.com/egoist/waku.
 * All data is live from a Paseo daemon (https://github.com/getpaseo/paseo)
 * over WebSocket. This file holds the daemon hooks and the app shell; the
 * view modules live in chrome.tsx, transcript.tsx, pickers.tsx, composer.tsx,
 * and mdx.tsx, and the daemon glue lives in paseo.ts.
 *
 * Run with:        bun --hot chat.tsx
 * Remote daemon:   PASEO_URL=wss://host/ws PASEO_PASSWORD=... bun --hot chat.tsx
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, render, useGpuix } from '@gpuix/react'
import type { PaseoAgentConfig, PaseoClient } from '@getpaseo/client'
import type { DaemonClient } from '@getpaseo/client/internal/daemon-client'
import {
  DAEMON_URL,
  activeAgentGone,
  activityAt,
  applyAgentPage,
  applyAgentUpdate,
  basename,
  createDaemonClient,
  displayName,
  errorMessage,
  findModel,
  isAgentRunning,
  isArchived,
  sortAgents,
  statusBucket,
  STATUS_BUCKET_LABELS,
  visibleAgents,
  modelChoices,
  type AgentEntry,
  type ConnStatus,
  type ProviderEntry,
  type WorkspaceDescriptor,
} from './daemon/paseo'
import {
  agentsOfWorkspace,
  applyWorkspaceUpdate,
  initialWorkspaceStore,
  mostRecentAgent,
  sortWorkspaces,
  workspaceDirectoryChoices,
  workspaceDirectory,
  type WorkspaceStore,
} from './agent-directory/workspaces'
import {
  isJumpShortcut,
  isNextWorkspace,
  isPrevWorkspace,
  prevNextWorkspaceTarget,
} from './agent-directory/workspace-shortcuts'
import {
  canGoBack,
  canGoForward,
  emptyVisitHistory,
  goBack,
  goForward,
  truncateForward,
  visitAgent,
  type VisitHistory,
} from './agent-directory/nav-history'
import {
  planAttachments,
  planPaste,
  removeAttachment,
  toSendImages,
  type AttachmentPlan,
  type ImageAttachment,
  type IncomingImage,
  type PastePayload,
} from './composer/attachments'
import { C, CONTENT_MAX_WIDTH, SIDEBAR_WIDTH } from './chrome/theme'
import { workspaceMutations } from './agent-directory/workspace-mutations'
import {
  Sidebar,
  Header,
  CenterMessage,
  agentStatusColor,
  daemonHost,
  type RowActionRef,
  type RowActionVerb,
} from './chrome/chrome'
import { Transcript } from './conversation/transcript'
import { FeatureToggles, ModelPicker, OptionPicker, modeOptions, thinkingOptions } from './composer/pickers'
import { Composer, ConfigNotice, FooterBar, TracksRow } from './composer/composer'
import { toMentionEntries, type MentionSource } from './composer/mentions'
import { useTranscriptFollow } from './conversation/follow'
import { nativeOpenFileBridge, requestOpenFile } from './chrome/open-file'
import { useAttention, type NotificationBridge } from './conversation/attention'
import { useDraftConfig } from './composer/draft-config'
import { toggleFeatures, useProviderFeatures } from './composer/features'
import {
  checkoutEnabled,
  repoKeyOf,
  useCheckoutStatus,
  useDaemonFeatures,
} from './checkout/checkout'
import { useCheckoutActions } from './checkout/checkout-actions'
import { CheckoutPanel } from './checkout/checkout-panel'
import { contextMeter } from './composer/usage'
import { liveTruth, useLiveAgentConfig, type DaemonTruth, type ProviderNotice } from './composer/live-config'
import { resolveSendIntent, type SendGesture } from './composer/send-intent'
import { ActionRegistry } from './palette/actions'
import { isPaletteToggle } from './palette/palette'
import { CommandPaletteView, useContributeActions } from './palette/palette-view'
import { dispatchWindowEvent, useWindowEvent } from './chrome/global-events'
import type { ComposerCommands } from './composer/composer'
import {
  providerSubagentsEnabled,
  selectTrackRows,
  subagentHasOlder,
  subagentLabel,
  subagentRowColor,
  subagentTurns,
  useSubagents,
} from './tracks/subagents'
import {
  SubagentLoadOlder,
  SubagentPill,
  SubagentViewerBar,
  type OpenSubagent,
} from './tracks/tracks-panel'
import { createAppStore, defaultStatePath, fileStateStorage, showArchivedAgents, workspacePanes, useAppState } from './app-state'
import {
  initialTabs,
  reduceTabs,
  selectActiveAgentId,
  selectActiveDraft,
  selectActiveSetup,
  selectActiveTab,
  selectTabs,
  type TabsEvent,
} from './tabs/tabs'
import { TabStrip } from './tabs/tab-strip'
import { AgentTabPanel, type TabConversation } from './tabs/agent-tab-panel'
import { SetupTabPanel } from './tabs/setup-tab-panel'
import { setupSucceeded, useWorkspaceSetup } from './tabs/setup'
import { PaneSplit, type PaneStripMeta } from './tabs/pane-view'
import {
  activePaneTabId,
  paneLeaves,
  paneTabIds,
  reduceLayout,
  type PaneEvent,
  type PaneLayoutState,
} from './layout/layout'

// ---- daemon hooks ----------------------------------------------------------

interface DaemonView {
  client: PaseoClient
  daemon: DaemonClient
  status: ConnStatus
  error: string | null
  agents: AgentEntry[]
  providers: ProviderEntry[]
  /** The workspace directory; written only by the daemon's subscription. */
  workspaces: WorkspaceStore
}

function useDaemon(): DaemonView {
  const [{ client, daemon }] = useState(createDaemonClient)
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceStore>(initialWorkspaceStore)

  useEffect(() => {
    let disposed = false
    let setupDone = false
    const unsubs: (() => void)[] = []

    const runSetup = async () => {
      if (setupDone || disposed) return
      setupDone = true
      setStatus('connected')
      setError(null)

      unsubs.push(
        client.agents.subscribe((update) => setAgents((prev) => applyAgentUpdate(prev, update))),
      )
      // Archived entries ride along so the sidebar toggle can reveal them;
      // visibility is decided at render time.
      const agentSort = [{ key: 'updated_at' as const, direction: 'desc' as const }]
      const filter = { includeArchived: true }
      await client.agents.list({ scope: 'active', filter, sort: agentSort, subscribe: {} })
      const page = await client.agents.list({ scope: 'active', filter, sort: agentSort })
      // Merge, never replace: subscription updates may have advanced entries
      // while the page was in flight, and a wholesale swap would replay their
      // older snapshots over fresher truth.
      if (!disposed) setAgents((prev) => applyAgentPage(prev, page.entries.map((entry) => entry.agent)))

      // One subscribed feed owns the whole workspace store: upserts, removes,
      // emptied and removed projects all flow through it. The UI never writes.
      unsubs.push(
        client.workspaces.subscribe((update) =>
          setWorkspaces((prev) => applyWorkspaceUpdate(prev, update)),
        ),
      )
      const workspaceSort = [{ key: 'activity_at' as const, direction: 'desc' as const }]
      await client.workspaces.list({ sort: workspaceSort, subscribe: {} })
      const descriptors: WorkspaceDescriptor[] = []
      let cursor: string | undefined
      do {
        const workspacePage = await client.workspaces.list({
          sort: workspaceSort,
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        })
        descriptors.push(...workspacePage.entries)
        cursor = workspacePage.pageInfo.nextCursor ?? undefined
      } while (cursor && !disposed)
      // Fold the paged snapshot in as upserts rather than replacing the store:
      // removes and emptied-project events that streamed during pagination
      // would otherwise be silently discarded.
      if (!disposed) {
        setWorkspaces((prev) => {
          let next = prev
          for (const descriptor of sortWorkspaces(descriptors)) {
            next = applyWorkspaceUpdate(next, { kind: 'upsert', workspace: descriptor })
          }
          return next
        })
      }

      const snapshot =
        (await client.providers.waitForReady({ timeoutMs: 30_000 }).catch(() => null)) ??
        (await client.providers.snapshot())
      if (!disposed) setProviders(snapshot.entries)
      unsubs.push(client.providers.subscribe((update) => setProviders(update.entries)))
    }

    void (async () => {
      try {
        await Promise.race([
          client.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out connecting to ${DAEMON_URL}`)), 8_000),
          ),
        ])
        await runSetup()
      } catch (err) {
        if (!disposed && !setupDone) {
          setError(errorMessage(err))
          setStatus('error')
        }
        // The SDK keeps reconnecting in the background; the poller below adopts
        // the session if the daemon comes back.
      }
    })()

    const poller = setInterval(() => {
      if (client.getConnectionState().status === 'connected') void runSetup()
    }, 1_500)

    return () => {
      disposed = true
      clearInterval(poller)
      for (const unsub of unsubs) unsub()
      client.close().catch(() => {})
    }
  }, [])

  return { client, daemon, status, error, agents, providers, workspaces }
}

// ---- app -------------------------------------------------------------------

const NO_TRUTH: DaemonTruth = { modelValue: null, thinkingId: null, modeId: null, features: {} }

/**
 * Opens the raster-filtered multi-select file dialog through a native bridge.
 * @gpuix ships no dialog API yet; when one lands, pass it
 * `imagePickerDialogOptions()` from attachments.ts and resolve each chosen path
 * into an IncomingImage (name, size, raw base64 data). Null means no bridge.
 */
async function openImagePicker(): Promise<IncomingImage[] | null> {
  return null
}

/** One store per app run: read the state file once, persist every write. */
const createStateStore = () => createAppStore(fileStateStorage(defaultStatePath()))

/**
 * The slice of an agent conversation the app-level chrome consumes (composer,
 * tracks row, context meter). Panels own the full conversation and register it
 * in the ref map; this keeps the app decoupled from the per-tab lifecycle.
 */
type ComposerConversation = Pick<
  TabConversation,
  'turns' | 'parked' | 'pending' | 'status' | 'usage' | 'send' | 'park' | 'release' | 'unqueue'
>

export function ChatApp() {
  const { client, daemon, status, error, agents, providers, workspaces } = useDaemon()
  const [store] = useState(createStateStore)

  const everShownAgentIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const entry of agents) everShownAgentIds.current.add(entry.id)
  }, [agents])

  // Worktree-created agents awaiting their workspace id. A setup tab is keyed by
  // workspace, which the daemon only reveals once the worktree exists; these ids
  // bridge the gap from the create handle to the agent's directory entry.
  const pendingSetupAgents = useRef<Set<string>>(new Set())

  // Workspace tabs: the strip of open agent + draft tabs with a focused one.
  // The reducer owns every add/close/select decision; this component only
  // translates gestures and daemon results into TabsEvents. `activeId` stays
  // the single "selected agent" the rest of the app reasons about — whichever
  // agent tab is focused, or null for a draft/no-tab state.
  const [tabsState, setTabsState] = useState(initialTabs)
  const dispatchTabs = (event: TabsEvent) => setTabsState((prev) => reduceTabs(prev, event))
  const tabs = selectTabs(tabsState)
  // Pane layout: null = the single-pane default (non-persisted); a split tree
  // otherwise. The tree references the same tabIds the #46 reducer owns.
  const [layoutState, setLayoutState] = useState<PaneLayoutState>(null)
  const layoutRef = useRef<PaneLayoutState>(null)
  // Per host+workspace key for persistence; null at the directory new-task.
  const layoutKey = selectedWorkspaceId ? `${daemonHost()}::${selectedWorkspaceId}` : null
  /** Persists a layout change for the current workspace; null removes the entry. */
  const persistLayout = (next: PaneLayoutState) => {
    layoutRef.current = next
    if (!layoutKey) return
    const all = store.get(workspacePanes)
    if (next) {
      store.set(workspacePanes, { ...all, [layoutKey]: next })
    } else {
      const rest = { ...all }
      delete rest[layoutKey]
      store.set(workspacePanes, rest)
    }
  }
  /** Translates a pane gesture into state and persistence together. */
  const dispatchPane = (event: PaneEvent) => {
    const next = reduceLayout(layoutRef.current, event)
    setLayoutState(next)
    persistLayout(next)
  }
  // The active tab that drives the header/composer: the active pane's focused
  // tab when split, else the #46 workspace's focused tab.
  const activeTabId = layoutState ? activePaneTabId(layoutState) : tabsState.activeTabId
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const activeAgentId = activeTab && activeTab.target === 'agent' ? activeTab.state.agentId : null
  const activeDraft = activeTab && activeTab.target === 'draft' ? activeTab.state : null
  // The focused setup tab (if any) gates the empty new-task/new-draft state.
  const activeSetup = selectActiveSetup(tabsState)
  const activeId = activeAgentId
  // Visited-agent history behind the chrome's back/forward arrows: opening an
  // agent records the visit, back/forward only move the cursor. An explicit
  // extension of Paseo's own navigation model (no upstream visited-history
  // stack exists); see ticket #21's parity note.
  const [visitHistory, setVisitHistory] = useState<VisitHistory>(emptyVisitHistory)
  /** Opens (or focuses) an agent's tab; recency seeds its strip position. */
  const openAgentTab = (id: string) => {
    const entry = agents.find((candidate) => candidate.id === id) ?? null
    const next = reduceTabs(tabsState, { type: 'openAgent', agentId: id, createdAt: entry ? activityAt(entry) : 0 })
    setTabsState(next)
    // In a split layout the freshly opened tab lands in the active pane.
    if (layoutRef.current) {
      const tab = next.tabs.find((c) => c.target === 'agent' && c.state.agentId === id)
      if (tab) dispatchPane({ type: 'assignTab', tabId: tab.id, paneId: layoutRef.current.activePaneId })
    }
  }
  /** Opening an agent records the visit and truncates any forward entries. */
  const visit = (id: string) => {
    openAgentTab(id)
    setVisitHistory((prev) => visitAgent(prev, id))
  }
  const nav = (delta: 1 | -1) => {
    const next = delta < 0 ? goBack(visitHistory) : goForward(visitHistory)
    if (next === visitHistory) return
    setVisitHistory(next)
    openAgentTab(next.stack[next.index]!)
  }
  const navState = { canBack: canGoBack(visitHistory), canForward: canGoForward(visitHistory) }
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftImages, setDraftImages] = useState<ImageAttachment[]>([])
  const [transientNotice, setTransientNotice] = useState<{ text: string; tone: 'warn' | 'danger' } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingSeed, setPendingSeed] = useState<{ agentId: string; text: string; images: ImageAttachment[] } | null>(
    null,
  )

  // The command palette and its catalog. ⌘K/Ctrl+K toggles; the palette's own
  // handlers exist only while it is mounted.
  const registry = useState(() => new ActionRegistry())[0]
  const [paletteOpen, setPaletteOpen] = useState(false)
  const closePalette = () => setPaletteOpen(false)
  useWindowEvent((event) => {
    if (event.eventType === 'keyDown' && isPaletteToggle(event)) setPaletteOpen((open) => !open)
  })
  // The sidebar reports its rendered rows up so the jump/prev/next shortcuts can
  // target exactly those rows. A ref keeps the handle stable for the listener.
  const visibleRowsRef = useRef<string[]>([])
  const onVisibleRowsChange = useCallback((ids: string[]) => {
    visibleRowsRef.current = ids
  }, [])

  const {
    config: draftConfig,
    setModel: setDraftModel,
    setThinking: setDraftThinking,
    setMode: setDraftMode,
    setFeature: setDraftFeature,
    syncFeatures,
  } = useDraftConfig(providers)
  const seed = pendingSeed && pendingSeed.agentId === activeId ? pendingSeed : null
  const [cwd, setCwd] = useState(process.cwd())
  const [worktree, setWorktree] = useState('local')

  // Each open agent tab owns its timeline subscription inside its own panel —
  // kept mounted (hide-not-unmount) so background tabs keep merging. The
  // active tab's conversation powers the composer, tracks row, and meter below;
  // a stable no-op stands in for draft/no-agent states (send/park are inert).
  const conversationsRef = useRef<Map<string, ComposerConversation>>(new Map())
  const emptyConversation = useRef<ComposerConversation>({
    turns: [],
    parked: [],
    pending: [],
    status: 'loading',
    usage: null,
    send: async () => false,
    park: () => {},
    release: async () => false,
    unqueue: () => {},
  })
  const conversation: ComposerConversation = activeId
    ? conversationsRef.current.get(activeId) ?? emptyConversation.current
    : emptyConversation.current
  const turns = conversation.turns
  // No OS notifier exists in @gpuix yet, so delivery silently no-ops; the
  // payloads are ready for a runtime bridge — clicking one deep-links by
  // re-selecting notice.payload.agentId.
  const attentionBridge: NotificationBridge | null = null
  const attention = useAttention({ agents, activeId, serverId: daemonHost(), bridge: attentionBridge })
  const activeEntry = agents.find((entry) => entry.id === activeId) ?? null

  // Checkout status spine: daemon pushes fill the store; the feature flag
  // hides the whole panel when the daemon has no checkout subsystem.
  const features = useDaemonFeatures(daemon)
  const checkoutOn = checkoutEnabled(features)
  const { state: checkout, retry: retryStatusFetch } = useCheckoutStatus(daemon, activeEntry?.cwd ?? null)
  const repoActions = useCheckoutActions()
  const activeStatus = activeEntry ? (checkout.entries[activeEntry.cwd]?.status ?? null) : null
  const activeRepoKey = activeStatus ? repoKeyOf(activeStatus) : (activeEntry?.cwd ?? null)
  const activeQueue = activeRepoKey ? repoActions.state.repos[activeRepoKey] : undefined

  // Workspace setup progress spine: a setup tab shows a worktree's bootstrap
  // commands as they run; `useWorkspaceSetup` owns the per-workspace store.
  const setup = useWorkspaceSetup(daemon)
  const setupEntries = setup.state.entries

  // An agent that vanished from the directory (deleted) can no longer host a
  // conversation — Paseo's own client redirects away in both cases. Its tab is
  // closed, which lands on the neighbor (or the empty new-task state).
  const activeEntryGone = activeAgentGone(activeId, agents, {
    connected: status === 'connected',
    wasSeen: activeId != null && everShownAgentIds.current.has(activeId),
  })
  useEffect(() => {
    if (activeEntryGone && activeTab) dispatchTabs({ type: 'close', tabId: activeTab.id })
  }, [activeEntryGone, activeTab])

  // Worktree creation opens a setup tab once the daemon reveals the new
  // workspace id on the agent's directory entry (the create handle carries no
  // workspace yet). Non-worktree agents are never added here, so they never get
  // a setup tab.
  useEffect(() => {
    if (pendingSetupAgents.current.size === 0) return
    for (const agentId of pendingSetupAgents.current) {
      const entry = agents.find((candidate) => candidate.id === agentId)
      if (entry?.workspaceId) {
        pendingSetupAgents.current.delete(agentId)
        dispatchTabs({ type: 'openSetup', workspaceId: entry.workspaceId, agentId, createdAt: Date.now() })
      }
    }
  }, [agents])

  // A watched setup tab hands off to its agent's conversation the moment the
  // daemon reports the worktree ready: the conversation takes over and the
  // setup tab stays behind, collapsed to its summary chip.
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.target !== 'setup' || tab.id !== activeTabId) continue
      const snapshot = setupEntries[tab.state.workspaceId]
      if (setupSucceeded(snapshot)) {
        dispatchTabs({ type: 'openAgent', agentId: tab.state.agentId, createdAt: tab.createdAt })
      }
    }
  }, [tabs, activeTabId, setupEntries])

  // Row lifecycle actions disable per row while their daemon call is in flight;
  // directory truth arrives through the subscription, never from these results.
  const [busyRows, setBusyRows] = useState<RowActionRef[]>([])
  const runRowAction = async (verb: RowActionVerb, id: string, action: () => Promise<unknown>) => {
    setBusyRows((prev) => [...prev, { verb, id }])
    try {
      await action()
    } catch (err) {
      setCreateError(errorMessage(err))
    } finally {
      setBusyRows((prev) => prev.filter((row) => row.verb !== verb || row.id !== id))
    }
  }
  const archiveWorkspaceRow = (id: string) => runRowAction('archive', id, () => daemon.archiveWorkspace(id))
  const renameWorkspaceRow = (id: string, name: string) =>
    runRowAction('rename', id, () => daemon.setWorkspaceTitle(id, name))
  // The pin/labels/mark-as-read mutations go through the wrapper: labels earn
  // their keep shaping the label+colour payload, the rest ride along for one
  // narrow client seam instead of five ad-hoc daemon call sites.
  const mutations = workspaceMutations(daemon)
  const pinWorkspaceRow = (id: string, pinned: boolean) =>
    runRowAction('pin', id, () => mutations.setPinned(id, pinned))
  const markWorkspaceRead = (id: string) =>
    runRowAction('mark-read', id, () => mutations.clearAttention(id))
  const toggleWorkspaceLabel = (id: string, name: string, applied: boolean) =>
    runRowAction('labels', id, () => mutations.toggleLabel(id, name, applied))
  const clearWorkspaceLabels = (id: string) => {
    const descriptor = workspaces.workspaces.find((candidate) => candidate.id === id)
    const applied = descriptor?.labels ?? []
    if (applied.length === 0) return
    runRowAction('labels', id, () => mutations.clearLabels(id, applied))
  }
  // Copy is a synchronous clipboard write, not a daemon call; it needs no
  // in-flight row and the menu computes its value from the descriptor it owns.
  const copyWorkspaceValue = (value: string) => {
    const clipboard = (navigator as { clipboard?: { writeText?: (text: string) => Promise<void> } }).clipboard
    if (!clipboard?.writeText) return
    clipboard.writeText(value).catch(() => {})
  }

  // Agent lifecycle (archive, delete, rename): the promises drive the
  // in-flight disabling; the directory itself is only ever written by the
  // subscription.
  const archiveAgentRow = (id: string) => runRowAction('archive', id, () => daemon.archiveAgent(id))
  const deleteAgentRow = (id: string) => runRowAction('delete', id, () => daemon.deleteAgent(id))
  const renameAgentRow = (id: string, name: string) =>
    runRowAction('rename', id, () => daemon.updateAgent(id, { name: name.trim() }))

  /**
   * Opening a workspace replaces the strip with that workspace's tabs: an
   * agent tab per non-archived agent (most recent first), plus a trailing draft
   * tab seeded to the workspace directory for starting something new. A
   * workspace with no agents yields just that draft tab.
   */
  const openWorkspace = (id: string) => {
    setSelectedWorkspaceId(id)
    setCreateError(null)
    // Restore this host+workspace's persisted pane layout, if any.
    const persisted = store.get(workspacePanes)[`${daemonHost()}::${id}`] ?? null
    layoutRef.current = persisted
    setLayoutState(persisted)
    const descriptor = workspaces.workspaces.find((candidate) => candidate.id === id)
    if (!descriptor) {
      dispatchTabs({ type: 'reset' })
      return
    }
    const workspaceAgents = agentsOfWorkspace(agents, descriptor).filter((a) => !isArchived(a))
    dispatchTabs({
      type: 'openWorkspace',
      agents: workspaceAgents.map((a) => ({ id: a.id, createdAt: activityAt(a) })),
      cwd: workspaceDirectory(descriptor),
      now: Date.now(),
    })
  }
  // Jump + prev/next shortcuts over the sidebar's visible rows. The walk order
  // arrives via visibleRowsRef (reported by the Sidebar itself); opening the
  // target reuses onSelect's own path so a shortcut behaves like a row click.
  useWindowEvent((event) => {
    if (event.eventType !== 'keyDown') return
    const orders = visibleRowsRef.current
    // ⌘/Ctrl+1–9 jumps to the nth visible row; gaps from filtering and
    // collapsed groups were already skipped by the walk-order computation.
    const jump = isJumpShortcut(event)
    if (jump != null) {
      const target = orders[jump - 1]
      if (target) openWorkspace(target)
      return
    }
    if (isPrevWorkspace(event) || isNextWorkspace(event)) {
      const index = prevNextWorkspaceTarget(orders, selectedWorkspaceId, isPrevWorkspace(event) ? -1 : 1)
      const target = index >= 0 ? orders[index] : null
      if (target) openWorkspace(target)
    }
  })

  // ---- pane layout operations ----------------------------------------------
  // These translate user gestures into PaneEvents (and #46 tab events where a
  // tab's existence is being changed), keeping the pane tree and the #46 tab
  // strip in one id space. When the layout is null they degrade to the single
  // tab strip exactly as before.

  /** Split the active pane right or down; materializes a split layout on demand. */
  const splitActivePane = (direction: 'right' | 'down') => {
    const layout = layoutRef.current
    if (layout) {
      const target = layout.activePaneId
      if (!target) return
      dispatchPane(direction === 'right' ? { type: 'splitRight', paneId: target } : { type: 'splitDown', paneId: target })
      return
    }
    // No split yet: materialize the default single pane (which hosts the
    // workspace's tabs) and split it.
    const single: PaneLayoutState = { root: leafFor(tabs.map((t) => t.id), tabsState.activeTabId), activePaneId: '' }
    layoutRef.current = single
    const target = single.root.id
    const next = reduceLayout(single, direction === 'right' ? { type: 'splitRight', paneId: target } : { type: 'splitDown', paneId: target })
    setLayoutState(next)
    persistLayout(next)
  }

  /** Select a tab inside a pane; keeps #46's focus in sync for the non-split path. */
  const selectTabInPane = (paneId: string, tabId: string) => {
    if (layoutRef.current) dispatchPane({ type: 'focusTab', paneId, tabId })
    dispatchTabs({ type: 'select', tabId })
  }

  /** Close a tab: drop it from #46 and remove its pane references (wherever it lives). */
  const closeTabInPane = (_paneId: string, tabId: string) => {
    dispatchTabs({ type: 'close', tabId })
    if (layoutRef.current) dispatchPane({ type: 'removeTab', tabId })
  }

  /** Close every other tab in a pane, keeping `tabId` focused there. */
  const closeOthersInPane = (paneId: string, tabId: string) => {
    const layout = layoutRef.current
    if (!layout) return
    const others = paneTabIds(layout.root, paneId).filter((id) => id !== tabId)
    for (const other of others) {
      dispatchTabs({ type: 'close', tabId: other })
      dispatchPane({ type: 'removeTab', tabId: other })
    }
    dispatchPane({ type: 'focusTab', paneId, tabId })
  }

  /** Append a new draft tab into a specific pane (or the single strip). */
  const openDraftInPane = (paneId: string) => {
    const dir = activeDraft?.cwd ?? cwd
    const next = reduceTabs(tabsState, { type: 'openDraft', cwd: dir, now: Date.now() })
    setTabsState(next)
    const newTab = next.tabs.at(-1)
    if (newTab && layoutRef.current) dispatchPane({ type: 'assignTab', tabId: newTab.id, paneId })
  }

  /** Cycle pane or tab focus via the keyboard (both directions, wrapping). */
  const cyclePane = (direction: 'next' | 'prev', kind: 'pane' | 'tab') => {
    if (!layoutRef.current) return
    const event: PaneEvent =
      kind === 'pane'
        ? direction === 'next'
          ? { type: 'focusNextPane' }
          : { type: 'focusPrevPane' }
        : direction === 'next'
          ? { type: 'focusNextTab' }
          : { type: 'focusPrevTab' }
    dispatchPane(event)
  }

  /** Move the active tab to the first/next pane in the walk (a simple move op). */
  const moveActiveTabToNextPane = () => {
    const layout = layoutRef.current
    if (!layout) return
    const leaves = paneLeaves(layout.root)
    if (leaves.length < 2) return
    const idx = leaves.findIndex((l) => l.id === layout.activePaneId)
    const next = leaves[(idx + 1) % leaves.length]!
    const focusedTab = activePaneTabId(layout)
    if (!focusedTab) return
    dispatchPane({ type: 'moveTab', tabId: focusedTab, fromPaneId: layout.activePaneId, toPaneId: next.id })
  }

  // Pane keyboard control: Cmd/Ctrl+Alt+←/→ cycles panes, Cmd/Ctrl+Alt+↑/↓
  // cycles tabs, Cmd/Ctrl+Shift+←/→ splits the active pane, Cmd/Ctrl+Shift+↑
  // moves the active tab to the next pane.
  useWindowEvent((event) => {
    if (event.eventType !== 'keyDown') return
    const mod = event.modifiers
    if (!mod || !(mod.cmd || mod.ctrl)) return
    if (mod.alt && !mod.shift) {
      if (event.key === 'ArrowRight') cyclePane('next', 'pane')
      else if (event.key === 'ArrowLeft') cyclePane('prev', 'pane')
      else if (event.key === 'ArrowDown') cyclePane('next', 'tab')
      else if (event.key === 'ArrowUp') cyclePane('prev', 'tab')
      return
    }
    if (mod.shift && !mod.alt) {
      if (event.key === 'ArrowRight') splitActivePane('right')
      else if (event.key === 'ArrowDown') splitActivePane('down')
      else if (event.key === 'ArrowUp') moveActiveTabToNextPane()
    }
  })

  // Seed a materialized single-pane leaf for the first split.
  function leafFor(tabIds: string[], focused: string | null) {
    return { kind: 'leaf' as const, id: 'root', tabIds, focusedTabId: focused }
  }

  const agentRunning = activeEntry?.status === 'running'
  const [stopping, setStopping] = useState(false)
  useEffect(() => setStopping(false), [activeId])
  useEffect(() => {
    if (!agentRunning) setStopping(false)
  }, [agentRunning])
  const stopAgent = async () => {
    if (!activeId || !agentRunning || stopping) return
    setStopping(true)
    try {
      await daemon.cancelAgent(activeId)
    } catch (err) {
      setStopping(false)
      setCreateError(errorMessage(err))
    }
  }

  // Subagents: the tracks-row pill reads the store's rows; opening a managed
  // row is ordinary conversation navigation, a provider row swaps the
  // transcript area for its read-only timeline. Managed children work
  // regardless of any daemon feature flag; provider parts gate strictly.
  const subagents = useSubagents(daemon, activeId)
  const [viewing, setViewing] = useState<OpenSubagent | null>(null)
  useEffect(() => {
    setViewing(null)
  }, [activeId])
  const subagentRows = useMemo(
    () => selectTrackRows(subagents.state, agents, activeId, subagents.enabled),
    [subagents.state, subagents.enabled, agents, activeId],
  )
  const viewingRow = viewing
    ? subagentRows.find((row) => row.kind === viewing.kind && row.id === viewing.id) ?? null
    : null
  useEffect(() => {
    // A provider subagent's timeline is garbage-collected the moment its
    // descriptor leaves the directory; a viewer still pointed at it would sit
    // on "Loading subagent…" forever. The row no longer being in the track
    // proves it's gone, so fold the viewer back.
    if (viewing?.kind === 'provider' && !viewingRow) setViewing(null)
  }, [viewing, viewingRow])
  const viewingSubagent = viewing?.kind === 'provider' ? viewing : null
  const providerTurns =
    viewingSubagent
      ? subagentTurns(subagents.state, viewingSubagent.parentAgentId, viewingSubagent.id)
      : []

  // The provider-subagent viewer sits on top of the tabs and carries its own
  // list and follow; agent tabs manage theirs inside their panels.
  const subagentListRef = useRef<{ id: number } | null>(null)
  const { renderer } = useGpuix()
  const subagentFollow = useTranscriptFollow({
    listRef: subagentListRef,
    turnCount: providerTurns.length,
    tailSignature: providerTurns.length > 0 ? JSON.stringify(providerTurns.at(-1)) : undefined,
    agentId: viewingSubagent?.parentAgentId ?? activeId,
    renderer,
    slotOffset: 0,
  })

  const viewSubagent = (target: OpenSubagent) => {
    if (target.kind === 'managed') {
      visit(target.id)
      return
    }
    subagents.openTimeline(target.parentAgentId, target.id)
    setViewing(target)
  }
  const archiveSubagentRow = (id: string) => runRowAction('archive', id, () => daemon.archiveAgent(id))
  const detachSubagentRow = (id: string) => runRowAction('detach', id, () => daemon.detachAgent(id))
  // Both halves of the detach gate read the latest server_info snapshot; the
  // hook re-renders us on each server_info event so the read stays current.
  const daemonFeatures = daemon.getLastServerInfoMessage()?.features
  const detachEnabled = providerSubagentsEnabled(daemonFeatures) && daemonFeatures?.agentDetach === true

  // Chip values for an active agent come from the live agent; the draft stays
  // authoritative only while no agent is selected.
  const truthOfActive = useMemo(() => (activeEntry ? liveTruth(activeEntry) : null), [activeEntry])
  const live = useLiveAgentConfig(daemon, activeId, truthOfActive ?? NO_TRUTH)
  const editingLive = activeId != null && truthOfActive != null
  const chipValues = editingLive ? live.config : draftConfig
  const modelValue = chipValues.modelValue
  const thinkingId = chipValues.thinkingId
  const modeId = chipValues.modeId
  const featureValues = chipValues.featureValues
  // A running agent is one provider's process, so only that provider's models apply.
  const chipProviders = useMemo(
    () => (activeEntry ? providers.filter((entry) => entry.provider === activeEntry.provider) : providers),
    [providers, activeEntry],
  )

  const { entry: providerOfModel, model: modelDef } = useMemo(
    () => findModel(providers, modelValue),
    [providers, modelValue],
  )

  // Draft-side feature catalog for the picked provider/model; live agents read
  // theirs straight off the agent snapshot instead. Merged responses land in
  // the draft config, where catalog values become the toggles' defaults.
  const draftFeatures = useProviderFeatures(
    editingLive ? null : daemon,
    editingLive ? undefined : providerOfModel?.provider,
    editingLive ? undefined : modelDef?.id,
  )
  useEffect(() => {
    if (!editingLive) syncFeatures(draftFeatures)
    // syncFeatures only reads its argument; it needs no dep.
  }, [editingLive, draftFeatures])

  // Composer folder choices come straight from the workspace store.
  const cwdOptions = useMemo(() => workspaceDirectoryChoices(workspaces), [workspaces])

  // The meter reads the live stream's usage, falling back to the directory
  // snapshot until the first event lands; the window size falls back to the
  // selected model's catalog value when usage omits it.
  const sessionUsage = conversation.usage ?? activeEntry?.lastUsage ?? null
  const usageMeter = useMemo(
    () =>
      contextMeter({
        usedTokens: sessionUsage?.contextWindowUsedTokens,
        maxTokens: sessionUsage?.contextWindowMaxTokens ?? modelDef?.contextWindowMaxTokens ?? null,
        costUsd: sessionUsage?.totalCostUsd,
        // The wire usage schema carries no per-provider shares yet, so the
        // breakdown seam stays latched for when the daemon reports them.
      }),
    [sessionUsage, modelDef],
  )

  // The transcript area (parent conversation, provider-subagent viewer, and
  // its scroll state) lives inside per-tab conversation panels so background
  // tabs keep streaming; nothing scroll- or history-related lives here any more.

  /** Clears the composer after the text (and chips) have found a home. */
  const clearDraft = () => {
    setDraft('')
    setDraftImages([])
    setCreateError(null)
    setTransientNotice(null)
  }

  /**
   * Stops the agent's active turn first, then delivers the text as a fresh
   * message; the interrupted turn shows its stopped state via the timeline.
   */
  const interruptAndDeliver = async (text: string, stagedImages: ImageAttachment[]) => {
    if (!activeId) return
    try {
      await daemon.cancelAgent(activeId)
    } catch {
      // Already between turns — delivering is still what was asked for.
    }
    const ok = await conversation.send(text, stagedImages)
    if (!ok) restoreDraft(text, stagedImages)
  }

  /**
   * The composer's send gesture, resolved against the active turn: Enter steers
   * a running agent, Cmd/Ctrl+Enter parks the draft above the composer,
   * Alt+Enter interrupts first — and idle agents behave exactly as before.
   */
  const submitDraft = async (gesture: SendGesture, raw: string) => {
    const text = raw.trim()
    if (!text || status !== 'connected') return
    // Sending means the user is here: any attention on this agent can rest.
    attention.engageComposer(activeId)
    const intent = activeEntry ? resolveSendIntent(isAgentRunning(activeEntry), gesture) : { kind: 'send' as const }
    const stagedImages = draftImages

    if (intent.kind === 'queue') {
      conversation.park(text, stagedImages)
      clearDraft()
      return
    }
    if (intent.kind === 'interrupt') {
      clearDraft()
      void interruptAndDeliver(text, stagedImages)
      return
    }

    const outgoing = toSendImages(stagedImages)
    clearDraft()
    if (activeId) {
      // Steer rides the active turn; the hook degrades to plain delivery
      // itself when the daemon cannot apply it.
      void conversation.send(text, stagedImages, intent.kind === 'steer' ? 'steer' : undefined).then((ok) => {
        // A failed send restores the exact previous chips next to the text.
        if (!ok) restoreDraft(text, stagedImages)
      })
      return
    }
    if (!modelValue) {
      setCreateError('No provider model is ready yet.')
      restoreDraft(text, stagedImages)
      return
    }
    // A draft tab creates the agent in its own directory; the directory
    // new-task state uses the composer's cwd/worktree choices.
    const createDir = activeDraft?.cwd ?? cwd
    const createWorktree = activeDraft?.worktree ?? worktree
    try {
      const config: PaseoAgentConfig = { provider: modelValue }
      if (modeId) config.modeId = modeId
      if (thinkingId) config.thinkingOptionId = thinkingId
      if (Object.keys(featureValues).length > 0) config.featureValues = { ...featureValues }
      const handle = await client.agents.create({
        config,
        cwd: createDir,
        prompt: text,
        ...(outgoing.length > 0 ? { images: outgoing } : {}),
        ...(createWorktree === 'worktree' ? { git: { createWorktree: true } } : {}),
      })
      setPendingSeed({ agentId: handle.id, text, images: stagedImages })
      setVisitHistory((prev) => visitAgent(prev, handle.id))
      // A worktree bootstrap needs a setup tab; its workspace id only appears
      // on the agent's directory entry as the daemon creates the worktree, so
      // it is resolved by the correlation effect above.
      if (createWorktree === 'worktree') pendingSetupAgents.current.add(handle.id)
      if (activeTab && activeDraft) {
        // The draft tab flips into the new agent's tab and stays focused.
        dispatchTabs({
          type: 'draftSent',
          tabId: activeTab.id,
          agentId: handle.id,
          createdAt: Date.now(),
        })
      } else {
        // Directory new-task: open the new agent as its own tab.
        openAgentTab(handle.id)
      }
    } catch (err) {
      setCreateError(errorMessage(err))
      restoreDraft(text, stagedImages)
    }
  }

  /** Puts a failed send back into the composer, text and chips both restored. */
  const restoreDraft = (text: string, images: ImageAttachment[]) => {
    setDraft(text)
    setDraftImages(images)
  }

  // Brief inline notices dismiss themselves.
  useEffect(() => {
    if (!transientNotice) return
    const timer = setTimeout(() => setTransientNotice(null), 4_000)
    return () => clearTimeout(timer)
  }, [transientNotice])

  /**
   * Routes transcript open-file requests through the shared seam. With no
   * native bridge yet the request degrades to a visible notice instead of
   * dying silently; a bridge failure names its error the same way.
   */
  const openFile = (absolutePath: string) => {
    void requestOpenFile(nativeOpenFileBridge(), absolutePath).then((outcome) => {
      if (outcome.status === 'opened') return
      setTransientNotice({
        text: outcome.status === 'unavailable' ? outcome.notice : outcome.message,
        tone: outcome.status === 'unavailable' ? 'warn' : 'danger',
      })
    })
  }

  /** Stages an attach plan's chips and surfaces its inline notice, if any. */
  const applyPlan = (plan: AttachmentPlan) => {
    if (plan.images.length > 0) setDraftImages((prev) => [...prev, ...plan.images])
    if (plan.notice) {
      setTransientNotice({ text: plan.notice, tone: plan.images.length === 0 ? 'danger' : 'warn' })
    }
  }

  /** Validates offered files and stages survivors as chips; attaching needs a daemon. */
  const offerImages = (files: readonly IncomingImage[]) => {
    if (disabledReason) return
    applyPlan(planAttachments(files))
  }

  /**
   * Receives clipboard contents once a runtime bridge offers them: raster image
   * files become chips, everything else falls through as normal text. Bound via
   * the composer's onPastePayload contract until @gpuix exposes paste events;
   * note its editor consumes Ctrl+V natively, so failed image pastes never
   * even reach JS as keystrokes.
   */
  const offerPaste = (payload: PastePayload) => {
    const { appendText, plan } = planPaste(payload)
    if (plan) applyPlan(plan)
    else if (appendText != null) setDraft((prev) => prev + appendText)
  }

  const pickAttachments = async () => {
    if (disabledReason) return
    const picked = await openImagePicker()
    if (picked === null) {
      setTransientNotice({ text: 'Picking files needs a native dialog; attaching images is not supported yet.', tone: 'warn' })
      return
    }
    if (picked.length > 0) offerImages(picked)
  }

  /** Pulls a queued send back into the composer for editing, chips included. */
  const editQueued = (queuedId: string) => {
    const entry = conversation.pending.find((send) => send.id === queuedId)
    if (!entry) return
    conversation.unqueue(queuedId)
    setDraft(entry.text)
    setDraftImages(entry.images)
    setCreateError(null)
    setTransientNotice(null)
  }

  /** Fires a parked send now; on failure, restores the draft to the composer. */
  const sendParkedNow = async (id: string) => {
    const target = conversation.pending.find((send) => send.id === id && !send.sent)
    if (!target) return
    const ok = await conversation.release(id)
    if (!ok) {
      restoreDraft(target.text, target.images)
    }
  }

  const title = activeId ? (activeEntry ? displayName(activeEntry) : 'Agent') : 'New Task'
  const needsModel = !activeId && !modelValue
  const disabledReason =
    status !== 'connected'
      ? status === 'connecting'
        ? 'Connecting to the daemon…'
        : 'Daemon unavailable'
      : needsModel
        ? 'Waiting for an available provider model…'
        : null

  const onModelChange = editingLive ? live.setModel : setDraftModel
  const onThinkingChange = editingLive ? live.setThinking : setDraftThinking
  const onModeChange = editingLive ? live.setMode : setDraftMode
  const onFeatureToggle = editingLive ? live.setFeature : setDraftFeature

  // `@` completion lists the selected agent's workspace, or the chosen one for
  // a new task. Daemon errors degrade to no suggestions inside the hook.
  const mentionCwd = activeEntry?.cwd ?? activeDraft?.cwd ?? cwd
  const mentionSource = useMemo<MentionSource>(
    () => ({
      cwd: mentionCwd,
      fetch: async (query) => {
        const payload = await daemon.getDirectorySuggestions({
          query,
          cwd: mentionCwd,
          limit: 24,
          includeFiles: true,
          includeDirectories: true,
          matchMode: 'fuzzy',
        })
        return toMentionEntries(payload, mentionCwd)
      },
    }),
    [daemon, mentionCwd],
  )

  // Palette contributions: static commands, then live mirrors of the agent
  // directory, workspace list, and provider catalog. Each batch retires when
  // its inputs change, so the registry never goes stale.
  useContributeActions(
    registry,
    () => [
      {
        id: 'app.new-task',
        title: 'New Task',
        section: 'actions',
        keywords: 'compose new agent',
        run: () => {
          dispatchTabs({ type: 'reset' })
          setSelectedWorkspaceId(null)
          setLayoutState(null)
          layoutRef.current = null
          // Same rule as the sidebar's New Task: no phantom future survives.
          setVisitHistory(truncateForward)
          setCreateError(null)
          setPaletteOpen(false)
        },
      },
      {
        id: 'app.toggle-sidebar',
        title: 'Toggle Sidebar',
        section: 'actions',
        run: () => setCollapsed((prev) => !prev),
      },
    ],
    [],
  )
  // Persisted view choice: archived agents surface in the palette only when
  // the sidebar's reveal toggle is on (same key the sidebar writes).
  const [showArchived] = useAppState(store, showArchivedAgents)
  useContributeActions(
    registry,
    () =>
      visibleAgents(agents, showArchived).map((entry) => ({
        id: `agent.${entry.id}`,
        title: displayName(entry),
        section: 'agents' as const,
        hint: basename(entry.cwd),
        keywords: STATUS_BUCKET_LABELS[statusBucket(entry)],
        checked: entry.id === activeId,
        run: () => {
          visit(entry.id)
          setCreateError(null)
          setPaletteOpen(false)
        },
      })),
    [agents, activeId, showArchived],
  )
  useContributeActions(
    registry,
    () => {
      // The workspace footer locks while a tab owns the conversation (an agent
      // or a draft tab carries its own directory).
      if (activeEntry || activeDraft) return []
      return [...new Set([process.cwd(), ...cwdOptions])].map((dir) => ({
        id: `workspace.${dir}`,
        title: basename(dir),
        section: 'workspaces' as const,
        hint: dir,
        checked: dir === cwd,
        run: () => {
          setCwd(dir)
          setPaletteOpen(false)
        },
      }))
    },
    [activeEntry, cwdOptions, cwd],
  )
  useContributeActions(
    registry,
    () =>
      modelChoices(chipProviders).map((choice) => ({
        id: `model.${choice.value}`,
        title: choice.label,
        section: 'model' as const,
        hint: choice.providerLabel,
        keywords: `${choice.modelId} ${choice.providerLabel}`,
        checked: choice.value === modelValue,
        run: () => {
          onModelChange(choice.value)
          setPaletteOpen(false)
        },
      })),
    [chipProviders, modelValue, editingLive],
  )
  useContributeActions(
    registry,
    () =>
      thinkingOptions(modelDef).map((option) => ({
        id: `thinking.${option.id}`,
        title: option.label,
        section: 'thinking' as const,
        hint: option.description,
        checked: option.id === thinkingId,
        run: () => {
          onThinkingChange(option.id)
          setPaletteOpen(false)
        },
      })),
    [modelDef, thinkingId, editingLive],
  )
  useContributeActions(
    registry,
    () =>
      modeOptions(providerOfModel?.modes).map((option) => ({
        id: `mode.${option.id}`,
        title: option.label,
        section: 'mode' as const,
        hint: option.description,
        checked: option.id === modeId,
        run: () => {
          onModeChange(option.id)
          setPaletteOpen(false)
        },
      })),
    [providerOfModel, modeId, editingLive],
  )

  const draftChips = (
    <>
      <ModelPicker providers={chipProviders} value={modelValue} onChange={onModelChange} />
      <OptionPicker
        value={thinkingId}
        onChange={onThinkingChange}
        options={thinkingOptions(modelDef)}
        icon="zap"
        sectionLabel="Reasoning"
        fallbackLabel="Reasoning"
      />
      <OptionPicker
        value={modeId}
        onChange={onModeChange}
        options={modeOptions(providerOfModel?.modes)}
        icon="lock"
        sectionLabel="Access"
        fallbackLabel="Access"
        menuWidth={288}
      />
      <FeatureToggles
        features={editingLive ? toggleFeatures(activeEntry?.features) : draftFeatures}
        values={featureValues}
        onToggle={onFeatureToggle}
      />
    </>
  )

  // Slash commands ask about the active agent, or the draft for a new one.
  const composerCommands: ComposerCommands | undefined =
    status === 'connected'
      ? {
          seam: daemon,
          agentId: activeId,
          draft: activeId ? null : { modelValue, thinkingId, modeId, cwd: activeDraft?.cwd ?? cwd },
        }
      : undefined

  // ---- multi-pane rendering --------------------------------------------------
  // In a split layout each pane shows its own tab strip (PaneSplit owns it) and
  // this content area below it: the focused agent panel, a draft center message,
  // or an empty-pane hint. All of a pane's agent panels stay mounted (streaming
  // live) with only the focused one visible, matching the single-pane rule.
  const paneMeta: PaneStripMeta = {
    labelFor: (tab) => {
      if (tab.target === 'agent') {
        const entry = agents.find((candidate) => candidate.id === tab.state.agentId)
        return entry ? displayName(entry) : 'Agent'
      }
      if (tab.target === 'draft') return basename(tab.state.cwd)
      return 'Workspace setup'
    },
    dotColorFor: (tab) => {
      if (tab.target !== 'agent') return null
      const entry = agents.find((candidate) => candidate.id === tab.state.agentId)
      return entry ? agentStatusColor(entry) : null
    },
    attentionFor: (tab) => {
      if (tab.target !== 'agent') return false
      return Boolean(agents.find((candidate) => candidate.id === tab.state.agentId)?.requiresAttention)
    },
  }
  const renderPaneContent = (paneId: string, tabIds: string[], focusedTabId: string | null): React.ReactNode => {
    const focusedTab = tabs.find((t) => t.id === focusedTabId) ?? null
    if (!focusedTabId || tabIds.length === 0 || !focusedTab) {
      return <CenterMessage title="Empty pane" detail="Open an agent here, or close this pane." />
    }
    if (focusedTab.target === 'draft') {
      return <CenterMessage title="New draft" detail={`Describe what to build in ${basename(focusedTab.state.cwd)}.`} />
    }
    if (focusedTab.target === 'setup') {
      return (
        <SetupTabPanel
          key={focusedTab.id}
          workspaceId={focusedTab.state.workspaceId}
          snapshot={setupEntries[focusedTab.state.workspaceId] ?? null}
          refresh={setup.refresh}
        />
      )
    }
    if (focusedTab.target !== 'agent') {
      return <CenterMessage title="No agent here" detail="Pick an agent for this pane." />
    }
    const isActivePane = paneId === layoutRef.current?.activePaneId
    return (
      <>
        {tabIds.map((id) => {
          const tab = tabs.find((t) => t.id === id)
          return tab && tab.target === 'agent' ? (
            <AgentTabPanel
              key={tab.id}
              client={client}
              daemon={daemon}
              agentId={tab.state.agentId}
              seedText={pendingSeed?.agentId === tab.state.agentId ? pendingSeed.text : null}
              seedImages={pendingSeed?.agentId === tab.state.agentId ? pendingSeed.images : null}
              onSeedConsumed={() => {
                if (pendingSeed?.agentId === tab.state.agentId) setPendingSeed(null)
              }}
              hidden={tab.id !== focusedTabId}
              showTranscript={isActivePane && tab.id === focusedTabId ? !viewingSubagent : false}
              onConversation={(id, conv) => conversationsRef.current.set(id, conv)}
              onEditQueued={editQueued}
              onOpenFile={openFile}
              workspaceRoot={agents.find((a) => a.id === tab.state.agentId)?.cwd ?? null}
            />
          ) : null
        })}
      </>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        position: 'relative',
        width: '100%',
        height: '100%',
        fontFamily: '.SystemUIFont',
        color: C.text,
      }}
    >
      <motion.div
        initial={false}
        animate={{ width: collapsed ? 0 : SIDEBAR_WIDTH + 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        style={{
          display: 'flex',
          flexDirection: 'row',
          height: '100%',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <Sidebar
          workspaces={workspaces}
          agents={agents}
          activeWorkspaceId={selectedWorkspaceId}
          activeAgentId={activeId}
          onSelect={openWorkspace}
          onOpenAgent={(id) => {
            visit(id)
            setCreateError(null)
          }}
          onDeleteAgent={deleteAgentRow}
          onNewTask={() => {
            dispatchTabs({ type: 'reset' })
            // Starting a new task is a fresh edge, not a forward jump: drop any
            // phantom future the visited stack was still holding.
            setVisitHistory(truncateForward)
            setSelectedWorkspaceId(null)
            setLayoutState(null)
            layoutRef.current = null
            setCreateError(null)
          }}
          onCollapse={() => setCollapsed(true)}
          status={status}
          busyRows={busyRows}
          onArchive={archiveWorkspaceRow}
          onRename={renameWorkspaceRow}
          onCopy={copyWorkspaceValue}
          onMarkRead={markWorkspaceRead}
          onPin={pinWorkspaceRow}
          onToggleLabel={toggleWorkspaceLabel}
          onClearLabels={clearWorkspaceLabels}
          appStore={store}
          navState={navState}
          onNavBack={() => nav(-1)}
          onNavForward={() => nav(1)}
          onVisibleRowsChange={onVisibleRowsChange}
        />
        <div style={{ width: 1, height: '100%', flexShrink: 0, backgroundColor: C.sidebarBorder }} />
      </motion.div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minWidth: 0,
          height: '100%',
          backgroundColor: C.canvas,
        }}
      >
        <Header
          collapsed={collapsed}
          onExpand={() => setCollapsed(false)}
          title={title}
          entry={activeEntry}
          stopping={stopping}
          onStop={() => void stopAgent()}
          busy={activeId != null && busyRows.some((row) => row.id === activeId)}
          onRename={renameAgentRow}
          onArchive={archiveAgentRow}
          onDelete={deleteAgentRow}
          navState={navState}
          onNavBack={() => nav(-1)}
          onNavForward={() => nav(1)}
        />
        {activeEntry && checkoutOn && (
          <CheckoutPanel
            entry={checkout.entries[activeEntry.cwd]}
            actions={activeQueue}
            onRefresh={() => {
              if (!activeEntry || !activeRepoKey || activeQueue?.running) return
              // A failed lookup holds no repository truth yet: re-run the
              // status fetch instead of mutating through the queue.
              if (!checkout.entries[activeEntry.cwd]?.status) {
                retryStatusFetch(activeEntry.cwd)
                return
              }
              void repoActions.run(
                activeRepoKey,
                'refresh',
                'Refreshed',
                () => daemon.checkoutRefresh(activeEntry.cwd),
              )
            }}
          />
        )}
        {viewingSubagent && (
          <SubagentViewerBar
            label={subagentLabel(viewingRow) ?? 'Subagent'}
            statusColor={viewingRow ? subagentRowColor(viewingRow) : C.ghost}
            onBack={() => setViewing(null)}
          />
        )}
        {layoutState ? (
          <PaneSplit
            layout={layoutState}
            tabs={tabs}
            meta={paneMeta}
            renderPane={renderPaneContent}
            onSelectTab={selectTabInPane}
            onCloseTab={closeTabInPane}
            onCloseOthers={closeOthersInPane}
            onNewDraft={openDraftInPane}
          />
        ) : (
          <>
          {tabs.length > 0 && (
          <TabStrip
            tabs={tabs}
            activeTabId={activeTabId}
            labelFor={(tab) => {
              if (tab.target === 'agent') {
                const entry = agents.find((candidate) => candidate.id === tab.state.agentId)
                return entry ? displayName(entry) : 'Agent'
              }
              if (tab.target === 'draft') return basename(tab.state.cwd)
              if (tab.target === 'setup') {
                const snap = setupEntries[tab.state.workspaceId]
                return snap ? `${snap.detail.branchName} setup` : 'Setup'
              }
              return 'Workspace setup'
            }}
            dotColorFor={(tab) => {
              if (tab.target === 'agent') {
                const entry = agents.find((candidate) => candidate.id === tab.state.agentId)
                return entry ? agentStatusColor(entry) : null
              }
              if (tab.target === 'setup') {
                const snap = setupEntries[tab.state.workspaceId]
                if (snap?.status === 'running') return C.running
                if (snap?.status === 'completed') return C.success
                if (snap?.status === 'failed') return C.danger
                return C.running
              }
              return null
            }}
            attentionFor={(tab) => {
              if (tab.target !== 'agent') return false
              return Boolean(agents.find((candidate) => candidate.id === tab.state.agentId)?.requiresAttention)
            }}
            onSelect={(tabId) => dispatchTabs({ type: 'select', tabId })}
            onClose={(tabId) => dispatchTabs({ type: 'close', tabId })}
            onCloseOthers={(tabId) => dispatchTabs({ type: 'closeOthers', tabId })}
            onNewDraft={() => dispatchTabs({ type: 'openDraft', cwd: activeDraft?.cwd ?? cwd, now: Date.now() })}
          />
          )}
          {status === 'error' ? (
            <CenterMessage
              title={`Cannot reach ${daemonHost()}`}
              detail={`${error}\n\nStart a daemon with: npm install -g @getpaseo/cli && paseo`}
            />
          ) : status === 'connecting' ? (
            <CenterMessage title={`Connecting to ${daemonHost()}…`} />
          ) : viewingSubagent ? (
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
              {subagentHasOlder(subagents.state, viewingSubagent.parentAgentId, viewingSubagent.id) && (
                <SubagentLoadOlder
                  loading={subagents.loadingOlder}
                  onClick={() =>
                    subagents.loadOlder(viewingSubagent.parentAgentId, viewingSubagent.id)
                  }
                />
              )}
              <Transcript
                turns={providerTurns}
                permissions={[]}
                onRespond={undefined}
                onEditQueued={undefined}
                listRef={subagentListRef}
                detached={!subagentFollow.following}
                onScroll={subagentFollow.onScroll}
                onJumpToBottom={subagentFollow.requestJump}
                onJumpToTurn={subagentFollow.jumpToTurn}
              />
            </div>
          ) : activeId == null && !activeSetup ? (
            <CenterMessage
              title={activeDraft ? 'New draft' : 'New task'}
              detail={`Pick a model, then describe what to build in ${basename(activeDraft?.cwd ?? cwd)}.`}
            />
          ) : null}
          {/* Every open agent tab stays mounted so its timeline keeps streaming;
              only the focused one is visible. */}
          {tabs.map((tab) =>
            tab.target === 'agent' ? (
              <AgentTabPanel
                key={tab.id}
                client={client}
                daemon={daemon}
                agentId={tab.state.agentId}
                seedText={pendingSeed?.agentId === tab.state.agentId ? pendingSeed.text : null}
                seedImages={pendingSeed?.agentId === tab.state.agentId ? pendingSeed.images : null}
                onSeedConsumed={() => {
                  if (pendingSeed?.agentId === tab.state.agentId) setPendingSeed(null)
                }}
                hidden={tab.id !== activeTabId}
                showTranscript={tab.id === activeTabId ? !viewingSubagent : false}
                onConversation={(id, conv) => conversationsRef.current.set(id, conv)}
                onEditQueued={editQueued}
                onOpenFile={openFile}
                workspaceRoot={agents.find((a) => a.id === tab.state.agentId)?.cwd ?? null}
              />
            ) : tab.target === 'setup' ? (
              <SetupTabPanel
                key={tab.id}
                workspaceId={tab.state.workspaceId}
                snapshot={setupEntries[tab.state.workspaceId] ?? null}
                refresh={setup.refresh}
                hidden={tab.id !== activeTabId}
              />
            ) : null,
          )}
          </>
        )}
        {createError && (
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', paddingBottom: 4 }}>
            <text style={{ fontSize: 12, color: C.danger, width: CONTENT_MAX_WIDTH }}>
              {createError}
            </text>
          </div>
        )}
        {editingLive && live.notice && <ConfigNotice notice={live.notice} />}
        <TracksRow
          turns={turns}
          subagents={
            <SubagentPill
              rows={subagentRows}
              busyRows={busyRows}
              detachEnabled={detachEnabled}
              onView={viewSubagent}
              onArchive={archiveSubagentRow}
              onDetach={detachSubagentRow}
            />
          }
        />
        <Composer
          value={draft}
          onChange={(next) => {
            setDraft(next)
            if (createError) setCreateError(null)
          }}
          onSend={(text) => void submitDraft('send', text)}
          onQueue={(text) => void submitDraft('queue', text)}
          onInterrupt={(text) => void submitDraft('interrupt', text)}
          parked={conversation.parked}
          onEditParked={editQueued}
          onSendParkedNow={sendParkedNow}
          onFocus={() => attention.engageComposer(activeId)}
          onBlur={() => attention.engageComposer(activeId)}
          disabledReason={disabledReason}
          chips={draftChips}
          commands={composerCommands}
          canStop={agentRunning}
          stopping={stopping}
          onStop={() => void stopAgent()}
          attachments={draftImages}
          onRemoveAttachment={(id) => setDraftImages((prev) => removeAttachment(prev, id))}
          onAttach={() => void pickAttachments()}
          onPastePayload={offerPaste}
          transientNotice={transientNotice}
          usageMeter={usageMeter}
          mentionSource={mentionSource}
        />
        <FooterBar
          cwd={activeEntry?.cwd ?? activeDraft?.cwd ?? cwd}
          cwdLocked={Boolean(activeEntry) || Boolean(activeDraft)}
          cwdOptions={[process.cwd(), ...cwdOptions]}
          onCwdChange={(dir) => {
            setCwd(dir)
            // A fresh directory selection mid-stack leaves no phantom future.
            setVisitHistory(truncateForward)
          }}
          worktree={activeDraft?.worktree ?? worktree}
          onWorktreeChange={(next) => {
            if (activeTab && activeDraft) {
              dispatchTabs({ type: 'setDraftWorktree', tabId: activeTab.id, worktree: next as 'local' | 'worktree' })
            } else {
              setWorktree(next)
            }
          }}
          statusColor={
            activeEntry
              ? agentStatusColor(activeEntry)
              : status === 'connected'
                ? C.running
                : status === 'connecting'
                  ? C.warn
                  : C.danger
          }
        />
        {paletteOpen && <CommandPaletteView registry={registry} onClose={closePalette} />}
      </div>
    </div>
  )
}

const isEntryPoint =
  typeof Bun !== 'undefined'
    ? Bun.isStandaloneExecutable || Bun.main === import.meta.path
    : process.argv[1]?.endsWith('chat.tsx')

if (isEntryPoint) {
  render(<ChatApp />, {
    title: 'Paseo',
    width: 1180,
    height: 820,
    titlebarTransparent: true,
    windowBackground: 'blurred',
    trafficLightX: 16,
    trafficLightY: 17,
    onEvent: dispatchWindowEvent,
  })
}
