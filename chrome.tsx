/**
 * Window chrome: icon plumbing, buttons, status dots, the agent directory
 * sidebar, the conversation header, and full-canvas center messages.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import React, { useMemo, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@gpuix/react'
import {
  DAEMON_URL,
  basename,
  relativeTimeAt,
  type AgentEntry,
  type ConnStatus,
  type WorkspaceDescriptor,
} from './paseo'
import {
  isArchivedWorkspace,
  workspaceActivityAt,
  workspaceDisplayName,
  workspaceDirectory,
  workspaceProjectGroups,
  type WorkspaceStore,
} from './workspaces'
import { showArchivedAgents, useAppState, type AppStore } from './app-state'
import { C, SIDEBAR_WIDTH, TITLEBAR_HEIGHT, TRAFFIC_LIGHT_CLEARANCE } from './theme'

function realAssetPath(virtualPath: string): string {
  if (!virtualPath.includes('/$bunfs/')) return virtualPath
  const destDir = path.join(tmpdir(), 'gpuix-chat-assets')
  mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, path.basename(virtualPath))
  writeFileSync(dest, readFileSync(virtualPath))
  return dest
}

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
import iconEllipsis from './assets/icons/ellipsis.svg' with { type: 'file' }
import iconArchive from './assets/icons/archive.svg' with { type: 'file' }
import iconListFilter from './assets/icons/list-filter.svg' with { type: 'file' }
import iconSparkle from './assets/icons/sparkle.svg' with { type: 'file' }
import iconWrench from './assets/icons/wrench.svg' with { type: 'file' }
import iconSend from './assets/icons/arrow-up.svg' with { type: 'file' }
import iconCheck from './assets/icons/check.svg' with { type: 'file' }
import iconScissors from './assets/icons/scissors.svg' with { type: 'file' }
import iconSquare from './assets/icons/square.svg' with { type: 'file' }
import iconImage from './assets/icons/image.svg' with { type: 'file' }
import iconX from './assets/icons/x.svg' with { type: 'file' }
import iconRotateCcw from './assets/icons/rotate-ccw.svg' with { type: 'file' }

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
  ellipsis: realAssetPath(iconEllipsis),
  archive: realAssetPath(iconArchive),
  listFilter: realAssetPath(iconListFilter),
  sparkle: realAssetPath(iconSparkle),
  wrench: realAssetPath(iconWrench),
  send: realAssetPath(iconSend),
  check: realAssetPath(iconCheck),
  scissors: realAssetPath(iconScissors),
  square: realAssetPath(iconSquare),
  image: realAssetPath(iconImage),
  x: realAssetPath(iconX),
  rotateCcw: realAssetPath(iconRotateCcw),
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color: string }) {
  return <svg src={ICONS[name]} style={{ width: size, height: size, flexShrink: 0, color }} />
}

export function IconButton({
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

export function StatusDot({ color, size = 7 }: { color: string; size?: number }) {
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

export function agentStatusColor(entry: AgentEntry): string {
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

export type RowActionVerb = 'rename' | 'archive' | 'delete' | 'detach'

/** One row lifecycle call in flight; every action on that row stays disabled until it settles. */
export interface RowActionRef {
  verb: RowActionVerb
  id: string
}

const VIEW_MENU_WIDTH = 232

/**
 * One decision row of the view menu: leading icon, label, and the engine's own
 * check when this is the current answer.
 */
function ViewOption({
  icon,
  label,
  selected,
}: {
  icon: IconName
  label: string
  selected: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        paddingTop: 5,
        paddingBottom: 5,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 7,
        hover: { backgroundColor: '#404040' },
      }}
    >
      <Icon name={icon} size={13} color={C.tertiary} />
      <text style={{ fontSize: 12.5, fontWeight: 500, color: C.text, flexGrow: 1, minWidth: 0 }}>
        {label}
      </text>
      {selected && <Icon name="check" size={11} color={C.secondary} />}
    </div>
  )
}

function ViewSection({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        height: 22,
        paddingLeft: 8,
      }}
    >
      <text style={{ fontSize: 11.5, fontWeight: 500, color: C.ghost }}>{label}</text>
    </div>
  )
}

/**
 * The sidebar's display-preferences popover, mirroring Paseo's: one trigger in
 * the section header and visibility toggles under Show. The directory itself
 * always renders as collapsible project groups of workspaces, so there is no
 * grouping choice anymore.
 */
