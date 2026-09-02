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
  displayName,
  isArchived,
  relativeTime,
  relativeTimeAt,
  sortAgents,
  type AgentEntry,
  type ConnStatus,
  type WorkspaceDescriptor,
} from '../daemon/paseo'
import {
  isArchivedWorkspace,
  workspaceActivityAt,
  workspaceDisplayName,
  workspaceProjectGroups,
  type WorkspaceStore,
} from '../agent-directory/workspaces'
import {
  workspaceMetaLine,
  workspaceRowTitle,
  type MetaTone,
  type WorkspaceMetaChecks,
  type WorkspaceMetaItem,
  type WorkspaceMetaTrailing,
} from '../agent-directory/workspace-meta'
import {
  showArchivedAgents,
  showArchivedWorkspaces,
  useAppState,
  type AppStore,
} from '../app-state'
import { C, SIDEBAR_WIDTH, TITLEBAR_HEIGHT, TRAFFIC_LIGHT_CLEARANCE } from './theme'

function realAssetPath(virtualPath: string): string {
  if (!virtualPath.includes('/$bunfs/')) return virtualPath
  const destDir = path.join(tmpdir(), 'gpuix-chat-assets')
  mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, path.basename(virtualPath))
  writeFileSync(dest, readFileSync(virtualPath))
  return dest
}

import iconCompose from '../assets/icons/compose.svg' with { type: 'file' }
import iconSearch from '../assets/icons/search.svg' with { type: 'file' }
import iconSidebar from '../assets/icons/panel-left.svg' with { type: 'file' }
import iconPanelRight from '../assets/icons/panel-right.svg' with { type: 'file' }
import iconArrowLeft from '../assets/icons/arrow-left.svg' with { type: 'file' }
import iconArrowRight from '../assets/icons/arrow-right.svg' with { type: 'file' }
import iconFolder from '../assets/icons/folder.svg' with { type: 'file' }
import iconFile from '../assets/icons/file.svg' with { type: 'file' }
import iconGitBranch from '../assets/icons/git-branch.svg' with { type: 'file' }
import iconGitPullRequest from '../assets/icons/git-pull-request.svg' with { type: 'file' }
import iconTag from '../assets/icons/tag.svg' with { type: 'file' }

import iconLaptop from '../assets/icons/laptop.svg' with { type: 'file' }
import iconLock from '../assets/icons/lock.svg' with { type: 'file' }
import iconList from '../assets/icons/list.svg' with { type: 'file' }
import iconZap from '../assets/icons/zap.svg' with { type: 'file' }
import iconPencil from '../assets/icons/pencil.svg' with { type: 'file' }
import iconChevronDown from '../assets/icons/chevron-down.svg' with { type: 'file' }
import iconEllipsis from '../assets/icons/ellipsis.svg' with { type: 'file' }
import iconArchive from '../assets/icons/archive.svg' with { type: 'file' }
import iconListFilter from '../assets/icons/list-filter.svg' with { type: 'file' }
import iconSparkle from '../assets/icons/sparkle.svg' with { type: 'file' }
import iconWrench from '../assets/icons/wrench.svg' with { type: 'file' }
import iconSend from '../assets/icons/arrow-up.svg' with { type: 'file' }
import iconCheck from '../assets/icons/check.svg' with { type: 'file' }
import iconScissors from '../assets/icons/scissors.svg' with { type: 'file' }
import iconSquare from '../assets/icons/square.svg' with { type: 'file' }
import iconImage from '../assets/icons/image.svg' with { type: 'file' }
import iconX from '../assets/icons/x.svg' with { type: 'file' }
import iconRotateCcw from '../assets/icons/rotate-ccw.svg' with { type: 'file' }

