/**
 * The command palette overlay: one input over a ranked action catalog.
 *
 * Rendering only — matching, ranking, and selection math live in palette.ts,
 * and every row comes from the shared registry (actions.ts). Mounting is the
 * lifetime of every handler here: closing the palette unmounts the input's
 * keys and the click-outside dismiss together with the DOM.
 */

import React, { useEffect, useRef, useState } from 'react'
import { clampSelection, flattenGroups, moveSelection, searchActions } from './palette'
import type { ActionRegistry, RegisteredAction } from './actions'
import { Icon } from '../chrome/chrome'
import { C } from '../chrome/theme'

/**
 * Keeps a batch of contributed actions in the registry for as long as `deps`
 * stay identical; the disposer retires exactly that batch when they change,
 * so contributions always mirror live daemon state.
 */
export function useContributeActions(
  registry: ActionRegistry,
  contribute: () => RegisteredAction[],
  deps: readonly unknown[],
): void {
  const latest = useRef(contribute)
  latest.current = contribute
  useEffect(() => registry.register(...latest.current()), deps)
}

const PALETTE_WIDTH = 560

function Row({
  action,
  selected,
  onRun,
}: {
  action: RegisteredAction
  selected: boolean
  onRun: (action: RegisteredAction) => void
}) {
  return (
    <div
      testId={`palette-row-${action.id}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 5,
        paddingBottom: 5,
        borderRadius: 7,
        cursor: 'pointer',
        backgroundColor: selected ? C.item : '#00000000',
        hover: { backgroundColor: C.item },
      }}
      onClick={() => onRun(action)}
    >
      <text
        style={{
          fontSize: 13,
          lineHeight: 17,
          color: C.text,
          flexGrow: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          fontWeight: action.checked ? 600 : 400,
        }}
      >
        {action.title}
      </text>
      {action.hint && (
        <text
          style={{
            fontSize: 12,
            color: C.ghost,
            flexShrink: 0,
            maxWidth: 200,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {action.hint}
        </text>
      )}
      {action.checked && <Icon name="check" size={11} color={C.secondary} />}
    </div>
  )
}

export function CommandPaletteView({
  registry,
  onClose,
}: {
  registry: ActionRegistry
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [requestedIndex, setRequestedIndex] = useState(0)

  const groups = searchActions(registry.list(), query)
  const items = flattenGroups(groups)
  const selectedIndex = clampSelection(requestedIndex, items.length)
  const rowIndex = new Map(items.map((action, index) => [action, index]))

  const runAndClose = (action: RegisteredAction) => {
    if (action.enabled === false) return
    action.run()
    onClose()
  }

  return (
    <div
      testId="command-palette"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: '#00000040',
      }}
    >
      <div
        onMouseDownOutside={onClose}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: PALETTE_WIDTH,
          maxHeight: 460,
          marginTop: 96,
          overflow: 'hidden',
          backgroundColor: C.raised,
          borderWidth: 1,
          borderColor: C.borderStrong,
          borderRadius: 12,
          paddingTop: 6,
          paddingBottom: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 12,
            paddingRight: 12,
            paddingBottom: 6,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          }}
        >
          <Icon name="search" size={14} color={C.tertiary} />
          <input
            testId="palette-input"
            value={query}
            placeholder="Search commands, files, workspaces, and agents..."
            autoFocus
            style={{
              flexGrow: 1,
              minWidth: 0,
              height: 30,
              fontSize: 13.5,
              color: C.text,
              backgroundColor: '#00000000',
              borderWidth: 0,
              padding: 0,
            }}
            onChange={(event) => {
              setQuery(event.value ?? '')
              setRequestedIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'down') setRequestedIndex(moveSelection(items.length, selectedIndex, 1))
              else if (event.key === 'up') setRequestedIndex(moveSelection(items.length, selectedIndex, -1))
              else if (event.key === 'enter' && selectedIndex >= 0) runAndClose(items[selectedIndex]!)
              else if (event.key === 'escape') onClose()
            }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'scroll', padding: 4 }}>
          {groups.map((group, groupIndex) => (
            <div key={group.section} style={{ display: 'flex', flexDirection: 'column', paddingBottom: 4 }}>
              {groupIndex > 0 && (
                <div style={{ height: 1, backgroundColor: C.border, marginTop: 3, marginBottom: 3 }} />
              )}
              <div style={{ display: 'flex', alignItems: 'center', height: 20, paddingLeft: 10 }}>
                <text style={{ fontSize: 11.5, fontWeight: 500, color: C.ghost }}>{group.label}</text>
              </div>
              {group.items.map((match) => (
                <Row
                  key={match.action.id}
                  action={match.action}
                  selected={rowIndex.get(match.action) === selectedIndex}
                  onRun={runAndClose}
                />
              ))}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ padding: 14 }}>
              <text style={{ fontSize: 12.5, color: C.tertiary }}>No matching actions.</text>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
