/**
 * The subagent piece of the tracks row: the pill summarizing a parent's
 * subagents and the panel it opens, plus the read-only viewer chrome for one
 * provider subagent's timeline.
 *
 * Every count and row comes from the subagent store's projections — never
 * from transcript turns. Rows carry hover actions: View everywhere, Archive
 * on finished managed children, Detach on provider descriptors behind its
 * strict feature gate. Archive and detach report through their daemon calls;
 * the resulting rows leave via the existing subscriptions, never local state.
 */

import React, { useEffect, useState } from 'react'
import { Icon, StatusDot, type RowActionRef } from '../chrome/chrome'
import { Pill, PillAction } from '../composer/composer'
import {
  subagentLabel,
  subagentRowColor,
  subagentSubtitle,
  trackLabel,
  type SubagentRow,
} from './subagents'
import { C } from '../chrome/theme'

export type OpenSubagent = {
  kind: SubagentRow['kind']
  parentAgentId: string
  id: string
}

/** Row identity inside the pill and panel; kinds never share ids. */
function rowKey(row: SubagentRow): string {
  return `${row.kind}:${row.id}`
}

const STATUS_WORDS: Record<SubagentRow['status'], string> = {
  running: 'working',
  failed: 'failed',
  canceled: 'canceled',
  completed: 'done',
}

const PANEL_WIDTH = 340

function openTarget(row: SubagentRow): OpenSubagent {
  return { kind: row.kind, parentAgentId: row.parentAgentId, id: row.id }
}

/**
 * The Subagents pill and its panel. Renders nothing without rows — zero
 * subagents means no affordance anywhere.
 */
export function SubagentPill({
  rows,
  busyRows = [],
  onView,
  onArchive,
  onDetach,
  detachEnabled,
}: {
  rows: SubagentRow[]
  /** Row lifecycle calls in flight; suspends this row's actions until they settle. */
  busyRows?: RowActionRef[]
  onView?: (target: OpenSubagent) => void
  /** Archives a finished managed child; directory truth rides the subscription. */
  onArchive?: (id: string) => Promise<unknown>
  /** Detaches a provider subagent after confirmation; its remove push closes the row. */
  onDetach?: (id: string) => Promise<unknown>
  /** Strict daemon gate: providerSubagents and agentDetach must both be true. */
  detachEnabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  // Archive finished walks managed rows one at a time, showing progress.
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    if (confirming && !rows.some((row) => rowKey(row) === confirming)) setConfirming(null)
  }, [rows, confirming])

  if (rows.length === 0) return null

  const finishedManaged = rows.filter((row) => row.kind === 'managed' && row.status !== 'running')
  const working = rows.some((row) => row.status === 'running')

  const archiveFinished = async () => {
    if (!onArchive || bulk || finishedManaged.length === 0) return
    setBulk({ done: 0, total: finishedManaged.length })
    try {
      for (const row of finishedManaged) {
        await onArchive(row.id)
        setBulk((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev))
      }
    } finally {
      setBulk(null)
    }
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      onMouseDownOutside={() => {
        setOpen(false)
        setConfirming(null)
      }}
    >
      {open && (
        <div
          testId="tracks-subagents-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: PANEL_WIDTH,
            maxHeight: 300,
            overflowY: 'scroll',
            marginBottom: 6,
            paddingTop: 4,
            paddingBottom: 4,
            paddingLeft: 4,
            paddingRight: 4,
            backgroundColor: C.raised,
            borderWidth: 1,
            borderColor: C.borderStrong,
            borderRadius: 12,
          }}
        >
          {finishedManaged.length > 0 && (
            <div
              testId="tracks-subagent-archive-all"
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                height: 26,
                paddingLeft: 8,
                paddingRight: 8,
                marginBottom: 2,
                borderRadius: 7,
                cursor: bulk ? undefined : 'pointer',
                opacity: bulk ? 0.5 : 1,
                hover: bulk ? undefined : { backgroundColor: '#404040' },
              }}
              onClick={bulk ? undefined : () => void archiveFinished()}
            >
              <Icon name="archive" size={12} color={C.secondary} />
              <text style={{ fontSize: 12, fontWeight: 500, color: C.secondary, flexShrink: 0 }}>
                Archive finished
              </text>
              <div style={{ flexGrow: 1 }} />
              <text style={{ fontSize: 11.5, color: C.tertiary, flexShrink: 0 }} testId="tracks-subagent-archive-progress">
                {bulk ? `${bulk.done}/${bulk.total}` : `${finishedManaged.length}`}
              </text>
            </div>
          )}
          {rows.map((row) => (
            <SubagentRowItem
              key={rowKey(row)}
              row={row}
              busy={busyRows.some((ref) => ref.id === row.id)}
              confirming={confirming === rowKey(row)}
              detachEnabled={detachEnabled === true}
              bulk={bulk}
              onView={
                onView
                  ? (target) => {
                      setOpen(false)
                      setConfirming(null)
                      onView(target)
                    }
                  : undefined
              }
              onArchive={onArchive}
              onDetach={onDetach}
              onAskDetach={() => setConfirming(rowKey(row))}
              onCancelDetach={() => setConfirming(null)}
            />
          ))}
        </div>
      )}
      <Pill testId="tracks-subagents" onClick={() => setOpen((prev) => !prev)}>
        <Icon name="sparkle" size={12} color={working ? C.running : C.tertiary} />
        <text style={{ fontSize: 12, fontWeight: 500, color: C.secondary, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {trackLabel(rows)}
        </text>
        {!open && <Icon name="chevronDown" size={10.5} color={C.ghost} />}
      </Pill>
    </div>
  )
}