const ICONS = {
  compose: realAssetPath(iconCompose),
  search: realAssetPath(iconSearch),
  sidebar: realAssetPath(iconSidebar),
  panelRight: realAssetPath(iconPanelRight),
  arrowLeft: realAssetPath(iconArrowLeft),
  arrowRight: realAssetPath(iconArrowRight),
  folder: realAssetPath(iconFolder),
  file: realAssetPath(iconFile),
  gitBranch: realAssetPath(iconGitBranch),
  gitPullRequest: realAssetPath(iconGitPullRequest),
  tag: realAssetPath(iconTag),
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
  showArchivedAgents,
  onShowArchivedAgentsChange,
}: {
  showArchived: boolean
  onShowArchivedChange: (show: boolean) => void
  showArchivedAgents: boolean
  onShowArchivedAgentsChange: (show: boolean) => void
}) {
  const runChoice = (choice: string) => {
    if (choice === 'show:archived') onShowArchivedChange(!showArchived)
    if (choice === 'show:archived-agents') onShowArchivedAgentsChange(!showArchivedAgents)
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
        <SelectItem value="show:archived-agents" textValue="Archived agents">
          <ViewOption icon="archive" label="Archived agents" selected={showArchivedAgents} />
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
  // The meta line resolves the row's whole second line from the descriptor's
  // runtime fields; slots without backing data are absent, and a line with
  // nothing at all renders nothing rather than dead space.
  const meta = workspaceMetaLine(descriptor)

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
            {workspaceRowTitle(descriptor)}
          </text>
          {hover ? (
            <OverflowMenu
              testId="workspace-row-menu"
              side="right"
              onAction={(action) => runAction(action as RowActionVerb)}
            >
              <SelectItem value="rename" textValue="Rename">
                <MenuAction label="Rename" disabled={busy} />
              </SelectItem>
              {!archived && (
                <SelectItem value="archive" textValue="Archive">
                  <MenuAction label="Archive" disabled={busy} />
                </SelectItem>
              )}
            </OverflowMenu>
          ) : workspaceActivityAt(descriptor) > 0 ? (
            <text style={{ fontSize: 12.5, color: C.ghost, flexShrink: 0 }}>
              {relativeTimeAt(workspaceActivityAt(descriptor))}
            </text>
          ) : null}
        </div>
      )}
      {(meta.items.length > 0 || meta.checks || meta.trailing) && (
        <div
          testId="workspace-row-meta"
          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 13 }}
        >
          {meta.items.map((item) => (
            <MetaItemView key={item.kind} item={item} />
          ))}
          {meta.checks && <MetaChecksView checks={meta.checks} />}
          <div style={{ flexGrow: 1 }} />
          {meta.trailing && <MetaTrailingView trailing={meta.trailing} />}
        </div>
      )}
    </div>
  )
}

/** Tone → palette; the pure meta seam stays theme-free, so the mapping lives here. */
function metaToneColor(tone: MetaTone): string {
  switch (tone) {
    case 'ok':
      return C.ok
    case 'warn':
      return C.warn
    case 'danger':
      return C.danger
    case 'accent':
      return C.accent
    default:
      return C.tertiary
  }
}

/**
 * One meta-line slot. The branch item is the only flexing one: it absorbs a
 * runaway branch name with its own ellipsis so the rest of the line and the
 * trailing slot keep their ground.
 */
