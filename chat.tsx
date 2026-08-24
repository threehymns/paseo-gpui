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
import {
  DAEMON_URL,
  applyAgentUpdate,
  basename,
  createDaemonClient,
  displayName,
  errorMessage,
  findModel,
  sortAgents,
  type AgentEntry,
  type ConnStatus,
} from './paseo'
import { C, CONTENT_MAX_WIDTH, SIDEBAR_WIDTH } from './theme'
import { Sidebar, Header, CenterMessage, agentStatusColor, daemonHost } from './chrome'
import { Transcript } from './transcript'
import { ModelPicker, OptionPicker, modeOptions, thinkingOptions } from './pickers'
import { Composer, FooterBar } from './composer'
import { useAgentConversation } from './conversation'
import { useDraftConfig } from './draft-config'

// ---- daemon hooks ----------------------------------------------------------

interface DaemonView {
  client: PaseoClient
  status: ConnStatus
  error: string | null
  agents: AgentEntry[]
  providers: ProviderEntry[]
}

function useDaemon(): DaemonView {
  const [client] = useState(createDaemonClient)
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
      const sort = [{ key: 'updated_at' as const, direction: 'desc' as const }]
      const filter = { includeArchived: false }
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

  return { client, status, error, agents, providers }
}

// ---- app -------------------------------------------------------------------

export function ChatApp() {
  const daemon = useDaemon()
  const { client, status, error, agents, providers } = daemon

  const [activeId, setActiveId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [draft, setDraft] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingSeed, setPendingSeed] = useState<{ agentId: string; text: string } | null>(null)

  const { config: draftConfig, setModel: setModelValue, setThinking: setThinkingId, setMode: setModeId } = useDraftConfig(providers)
  const modelValue = draftConfig.modelValue
  const thinkingId = draftConfig.thinkingId
  const modeId = draftConfig.modeId
  const [cwd, setCwd] = useState(process.cwd())
  const [cwdOptions, setCwdOptions] = useState<string[]>([])
  const [worktree, setWorktree] = useState('local')

  const conversation = useAgentConversation(client, activeId, {
    seedText: pendingSeed && pendingSeed.agentId === activeId ? pendingSeed.text : null,
    onSeedConsumed: () => setPendingSeed(null),
  })
  const turns = conversation.turns
  const activeEntry = agents.find((entry) => entry.id === activeId) ?? null

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

  const draftChips = (
    <>
      <ModelPicker providers={providers} value={modelValue} onChange={setModelValue} />
      <OptionPicker
        value={thinkingId}
        onChange={setThinkingId}
        options={thinkingOptions(modelDef)}
        icon="zap"
        sectionLabel="Reasoning"
        fallbackLabel="Reasoning"
      />
      <OptionPicker
        value={modeId}
        onChange={setModeId}
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
        ) : visibleTurns.length === 0 ? (
          <CenterMessage
            title={activeId ? 'Starting agent…' : 'New task'}
            detail={
              activeId
                ? undefined
                : `Pick a model, then describe what to build in ${basename(cwd)}.`
            }
          />
        ) : (
          <Transcript turns={visibleTurns} listRef={listRef} />
        )}
        {createError && (
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', paddingBottom: 4 }}>
            <text style={{ fontSize: 12, color: C.danger, width: CONTENT_MAX_WIDTH }}>
              {createError}
            </text>
          </div>
        )}
        <Composer
          value={draft}
          onChange={(next) => {
            setDraft(next)
            if (createError) setCreateError(null)
          }}
          onSend={send}
          disabledReason={disabledReason}
          chips={draftChips}
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
