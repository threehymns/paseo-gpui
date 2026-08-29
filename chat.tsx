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

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, render, useGpuix } from '@gpuix/react'
import type { PaseoAgentConfig, PaseoClient } from '@getpaseo/client'
import type { DaemonClient } from '@getpaseo/client/internal/daemon-client'
import {
  DAEMON_URL,
  applyAgentPage,
  applyAgentUpdate,
  basename,
  createDaemonClient,
  displayName,
  errorMessage,
  findModel,
  isArchived,
  type AgentEntry,
  type ConnStatus,
  type ProviderEntry,
} from './paseo'
import {
  planAttachments,
  planPaste,
  removeAttachment,
  toSendImages,
  type AttachmentPlan,
  type ImageAttachment,
  type IncomingImage,
  type PastePayload,
} from './attachments'
import { C, CONTENT_MAX_WIDTH, SIDEBAR_WIDTH } from './theme'
import { Sidebar, Header, CenterMessage, agentStatusColor, daemonHost, type RowActionRef, type RowActionVerb } from './chrome'
import { Transcript } from './transcript'
import { ModelPicker, OptionPicker, modeOptions, thinkingOptions } from './pickers'
import { Composer, ConfigNotice, FooterBar, TracksRow } from './composer'
import { useAgentConversation } from './conversation'
import { useTranscriptFollow } from './follow'
import { useAgentPermissions } from './permissions'
import { useAttention, type NotificationBridge } from './attention'
import { useDraftConfig } from './draft-config'
import { contextMeter } from './usage'
import { liveTruth, useLiveAgentConfig, type DaemonTruth, type ProviderNotice } from './live-config'
import {
  providerSubagentsEnabled,
  selectTrackRows,
  subagentHasOlder,
  subagentLabel,
  subagentRowColor,
  subagentTurns,
  useSubagents,
} from './subagents'
import {
  SubagentLoadOlder,
  SubagentPill,
  SubagentViewerBar,
  type OpenSubagent,
} from './tracks-panel'
import { createAppStore, defaultStatePath, fileStateStorage } from './app-state'

// ---- daemon hooks ----------------------------------------------------------

interface DaemonView {
  client: PaseoClient
  daemon: DaemonClient
  status: ConnStatus
  error: string | null
  agents: AgentEntry[]
  providers: ProviderEntry[]
}

function useDaemon(): DaemonView {
  const [{ client, daemon }] = useState(createDaemonClient)
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [providers, setProviders] = useState<ProviderEntry[]>([])

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
      const sort = [{ key: 'updated_at' as const, direction: 'desc' as const }]
      const filter = { includeArchived: true }
      await client.agents.list({ scope: 'active', filter, sort, subscribe: {} })
      const page = await client.agents.list({ scope: 'active', filter, sort })
      // Merge, never replace: subscription updates may have advanced entries
      // while the page was in flight, and a wholesale swap would replay their
      // older snapshots over fresher truth.
      if (!disposed) setAgents((prev) => applyAgentPage(prev, page.entries.map((entry) => entry.agent)))

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

  return { client, daemon, status, error, agents, providers }
}

// ---- app -------------------------------------------------------------------

const NO_TRUTH: DaemonTruth = { modelValue: null, thinkingId: null, modeId: null }

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

