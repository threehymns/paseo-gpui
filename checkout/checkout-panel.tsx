/**
 * The checkout panel: where am I and how dirty is it, at a glance.
 *
 * A single row under the header fed by the checkout status store. It renders
 * branch (detached HEAD reads as unknown), clean-versus-dirty, base ref,
 * remote URL, and ahead/behind — plus the per-repo action queue's flash so
 * serialized mutations visibly land one at a time.
 */

import React from 'react'
import { Icon, IconButton, StatusDot } from '../chrome/chrome'
import { branchLabel, canRefresh, formatAheadBehind, type CheckoutEntry, type RepoStatus } from './checkout'
import type { RepoActionQueue } from './checkout-actions'
import { C } from '../chrome/theme'

export function CheckoutPanel({
  entry,
  actions,
  onRefresh,
}: {
  entry: CheckoutEntry | undefined
  /** This repository's action queue: running state and the success flash. */
  actions: RepoActionQueue | undefined
  onRefresh: () => void
}) {
  const busy = actions?.running != null

  return (
    <div
      testId="checkout-panel"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 30,
        flexShrink: 0,
        paddingLeft: 14,
        paddingRight: 10,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}
    >
      <Icon name="gitBranch" size={13} color={C.tertiary} />
      <PanelBody entry={entry} />
      <div style={{ flexGrow: 1 }} />
      {actions?.flash && (
        <div
          testId="action-flash"
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            height: 20,
            paddingLeft: 7,
            paddingRight: 7,
            borderRadius: 10,
            backgroundColor: actions.flash.ok ? '#58B3681A' : '#E5484D1A',
          }}
        >
          <StatusDot color={actions.flash.ok ? C.ok : C.danger} size={6} />
          <text style={{ fontSize: 11.5, fontWeight: 500, color: actions.flash.ok ? C.ok : C.danger }}>
            {actions.flash.error ?? actions.flash.action.label}
          </text>
        </div>
      )}
      {canRefresh(entry) && (
        <IconButton
          icon="rotateCcw"
          size={12}
          dimmed={busy}
          onClick={busy ? undefined : onRefresh}
          testId="checkout-refresh"
        />
      )}
    </div>
  )
}

function PanelBody({ entry }: { entry: CheckoutEntry | undefined }) {
  if (entry == null || entry.phase === 'loading') return <Dimmed text="Reading workspace…" />

  // A failed refetch keeps last-known daemon truth visible, flagged stale.
  const stale = entry.phase === 'failed'
  const status: RepoStatus | null = entry.status
  if (!status?.isGit) {
    return stale ? <Dimmed text="Git status unavailable" /> : <Dimmed text="Not a git repository" />
  }

  const dirty = status.dirty === true
  const aheadBehind = formatAheadBehind(status.ahead, status.behind)
  return (
    <>
      <text testId="checkout-branch" style={{ fontSize: 12, fontWeight: 500, color: C.text }}>
        {branchLabel(status)}
      </text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <StatusDot color={dirty ? C.warn : C.ok} size={6} />
        <text style={{ fontSize: 11.5, color: dirty ? C.warn : C.tertiary }}>{dirty ? 'dirty' : 'clean'}</text>
      </div>
      {status.baseRef && <text style={{ fontSize: 11.5, color: C.tertiary }}>base {status.baseRef}</text>}
      {aheadBehind && <text style={{ fontSize: 11.5, color: C.secondary }}>{aheadBehind}</text>}
      {status.errorCode && status.errorMessage && (
        <text style={{ fontSize: 11.5, color: C.danger }}>{status.errorMessage}</text>
      )}
      {status.hasRemote && status.remoteUrl && (
        <text
          style={{
            fontSize: 11.5,
            color: C.ghost,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            minWidth: 0,
            marginLeft: 4,
          }}
        >
          {status.remoteUrl}
        </text>
      )}
      {stale && <Dimmed text="(stale)" />}
    </>
  )
}

function Dimmed({ text }: { text: string }) {
  return <text style={{ fontSize: 12, color: C.tertiary }}>{text}</text>
}