function MetaItemView({ item }: { item: WorkspaceMetaItem }) {
  switch (item.kind) {
    case 'branch':
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          <Icon name="gitBranch" size={11.5} color={C.tertiary} />
          <text
            style={{
              fontSize: 12,
              lineHeight: 15,
              color: C.tertiary,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {item.text}
          </text>
          {item.dirty && <StatusDot color={C.warn} size={5} />}
          {item.aheadBehind && (
            <text style={{ fontSize: 11, lineHeight: 15, color: C.ghost, flexShrink: 0 }}>
              {item.aheadBehind}
            </text>
          )}
        </div>
      )
    case 'pullRequest':
      return (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Icon name="gitPullRequest" size={11.5} color={C.tertiary} />
          <text style={{ fontSize: 12, lineHeight: 15, color: C.tertiary, whiteSpace: 'nowrap' }}>
            {item.text}
          </text>
          {item.detail && (
            <text style={{ fontSize: 11, lineHeight: 15, color: metaToneColor(item.tone), whiteSpace: 'nowrap' }}>
              {item.detail}
            </text>
          )}
        </div>
      )
    case 'services':
      return (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Icon name="zap" size={11.5} color={C.tertiary} />
          <text style={{ fontSize: 12, lineHeight: 15, color: metaToneColor(item.tone), whiteSpace: 'nowrap' }}>
            {item.text}
          </text>
        </div>
      )
    default: {
      // Project, host, and labels are plain icon+text slots.
      const icon: IconName = item.kind === 'project' ? 'folder' : item.kind === 'host' ? 'laptop' : 'tag'
      return (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Icon name={icon} size={11.5} color={C.tertiary} />
          <text style={{ fontSize: 12, lineHeight: 15, color: C.tertiary, whiteSpace: 'nowrap' }}>
            {item.text}
          </text>
        </div>
      )
    }
  }
}

const CHECKS_ICON: Record<WorkspaceMetaChecks['status'], IconName> = {
  success: 'check',
  pending: 'rotateCcw',
  failure: 'x',
}

const CHECKS_COLOR: Record<WorkspaceMetaChecks['status'], string> = {
  success: C.ok,
  pending: C.warn,
  failure: C.danger,
}

/** The checks readout: one status-colored icon, plus its passed/total label when one resolved. */
function MetaChecksView({ checks }: { checks: WorkspaceMetaChecks }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <Icon name={CHECKS_ICON[checks.status]} size={11.5} color={CHECKS_COLOR[checks.status]} />
      {checks.label && (
        <text style={{ fontSize: 11, lineHeight: 15, color: C.ghost, whiteSpace: 'nowrap' }}>
          {checks.label}
        </text>
      )}
    </div>
  )
}

/**
 * The right-aligned trailing slot. Diff stats mirror the TracksRow pill's
 * `+n / -n` coloring with zero sides hidden; the activity alternative reads
 * the same relative time the title line shows.
 */
