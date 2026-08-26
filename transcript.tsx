/**
 * The transcript: Turn values rendered as rows in a virtualized list, plus
 * pending permission cards appended after the conversation.
 */

import React, { memo, useEffect, useState } from 'react'
import { Icon, StatusDot, type IconName } from './chrome'
import { SafeMdxContent } from './mdx'
import {
  completionTimestamp,
  copyableText,
  diffStats,
  permissionDisplay,
  permissionKindLabel,
  reasoningLabel,
  toolDetailParts,
  workedForLabel,
  type AssistantTurn,
  type PermissionKind,
  type PermissionResponse,
  type ReasoningTurn,
  type ToolDetailPart,
  type ToolName,
  type Turn,
} from './paseo'
import { permissionActions, permissionPlanMarkdown, type PermissionEntry } from './permissions'
import { C, CHAT_THEME, CONTENT_MAX_WIDTH } from './theme'

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

function oneLine(text: string | undefined, limit = 140): string | undefined {
  if (!text) return undefined
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat || undefined
}

function UserTurn({
  text,
  queuedId,
  onEdit,
}: {
  text: string
  queuedId?: string
  onEdit?: (queuedId: string) => void
}) {
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
        testId={queuedId ? 'queued-send' : undefined}
        onClick={queuedId && onEdit ? () => onEdit(queuedId) : undefined}
        style={{
          maxWidth: 540,
          minWidth: 0,
          backgroundColor: C.raised,
          borderRadius: 12,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 12,
          paddingRight: 12,
          cursor: queuedId && onEdit ? 'pointer' : undefined,
          hover: queuedId && onEdit ? { backgroundColor: C.overlayStrong } : undefined,
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

function ToolDetailBody({ parts, patch }: { parts: ToolDetailPart[]; patch?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        paddingLeft: 24,
      }}
    >
      {parts.map((part, index) =>
        part.type === 'meta' ? (
          <text
            key={index}
            style={{
              fontSize: 12,
              lineHeight: 16,
              color:
                part.tone === 'ok' ? C.ok : part.tone === 'danger' ? C.danger : C.tertiary,
              flexShrink: 0,
            }}
          >
            {part.text}
          </text>
        ) : (
          <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            {part.label && (
              <text style={{ fontSize: 10.5, fontWeight: 500, color: C.ghost, flexShrink: 0 }}>
                {part.label.toUpperCase()}
              </text>
            )}
            <text
              style={{
                fontSize: 12,
                lineHeight: 17,
                fontFamily: 'monospace',
                color: C.secondary,
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              {part.text}
            </text>
          </div>
        ),
      )}
      {patch && (
        <div style={{ overflow: 'hidden', minWidth: 0, borderRadius: 8 }}>
          <div style={{ marginTop: -34, minWidth: 0 }}>
            <diff patch={patch} wordDiff theme={CHAT_THEME} />
          </div>
        </div>
      )}
    </div>
  )
}

function ToolRow({ turn }: { turn: Extract<Turn, { kind: 'tool' }> }) {
  const icon = TOOL_ICONS[turn.tool]
  const detail = oneLine(turn.detail)
  // Expansion is component-local on purpose: replace-in-place updates to the
  // same call id swap the turn value but keep this instance, so an open row
  // stays open while its detail streams in.
  const [expanded, setExpanded] = useState(false)
  const parts = turn.structured ? toolDetailParts(turn.structured) : []
  const stats = turn.patch ? diffStats(turn.patch) : undefined
  const expandable = parts.length > 0 || Boolean(turn.patch)
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          borderRadius: 6,
          ...(expandable
            ? { cursor: 'pointer' as const, hover: { backgroundColor: C.overlay } }
            : {}),
        }}
        onClick={expandable ? () => setExpanded((value) => !value) : undefined}
      >
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
        {stats && (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {stats.additions > 0 && (
              <text style={{ fontSize: 12, fontWeight: 500, color: C.ok, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {`+\u2060${stats.additions}`}
              </text>
            )}
            {stats.deletions > 0 && (
              <text style={{ fontSize: 12, fontWeight: 500, color: C.danger, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {`-\u2060${stats.deletions}`}
              </text>
            )}
          </div>
        )}
        {turn.status === 'failed' && (
          <text style={{ fontSize: 12, color: C.danger, flexShrink: 0 }}>failed</text>
        )}
      </div>
      {expanded && expandable && <ToolDetailBody parts={parts} patch={turn.patch} />}
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

function ReasoningRow({ turn }: { turn: ReasoningTurn }) {
  // Component-local like ToolRow's: the fold swaps the turn value as deltas
  // merge in, but this instance survives, so an open block stays expanded.
  const [expanded, setExpanded] = useState(false)
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          borderRadius: 6,
          cursor: 'pointer' as const,
          hover: { backgroundColor: C.overlay },
        }}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon name="sparkle" size={12.5} color={turn.durationMs == null ? C.running : C.tertiary} />
        <text
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: turn.durationMs == null ? C.secondary : C.tertiary,
            flexShrink: 0,
          }}
        >
          {reasoningLabel(turn)}
        </text>
      </div>
      {expanded && <ReasoningBlock text={turn.text} />}
    </div>
  )
}

/**
 * The footer line under an assistant turn: elapsed time ticking each second
 * while it works, "Worked for {duration}" once finished — swapping to the
 * completion clock time on hover — and a copy affordance for its markdown,
 * flashing ✓ on success. Absent entirely when the turn has neither timing nor
 * anything copyable.
 */
function AssistantFooter({ turn }: { turn: AssistantTurn }) {
  const working = turn.startedAt != null && turn.endedAt == null
  // Component-local like ToolRow's expansion: replace-in-place streaming swaps
  // the turn value but keeps this instance, so the ticker and flash survive.
  const [, setTick] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyText = copyableText(turn)

  useEffect(() => {
    if (!working) return
    const id = setInterval(() => setTick((value) => value + 1), 1_000)
    return () => clearInterval(id)
  }, [working])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_200)
    return () => clearTimeout(timer)
  }, [copied])

  if (turn.startedAt == null && !copyText) return null

  const copy = () => {
    if (!copyText || copied) return
    const clipboard = (navigator as { clipboard?: { writeText?: (text: string) => Promise<void> } }).clipboard
    if (!clipboard?.writeText) return
    clipboard.writeText(copyText).then(() => setCopied(true)).catch(() => {})
  }

  const finished = !working && turn.endedAt != null
  const label = workedForLabel(turn, Date.now())
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 2,
        minWidth: 0,
        height: 18,
      }}
    >
      {label && (
        <text
          onMouseEnter={finished ? () => setHovered(true) : undefined}
          onMouseLeave={finished ? () => setHovered(false) : undefined}
          style={{ fontSize: 11.5, color: C.ghost, flexShrink: 0, userSelect: 'none' }}
        >
          {finished && hovered ? completionTimestamp(turn.endedAt!) : label}
        </text>
      )}
      {copyText && (
        <div
          testId="copy-turn"
          onClick={copy}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
            cursor: 'pointer',
            borderRadius: 5,
            paddingLeft: 4,
            paddingRight: 4,
            paddingTop: 1,
            paddingBottom: 1,
            hover: copied ? undefined : { backgroundColor: C.overlay },
          }}
        >
          <text style={{ fontSize: 11.5, color: copied ? C.ok : C.ghost, userSelect: 'none' }}>
            {copied ? '✓ Copied' : 'Copy'}
          </text>
        </div>
      )}
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
        backgroundColor: C.dangerWash,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: C.dangerBorder,
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

