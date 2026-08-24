/**
 * A Paseo client, rendered natively on the GPU.
 *
 * Layout, palette, and chrome follow https://github.com/egoist/waku:
 * transparent titlebar, traffic lights in the sidebar, graphite surfaces,
 * composer chips, and the workspace footer. All data is live from a Paseo
 * daemon (https://github.com/getpaseo/paseo) over WebSocket.
 *
 * Run with:        bun --hot chat.tsx
 * Remote daemon:   PASEO_URL=wss://host/ws PASEO_PASSWORD=... bun --hot chat.tsx
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  motion,
  render,
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  useGpuix,
  type StyleDesc,
} from '@gpuix/react'
import { SafeMdxRenderer } from 'safe-mdx'
import { mdxParse } from 'safe-mdx/parse'
import type { Root } from 'mdast'
import type { PaseoAgentConfig, PaseoClient } from '@getpaseo/client'
import iconCompose from './assets/icons/compose.svg' with { type: 'file' }
import iconSearch from './assets/icons/search.svg' with { type: 'file' }
import iconSidebar from './assets/icons/panel-left.svg' with { type: 'file' }
import iconPanelRight from './assets/icons/panel-right.svg' with { type: 'file' }
import iconArrowLeft from './assets/icons/arrow-left.svg' with { type: 'file' }
import iconArrowRight from './assets/icons/arrow-right.svg' with { type: 'file' }
import iconFolder from './assets/icons/folder.svg' with { type: 'file' }
import iconSettings from './assets/icons/settings.svg' with { type: 'file' }
import iconGitBranch from './assets/icons/git-branch.svg' with { type: 'file' }
import iconLaptop from './assets/icons/laptop.svg' with { type: 'file' }
import iconLock from './assets/icons/lock.svg' with { type: 'file' }
import iconList from './assets/icons/list.svg' with { type: 'file' }
import iconZap from './assets/icons/zap.svg' with { type: 'file' }
import iconPencil from './assets/icons/pencil.svg' with { type: 'file' }
import iconChevronDown from './assets/icons/chevron-down.svg' with { type: 'file' }
import iconListFilter from './assets/icons/list-filter.svg' with { type: 'file' }
import iconSparkle from './assets/icons/sparkle.svg' with { type: 'file' }
import iconWrench from './assets/icons/wrench.svg' with { type: 'file' }
import iconSend from './assets/icons/arrow-up.svg' with { type: 'file' }
import iconCheck from './assets/icons/check.svg' with { type: 'file' }
import {
  DAEMON_URL,
  applyAgentUpdate,
  applyTimelineItem,
  basename,
  buildTurns,
  createDaemonClient,
  defaultModelValue,
  displayName,
  errorMessage,
  findModel,
  groupLabel,
  modelChoices,
  relativeTime,
  sortAgents,
  type AgentEntry,
  type ProviderEntry,
  type ProviderMode,
  type ProviderModel,
  type ToolName,
  type Turn,
} from './paseo'

const C = {
  canvas: '#1A1A1A',
  sidebar: '#181818',
  raised: '#232323',
  composer: '#212121',
  overlay: '#E6EAF20D',
  overlayStrong: '#E6EAF217',
  item: '#F0F0F00F',
  border: '#E6EAF212',
  borderStrong: '#E6EAF224',
  sidebarBorder: '#292929',
  text: '#E2E2E2',
  secondary: '#A3A3A3',
  tertiary: '#7D7D7D',
  ghost: '#575757',
  accent: '#E2795B',
  inverse: '#E7E9EC',
  onInverse: '#17181C',
  codeText: '#E0A882',
  ok: '#58B368',
  running: '#4C8DF6',
  warn: '#D9A050',
  danger: '#E5484D',
}

const SIDEBAR_WIDTH = 252
const TRAFFIC_LIGHT_CLEARANCE = process.platform === 'darwin' ? 86 : 8
const CONTENT_MAX_WIDTH = 720
const TITLEBAR_HEIGHT = 48

function realAssetPath(virtualPath: string): string {
  if (!virtualPath.includes('/$bunfs/')) return virtualPath
  const destDir = path.join(tmpdir(), 'gpuix-chat-assets')
  mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, path.basename(virtualPath))
  writeFileSync(dest, readFileSync(virtualPath))
  return dest
}

const ICONS = {
  compose: realAssetPath(iconCompose),
  search: realAssetPath(iconSearch),
  sidebar: realAssetPath(iconSidebar),
  panelRight: realAssetPath(iconPanelRight),
  arrowLeft: realAssetPath(iconArrowLeft),
  arrowRight: realAssetPath(iconArrowRight),
  folder: realAssetPath(iconFolder),
  settings: realAssetPath(iconSettings),
  gitBranch: realAssetPath(iconGitBranch),
  laptop: realAssetPath(iconLaptop),
  lock: realAssetPath(iconLock),
  list: realAssetPath(iconList),
  zap: realAssetPath(iconZap),
  pencil: realAssetPath(iconPencil),
  chevronDown: realAssetPath(iconChevronDown),
  listFilter: realAssetPath(iconListFilter),
  sparkle: realAssetPath(iconSparkle),
  wrench: realAssetPath(iconWrench),
  send: realAssetPath(iconSend),
  check: realAssetPath(iconCheck),
} as const

type IconName = keyof typeof ICONS

function Icon({ name, size = 14, color }: { name: IconName; size?: number; color: string }) {
  return <svg src={ICONS[name]} style={{ width: size, height: size, flexShrink: 0, color }} />
}

const TOOL_ICONS: Record<ToolName, IconName> = {
  bash: 'wrench',
  read: 'search',
  edit: 'pencil',
  write: 'pencil',
  search: 'search',
  fetch: 'zap',
  worktree: 'gitBranch',
  subagent: 'sparkle',
  plan: 'list',
  generic: 'wrench',
}

const CHAT_THEME = {
  text: C.text,
  textMuted: C.secondary,
  textFaint: C.tertiary,
  textDim: C.secondary,
  border: C.border,
  bg: C.canvas,
  accent: C.accent,
  caret: C.accent,
  fontSans: '.SystemUIFont',
  codeText: C.codeText,
  codeWash: '#E6EAF214',
  metrics: {
    mdTextSize: 14,
    mdLineHeight: 22,
    mdBlockGap: 14,
    mdHeadingSizes: [20, 16, 14, 14],
    mdHeadingLineHeights: [28, 24, 22, 22],
    codeTextSize: 12.5,
    codeLineHeight: 20,
    codeRadius: 10,
    codeHeaderTextSize: 12,
    diffLineHeight: 20,
    diffFileHeaderHeight: 34,
  },
}

function oneLine(text: string | undefined, limit = 140): string | undefined {
  if (!text) return undefined
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat || undefined
}

// ---- daemon hooks ----------------------------------------------------------

type ConnStatus = 'connecting' | 'connected' | 'error'

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

function useAgentTurns(client: PaseoClient, agentId: string | null): Turn[] {
  const [turns, setTurns] = useState<Turn[]>([])

  useEffect(() => {
    setTurns([])
    if (!agentId) return
    let disposed = false
    let unsub: (() => void) | undefined
    ;(async () => {
      try {
        const handle = client.agents.ref(agentId)
        const page = await handle.timeline.refetch({ direction: 'tail', limit: 300 })
        if (disposed) return
        setTurns(buildTurns(page.entries.map((entry) => entry.item)))
        unsub = handle.timeline.subscribe(({ event }) => {
          if (event.type === 'timeline') {
            setTurns((prev) => applyTimelineItem(prev, event.item))
          } else if (event.type === 'turn_failed') {
            setTurns((prev) =>
              applyTimelineItem(prev, { type: 'error', message: event.error }),
            )
          }
        })
      } catch {
        /* the agent may have been archived while we were opening it */
      }
    })()
    return () => {
      disposed = true
      unsub?.()
    }
  }, [client, agentId])

  return turns
}

