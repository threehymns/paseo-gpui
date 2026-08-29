/**
 * The composer: draft textarea with chips, plus the workspace footer bar.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import React, { useMemo } from 'react'
import { Icon, IconButton, StatusDot, type IconName } from './chrome'
import { OptionPicker } from './pickers'
import { basename } from './paseo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import type { ImageAttachment, PastePayload } from './attachments'
import type { ProviderNotice } from './live-config'
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
  disabledReason,
  chips,
  attachments = [],
  onRemoveAttachment,
  onAttach,
  onPastePayload,
  attachNotice,
  usageMeter = null,
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
  /** Context-window meter ring; hidden entirely when there is no usage data. */
  usageMeter?: ContextMeter | null
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
