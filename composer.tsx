/**
 * The composer: draft textarea with chips, plus the workspace footer bar.
 */

import React, { useMemo } from 'react'
import { Icon, StatusDot } from './chrome'
import { OptionPicker } from './pickers'
import { basename } from './paseo'
import { C, CHAT_THEME, CONTENT_MAX_WIDTH } from './theme'

export function Composer({
  value,
  onChange,
  onSend,
  disabledReason,
  chips,
}: {
  value: string
  onChange: (next: string) => void
  onSend: (text: string) => void
  disabledReason: string | null
  chips: React.ReactNode
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