// ---- chrome ----------------------------------------------------------------

function IconButton({
  icon,
  onClick,
  dimmed,
  size = 14,
  testId,
}: {
  icon: IconName
  onClick?: () => void
  dimmed?: boolean
  size?: number
  testId?: string
}) {
  return (
    <div
      testId={testId}
      style={{
        width: 26,
        height: 26,
        flexShrink: 0,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        opacity: dimmed ? 0.35 : 1,
        hover: dimmed ? undefined : { backgroundColor: C.overlay },
        active: dimmed ? undefined : { backgroundColor: C.overlayStrong },
      }}
      onClick={onClick}
    >
      <Icon name={icon} size={size} color={C.tertiary} />
    </div>
  )
}

function StatusDot({ color, size = 7 }: { color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        flexShrink: 0,
      }}
    />
  )
}

function agentStatusColor(entry: AgentEntry): string {
  if (entry.requiresAttention) return C.accent
  switch (entry.status) {
    case 'running':
      return C.running
    case 'initializing':
      return C.warn
    case 'error':
      return C.danger
    case 'closed':
      return C.ghost
    default:
      return C.ok
  }
}

function SidebarAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName
  label: string
  onClick?: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: 32,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: 7,
        cursor: 'pointer',
        hover: { backgroundColor: C.item },
        active: { backgroundColor: C.overlayStrong },
      }}
      onClick={onClick}
    >
      <div
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={14} color={C.secondary} />
      </div>
      <text style={{ fontSize: 13, color: C.secondary }}>{label}</text>
    </div>
  )
}

function AgentRow({
  entry,
  active,
  onSelect,
}: {
  entry: AgentEntry
  active: boolean
  onSelect: (id: string) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 7,
        paddingBottom: 7,
        borderRadius: 7,
        cursor: 'pointer',
        backgroundColor: active ? C.item : '#00000000',
        hover: { backgroundColor: C.item },
      }}
      onClick={() => onSelect(entry.id)}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <text
          style={{
            fontSize: 13.5,
            lineHeight: 18,
            color: C.text,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            minWidth: 0,
            flexGrow: 1,
          }}
        >
          {displayName(entry)}
        </text>
        {(entry.status === 'running' || entry.requiresAttention || entry.status === 'error') && (
          <StatusDot color={agentStatusColor(entry)} />
        )}
        <text style={{ fontSize: 12.5, color: C.ghost, flexShrink: 0 }}>{relativeTime(entry)}</text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Icon name="folder" size={12.5} color={C.tertiary} />
        <text
          style={{
            fontSize: 13,
            lineHeight: 15,
            color: C.tertiary,
            flexGrow: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {basename(entry.cwd)}
        </text>
        <text style={{ fontSize: 11.5, color: C.ghost, flexShrink: 0 }}>
          {entry.model ?? entry.provider}
        </text>
      </div>
    </div>
  )
}