/** One panel row: dot, label, subtitle, then status word or hover actions. */
function SubagentRowItem({
  row,
  busy,
  confirming,
  detachEnabled,
  bulk,
  onView,
  onArchive,
  onDetach,
  onAskDetach,
  onCancelDetach,
}: {
  row: SubagentRow
  busy: boolean
  confirming: boolean
  detachEnabled: boolean
  bulk: { done: number; total: number } | null
  onView?: (target: OpenSubagent) => void
  onArchive?: (id: string) => Promise<unknown>
  onDetach?: (id: string) => Promise<unknown>
  onAskDetach: () => void
  onCancelDetach: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const key = rowKey(row)
  const label = subagentLabel(row)
  const subtitle = subagentSubtitle(row)
  const archivable = row.kind === 'managed' && row.status !== 'running' && onArchive != null
  const detachable =
    row.kind === 'provider' && detachEnabled && onDetach != null && !archivable && !confirming

  return (
    <div
      testId={`subagent-row-${key}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 7,
        cursor: onView ? 'pointer' : undefined,
        opacity: confirming ? 0.9 : 1,
        hover: onView ? { backgroundColor: '#404040' } : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onView ? () => onView(openTarget(row)) : undefined}
    >
      <StatusDot color={subagentRowColor(row)} size={7} />
      <text
        style={{
          fontSize: 12.5,
          lineHeight: 16,
          fontWeight: 500,
          color: C.text,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          minWidth: 0,
          flexGrow: 1,
        }}
      >
        {label ?? 'Untitled subagent'}
      </text>
      {subtitle && (
        <text
          style={{
            fontSize: 11.5,
            color: C.ghost,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            maxWidth: 130,
            flexShrink: 2,
          }}
        >
          {subtitle}
        </text>
      )}
      {hovered ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {onView && <PillAction testId={`subagent-view-${key}`} icon="panelRight" onClick={() => onView(openTarget(row))} />}
          {archivable && (
            <PillAction
              testId={`subagent-archive-${key}`}
              icon="archive"
              busy={busy || bulk != null}
              onClick={() => void onArchive?.(row.id)}
            />
          )}
          {detachable && <PillAction testId={`subagent-detach-${key}`} icon="x" busy={busy} onClick={onAskDetach} />}
          {confirming && (
            <>
              <text style={{ fontSize: 11.5, fontWeight: 500, color: C.danger, flexShrink: 0 }}>Detach?</text>
              <PillAction
                testId={`subagent-detach-confirm-${key}`}
                icon="check"
                busy={busy}
                onClick={() => void onDetach?.(row.id)}
              />
              <PillAction testId={`subagent-detach-cancel-${key}`} icon="x" onClick={onCancelDetach} />
            </>
          )}
        </div>
      ) : (
        <text
          style={{
            fontSize: 11.5,
            color: subagentRowColor(row),
            flexShrink: 0,
          }}
        >
          {STATUS_WORDS[row.status]}
        </text>
      )}
    </div>
  )
}

/**
 * The read-only banner shown while a subagent's transcript occupies the main
 * area. It names what you are reading and is the way back to the parent.
 */
export function SubagentViewerBar({
  label,
  statusColor,
  onBack,
}: {
  label: string
  statusColor: string
  onBack: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        flexShrink: 0,
        paddingTop: 8,
        paddingBottom: 2,
        userSelect: 'none',
      }}
    >
      <div
        testId="subagent-back"
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          height: 26,
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.composer,
          cursor: 'pointer',
          hover: { backgroundColor: C.overlay },
        }}
        onClick={onBack}
      >
        <Icon name="arrowLeft" size={13} color={C.secondary} />
        <text style={{ fontSize: 12.5, color: C.secondary }}>Back to parent</text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <StatusDot color={statusColor} size={7} />
        <text
          style={{
            fontSize: 12.5,
            color: C.tertiary,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {label}
        </text>
      </div>
    </div>
  )
}

/**
 * Pages one older window into an opened provider subagent's transcript.
 * Renders only while older turns exist.
 */
export function SubagentLoadOlder({
  loading,
  onClick,
}: {
  loading: boolean
  onClick: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', paddingTop: 10, flexShrink: 0 }}>
      <div
        testId="subagent-load-older"
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 24,
          paddingLeft: 12,
          paddingRight: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.composer,
          cursor: loading ? undefined : 'pointer',
          opacity: loading ? 0.5 : 1,
          hover: loading ? undefined : { backgroundColor: C.overlay },
        }}
        onClick={loading ? undefined : onClick}
      >
        <text style={{ fontSize: 12, color: C.secondary }}>
          {loading ? 'Loading…' : 'Load earlier turns'}
        </text>
      </div>
    </div>
  )
}
