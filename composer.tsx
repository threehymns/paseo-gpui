/**
 * The composer: draft textarea with chips, the slash-command menu, plus the
 * workspace footer bar.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import React, { useMemo, useRef, useState } from 'react'
import { Icon, IconButton, StatusDot, type IconName } from './chrome'
import { OptionPicker } from './pickers'
import { basename } from './paseo'
import { useMentionCompletions, type MentionEntry, type MentionSource } from './mentions'
import type { Turn } from './paseo'
import { changesTrack, tasksTrack } from './tracks'
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import type { ImageAttachment, PastePayload } from './attachments'
import type { ProviderNotice } from './live-config'
import { classifyEnter, type KeyModifiers } from './send-intent'
import {
  nextCaretAfterEdit,
  useSlashCommandMenu,
  type DaemonCommandsSeam,
  type DraftCommandsInput,
  type SlashCommand,
} from './slash-commands'
import { type ContextMeter, type MeterTone } from './usage'
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

/** Who the daemon should list commands for while this composer is live. */
export interface ComposerCommands {
  seam: DaemonCommandsSeam
  agentId: string | null
  draft: DraftCommandsInput | null
}

// ---- tracks row -------------------------------------------------------------

export function Pill({
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
export function PillAction({
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
 * The tracks row above the composer: live work at a glance. The Tasks and
 * DiffStat pills fold from the transcript's turns; the Subagents pill arrives
 * as a slot reading the subagent store instead. The DiffStat pill renders only
 * while a Changes surface exists (`onOpenChanges`); the whole row disappears
 * when nothing has to say.
 */
export function TracksRow({
  turns,
  subagents,
  onOpenChanges,
}: {
  turns: Turn[]
  /** The Subagents pill element, rendered between Tasks and DiffStat. */
  subagents?: React.ReactNode
  /** Present only while a Changes surface exists to open. */
  onOpenChanges?: () => void
}) {
  const tasks = tasksTrack(turns)
  const changes = changesTrack(turns)

  if (!tasks && !(changes && onOpenChanges) && !subagents) return null

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
        {subagents}
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

const METER_COLORS: Record<MeterTone, string> = {
  neutral: C.secondary,
  amber: C.warn,
  red: C.danger,
}

/**
 * A ring gauge for the native `svg` element. The renderer takes `src` as a
 * real filesystem path to an .svg file (raises ENOENT on inline markup) and
 * paints it monochrome, tinting the whole shape with `style.color`. So the
 * two-tone ring (faint track + colored arc) is two stacked layers, each its
 * own file written to a scratch dir and colored via style: the track is the
 * full circle, the arc covers `fraction` of it starting at 12 o'clock (the
 * r=15.9155 trick makes the circumference exactly 100).
 */

const RING_SIZE = 36
const RING_RADIUS = 15.9155
const RING_STROKE = 4
const RING_ROOT = path.join(tmpdir(), 'gpuix-chat-assets')

function ringSvg(dasharray: string): string {
  const r = RING_SIZE / 2
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${RING_SIZE} ${RING_SIZE}">`,
    `<circle cx="${r}" cy="${r}" r="${RING_RADIUS}" fill="none" stroke="#000" stroke-width="${RING_STROKE}"`,
    dasharray ? ` stroke-linecap="round" stroke-dasharray="${dasharray}"` : '',
    ` transform="rotate(-90 ${r} ${r})"/>`,
    '</svg>',
  ].join(' ')
}

/** Materialize an svg string as a real file so the native renderer can load it. */
function ringAsset(content: string, key: string): string {
  mkdirSync(RING_ROOT, { recursive: true })
  const dest = path.join(RING_ROOT, `meter-ring-${key}.svg`)
  writeFileSync(dest, content)
  return dest
}

function meterRingAssets(fraction: number): { track: string; arc: string } {
  const arcPct = Math.max(0, Math.min(1, fraction)) * 100
  const track = ringAsset(ringSvg('100 0'), 'track')
  const arc = ringAsset(ringSvg(`${arcPct} ${100 - arcPct}`), `arc-${Math.round(arcPct * 100)}`)
  return { track, arc }
}

/** The context-window meter ring with its hover breakdown. */
function UsageRing({ meter }: { meter: ContextMeter }) {
  const color = METER_COLORS[meter.tone]
  const assets = useMemo(() => meterRingAssets(meter.fraction), [meter.fraction])
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div testId="context-meter" style={{ position: 'relative', width: 16, height: 16, cursor: 'default', display: 'flex' }}>
          <svg src={assets.track} style={{ width: 16, height: 16, color: C.overlayStrong, position: 'absolute', inset: 0 }} />
          <svg src={assets.arc} style={{ width: 16, height: 16, color, position: 'absolute', inset: 0 }} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: 8,
            backgroundColor: C.raised,
            borderWidth: 1,
            borderColor: C.borderStrong,
            borderRadius: 10,
          }}
        >
          {meter.lines.map((line) => (
            <text key={line} style={{ fontSize: 12, lineHeight: 16, color: C.secondary, whiteSpace: 'nowrap' }}>
              {line}
            </text>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
export function Composer({
  value,
  onChange,
  onSend,
  onFocus,
  onBlur,
  disabledReason,
  chips,
  commands,
  canStop,
  stopping,
  onStop,
  attachments = [],
  onRemoveAttachment,
  onAttach,
  onPastePayload,
  transientNotice,
  usageMeter = null,
  mentionSource,
  onQueue,
  onInterrupt,
  parked = [],
  onEditParked,
  onSendParkedNow,
}: {
  value: string
  onChange: (next: string) => void
  onSend: (text: string) => void
  /** Composer engagement moments — attention clears on all of them. */
  onFocus?: () => void
  onBlur?: () => void
  disabledReason: string | null
  chips: React.ReactNode
  commands?: ComposerCommands
  /** True only while the open agent is running; shows the stop control. */
  canStop?: boolean
  /** True while the cancel request is in flight; clicks are held until it settles. */
  stopping?: boolean
  onStop?: () => void
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
  transientNotice?: { text: string; tone: 'warn' | 'danger' } | null
  /** Context-window meter ring; hidden entirely when there is no usage data. */
  usageMeter?: ContextMeter | null
  /** Workspace listing that feeds `@` completion; null or absent disables it. */
  mentionSource?: MentionSource | null
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

  // The native textarea reports values but not caret offsets, so the caret is
  // tracked here: edits at the end stay at the end, arrows and home/end move it.
  const [caret, setCaret] = useState(value.length)
  const lastValueRef = useRef(value)
  const trackChange = (next: string, explicitCaret?: number) => {
    setCaret(explicitCaret ?? nextCaretAfterEdit(lastValueRef.current, next, caret))
    lastValueRef.current = next
    onChange(next)
  }

  const menu = useSlashCommandMenu({
    seam: commands?.seam ?? null,
    agentId: commands?.agentId ?? null,
    draft: commands?.draft ?? null,
    text: value,
    caret,
    onTextChange: (next, nextCaret) => trackChange(next, nextCaret),
  })

  const send = (text: string) => {
    // Enter with the menu open never submits.
    if (menu.visible) return
    const next = text.trim()
    if (!next || disabledReason) return
    onSend(next)
  }

  const completions = useMentionCompletions(mentionSource ?? null, value)
  const pick = (entry: MentionEntry) => {
    const next = completions.draftFor(entry)
    if (next != null) onChange(next)
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
          position: 'relative',
          backgroundColor: C.composer,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: C.border,
          paddingTop: 10,
          paddingBottom: 10,
        }}
      >
        {menu.visible && <SlashCommandMenu menu={menu} />}
        {completions.open && <MentionList completions={completions} onPick={pick} />}
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
          onChange={(event) => trackChange(event.value ?? '')}
          onKeyDown={(event) => {
            if (menu.visible && event.key && menu.handleKey(event.key)) return
            if (completions.open) {
              if (event.key === 'down') completions.moveHighlight(1)
              else if (event.key === 'up') completions.moveHighlight(-1)
              else if (event.key === 'escape') completions.dismiss()
              return
            }
            // Modified Enters carry queue/interrupt intents; plain Enter stays
            // with the editor's submit path below.
            if (event.key?.toLowerCase() === 'enter') {
              const gesture = classifyEnter(event.modifiers as KeyModifiers)
              if (gesture === 'queue' && onQueue && !disabledReason) onQueue(gestureText(event).trim())
              else if (gesture === 'interrupt' && onInterrupt && !disabledReason) onInterrupt(gestureText(event).trim())
              return
            }
            if (event.key === 'left' || event.key === 'right') {
              setCaret((current) =>
                Math.max(0, Math.min(current + (event.key === 'left' ? -1 : 1), value.length)),
              )
            } else if (event.key === 'home') {
              setCaret(0)
            } else if (event.key === 'end') {
              setCaret(value.length)
            } else if (event.key === 'escape' && canStop && !stopping) {
              onStop?.()
            }
          }}
          onSubmit={(event) => {
            if (menu.visible) return
            const highlighted = completions.entries[completions.highlight]
            if (completions.open && highlighted) {
              pick(highlighted)
              return
            }
            // Guard against the native editor submitting on a modified Enter;
            // those keystrokes are owned by onKeyDown's gestures.
            if (classifyEnter(event.modifiers as KeyModifiers) !== 'send') return
            send(gestureText(event))
          }}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {transientNotice && (
          <text
            testId="composer-notice"
            style={{
              fontSize: 12,
              color: transientNotice.tone === 'danger' ? C.danger : C.warn,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 6,
            }}
          >
            {transientNotice.text}
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
          {canStop && (
            <text
              style={{
                fontSize: 12,
                color: stopping ? C.running : C.tertiary,
                flexShrink: 0,
                marginRight: 6,
              }}
            >
              {stopping ? 'Canceling agent…' : 'Stop agent'}
            </text>
          )}
          {canStop && (
            <div
              testId="stop"
              onClick={stopping ? undefined : onStop}
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: stopping ? undefined : 'pointer',
                opacity: stopping ? 0.5 : 1,
                backgroundColor: C.danger,
                hover: stopping ? undefined : { opacity: 0.85 },
              }}
            >
              {stopping ? (
                <StatusDot color="#FFFFFF" size={8} />
              ) : (
                <Icon name="square" size={11} color="#FFFFFF" />
              )}
            </div>
          )}
          {usageMeter && <UsageRing meter={usageMeter} />}
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

function SlashCommandMenu({ menu }: { menu: ReturnType<typeof useSlashCommandMenu> }) {
  return (
    <div
      testId="slash-command-menu"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxHeight: 264,
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
      {menu.error ? (
        <text
          testId="slash-command-error"
          style={{ fontSize: 12.5, color: C.danger, paddingTop: 5, paddingBottom: 5, paddingLeft: 8 }}
        >
          {menu.error}
        </text>
      ) : menu.rows.length === 0 ? (
        <text style={{ fontSize: 12.5, color: C.tertiary, paddingTop: 5, paddingBottom: 5, paddingLeft: 8 }}>
          No commands found
        </text>
      ) : (
        <>
          {menu.detail && (
            <div
              testId="slash-command-detail"
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'baseline',
                gap: 10,
                paddingLeft: 8,
                paddingRight: 8,
                paddingBottom: 6,
              }}
            >
              <text style={{ fontSize: 12.5, color: C.secondary, whiteSpace: 'nowrap' }}>
                /{menu.detail.name}
              </text>
              {menu.detail.argumentHint && (
                <text style={{ fontSize: 11.5, color: C.ghost, flexShrink: 0 }}>{menu.detail.argumentHint}</text>
              )}
              <text
                style={{
                  fontSize: 12.5,
                  color: C.tertiary,
                  flexGrow: 1,
                  minWidth: 0,
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {menu.detail.description}
              </text>
            </div>
          )}
          <div style={{ height: 1, backgroundColor: C.border, marginBottom: 2 }} />
          {menu.rows.map((command, index) => (
            <CommandRow
              key={command.name}
              command={command}
              highlighted={index === menu.selectedIndex}
              onClick={() => menu.select(index)}
            />
          ))}
        </>
      )}
    </div>
  )
}

function CommandRow({
  command,
  highlighted,
  onClick,
}: {
  command: SlashCommand
  highlighted: boolean
  onClick: () => void
}) {
  return (
    <div
      testId="slash-command-row"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 10,
        width: '100%',
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 7,
        backgroundColor: highlighted ? '#404040' : C.raised,
        hover: { backgroundColor: '#404040' },
        cursor: 'pointer',
      }}
      onClick={onClick}
    >
      <text style={{ fontSize: 13, fontWeight: highlighted ? 600 : 500, color: C.text, flexShrink: 0 }}>
        /{command.name}
      </text>
      {command.argumentHint && (
        <text style={{ fontSize: 11.5, color: C.ghost, flexShrink: 0 }}>{command.argumentHint}</text>
      )}
      <text
        style={{
          fontSize: 12.5,
          color: C.tertiary,
          flexGrow: 1,
          minWidth: 0,
          textAlign: 'right',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {command.description}
      </text>
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
