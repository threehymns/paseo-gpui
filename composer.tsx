/**
 * The composer: draft textarea with chips, plus the workspace footer bar.
 */

import React, { useMemo } from 'react'
import { Icon, IconButton, StatusDot, type IconName } from './chrome'
import { OptionPicker } from './pickers'
import { basename } from './paseo'
import type { ImageAttachment, PastePayload } from './attachments'
import type { ProviderNotice } from './live-config'
import { classifyEnter, type KeyModifiers } from './send-intent'
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

/** One parked send above the composer: click it to edit back into the input, or fire it now. */
function ParkedSendRow({
  id,
  text,
  onEdit,
  onSendNow,
}: {
  id: string
  text: string
  onEdit?: (id: string) => void
  onSendNow?: (id: string) => void
}) {
  return (
    <div
      testId={`parked-${id}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 5,
        paddingBottom: 5,
        borderRadius: 8,
        backgroundColor: C.item,
      }}
    >
      <div
        onClick={onEdit ? () => onEdit(id) : undefined}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          flexGrow: 1,
          borderRadius: 6,
          paddingTop: 2,
          paddingBottom: 2,
          cursor: onEdit ? 'pointer' : undefined,
          hover: onEdit ? { backgroundColor: C.overlayStrong } : undefined,
        }}
      >
        <Icon name="pencil" size={11} color={C.ghost} />
        <text
          style={{
            fontSize: 12.5,
            lineHeight: 17,
            color: C.secondary,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {text}
        </text>
      </div>
      <div
        testId={`send-now-${id}`}
        onClick={onSendNow ? () => onSendNow(id) : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 20,
          paddingLeft: 9,
          paddingRight: 9,
          borderRadius: 6,
          backgroundColor: C.overlayStrong,
          flexShrink: 0,
          cursor: onSendNow ? 'pointer' : undefined,
          hover: onSendNow ? { backgroundColor: C.inverse } : undefined,
        }}
      >
        <text style={{ fontSize: 11.5, fontWeight: 500, color: C.secondary, flexShrink: 0 }}>Send now</text>
      </div>
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
  onQueue,
  onInterrupt,
  parked = [],
  onEditParked,
  onSendParkedNow,
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
  /** Cmd/Ctrl+Enter while running: parks the draft as a pending send above the input. */
  onQueue?: (text: string) => void
  /** Alt+Enter while running: stops the active turn first, then delivers fresh. */
  onInterrupt?: (text: string) => void
  /** Parked sends awaiting release, oldest first. */
  parked?: readonly { id: string; text: string }[]
  /** Pulls a parked send back into the composer for editing. */
  onEditParked?: (id: string) => void
  /** Fires a parked send immediately. */
  onSendParkedNow?: (id: string) => void
}) {
  const ready = value.trim().length > 0 && !disabledReason
  const send = (text: string) => {
    const next = text.trim()
    if (!next || disabledReason) return
    onSend(next)
  }
  const gestureText = (event: { value?: string }) => event.value ?? value
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
        {parked.length > 0 && (
          <div
            testId="parked-sends"
            style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, paddingLeft: 10, paddingRight: 10 }}
          >
            {parked.map((entry) => (
              <ParkedSendRow key={entry.id} id={entry.id} text={entry.text} onEdit={onEditParked} onSendNow={onSendParkedNow} />
            ))}
          </div>
        )}
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
            // Modified Enters carry queue/interrupt intents; plain Enter stays
            // with the editor's submit path below.
            if (event.key?.toLowerCase() !== 'enter') return
            const gesture = classifyEnter(event.modifiers as KeyModifiers)
            if (gesture === 'queue' && onQueue && !disabledReason) onQueue(gestureText(event).trim())
            else if (gesture === 'interrupt' && onInterrupt && !disabledReason) onInterrupt(gestureText(event).trim())
          }}
          onSubmit={(event) => {
            // Guard against the native editor submitting on a modified Enter;
            // those keystrokes are owned by onKeyDown's gestures.
            if (classifyEnter(event.modifiers as KeyModifiers) !== 'send') return
            send(gestureText(event))
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