export function ChatApp() {
  const { client, daemon, status, error, agents, providers } = useDaemon()
  const [store] = useState(createStateStore)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftImages, setDraftImages] = useState<ImageAttachment[]>([])
  const [attachNotice, setAttachNotice] = useState<{ text: string; tone: 'warn' | 'danger' } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingSeed, setPendingSeed] = useState<{ agentId: string; text: string; images: ImageAttachment[] } | null>(
    null,
  )

  const { config: draftConfig, setModel: setDraftModel, setThinking: setDraftThinking, setMode: setDraftMode } =
    useDraftConfig(providers)
  const seed = pendingSeed && pendingSeed.agentId === activeId ? pendingSeed : null
  const [cwd, setCwd] = useState(process.cwd())
  const [cwdOptions, setCwdOptions] = useState<string[]>([])
  const [worktree, setWorktree] = useState('local')

  const conversation = useAgentConversation(client, activeId, {
    seedText: seed?.text ?? null,
    seedImages: seed?.images ?? null,
    onSeedConsumed: () => setPendingSeed(null),
  })
  const turns = conversation.turns
  const permissions = useAgentPermissions(client, daemon, activeId)
  // No OS notifier exists in @gpuix yet, so delivery silently no-ops; the
  // payloads are ready for a runtime bridge — clicking one deep-links by
  // re-selecting notice.payload.agentId.
  const attentionBridge: NotificationBridge | null = null
  const attention = useAttention({ agents, activeId, serverId: daemonHost(), bridge: attentionBridge })
  const activeEntry = agents.find((entry) => entry.id === activeId) ?? null

  // An agent that vanished from the directory (deleted) or was archived can no
  // longer host a conversation — Paseo's own client redirects away in both cases.
  const activeEntryGone =
    activeId != null &&
    status === 'connected' &&
    agents.length > 0 &&
    !agents.some((entry) => entry.id === activeId && !isArchived(entry))
  useEffect(() => {
    if (activeEntryGone) setActiveId(null)
  }, [activeEntryGone])

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
  const archiveAgentRow = (id: string) => runRowAction('archive', id, () => daemon.archiveAgent(id))
  const deleteAgentRow = (id: string) => runRowAction('delete', id, () => daemon.deleteAgent(id))
  const renameAgentRow = (id: string, name: string) =>
    runRowAction('rename', id, () => daemon.updateAgent(id, { name }))

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
  const viewingSubagent = viewing?.kind === 'provider' ? viewing : null
  const providerTurns =
    viewingSubagent
      ? subagentTurns(subagents.state, viewingSubagent.parentAgentId, viewingSubagent.id)
      : []

  const viewSubagent = (target: OpenSubagent) => {
    if (target.kind === 'managed') {
      setActiveId(target.id)
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
  // A running agent is one provider's process, so only that provider's models apply.
  const chipProviders = useMemo(
    () => (activeEntry ? providers.filter((entry) => entry.provider === activeEntry.provider) : providers),
    [providers, activeEntry],
  )

  const { entry: providerOfModel, model: modelDef } = useMemo(
    () => findModel(providers, modelValue),
    [providers, modelValue],
  )

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

  useEffect(() => {
    if (status !== 'connected') return
    let disposed = false
    ;(async () => {
      try {
        const page = await client.workspaces.list()
        if (disposed) return
        const dirs = [
          ...new Set(
            page.entries
              .map((workspace) => workspace.workspaceDirectory ?? workspace.projectRootPath)
              .filter((dir): dir is string => Boolean(dir)),
          ),
        ]
        if (dirs.length > 0) setCwdOptions(dirs)
      } catch {
        /* workspace listing is best-effort */
      }
    })()
    return () => {
      disposed = true
    }
  }, [client, status])

  // The transcript area shows the parent conversation, or a provider
  // subagent's read-only timeline while it is open.
  const visibleTurns = turns
  const shownTurns = viewingSubagent ? providerTurns : visibleTurns

  // Older-history availability for the transcript's top edge: quiet while more
  // pages exist unrequested, a spinner while fetching, a marker once exhausted.
  const olderPages =
    conversation.status === 'ready' && visibleTurns.length > 0
      ? conversation.loadingHistory
        ? ('loading' as const)
        : conversation.hasOlder
          ? ('more' as const)
          : ('end' as const)
      : undefined

const listRef = useRef<{ id: number } | null>(null)
  const { renderer } = useGpuix()
  const { following, onScroll, requestJump, jumpToTurn } = useTranscriptFollow({
    listRef,
    turnCount: visibleTurns.length,
    // The final turn's identity, so a history page prepended above the viewport
    // (count grew, tail sat still) doesn't drag a following view back down.
    tailSignature: visibleTurns.length > 0 ? JSON.stringify(visibleTurns.at(-1)) : undefined,
    agentId: activeId,
    renderer,
    // HistoryHead occupies virtual-list slot 0 whenever older history does (or
    // may) exist upstream, so every turn row is shifted down by one.
    slotOffset: olderPages ? 1 : 0,
  })

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || status !== 'connected') return
    // Sending means the user is here: any attention on this agent can rest.
    attention.engageComposer(activeId)
    const stagedImages = draftImages
    const outgoing = toSendImages(stagedImages)
    // Chips clear immediately; a failed send restores them next to the text.
    setDraft('')
    setDraftImages([])
    setCreateError(null)
    setAttachNotice(null)
    if (activeId) {
      void conversation.send(text, stagedImages).then((ok) => {
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
    try {
      const config: PaseoAgentConfig = { provider: modelValue }
      if (modeId) config.modeId = modeId
      if (thinkingId) config.thinkingOptionId = thinkingId
      const handle = await client.agents.create({
        config,
        cwd,
        prompt: text,
        ...(outgoing.length > 0 ? { images: outgoing } : {}),
        ...(worktree === 'worktree' ? { git: { createWorktree: true } } : {}),
      })
      setPendingSeed({ agentId: handle.id, text, images: stagedImages })
      setActiveId(handle.id)
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
    if (!attachNotice) return
    const timer = setTimeout(() => setAttachNotice(null), 4_000)
    return () => clearTimeout(timer)
  }, [attachNotice])

  /** Stages an attach plan's chips and surfaces its inline notice, if any. */
  const applyPlan = (plan: AttachmentPlan) => {
    if (plan.images.length > 0) setDraftImages((prev) => [...prev, ...plan.images])
    if (plan.notice) {
      setAttachNotice({ text: plan.notice, tone: plan.images.length === 0 ? 'danger' : 'warn' })
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
      setAttachNotice({ text: 'Picking files needs a native dialog; attaching images is not supported yet.', tone: 'warn' })
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
    setAttachNotice(null)
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
    </>
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
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
          agents={agents}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id)
            setCreateError(null)
          }}
          onNewTask={() => setActiveId(null)}
          onCollapse={() => setCollapsed(true)}
          status={status}
          busyRows={busyRows}
          onArchive={archiveAgentRow}
          onDelete={deleteAgentRow}
          onRename={renameAgentRow}
          store={store}
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
        />
        {viewingSubagent && (
          <SubagentViewerBar
            label={subagentLabel(viewingRow) ?? 'Subagent'}
            statusColor={viewingRow ? subagentRowColor(viewingRow) : C.ghost}
            onBack={() => setViewing(null)}
          />
        )}
        {status === 'error' ? (
          <CenterMessage
            title={`Cannot reach ${daemonHost()}`}
            detail={`${error}\n\nStart a daemon with: npm install -g @getpaseo/cli && paseo`}
          />
        ) : status === 'connecting' ? (
          <CenterMessage title={`Connecting to ${daemonHost()}…`} />
        ) : shownTurns.length === 0 && (viewingSubagent || permissions.cards.length === 0) ? (
          <CenterMessage
            title={viewingSubagent ? 'Loading subagent…' : activeId ? 'Starting agent…' : 'New task'}
            detail={
              viewingSubagent || activeId
                ? undefined
                : `Pick a model, then describe what to build in ${basename(cwd)}.`
            }
          />
        ) : (
) : viewingSubagent ? (
          <>
            {subagentHasOlder(subagents.state, viewingSubagent.parentAgentId, viewingSubagent.id) && (
              <SubagentLoadOlder
                loading={subagents.loadingOlder}
                onClick={() =>
                  subagents.loadOlder(viewingSubagent.parentAgentId, viewingSubagent.id)
                }
              />
            )}
            <Transcript
              turns={shownTurns}
              permissions={[]}
              onRespond={undefined}
              onEditQueued={undefined}
              listRef={listRef}
            />
          </>
        ) : (
          <Transcript
            turns={visibleTurns}
            permissions={permissions.cards}
            onRespond={permissions.respond}
            onEditQueued={editQueued}
            listRef={listRef}
            olderPages={olderPages}
            onLoadOlder={conversation.loadHistory}
            detached={!following}
            onScroll={onScroll}
            onJumpToBottom={requestJump}
            onJumpToTurn={jumpToTurn}
          />
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
          onSend={send}
          onFocus={() => attention.engageComposer(activeId)}
          onBlur={() => attention.engageComposer(activeId)}
          disabledReason={disabledReason}
          chips={draftChips}
          attachments={draftImages}
          onRemoveAttachment={(id) => setDraftImages((prev) => removeAttachment(prev, id))}
          onAttach={() => void pickAttachments()}
          onPastePayload={offerPaste}
          attachNotice={attachNotice}
          usageMeter={usageMeter}
        />
        <FooterBar
          cwd={activeEntry?.cwd ?? cwd}
          cwdLocked={Boolean(activeEntry)}
          cwdOptions={[process.cwd(), ...cwdOptions]}
          onCwdChange={setCwd}
          worktree={worktree}
          onWorktreeChange={setWorktree}
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
  })
}