function ViewPreferencesMenu({
  showArchived,
  onShowArchivedChange,
}: {
  showArchived: boolean
  onShowArchivedChange: (show: boolean) => void
}) {
  const runChoice = (choice: string) => {
    if (choice === 'show:archived') onShowArchivedChange(!showArchived)
  }

  return (
    <Select value="" onValueChange={runChoice}>
      <SelectTrigger
        testId="sidebar-view-menu"
        style={(state) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          flexShrink: 0,
          borderRadius: 6,
          cursor: 'pointer',
          backgroundColor: state.open ? C.overlay : '#00000000',
          hover: { backgroundColor: C.overlay },
        })}
      >
        <Icon name="listFilter" size={14} color={C.secondary} />
      </SelectTrigger>
      <SelectContent side="bottom" align="end" sideOffset={4} style={{ width: VIEW_MENU_WIDTH }}>
        <ViewSection label="Show" />
        <SelectItem value="show:archived" textValue="Archived workspaces">
          <ViewOption icon="archive" label="Archived workspaces" selected={showArchived} />
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

/** Sidebar dot color for a workspace's status bucket. */
export function workspaceStatusColor(status: WorkspaceDescriptor['status']): string {
  switch (status) {
    case 'running':
      return C.running
    case 'attention':
    case 'needs_input':
      return C.accent
    case 'failed':
      return C.danger
    case 'done':
      return C.ok
  }
}

function WorkspaceRow({
  descriptor,
  active,
  busy,
  onSelect,
  onRename,
  onArchive,
}: {
  descriptor: WorkspaceDescriptor
  active: boolean
  /** True while any lifecycle action on this row is in flight. */
  busy: boolean
  onSelect: (id: string) => void
  onRename: (id: string, name: string) => void
  onArchive: (id: string) => void
}) {
  const [hover, setHover] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const archived = isArchivedWorkspace(descriptor)
  const directory = workspaceDirectory(descriptor)
  const secondaryIcon = descriptor.workspaceKind === 'worktree' ? 'gitBranch' : 'folder'
  const secondaryLabel =
    descriptor.workspaceKind === 'worktree'
      ? (descriptor.worktreeSlug ?? basename(directory))
      : basename(directory)

  const startRename = () => {
    setNameDraft(workspaceDisplayName(descriptor))
    setRenaming(true)
  }

  /**
   * Empty or unchanged drafts cancel; anything else goes to the daemon. Runs at
   * most once per edit — blur after commit or cancel is ignored.
   */
  const commitRename = () => {
    if (!renaming) return
    setRenaming(false)
    const next = nameDraft.trim()
    if (busy || next.length === 0 || next === workspaceDisplayName(descriptor)) return
    onRename(descriptor.id, next)
  }

  const runAction = (action: RowActionVerb) => {
    if (busy) return
    if (action === 'rename') startRename()
    else onArchive(descriptor.id)
  }

  return (
    <div
      testId="workspace-row"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        paddingLeft: 8,
        paddingRight: 4,
        paddingTop: 7,
        paddingBottom: 7,
        borderRadius: 7,
        cursor: renaming ? 'default' : 'pointer',
        backgroundColor: active ? C.item : '#00000000',
        hover: renaming ? undefined : { backgroundColor: C.item },
        opacity: archived ? 0.55 : 1,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        if (!renaming) onSelect(descriptor.id)
      }}
    >
      {renaming ? (
        <input
          value={nameDraft}
          placeholder="Workspace name"
          autoFocus
          testId="workspace-rename"
          style={{
            flexGrow: 1,
            minWidth: 0,
            height: 20,
            fontSize: 13.5,
            color: C.text,
            backgroundColor: '#00000000',
            borderWidth: 0,
            padding: 0,
          }}
          onChange={(event) => setNameDraft(event.value ?? '')}
          onSubmit={commitRename}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'escape') setRenaming(false)
          }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <StatusDot color={workspaceStatusColor(descriptor.status)} />
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
            {workspaceDisplayName(descriptor)}
          </text>
          {hover ? (
            <Select value="" onValueChange={(action) => runAction(action as RowActionVerb)}>
              <SelectTrigger
                testId="workspace-row-menu"
                style={(state) => ({
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  borderRadius: 5,
                  cursor: 'pointer',
                  backgroundColor: state.open ? C.overlayStrong : '#00000000',
                })}
              >
                <Icon name="ellipsis" size={14} color={C.secondary} />
              </SelectTrigger>
              <SelectContent side="right" sideOffset={2} style={{ minWidth: 168 }}>
                <SelectItem value="rename" textValue="Rename">
                  <MenuAction label="Rename" disabled={busy} />
                </SelectItem>
                {!archived && (
                  <SelectItem value="archive" textValue="Archive">
                    <MenuAction label="Archive" disabled={busy} />
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          ) : workspaceActivityAt(descriptor) > 0 ? (
            <text style={{ fontSize: 12.5, color: C.ghost, flexShrink: 0 }}>
              {relativeTimeAt(workspaceActivityAt(descriptor))}
            </text>
          ) : null}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 13 }}>
        <Icon name={secondaryIcon} size={12.5} color={C.tertiary} />
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
          {secondaryLabel}
        </text>
      </div>
    </div>
  )
}

