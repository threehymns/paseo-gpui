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
  applyAgentUpdate,
  basename,
  createDaemonClient,
  displayName,
  errorMessage,
  findModel,
  isArchived,
  sortAgents,
  type AgentEntry,
  type ConnStatus,
  type ProviderEntry,
} from './paseo'
import { C, CONTENT_MAX_WIDTH, SIDEBAR_WIDTH } from './theme'
import { Sidebar, Header, CenterMessage, agentStatusColor, daemonHost, type RowActionRef, type RowActionVerb } from './chrome'
import { Transcript } from './transcript'
import { ModelPicker, OptionPicker, modeOptions, thinkingOptions } from './pickers'
import { Composer, ConfigNotice, FooterBar } from './composer'
import { useAgentConversation } from './conversation'
import { useAgentPermissions } from './permissions'
import { useDraftConfig } from './draft-config'
import { liveTruth, useLiveAgentConfig, type DaemonTruth, type ProviderNotice } from './live-config'

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
      if (!disposed) setAgents(sortAgents(page.entries.map((entry) => entry.agent)))

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

export function ChatApp() {
  const { client, daemon, status, error, agents, providers } = useDaemon()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [draft, setDraft] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingSeed, setPendingSeed] = useState<{ agentId: string; text: string } | null>(null)

  const { config: draftConfig, setModel: setDraftModel, setThinking: setDraftThinking, setMode: setDraftMode } =
    useDraftConfig(providers)
  const [cwd, setCwd] = useState(process.cwd())
  const [cwdOptions, setCwdOptions] = useState<string[]>([])
  const [worktree, setWorktree] = useState('local')

  const conversation = useAgentConversation(client, activeId, {
    seedText: pendingSeed && pendingSeed.agentId === activeId ? pendingSeed.text : null,
    onSeedConsumed: () => setPendingSeed(null),
  })
  const turns = conversation.turns
  const permissions = useAgentPermissions(client, daemon, activeId)
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

  // The composer's stop control: enabled only while the open agent runs. From
  // click until the cancellation is confirmed — the agent leaving running via
  // the directory subscription — the control reflects that so double-clicks are
  // unambiguous.
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

  const visibleTurns = turns

  const listRef = useRef<{ id: number } | null>(null)
  const skipScroll = useRef(true)
  const { renderer } = useGpuix()

  useEffect(() => {
    if (skipScroll.current) {
      skipScroll.current = false
      return
    }
    const id = listRef.current?.id
    if (id == null || !renderer?.scrollToItem) return
    renderer.scrollToItem(id, visibleTurns.length - 1)
  }, [renderer, visibleTurns.length])

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || status !== 'connected') return
    setDraft('')
    setCreateError(null)
    if (activeId) {
      void conversation.send(text)
      return
    }
    if (!modelValue) {
      setCreateError('No provider model is ready yet.')
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
        ...(worktree === 'worktree' ? { git: { createWorktree: true } } : {}),
      })
      setPendingSeed({ agentId: handle.id, text })
      setActiveId(handle.id)
    } catch (err) {
      setCreateError(errorMessage(err))
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
        {status === 'error' ? (
          <CenterMessage
            title={`Cannot reach ${daemonHost()}`}
            detail={`${error}\n\nStart a daemon with: npm install -g @getpaseo/cli && paseo`}
          />
        ) : status === 'connecting' ? (
          <CenterMessage title={`Connecting to ${daemonHost()}…`} />
        ) : visibleTurns.length === 0 && permissions.cards.length === 0 ? (
          <CenterMessage
            title={activeId ? 'Starting agent…' : 'New task'}
            detail={
              activeId
                ? undefined
                : `Pick a model, then describe what to build in ${basename(cwd)}.`
            }
          />
        ) : (
          <Transcript
            turns={visibleTurns}
            permissions={permissions.cards}
            onRespond={permissions.respond}
            listRef={listRef}
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
        <Composer
          value={draft}
          onChange={(next) => {
            setDraft(next)
            if (createError) setCreateError(null)
          }}
          onSend={send}
          disabledReason={disabledReason}
          chips={draftChips}
          canStop={agentRunning}
          stopping={stopping}
          onStop={() => void stopAgent()}
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