const PERMISSION_ICONS: Record<PermissionKind, IconName> = {
  tool: 'wrench',
  plan: 'list',
  question: 'sparkle',
  mode: 'lock',
  other: 'lock',
}

type ButtonLook = 'primary' | 'secondary' | 'danger'

/** The provider's variant decides when supplied; behavior otherwise. */
function actionLook(behavior: 'allow' | 'deny', variant?: 'primary' | 'secondary' | 'danger'): ButtonLook {
  return variant ?? (behavior === 'allow' ? 'primary' : 'secondary')
}

const BUTTON_LOOKS: Record<ButtonLook, { backgroundColor: string; borderColor?: string; color: string }> = {
  primary: { backgroundColor: C.inverse, color: C.onInverse },
  secondary: { backgroundColor: C.overlayStrong, color: C.secondary },
  danger: { backgroundColor: C.dangerWash, borderColor: C.dangerBorder, color: C.danger },
}

function PermissionButton({
  label,
  look,
  disabled,
  onClick,
}: {
  label: string
  look: ButtonLook
  disabled?: boolean
  onClick?: () => void
}) {
  const { backgroundColor, borderColor, color } = BUTTON_LOOKS[look]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 26,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 7,
        borderWidth: borderColor ? 1 : undefined,
        borderColor,
        cursor: disabled ? undefined : 'pointer',
        opacity: disabled ? 0.4 : 1,
        backgroundColor,
        hover: disabled ? undefined : { opacity: 0.85 },
      }}
      onClick={disabled ? undefined : onClick}
    >
      <text style={{ fontSize: 12.5, fontWeight: 500, color }}>
        {label}
      </text>
    </div>
  )
}