/** One row-action menu entry; danger rows carry their own tone. */
function MenuAction({ label, tone, disabled }: { label: string; tone?: 'danger'; disabled?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        paddingTop: 5,
        paddingBottom: 5,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 7,
        opacity: disabled ? 0.4 : 1,
        hover: disabled ? undefined : { backgroundColor: '#404040' },
      }}
    >
      <text style={{ fontSize: 12.5, fontWeight: 500, color: tone === 'danger' ? C.danger : C.text }}>
        {label}
      </text>
    </div>
  )
}

/** One collapsible project group header: chevron, name, click toggles its rows. */
function ProjectGroupHeader({
  name,
  collapsed,
  onToggle,
}: {
  name: string
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div
      testId="project-group-header"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 26,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 6,
        cursor: 'pointer',
        hover: { backgroundColor: C.overlay },
      }}
      onClick={onToggle}
    >
      <Icon name={collapsed ? 'arrowRight' : 'chevronDown'} size={11} color={C.ghost} />
      <text
        style={{
          fontSize: 12.5,
          color: C.tertiary,
          flexGrow: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </text>
    </div>
  )
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onNewTask,
  onCollapse,
  status,
  busyRows,
  onArchive,
  onRename,
  appStore,
}: {
  /** The whole workspace directory, written only by the daemon subscription. */
  workspaces: WorkspaceStore
  activeWorkspaceId: string | null
  onSelect: (id: string) => void
  onNewTask: () => void
  onCollapse: () => void
  status: ConnStatus
  /** Row lifecycle calls currently in flight. */
  busyRows: RowActionRef[]
  onArchive: (id: string) => void
  onRename: (id: string, name: string) => void
  /** Persisted app state; the sidebar's view choices survive a restart. */
  appStore: AppStore
}) {
  const [showArchived, setShowArchived] = useAppState(appStore, showArchivedAgents)
  // Collapse state is view state; the store itself stays daemon-written.
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(new Set())
  const groups = useMemo(() => workspaceProjectGroups(workspaces, showArchived), [workspaces, showArchived])
  const toggleProject = (projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

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
          flexDirection: 'row',
          alignItems: 'center',
          height: 30,
          flexShrink: 0,
          paddingLeft: 18,
          paddingRight: 12,
          marginTop: 6,
        }}
      >
        <text style={{ fontSize: 13, fontWeight: 500, color: C.secondary, flexGrow: 1, minWidth: 0 }}>
          Workspaces
        </text>
        <ViewPreferencesMenu showArchived={showArchived} onShowArchivedChange={setShowArchived} />
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
        {groups.map((group) => (
          <div
            key={group.projectId}
            style={{ display: 'flex', flexDirection: 'column', paddingBottom: 10 }}
          >
            <ProjectGroupHeader
              name={group.name}
              collapsed={collapsedProjects.has(group.projectId)}
              onToggle={() => toggleProject(group.projectId)}
            />
            {!collapsedProjects.has(group.projectId) &&
              group.workspaces.map((descriptor) => (
                <WorkspaceRow
                  key={descriptor.id}
                  descriptor={descriptor}
                  active={descriptor.id === activeWorkspaceId}
                  busy={busyRows.some((row) => row.id === descriptor.id)}
                  onSelect={onSelect}
                  onRename={onRename}
                  onArchive={onArchive}
                />
              ))}
          </div>
        ))}
        {groups.length === 0 && (
          <div style={{ padding: 14 }}>
            <text style={{ fontSize: 12.5, lineHeight: 17, color: C.tertiary }}>
              No workspaces yet. Start one from the composer.
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

export function daemonHost(): string {
  try {
    return new URL(DAEMON_URL).host
  } catch {
    return DAEMON_URL
  }
}

export function CenterMessage({ title, detail }: { title: string; detail?: string }) {
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

export function Header({
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
