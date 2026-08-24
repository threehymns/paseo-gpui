/**
 * The transcript: Turn values rendered as rows in a virtualized list.
 */

import React, { memo } from 'react'
import { Icon, StatusDot, type IconName } from './chrome'
import { SafeMdxContent } from './mdx'
import type { ToolName, Turn } from './paseo'
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

export const Transcript = memo(function Transcript({
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