function Sidebar({
  agents,
  activeId,
  onSelect,
  onNewTask,
  onCollapse,
  status,
}: {
  agents: AgentEntry[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewTask: () => void
  onCollapse: () => void
  status: ConnStatus
}) {
  const groups = useMemo(() => {
    const out: { name: string; items: AgentEntry[] }[] = []
    for (const entry of sortAgents(agents)) {
      const name = groupLabel(entry)
      const last = out[out.length - 1]
      if (last && last.name === name) last.items.push(entry)
      else out.push({ name, items: [entry] })
    }
    return out
  }, [agents])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        height: '100%',
        backgroundColor: C.sidebar,
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          height: TITLEBAR_HEIGHT,
          flexShrink: 0,
        }}
      >
        <div style={{ width: TRAFFIC_LIGHT_CLEARANCE, height: '100%', flexShrink: 0 }} />
        <IconButton icon="sidebar" size={16} testId="sidebar-collapse" onClick={onCollapse} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            marginLeft: 6,
          }}
        >
          <IconButton icon="arrowLeft" dimmed />
          <IconButton icon="arrowRight" dimmed />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 10, paddingRight: 10 }}>
        <SidebarAction icon="compose" label="New Task" onClick={onNewTask} />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'scroll',
          paddingLeft: 10,
          paddingRight: 10,
        }}
      >
        {groups.map((group, groupIndex) => (
          <div
            key={group.name}
            style={{ display: 'flex', flexDirection: 'column', paddingBottom: 10 }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                height: 28,
                paddingLeft: 8,
                paddingRight: 8,
              }}
            >
              <text
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: C.secondary,
                  flexGrow: 1,
                  minWidth: 0,
                }}
              >
                {group.name}
              </text>
              {groupIndex === 0 && <Icon name="listFilter" size={14} color={C.secondary} />}
            </div>
            {group.items.map((entry) => (
              <AgentRow
                key={entry.id}
                entry={entry}
                active={entry.id === activeId}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <div style={{ padding: 14 }}>
            <text style={{ fontSize: 12.5, lineHeight: 17, color: C.tertiary }}>
              No agents yet. Start one from the composer.
            </text>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 40,
          flexShrink: 0,
          paddingLeft: 14,
          paddingRight: 10,
        }}
      >
        <StatusDot
          color={status === 'connected' ? C.ok : status === 'connecting' ? C.warn : C.danger}
          size={8}
        />
        <text style={{ fontSize: 12, color: C.tertiary, flexGrow: 1, minWidth: 0 }}>
          {daemonHost()}
        </text>
        <IconButton icon="settings" />
      </div>
    </div>
  )
}

function daemonHost(): string {
  try {
    return new URL(DAEMON_URL).host
  } catch {
    return DAEMON_URL
  }
}

// ---- transcript ------------------------------------------------------------

function UserTurn({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        width: '100%',
      }}
    >
      <div
        style={{
          maxWidth: 540,
          minWidth: 0,
          backgroundColor: C.raised,
          borderRadius: 12,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        <text style={{ fontSize: 14, lineHeight: 20, color: C.text, minWidth: 0, maxWidth: '100%' }}>
          {text}
        </text>
      </div>
    </div>
  )
}

const ROW_INNER_STYLE = { width: CONTENT_MAX_WIDTH, maxWidth: '100%' } as const
const ROW_STYLE = {
  display: 'flex',
  flexDirection: 'row',
  justifyContent: 'center',
  width: '100%',
  paddingTop: 8,
  paddingBottom: 8,
  paddingLeft: 20,
  paddingRight: 20,
} as const
const ROW_STYLE_FIRST = { ...ROW_STYLE, paddingTop: 22 } as const
const ROW_STYLE_LAST = { ...ROW_STYLE, paddingBottom: 22 } as const
const ROW_STYLE_ONLY = { ...ROW_STYLE, paddingTop: 22, paddingBottom: 22 } as const

function TranscriptRow({
  children,
  first,
  last,
}: {
  children: React.ReactNode
  first?: boolean
  last?: boolean
}) {
  const style = first && last ? ROW_STYLE_ONLY : first ? ROW_STYLE_FIRST : last ? ROW_STYLE_LAST : ROW_STYLE
  return (
    <div style={style}>
      <div style={ROW_INNER_STYLE}>{children}</div>
    </div>
  )
}

