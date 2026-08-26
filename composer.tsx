/**
 * The composer: draft textarea with chips, plus the workspace footer bar.
 */

import React, { useMemo, useState } from 'react'
import { Icon, IconButton, StatusDot, type IconName } from './chrome'
import { OptionPicker } from './pickers'
import { basename } from './paseo'
import type { Turn } from './paseo'
import { changesTrack, subagentsTrack, tasksTrack } from './tracks'
import type { ImageAttachment, PastePayload } from './attachments'
import type { ProviderNotice } from './live-config'
import { C, CHAT_THEME, CONTENT_MAX_WIDTH } from './theme'

const NOTICE_COLORS: Record<ProviderNotice['type'], string> = {
  info: C.secondary,
  warning: C.warn,
  error: C.danger,
}

/** Inline provider feedback (e.g. a mode change with side effects) above the composer. */
export function ConfigNotice({ notice }: { notice: ProviderNotice }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', paddingBottom: 4 }}>
      <text style={{ fontSize: 12, color: NOTICE_COLORS[notice.type], width: CONTENT_MAX_WIDTH }}>
        {notice.message}
      </text>
    </div>
  )
}

// ---- tracks row -------------------------------------------------------------

function Pill({
  testId,
  onClick,
  children,
}: {
  testId?: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <div
      testId={testId}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 26,
        paddingLeft: 8,
        paddingRight: 4,
        borderRadius: 7,
        backgroundColor: C.item,
        flexShrink: 0,
        ...(onClick ? { cursor: 'pointer' as const, hover: { backgroundColor: C.overlayStrong } } : {}),
      }}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

/** A compact in-pill icon action; `busy` suspends it while its daemon call is in flight. */
function PillAction({
  testId,
  icon,
  busy,
  onClick,
}: {
  testId: string
  icon: IconName
  busy?: boolean
  onClick?: () => void
}) {
  return (
    <div
      testId={testId}
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: busy ? undefined : 'pointer',
        opacity: busy ? 0.35 : 1,
        hover: busy ? undefined : { backgroundColor: C.overlay },
      }}
      onClick={busy ? undefined : onClick}
    >
      <Icon name={icon} size={11} color={C.secondary} />
    </div>
  )
}

/**
 * The tracks row above the composer: live work at a glance as pills derived
 * from the transcript's folded turns — latest todo snapshot (Tasks), subagent
 * counts with detach/archive actions (Subagents), and accumulated edit totals
 * (DiffStat). The DiffStat pill renders only while a Changes surface exists
 * (`onOpenChanges`); the whole row disappears when nothing has to say.
 */
