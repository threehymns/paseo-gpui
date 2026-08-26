/**
 * The composer: draft textarea with chips, plus the workspace footer bar.
 */

import React, { useMemo } from 'react'
import { Icon, IconButton, StatusDot, type IconName } from './chrome'
import { OptionPicker } from './pickers'
import { basename } from './paseo'
import { useMentionCompletions, type MentionEntry, type MentionSource } from './mentions'
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

/** Last path segment; directories keep their trailing slash as a kind cue. */
function mentionRowLabel(entry: MentionEntry): string {
  const name = basename(entry.path)
  return entry.kind === 'directory' ? `${name}/` : name
}

/** Directory containing the entry, '' at the workspace root. */
function mentionRowHint(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}

/** Suggestion rows floating above the draft input while a mention is live. */
function MentionList({
  completions,
  onPick,
}: {
  completions: ReturnType<typeof useMentionCompletions>
  onPick: (entry: MentionEntry) => void
}) {
  return (
    <div
      testId="mention-list"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 6,
        display: 'flex',
        flexDirection: 'column',
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
      {completions.entries.map((entry, index) => {
        const highlighted = index === completions.highlight
        const hint = mentionRowHint(entry.path)
        return (
          <div
            key={entry.path}
            testId={`mention-option-${index}`}
            onClick={() => onPick(entry)}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: 7,
              cursor: 'pointer',
              backgroundColor: highlighted ? '#404040' : C.raised,
              hover: { backgroundColor: '#404040' },
            }}
          >
            <Icon
              name={entry.kind === 'directory' ? 'folder' : 'file'}
              size={13}
              color={entry.kind === 'directory' ? C.accent : C.tertiary}
            />
            <text
              style={{
                fontSize: 12.5,
                fontWeight: highlighted ? 600 : 500,
                color: C.text,
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                minWidth: 0,
                flexGrow: 1,
              }}
            >
              {mentionRowLabel(entry)}
            </text>
            {hint && <text style={{ fontSize: 11, color: C.ghost, flexShrink: 0 }}>{hint}</text>}
          </div>
        )
      })}
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
  mentionSource,
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
  /** Workspace listing that feeds `@` completion; null or absent disables it. */
  mentionSource?: MentionSource | null
}) {
  const ready = value.trim().length > 0 && !disabledReason
  const send = (text: string) => {
    const next = text.trim()
    if (!next || disabledReason) return
    onSend(next)
  }
  const completions = useMentionCompletions(mentionSource ?? null, value)
  const pick = (entry: MentionEntry) => {
    const next = completions.draftFor(entry)
    if (next != null) onChange(next)
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
          position: 'relative',
          backgroundColor: C.composer,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: C.border,
          paddingTop: 10,
          paddingBottom: 10,
        }}
      >
        {completions.open && <MentionList completions={completions} onPick={pick} />}
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
          onKeyDown={(event) => {
            if (!completions.open) return
            if (event.key === 'down') completions.moveHighlight(1)
            else if (event.key === 'up') completions.moveHighlight(-1)
            else if (event.key === 'escape') completions.dismiss()
          }}
          onSubmit={(event) => {
            const highlighted = completions.entries[completions.highlight]
            // Enter completes the live mention instead of sending; normal
            // typing and submits are untouched while the list is closed.
            if (completions.open && highlighted) {
              pick(highlighted)
              return
            }
            send(event.value ?? value)
          }}
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