function ToolRow({ turn }: { turn: Extract<Turn, { kind: 'tool' }> }) {
  const icon = TOOL_ICONS[turn.tool]
  const detail = oneLine(turn.detail)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {turn.status === 'running' ? (
            <StatusDot color={C.running} size={7} />
          ) : turn.status === 'failed' ? (
            <StatusDot color={C.danger} size={7} />
          ) : (
            <Icon name="check" size={11} color={C.ghost} />
          )}
        </div>
        <Icon name={icon} size={12.5} color={C.tertiary} />
        <text style={{ fontSize: 13, fontWeight: 500, color: C.secondary, flexShrink: 0 }}>
          {turn.title}
        </text>
        {detail && (
          <text
            style={{
              fontSize: 13,
              color: C.tertiary,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              minWidth: 0,
              flexGrow: 1,
            }}
          >
            {detail}
          </text>
        )}
        {turn.status === 'failed' && (
          <text style={{ fontSize: 12, color: C.danger, flexShrink: 0 }}>failed</text>
        )}
      </div>
      {turn.patch && <diff patch={turn.patch} wordDiff theme={CHAT_THEME} />}
    </div>
  )
}

function ReasoningBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 8,
        width: '100%',
        minWidth: 0,
        borderLeftWidth: 2,
        borderLeftColor: C.borderStrong,
        paddingLeft: 10,
      }}
    >
      <text style={{ fontSize: 13, lineHeight: 19, color: C.tertiary, minWidth: 0, maxWidth: '100%' }}>
        {text.trim()}
      </text>
    </div>
  )
}

function TodoBlock({ items }: { items: { text: string; completed: boolean; active: boolean }[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        width: '100%',
        minWidth: 0,
        backgroundColor: C.raised,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: C.border,
        padding: 12,
      }}
    >
      {items.map((item, index) => (
        <div key={index} style={{ display: 'flex', flexDirection: 'row', gap: 9, minWidth: 0 }}>
          <text
            style={{
              fontSize: 13,
              lineHeight: 19,
              color: item.completed ? C.ok : item.active ? C.accent : C.ghost,
              flexShrink: 0,
            }}
          >
            {item.completed ? '✓' : item.active ? '●' : '○'}
          </text>
          <text
            style={{
              fontSize: 13.5,
              lineHeight: 19,
              color: item.completed ? C.tertiary : item.active ? C.text : C.secondary,
              minWidth: 0,
              maxWidth: '100%',
            }}
          >
            {item.text}
          </text>
        </div>
      ))}
    </div>
  )
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 9,
        width: '100%',
        minWidth: 0,
        backgroundColor: '#E5484D14',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#E5484D30',
        padding: 12,
      }}
    >
      <Icon name="zap" size={13} color={C.danger} />
      <text style={{ fontSize: 13.5, lineHeight: 19, color: C.text, minWidth: 0, maxWidth: '100%' }}>
        {text}
      </text>
    </div>
  )
}

const Transcript = memo(function Transcript({
  turns,
  listRef,
}: {
  turns: Turn[]
  listRef?: React.Ref<{ id: number }>
}) {
  return (
    <virtual-list
      ref={listRef}
      overdraw={240}
      estimatedItemHeight={220}
      style={{ flexGrow: 1, minHeight: 0, width: '100%' }}
    >
      {turns.map((turn, index) => (
        <TranscriptRow key={index} first={index === 0} last={index === turns.length - 1}>
          {turn.kind === 'user' && <UserTurn text={turn.text} />}
          {turn.kind === 'assistant' && <SafeMdxContent source={turn.source} />}
          {turn.kind === 'reasoning' && <ReasoningBlock text={turn.text} />}
          {turn.kind === 'tool' && <ToolRow turn={turn} />}
          {turn.kind === 'todo' && <TodoBlock items={turn.items} />}
          {turn.kind === 'error' && <ErrorBlock text={turn.text} />}
        </TranscriptRow>
      ))}
    </virtual-list>
  )
})

function CenterMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        flexGrow: 1,
        minHeight: 0,
      }}
    >
      <Icon name="sparkle" size={22} color={C.ghost} />
      <text style={{ fontSize: 15, fontWeight: 600, color: C.secondary }}>{title}</text>
      {detail && (
        <text style={{ fontSize: 13, lineHeight: 18, color: C.tertiary, textAlign: 'center' }}>
          {detail}
        </text>
      )}
    </div>
  )
}

function Header({
  collapsed,
  onExpand,
  title,
  entry,
}: {
  collapsed: boolean
  onExpand: () => void
  title: string
  entry: AgentEntry | null
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: TITLEBAR_HEIGHT,
        flexShrink: 0,
        paddingLeft: collapsed ? 0 : 14,
        paddingRight: 14,
        userSelect: 'none',
      }}
    >
      {collapsed && (
        <>
          <div style={{ width: TRAFFIC_LIGHT_CLEARANCE - 8, height: '100%', flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <IconButton icon="sidebar" testId="sidebar-expand" onClick={onExpand} />
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <IconButton icon="arrowLeft" dimmed />
              <IconButton icon="arrowRight" dimmed />
            </div>
          </div>
        </>
      )}
      <text
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: C.text,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          minWidth: 0,
          flexShrink: 1,
        }}
      >
        {title}
      </text>
      {entry?.requiresAttention && entry.attentionReason === 'permission' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
            height: 20,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: 10,
            backgroundColor: '#E2795B1A',
          }}
        >
          <StatusDot color={C.accent} size={6} />
          <text style={{ fontSize: 11.5, fontWeight: 500, color: C.accent }}>Needs approval</text>
        </div>
      )}
      {entry?.status === 'running' && !entry.requiresAttention && (
        <text style={{ fontSize: 12, fontWeight: 500, color: C.running, flexShrink: 0 }}>
          Working…
        </text>
      )}
      <div style={{ flexGrow: 1 }} />
      <IconButton icon="panelRight" />
    </div>
  )
}

