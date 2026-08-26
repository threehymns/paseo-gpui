/**
 * The transcript: Turn values rendered as rows in a virtualized list, plus
 * pending permission cards appended after the conversation.
 */

import React, { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useGpuix } from '@gpuix/react'
import { Icon, StatusDot, type IconName } from './chrome'
import { SafeMdxContent } from './mdx'
import {
  diffStats,
  permissionDisplay,
  permissionKindLabel,
  reasoningLabel,
  toolDetailParts,
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

/** How far above the top still counts as "at the top" for history paging. */
const NEAR_TOP_PX = 64

type ScrollOffsetReader = { getScrollOffset?: (elementId: number) => Array<number> | null }

/** True when the list sits within NEAR_TOP_PX of its very top (offsets run negative going down). */
function nearTop(renderer: ScrollOffsetReader | null | undefined, listId: number | undefined): boolean {
  if (listId == null || !renderer?.getScrollOffset) return false
  const offset = renderer.getScrollOffset(listId)
  return offset != null && offset[1]! >= -NEAR_TOP_PX
}

/**
 * Row keys that survive the two ways rows move: streaming mutates the tail in
 * place, and history pages prepend whole stretches above everything. Each
 * render anchors on the first turn's identity; when it moved down by k, every
 * previous key moves down with it and only the k inserted rows are fresh.
 * Unanchored renders (agent switch through a non-empty state) reassign all.
 */
function useRowKeys(turns: Turn[]): string[] {
  const cache = useRef<{ anchor: string | null; keys: string[]; spare: number }>({
    anchor: null,
    keys: [],
    spare: 0,
  })
  return useMemo(() => {
    const c = cache.current
    const keys = new Array<string>(turns.length)
    let anchorAt = -1
    if (c.anchor != null && turns.length > 0) {
      const limit = Math.min(turns.length, 256)
      for (let i = 0; i < limit; i++) {
        if (JSON.stringify(turns[i]) === c.anchor) {
          anchorAt = i
          break
        }
      }
    }
    // No anchor but the same count means the visible stretch mutated in place
    // (streaming merges rewrite the tail); carry the keys positionally rather
    // than churning every row per delta.
    if (anchorAt < 0 && turns.length === c.keys.length) anchorAt = 0
    for (let i = 0; i < turns.length; i++) {
      const prev = anchorAt >= 0 ? i - anchorAt : -1
      keys[i] = prev >= 0 && prev < c.keys.length ? c.keys[prev]! : `r${c.spare++}`
    }
    cache.current = {
      anchor: turns.length > 0 ? JSON.stringify(turns[0]) : null,
      keys,
      spare: c.spare,
    }
    return keys
  }, [turns])
}

/** Fixed-height slot above the turns so paging affordances never insert or remove a row. */
function HistoryHead({ state }: { state: 'more' | 'loading' | 'end' }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 28,
        flexShrink: 0,
        width: '100%',
      }}
    >
      {state === 'loading' ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <StatusDot color={C.running} size={7} />
          <text style={{ fontSize: 12, color: C.tertiary }}>Fetching earlier history…</text>
        </div>
      ) : state === 'end' ? (
        <text style={{ fontSize: 11.5, color: C.ghost }}>Start of conversation</text>
      ) : null}
    </div>
  )
}

export const Transcript = memo(function Transcript({
  turns,
  permissions,
  onRespond,
  listRef,
  olderPages,
  onLoadOlder,
}: {
  turns: Turn[]
  permissions?: PendingPermission[]
  onRespond?: (request: PermissionEntry['request'], response: PermissionResponse) => void
  listRef?: React.RefObject<{ id: number } | null>
  /** Availability of history older than what this transcript holds. */
  olderPages?: 'more' | 'loading' | 'end'
  onLoadOlder?: () => void
}) {
  const { renderer } = useGpuix()
  const rowKeys = useRowKeys(turns)
  /*
   * Scroll-top trigger for older history pages.
   *
   * Spike findings (prepend anchoring in the virtualized list): the native
   * list's behavior when rows are inserted above the viewport could not be
   * verified headlessly — this needs a manual pass on a real daemon. What
   * ships here to keep the viewport steady regardless:
   *   - the head slot above is fixed-height, so affordances never insert or
   *     remove rows;
   *   - chat.tsx suppresses its tail-follow scroll when the tail itself did
   *     not change (the signature of a pure prepend);
   *   - fetches are re-entrancy safe, so repeated upward ticks page cleanly.
   * If on-device checks show the list does not anchor to the top turn,
   * compensate around the commit with renderer.getScrollOffset/scrollTo.
   */
  const onScroll = useCallback(
    (event: { deltaY?: number }) => {
      if (olderPages !== 'more' || !onLoadOlder) return
      if ((event.deltaY ?? 0) > 0) return
      if (!nearTop(renderer, listRef?.current?.id)) return
      onLoadOlder()
    },
    [olderPages, onLoadOlder, renderer, listRef],
  )

  const cards = permissions ?? []
  const rowCount = turns.length + cards.length
  return (
    <virtual-list
      ref={listRef as never}
      overdraw={240}
      estimatedItemHeight={220}
      style={{ flexGrow: 1, minHeight: 0, width: '100%' }}
      /* onScroll rides every element in the reconciler's event registry even
         though the shipped JSX types omit it from VirtualListProps. */
      {...{ onScroll }}
    >
      {/* Row keys come from useRowKeys: stable across prepends and streaming
          updates, so local expansion state (tool detail, reasoning) stays put. */}
      {olderPages && <HistoryHead state={olderPages} />}
      {turns.map((turn, index) => (
        <TranscriptRow
          key={rowKeys[index]}
          first={index === 0 && olderPages == null}
          last={index === rowCount - 1}
        >
          {turn.kind === 'user' && <UserTurn text={turn.text} />}
          {turn.kind === 'assistant' && <SafeMdxContent source={turn.source} />}
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
