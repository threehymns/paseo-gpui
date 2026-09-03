/**
 * One setup tab's content (#47): a live worktree bootstrap log.
 *
 * Renders the snapshot the setup store holds for its workspace — per-command
 * ✓/✗/• meta lines plus logs, via the same `toolDetailParts` mapping the
 * worktree_setup tool turn uses. While running it streams as pushes land; on
 * success it collapses to a summary chip (the tab keeps the log reachable,
 * expandable in place); on failure the error and failing output stay visible
 * inline so the worktree never becomes a black box.
 *
 * On mount it asks the daemon for the snapshot in case the store skipped ahead
 * (reattach/initial state); the store's freshness guard retires a stale reply.
 */

import React, { useEffect, useState } from 'react'
import { C } from '../chrome/theme'
import { Icon } from '../chrome/chrome'
import { toolDetailParts, type ToolCallDetail } from '../daemon/paseo'
import { setupSucceeded, type SetupSnapshot } from './setup'

export interface SetupTabPanelProps {
  workspaceId: string
  snapshot: SetupSnapshot | null
  /** Seeds the reattach snapshot for this workspace on mount. */
  refresh: (workspaceId: string) => void
  /** True when this is the focused tab (visible); background tabs hide-not-unmount. */
  hidden: boolean
}

/** The one-line summary chip shown once setup succeeds, holding the count. */
function setupSummary(snapshot: SetupSnapshot): string {
  const count = snapshot.detail.commands.length
  return `${count} ${count === 1 ? 'command' : 'commands'}`
}

export function SetupTabPanel({ workspaceId, snapshot, refresh, hidden }: SetupTabPanelProps) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    refresh(workspaceId)
  }, [refresh, workspaceId])

  // A completed setup collapses to a summary chip but stays reachable; a
  // running or failed one always shows its live detail. Switching workspaces
  // collapses again so a fresh tab opens to its summary.
  useEffect(() => {
    setExpanded(false)
  }, [workspaceId])

  const done = setupSucceeded(snapshot)
  const failed = snapshot?.status === 'failed'
  const showDetail = expanded || !done

  const parts =
    snapshot && showDetail
      ? toolDetailParts(snapshot.detail as unknown as ToolCallDetail)
      : []

  const headerText = failed
    ? 'Setup failed'
    : done
      ? 'Setup complete'
      : 'Setting up worktree…'
  const headerColor = failed ? C.danger : done ? C.success : C.running

  return (
    <div
      style={{
        display: hidden ? 'none' : 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        minHeight: 0,
        width: '100%',
        overflowY: 'auto',
      }}
    >
      <div
        testId="setup-tab"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: 16,
          maxWidth: 720,
          alignSelf: 'center',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <text style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{headerText}</text>
            {!snapshot && !failed && (
              <text style={{ fontSize: 12, color: C.running }}>Waiting for the daemon…</text>
            )}
          </div>
          {snapshot && (
            <text style={{ fontSize: 12, color: C.secondary }}>
              {snapshot.detail.branchName} · {snapshot.detail.worktreePath}
            </text>
          )}
          {failed && snapshot?.error && (
            <text style={{ fontSize: 12, color: C.danger }}>{snapshot.error}</text>
          )}
        </div>

        {done && !showDetail && (
          <div
            testId="setup-summary-chip"
            onClick={() => setExpanded(true)}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 6,
              backgroundColor: C.raised,
              border: `1px solid ${C.border}`,
              cursor: 'default',
            }}
          >
            <Icon name="check" size={13} color={headerColor} />
            <text style={{ fontSize: 13, color: C.text }}>{setupSummary(snapshot)}</text>
            <text style={{ fontSize: 12, color: C.secondary, flexGrow: 1 }}>— setup complete</text>
            <Icon name="chevronDown" size={12} color={C.secondary} />
          </div>
        )}

        {parts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {parts.map((part, i) =>
              part.type === 'meta' ? (
                <text
                  key={i}
                  style={{ fontSize: 13, color: part.tone === 'ok' ? C.ok : part.tone === 'danger' ? C.danger : C.tertiary }}
                >
                  {part.text}
                </text>
              ) : (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  {part.label && (
                    <text style={{ fontSize: 10.5, fontWeight: 500, color: C.ghost, flexShrink: 0 }}>
                      {part.label.toUpperCase()}
                    </text>
                  )}
                  <text
                    style={{ fontSize: 12, lineHeight: 17, fontFamily: 'monospace', color: C.secondary, minWidth: 0, maxWidth: '100%' }}
                  >
                    {part.text}
                  </text>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  )
}