// ---- pickers ---------------------------------------------------------------

const MENU = {
  minWidth: 220,
  paddingTop: 4,
  paddingBottom: 4,
  paddingLeft: 4,
  paddingRight: 4,
  backgroundColor: C.raised,
  borderWidth: 1,
  borderColor: C.borderStrong,
  borderRadius: 12,
} satisfies StyleDesc

interface MenuOption {
  id: string
  label: string
  description?: string
}

function MenuRow({
  label,
  description,
  selected,
  highlighted,
  hint,
}: {
  label: string
  description?: string
  selected: boolean
  highlighted: boolean
  hint?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        paddingTop: description ? 6 : 5,
        paddingBottom: description ? 6 : 5,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 7,
        backgroundColor: highlighted ? '#404040' : selected ? '#2C2C2C' : C.raised,
        hover: { backgroundColor: '#404040' },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
        <text
          style={{
            fontSize: 12.5,
            fontWeight: selected ? 600 : 500,
            color: C.text,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </text>
        {description && (
          <text style={{ fontSize: 12.5, lineHeight: 14, color: C.tertiary, paddingTop: 2 }}>
            {description}
          </text>
        )}
      </div>
      {hint && <text style={{ fontSize: 11.5, color: C.ghost, flexShrink: 0 }}>{hint}</text>}
      {selected && <Icon name="check" size={11} color={C.tertiary} />}
    </div>
  )
}

function ChipSelect({
  value,
  onChange,
  icon,
  label,
  caret = true,
  accent,
  menuWidth,
  children,
}: {
  value: string
  onChange: (next: string) => void
  icon: IconName
  label: string
  caret?: boolean
  accent?: boolean
  menuWidth?: number
  children: React.ReactNode
}) {
  return (
    <Select value={value} onValueChange={onChange} style={{ flexShrink: 0 }}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <SelectTrigger
          style={(state) => ({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 26,
            paddingLeft: 7,
            paddingRight: 7,
            borderRadius: 6,
            cursor: 'pointer',
            backgroundColor: state.open ? C.overlay : '#00000000',
            hover: { backgroundColor: C.overlay },
          })}
        >
          <Icon name={icon} size={12} color={accent ? C.accent : C.tertiary} />
          <text
            style={{
              fontSize: 13,
              lineHeight: 16,
              color: accent ? C.accent : C.secondary,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </text>
          {caret && <Icon name="chevronDown" size={10.5} color={C.ghost} />}
        </SelectTrigger>
        <SelectContent side="top" sideOffset={4} style={{ ...MENU, minWidth: menuWidth ?? 220 }}>
          {children}
        </SelectContent>
      </div>
    </Select>
  )
}

function ModelPicker({
  providers,
  value,
  onChange,
}: {
  providers: ProviderEntry[]
  value: string
  onChange: (next: string) => void
}) {
  const choices = useMemo(() => modelChoices(providers), [providers])
  const selected = choices.find((choice) => choice.value === value)

  const groups = useMemo(() => {
    const out: { name: string; items: typeof choices }[] = []
    for (const choice of choices) {
      const last = out[out.length - 1]
      if (last && last.name === choice.providerLabel) last.items.push(choice)
      else out.push({ name: choice.providerLabel, items: [choice] })
    }
    return out
  }, [choices])

  return (
    <ChipSelect
      value={value}
      onChange={onChange}
      icon="sparkle"
      label={selected?.label ?? (choices.length > 0 ? 'Pick a model' : 'No models')}
      menuWidth={252}
    >
      {groups.map((group, index) => (
        <div key={group.name} style={{ display: 'flex', flexDirection: 'column' }}>
          {index > 0 && (
            <div style={{ height: 1, backgroundColor: C.border, marginTop: 4, marginBottom: 4 }} />
          )}
          <SelectLabel
            style={{
              height: 22,
              paddingLeft: 8,
              paddingRight: 8,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <text style={{ fontSize: 11.5, fontWeight: 500, color: C.ghost }}>{group.name}</text>
          </SelectLabel>
          {group.items.map((choice) => (
            <SelectItem key={choice.value} value={choice.value} textValue={choice.label}>
              {(state) => (
                <MenuRow
                  label={choice.label}
                  hint={choice.modelId}
                  selected={state.selected}
                  highlighted={state.highlighted}
                />
              )}
            </SelectItem>
          ))}
        </div>
      ))}
    </ChipSelect>
  )
}

function OptionPicker({
  value,
  onChange,
  options,
  icon,
  sectionLabel,
  fallbackLabel,
  menuWidth,
}: {
  value: string | null
  onChange: (next: string) => void
  options: MenuOption[]
  icon: IconName
  sectionLabel?: string
  fallbackLabel: string
  menuWidth?: number
}) {
  const selected = options.find((option) => option.id === value)
  if (options.length === 0) return null
  return (
    <ChipSelect
      value={value ?? ''}
      onChange={onChange}
      icon={icon}
      label={selected?.label ?? fallbackLabel}
      caret={false}
      menuWidth={menuWidth}
    >
      {sectionLabel && (
        <SelectLabel
          style={{
            height: 22,
            paddingLeft: 8,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <text style={{ fontSize: 11.5, fontWeight: 500, color: C.ghost }}>{sectionLabel}</text>
        </SelectLabel>
      )}
      {options.map((option) => (
        <SelectItem key={option.id} value={option.id} textValue={option.label}>
          {(state) => (
            <MenuRow
              label={option.label}
              description={option.description}
              selected={state.selected}
              highlighted={state.highlighted}
            />
          )}
        </SelectItem>
      ))}
    </ChipSelect>
  )
}

function modeOptions(modes: ProviderMode[] | undefined): MenuOption[] {
  return (modes ?? []).map((mode) => ({ id: mode.id, label: mode.label, description: mode.description }))
}

function thinkingOptions(model: ProviderModel | undefined): MenuOption[] {
  return (model?.thinkingOptions ?? []).map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description,
  }))
}

// ---- composer --------------------------------------------------------------

function Composer({
  value,
  onChange,
  onSend,
  disabledReason,
  chips,
}: {
  value: string
  onChange: (next: string) => void
  onSend: (text: string) => void
  disabledReason: string | null
  chips: React.ReactNode
}) {
  const ready = value.trim().length > 0 && !disabledReason
  const send = (text: string) => {
    const next = text.trim()
    if (!next || disabledReason) return
    onSend(next)
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
        paddingLeft: 20,
        paddingRight: 20,
        overflow: 'visible',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH,
          overflow: 'visible',
          backgroundColor: C.composer,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: C.border,
          paddingTop: 10,
          paddingBottom: 10,
        }}
      >
        <textarea
          testId="composer"
          value={value}
          placeholder="Describe a task for your agent..."
          minRows={1}
          maxRows={3}
          autoFocus
          theme={CHAT_THEME}
          style={{
            width: '100%',
            minWidth: 0,
            fontSize: 14,
            lineHeight: 20,
            color: C.text,
            backgroundColor: '#00000000',
            borderWidth: 0,
            paddingLeft: 10,
            paddingRight: 10,
          }}
          onChange={(event) => onChange(event.value ?? '')}
          onSubmit={(event) => send(event.value ?? value)}
        />
        {disabledReason && (
          <text
            style={{
              fontSize: 12,
              color: C.warn,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 6,
            }}
          >
            {disabledReason}
          </text>
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginTop: 8,
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          {chips}
          <div style={{ flexGrow: 1 }} />
          <div
            testId="send"
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: ready ? 'pointer' : undefined,
              backgroundColor: ready ? C.inverse : C.overlayStrong,
              hover: ready ? { opacity: 0.9 } : undefined,
            }}
            onClick={() => send(value)}
          >
            <Icon name="send" size={16} color={ready ? C.onInverse : C.ghost} />
          </div>
        </div>
      </div>
    </div>
  )
}

function FooterBar({
  cwd,
  cwdLocked,
  cwdOptions,
  onCwdChange,
  worktree,
  onWorktreeChange,
  statusColor,
}: {
  cwd: string
  cwdLocked: boolean
  cwdOptions: string[]
  onCwdChange: (next: string) => void
  worktree: string
  onWorktreeChange: (next: string) => void
  statusColor: string
}) {
  const cwdChoices = useMemo(
    () => [...new Set([cwd, ...cwdOptions])].filter(Boolean),
    [cwd, cwdOptions],
  )
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 4,
        paddingBottom: 8,
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH,
          height: 28,
          paddingLeft: 10,
          paddingRight: 10,
        }}
      >
        {cwdLocked ? (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Icon name="folder" size={12} color={C.tertiary} />
            <text
              style={{
                fontSize: 12.5,
                color: C.tertiary,
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {cwd}
            </text>
          </div>
        ) : (
          <>
            <OptionPicker
              value={cwd}
              onChange={onCwdChange}
              options={cwdChoices.map((dir) => ({ id: dir, label: basename(dir), description: dir }))}
              icon="folder"
              fallbackLabel="Choose folder"
              menuWidth={320}
            />
            <OptionPicker
              value={worktree}
              onChange={onWorktreeChange}
              options={[
                { id: 'local', label: 'Local' },
                { id: 'worktree', label: 'New worktree' },
              ]}
              icon={worktree === 'worktree' ? 'gitBranch' : 'laptop'}
              sectionLabel="Work in"
              fallbackLabel="Local"
            />
          </>
        )}
        <div style={{ flexGrow: 1 }} />
        <StatusDot color={statusColor} size={8} />
      </div>
    </div>
  )
}

// ---- markdown --------------------------------------------------------------

type MdxChildren = { children?: React.ReactNode }

function flattenMdxTable(children: React.ReactNode): {
  cols: number
  cells: React.ReactElement[]
} {
  const rows: React.ReactElement[][] = []
  React.Children.forEach(children, (section) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(section)) return
    React.Children.forEach(section.props.children, (row) => {
      if (!React.isValidElement<{ children?: React.ReactNode }>(row)) return
      const cells: React.ReactElement[] = []
      React.Children.forEach(row.props.children, (cell) => {
        if (React.isValidElement(cell)) cells.push(cell)
      })
      if (cells.length > 0) rows.push(cells)
    })
  })
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const cells: React.ReactElement[] = []
  for (const [rowIndex, row] of rows.entries()) {
    for (let col = 0; col < cols; col++) {
      const cell = row[col]
      cells.push(
        cell
          ? React.cloneElement(cell, { key: `${rowIndex}-${col}` })
          : <div key={`pad-${rowIndex}-${col}`} />,
      )
    }
  }
  return { cols, cells }
}