function MetaTrailingView({ trailing }: { trailing: WorkspaceMetaTrailing }) {
  if (trailing.kind === 'diffStat') {
    return (
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {trailing.additions > 0 && (
          <text style={{ fontSize: 11.5, lineHeight: 15, fontWeight: 500, color: C.ok, whiteSpace: 'nowrap' }}>
            {`+\u2060${trailing.additions}`}
          </text>
        )}
        {trailing.deletions > 0 && (
          <text style={{ fontSize: 11.5, lineHeight: 15, fontWeight: 500, color: C.danger, whiteSpace: 'nowrap' }}>
            {`-\u2060${trailing.deletions}`}
          </text>
        )}
      </div>
    )
  }
  return (
    <text style={{ fontSize: 11.5, lineHeight: 15, color: C.ghost, flexShrink: 0 }}>
      {relativeTimeAt(trailing.at)}
    </text>
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

/**
 * The shared overflow menu: a 20×20 ellipsis trigger with an open-state
 * background opening a minWidth-168 action sheet. Every row menu and the
 * conversation header's menu mount this; their actions are its Select items.
 */
function OverflowMenu({
  testId,
  side,
  align,
  onAction,
  children,
}: {
  testId: string
  side: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  onAction: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <Select value="" onValueChange={onAction}>
      <SelectTrigger
        testId={testId}
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
      <SelectContent side={side} align={align} sideOffset={2} style={{ minWidth: 168 }}>
        {children}
      </SelectContent>
    </Select>
  )
}

/**
 * One revealed archived agent: dimmed so it reads as retired, still openable,
 * with a delete control as its one remaining lifecycle action.
 */
function ArchivedAgentRow({
  entry,
  active,
  busy,
  onOpen,
  onDelete,
}: {
  entry: AgentEntry
  /** True while this agent's conversation is the one open. */
  active: boolean
  /** True while any lifecycle action on this agent is in flight. */
  busy: boolean
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      testId="archived-agent-row"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: 8,
        paddingRight: 4,
        paddingTop: 5,
        paddingBottom: 5,
        borderRadius: 7,
        cursor: 'pointer',
        opacity: active ? 0.8 : 0.55,
        backgroundColor: active ? C.item : '#00000000',
        hover: { backgroundColor: C.item },
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(entry.id)}
    >
      <Icon name="archive" size={12.5} color={C.tertiary} />
      <text
        style={{
          fontSize: 13,
          lineHeight: 17,
          color: C.tertiary,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          minWidth: 0,
          flexGrow: 1,
        }}
      >
        {displayName(entry)}
      </text>
      {hover ? (
        <IconButton
          icon="x"
          size={12}
          testId="archived-agent-row-delete"
          dimmed={busy}
          onClick={busy ? undefined : () => onDelete(entry.id)}
        />
      ) : (
        <text style={{ fontSize: 12.5, color: C.ghost, flexShrink: 0 }}>
          {relativeTime(entry)}
        </text>
      )}
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
  agents,
  activeWorkspaceId,
  activeAgentId,
  onSelect,
  onOpenAgent,
  onDeleteAgent,
  onNewTask,
  onCollapse,
  status,
  busyRows,
  onArchive,
  onRename,
  appStore,
  navState,
  onNavBack,
  onNavForward,
}: {
  /** The whole workspace directory, written only by the daemon subscription. */
  workspaces: WorkspaceStore
  /** The whole agent directory, written only by the daemon subscription. */
  agents: AgentEntry[]
  activeWorkspaceId: string | null
  /** The open conversation, highlighted inside the archived reveal. */
  activeAgentId: string | null
  onSelect: (id: string) => void
  onOpenAgent: (id: string) => void
  onDeleteAgent: (id: string) => void
  onNewTask: () => void
  onCollapse: () => void
  status: ConnStatus
  /** Row lifecycle calls currently in flight. */
  busyRows: RowActionRef[]
  onArchive: (id: string) => void
  onRename: (id: string, name: string) => void
  /** Persisted app state; the sidebar's view choices survive a restart. */
  appStore: AppStore
  /** The visited-agent history's edges, driving the nav arrows' enablement. */
  navState: { canBack: boolean; canForward: boolean }
  onNavBack: () => void
  onNavForward: () => void
}) {
  const [showArchived, setShowArchived] = useAppState(appStore, showArchivedWorkspaces)
  // The local state can't share the StateKey's name: the initializer would
  // read the destructured binding itself (TDZ), not the module-level key.
  const [revealArchivedAgents, setRevealArchivedAgents] = useAppState(appStore, showArchivedAgents)
  // Collapse state is view state; the store itself stays daemon-written. The
  // Archived reveal section collapses like the project groups under a key no
  // workspace can own.
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(new Set())
  const ARCHIVED_GROUP_ID = '__archived__'
  const groups = useMemo(() => workspaceProjectGroups(workspaces, showArchived), [workspaces, showArchived])
  const archived = useMemo(
    () => (revealArchivedAgents ? sortAgents(agents.filter(isArchived)) : []),
    [agents, revealArchivedAgents],
  )
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
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 6 }}>
          <NavArrows {...navState} onBack={onNavBack} onForward={onNavForward} />
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
        <ViewPreferencesMenu
          showArchived={showArchived}
          onShowArchivedChange={setShowArchived}
          showArchivedAgents={revealArchivedAgents}
          onShowArchivedAgentsChange={setRevealArchivedAgents}
        />
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
        {archived.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 10 }}>
            <ProjectGroupHeader
              name="Archived"
              collapsed={collapsedProjects.has(ARCHIVED_GROUP_ID)}
              onToggle={() => toggleProject(ARCHIVED_GROUP_ID)}
            />
            {!collapsedProjects.has(ARCHIVED_GROUP_ID) &&
              archived.map((entry) => (
                <ArchivedAgentRow
                  key={entry.id}
                  entry={entry}
                  busy={busyRows.some((row) => row.id === entry.id)}
                  active={entry.id === activeAgentId}
                  onOpen={onOpenAgent}
                  onDelete={onDeleteAgent}
                />
              ))}
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
      </div>
    </div>
  )
}

/**
 * The chrome's back/forward arrows over the visited-agent history: enabled
 * exactly when the stack has an entry behind/ahead, never decorative.
 */
