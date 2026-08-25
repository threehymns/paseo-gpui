/**
 * The composer: draft textarea with chips, the slash-command menu, plus the
 * workspace footer bar.
 */

import React, { useMemo, useRef, useState } from 'react'
import { Icon, StatusDot } from './chrome'
import { OptionPicker } from './pickers'
import { basename } from './paseo'
import type { ProviderNotice } from './live-config'
import {
  nextCaretAfterEdit,
  useSlashCommandMenu,
  type DaemonCommandsSeam,
  type DraftCommandsInput,
  type SlashCommand,
} from './slash-commands'
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

export function Composer({
  value,
  onChange,
  onSend,
  disabledReason,
  chips,
  commands,
}: {
  value: string
  onChange: (next: string) => void
  onSend: (text: string) => void
  disabledReason: string | null
  chips: React.ReactNode
  commands?: ComposerCommands
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

  const handleKeyDown = (event: { key?: string }) => {
    const key = event.key ?? ''
    if (key && menu.handleKey(key)) return
    if (key === 'left' || key === 'right') {
      setCaret((current) =>
        Math.max(0, Math.min(current + (key === 'left' ? -1 : 1), value.length)),
      )
    } else if (key === 'home') {
      setCaret(0)
    } else if (key === 'end') {
      setCaret(value.length)
    }
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
        }}
      >
        {menu.visible && <SlashCommandMenu menu={menu} />}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            overflow: 'visible',
            backgroundColor: C.composer,
            borderRadius: 13,
            borderWidth: 1,
            borderColor: C.border,
            paddingTop: 10,
            paddingBottom: 10,
          }}
        >
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
            onKeyDown={handleKeyDown}
            onSubmit={(event) => send(event.value ?? value)}
          />
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
            <div
              testId="send"
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: ready ? 'pointer' : undefined,
                backgroundColor: ready ? C.inverse : C.overlayStrong,
                hover: ready ? { opacity: 0.9 } : undefined,
              }}
              onClick={() => send(value)}
            >
              <Icon name="send" size={16} color={ready ? C.onInverse : C.ghost} />
            </div>
          </div>
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