function MdxCell({ children, header }: MdxChildren & { header?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'nowrap',
        padding: 8,
        minWidth: 96,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        backgroundColor: C.canvas,
        fontSize: 15,
        lineHeight: 26,
        fontWeight: header ? 700 : 400,
        color: C.text,
      }}
    >
      {children}
    </div>
  )
}

function MdxBlock({ children }: MdxChildren) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', minWidth: 0 }}>
      {children}
    </div>
  )
}

const MD_TEXT = {
  fontSize: 15,
  lineHeight: 26,
  color: C.text,
  maxWidth: '100%',
  minWidth: 0,
} as const

function MdxInline({ children, style }: MdxChildren & { style?: StyleDesc }) {
  return <text style={{ ...MD_TEXT, ...style }}>{children}</text>
}

function mdxStringChild(children: React.ReactNode) {
  const items = React.Children.toArray(children)
  if (items.length === 1 && (typeof items[0] === 'string' || typeof items[0] === 'number')) {
    return items[0]
  }
  return null
}

function MdxParagraph({ children }: MdxChildren) {
  const only = mdxStringChild(children)
  if (only != null) {
    return <text style={{ ...MD_TEXT, width: '100%' }}>{only}</text>
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'start',
        width: '100%',
        minWidth: 0,
        fontSize: 15,
        lineHeight: 26,
        color: C.text,
      }}
    >
      {React.Children.map(children, (child) =>
        typeof child === 'string' || typeof child === 'number' ? (
          <text style={MD_TEXT}>{child}</text>
        ) : (
          child
        ),
      )}
    </div>
  )
}

