/**
 * Composer chip pickers: model, reasoning effort, and access mode menus.
 */

import React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  type StyleDesc,
} from '@gpuix/react'
import { Icon, type IconName } from './chrome'
import { modelChoices, type ProviderEntry, type ProviderFeatureToggle, type ProviderMode, type ProviderModel } from './paseo'
import { C } from './theme'

const MENU = {
  minWidth: 220,
  paddingTop: 4,
  paddingBottom: 4,
  paddingLeft: 4,
  paddingRight: 4,
  backgroundColor: C.raised,
  borderWidth: 1,
  borderColor: C.borderStrong,
  borderRadius: 12,
} satisfies StyleDesc

export interface MenuOption {
  id: string
  label: string
  description?: string
}

function MenuRow({
  label,
  description,
  selected,
  highlighted,
  hint,
}: {
  label: string
  description?: string
  selected: boolean
  highlighted: boolean
  hint?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        paddingTop: description ? 6 : 5,
        paddingBottom: description ? 6 : 5,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 7,
        backgroundColor: highlighted ? '#404040' : selected ? '#2C2C2C' : C.raised,
        hover: { backgroundColor: '#404040' },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
        <text
          style={{
            fontSize: 12.5,
            fontWeight: selected ? 600 : 500,
            color: C.text,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </text>
        {description && (
          <text style={{ fontSize: 12.5, lineHeight: 14, color: C.tertiary, paddingTop: 2 }}>
            {description}
          </text>
        )}
      </div>
      {hint && <text style={{ fontSize: 11.5, color: C.ghost, flexShrink: 0 }}>{hint}</text>}
      {selected && <Icon name="check" size={11} color={C.tertiary} />}
    </div>
  )
}

function ChipSelect({
  value,
  onChange,
  icon,
  label,
  caret = true,
  accent,
  menuWidth,
  children,
}: {
  value: string
  onChange: (next: string) => void
  icon: IconName
  label: string
  caret?: boolean
  accent?: boolean
  menuWidth?: number
  children: React.ReactNode
}) {
  return (
    <Select value={value} onValueChange={onChange} style={{ flexShrink: 0 }}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <SelectTrigger
          style={(state) => ({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 26,
            paddingLeft: 7,
            paddingRight: 7,
            borderRadius: 6,
            cursor: 'pointer',
            backgroundColor: state.open ? C.overlay : '#00000000',
            hover: { backgroundColor: C.overlay },
          })}
        >
          <Icon name={icon} size={12} color={accent ? C.accent : C.tertiary} />
          <text
            style={{
              fontSize: 13,
              lineHeight: 16,
              color: accent ? C.accent : C.secondary,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </text>
          {caret && <Icon name="chevronDown" size={10.5} color={C.ghost} />}
        </SelectTrigger>
        <SelectContent side="top" sideOffset={4} style={{ ...MENU, minWidth: menuWidth ?? 220 }}>
          {children}
        </SelectContent>
      </div>
    </Select>
  )
}

export function ModelPicker({
  providers,
  value,
  onChange,
}: {
  providers: ProviderEntry[]
  value: string
  onChange: (next: string) => void
}) {
  const choices = React.useMemo(() => modelChoices(providers), [providers])
  const selected = choices.find((choice) => choice.value === value)

  const groups = React.useMemo(() => {
    const out: { name: string; items: typeof choices }[] = []
    for (const choice of choices) {
      const last = out[out.length - 1]
      if (last && last.name === choice.providerLabel) last.items.push(choice)
      else out.push({ name: choice.providerLabel, items: [choice] })
    }
    return out
  }, [choices])

  return (
    <ChipSelect
      value={value}
      onChange={onChange}
      icon="sparkle"
      label={selected?.label ?? (choices.length > 0 ? 'Pick a model' : 'No models')}
      menuWidth={252}
    >
      {groups.map((group, index) => (
        <div key={group.name} style={{ display: 'flex', flexDirection: 'column' }}>
          {index > 0 && (
            <div style={{ height: 1, backgroundColor: C.border, marginTop: 4, marginBottom: 4 }} />
          )}
          <SelectLabel
            style={{
              height: 22,
              paddingLeft: 8,
              paddingRight: 8,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <text style={{ fontSize: 11.5, fontWeight: 500, color: C.ghost }}>{group.name}</text>
          </SelectLabel>
          {group.items.map((choice) => (
            <SelectItem key={choice.value} value={choice.value} textValue={choice.label}>
              {(state) => (
                <MenuRow
                  label={choice.label}
                  hint={choice.modelId}
                  selected={state.selected}
                  highlighted={state.highlighted}
                />
              )}
            </SelectItem>
          ))}
        </div>
      ))}
    </ChipSelect>
  )
}

export function OptionPicker({
  value,
  onChange,
  options,
  icon,
  sectionLabel,
  fallbackLabel,
  menuWidth,
}: {
  value: string | null
  onChange: (next: string) => void
  options: MenuOption[]
  icon: IconName
  sectionLabel?: string
  fallbackLabel: string
  menuWidth?: number
}) {
  const selected = options.find((option) => option.id === value)
  if (options.length === 0) return null
  return (
    <ChipSelect
      value={value ?? ''}
      onChange={onChange}
      icon={icon}
      label={selected?.label ?? fallbackLabel}
      caret={false}
      menuWidth={menuWidth}
    >
      {sectionLabel && (
        <SelectLabel
          style={{
            height: 22,
            paddingLeft: 8,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <text style={{ fontSize: 11.5, fontWeight: 500, color: C.ghost }}>{sectionLabel}</text>
        </SelectLabel>
      )}
      {options.map((option) => (
        <SelectItem key={option.id} value={option.id} textValue={option.label}>
          {(state) => (
            <MenuRow
              label={option.label}
              description={option.description}
              selected={state.selected}
              highlighted={state.highlighted}
            />
          )}
        </SelectItem>
      ))}
    </ChipSelect>
  )
}

export function modeOptions(modes: ProviderMode[] | undefined): MenuOption[] {
  return (modes ?? []).map((mode) => ({ id: mode.id, label: mode.label, description: mode.description }))
}

export function thinkingOptions(model: ProviderModel | undefined): MenuOption[] {
  return (model?.thinkingOptions ?? []).map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description,
  }))
}

/**
 * One On/Off chip per exposed provider feature; values come from the draft
 * config or, for a live agent, from daemon truth under optimistic holds.
 */
export function FeatureToggles({
  features,
  values,
  onToggle,
}: {
  features: ProviderFeatureToggle[]
  values: Record<string, unknown>
  onToggle: (id: string, next: boolean) => void
}) {
  if (features.length === 0) return null
  return (
    <>
      {features.map((feature) => {
        const on = values[feature.id] === true
        return (
          <div
            key={feature.id}
            testId={`feature-${feature.id}`}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 26,
              paddingLeft: 7,
              paddingRight: 5,
              borderRadius: 6,
              cursor: 'pointer',
              flexShrink: 0,
              hover: { backgroundColor: C.overlay },
            }}
            onClick={() => onToggle(feature.id, !on)}
          >
            <Icon name="wrench" size={12} color={on ? C.accent : C.tertiary} />
            <text
              style={{
                fontSize: 13,
                lineHeight: 16,
                color: on ? C.accent : C.secondary,
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                minWidth: 0,
                maxWidth: 120,
              }}
            >
              {feature.label}
            </text>
            <div
              testId={`feature-state-${feature.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 16,
                paddingLeft: 6,
                paddingRight: 6,
                borderRadius: 8,
                flexShrink: 0,
                backgroundColor: on ? '#E2795B26' : C.overlayStrong,
              }}
            >
              <text style={{ fontSize: 11, fontWeight: 500, color: on ? C.accent : C.ghost }}>
                {on ? 'On' : 'Off'}
              </text>
            </div>
          </div>
        )
      })}
    </>
  )
}