export function TracksRow({
  turns,
  onOpenAgent,
  onArchiveAgent,
  onOpenChanges,
}: {
  turns: Turn[]
  /** Detach-to-view: opens an agent id (a running subagent's child session). */
  onOpenAgent?: (agentId: string) => void
  /** Archives a finished subagent's child agent. */
  onArchiveAgent?: (agentId: string) => Promise<unknown>
  /** Present only while a Changes surface exists to open. */
  onOpenChanges?: () => void
}) {
  const tasks = tasksTrack(turns)
  const subagents = subagentsTrack(turns)
  const changes = changesTrack(turns)

  // Archive finished subagents one by one; directory truth rides the subscription.
  const [archiving, setArchiving] = useState(false)
  const archivable = (subagents?.finished ?? []).filter((run) => run.childSessionId != null)
  const detachable = (subagents?.running ?? []).find((run) => run.childSessionId != null)

  if (!tasks && !subagents && !(changes && onOpenChanges)) return null

  const archiveFinished = async () => {
    if (!onArchiveAgent || archiving || archivable.length === 0) return
    setArchiving(true)
    try {
      for (const run of archivable) await onArchiveAgent(run.childSessionId!)
    } finally {
      setArchiving(false)
    }
  }

  const subagentLabel = [
    subagents && subagents.running.length > 0 ? `${subagents.running.length} running` : null,
    subagents && subagents.finished.length > 0 ? `${subagents.finished.length} done` : null,
  ]
    .filter(Boolean)
    .join(' · ') || null

  return (
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', paddingBottom: 4 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
          width: CONTENT_MAX_WIDTH,
          maxWidth: '100%',
          paddingLeft: 10,
          userSelect: 'none',
        }}
      >
        {tasks && (
          <Pill testId="tracks-tasks">
            <Icon name="list" size={12} color={C.tertiary} />
            <text style={{ fontSize: 12, fontWeight: 500, color: C.secondary, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {`${tasks.completed}/${tasks.total}`}
            </text>
            {tasks.active && (
              <text
                style={{
                  fontSize: 12,
                  color: C.accent,
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                  maxWidth: 220,
                  marginRight: 4,
                }}
              >
                {tasks.active}
              </text>
            )}
          </Pill>
        )}
        {subagents && subagentLabel && (
          <Pill testId="tracks-subagents">
            <Icon name="sparkle" size={12} color={subagents.running.length > 0 ? C.running : C.tertiary} />
            <text style={{ fontSize: 12, fontWeight: 500, color: C.secondary, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {subagentLabel}
            </text>
            {detachable && onOpenAgent && (
              <PillAction
                testId="tracks-subagent-detach"
                icon="panelRight"
                onClick={() => onOpenAgent(detachable.childSessionId!)}
              />
            )}
            {archivable.length > 0 && onArchiveAgent && (
              <PillAction
                testId="tracks-subagent-archive"
                icon="archive"
                busy={archiving}
                onClick={() => void archiveFinished()}
              />
            )}
          </Pill>
        )}
        {changes && onOpenChanges && (
          <Pill testId="tracks-diffstat" onClick={onOpenChanges}>
            <Icon name="gitBranch" size={12} color={C.tertiary} />
            {changes.additions > 0 && (
              <text style={{ fontSize: 12, fontWeight: 500, color: C.ok, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {`+\u2060${changes.additions}`}
              </text>
            )}
            {changes.deletions > 0 && (
              <text style={{ fontSize: 12, fontWeight: 500, color: C.danger, whiteSpace: 'nowrap', flexShrink: 0, marginRight: 4 }}>
                {`-\u2060${changes.deletions}`}
              </text>
            )}
          </Pill>
        )}
      </div>
    </div>
  )
}

/** One removable attachment chip: thumbnail, name, and an × that deletes the staged bytes. */
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ImageAttachment
  onRemove: (id: string) => void
}) {
  return (
    <div
      testId={`attachment-${attachment.name}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 26,
        paddingLeft: 3,
        paddingRight: 3,
        borderRadius: 7,
        backgroundColor: C.item,
        flexShrink: 0,
      }}
    >
      <img
        src={`data:${attachment.mimeType};base64,${attachment.data}`}
        objectFit="cover"
        alt={attachment.name}
        style={{ width: 20, height: 20, borderRadius: 5 }}
      />
      <text
        style={{
          fontSize: 12,
          lineHeight: 16,
          color: C.secondary,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          minWidth: 0,
          maxWidth: 120,
        }}
      >
        {attachment.name}
      </text>
      <IconButton icon="x" size={10} onClick={() => onRemove(attachment.id)} testId={`detach-${attachment.id}`} />
    </div>
  )
}

/** A 26px circular icon button at the composer's foot. */
function RoundButton({
  testId,
  icon,
  iconSize,
  iconColor,
  enabled,
  filled,
  dimWhenDisabled,
  onClick,
}: {
  testId: string
  icon: IconName
  iconSize: number
  iconColor: string
  enabled: boolean
  filled?: boolean
  dimWhenDisabled?: boolean
  onClick?: () => void
}) {
  return (
    <div
      testId={testId}
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: enabled ? 'pointer' : undefined,
        opacity: !enabled && dimWhenDisabled ? 0.35 : 1,
        backgroundColor: filled && enabled ? C.inverse : C.overlayStrong,
        hover: enabled ? { opacity: 0.9 } : undefined,
      }}
      onClick={enabled ? onClick : undefined}
    >
      <Icon name={icon} size={iconSize} color={iconColor} />
    </div>
  )
}

export function Composer({
  value,
  onChange,
  onSend,
  disabledReason,
  chips,
  attachments = [],
  onRemoveAttachment,
  onAttach,
  onPastePayload,
  attachNotice,
}: {
  value: string
  onChange: (next: string) => void
  onSend: (text: string) => void
  disabledReason: string | null
  chips: React.ReactNode
  /** Staged image chips shown above the input. */
  attachments?: readonly ImageAttachment[]
  onRemoveAttachment?: (id: string) => void
  /** Opens the raster-filtered file picker; attaching disables while disconnected. */
  onAttach?: () => void
  /**
   * Receives clipboard contents (text, or files with name/mime/size/bytes) once
   * a runtime bridge offers them; raster images become chips, text falls through.
   */
  onPastePayload?: (payload: PastePayload) => void
  attachNotice?: { text: string; tone: 'warn' | 'danger' } | null
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
        {attachments.length > 0 && (
          <div
            testId="attachment-chips"
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 6,
              marginBottom: 8,
              paddingLeft: 10,
              paddingRight: 10,
            }}
          >
            {attachments.map((attachment) => (
              <AttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemoveAttachment ?? (() => {})} />
            ))}
          </div>
        )}
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
        {attachNotice && (
          <text
            testId="attach-notice"
            style={{
              fontSize: 12,
              color: attachNotice.tone === 'danger' ? C.danger : C.warn,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 6,
            }}
          >
            {attachNotice.text}
          </text>
        )}
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
          <RoundButton
            testId="attach"
            icon="image"
            iconSize={15}
            iconColor={C.tertiary}
            enabled={!disabledReason && onAttach != null}
            dimWhenDisabled
            onClick={onAttach}
          />
          <RoundButton
            testId="send"
            icon="send"
            iconSize={16}
            iconColor={ready ? C.onInverse : C.ghost}
            enabled={ready}
            filled
            onClick={() => send(value)}
          />
        </div>
      </div>
    </div>
  )
}

export function FooterBar({
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