const SAFE_MDX_COMPONENTS = {
  h1: ({ children }: MdxChildren) => (
    <text style={{ fontSize: 22, lineHeight: 30, fontWeight: 700, color: C.text, maxWidth: '100%', minWidth: 0 }}>
      {children}
    </text>
  ),
  h2: ({ children }: MdxChildren) => (
    <text style={{ fontSize: 18, lineHeight: 26, fontWeight: 700, color: C.text, maxWidth: '100%', minWidth: 0 }}>
      {children}
    </text>
  ),
  h3: ({ children }: MdxChildren) => (
    <text style={{ fontSize: 16, lineHeight: 24, fontWeight: 700, color: C.text, maxWidth: '100%', minWidth: 0 }}>
      {children}
    </text>
  ),
  h4: MdxInline,
  h5: MdxInline,
  h6: MdxInline,
  p: MdxParagraph,
  blockquote: ({ children }: MdxChildren) => (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 12, width: '100%', minWidth: 0 }}>
      <div style={{ width: 3, flexShrink: 0, backgroundColor: C.accent }} />
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 6, color: C.secondary }}>
        {children}
      </div>
    </div>
  ),
  hr: () => <div style={{ height: 1, width: '100%', backgroundColor: C.border }} />,
  ul: MdxBlock,
  ol: MdxBlock,
  li: ({
    children,
    'data-checked': checked,
  }: MdxChildren & { 'data-checked'?: boolean }) => {
    const only = mdxStringChild(children)
    return (
      <div style={{ display: 'flex', flexDirection: 'row', gap: 9, width: '100%', minWidth: 0 }}>
        <text style={{ fontSize: 15, lineHeight: 26, color: C.secondary, flexShrink: 0 }}>
          {checked === undefined ? '•' : checked ? '✓' : '○'}
        </text>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          {only != null ? <text style={{ ...MD_TEXT, width: '100%' }}>{only}</text> : children}
        </div>
      </div>
    )
  },
  strong: ({ children }: MdxChildren) => <MdxInline style={{ fontWeight: 700 }}>{children}</MdxInline>,
  em: ({ children }: MdxChildren) => <MdxInline style={{ color: C.secondary }}>{children}</MdxInline>,
  del: ({ children }: MdxChildren) => <MdxInline style={{ color: C.ghost }}>{children}</MdxInline>,
  code: ({ children }: MdxChildren) => (
    <MdxInline
      style={{
        fontFamily: 'Menlo',
        fontSize: 13,
        backgroundColor: C.raised,
        borderRadius: 5,
        paddingLeft: 5,
        paddingRight: 5,
      }}
    >
      {children}
    </MdxInline>
  ),
  a: ({ children }: MdxChildren & { href?: string }) => (
    <MdxInline style={{ color: C.accent }}>{children}</MdxInline>
  ),
  table: ({ children }: MdxChildren) => {
    const { cols, cells } = flattenMdxTable(children)
    if (cols === 0) return null
    return (
      <div style={{ display: 'flex', width: '100%', minWidth: 0, overflowX: 'scroll' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: cols,
            gridColumnMin: 'max-content',
            flexShrink: 0,
            backgroundColor: C.border,
            rowGap: 1,
            columnGap: 1,
          }}
        >
          {cells}
        </div>
      </div>
    )
  },
  thead: MdxBlock,
  tbody: MdxBlock,
  tr: ({ children }: MdxChildren) => <>{children}</>,
  th: ({ children }: MdxChildren) => <MdxCell header>{children}</MdxCell>,
  td: ({ children }: MdxChildren) => <MdxCell>{children}</MdxCell>,
}