export function PermissionCard({
  entry,
  responding,
  onRespond,
}: {
  entry: PermissionEntry
  responding: boolean
  onRespond?: (request: PermissionEntry['request'], response: PermissionResponse) => void
}) {
  const { title, detail } = permissionDisplay(entry.request)
  const actions = permissionActions(entry.request)
  const planMarkdown = permissionPlanMarkdown(entry.request)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        minWidth: 0,
        backgroundColor: C.raised,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: responding ? C.border : C.accent,
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Icon name={PERMISSION_ICONS[entry.request.kind]} size={13} color={C.accent} />
        <text style={{ fontSize: 11.5, fontWeight: 500, color: C.accent, flexShrink: 0, textTransform: 'uppercase' }}>
          {permissionKindLabel(entry.request.kind)}
        </text>
        <text
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: C.text,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            minWidth: 0,
            flexGrow: 1,
          }}
        >
          {title}
        </text>
        {responding && (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <StatusDot color={C.running} size={7} />
            <text style={{ fontSize: 12, color: C.running }}>responding…</text>
          </div>
        )}
      </div>
      {planMarkdown && (
        <div
          style={{
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 8,
            backgroundColor: C.canvas,
            padding: 12,
            minWidth: 0,
          }}
        >
          <SafeMdxContent source={planMarkdown} />
        </div>
      )}
      {!planMarkdown && detail && (
        <text
          style={{
            fontSize: 13,
            lineHeight: 19,
            color: C.secondary,
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          {oneLine(detail)}
        </text>
      )}
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        {actions.map((action, index) => (
          <PermissionButton
            key={`${action.id}-${index}`}
            label={action.label}
            look={actionLook(action.behavior, action.variant)}
            disabled={responding}
            onClick={() => onRespond?.(entry.request, action.response)}
          />
        ))}
      </div>
    </div>
  )
}

export interface PendingPermission {
  entry: PermissionEntry
  responding: boolean
}

export const Transcript = memo(function Transcript({
  turns,
  permissions,
  onRespond,
  onEditQueued,
  listRef,
}: {
  turns: Turn[]
  permissions?: PendingPermission[]
  onRespond?: (request: PermissionEntry['request'], response: PermissionResponse) => void
  /** Pulls a queued (optimistic) send back into the composer for editing. */
  onEditQueued?: (queuedId: string) => void
  listRef?: React.Ref<{ id: number }>
}) {
  const cards = permissions ?? []
  const rowCount = turns.length + cards.length
  return (
    <virtual-list
      ref={listRef}
      overdraw={240}
      estimatedItemHeight={220}
      style={{ flexGrow: 1, minHeight: 0, width: '100%' }}
    >
      {/* Tool rows key by call id so a row's local expansion state follows its
          turn through replace-in-place streaming updates and later insertions. */}
      {turns.map((turn, index) => (
        <TranscriptRow
          key={turn.kind === 'tool' ? `tool:${turn.callId}` : `t${index}`}
          first={index === 0}
          last={index === rowCount - 1}
        >
          {turn.kind === 'user' && (
            <UserTurn
              text={turn.text}
              queuedId={turn.queuedId}
              onEdit={onEditQueued}
            />
          )}
          {turn.kind === 'assistant' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', minWidth: 0 }}>
              <SafeMdxContent source={turn.source} />
              <AssistantFooter turn={turn} />
            </div>
          )}
          {turn.kind === 'reasoning' && <ReasoningRow turn={turn} />}
          {turn.kind === 'tool' && <ToolRow turn={turn} />}
          {turn.kind === 'todo' && <TodoBlock items={turn.items} />}
          {turn.kind === 'error' && <ErrorBlock text={turn.text} />}
        </TranscriptRow>
      ))}
      {cards.map(({ entry, responding }, index) => (
        <TranscriptRow
          key={`p${entry.agentId}:${entry.requestId}`}
          first={turns.length === 0 && index === 0}
          last={index === rowCount - 1}
        >
          <PermissionCard entry={entry} responding={responding} onRespond={onRespond} />
        </TranscriptRow>
      ))}
    </virtual-list>
  )
})