export function NavArrows({
  canBack,
  canForward,
  onBack,
  onForward,
}: {
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <IconButton
        icon="arrowLeft"
        testId="nav-back"
        dimmed={!canBack}
        onClick={canBack ? onBack : undefined}
      />
      <IconButton
        icon="arrowRight"
        testId="nav-forward"
        dimmed={!canForward}
        onClick={canForward ? onForward : undefined}
      />
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
  stopping,
  onStop,
  busy,
  onRename,
  onArchive,
  onDelete,
  navState,
  onNavBack,
  onNavForward,
}: {
  collapsed: boolean
  onExpand: () => void
  title: string
  entry: AgentEntry | null
  /** True while a cancel request is in flight; the control reflects it until the daemon confirms. */
  stopping?: boolean
  onStop?: () => void
  /** True while any lifecycle action on this agent is in flight. */
  busy: boolean
  onRename: (id: string, name: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  /** The visited-agent history's edges, driving the nav arrows' enablement. */
  navState: { canBack: boolean; canForward: boolean }
  onNavBack: () => void
  onNavForward: () => void
}) {
  const [hover, setHover] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const archived = entry ? isArchived(entry) : false

  const startRename = () => {
    if (!entry) return
    setNameDraft(displayName(entry))
    setRenaming(true)
  }

  /**
   * Empty or unchanged drafts cancel; anything else goes to the daemon. Runs at
   * most once per edit — blur after commit or cancel is ignored.
   */
  const commitRename = () => {
    if (!renaming || !entry) return
    setRenaming(false)
    // An empty or unchanged draft means cancel, not a daemon call.
    const next = nameDraft.trim()
    if (busy || next.length === 0 || next === displayName(entry)) return
    onRename(entry.id, next)
  }

  const runAction = (action: RowActionVerb) => {
    if (!entry || busy) return
    if (action === 'rename') startRename()
    else if (action === 'archive') onArchive(entry.id)
    else if (action === 'delete') onDelete(entry.id)
  }

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
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {collapsed && (
        <>
          <div style={{ width: TRAFFIC_LIGHT_CLEARANCE - 8, height: '100%', flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <IconButton icon="sidebar" testId="sidebar-expand" onClick={onExpand} />
            <NavArrows {...navState} onBack={onNavBack} onForward={onNavForward} />
          </div>
        </>
      )}
      {renaming ? (
        <input
          value={nameDraft}
          placeholder="Agent name"
          autoFocus
          testId="agent-rename"
          style={{
            flexGrow: 0,
            flexShrink: 1,
            minWidth: 120,
            maxWidth: 320,
            height: 22,
            fontSize: 13,
            fontWeight: 500,
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
      )}
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
      // Stop is gated on running alone: an agent blocked on a permission
      // request is still running and must stay stoppable.
      {entry?.status === 'running' && (
        <>
          <text style={{ fontSize: 12, fontWeight: 500, color: C.running, flexShrink: 0 }}>
            Working…
          </text>
          <div
            testId="header-stop"
            title="Stop agent"
            onClick={stopping ? undefined : onStop}
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: stopping ? undefined : 'pointer',
              opacity: stopping ? 0.5 : 1,
              backgroundColor: C.danger,
              hover: stopping ? undefined : { opacity: 0.85 },
            }}
          >
            {stopping ? <StatusDot color="#FFFFFF" size={7} /> : <Icon name="square" size={9} color="#FFFFFF" />}
          </div>
        </>
      )}
      {entry && hover && !renaming && (
        <OverflowMenu
          testId="agent-header-menu"
          side="bottom"
          align="start"
          onAction={(action) => runAction(action as RowActionVerb)}
        >
          <SelectItem value="rename" textValue="Rename">
            <MenuAction label="Rename" disabled={busy} />
          </SelectItem>
          {!archived && (
            <SelectItem value="archive" textValue="Archive">
              <MenuAction label="Archive" disabled={busy} />
            </SelectItem>
          )}
          <SelectItem value="delete" textValue="Delete">
            <MenuAction label="Delete" tone="danger" disabled={busy} />
          </SelectItem>
        </OverflowMenu>
      )}
      <div style={{ flexGrow: 1 }} />
    </div>
  )
}