const mdxCache = new Map<string, Root>()

function parseMdx(source: string) {
  const cached = mdxCache.get(source)
  if (cached) return cached
  const tree = mdxParse(source)
  mdxCache.set(source, tree)
  return tree
}

export function SafeMdxContent({ source }: { source: string }) {
  const mdast = useMemo(() => parseMdx(source), [source])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', minWidth: 0 }}>
      <SafeMdxRenderer
        markdown={source}
        mdast={mdast}
        components={SAFE_MDX_COMPONENTS}
        renderNode={(node) => {
          if (node.type !== 'code') return undefined
          return (
            <code
              code={node.value}
              language={node.lang ?? undefined}
              showLineNumbers
              theme={CHAT_THEME}
            />
          )
        }}
      />
    </div>
  )
}

// ---- app -------------------------------------------------------------------

export function ChatApp() {
  const daemon = useDaemon()
  const { client, status, error, agents, providers } = daemon

  const [activeId, setActiveId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [seeds, setSeeds] = useState<{ agentId: string | null; text: string }[]>([])

  const [modelValue, setModelValue] = useState('')
  const [thinkingId, setThinkingId] = useState<string | null>(null)
  const [modeId, setModeId] = useState<string | null>(null)
  const [cwd, setCwd] = useState(process.cwd())
  const [cwdOptions, setCwdOptions] = useState<string[]>([])
  const [worktree, setWorktree] = useState('local')

  const turns = useAgentTurns(client, activeId)
  const activeEntry = agents.find((entry) => entry.id === activeId) ?? null

  useEffect(() => {
    if (modelValue && findModel(providers, modelValue).choice) return
    setModelValue(defaultModelValue(providers) ?? '')
  }, [providers, modelValue])

  const { entry: providerOfModel, model: modelDef } = useMemo(
    () => findModel(providers, modelValue),
    [providers, modelValue],
  )

  useEffect(() => {
    const think = thinkingOptions(modelDef)
    setThinkingId(modelDef?.defaultThinkingOptionId ?? think.find((o) => o.isDefault)?.id ?? think[0]?.id ?? null)
    setModeId(providerOfModel?.defaultModeId ?? providerOfModel?.modes?.[0]?.id ?? null)
  }, [providerOfModel?.provider, modelDef?.id])

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

  const visibleTurns = useMemo(() => {
    const out = [...turns]
    for (const seed of seeds) {
      if (seed.agentId !== activeId) continue
      if (turns.some((turn) => turn.kind === 'user' && turn.text === seed.text)) continue
      out.push({ kind: 'user', text: seed.text })
    }
    return out
  }, [turns, seeds, activeId])

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
    setSendError(null)
    try {
      if (activeId) {
        setSeeds((prev) => [...prev, { agentId: activeId, text }])
        await client.agents.ref(activeId).send(text)
        return
      }
      if (!modelValue) {
        setSendError('No provider model is ready yet.')
        return
      }
      const config: PaseoAgentConfig = { provider: modelValue }
      if (modeId) config.modeId = modeId
      if (thinkingId) config.thinkingOptionId = thinkingId
      const handle = await client.agents.create({
        config,
        cwd,
        prompt: text,
        ...(worktree === 'worktree' ? { git: { createWorktree: true } } : {}),
      })
      setSeeds((prev) => [...prev, { agentId: handle.id, text }])
      setActiveId(handle.id)
    } catch (err) {
      setSendError(errorMessage(err))
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
            setSendError(null)
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
        {sendError && (
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', paddingBottom: 4 }}>
            <text style={{ fontSize: 12, color: C.danger, width: CONTENT_MAX_WIDTH }}>
              {sendError}
            </text>
          </div>
        )}
        <Composer
          value={draft}
          onChange={(next) => {
            setDraft(next)
            if (sendError) setSendError(null)
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
