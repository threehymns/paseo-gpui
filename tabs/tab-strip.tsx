/**
 * The workspace tab strip (#46).
 *
 * One row above a tab's screen holding every open tab: agent tabs (a
 * running/finished conversation), draft tabs (a candidate prompt not yet sent),
 * and a trailing "new draft" affordance. The reducer owns order and focus —
 * this component only renders and translates pointer gestures into TabsEvents.
 *
 * Enrollment keeps focus on the focused tab across a close-others: the strip
 * renders the survivors' Close-others item disabled for the surviving tab.
 */

import React, { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger } from '@gpuix/react'
import { C, TRAFFIC_LIGHT_CLEARANCE } from '../chrome/theme'
import { Icon } from '../chrome/chrome'
import type { TabDescriptor } from './tabs'

export const TAB_STRIP_HEIGHT = 34

interface TabStripProps {
  tabs: TabDescriptor[]
  activeTabId: string | null
  /** Per-tab display label (agent display name, or a draft's directory basename). */
  labelFor: (tab: TabDescriptor) => string
  /** Optional per-tab accent dot color (e.g. agent status); null shows none. */
  dotColorFor?: (tab: TabDescriptor) => string | null
  /** True when a tab should surface the user's attention (e.g. permission). */
  attentionFor?: (tab: TabDescriptor) => boolean
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onCloseOthers: (tabId: string) => void
  onNewDraft: () => void
}

/** One tab: label, optional accent dot, hover/tail close affordance, active state. */
function StripTab({
  tab,
  active,
  label,
  dotColor,
  attention,
  onSelect,
  onClose,
}: {
  tab: TabDescriptor
  active: boolean
  label: string
  dotColor: string | null
  attention: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const [hover, setHover] = useState(false)
  const show = hover || active
  return (
    <div
      testId="tab"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: '100%',
        paddingLeft: 12,
        paddingRight: 8,
        maxWidth: 200,
        cursor: 'default',
        userSelect: 'none',
        backgroundColor: active ? C.raised : 'transparent',
        boxShadow: active ? `inset 0 1px 0 ${C.borderStrong}` : undefined,
        color: active ? C.text : C.secondary,
        borderRight: `1px solid ${C.border}`,
      }}
    >
      {dotColor && (
        <div
          style={{
            width: 6,
            height: 6,
            flexShrink: 0,
            borderRadius: 3,
            backgroundColor: dotColor,
            ...(attention ? { boxShadow: `0 0 6px ${dotColor}` } : {}),
          }}
        />
      )}
      <text
        style={{
          flexShrink: 0,
          fontSize: 12,
          fontWeight: active ? 600 : 500,
          lineHeight: 16,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </text>
      <div
        testId={`tab-close-${tab.id}`}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation()
          onClose()
        }}
        style={{
          display: show ? 'flex' : 'none',
          width: 16,
          height: 16,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          borderRadius: 4,
          backgroundColor: hover ? C.overlay : 'transparent',
        }}
      >
        <Icon name="x" size={11} color={C.secondary} />
      </div>
    </div>
  )
}

export function TabStrip({
  tabs,
  activeTabId,
  labelFor,
  dotColorFor,
  attentionFor,
  onSelect,
  onClose,
  onCloseOthers,
  onNewDraft,
}: TabStripProps) {
  const active = tabs.find((tab) => tab.id === activeTabId) ?? null

  return (
    <div
      testId="tab-strip"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        height: TAB_STRIP_HEIGHT,
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        backgroundColor: C.composer,
        borderBottom: `1px solid ${C.border}`,
        paddingLeft: TRAFFIC_LIGHT_CLEARANCE + 2,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          flexGrow: 1,
          minWidth: 0,
        }}
      >
        {tabs.map((tab) => (
          <StripTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            label={labelFor(tab)}
            dotColor={dotColorFor?.(tab) ?? null}
            attention={attentionFor?.(tab) ?? false}
            onSelect={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
          />
        ))}
      </div>
      <div
        testId="tab-new-draft"
        onClick={onNewDraft}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: '100%',
          flexShrink: 0,
          color: C.secondary,
          borderRight: `1px solid ${C.border}`,
        }}
      >
        <Icon name="compose" size={14} color={C.secondary} />
      </div>
      <Select
        value=""
        onValueChange={(value) => {
          if (value === 'close-others' && active) onCloseOthers(active.id)
          else if (value === 'new-draft') onNewDraft()
        }}
      >
        <SelectTrigger
          testId="tab-menu"
          style={(state) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: '100%',
            flexShrink: 0,
            backgroundColor: state.open ? C.overlay : 'transparent',
            border: 'none',
            cursor: 'default',
          })}
        >
          <Icon name="ellipsis" size={14} color={C.secondary} />
        </SelectTrigger>
        <SelectContent side="bottom" align="end" sideOffset={2} style={{ width: 200 }}>
          <SelectItem value="close-others" textValue="Close other tabs" disabled={!active || tabs.length <= 1}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <text style={{ fontSize: 13, color: C.text }}>Close other tabs</text>
            </div>
          </SelectItem>
          <SelectSeparator />
          <SelectItem value="new-draft" textValue="New draft">
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <text style={{ fontSize: 13, color: C.text }}>New draft</text>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
